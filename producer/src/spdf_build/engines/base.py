"""Engine interfaces. Four roles, each interchangeable:

- `Embedder`: vectors for fragments (text) and, if multimodal, for unit images.
- `Vision`: reads page images (transcription with header, footer, folio, notes,
  titles and figures) and describes figures.
- `LLM`: structured generation (JSON) for the bibliographic record, context lines
  and speaker naming.
- `Transcriber`: speech to text with word timings (and speakers when it can).

Engines declare `offline = True` when they never touch the network; `--offline`
refuses the others before anything runs.
"""
from __future__ import annotations

import base64
import io
import json
import re
from typing import Any, Optional, Protocol

import numpy as np


class EngineError(RuntimeError):
    pass


class Embedder(Protocol):
    provider: str
    model: str
    version: Optional[str]
    dims: int
    truncated_from: Optional[int]
    modalities: list[str]
    task_prefixes: Optional[dict]
    offline: bool

    def embed_documents(self, texts: list[str], title: Optional[str] = None) -> np.ndarray: ...
    def embed_query(self, text: str) -> np.ndarray: ...
    def embed_images(self, images: list[bytes]) -> np.ndarray: ...


class Vision(Protocol):
    name: str
    model: str
    offline: bool

    def read_pages(self, images: list[tuple[bytes, str]], first_physical: int, hint: str = "",
                   language: Optional[str] = None) -> list[dict]: ...

    def describe(self, images: list[tuple[bytes, str]], language: Optional[str]) -> list[str]: ...


class LLM(Protocol):
    name: str
    model: str
    offline: bool

    def json(self, system: str, prompt: str, schema: dict, images: list[tuple[bytes, str]] = (),
             max_tokens: int = 4096, temperature: float = 0.2) -> dict: ...


class Transcriber(Protocol):
    name: str
    model: str
    offline: bool

    def transcribe(self, wav_path: str, language: Optional[str] = None) -> dict: ...


def space_id(e: Embedder, dtype: str = "f32") -> str:
    base = f"{e.model}@{e.dims}"
    return base if dtype == "f32" else f"{base}:{dtype}"


def space_row(e: Embedder, dtype: str = "f32", created: Optional[str] = None) -> dict:
    return {
        "id": space_id(e, dtype), "provider": e.provider, "model": e.model, "version": e.version, "dims": e.dims,
        "dtype": dtype, "normalized": 1, "truncated_from": e.truncated_from, "modalities": list(e.modalities),
        "task_prefixes": e.task_prefixes, "created": created,
    }


def l2_normalize(a: np.ndarray) -> np.ndarray:
    a = np.asarray(a, dtype=np.float32)
    if a.ndim == 1:
        n = np.linalg.norm(a)
        return a / n if n > 0 else a
    n = np.linalg.norm(a, axis=1, keepdims=True)
    n[n == 0] = 1
    return a / n


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def parse_json_loose(text: str) -> Any:
    """Parse model output that should be JSON (strips fences and trailing prose)."""
    t = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    start = min([i for i in (t.find("{"), t.find("[")) if i >= 0], default=-1)
    if start < 0:
        raise EngineError(f"no JSON in model output: {t[:200]!r}")
    for end in range(len(t), start, -1):
        if t[end - 1] in "}]":
            try:
                return json.loads(t[start:end])
            except Exception:
                continue
    raise EngineError(f"unparseable JSON in model output: {t[:200]!r}")


def downscale(data: bytes, long_side: int = 1600, quality: int = 85) -> tuple[bytes, str]:
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    im = im.convert("RGB")
    w, h = im.size
    k = long_side / max(w, h)
    if k < 1:
        im = im.resize((max(1, int(w * k)), max(1, int(h * k))), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "JPEG", quality=quality)
    return out.getvalue(), "image/jpeg"


# ---------------------------------------------------------------------------
# Shared prompts (from Scholaris `packages/proveedores/src/lectura.ts`)
# ---------------------------------------------------------------------------

PAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "pages": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "physical": {"type": "integer"},
                    "empty": {"type": "boolean"},
                    "header": {"type": "string"},
                    "folio": {"type": "string"},
                    "titles": {"type": "array", "items": {"type": "object", "properties": {
                        "level": {"type": "integer"}, "text": {"type": "string"}}, "required": ["level", "text"]}},
                    "text": {"type": "string"},
                    "notes": {"type": "array", "items": {"type": "string"}},
                    "footer": {"type": "string"},
                    "figures": {"type": "array", "items": {"type": "object", "properties": {
                        "caption": {"type": "string"}, "description": {"type": "string"},
                        "region": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"},
                                                                    "w": {"type": "number"}, "h": {"type": "number"}},
                                   "required": ["x", "y", "w", "h"]}},
                        "required": ["caption", "description", "region"]}},
                    "language": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["physical", "empty", "header", "folio", "titles", "text", "notes", "footer", "figures",
                             "language", "confidence"],
            },
        }
    },
    "required": ["pages"],
}


def reading_instructions(n: int, first: int, hint: str = "", figures: bool = True) -> str:
    # The physical page number is NOT given to the model: it biases the folio it reports
    # (Gemma 4 read «Pag. 9» on physical page 9 whose printed folio is 1). Pages are numbered 1..n.
    first = 1
    last = n
    lines = [
        f"You are an expert palaeographer and typographer. Transcribe {'the page' if n == 1 else f'the {n} pages'} "
        f"in these images, in the order they arrive.",
        f"Return exactly {n} object{'s' if n > 1 else ''} in \"pages\", one per image, in order, with \"physical\" = "
        f"{'1' if n == 1 else f'1 to {last}'} (the position of the image in this request, not a page number).",
        f"Document context: {hint}" if hint else "",
        "",
        "Transcription rules:",
        "1. Absolute fidelity. Copy exactly what is printed: do NOT modernize spelling (keep «dixo», «assi», «muger», "
        "«Cauallero», «dirè», u/v, i/j/y, ç, accents as they appear), do NOT fix typos, do NOT translate, summarize, invent "
        "or complete illegible text: mark it «[…]».",
        "2. The long s (ſ) is written «s»; look at the stroke so you do not confuse it with «f» (ſobre → «sobre», not "
        "«fobre»). Typographic ligatures (ﬁ, ﬂ) are written with their letters; abbreviations stay as they are.",
        "3. \"text\" is ONLY the body of the page, in light Markdown: titles with # by level, *italics* and **bold** only "
        "where printed so. In prose join lines into paragraphs (blank line between paragraphs) and rejoin words "
        "hyphenated at line end. In verse, one verse per line. In drama, the speaker name as printed at the start of "
        "the speech.",
        "4. Outside the body: \"header\" = running head (without the page number); \"footer\" = footer, catchword and "
        "printer's signature (e.g. «A2»); \"notes\" = each footnote as one item, with its call («1», «*») first. In the "
        "body leave the note call in place as [^1].",
        "5. \"folio\" = the page number PRINTED as seen («23», «xiv», «A-3»), or \"\" if the page has none. Never deduce "
        "or compute it: only what is written. The printer's signature is not the folio.",
        "6. \"titles\" = section titles that START on this page, with level (1 = part or chapter, 2 = section…).",
        "7. \"figures\" = illustrations, engravings, charts, diagrams or tables that are images: caption as printed (or "
        "\"\"), a short description IN THE LANGUAGE OF THE DOCUMENT, and region normalized 0-1 (x, y from top-left, w, "
        "h). Typographic ornaments, vignettes and drop caps are not figures." if figures else "7. \"figures\" = [].",
        "8. \"empty\" = true if the page has no text (blank, endpaper, plate without text).",
        "9. \"language\" = BCP-47 code of the body («es», «la», «en»…). \"confidence\" = 0-1, how sure you are of "
        "your transcription of that page.",
        "Answer with JSON only.",
    ]
    return "\n".join(l for l in lines if l != "")


def normalize_region(r: Optional[dict]) -> Optional[dict]:
    if not isinstance(r, dict):
        return None
    try:
        vals = [float(r[k]) for k in ("x", "y", "w", "h")]
    except Exception:
        return None
    scale = 1000.0 if max(vals) > 1.5 else 1.0
    x, y, w, h = (min(1.0, max(0.0, v / scale)) for v in vals)
    if w <= 0 or h <= 0:
        return None
    return {"x": round(x, 4), "y": round(y, 4), "w": round(min(w, 1 - x), 4), "h": round(min(h, 1 - y), 4)}


def _fix(s: Any) -> str:
    t = s if isinstance(s, str) else ("" if s is None else str(s))
    t = re.sub(r"\r\n?", "\n", t)
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    for a, b in (("ﬁ", "fi"), ("ﬂ", "fl"), ("ﬀ", "ff"), ("ﬃ", "ffi"), ("ﬄ", "ffl"), ("ſ", "s")):
        t = t.replace(a, b)
    return t


def normalize_pages(obj: Any, n: int, first: int) -> list[dict]:
    """Exactly `n` pages with absolute `physical`; missing ones get confidence 0."""
    lst = obj if isinstance(obj, list) else (obj.get("pages") or obj.get("paginas") or []) if isinstance(obj, dict) else []
    nums = []
    for p in lst:
        try:
            nums.append(int(p.get("physical", p.get("fisica"))))
        except Exception:
            nums.append(None)
    absolute = all(isinstance(x, int) and first <= x < first + n for x in nums) and nums
    relative = not absolute and all(isinstance(x, int) and 1 <= x <= n for x in nums) and nums
    by_idx: dict[int, dict] = {}
    for i, p in enumerate(lst):
        if not isinstance(p, dict):
            continue
        idx = nums[i] - first if absolute else (nums[i] - 1 if relative else i)
        if 0 <= idx < n and idx not in by_idx:
            by_idx[idx] = p
    out = []
    for i in range(n):
        c = by_idx.get(i)
        if not c:
            out.append({"physical": first + i, "text": "", "notes": [], "header": "", "footer": "", "folio": "",
                        "titles": [], "figures": [], "empty": False, "language": "", "confidence": 0.0, "missing": True})
            continue
        text = _fix(c.get("text"))
        titles = []
        for t in c.get("titles") or []:
            if isinstance(t, dict) and _fix(t.get("text")):
                try:
                    lvl = int(t.get("level") or 1)
                except Exception:
                    lvl = 1
                titles.append((min(6, max(1, lvl)), re.sub(r"^#+\s*", "", _fix(t.get("text")))))
        figs = []
        for f in c.get("figures") or []:
            if not isinstance(f, dict):
                continue
            figs.append({"caption": _fix(f.get("caption")), "description": str(f.get("description") or "").strip(),
                         "region": normalize_region(f.get("region"))})
        conf = c.get("confidence")
        folio = re.sub(r"^[\[(]|[\])]$", "", _fix(c.get("folio"))).strip()
        out.append({
            "physical": first + i, "text": text,
            "notes": [x for x in (_fix(n_) for n_ in (c.get("notes") or [])) if x],
            "header": _fix(c.get("header")), "footer": _fix(c.get("footer")), "folio": folio,
            "titles": titles, "figures": figs,
            "empty": c.get("empty") is True and len(text) < 40,
            "language": str(c.get("language") or "").strip(),
            "confidence": min(1.0, max(0.0, float(conf))) if isinstance(conf, (int, float)) else 0.8,
        })
    return out


def looping(text: str) -> bool:
    """The model entered a loop (same line or chunk repeated many times)."""
    lines = [l.strip() for l in (text or "").split("\n") if len(l.strip()) > 3]
    from collections import Counter

    for l, n in Counter(lines).items():
        if n >= 8 and len(l) > 8 and n > len(lines) * 0.3:
            return True
    return bool(re.search(r"(.{20,}?)\1{6,}", (text or "")[:20000], re.S))
