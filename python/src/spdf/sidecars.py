"""Sidecar files (SPEC §17): annotations (``.spdfa.json``) and collections (``.spdfl.json``).

Annotations live outside the document as a W3C Web Annotation ``AnnotationCollection``
whose targets carry an ``SpdfAnchorSelector`` (the anchor URI) plus a
``TextQuoteSelector`` so they survive a re-reading that shifts offsets. A collection
(library) is a manifest of documents by identity (``source_sha256``), not a container.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

from .anchors import Anchor
from .errors import SpdfError
from .model import Fragment, Unit
from .reader import SpdfFile, open_spdf
from .writer import now_iso

__all__ = [
    "annotation",
    "annotation_collection",
    "library",
    "read_annotations",
    "read_library",
    "write_annotations",
    "write_library",
]

ANNO_CONTEXT = "http://www.w3.org/ns/anno.jsonld"
ANNOTATIONS_VERSION = "1.0"
LIBRARY_VERSION = "1.0"


def _quote(f: SpdfFile, item: Fragment | Unit | Anchor | Mapping[str, Any], context: int) -> dict[str, str] | None:
    """A TextQuoteSelector for the item (exact text plus a little context), when text is known."""
    if isinstance(item, Unit):
        return {"type": "TextQuoteSelector", "exact": item.text, "prefix": "", "suffix": ""}
    anchor = item.anchor if isinstance(item, Fragment) else item
    chars = anchor.chars if isinstance(anchor, Anchor) else None
    if chars is None and isinstance(anchor, Mapping):
        c = anchor.get("chars")
        chars = (int(c[0]), int(c[1])) if isinstance(c, list) and len(c) == 2 else None
    unit = f.unit(item.unit) if isinstance(item, Fragment) else None
    if chars is not None and unit is not None:
        a, b = chars
        text = unit.text
        return {
            "type": "TextQuoteSelector",
            "exact": text[a:b],
            "prefix": text[max(0, a - context) : a],
            "suffix": text[b : b + context],
        }
    if isinstance(item, Fragment):
        return {"type": "TextQuoteSelector", "exact": item.text, "prefix": "", "suffix": ""}
    return None


def annotation(
    f: SpdfFile,
    item: Fragment | Unit | Anchor | Mapping[str, Any],
    *,
    body: str | None = None,
    motivation: str | None = None,
    language: str | None = None,
    created: str | None = None,
    annotation_id: str | None = None,
    end: Anchor | Mapping[str, Any] | None = None,
    context: int = 32,
) -> dict[str, Any]:
    """A W3C Web Annotation targeting a fragment, unit or anchor of an open file.

    With ``body`` the annotation is a comment (``motivation="commenting"``); without it, a
    highlight. The target has an ``SpdfAnchorSelector`` and, when the text is known, a
    ``TextQuoteSelector``.
    """
    uri = f.anchor_uri(item, end)
    selectors: list[dict[str, Any]] = [{"type": "SpdfAnchorSelector", "value": uri}]
    quote = _quote(f, item, context)
    if quote is not None:
        selectors.append(quote)
    anno: dict[str, Any] = {
        "id": annotation_id or f"urn:uuid:{uuid.uuid4()}",
        "type": "Annotation",
        "motivation": motivation or ("commenting" if body else "highlighting"),
        "created": created or now_iso(),
    }
    if body is not None:
        lang = language or f.document.language
        b: dict[str, Any] = {"type": "TextualBody", "value": body, "format": "text/plain"}
        if lang:
            b["language"] = lang
        anno["body"] = b
    anno["target"] = {"source": uri.split("#", 1)[0], "selector": selectors}
    return anno


def annotation_collection(annotations: Iterable[Mapping[str, Any]], label: str | None = None) -> dict[str, Any]:
    """Wrap annotations in the ``.spdfa.json`` collection object."""
    out: dict[str, Any] = {
        "@context": ANNO_CONTEXT,
        "type": "AnnotationCollection",
        "spdf_annotations": ANNOTATIONS_VERSION,
    }
    if label:
        out["label"] = label
    out["first"] = {"type": "AnnotationPage", "items": [dict(a) for a in annotations]}
    return out


def write_annotations(
    path: str | os.PathLike[str], annotations: Iterable[Mapping[str, Any]], label: str | None = None
) -> Path:
    """Write a ``.spdfa.json`` file."""
    p = Path(os.fspath(path))
    p.write_text(json.dumps(annotation_collection(annotations, label), ensure_ascii=False, indent=2) + "\n", "utf-8")
    return p


def read_annotations(path: str | os.PathLike[str]) -> list[dict[str, Any]]:
    """Read the annotations of a ``.spdfa.json`` file (checks the collection shape)."""
    data = json.loads(Path(os.fspath(path)).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("type") != "AnnotationCollection" or "spdf_annotations" not in data:
        raise SpdfError("not an SPDF annotation collection (.spdfa.json)")
    items = (data.get("first") or {}).get("items")
    if not isinstance(items, list):
        raise SpdfError("annotation collection without first.items")
    return [dict(i) for i in items]


def library(
    sources: Iterable[str | os.PathLike[str] | SpdfFile],
    name: str,
    *,
    description: str | None = None,
    urls: Mapping[str, str] | None = None,
    created: str | None = None,
) -> dict[str, Any]:
    """Build a ``.spdfl.json`` manifest from SPDF files (in the given order).

    ``urls`` maps a file path (as given) to the public URL where a copy can be fetched;
    ``file_sha256`` is computed for files given by path.
    """
    items: list[dict[str, Any]] = []
    for src in sources:
        if isinstance(src, SpdfFile):
            items.append(_library_item(src, None, None))
            continue
        path = Path(os.fspath(src))
        with open_spdf(path) as f:
            file_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            items.append(_library_item(f, file_hash, (urls or {}).get(os.fspath(src))))
    out: dict[str, Any] = {"spdf_library": LIBRARY_VERSION, "name": name}
    if description:
        out["description"] = description
    out["created"] = created or now_iso()
    out["items"] = items
    return out


def _library_item(f: SpdfFile, file_sha256: str | None, url: str | None) -> dict[str, Any]:
    d = f.document
    sha = (d.source_sha256 or "").lower()
    if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise SpdfError(f"document {d.id!r} has no valid source_sha256 to identify it in a library")
    item: dict[str, Any] = {"sha256": sha, "title": d.display_title}
    if d.authors:
        item["authors"] = d.authors
    item["year"] = d.year
    if url:
        item["url"] = url
    if file_sha256:
        item["file_sha256"] = file_sha256
    return item


def write_library(path: str | os.PathLike[str], manifest: Mapping[str, Any]) -> Path:
    """Write a ``.spdfl.json`` file."""
    p = Path(os.fspath(path))
    p.write_text(json.dumps(dict(manifest), ensure_ascii=False, indent=2) + "\n", "utf-8")
    return p


def read_library(path: str | os.PathLike[str]) -> dict[str, Any]:
    """Read a ``.spdfl.json`` manifest (checks its shape)."""
    data = json.loads(Path(os.fspath(path)).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or "spdf_library" not in data or not isinstance(data.get("items"), list):
        raise SpdfError("not an SPDF collection manifest (.spdfl.json)")
    return data
