"""Fragments as pandas DataFrames or Arrow tables, for research workflows.

Both are optional: ``pip install spdf-format[pandas]`` or ``spdf-format[arrow]``.
With ``vectors="<space id>"`` a ``vector`` column holds the decoded float32 vectors
(``None`` for fragments without one).
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..reader import SpdfFile

__all__ = ["fragment_records", "to_arrow", "to_pandas"]


def fragment_records(f: SpdfFile, *, vectors: str | None = None, locale: str = "es") -> list[dict[str, Any]]:
    """One plain dict per fragment (ordered by ``n``)."""
    vecs: dict[str, list[float]] = dict(f.vectors(vectors, "fragment")) if vectors else {}
    out = []
    for fr in f.iter_fragments():
        a = fr.anchor
        rec: dict[str, Any] = {
            "n": fr.n,
            "id": fr.id,
            "unit": fr.unit,
            "ord": fr.ord,
            "text": fr.text,
            "context": fr.context,
            "section": list(fr.section),
            "anchor_type": a.type,
            "physical": a.physical,
            "printed": a.printed,
            "t0": a.t0,
            "t1": a.t1,
            "anchor": a.to_dict(),
            "anchor_end": fr.anchor_end.to_dict() if fr.anchor_end else None,
            "anchor_uri": f.anchor_uri(fr),
            "citation": f.cite(fr, locale=locale),
            "search_text": fr.search_text,
        }
        if vectors:
            rec["vector"] = vecs.get(fr.id)
        out.append(rec)
    return out


def to_pandas(f: SpdfFile, *, vectors: str | None = None, locale: str = "es") -> Any:
    """Fragments as a :class:`pandas.DataFrame` (vectors as float32 numpy arrays)."""
    try:
        import pandas as pd
    except ImportError as exc:  # pragma: no cover
        raise ImportError("to_pandas() needs pandas: pip install 'spdf-format[pandas]'") from exc
    records = fragment_records(f, vectors=vectors, locale=locale)
    if vectors:
        import numpy as np

        for r in records:
            if r["vector"] is not None:
                r["vector"] = np.asarray(r["vector"], dtype="float32")
    return pd.DataFrame.from_records(records)


def to_arrow(f: SpdfFile, *, vectors: str | None = None, locale: str = "es") -> Any:
    """Fragments as a :class:`pyarrow.Table`; anchors as JSON strings, vectors as fixed-size lists."""
    try:
        import pyarrow as pa
    except ImportError as exc:  # pragma: no cover
        raise ImportError("to_arrow() needs pyarrow: pip install 'spdf-format[arrow]'") from exc
    records = fragment_records(f, vectors=vectors, locale=locale)
    cols: dict[str, Any] = {
        "n": pa.array([r["n"] for r in records], pa.int64()),
        "id": pa.array([r["id"] for r in records], pa.string()),
        "unit": pa.array([r["unit"] for r in records], pa.string()),
        "ord": pa.array([r["ord"] for r in records], pa.int64()),
        "text": pa.array([r["text"] for r in records], pa.string()),
        "context": pa.array([r["context"] for r in records], pa.string()),
        "section": pa.array([r["section"] for r in records], pa.list_(pa.string())),
        "anchor_type": pa.array([r["anchor_type"] for r in records], pa.string()),
        "physical": pa.array([r["physical"] for r in records], pa.int64()),
        "printed": pa.array([r["printed"] for r in records], pa.string()),
        "t0": pa.array([r["t0"] for r in records], pa.float64()),
        "t1": pa.array([r["t1"] for r in records], pa.float64()),
        "anchor": pa.array([json.dumps(r["anchor"], ensure_ascii=False) for r in records], pa.string()),
        "anchor_end": pa.array(
            [json.dumps(r["anchor_end"], ensure_ascii=False) if r["anchor_end"] else None for r in records],
            pa.string(),
        ),
        "anchor_uri": pa.array([r["anchor_uri"] for r in records], pa.string()),
        "citation": pa.array([r["citation"] for r in records], pa.string()),
        "search_text": pa.array([r["search_text"] for r in records], pa.string()),
    }
    if vectors:
        dims = f.space(vectors).dims
        cols["vector"] = pa.array([r["vector"] for r in records], pa.list_(pa.float32(), dims))
    meta = {b"spdf:docref": f.docref.encode(), b"spdf:version": f.version.encode()}
    return pa.table(cols).replace_schema_metadata(meta)
