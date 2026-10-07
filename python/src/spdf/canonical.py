"""Canonical JSON (the conformance oracle and the input of ``content_sha256``).

The serialization follows RFC 8785 (JSON Canonicalization Scheme): object keys
sorted by their UTF-16 code units, no insignificant whitespace, strings escaped
minimally, and numbers written as ECMAScript's ``Number.prototype.toString``
would (``4160.0`` → ``4160``, ``1e-7`` → ``1e-7``). Before serializing, every
float is rounded to 6 decimal places (round-half-even on the binary value).
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from typing import Any

__all__ = ["canonical_dumps", "es_number", "round_floats"]

FLOAT_DECIMALS = 6


def es_number(x: float | int) -> str:
    """Format a number exactly as ECMAScript ``String(x)`` does."""
    if isinstance(x, bool):
        raise TypeError("booleans are not numbers here")
    if isinstance(x, int):
        return str(x)
    if math.isnan(x) or math.isinf(x):
        raise ValueError("NaN and infinities are not valid JSON numbers")
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    r = repr(abs(x))
    if "e" in r:
        mant, exp_s = r.split("e")
        exp = int(exp_s)
    else:
        mant, exp = r, 0
    if "." in mant:
        ip, fp = mant.split(".")
    else:
        ip, fp = mant, ""
    digits = ip + fp
    n = len(ip) + exp  # value = 0.<digits> * 10**n before stripping
    stripped = digits.lstrip("0")
    n -= len(digits) - len(stripped)
    digits = stripped.rstrip("0") or "0"
    k = len(digits)
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        es = ("+" if e > 0 else "-") + str(abs(e))
        out = digits + "e" + es if k == 1 else digits[0] + "." + digits[1:] + "e" + es
    return sign + out


def round_floats(value: Any, decimals: int = FLOAT_DECIMALS) -> Any:
    """Return a copy of ``value`` with every float rounded to ``decimals`` places."""
    if isinstance(value, bool) or value is None or isinstance(value, (int, str)):
        return value
    if isinstance(value, float):
        r = round(value, decimals)
        return 0.0 if r == 0 else r
    if isinstance(value, Mapping):
        return {k: round_floats(v, decimals) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [round_floats(v, decimals) for v in value]
    return value


def _utf16_key(s: str) -> bytes:
    return s.encode("utf-16-be", "surrogatepass")


def _write(value: Any, out: list[str]) -> None:
    if value is None:
        out.append("null")
    elif value is True:
        out.append("true")
    elif value is False:
        out.append("false")
    elif isinstance(value, (int, float)):
        out.append(es_number(value))
    elif isinstance(value, str):
        out.append(json.dumps(value, ensure_ascii=False))
    elif isinstance(value, Mapping):
        out.append("{")
        first = True
        for key in sorted(value.keys(), key=lambda k: _utf16_key(str(k))):
            if not first:
                out.append(",")
            first = False
            out.append(json.dumps(str(key), ensure_ascii=False))
            out.append(":")
            _write(value[key], out)
        out.append("}")
    elif isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        out.append("[")
        for i, item in enumerate(value):
            if i:
                out.append(",")
            _write(item, out)
        out.append("]")
    else:
        raise TypeError(f"cannot serialize {type(value).__name__} to canonical JSON")


def canonical_dumps(value: Any, *, round_decimals: int | None = FLOAT_DECIMALS) -> str:
    """Serialize ``value`` as canonical JSON (RFC 8785 with float rounding)."""
    if round_decimals is not None:
        value = round_floats(value, round_decimals)
    out: list[str] = []
    _write(value, out)
    return "".join(out)
