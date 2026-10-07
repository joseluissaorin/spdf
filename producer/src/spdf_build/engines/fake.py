"""Simulated engines: deterministic, instant, no models and no network.

Used by the fast tests and CI. `FakeEmbedder` hashes character trigrams into a
small normalized vector (so lexically similar texts are close, which is enough
to test search); `FakeVision` returns pages from a lookup table (or the text it
finds in a sidecar), `FakeLLM` answers from simple rules, `FakeTranscriber`
returns a fixed transcript with word timings.
"""
from __future__ import annotations

import hashlib
import io
import re
from typing import Callable, Optional

import numpy as np

from .base import l2_normalize


class FakeEmbedder:
    provider = "fake"
    version = "1"
    truncated_from = None
    task_prefixes = {"query": "q: ", "document": "d: "}
    offline = True

    def __init__(self, dims: int = 64, modalities=("text", "image")):
        self.dims = dims
        self.model = "fake-trigram"
        self.modalities = list(modalities)

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(self.dims, dtype=np.float32)
        t = re.sub(r"\s+", " ", text.lower())
        for i in range(max(1, len(t) - 2)):
            g = t[i:i + 3]
            h = int.from_bytes(hashlib.blake2b(g.encode("utf-8"), digest_size=4).digest(), "little")
            v[h % self.dims] += 1.0 if (h >> 31) & 1 else -1.0
        return l2_normalize(v) if np.any(v) else l2_normalize(np.ones(self.dims, dtype=np.float32))

    def embed_documents(self, texts, title=None):
        return np.stack([self._vec(t) for t in texts]) if texts else np.zeros((0, self.dims), np.float32)

    def embed_query(self, text):
        return self._vec(text)

    def embed_images(self, images):
        return np.stack([self._vec(hashlib.sha256(b).hexdigest()) for b in images]) if images else np.zeros((0, self.dims), np.float32)


class FakeVision:
    name = "fake-vision"
    model = "fake-vision"
    offline = True

    def __init__(self, pages: Optional[dict[int, dict]] = None, by_image: Optional[Callable[[bytes], dict]] = None):
        self.pages = pages or {}
        self.by_image = by_image
        self.calls = 0

    def read_pages(self, images, first_physical, hint="", language=None):
        self.calls += 1
        out = []
        for i, (data, _mime) in enumerate(images):
            phys = first_physical + i
            p = dict(self.pages.get(phys) or (self.by_image(data) if self.by_image else {}) or {})
            p.setdefault("text", "")
            out.append({"physical": phys, "text": p.get("text", ""), "notes": p.get("notes", []),
                        "header": p.get("header", ""), "footer": p.get("footer", ""), "folio": p.get("folio", ""),
                        "titles": p.get("titles", []), "figures": p.get("figures", []), "empty": not p.get("text"),
                        "language": p.get("language", "es"), "confidence": p.get("confidence", 0.9)})
        return out

    def describe(self, images, language):
        return [f"Imagen de {len(b)} bytes." if (language or "").startswith("es") else f"Image of {len(b)} bytes."
                for b, _ in images]


class FakeLLM:
    name = "fake-llm"
    model = "fake-llm"
    offline = True

    def __init__(self, record: Optional[dict] = None):
        self.record = record or {}
        self.calls = 0

    def json(self, system, prompt, schema, images=(), max_tokens=4096, temperature=0.2):
        self.calls += 1
        props = (schema or {}).get("properties", {})
        if "contexts" in props:
            n = len(re.findall(r"<fragment n=", prompt))
            return {"contexts": [{"n": i + 1, "context": f"Fragmento {i + 1} del grupo."} for i in range(n)]}
        if "speakers" in props:
            return {"speakers": []}
        if "single_speaker" in props:
            return {"single_speaker": False, "speaker": "", "evidence": ""}
        if "title" in props:
            return dict(self.record)
        return {}


class FakeTranscriber:
    name = "fake-asr"
    model = "fake-asr"
    offline = True

    def __init__(self, text: str = "Hola. Esto es una prueba de transcripción con tiempos por palabra.", speakers=None):
        self.text = text
        self.speakers = speakers

    def transcribe(self, wav_path, language=None):
        words = self.text.split()
        segs = []
        t = 0.0
        seg_words = []
        for i, w in enumerate(words):
            seg_words.append({"w": w, "t0": round(t, 2), "t1": round(t + 0.4, 2)})
            t += 0.5
            if w.endswith((".", "?", "!")) or i == len(words) - 1:
                spk = None
                if self.speakers:
                    spk = self.speakers[len(segs) % len(self.speakers)]
                segs.append({"t0": seg_words[0]["t0"], "t1": seg_words[-1]["t1"], "text": " ".join(x["w"] for x in seg_words),
                             "words": seg_words, "speaker": spk})
                seg_words = []
        return {"language": language or "es", "segments": segs}


def fake_page_image(text: str, size=(600, 800)) -> bytes:
    """A blank page image that carries `text` in its PNG metadata (for FakeVision.by_image)."""
    from PIL import Image, PngImagePlugin

    im = Image.new("RGB", size, (250, 248, 240))
    meta = PngImagePlugin.PngInfo()
    meta.add_text("fake-page", text)
    out = io.BytesIO()
    im.save(out, "PNG", pnginfo=meta)
    return out.getvalue()


def text_from_fake_image(data: bytes) -> dict:
    import json

    from PIL import Image

    try:
        im = Image.open(io.BytesIO(data))
        raw = im.info.get("fake-page") or im.text.get("fake-page")  # type: ignore[attr-defined]
        return json.loads(raw) if raw else {}
    except Exception:
        return {}
