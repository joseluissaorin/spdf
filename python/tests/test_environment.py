"""Behaviour that depends on the environment: missing FTS5, numpy fast path."""

from __future__ import annotations

import random
from pathlib import Path

import pytest

import spdf
from spdf import _sqlite, vectors


def test_without_fts5_reading_works_and_search_explains(quijote: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_sqlite, "HAS_FTS5", False)
    with spdf.open(quijote) as f:
        assert f.document.id == "quijote"
        assert len(f.fragments()) == 3
        assert f.search_vector([0, 1, 0, 0], space="test@4")[0].fragment_id == "f2"
        with pytest.raises(spdf.Fts5UnavailableError) as exc:
            f.search("lanza")
    assert "FTS5" in str(exc.value) and "pysqlite3-binary" in str(exc.value)
    with pytest.raises(spdf.Fts5UnavailableError):
        spdf.Writer(quijote.with_name("other.spdf"))
    # Validation still runs; only the FTS integrity check is skipped.
    assert spdf.validate(quijote).valid


def test_driver_info() -> None:
    info = spdf.driver_info()
    assert info["fts5"] is True and info["driver"] in ("sqlite3", "pysqlite3.dbapi2")


def test_numpy_and_python_scores_agree() -> None:
    np = pytest.importorskip("numpy")
    rng = random.Random(7)
    dims = 64
    blobs = [vectors.encode([rng.uniform(-1, 1) for _ in range(dims)], "f32") for _ in range(1000)]
    q = [rng.uniform(-1, 1) for _ in range(dims)]
    fast = vectors.scores(q, blobs, "f32", normalized=False)  # 64 000 products: numpy path
    assert vectors.HAS_NUMPY
    slow = []
    for b in blobs:
        v = vectors.decode(b, "f32")
        slow.append(vectors.dot(q, v) / (vectors.norm(q) * vectors.norm(v)))
    assert np.allclose(fast, slow, atol=1e-12)
    for dtype in ("f16", "i8"):
        enc = [vectors.encode(vectors.decode(b, "f32"), dtype) for b in blobs[:900]]
        f2 = vectors.scores(q, enc, dtype, normalized=True)
        s2 = [vectors.dot(q, vectors.decode(b, dtype)) for b in enc]
        assert np.allclose(f2, s2, atol=1e-12)
