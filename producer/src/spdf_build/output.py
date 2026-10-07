"""Writing and validating SPDF 5.0 files.

The writer is `spdf.Writer` from `spdf-format` (python/ in this repository)
when it is installed, else the API-compatible fallback in `minispdf`. The
validator is, in this order: `spdf.validate` (spdf-format), the conformance
oracle `conformance/tools/spdfref.py` when running from the repository, or the
small `minispdf.basic_check`.
"""
from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path
from typing import Optional

from . import __version__
from .model import Built

GENERATOR = f"spdf-build/{__version__}"


def writer_class():
    try:
        spdf = importlib.import_module("spdf")
        if hasattr(spdf, "Writer"):
            return spdf.Writer, "spdf-format"
    except Exception:
        pass
    from .minispdf import Writer

    return Writer, "minispdf"


def _repo_oracle():
    here = Path(__file__).resolve()
    for parent in here.parents:
        tools = parent / "conformance" / "tools" / "spdfref.py"
        if tools.exists():
            if str(tools.parent) not in sys.path:
                sys.path.insert(0, str(tools.parent))
            try:
                return importlib.import_module("spdfref")
            except Exception:
                return None
    return None


def validate(path) -> dict:
    try:
        spdf = importlib.import_module("spdf")
        if hasattr(spdf, "validate"):
            r = spdf.validate(str(path))
            d = r.to_dict() if hasattr(r, "to_dict") else dict(r)
            d["validator"] = f"spdf-format/{getattr(spdf, '__version__', '?')}"
            return d
    except Exception as e:  # fall through to the oracle
        err = str(e)
    else:
        err = None
    ref = _repo_oracle()
    if ref is not None and hasattr(ref, "validate_file"):
        d = ref.validate_file(Path(path))
        d["validator"] = "conformance/tools/spdfref.py"
        return d
    from .minispdf import basic_check

    d = basic_check(path)
    if err:
        d["note"] = err[:200]
    return d


def _jsonable(x):
    return json.loads(json.dumps(x, default=lambda o: o.item() if hasattr(o, "item") else str(o)))


def _ref(key: Optional[str]) -> Optional[str]:
    return f"blob:{key}" if key else None


def write_spdf(b: Built, out, language: Optional[str] = None, timings: Optional[dict] = None, overwrite: bool = True) -> Path:
    Writer, which = writer_class()
    out = Path(out)
    if overwrite and out.exists():
        out.unlink()
    w = Writer(out)
    doc = b.doc_id
    src = b.source
    md = b.metadata
    authors = "; ".join((a.get("literal") or a.get("family") or a.get("given") or "") for a in md.get("author") or []) or None
    year = None
    try:
        year = int(md["issued"]["date-parts"][0][0])
    except Exception:
        pass
    created = __import__("spdf_build.pipeline", fromlist=["now"]).now()
    profile = ["core"]
    if b.vectors:
        profile.append("semantic")
    if any(u.t0 is not None for u in b.units):
        profile.append("media")
    w.set_meta("spdf_version", "5.0")
    w.set_meta("profile", " ".join(profile))
    w.set_meta("created", created)
    w.set_meta("generator", GENERATOR)
    w.set_meta("document_id", doc)
    if b.rights and b.rights.get("note"):
        w.set_meta("license_note", b.rights["note"])
    source_ref = None
    for key, (mime, data) in sorted(b.blobs.items()):
        r = w.add_blob(key, mime, data)
        if key == "source":
            source_ref = r
    if source_ref is None and (md.get("URL") and src.kind == "web"):
        source_ref = md.get("URL")
    w.add_document({
        "id": doc, "kind": src.kind, "metadata": md, "source_sha256": src.sha256, "source_ref": source_ref,
        "mime": src.mime, "bytes": len(src.data), "unit_count": len(b.units), "duration": src.duration,
        "created": created, "updated": created, "title": md.get("title"), "authors": authors, "year": year,
        "language": language or md.get("language"), "rights": b.rights,
    })
    for u in b.units:
        a = dict(u.anchor)
        w.add_unit({
            "id": f"{doc}:u{u.ord}", "document": doc, "ord": u.ord, "anchor": a, "text": u.text or "",
            "notes": u.notes or None, "header": u.header or None, "footer": u.footer or None,
            "image": _ref(u.extra.get("image_key")), "thumbnail": _ref(u.extra.get("thumb_key")),
            "reader": u.reader or "none", "confidence": round(float(u.confidence), 4),
            "printed": a.get("printed") if a.get("type") in ("page", "section", "verse") else None,
            "t0": u.t0, "t1": u.t1, "words": u.words,
        })
    for s in b.sections:
        w.add_section({"id": s.id, "document": doc, "parent": s.parent, "level": s.level, "title": s.title,
                       "unit_from": f"{doc}:u{s.unit_from}", "unit_to": f"{doc}:u{s.unit_to}" if s.unit_to else None,
                       "summary": s.summary})
    for f in b.fragments:
        w.add_fragment({"n": f.ord, "id": f.id, "document": doc, "unit": f"{doc}:u{f.unit}", "ord": f.ord, "text": f.text,
                        "context": f.context or "", "section": f.section or None, "anchor": f.anchor,
                        "anchor_end": f.anchor_end, "search_text": f.search_text or ""})
    for g in b.figures:
        w.add_figure({"id": g.id, "document": doc, "unit": f"{doc}:u{g.unit}", "image": f"blob:{g.image_key}",
                      "caption": g.caption or None, "description": g.description or None, "anchor": g.anchor})
    for sp in b.spaces:
        w.add_space(sp)
    for target, vid, space, vec in b.vectors:
        w.add_vector(target, vid, space, doc, vec)
    for p in b.provenance:
        row = {"document": doc, "stage": p.stage, "provider": p.provider, "model": p.model,
               "detail": _jsonable(p.detail if isinstance(p.detail, dict) or p.detail is None else {"value": p.detail}),
               "ms": p.ms}
        w.add_provenance(row)
    if timings:
        w.add_provenance({"document": doc, "stage": "build", "provider": GENERATOR, "model": None,
                          "detail": {"seconds": timings, "writer": which}, "ms": int(sum(timings.values()) * 1000)})
    return Path(w.finalize())
