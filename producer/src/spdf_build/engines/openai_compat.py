"""Any OpenAI-compatible API (OpenAI, OpenRouter, vLLM, llama.cpp server, LM Studio, Ollama…).

Base URL from `--base-url` or `OPENAI_BASE_URL`, key from `OPENAI_API_KEY`
(optional for local servers). A server on localhost counts as offline.
"""
from __future__ import annotations

import os
import uuid
from typing import Optional
from urllib.parse import urlparse

import numpy as np

from .. import net
from .base import EngineError, PAGE_SCHEMA, b64, downscale, l2_normalize, looping, normalize_pages, parse_json_loose, reading_instructions


def _base(url: Optional[str]) -> str:
    return (url or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")


def _headers(extra: Optional[dict] = None) -> dict:
    h = dict(extra or {})
    k = os.environ.get("OPENAI_API_KEY")
    if k:
        h["Authorization"] = f"Bearer {k}"
    return h


def _is_local(url: str) -> bool:
    return net._is_local(urlparse(url).hostname)


class OpenAILLM:
    def __init__(self, model: str, base_url: Optional[str] = None, long_side: int = 1600):
        self.model = model
        self.base = _base(base_url)
        self.name = f"openai:{model}"
        self.offline = _is_local(self.base)
        self.long_side = long_side

    def _chat(self, messages: list, schema: Optional[dict], max_tokens: int, temperature: float) -> str:
        body: dict = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
        if schema:
            body["response_format"] = {"type": "json_schema", "json_schema": {"name": "answer", "schema": schema}}
        try:
            r = net.request("POST", f"{self.base}/chat/completions", headers=_headers(), body=body, timeout=600, retries=2)
        except RuntimeError as e:
            if schema and "400" in str(e):
                body["response_format"] = {"type": "json_object"}
                r = net.request("POST", f"{self.base}/chat/completions", headers=_headers(), body=body, timeout=600)
            else:
                raise
        try:
            return r["choices"][0]["message"]["content"] or ""
        except Exception as e:
            raise EngineError(f"openai: bad answer {str(r)[:200]}") from e

    def _content(self, prompt: str, images) -> list:
        parts = []
        for d, _m in images:
            small, mime = downscale(d, self.long_side, 85)
            parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64(small)}"}})
        parts.append({"type": "text", "text": prompt})
        return parts

    def json(self, system, prompt, schema, images=(), max_tokens=4096, temperature=0.2):
        msgs = [{"role": "system", "content": system}, {"role": "user", "content": self._content(prompt, images)}]
        return parse_json_loose(self._chat(msgs, schema, max_tokens, temperature))

    def read_pages(self, images, first_physical, hint="", language=None):
        out = []
        for i, img in enumerate(images):
            phys = first_physical + i
            txt = self._chat([{"role": "user", "content": self._content(reading_instructions(1, phys, hint), [img])}],
                             PAGE_SCHEMA, 6000, 0.0)
            page = normalize_pages(parse_json_loose(txt), 1, phys)[0]
            if looping(page["text"]):
                page.update({"text": "", "confidence": 0.0, "missing": True})
            out.append(page)
        return out

    def describe(self, images, language):
        return [self._chat([{"role": "user", "content": self._content(
            f"Describe this document image for a search engine in one or two sentences, in {language or 'the document language'}.",
            [img])}], None, 300, 0.0).strip() for img in images]


class OpenAIEmbedder:
    def __init__(self, model: str, dims: Optional[int] = None, base_url: Optional[str] = None):
        self.model = model
        self.base = _base(base_url)
        self.provider = urlparse(self.base).hostname or "openai"
        self.version = model
        self.dims = dims or 0
        self.truncated_from = None
        self.modalities = ["text"]
        self.task_prefixes = None
        self.offline = _is_local(self.base)

    def _embed(self, texts: list[str]) -> np.ndarray:
        out = []
        for i in range(0, len(texts), 64):
            body = {"model": self.model, "input": texts[i:i + 64]}
            if self.dims:
                body["dimensions"] = self.dims
            r = net.request("POST", f"{self.base}/embeddings", headers=_headers(), body=body, timeout=120, retries=3)
            out += [d["embedding"] for d in sorted(r["data"], key=lambda d: d["index"])]
        a = l2_normalize(np.asarray(out, dtype=np.float32))
        if not self.dims:
            self.dims = a.shape[1]
        return a

    def embed_documents(self, texts, title=None):
        return self._embed(list(texts)) if texts else np.zeros((0, self.dims), np.float32)

    def embed_query(self, text):
        return self._embed([text])[0]

    def embed_images(self, images):
        raise EngineError("this embedder is text-only")


class OpenAITranscriber:
    def __init__(self, model: str = "whisper-1", base_url: Optional[str] = None):
        self.model = model
        self.name = f"openai:{model}"
        self.base = _base(base_url)
        self.offline = _is_local(self.base)

    def transcribe(self, wav_path, language=None):
        boundary = uuid.uuid4().hex
        fields = [("model", self.model), ("response_format", "verbose_json"), ("timestamp_granularities[]", "word"),
                  ("timestamp_granularities[]", "segment")]
        if language:
            fields.append(("language", language))
        body = b""
        for k, v in fields:
            body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
        body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{os.path.basename(wav_path)}\"\r\n"
                 f"Content-Type: audio/wav\r\n\r\n").encode() + open(wav_path, "rb").read() + f"\r\n--{boundary}--\r\n".encode()
        r = net.request("POST", f"{self.base}/audio/transcriptions",
                        headers=_headers({"Content-Type": f"multipart/form-data; boundary={boundary}"}), body=body, timeout=900)
        words = [{"w": w["word"].strip(), "t0": float(w["start"]), "t1": float(w["end"])} for w in r.get("words") or []]
        segs = []
        for s in r.get("segments") or []:
            ws = [w for w in words if s["start"] - 0.01 <= w["t0"] < s["end"] + 0.01]
            segs.append({"t0": float(s["start"]), "t1": float(s["end"]), "text": s["text"].strip(), "words": ws, "speaker": None})
        if not segs and r.get("text"):
            segs = [{"t0": 0.0, "t1": float(r.get("duration") or 0), "text": r["text"], "words": words, "speaker": None}]
        return {"language": r.get("language") or language, "segments": segs, "backend": self.name}
