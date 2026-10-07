"""Turn SPDF files into framework-neutral records: id, literal text, flat metadata, vector.

This module is shared verbatim by ``spdf-llamaindex`` and ``spdf-langchain``; keep both
copies identical. Everything is read through the public API of ``spdf-format``.

Metadata values are flat scalars (``str``, ``int``, ``float``, ``bool``) so that any
vector store accepts them; a key whose value would be null is left out.
"""

from __future__ import annotations

import math
import os
from array import array
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Union

import spdf

__all__ = [
    "GRANULARITIES",
    "SECTIONS_SEPARATOR",
    "SECTION_SEPARATOR",
    "Record",
    "Source",
    "expand_sources",
    "iter_records",
]

Source = Union[str, "os.PathLike[str]"]

GRANULARITIES = ("fragment", "unit")
#: Joins the heading path of one section: ``"Part I / Chapter 3"``.
SECTION_SEPARATOR = " / "
#: Joins several sections that share one unit (unit granularity only).
SECTIONS_SEPARATOR = " | "


@dataclass(frozen=True)
class Record:
    """One passage (fragment) or unit, ready to become a framework document."""

    id: str
    text: str
    metadata: dict[str, Any]
    vector: list[float] | None = None


def check_options(granularity: str, locale: str) -> None:
    if granularity not in GRANULARITIES:
        raise ValueError(f"granularity must be 'fragment' or 'unit', not {granularity!r}")
    if not isinstance(locale, str) or not locale:
        raise ValueError("locale must be a non-empty string such as 'en' or 'es'")


# -- inputs ---------------------------------------------------------------------------------


def _is_hidden(rel_parts: Iterable[str]) -> bool:
    return any(part.startswith(".") for part in rel_parts)


def expand_sources(sources: Source | Iterable[Source], *, fs: Any = None) -> list[str]:
    """Paths of the files to read: a file, a folder (recursive ``*.spdf``) or a list of both.

    Hidden files and folders inside a folder are skipped. ``fs`` is an optional
    ``fsspec`` filesystem (as passed by LlamaIndex's ``SimpleDirectoryReader``).
    """
    if isinstance(sources, (str, os.PathLike)):
        items: list[Source] = [sources]
    else:
        items = list(sources)
    out: list[str] = []
    for item in items:
        if not isinstance(item, (str, os.PathLike)):
            raise TypeError(f"expected a path or a list of paths, got {type(item).__name__}")
        path = os.fspath(item)
        if fs is not None:
            out.extend(_expand_fs(fs, path))
            continue
        p = Path(path)
        if p.is_dir():
            found = [
                q
                for q in p.rglob("*")
                if q.suffix.lower() == ".spdf" and q.is_file() and not _is_hidden(q.relative_to(p).parts)
            ]
            out.extend(str(q) for q in sorted(found))
        elif p.exists():
            out.append(str(p))
        else:
            raise FileNotFoundError(f"no such file or folder: {path}")
    return out


def _expand_fs(fs: Any, path: str) -> list[str]:
    if fs.isdir(path):
        root = PurePosixPath(path)
        found = []
        for q in fs.find(path):
            qp = PurePosixPath(q)
            rel = qp.relative_to(root).parts if qp.is_relative_to(root) else qp.parts
            if qp.suffix.lower() == ".spdf" and not _is_hidden(rel):
                found.append(str(q))
        return sorted(found)
    if fs.exists(path):
        return [path]
    raise FileNotFoundError(f"no such file or folder: {path}")


# -- errors -----------------------------------------------------------------------------------


def _with_path(err: spdf.SpdfError, path: str) -> spdf.SpdfError:
    """The same error (same class and code) with the file path in the message."""
    msg = str(err.args[0]) if err.args else ""
    if path in msg:
        return err
    try:
        return type(err)(f"cannot load {path}: {msg}", err.code)
    except Exception:  # an exotic subclass signature: keep the original
        return err


# -- reading ------------------------------------------------------------------------------------


def iter_records(
    sources: Source | Iterable[Source],
    *,
    granularity: str = "fragment",
    locale: str = "en",
    vector_space: str | None = None,
    fs: Any = None,
) -> Iterator[Record]:
    """Records of every file, file by file, in reading order."""
    check_options(granularity, locale)
    for path in expand_sources(sources, fs=fs):
        yield from iter_file_records(path, granularity=granularity, locale=locale, vector_space=vector_space, fs=fs)


def iter_file_records(
    path: str,
    *,
    granularity: str = "fragment",
    locale: str = "en",
    vector_space: str | None = None,
    fs: Any = None,
) -> Iterator[Record]:
    try:
        if fs is not None:
            with fs.open(path, "rb") as fh:
                f = spdf.open(fh.read())
        else:
            f = spdf.open(path)
    except spdf.SpdfError as e:
        raise _with_path(e, path) from e
    with f:
        try:
            yield from _records_of(f, path, granularity, locale, vector_space)
        except spdf.SpdfError as e:
            raise _with_path(e, path) from e


def _vectors(f: spdf.SpdfFile, space: str, target: str) -> dict[str, array]:
    available = [s.id for s in f.spaces()]
    if space not in available:
        raise spdf.SpdfError(
            f"no vector space {space!r} in this file (available: {', '.join(available) or 'none'})", "E031"
        )
    # float32 arrays: a quarter of the memory of lists of Python floats, exact for f32 data.
    return {vid: array("f", vec) for vid, vec in f.vectors(space, target)}


def _doc_metadata(f: spdf.SpdfFile, path: str) -> dict[str, Any]:
    d = f.document
    language = d.language or d.metadata.get("language")
    md: dict[str, Any] = {
        "source": path,
        "spdf_version": f.version,
        "spdf_doc_id": d.id,
        "docref": f.docref,
        "title": d.display_title,
        "authors": d.authors,
        "year": d.year,
        "language": language if isinstance(language, str) else None,
        "kind": d.kind or None,
    }
    return md


def _anchor_metadata(anchor: spdf.Anchor, end: spdf.Anchor | None) -> dict[str, Any]:
    md: dict[str, Any] = {
        "anchor_type": anchor.type,
        "physical_page": anchor.physical,
        "printed_folio": anchor.printed,
        "folio_inferred": anchor.source == "inferred",
    }
    if anchor.type == "time":
        md["t0"] = anchor.t0
        md["t1"] = end.t1 if end is not None and end.t1 is not None else anchor.t1
    md["anchor"] = spdf.canonical_dumps(anchor.to_dict())
    if end is not None:
        md["anchor_end"] = spdf.canonical_dumps(end.to_dict())
    return md


def _clean(md: dict[str, Any]) -> dict[str, Any]:
    """Drop null (and non-finite) values: flat stores such as Chroma reject them."""
    out = {}
    for k, v in md.items():
        if v is None or (isinstance(v, float) and not math.isfinite(v)):
            continue
        out[k] = v
    return out


def _records_of(
    f: spdf.SpdfFile, path: str, granularity: str, locale: str, vector_space: str | None
) -> Iterator[Record]:
    base = _doc_metadata(f, path)
    docref = f.docref
    target = "fragment" if granularity == "fragment" else "unit"
    vectors = _vectors(f, vector_space, target) if vector_space else {}

    if granularity == "fragment":
        for fr in f.iter_fragments():
            md = dict(base)
            md["fragment_id"] = fr.id
            md["unit_id"] = fr.unit
            md.update(_anchor_metadata(fr.anchor, fr.anchor_end))
            md["section"] = SECTION_SEPARATOR.join(fr.section) or None
            md["context"] = fr.context or None
            md["anchor_uri"] = f.anchor_uri(fr)
            md["citation"] = f.cite(fr, locale=locale)
            vec = vectors.get(fr.id)
            if vec is not None:
                md["vector_space"] = vector_space
            yield Record(f"{docref}:{fr.id}", fr.text, _clean(md), vec.tolist() if vec is not None else None)
        return

    sections = _unit_sections(f)
    for u in f.iter_units():
        md = dict(base)
        md["unit_id"] = u.id
        md.update(_anchor_metadata(u.anchor, None))
        if md.get("printed_folio") is None:
            md["printed_folio"] = u.printed
        if u.anchor.type != "time" and u.t0 is not None:
            md["t0"], md["t1"] = u.t0, u.t1
        md["section"] = SECTIONS_SEPARATOR.join(sections.get(u.id, [])) or None
        md["anchor_uri"] = f.anchor_uri(u)
        md["citation"] = f.cite(u, locale=locale)
        vec = vectors.get(u.id)
        if vec is not None:
            md["vector_space"] = vector_space
        yield Record(f"{docref}:{u.id}", u.text, _clean(md), vec.tolist() if vec is not None else None)


def _unit_sections(f: spdf.SpdfFile) -> dict[str, list[str]]:
    """For each unit id, the heading paths of the innermost sections that span it."""
    rank = {u.id: u.ord for u in f.iter_units()}
    secs = f.sections()
    by_id = {s.id: s for s in secs}

    def path_of(s: spdf.Section) -> list[str]:
        out, seen, cur = [], set(), s
        while cur is not None and cur.id not in seen:
            seen.add(cur.id)
            out.append(cur.title)
            cur = by_id.get(cur.parent) if cur.parent else None
        return out[::-1]

    spans = []
    for i, s in enumerate(secs):
        lo = rank.get(s.unit_from)
        if lo is None:
            continue
        hi = rank.get(s.unit_to, math.inf) if s.unit_to else math.inf
        spans.append((lo, i, hi, s))
    spans.sort(key=lambda t: (t[0], t[1]))

    out: dict[str, list[str]] = {}
    for uid, r in rank.items():
        covering = [s for lo, _, hi, s in spans if lo <= r <= hi]
        ids = {s.id for s in covering}
        ancestors: set[str] = set()
        for s in covering:
            cur = by_id.get(s.parent) if s.parent else None
            while cur is not None and cur.id not in ancestors:
                ancestors.add(cur.id)
                cur = by_id.get(cur.parent) if cur.parent else None
        leaves = [SECTION_SEPARATOR.join(path_of(s)) for s in covering if s.id not in (ancestors & ids)]
        if leaves:
            out[uid] = leaves
    return out
