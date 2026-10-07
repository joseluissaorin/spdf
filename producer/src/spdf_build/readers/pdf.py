"""PDF reader (PyMuPDF): text layer where it is good, page images where vision is needed.

Per page: diagnosis of the text layer (Scholaris imprenta `capa-texto.ts`:
impossible characters, odd words, OCR symbols, image coverage), lines grouped
into blocks, header and footer zones (top and bottom 8 %), titles by font size
relative to the dominant body size, footnotes (smaller size at the bottom),
figures (embedded images with their region), PDF page labels and the outline.
A page whose layer is not useful is marked `needs_vision`; if most pages are,
the document is a `scanned_pdf`.
"""
from __future__ import annotations

import io
import re
import unicodedata
from collections import Counter
from typing import Optional

from ..model import FigureRead, Source, TocEntry, Unit
from ..text import join_lines

ZONE = 0.08
_VOWEL = re.compile(r"[aeiouyáéíóúàèìòùâêîôûäëïöüæœåøаеиоуыэюяёαεηιουω]", re.I)
_OCR_SYMBOLS = re.compile(r"[~\\{}|^¦¬■□▪►]")


def _odd_word(token: str) -> bool:
    t = re.sub(r"^[«»\"'“”‘’()\[\]¿?¡!.,;:—–-]+|[«»\"'“”‘’()\[\]¿?¡!.,;:—–-]+$", "", token)
    if not t:
        return False
    if re.fullmatch(r"\d+([.,:/-]\d+)*%?", t) or re.fullmatch(r"[ivxlcdm]+", t, re.I):
        return False
    if not any(c.isalpha() for c in t):
        return len(t) > 2
    if re.search(r"[^\W\d_]\d|\d[^\W\d_]", t) and not re.fullmatch(r"\d+(st|nd|rd|th|º|ª|o|a|er|e)", t, re.I):
        return True
    if re.search(r"[^\W\d_][^\w'’\-·.]+[^\W\d_]", t):
        return True
    if re.search(r"[a-zß-ÿ][A-ZÀ-Þ][a-zß-ÿ]|[A-ZÀ-Þ][a-zß-ÿ][A-ZÀ-Þ][a-zß-ÿ]?", t) and not re.match(r"^(Mc|Mac|De|Di|La|Le|O’|O')", t):
        return True
    if len(t) >= 5 and t.isalpha() and t.isascii() and not _VOWEL.search(t):
        return True
    return False


def diagnose(text: str, coverage: float) -> dict:
    chars = garbage = symbols = 0
    for c in text:
        if c in " \n\t":
            continue
        chars += 1
        cat = unicodedata.category(c)
        if cat in ("Cc", "Co", "Cn", "Cs") or c == "�":
            garbage += 1
        elif _OCR_SYMBOLS.match(c):
            symbols += 1
    tokens = text.split()
    odd = sum(1 for t in tokens if _odd_word(t))
    single = sum(1 for t in tokens if len(t) == 1 and t.isalpha() and t not in "aeoyuiAEOYUIáàéóòú")
    n = max(1, len(tokens))
    f_g = garbage / chars if chars else 0
    f_o = odd / n
    f_s = single / n
    f_sym = symbols / chars if chars else 0
    q = 1 - 4 * f_g - 2.2 * f_o - 0.8 * max(0, f_s - 0.05) - 10 * f_sym
    if chars < 40:
        q -= 0.3 * (1 - chars / 40)
    q = max(0.0, min(1.0, q))
    origin = "none" if chars == 0 else ("ocr" if coverage >= 0.85 else "digital")
    threshold = 0.9 if origin == "ocr" else 0.6
    useful = chars >= (200 if origin == "ocr" else 25) and q >= threshold
    return {"useful": useful, "quality": round(q, 3), "origin": origin, "chars": chars, "coverage": round(coverage, 3)}


def _line_text(line: dict) -> tuple[str, float]:
    spans = [s for s in line.get("spans", []) if s.get("text")]
    text = ""
    prev = None
    for s in spans:
        t = s["text"]
        if prev is not None:
            gap = s["bbox"][0] - prev["bbox"][2]
            if gap > 0.18 * min(s["size"], prev["size"]) and not text.endswith(" ") and not t.startswith(" "):
                text += " "
        text += t
        prev = s
    sizes = [s["size"] for s in spans if s["text"].strip()]
    sizes.sort()
    return re.sub(r"\s+", " ", text).strip(), (sizes[len(sizes) // 2] if sizes else 0.0)


def _xy_cut(boxes: list[dict]) -> list[dict]:
    if len(boxes) <= 1:
        return boxes

    def gaps(axis):
        iv = sorted(((b["x0"], b["x1"]) if axis == "x" else (b["y0"], b["y1"])) for b in boxes)
        out = []
        end = iv[0][1]
        for a, b in iv[1:]:
            if a > end:
                out.append((end, a))
            end = max(end, b)
        return out

    gy = max(gaps("y"), key=lambda g: g[1] - g[0], default=None)
    gx = max(gaps("x"), key=lambda g: g[1] - g[0], default=None)
    wy = gy[1] - gy[0] if gy else 0
    wx = gx[1] - gx[0] if gx else 0
    if gx and wx >= 0.015 and wy < 0.02:
        cut = (gx[0] + gx[1]) / 2
        return _xy_cut([b for b in boxes if b["x1"] <= cut]) + _xy_cut([b for b in boxes if b["x1"] > cut])
    if gy and wy > 0:
        cut = (gy[0] + gy[1]) / 2
        return _xy_cut([b for b in boxes if b["y1"] <= cut]) + _xy_cut([b for b in boxes if b["y1"] > cut])
    if gx and wx > 0:
        cut = (gx[0] + gx[1]) / 2
        return _xy_cut([b for b in boxes if b["x1"] <= cut]) + _xy_cut([b for b in boxes if b["x1"] > cut])
    return sorted(boxes, key=lambda b: (b["y0"], b["x0"]))


def _join(lines: list[str]) -> str:
    s = ""
    for l in lines:
        if not s:
            s = l
        elif re.search(r"[^\W\d_]-$", s) and l[:1].islower():
            s = s[:-1] + l
        else:
            s += " " + l
    return s


def _block_text(b: dict) -> str:
    """Lines of a block → paragraphs: a new paragraph starts at an indented line after a
    line that ends a sentence or stops short of the right margin."""
    ls = sorted(b["lines"], key=lambda l: (l["y0"], l["x0"]))
    paras: list[list[str]] = [[]]
    for k, l in enumerate(ls):
        if k > 0 and paras[-1]:
            prev = ls[k - 1]
            indented = l["x0"] > b["x0"] + 0.015
            short_prev = prev["x1"] < b["x1"] - 0.06
            if (indented and (short_prev or re.search(r"[.!?:»”\"]$", prev["text"]))) or (short_prev and l["x0"] <= b["x0"] + 0.005 and re.search(r"[.!?:»”\"]$", prev["text"]) and len(ls) > 3):
                paras.append([])
        paras[-1].append(l["text"])
    return "\n\n".join(_join(p) for p in paras if p)


def _page_lines(page) -> list[dict]:
    """Lines of the page (normalized coordinates), with segments on the same baseline merged."""
    W, H = page.rect.width, page.rect.height
    d = page.get_text("dict", flags=0)
    raw = []
    for b in d.get("blocks", []):
        if b.get("type") != 0:
            continue
        for l in b.get("lines", []):
            if l.get("dir", (1, 0))[0] < 0.9:  # rotated text (margins, stamps)
                continue
            t, size = _line_text(l)
            if not t:
                continue
            x0, y0, x1, y1 = l["bbox"]
            raw.append({"text": t, "size": size, "x0": x0 / W, "x1": x1 / W, "y0": y0 / H, "y1": y1 / H})
    raw.sort(key=lambda l: ((l["y0"] + l["y1"]) / 2, l["x0"]))
    rows: list[list[dict]] = []
    for l in raw:
        c = (l["y0"] + l["y1"]) / 2
        if rows:
            r = rows[-1]
            rc = (r[0]["y0"] + r[0]["y1"]) / 2
            if abs(c - rc) * H < 0.45 * max(l["size"], r[0]["size"], 1):
                r.append(l)
                continue
        rows.append([l])
    out = []
    for r in rows:
        r.sort(key=lambda l: l["x0"])
        cur = None
        for l in r:
            if cur and (l["x0"] - cur["x1"]) * W < 1.6 * max(l["size"], cur["size"], 1):
                cur["text"] += " " + l["text"]
                cur["x1"] = max(cur["x1"], l["x1"])
                cur["y0"], cur["y1"] = min(cur["y0"], l["y0"]), max(cur["y1"], l["y1"])
                cur["size"] = max(cur["size"], l["size"]) if len(l["text"]) > len(cur["text"]) / 2 else cur["size"]
            else:
                if cur:
                    out.append(cur)
                cur = dict(l)
        if cur:
            out.append(cur)
    return out


def running_key(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[\divxlcdm]+\b", "#", text.lower())).strip()


def _page_layer(page, lines: list[dict], running: set[str]) -> dict:
    head = [l for l in lines if l["y1"] <= ZONE + 0.005 or (l["y0"] < 0.15 and running_key(l["text"]) in running)]
    foot = [l for l in lines if l not in head and (l["y0"] >= 1 - ZONE - 0.005 or (l["y1"] > 0.85 and running_key(l["text"]) in running))]
    body = [l for l in lines if l not in head and l not in foot]

    def stuck(s, others, below):
        if running_key(s["text"]) in running:
            return False
        h = (s["y1"] - s["y0"])
        for o in others:
            gap = (s["y0"] - o["y1"]) if below else (o["y0"] - s["y1"])
            overlap = min(o["x1"], s["x1"]) - max(o["x0"], s["x0"])
            if -0.3 * h < gap < 0.8 * h and overlap > 0.3 * min(o["x1"] - o["x0"], s["x1"] - s["x0"]) and \
                    abs(o["size"] - s["size"]) < 0.15 * max(o["size"], 0.1) and (s["x1"] - s["x0"]) > 0.25:
                return True
        return False

    for s in sorted(foot, key=lambda s: s["y0"]):
        if stuck(s, body, True):
            body.append(s)
    for s in sorted(head, key=lambda s: -s["y0"]):
        if stuck(s, body, False):
            body.append(s)
    head = [l for l in head if l not in body]
    foot = [l for l in foot if l not in body]

    # blocks: consecutive lines that overlap horizontally, are close vertically, similar size
    blocks: list[dict] = []
    for s in sorted(body, key=lambda s: (s["y0"], s["x0"])):
        h = (s["y1"] - s["y0"])
        chosen = None
        for b in reversed(blocks):
            overlap = min(b["x1"], s["x1"]) - max(b["x0"], s["x0"])
            minw = min(b["x1"] - b["x0"], s["x1"] - s["x0"])
            gap = s["y0"] - b["y1"]
            ratio = max(b["size"], s["size"]) / max(0.1, min(b["size"], s["size"]))
            if overlap > 0.5 * minw and -0.6 * h < gap < 0.9 * h and ratio < 1.12:
                chosen = b
                break
        if chosen:
            chosen["lines"].append(s)
            chosen["x0"], chosen["x1"] = min(chosen["x0"], s["x0"]), max(chosen["x1"], s["x1"])
            chosen["y1"] = max(chosen["y1"], s["y1"])
            sz = sorted(l["size"] for l in chosen["lines"])
            chosen["size"] = sz[len(sz) // 2]
        else:
            blocks.append({"lines": [s], "x0": s["x0"], "x1": s["x1"], "y0": s["y0"], "y1": s["y1"], "size": s["size"]})
    ordered = _xy_cut(blocks)
    for b in ordered:
        b["text"] = _block_text(b)
    raw = page.get_text("text")
    return {"blocks": ordered, "header": head, "footer": foot, "raw": raw}


def _image_regions(page) -> tuple[float, list[dict]]:
    W, H = page.rect.width, page.rect.height
    area = W * H
    regions = []
    cover = 0.0
    try:
        infos = page.get_image_info()
    except Exception:
        infos = []
    for info in infos:
        x0, y0, x1, y1 = info["bbox"]
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
        a = max(0, x1 - x0) * max(0, y1 - y0)
        if a <= 0:
            continue
        cover = max(cover, a / area)
        regions.append({"x": x0 / W, "y": y0 / H, "w": (x1 - x0) / W, "h": (y1 - y0) / H, "area": a / area})
    return cover, regions


CAPTION = re.compile(r"^\s*(fig(?:ure|ura)?\.?|lám(?:ina)?\.?|plate|tabla|table|mapa|map|grabado|ilustraci[óo]n)\s*[\dIVXLC]*", re.I)


def read_pdf(data: bytes, path: Optional[str] = None, use_labels: bool = True, force_vision: bool = False) -> Source:
    import pymupdf as fitz

    doc = fitz.open(stream=data, filetype="pdf")
    n = doc.page_count
    has_labels = bool(use_labels and doc.get_page_labels())
    layers = []
    sizes: Counter = Counter()
    all_lines = [_page_lines(doc[i]) for i in range(n)]
    counts: Counter = Counter()
    for lines in all_lines:
        seen = set()
        for l in lines:
            if (l["y0"] < 0.15 or l["y1"] > 0.85) and len(l["text"]) <= 120:
                k = running_key(l["text"])
                if len(k) >= 3 and k not in seen:
                    seen.add(k)
                    counts[k] += 1
    running = {k for k, c in counts.items() if c >= max(3, 0.2 * n)}
    for i in range(n):
        page = doc[i]
        layer = _page_layer(page, all_lines[i], running)
        cover, regions = _image_regions(page)
        layer["coverage"], layer["regions"] = cover, regions
        layer["diag"] = diagnose(layer["raw"], cover)
        layer["label"] = page.get_label() if has_labels else None
        layers.append(layer)
        if layer["diag"]["useful"]:
            for b in layer["blocks"]:
                sizes[round(b["size"] * 2) / 2] += len(b["text"])
    base = sizes.most_common(1)[0][0] if sizes else 10.0

    units: list[Unit] = []
    for i, layer in enumerate(layers):
        diag = layer["diag"]
        u = Unit(ord=i + 1, kind="page", label=layer["label"], reader="pdf-text-layer",
                 confidence=max(0.5, min(0.98, diag["quality"])))
        u.extra["diag"] = diag
        if diag["useful"] and not force_vision:
            parts, notes, titles = [], [], []
            in_notes = False
            blocks = layer["blocks"]
            for k, b in enumerate(blocks):
                text = b["text"].strip()
                if not text:
                    continue
                short = len(text) < 140 and not re.search(r"[.;,]$", text)
                small = b["size"] > 0 and b["size"] < base * 0.88
                if in_notes or (small and b["y0"] > 0.55 and k > 0 and re.match(r"^(\d{1,3}|[*†‡§]|\[\d+\])\s?\S", text)):
                    if small or in_notes:
                        in_notes = True
                        notes.append(text)
                        continue
                if b["size"] >= base * 1.18 and short and len(text.split()) <= 16:
                    level = 1 if b["size"] >= base * 1.6 else (2 if b["size"] >= base * 1.35 else 3)
                    t = re.sub(r"\s+", " ", text)
                    titles.append((level, t))
                    parts.append(f"{'#' * level} {t}")
                    continue
                parts.append(text)
            u.text = "\n\n".join(parts)
            u.notes = notes
            u.titles = titles
            u.header = " / ".join(l["text"] for l in sorted(layer["header"], key=lambda l: (l["y0"], l["x0"])))
            u.footer = " / ".join(l["text"] for l in sorted(layer["footer"], key=lambda l: (l["y0"], l["x0"])))
            u.empty = not u.text.strip() and not notes
            # figures: embedded images that are not the page background
            for r in layer["regions"]:
                if 0.03 <= r["area"] < 0.85:
                    cap = ""
                    for b in layer["blocks"]:
                        if 0 <= b["y0"] - (r["y"] + r["h"]) < 0.08 and CAPTION.match(b["text"]):
                            cap = b["text"][:300]
                            break
                    u.figures.append(FigureRead(caption=cap, region={k: round(r[k], 4) for k in ("x", "y", "w", "h")}))
        else:
            u.needs_vision = True
            u.reader = "none"
            u.confidence = 0.0
            # keep the weak OCR layer, if any, as a fallback
            u.extra["ocr_layer"] = layer["raw"]
            u.extra["ocr_blocks"] = [b["text"] for b in layer["blocks"]]
            u.header = " / ".join(l["text"] for l in layer["header"])
            u.footer = " / ".join(l["text"] for l in layer["footer"])
        units.append(u)

    vision = sum(1 for u in units if u.needs_vision)
    kind = "scanned_pdf" if vision > n / 2 else "pdf"
    toc = []
    try:
        for lvl, title, pg in doc.get_toc(simple=True):
            if title and title.strip() and 1 <= pg <= n:
                toc.append(TocEntry(re.sub(r"\s+", " ", title).strip(), int(lvl), int(pg)))
    except Exception:
        pass
    md = doc.metadata or {}
    hints = {k: v for k, v in {"title": (md.get("title") or "").strip(), "author_raw": (md.get("author") or "").strip(),
                               "subject": (md.get("subject") or "").strip(), "keywords": (md.get("keywords") or "").strip(),
                               "pdf_creation": (md.get("creationDate") or "").strip(),
                               "producer": (md.get("producer") or "").strip()}.items() if v}

    def render(ord_: int, long_side: int = 1600) -> bytes:
        page = doc[ord_ - 1]
        z = long_side / max(page.rect.width, page.rect.height)
        pix = page.get_pixmap(matrix=fitz.Matrix(z, z), alpha=False)
        return pix.tobytes("jpeg", jpg_quality=82)

    src = Source(path=path, kind=kind, mime="application/pdf", data=data, units=units, toc=toc, hints=hints, render=render)
    src.provenance_note = {"pages": n, "text_layer": n - vision, "vision": vision, "labels": has_labels,  # type: ignore[attr-defined]
                           "body_size": base}
    return src


def crop(image: bytes, region: dict, pad: float = 0.01) -> bytes:
    from PIL import Image

    im = Image.open(io.BytesIO(image)).convert("RGB")
    W, H = im.size
    x0 = max(0, int((region["x"] - pad) * W))
    y0 = max(0, int((region["y"] - pad) * H))
    x1 = min(W, int((region["x"] + region["w"] + pad) * W))
    y1 = min(H, int((region["y"] + region["h"] + pad) * H))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return image
    out = io.BytesIO()
    im.crop((x0, y0, x1, y1)).save(out, "JPEG", quality=85)
    return out.getvalue()
