"""The build: any input → a valid SPDF 5.0 file.

    read → (vision) → folios → language → record → structure → fragments
         → modernized layer → context → figures → vectors → write → validate

Every step records its provenance (what produced what, with which model and
how long it took). The same function runs with real engines and with the
simulated ones of the tests.
"""
from __future__ import annotations

import concurrent.futures as cf
import copy
import hashlib
import io
import mimetypes
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from . import __version__
from .engines.base import space_row
from .model import Built, Figure, FigureRead, Fragment, Provenance, Source, Unit
from .steps import context as ctx
from .steps.folios import deduce_folios, pages_from_units
from .steps.fragments import add_char_ranges, chunk, media_fragments
from .steps.metadata import build_metadata
from .steps.normalize import document_epoch, language_of, search_text
from .steps.structure import remove_running_heads, step_structure
from .text import detect_language

PAGE_KINDS = {"pdf", "scanned_pdf", "photos", "image"}


@dataclass
class Engines:
    embedder: object = None
    vision: object = None
    llm: object = None
    asr: object = None
    image_embedder: object = None  # defaults to `embedder` when it is multimodal

    def offline_ok(self) -> list[str]:
        bad = []
        for role in ("embedder", "vision", "llm", "asr"):
            e = getattr(self, role)
            if e is not None and not getattr(e, "offline", False):
                bad.append(f"{role}={getattr(e, 'name', None) or getattr(e, 'model', '?')}")
        return bad


@dataclass
class Options:
    offline: bool = False
    use_labels: bool = True
    language: Optional[str] = None
    metadata: dict = field(default_factory=dict)  # user overrides (CSL keys)
    rights: Optional[dict] = None
    context: bool = True
    figures: bool = True
    describe_figures: bool = True
    image_vectors: str = "useful"  # useful | all | none
    page_images: str = "scans"  # none | scans | all
    image_side: int = 1600
    shipped_side: int = 1200
    vision_batch: int = 4
    concurrency: int = 6
    dtype: str = "f32"
    embed_source: bool = False
    max_units: Optional[int] = None
    force_vision: bool = False
    save_reading: Optional[str] = None  # write what the readers saw (JSON) to replay later steps
    reuse_reading: Optional[str] = None  # skip the vision engine: take the pages from such a JSON
    log: Callable[[str], None] = lambda m: None


@dataclass
class Report:
    path: str
    kind: str
    units: int
    fragments: int
    figures: int
    sections: int
    vectors: int
    seconds: float
    timings: dict
    validation: Optional[dict] = None
    warnings: list = field(default_factory=list)
    network_attempts: int = 0


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Input detection
# ---------------------------------------------------------------------------

EXT_KIND = {
    ".pdf": "pdf", ".epub": "epub", ".docx": "docx", ".odt": "odt", ".pptx": "pptx", ".xlsx": "xlsx", ".csv": "csv",
    ".tsv": "csv", ".md": "markdown", ".markdown": "markdown", ".txt": "text", ".html": "html", ".htm": "html", ".xhtml": "html",
    ".jpg": "image", ".jpeg": "image", ".png": "image", ".tif": "image", ".tiff": "image", ".webp": "image", ".heic": "image",
    ".bmp": "image", ".gif": "image",
    ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".opus": "audio", ".flac": "audio", ".m4a": "audio", ".aac": "audio",
    ".mp4": "video", ".mov": "video", ".mkv": "video", ".webm": "video", ".avi": "video", ".m4v": "video",
}


def sniff(data: bytes, name: str) -> str:
    ext = Path(name).suffix.lower()
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:2] == b"PK":
        import zipfile

        try:
            z = zipfile.ZipFile(io.BytesIO(data))
            names = set(z.namelist())
            if "META-INF/container.xml" in names:
                return "epub"
            if "word/document.xml" in names:
                return "docx"
            if "ppt/presentation.xml" in names:
                return "pptx"
            if "xl/workbook.xml" in names:
                return "xlsx"
            if "content.xml" in names:
                return "odt"
        except Exception:
            pass
    return EXT_KIND.get(ext, "text")


def load(inputs: list[str], engines: Engines, opts: Options) -> Source:
    log = opts.log
    if len(inputs) == 1 and re.match(r"^https?://", inputs[0]):
        from .readers.web import fetch, read_web_html

        data, headers, final, accessed = fetch(inputs[0])
        ctype = headers.get("content-type", "")
        name = final.split("?")[0]
        kind = "html" if "html" in ctype else sniff(data, name)
        if kind == "html":
            src = read_web_html(data, final, accessed, headers)
        else:
            src = _read_file(data, name, kind, engines, opts)
            src.hints["url"] = final
            src.hints["accessed"] = accessed
        src.hints.setdefault("http_date", headers.get("date"))
        log(f"fetched {final} ({len(data)} bytes, {ctype})")
        return src
    paths = []
    for p in inputs:
        pp = Path(p)
        if pp.is_dir():
            paths += sorted(x for x in pp.iterdir() if x.suffix.lower() in EXT_KIND and EXT_KIND[x.suffix.lower()] == "image")
        else:
            paths.append(pp)
    if len(paths) > 1:
        from .readers.office import read_images

        files = [(str(p), p.read_bytes()) for p in paths]
        if not all(sniff(d, n) == "image" for n, d in files):
            raise SystemExit("several inputs are only supported for photos of pages (images)")
        return read_images(files, "photos")
    p = paths[0]
    data = p.read_bytes()
    return _read_file(data, str(p), sniff(data, str(p)), engines, opts)


def _read_file(data: bytes, path: str, kind: str, engines: Engines, opts: Options) -> Source:
    if kind == "pdf":
        from .readers.pdf import read_pdf

        return read_pdf(data, path, use_labels=opts.use_labels, force_vision=opts.force_vision)
    if kind == "epub":
        from .readers.epub import read_epub

        return read_epub(data, path)
    if kind in ("docx", "odt", "pptx", "xlsx", "csv", "markdown", "text", "html"):
        from .readers import office

        return {"docx": office.read_docx, "odt": office.read_odt, "pptx": office.read_pptx, "xlsx": office.read_xlsx,
                "csv": office.read_csv, "html": office.read_html_file,
                "markdown": lambda d, p: office.read_text(d, p, markdown=True),
                "text": lambda d, p: office.read_text(d, p, markdown=False)}[kind](data, path)
    if kind == "image":
        from .readers.office import read_images

        return read_images([(path, data)], "image")
    if kind in ("audio", "video"):
        from .readers.media import read_media

        if engines.asr is None:
            raise SystemExit("audio/video needs a transcriber (--asr)")
        return read_media(data, path, kind, engines.asr, language=opts.language, log=opts.log)
    raise SystemExit(f"unsupported input: {path}")


# ---------------------------------------------------------------------------
# Vision
# ---------------------------------------------------------------------------


def read_with_vision(src: Source, engines: Engines, opts: Options, hint: str) -> dict:
    todo = [u for u in src.units if u.needs_vision]
    stats = {"pages": len(todo), "calls": 0, "failed": 0, "seconds": 0.0, "fallback_layer": 0}
    if not todo:
        return stats
    if engines.vision is None:
        for u in todo:
            _fallback(u)
            stats["fallback_layer"] += 1
        return stats
    t0 = time.time()
    vision = engines.vision
    batch = opts.vision_batch if not getattr(vision, "offline", False) else 1
    # consecutive runs of pages, cut into batches
    batches: list[list[Unit]] = []
    for u in todo:
        if batches and len(batches[-1]) < batch and batches[-1][-1].ord == u.ord - 1:
            batches[-1].append(u)
        else:
            batches.append([u])

    def image_of(u: Unit) -> tuple[bytes, str]:
        if u.image is None and src.render:
            u.image = src.render(u.ord, opts.image_side)
            u.image_mime = "image/jpeg"
        return u.image, u.image_mime  # type: ignore[return-value]

    def run(b: list[Unit]) -> list[tuple[Unit, dict]]:
        imgs = [image_of(u) for u in b]
        try:
            pages = vision.read_pages(imgs, b[0].ord, hint, opts.language)
        except Exception as e:
            opts.log(f"vision failed on {b[0].ord}-{b[-1].ord}: {str(e)[:160]}")
            if len(b) > 1:
                out = []
                for u in b:
                    out += run([u])
                return out
            return [(b[0], {"missing": True, "error": str(e)[:200]})]
        out = []
        for u, p in zip(b, pages):
            bad = p.get("missing") or _too_short(u, p)
            if bad and len(b) > 1:
                out += run([u])
            else:
                out.append((u, p))
        return out

    workers = 1 if getattr(vision, "offline", False) else max(1, opts.concurrency)
    done = 0
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for res in ex.map(run, batches):
            stats["calls"] += 1
            for u, p in res:
                done += 1
                if p.get("missing"):
                    stats["failed"] += 1
                    _fallback(u)
                    continue
                u.text = p.get("text", "")
                u.notes = p.get("notes") or []
                u.header = p.get("header") or ""
                u.footer = p.get("footer") or ""
                u.folio_seen = p.get("folio") or None
                u.titles = p.get("titles") or []
                u.empty = bool(p.get("empty"))
                u.language = p.get("language") or None
                u.confidence = float(p.get("confidence") or 0.8)
                u.reader = getattr(vision, "model", "vision")
                u.figures = [FigureRead(caption=f.get("caption") or "", description=f.get("description") or "", region=f.get("region"))
                             for f in p.get("figures") or [] if f.get("region")]
            opts.log(f"vision: {done}/{len(todo)} pages")
    stats["seconds"] = round(time.time() - t0, 2)
    stats["seconds_per_page"] = round(stats["seconds"] / max(1, len(todo)), 2)
    return stats


def ink_ratio(image: bytes) -> float:
    """Share of «ink» pixels (darker than the local background by 40 levels) in the central 90 % of a page image.
    Blank pages of a 1737 scan measure 0.06-0.15 %, pages with text 4.6-20 %."""
    from PIL import Image, ImageFilter

    im = Image.open(io.BytesIO(image)).convert("L")
    k = 500 / max(im.size)
    if k < 1:
        im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))))
    a = np.asarray(im, dtype=np.float32)
    bg = np.asarray(im.filter(ImageFilter.MedianFilter(15)), dtype=np.float32)
    h, w = a.shape
    dark = ((bg - a) > 40)[int(h * 0.05):int(h * 0.95), int(w * 0.05):int(w * 0.95)]
    return float(dark.mean()) if dark.size else 0.0


BLANK_INK = 0.0025


def detect_blank_pages(src: Source, opts: Options) -> list[int]:
    """Pages for vision that are blank (endpapers, versos): marked empty without calling any model."""
    out = []
    for u in src.units:
        if not u.needs_vision:
            continue
        if u.image is None and src.render:
            u.image = src.render(u.ord, opts.image_side)
            u.image_mime = "image/jpeg"
        if u.image is None:
            continue
        r = ink_ratio(u.image)
        u.extra["ink"] = round(r, 5)
        if r < BLANK_INK:
            u.needs_vision = False
            u.empty, u.text, u.reader, u.confidence = True, "", "blank-page-detector", 0.95
            u.extra["blank"] = True
            out.append(u.ord)
    return out


def _too_short(u: Unit, p: dict) -> bool:
    layer = u.extra.get("ocr_layer") or ""
    return len(layer) > 600 and len((p.get("text") or "")) + sum(len(n) for n in p.get("notes") or []) < 0.3 * len(layer) \
        and not p.get("empty")


def _fallback(u: Unit) -> None:
    blocks = u.extra.get("ocr_blocks") or []
    if blocks:
        u.text = "\n\n".join(blocks)
        u.reader = "pdf-ocr-layer"
        u.confidence = 0.3
    else:
        u.reader = "none"
        u.confidence = 0.0
        u.empty = True


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def build(inputs: list[str], out: str, engines: Engines, opts: Options) -> Report:
    t_start = time.time()
    timings: dict[str, float] = {}
    prov: list[Provenance] = []
    warnings: list[str] = []
    log = opts.log

    def lap(name: str, t: float):
        timings[name] = round(time.time() - t, 3)

    t = time.time()
    src = load(inputs, engines, opts)
    if opts.max_units:
        src.units = src.units[:opts.max_units]
    lap("read", t)
    note = getattr(src, "provenance_note", {})
    prov.append(Provenance("read", provider=f"spdf-build/{src.kind}", detail={"kind": src.kind, **note}, ms=int(timings["read"] * 1000)))
    log(f"read {src.kind}: {len(src.units)} units")
    sha = src.sha256
    doc_id = f"sha256-{sha[:16]}"

    hint = src.hints.get("title") or ""
    t = time.time()
    blanks = detect_blank_pages(src, opts)
    if blanks:
        prov.append(Provenance("read", provider="spdf-build/blank-pages", detail={"pages": blanks, "threshold_ink": BLANK_INK},
                               ms=int((time.time() - t) * 1000)))
    if opts.reuse_reading:
        import json as _json

        saved = {p["ord"]: p for p in _json.loads(Path(opts.reuse_reading).read_text("utf-8"))["units"]}
        for u in src.units:
            p = saved.get(u.ord)
            if p and u.needs_vision and not u.extra.get("blank"):
                for k in ("text", "notes", "header", "footer", "folio_seen", "empty", "reader", "confidence", "language"):
                    setattr(u, k, p.get(k))
                u.titles = [tuple(x) for x in p.get("titles") or []]
                u.figures = [FigureRead(caption=f.get("caption") or "", description=f.get("description") or "", region=f.get("region"))
                             for f in p.get("figures") or []]
                u.extra["reused"] = True
        prov.append(Provenance("read", provider="spdf-build/reuse", detail={"from": Path(opts.reuse_reading).name,
                                                                            "pages": sum(1 for u in src.units if u.extra.get("reused"))}))
    vstats = read_with_vision(src, engines, opts, hint) if not opts.reuse_reading else {"pages": 0}
    if opts.save_reading:
        import json as _json

        Path(opts.save_reading).write_text(_json.dumps({"source_sha256": src.sha256, "units": [
            {"ord": u.ord, "text": u.text, "notes": u.notes, "header": u.header, "footer": u.footer, "folio_seen": u.folio_seen,
             "titles": [list(t) for t in u.titles], "figures": [{"caption": f.caption, "description": f.description, "region": f.region}
                                                                for f in u.figures if f.region],
             "empty": u.empty, "reader": u.reader, "confidence": u.confidence, "language": u.language}
            for u in src.units if u.needs_vision]}, ensure_ascii=False), "utf-8")
    lap("vision", t)
    seen = [[u.ord, u.folio_seen] for u in src.units if u.folio_seen]
    if seen:
        vstats["folio_seen"] = seen  # what the readers saw printed, before the folio deduction
    if vstats["pages"]:
        prov.append(Provenance("read", provider=getattr(engines.vision, "name", "none") if engines.vision else "none",
                               model=getattr(engines.vision, "model", None), detail=vstats, ms=int(timings["vision"] * 1000)))

    units = src.units
    # folios
    t = time.time()
    if src.kind in ("pdf", "scanned_pdf", "photos"):
        res = deduce_folios(pages_from_units(units))
        for i, u in enumerate(units):
            u.anchor = res.anchor(i)
        prov.append(Provenance("folios", provider="spdf-build/folios", detail={
            "strategy": res.strategy, "origin": res.origin, "layout": res.layout, "foliation": res.foliation,
            "transition": res.transition, "first_numbered": res.first_numbered, "anchors": res.anchors,
            "read": sum(1 for p in res.pages if p.source == "read"), "inferred": sum(1 for p in res.pages if p.source == "inferred"),
            "none": sum(1 for p in res.pages if p.source == "none"), "warnings": res.warnings[:20]}))
    elif src.kind == "image":
        for u in units:
            u.anchor = {"type": "image"}
    lap("folios", t)
    for u in units:
        if not u.anchor:
            u.anchor = {"type": "page", "physical": u.ord, "printed": None, "roman": False, "foliation": "page", "source": "none",
                        "confidence": 0.0}

    # language
    lang = opts.language or src.hints.get("language_detected")
    stat_lang = detect_language(" ".join(u.text for u in units[:80])[:80000])
    if not lang and stat_lang:
        # stop-word statistics over the whole text beat a small model's per-page guess (Gemma 4 E4B called a
        # 1737 Spanish book Latin)
        lang = stat_lang
    if not lang:
        langs = [u.language for u in units if u.language]
        if langs:
            lang = max(set(langs), key=langs.count)
    if not lang:
        lang = src.hints.get("language")
    if lang:
        lang = lang.split("_")[0] if "_" in lang else lang

    # speakers of a recording
    if src.kind in ("audio", "video") and engines.llm is not None and units:
        t = time.time()
        from .steps.speakers import name_speakers

        try:
            det = name_speakers(units, engines.llm, {k: v for k, v in src.hints.items() if k in ("title", "performer", "container")})
        except Exception as e:
            det = {"error": str(e)[:200]}
        prov.append(Provenance("speakers", provider=getattr(engines.llm, "name", "llm"), model=getattr(engines.llm, "model", None),
                               detail=det, ms=int((time.time() - t) * 1000)))
        lap("speakers", t)

    # record
    t = time.time()
    online = not opts.offline
    metadata, mevents = build_metadata(src, units, src.kind, lang, llm=engines.llm, online=online, user=opts.metadata, log=log,
                                       stat_language=stat_lang)
    lap("metadata", t)
    for e in mevents:
        prov.append(Provenance(e["stage"], provider=e.get("provider"), model=e.get("model"), detail=e.get("detail")))
    lang = metadata.get("language") or lang
    year = None
    try:
        year = int(((metadata.get("original-date") or metadata.get("issued") or {}).get("date-parts") or [[None]])[0][0])
    except Exception:
        pass

    # structure
    t = time.time()
    if src.kind in PAGE_KINDS:
        removed = remove_running_heads(units)
    else:
        removed = 0
    sections, sdet = step_structure(units, src.toc, doc_id)
    sdet["running_heads_removed"] = removed
    prov.append(Provenance("structure", provider="spdf-build/structure", detail=sdet))
    lap("structure", t)

    # fragments
    t = time.time()
    if src.kind in ("audio", "video"):
        frags = media_fragments(units, doc_id)
    else:
        frags = chunk(units, sections, doc_id)
    located = add_char_ranges(frags, units) if src.kind not in ("audio", "video") else 0
    lap("fragments", t)
    toks = sorted(f.tokens for f in frags)
    prov.append(Provenance("fragments", provider="spdf-build/chunker", detail={
        "fragments": len(frags), "tokens_median": toks[len(toks) // 2] if toks else 0, "tokens_max": toks[-1] if toks else 0,
        "cross_unit": sum(1 for f in frags if f.anchor_end), "with_chars": located}))

    # modernized layer
    t = time.time()
    epoch = document_epoch([f.text for f in frags], lang, year) if language_of(lang) != "other" else "modern"
    layered = 0
    if epoch == "old":
        for f in frags:
            f.search_text = search_text(f.text, lang, "old")
            layered += bool(f.search_text)
    prov.append(Provenance("search_text", provider="spdf-build/normalize", detail={"language": lang, "epoch": epoch,
                                                                                    "fragments_with_layer": layered, "rules": "1"}))
    lap("search_text", t)

    # context
    t = time.time()
    contexts: dict[str, str] = {}
    if engines.llm is not None and opts.context and frags:
        r = ctx.contextualize(frags, metadata, engines.llm, concurrency=opts.concurrency, log=log)
        contexts = r["contexts"]
        prov.append(Provenance("context", provider=getattr(engines.llm, "name", "llm"), model=getattr(engines.llm, "model", None),
                               detail=r["detail"], ms=int((time.time() - t) * 1000)))
    extractive = 0
    for f in frags:
        f.context = contexts.get(f.id) or ""
        if not f.context:
            f.context = ctx.extractive(f, metadata)
            extractive += 1
    if extractive:
        prov.append(Provenance("context", provider="spdf-build/extractive", detail={"fragments": extractive}))
    lap("context", t)

    # figures
    t = time.time()
    blobs: dict[str, tuple[str, bytes]] = {}
    figures: list[Figure] = []
    if opts.figures:
        figures = collect_figures(src, units, doc_id, opts, blobs)
        need = [f for f in figures if not f.description and f.image]
        if need and engines.vision is not None and opts.describe_figures and hasattr(engines.vision, "describe"):
            try:
                for i in range(0, len(need), 8):
                    descs = engines.vision.describe([(f.image, f.mime) for f in need[i:i + 8]], lang)
                    for f, d in zip(need[i:i + 8], descs):
                        f.description = (d or "").strip()
            except Exception as e:
                warnings.append(f"figure descriptions failed: {str(e)[:160]}")
        prov.append(Provenance("figures", provider=getattr(engines.vision, "name", None) if engines.vision else "spdf-build",
                               model=getattr(engines.vision, "model", None) if engines.vision else None,
                               detail={"figures": len(figures), "described": sum(1 for f in figures if f.description)}))
    lap("figures", t)

    # unit images to ship
    for u in units:
        scan = u.needs_vision or u.extra.get("blank") or u.extra.get("reused")
        ship = (opts.page_images == "all" and (u.image or src.render)) or (opts.page_images == "scans" and (scan or u.kind in ("slide", "time", "image")) and (u.image or (src.render and scan)))
        if ship:
            img = u.image or src.render(u.ord, opts.image_side)  # type: ignore[misc]
            small = _resize(img, opts.shipped_side, 65)
            key = f"u{u.ord}.jpg"
            blobs[key] = ("image/jpeg", small)
            u.extra["image_key"] = key
            thumb = _resize(img, 240, 70)
            blobs[f"u{u.ord}.thumb.jpg"] = ("image/jpeg", thumb)
            u.extra["thumb_key"] = f"u{u.ord}.thumb.jpg"

    # vectors
    t = time.time()
    spaces: list[dict] = []
    vectors: list[tuple[str, str, str, np.ndarray]] = []
    if engines.embedder is not None and frags:
        emb = engines.embedder
        row = space_row(emb, opts.dtype, now())
        title = metadata.get("title")
        texts = [(f"{f.context}\n\n{f.text}" if f.context else f.text) for f in frags]
        V = emb.embed_documents(texts, title=title)
        row = space_row(emb, opts.dtype, now())  # dims may be known only now (OpenAI)
        spaces.append(row)
        for f, v in zip(frags, V):
            vectors.append(("fragment", f.id, row["id"], v))
        if "image" in emb.modalities and opts.image_vectors != "none":
            img_units = [u for u in units if u.extra.get("image_key") and (opts.image_vectors == "all" or u.needs_vision or u.kind in ("slide", "time", "image") or u.figures)]
            ims = [blobs[u.extra["image_key"]][1] for u in img_units]
            if ims:
                IV = emb.embed_images(ims)
                for u, v in zip(img_units, IV):
                    vectors.append(("unit", f"{doc_id}:u{u.ord}", row["id"], v))
            fig_imgs = [g for g in figures if g.image]
            if fig_imgs:
                FV = emb.embed_images([g.image for g in fig_imgs])
                for g, v in zip(fig_imgs, FV):
                    vectors.append(("figure", g.id, row["id"], v))
        prov.append(Provenance("vectors", provider=emb.provider, model=emb.model, detail={
            "space": row["id"], "fragments": len(frags), "units": sum(1 for v in vectors if v[0] == "unit"),
            "figures": sum(1 for v in vectors if v[0] == "figure"), "device": getattr(emb, "device_used", None),
            "input": "context + text"}, ms=int((time.time() - t) * 1000)))
    lap("vectors", t)

    if opts.embed_source or src.hints.get("accessed"):
        # a fetched URL always ships its dated copy: the bytes as they were served on `accessed`
        blobs["source"] = (src.mime, src.data)

    built = Built(source=src, doc_id=doc_id, metadata=metadata, units=units, sections=sections, fragments=frags, figures=figures,
                  spaces=spaces, vectors=vectors, provenance=prov, blobs=blobs, rights=opts.rights, warnings=warnings)
    t = time.time()
    from .output import validate, write_spdf

    path = write_spdf(built, out, language=lang, timings=timings)
    lap("write", t)
    t = time.time()
    val = validate(path)
    lap("validate", t)
    return Report(path=str(path), kind=src.kind, units=len(units), fragments=len(frags), figures=len(figures), sections=len(sections),
                  vectors=len(vectors), seconds=round(time.time() - t_start, 2), timings=timings, validation=val,
                  warnings=warnings + src.warnings)


def _resize(data: bytes, side: int, quality: int) -> bytes:
    from PIL import Image

    im = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = im.size
    k = side / max(w, h)
    if k < 1:
        im = im.resize((max(1, int(w * k)), max(1, int(h * k))), Image.LANCZOS)
    o = io.BytesIO()
    im.save(o, "JPEG", quality=quality, optimize=True)
    return o.getvalue()


def collect_figures(src: Source, units: list[Unit], doc_id: str, opts: Options, blobs: dict) -> list[Figure]:
    from .readers.pdf import crop

    out: list[Figure] = []
    for u in units:
        for fr in u.figures:
            k = len(out) + 1
            fid = f"{doc_id}:g{k}"
            img = fr.image
            if img is None and fr.region and (u.image or src.render):
                page = u.image or src.render(u.ord, opts.image_side)  # type: ignore[misc]
                if u.image is None and u.needs_vision:
                    u.image = page
                img = crop(page, fr.region)
            anchor = copy.deepcopy(u.anchor)
            if fr.region:
                anchor["region"] = fr.region
            if img is None:
                continue
            mime = fr.mime if fr.mime and fr.mime.startswith("image/") else "image/jpeg"
            if mime not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
                mime = "image/jpeg"
            key = f"g{k}{mimetypes.guess_extension(mime) or '.jpg'}"
            blobs[key] = (mime, img)
            out.append(Figure(id=fid, unit=u.ord, image_key=key, caption=fr.caption or "", description=fr.description or "",
                              anchor=anchor, image=img, mime=mime))
    return out
