"""Gemini engines (bring your own key: `GEMINI_API_KEY`).

- LLM and Vision: a flash model (`gemini-flash-latest` by default) through
  `generateContent` with `responseJsonSchema`.
- Transcriber: the same model with the audio (inline up to ~14 MB, Files API
  above). Gemini gives segments with speakers and times; word times inside a
  segment are interpolated by character length and the provenance says so.
- Embedder: `gemini-embedding-2` with `outputDimensionality` (Matryoshka) and
  task types RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY; images through the same model.
"""
from __future__ import annotations

import mimetypes
import os
import re
import time
from typing import Optional

import numpy as np

from .. import net
from .base import EngineError, PAGE_SCHEMA, b64, downscale, l2_normalize, looping, normalize_pages, parse_json_loose, reading_instructions

API = "https://generativelanguage.googleapis.com/v1beta"


def _key() -> str:
    k = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not k:
        raise EngineError("GEMINI_API_KEY is not set")
    return k


class GeminiLLM:
    offline = False

    def __init__(self, model: str = "gemini-flash-latest", long_side: int = 1600):
        self.model = model
        self.name = f"gemini:{model}"
        self.long_side = long_side
        self.versions: set[str] = set()
        self.usage = {"calls": 0, "prompt_tokens": 0, "output_tokens": 0}
        # Reading and cataloguing do not need the model to think aloud: ~3x faster, same transcription.
        th = os.environ.get("SPDF_GEMINI_THINKING", "0")
        self.thinking = None if th in ("", "default") else int(th)

    def _generate(self, parts: list[dict], system: Optional[str], schema: Optional[dict], max_tokens: int,
                  temperature: float, timeout: float = 240) -> str:
        body: dict = {"contents": [{"role": "user", "parts": parts}],
                      "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}}
        if self.thinking is not None:
            body["generationConfig"]["thinkingConfig"] = {"thinkingBudget": self.thinking}
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        if schema:
            body["generationConfig"]["responseMimeType"] = "application/json"
            body["generationConfig"]["responseJsonSchema"] = schema
        try:
            r = net.request("POST", f"{API}/models/{self.model}:generateContent", headers={"x-goog-api-key": _key()}, body=body,
                            timeout=timeout, retries=3)
        except RuntimeError as e:
            if "thinking" in str(e).lower() and "thinkingConfig" in body["generationConfig"]:
                self.thinking = None
                body["generationConfig"].pop("thinkingConfig")
                r = net.request("POST", f"{API}/models/{self.model}:generateContent", headers={"x-goog-api-key": _key()}, body=body,
                                timeout=timeout, retries=3)
            else:
                raise
        self.usage["calls"] += 1
        um = r.get("usageMetadata") or {}
        self.usage["prompt_tokens"] += int(um.get("promptTokenCount") or 0)
        self.usage["output_tokens"] += int(um.get("candidatesTokenCount") or 0)
        if r.get("modelVersion"):
            self.versions.add(r["modelVersion"])
        cands = r.get("candidates") or []
        if not cands:
            raise EngineError(f"gemini: no candidates ({(r.get('promptFeedback') or {}).get('blockReason')})")
        c = cands[0]
        text = "".join(p.get("text", "") for p in (c.get("content") or {}).get("parts", []) if not p.get("thought"))
        if not text:
            raise EngineError(f"gemini: empty answer ({c.get('finishReason')})")
        return text

    def _img(self, data: bytes, mime: str) -> dict:
        small, m = downscale(data, self.long_side, 85)
        return {"inlineData": {"mimeType": m, "data": b64(small)}}

    def json(self, system, prompt, schema, images=(), max_tokens=8192, temperature=0.2):
        parts = [self._img(d, m) for d, m in images] + [{"text": prompt}]
        return parse_json_loose(self._generate(parts, system, schema, max_tokens, temperature))

    def read_pages(self, images, first_physical, hint="", language=None):
        n = len(images)
        parts = [self._img(d, m) for d, m in images] + [{"text": reading_instructions(n, first_physical, hint)}]
        txt = self._generate(parts, None, PAGE_SCHEMA, max_tokens=min(65536, 6000 * n), temperature=0.0)
        pages = normalize_pages(parse_json_loose(txt), n, first_physical)
        for p in pages:
            if looping(p["text"]):
                p.update({"text": "", "confidence": 0.0, "missing": True})
        return pages

    def describe(self, images, language):
        if not images:
            return []
        schema = {"type": "object", "properties": {"descriptions": {"type": "array", "items": {"type": "string"}}},
                  "required": ["descriptions"]}
        lang = language or "the language of the document"
        r = self.json("You describe images from documents and videos for a search engine: what is shown, relevant legible "
                      "text (formulas, labels, slide titles), kind (diagram, table, photo, engraving, map). One or two "
                      f"sentences per image, no preamble. Language: {lang}.",
                      f"Describe each of the {len(images)} images, in order.", schema, images, max_tokens=4096)
        d = list(r.get("descriptions") or [])
        return (d + [""] * len(images))[:len(images)]


class GeminiTranscriber:
    offline = False

    def __init__(self, model: str = "gemini-flash-latest"):
        self.model = model
        self.name = f"gemini:{model}"
        self.llm = GeminiLLM(model)

    def _upload(self, path: str, mime: str) -> str:
        data = open(path, "rb").read()
        start = net.request("POST", "https://generativelanguage.googleapis.com/upload/v1beta/files",
                            headers={"x-goog-api-key": _key(), "X-Goog-Upload-Protocol": "resumable",
                                     "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": str(len(data)),
                                     "X-Goog-Upload-Header-Content-Type": mime},
                            body={"file": {"display_name": os.path.basename(path)}}, raw=True)
        url = {k.lower(): v for k, v in start[1].items()}.get("x-goog-upload-url")
        if not url:
            raise EngineError("gemini: no upload URL")
        payload, _, _ = net.request("POST", url, headers={"X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize",
                                                          "Content-Length": str(len(data))}, body=data, raw=True, timeout=600)
        import json as _json

        f = _json.loads(payload)["file"]
        for _ in range(60):
            if f.get("state") in (None, "ACTIVE"):
                break
            time.sleep(2)
            f = net.request("GET", f"{API}/{f['name']}", headers={"x-goog-api-key": _key()})
        return f["uri"]

    def transcribe(self, wav_path, language=None):
        mime = mimetypes.guess_type(wav_path)[0] or "audio/wav"
        size = os.path.getsize(wav_path)
        part = ({"inlineData": {"mimeType": mime, "data": b64(open(wav_path, "rb").read())}} if size < 14_000_000 else
                {"fileData": {"mimeType": mime, "fileUri": self._upload(wav_path, mime)}})
        schema = {"type": "object", "properties": {
            "language": {"type": "string"},
            "segments": {"type": "array", "items": {"type": "object", "properties": {
                "start": {"type": "string"}, "end": {"type": "string"}, "speaker": {"type": "string"}, "text": {"type": "string"}},
                "required": ["start", "end", "speaker", "text"]}}}, "required": ["language", "segments"]}
        prompt = ("Transcribe this recording verbatim, in its original language, with no summarizing or translating. Split it into "
                  "segments of one or two sentences, each with start and end time as MM:SS.s (or H:MM:SS.s), and a speaker "
                  "label: the person's name if it is said in the recording or obvious, else «Speaker 1», «Speaker 2»… "
                  "consistently. language = BCP-47 code.")
        r = parse_json_loose(self.llm._generate([part, {"text": prompt}], None, schema, 65536, 0.0, timeout=900))
        segs = []
        for s in r.get("segments") or []:
            t0, t1 = _clock(s.get("start")), _clock(s.get("end"))
            text = str(s.get("text") or "").strip()
            if t0 is None or not text:
                continue
            t1 = t1 if t1 is not None and t1 > t0 else t0 + max(1.0, len(text) / 15)
            segs.append({"t0": t0, "t1": t1, "text": text, "speaker": (s.get("speaker") or None),
                         "words": _interpolate_words(text, t0, t1)})
        return {"language": r.get("language") or language, "segments": segs, "backend": self.name,
                "word_timing": "interpolated"}


def _clock(s) -> Optional[float]:
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    m = re.fullmatch(r"\s*(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*", str(s))
    if not m:
        try:
            return float(s)
        except Exception:
            return None
    h = int(m.group(1) or 0)
    return h * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def _interpolate_words(text: str, t0: float, t1: float) -> list[dict]:
    words = text.split()
    total = sum(len(w) + 1 for w in words) or 1
    out, t = [], t0
    for w in words:
        d = (t1 - t0) * (len(w) + 1) / total
        out.append({"w": w, "t0": round(t, 3), "t1": round(t + d * 0.9, 3)})
        t += d
    return out


class GeminiEmbedder:
    provider = "google"
    offline = False

    def __init__(self, model: str = "gemini-embedding-2", dims: int = 768, images: bool = True):
        self.model = model
        self.version = model
        self.dims = dims
        self.truncated_from = None if dims >= 3072 else 3072
        self.modalities = ["text", "image"] if images else ["text"]
        self.task_prefixes = {"query": "taskType=RETRIEVAL_QUERY", "document": "taskType=RETRIEVAL_DOCUMENT; title={title}"}

    def _batch(self, contents: list[dict], task: str, title: Optional[str] = None) -> np.ndarray:
        out = []
        for i in range(0, len(contents), 100):
            reqs = []
            for c in contents[i:i + 100]:
                rq = {"model": f"models/{self.model}", "content": c, "taskType": task, "outputDimensionality": self.dims}
                if title and task == "RETRIEVAL_DOCUMENT":
                    rq["title"] = title
                reqs.append(rq)
            r = net.request("POST", f"{API}/models/{self.model}:batchEmbedContents", headers={"x-goog-api-key": _key()},
                            body={"requests": reqs}, timeout=120, retries=4)
            out += [e["values"] for e in r["embeddings"]]
        return l2_normalize(np.asarray(out, dtype=np.float32))

    def embed_documents(self, texts, title=None):
        if not texts:
            return np.zeros((0, self.dims), np.float32)
        return self._batch([{"parts": [{"text": t}]} for t in texts], "RETRIEVAL_DOCUMENT", title)

    def embed_query(self, text):
        return self._batch([{"parts": [{"text": text}]}], "RETRIEVAL_QUERY")[0]

    def embed_images(self, images):
        if not images:
            return np.zeros((0, self.dims), np.float32)
        parts = []
        for d in images:
            small, m = downscale(d, 1024, 85)
            parts.append({"parts": [{"inlineData": {"mimeType": m, "data": b64(small)}}]})
        return self._batch(parts, "RETRIEVAL_DOCUMENT")
