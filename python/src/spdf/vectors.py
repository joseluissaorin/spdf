"""Vector encoding (``f32`` / ``f16`` / ``i8``, little-endian) and scoring.

Everything works with the standard library; if :mod:`numpy` is installed it is used
for decoding and scoring in bulk. Scores are computed in float64 in both paths.
"""

from __future__ import annotations

import math
import struct
from collections.abc import Iterable, Sequence
from typing import Any

from .schema import DTYPE_SIZES

__all__ = ["HAS_NUMPY", "decode", "dot", "encode", "norm"]

_np: Any
try:  # pragma: no cover - depends on the environment
    import numpy

    _np = numpy
    HAS_NUMPY = True
except ImportError:  # pragma: no cover
    _np = None
    HAS_NUMPY = False

_FMT = {"f32": "f", "f16": "e", "i8": "b"}


def _round_half_away(x: float) -> int:
    return math.floor(abs(x) + 0.5) * (1 if x >= 0 else -1)


def encode(values: Any, dtype: str = "f32") -> bytes:
    """Encode a sequence of floats (or a numpy array) as little-endian ``dtype``.

    ``i8`` uses ``q = clamp(round_half_away_from_zero(v × 127), −127, 127)``;
    ``f16`` uses IEEE binary16 with round-to-nearest-even.
    """
    if isinstance(values, (bytes, bytearray, memoryview)):
        return bytes(values)
    if dtype not in _FMT:
        raise ValueError(f"unknown dtype {dtype!r} (expected f32, f16 or i8)")
    if _np is not None and isinstance(values, _np.ndarray):
        values = values.astype("float64").ravel().tolist()
    vals = [float(v) for v in values]
    if dtype == "i8":
        q = [max(-127, min(127, _round_half_away(v * 127.0))) for v in vals]
        return struct.pack(f"<{len(q)}b", *q)
    return struct.pack(f"<{len(vals)}{_FMT[dtype]}", *vals)


def decode(data: bytes, dtype: str = "f32") -> list[float]:
    """Decode a vector blob into a list of Python floats (``i8`` → ``q / 127``)."""
    size = DTYPE_SIZES.get(dtype)
    if size is None:
        raise ValueError(f"unknown dtype {dtype!r}")
    if len(data) % size:
        raise ValueError(f"vector of {len(data)} bytes is not a multiple of {size} ({dtype})")
    n = len(data) // size
    raw = struct.unpack(f"<{n}{_FMT[dtype]}", data)
    if dtype == "i8":
        return [q / 127.0 for q in raw]
    return [float(x) for x in raw]


def decode_numpy(data: bytes, dtype: str = "f32") -> Any:
    """Decode a vector blob into a float64 numpy array (requires numpy)."""
    if _np is None:  # pragma: no cover
        raise ImportError("numpy is not installed (pip install 'spdf-format[numpy]')")
    np_dtype = {"f32": "<f4", "f16": "<f2", "i8": "i1"}[dtype]
    arr = _np.frombuffer(data, dtype=np_dtype).astype("float64")
    if dtype == "i8":
        arr = arr / 127.0
    return arr


def dot(a: Sequence[float], b: Sequence[float]) -> float:
    """Dot product in float64."""
    total = 0.0
    for x, y in zip(a, b, strict=False):
        total += x * y
    return total


def norm(a: Iterable[float]) -> float:
    """Euclidean norm in float64."""
    return math.sqrt(sum(x * x for x in a))


def scores(query: Sequence[float], vectors: list[bytes], dtype: str, normalized: bool) -> list[float]:
    """Score every vector blob against ``query`` (dot product, or cosine if not normalized)."""
    if not vectors:
        return []
    if _np is not None and len(vectors) * len(query) > 50_000:
        q = _np.asarray(query, dtype="float64")
        np_dtype = {"f32": "<f4", "f16": "<f2", "i8": "i1"}[dtype]
        mat = _np.frombuffer(b"".join(vectors), dtype=np_dtype).astype("float64").reshape(len(vectors), -1)
        if dtype == "i8":
            mat = mat / 127.0
        s = mat @ q
        if not normalized:
            denom = _np.linalg.norm(mat, axis=1) * float(_np.linalg.norm(q))
            s = _np.divide(s, denom, out=_np.zeros_like(s), where=denom != 0)
        return [float(x) for x in s]
    out: list[float] = []
    qn = norm(query) if not normalized else 1.0
    for blob in vectors:
        v = decode(blob, dtype)
        d = dot(query, v)
        if not normalized:
            denom = qn * norm(v)
            d = d / denom if denom else 0.0
        out.append(d)
    return out
