"""IIIF Presentation API 3.0 manifest export.

* Paged documents: one Canvas per unit, painted with the unit image (``units.image``)
  and with a ``supplementing`` TextualBody annotation carrying the unit text
  (the transcription). Figures become ``describing`` annotations on their region.
* Audio and video: one Canvas with the document ``duration``, painted with the
  original (when ``source_ref`` is resolvable) and one ``supplementing`` annotation
  per unit targeting ``#t=<t0>,<t1>``.
* Sections become nested ``Range`` structures.

Images and the original are referenced by URL: ``blob:<key>`` references resolve to
``{base_url}/blobs/<key>`` unless ``resolve`` is given (``spdf export --format iiif
--images-dir`` also writes the blobs there). Each annotation links back to its SPDF
anchor URI in ``seeAlso``.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from ..cite import locator_label
from .images import image_size

if TYPE_CHECKING:
    from ..model import Unit
    from ..reader import SpdfFile

__all__ = ["LICENSE_URIS", "rights_uri", "to_iiif"]

CONTEXT = "http://iiif.io/api/presentation/3/context.json"

LICENSE_URIS: dict[str, str] = {
    "CC0-1.0": "http://creativecommons.org/publicdomain/zero/1.0/",
    "PDM": "http://creativecommons.org/publicdomain/mark/1.0/",
    "CC-PDM-1.0": "http://creativecommons.org/publicdomain/mark/1.0/",
    "CC-BY-4.0": "http://creativecommons.org/licenses/by/4.0/",
    "CC-BY-SA-4.0": "http://creativecommons.org/licenses/by-sa/4.0/",
    "CC-BY-NC-4.0": "http://creativecommons.org/licenses/by-nc/4.0/",
    "CC-BY-NC-SA-4.0": "http://creativecommons.org/licenses/by-nc-sa/4.0/",
    "CC-BY-ND-4.0": "http://creativecommons.org/licenses/by-nd/4.0/",
    "CC-BY-NC-ND-4.0": "http://creativecommons.org/licenses/by-nc-nd/4.0/",
}

DEFAULT_SIZE = (1000, 1414)  # nominal A-series proportions when no page image is shipped


def rights_uri(rights: dict[str, Any] | None) -> str | None:
    """A IIIF ``rights`` URI (Creative Commons or RightsStatements.org) for ``documents.rights``."""
    if not rights:
        return None
    lic = rights.get("license")
    if not isinstance(lic, str) or not lic:
        return None
    if lic.startswith(("http://creativecommons.org/", "http://rightsstatements.org/")):
        return lic
    if lic.startswith(("https://creativecommons.org/", "https://rightsstatements.org/")):
        return "http://" + lic[len("https://") :]
    return LICENSE_URIS.get(lic)


def _lang(f: SpdfFile) -> str:
    lang = f.document.language or f.document.metadata.get("language")
    return lang if isinstance(lang, str) and lang else "none"


def to_iiif(
    f: SpdfFile,
    base_url: str,
    *,
    resolve: Callable[[str], str | None] | None = None,
    locale: str = "es",
) -> dict[str, Any]:
    """Build a IIIF Presentation 3 manifest (a JSON-ready dict) for an open SPDF file.

    ``base_url`` is where the manifest will live (``{base_url}/manifest.json``).
    ``resolve`` maps a reference (``blob:<key>`` or URL) to a public URL.
    """
    base = base_url.rstrip("/")
    doc = f.document
    lang = _lang(f)

    def url_of(ref: str | None) -> str | None:
        if not ref:
            return None
        if resolve is not None:
            return resolve(ref)
        if ref.startswith("blob:"):
            return f"{base}/blobs/{quote(ref[5:], safe='/')}"
        if ref.startswith(("http://", "https://")):
            return ref
        return None

    meta = doc.metadata
    manifest: dict[str, Any] = {
        "@context": CONTEXT,
        "id": f"{base}/manifest.json",
        "type": "Manifest",
        "label": {lang: [doc.display_title]},
    }
    md: list[dict[str, Any]] = []

    def add_md(label_en: str, value: Any) -> None:
        if value:
            md.append({"label": {"en": [label_en]}, "value": {"none": [str(value)]}})

    add_md("Author", doc.authors)
    add_md("Date", doc.year)
    add_md("Publisher", meta.get("publisher"))
    add_md("Place", meta.get("publisher-place"))
    add_md("Language", doc.language)
    add_md("SPDF", f"spdf:{f.docref}")
    if md:
        manifest["metadata"] = md
    if isinstance(meta.get("abstract"), str):
        manifest["summary"] = {lang: [meta["abstract"]]}
    r_uri = rights_uri(doc.rights)
    if r_uri:
        manifest["rights"] = r_uri
    if doc.rights and doc.rights.get("holder"):
        manifest["requiredStatement"] = {
            "label": {"en": ["Rights holder"]},
            "value": {"none": [str(doc.rights["holder"])]},
        }
    if isinstance(meta.get("URL"), str):
        manifest["homepage"] = [
            {"id": meta["URL"], "type": "Text", "label": {lang: [doc.display_title]}, "format": "text/html"}
        ]
    manifest["seeAlso"] = [
        {
            "id": f"{base}/document.spdf",
            "type": "Dataset",
            "format": "application/vnd.spdf",
            "label": {"en": ["SPDF 5.0 source"]},
        }
    ]
    manifest["provider"] = [
        {"id": f"{base}/#provider", "type": "Agent", "label": {"en": ["Exported with spdf-format"]}}
    ]

    units = f.units()
    canvases: list[dict[str, Any]] = []
    canvas_of: dict[str, str] = {}
    figures_by_unit: dict[str, list[Any]] = {}
    for g in f.figures():
        figures_by_unit.setdefault(g.unit, []).append(g)

    if doc.kind in ("audio", "video"):
        cid = f"{base}/canvas/1"
        duration = doc.duration or max((u.t1 or 0.0 for u in units), default=0.0) or 1.0
        canvas: dict[str, Any] = {
            "id": cid,
            "type": "Canvas",
            "label": {lang: [doc.display_title]},
            "duration": duration,
        }
        media = url_of(doc.source_ref)
        if media:
            body_type = "Sound" if doc.kind == "audio" else "Video"
            canvas["items"] = [
                {
                    "id": f"{cid}/page/1",
                    "type": "AnnotationPage",
                    "items": [
                        {
                            "id": f"{cid}/page/1/a1",
                            "type": "Annotation",
                            "motivation": "painting",
                            "body": {
                                "id": media,
                                "type": body_type,
                                "format": doc.mime,
                                "duration": duration,
                            },
                            "target": cid,
                        }
                    ],
                }
            ]
        else:
            canvas["items"] = []
        annos = []
        for u in units:
            canvas_of[u.id] = cid
            if not u.text.strip():
                continue
            t0 = u.t0 if u.t0 is not None else u.anchor.t0
            t1 = u.t1 if u.t1 is not None else u.anchor.t1
            target = cid if t0 is None else f"{cid}#t={_n(t0)},{_n(t1 if t1 is not None else t0)}"
            annos.append(_text_anno(f, u, f"{cid}/annotations/{u.ord}", target, lang))
        if annos:
            canvas["annotations"] = [{"id": f"{cid}/annotations", "type": "AnnotationPage", "items": annos}]
        canvases.append(canvas)
    else:
        for u in units:
            cid = f"{base}/canvas/{u.ord}"
            canvas_of[u.id] = cid
            label = _canvas_label(u, locale)
            img_url = url_of(u.image)
            size = None
            mime = None
            if u.image and u.image.startswith("blob:"):
                data = f.blob(u.image)
                size = image_size(data) if data else None
                mime = f.blob_mime(u.image)
            w, h = size or DEFAULT_SIZE
            canvas = {"id": cid, "type": "Canvas"}
            if label is not None:
                canvas["label"] = {"none": [label]}
            canvas.update({"width": w, "height": h})
            page_items = []
            if img_url:
                body: dict[str, Any] = {"id": img_url, "type": "Image", "width": w, "height": h}
                if mime:
                    body["format"] = mime
                page_items.append(
                    {
                        "id": f"{cid}/page/1/a1",
                        "type": "Annotation",
                        "motivation": "painting",
                        "body": body,
                        "target": cid,
                    }
                )
            canvas["items"] = [{"id": f"{cid}/page/1", "type": "AnnotationPage", "items": page_items}]
            annos = []
            if u.text.strip():
                annos.append(_text_anno(f, u, f"{cid}/annotations/text", cid, lang))
            for i, g in enumerate(figures_by_unit.get(u.id, []), start=1):
                region = g.anchor.region
                target = cid
                if region is not None:
                    target = f"{cid}#xywh=percent:" + ",".join(
                        _pct(v) for v in (region.x, region.y, region.w, region.h)
                    )
                text = " ".join(t for t in (g.caption, g.description) if t)
                if text:
                    annos.append(
                        {
                            "id": f"{cid}/annotations/figure/{i}",
                            "type": "Annotation",
                            "motivation": "describing",
                            "body": {
                                "type": "TextualBody",
                                "value": text,
                                "format": "text/plain",
                                "language": lang,
                            },
                            "target": target,
                        }
                    )
            if annos:
                canvas["annotations"] = [{"id": f"{cid}/annotations", "type": "AnnotationPage", "items": annos}]
            canvases.append(canvas)
    manifest["items"] = canvases

    ranges = _ranges(f, base, canvas_of, units, lang)
    if not ranges and doc.kind in ("audio", "video"):
        ranges = _unit_ranges(base, canvas_of, units, lang, locale)
    if ranges:
        manifest["structures"] = ranges
    return manifest


def _canvas_label(u: Unit, locale: str) -> str | None:
    """Page canvases: the folio as in TEI ``pb/@n`` (``[iv]`` if inferred), none when unnumbered.

    Other units: their locator (``1:09:20``, ``diap. 3``…).
    """
    a = u.anchor
    if a.type == "page":
        if a.printed is None:
            return None
        return f"[{a.printed}]" if a.source == "inferred" else a.printed
    return locator_label(a, None, locale) or str(u.ord)


def _pct(fraction: float) -> str:
    from ..canonical import es_number

    r = round(float(fraction) * 100, 4)
    return es_number(0.0 if r == 0 else r)


def _unit_ranges(
    base: str, canvas_of: dict[str, str], units: list[Unit], lang: str, locale: str
) -> list[dict[str, Any]]:
    out = []
    for u in units:
        cid = canvas_of.get(u.id)
        t0 = u.t0 if u.t0 is not None else u.anchor.t0
        t1 = u.t1 if u.t1 is not None else u.anchor.t1
        if cid is None or t0 is None:
            continue
        label = locator_label(u.anchor, None, locale) or str(u.ord)
        if u.anchor.speaker:
            label = f"{label} {u.anchor.speaker}"
        out.append(
            {
                "id": f"{base}/range/u{u.ord}",
                "type": "Range",
                "label": {lang: [label]},
                "items": [{"id": f"{cid}#t={_n(t0)},{_n(t1 if t1 is not None else t0)}", "type": "Canvas"}],
            }
        )
    return out


def _n(x: float | None) -> str:
    from ..canonical import es_number

    return es_number(round(float(x or 0.0), 6))


def _text_anno(f: SpdfFile, u: Unit, aid: str, target: str, lang: str) -> dict[str, Any]:
    return {
        "id": aid,
        "type": "Annotation",
        "motivation": "supplementing",
        "body": {"type": "TextualBody", "value": u.text, "format": "text/markdown", "language": lang},
        "target": target,
        "seeAlso": [{"id": f.anchor_uri(u), "type": "Text", "format": "text/plain"}],
    }


def _ranges(f: SpdfFile, base: str, canvas_of: dict[str, str], units: list[Unit], lang: str) -> list[dict[str, Any]]:
    sections = f.sections()
    if not sections:
        return []
    order = {u.id: u.ord for u in units}
    by_ord = sorted(units, key=lambda u: u.ord)
    children: dict[str | None, list[Any]] = {}
    ids = {s.id for s in sections}
    for s in sections:
        parent = s.parent if s.parent in ids else None
        children.setdefault(parent, []).append(s)

    def build(s: Any) -> dict[str, Any]:
        start = order.get(s.unit_from)
        end = order.get(s.unit_to) if s.unit_to else start
        items: list[dict[str, Any]] = []
        for child in sorted(children.get(s.id, []), key=lambda c: (order.get(c.unit_from, 0), c.id)):
            items.append(build(child))
        if not items and start is not None:
            seen: set[str] = set()
            for u in by_ord:
                if start <= u.ord <= (end or start):
                    cid = canvas_of.get(u.id)
                    if cid and cid not in seen:
                        seen.add(cid)
                        items.append({"id": cid, "type": "Canvas"})
        return {
            "id": f"{base}/range/{quote(s.id, safe='')}",
            "type": "Range",
            "label": {lang: [s.title]},
            "items": items,
        }

    roots = sorted(children.get(None, []), key=lambda c: (order.get(c.unit_from, 0), c.id))
    return [build(s) for s in roots]
