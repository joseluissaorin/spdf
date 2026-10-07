"""Anchors (where a passage is in its source) and anchor URIs (contract §3).

An anchor is a small JSON object stored in ``units.anchor``, ``fragments.anchor`` and
``figures.anchor``. :class:`Anchor` is a typed, read-only view of it that keeps the
original object in :attr:`Anchor.raw`, so nothing is lost on a round trip.

An anchor URI points at a place in a document from outside the file::

    spdf:sha256-3f2a…#p=29&f=21&char=118,301

:func:`parse_uri` returns the *locator* (the decoded parameters) and :func:`format_uri`
rebuilds the canonical URI byte for byte.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import unquote

from .canonical import es_number
from .errors import InvalidAnchorError
from .schema import ANCHOR_TYPES

__all__ = [
    "Anchor",
    "Region",
    "anchor_problem",
    "anchor_to_locator",
    "docref_for",
    "format_uri",
    "locator_to_anchor",
    "make_uri",
    "parse_uri",
]

_HEX64 = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class Region:
    """A rectangle in fractions (0–1) of the unit image."""

    x: float
    y: float
    w: float
    h: float

    def to_dict(self) -> dict[str, float]:
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h}


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v)


def _int(v: Any) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return None


def _str(v: Any) -> str | None:
    return v if isinstance(v, str) else None


@dataclass(frozen=True)
class Anchor:
    """Typed view of an anchor object.

    Only the members that apply to :attr:`type` are set; the rest are ``None``.
    :attr:`raw` holds the exact JSON object read from the file (or given to
    :meth:`from_dict`), and :meth:`to_dict` returns it unchanged.
    """

    type: str
    # page
    physical: int | None = None
    printed: str | None = None
    roman: bool | None = None
    foliation: str | None = None
    source: str | None = None
    confidence: float | None = None
    # time
    t0: float | None = None
    t1: float | None = None
    speaker: str | None = None
    # section / web
    path: tuple[str, ...] | None = None
    paragraph: int | None = None
    url: str | None = None
    accessed: str | None = None
    # slide
    n: int | None = None
    # sheet
    sheet: str | None = None
    row_from: int | None = None
    row_to: int | None = None
    # verse
    line_from: int | None = None
    line_to: int | None = None
    # canonical
    scheme: str | None = None
    ref: str | None = None
    # any type
    region: Region | None = None
    chars: tuple[int, int] | None = None
    raw: dict[str, Any] = field(default_factory=dict, compare=False, repr=False)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Anchor:
        """Build an anchor from its JSON object. Unknown members are kept in :attr:`raw`."""
        if not isinstance(data, Mapping):
            raise InvalidAnchorError("an anchor must be a JSON object", "E040")
        t = data.get("type")
        if not isinstance(t, str):
            raise InvalidAnchorError("an anchor needs a string 'type'", "E040")
        region = None
        r = data.get("region")
        if isinstance(r, Mapping):
            vals = [_num(r.get(k)) for k in ("x", "y", "w", "h")]
            if all(v is not None for v in vals):
                region = Region(*(v for v in vals if v is not None))
        chars = None
        c = data.get("chars")
        if isinstance(c, Sequence) and not isinstance(c, str) and len(c) == 2:
            a, b = _int(c[0]), _int(c[1])
            if a is not None and b is not None:
                chars = (a, b)
        path = data.get("path")
        path_t = tuple(str(p) for p in path) if isinstance(path, list) else None
        roman = data.get("roman")
        return cls(
            type=t,
            physical=_int(data.get("physical")),
            printed=_str(data.get("printed")),
            roman=roman if isinstance(roman, bool) else None,
            foliation=_str(data.get("foliation")),
            source=_str(data.get("source")),
            confidence=_num(data.get("confidence")),
            t0=_num(data.get("t0")),
            t1=_num(data.get("t1")),
            speaker=_str(data.get("speaker")),
            path=path_t,
            paragraph=_int(data.get("paragraph")),
            url=_str(data.get("url")),
            accessed=_str(data.get("accessed")),
            n=_int(data.get("n")),
            sheet=_str(data.get("sheet")),
            row_from=_int(data.get("row_from")),
            row_to=_int(data.get("row_to")),
            line_from=_int(data.get("line_from")),
            line_to=_int(data.get("line_to")),
            scheme=_str(data.get("scheme")),
            ref=_str(data.get("ref")),
            region=region,
            chars=chars,
            raw=dict(data),
        )

    def to_dict(self) -> dict[str, Any]:
        """The anchor as a JSON-ready object (the original one when there is one)."""
        if self.raw:
            return dict(self.raw)
        out: dict[str, Any] = {"type": self.type}
        for name in (
            "physical",
            "printed",
            "roman",
            "foliation",
            "source",
            "confidence",
            "t0",
            "t1",
            "speaker",
            "paragraph",
            "url",
            "accessed",
            "n",
            "sheet",
            "row_from",
            "row_to",
            "line_from",
            "line_to",
            "scheme",
            "ref",
        ):
            value = getattr(self, name)
            if value is not None:
                out[name] = value
        if self.path is not None:
            out["path"] = list(self.path)
        if self.region is not None:
            out["region"] = self.region.to_dict()
        if self.chars is not None:
            out["chars"] = list(self.chars)
        return out

    def get(self, key: str, default: Any = None) -> Any:
        """Read any member of the original object (also unknown/extension members)."""
        return self.raw.get(key, default) if self.raw else self.to_dict().get(key, default)

    def uri(self, docref: str, end: Anchor | Mapping[str, Any] | None = None) -> str:
        """The anchor URI of this anchor in the document identified by ``docref``."""
        return make_uri(docref, self, end)


AnchorLike = Anchor | Mapping[str, Any]


def _as_dict(a: AnchorLike | None) -> dict[str, Any] | None:
    if a is None:
        return None
    if isinstance(a, Anchor):
        return a.to_dict()
    return dict(a)


# --- Validation ---------------------------------------------------------------


def _is_int(v: Any) -> bool:
    return _int(v) is not None


def _is_num(v: Any) -> bool:
    n = _num(v)
    return n is not None and math.isfinite(n)


def _required_ok(t: str, a: Mapping[str, Any]) -> bool:
    if t == "page":
        p = _int(a.get("physical"))
        return p is not None and p >= 1 and "printed" in a and (a["printed"] is None or isinstance(a["printed"], str))
    if t == "time":
        t0, t1 = _num(a.get("t0")), _num(a.get("t1"))
        return t0 is not None and t1 is not None and math.isfinite(t0) and math.isfinite(t1) and 0 <= t0 <= t1
    if t == "section":
        path = a.get("path")
        return isinstance(path, list) and all(isinstance(x, str) for x in path)
    if t == "slide":
        n = _int(a.get("n"))
        return n is not None and n >= 1
    if t == "sheet":
        return isinstance(a.get("sheet"), str) and _is_int(a.get("row_from")) and _is_int(a.get("row_to"))
    if t == "web":
        return isinstance(a.get("url"), str)
    if t == "verse":
        return _is_int(a.get("line_from"))
    if t == "canonical":
        return isinstance(a.get("scheme"), str) and isinstance(a.get("ref"), str)
    return True  # image


def anchor_problem(data: Any, text_length: int | None = None) -> tuple[str, str] | None:
    """Check an anchor object. Returns ``(code, message)`` for the first problem, or ``None``.

    ``text_length`` (code points of the NFC unit text) enables the ``chars`` range check (E042).
    """
    if not isinstance(data, Mapping):
        return ("E040", "anchor is not a JSON object")
    t = data.get("type")
    if not isinstance(t, str):
        return ("E040", "anchor has no string 'type'")
    if t not in ANCHOR_TYPES:
        return ("E041", f"unknown anchor type {t!r}")
    if not _required_ok(t, data):
        return ("E040", f"{t} anchor misses or mistypes a required member")
    if "region" in data:
        r = data["region"]
        if not (isinstance(r, Mapping) and all(_is_num(r.get(k)) for k in ("x", "y", "w", "h"))):
            return ("E040", "'region' must be {x, y, w, h} numbers")
    if "chars" in data:
        c = data["chars"]
        if not (isinstance(c, list) and len(c) == 2 and all(_is_int(x) for x in c)):
            return ("E040", "'chars' must be [start, end] integers")
        a, b = _int(c[0]), _int(c[1])
        assert a is not None
        assert b is not None
        if text_length is not None and not (0 <= a <= b <= text_length):
            return ("E042", f"chars [{a}, {b}] out of range (unit text has {text_length} code points)")
    return None


# --- Anchor URI ---------------------------------------------------------------

_ORDER = ("p", "pe", "f", "fe", "t", "s", "para", "sl", "sh", "rows", "v", "ref", "char", "xywh")
_UNRESERVED = frozenset(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
_SHA_REF = re.compile(r"^sha256-[0-9a-f]{64}$")
_INT_RE = re.compile(r"^(0|[1-9][0-9]*)$")
_DEC_RE = re.compile(r"^[0-9]+(\.[0-9]+)?$")
_CLOCK_RE = re.compile(r"^(?:([0-9]+):)?([0-5]?[0-9]):([0-5][0-9](?:\.[0-9]+)?)$")
_BAD_PCT = re.compile(r"%(?![0-9A-Fa-f]{2})")


def _enc(s: str) -> str:
    """Percent-encode every byte except RFC 3986 unreserved characters (uppercase hex)."""
    return "".join(chr(b) if b in _UNRESERVED else f"%{b:02X}" for b in s.encode("utf-8"))


def _dec(s: str) -> str:
    if _BAD_PCT.search(s):
        raise InvalidAnchorError(f"bad percent-encoding in {s!r}")
    try:
        return unquote(s, encoding="utf-8", errors="strict")
    except UnicodeDecodeError:
        raise InvalidAnchorError(f"percent-encoding is not UTF-8 in {s!r}") from None


def _round6(x: float) -> float:
    r = round(float(x), 6)
    return 0.0 if r == 0 else r


def _num_str(x: float | int, decimals: int = 6) -> str:
    if isinstance(x, int) and not isinstance(x, bool):
        return str(x)
    r = round(float(x), decimals)
    return es_number(0.0 if r == 0 else r)


def docref_for(source_sha256: str | None, document_id: str) -> str:
    """The ``<docref>`` of a document: ``sha256-<hex>`` when the hash is valid, else the id (decoded)."""
    if source_sha256 and _HEX64.match(source_sha256.lower()):
        return "sha256-" + source_sha256.lower()
    return document_id


def anchor_to_locator(anchor: AnchorLike, end: AnchorLike | None = None) -> dict[str, Any]:
    """The URI locator (decoded parameters) of an anchor and an optional end anchor."""
    a = _as_dict(anchor) or {}
    e = _as_dict(end)
    t = a.get("type")
    loc: dict[str, Any] = {}
    if t == "page":
        if a.get("physical") is not None:
            loc["p"] = a["physical"]
        if a.get("printed") is not None:
            loc["f"] = a["printed"]
        if e is not None and e.get("type") == "page":
            if e.get("physical") is not None and e["physical"] != a.get("physical"):
                loc["pe"] = e["physical"]
            if e.get("printed") is not None and e.get("printed") != a.get("printed"):
                loc["fe"] = e["printed"]
    elif t == "time":
        t1 = e.get("t1") if e is not None and e.get("type") == "time" else a.get("t1")
        if a.get("t0") is not None:
            loc["t"] = [a["t0"]] if t1 is None else [a["t0"], t1]
    elif t in ("section", "web"):
        if a.get("path"):
            loc["s"] = [str(x) for x in a["path"]]
        if a.get("paragraph") is not None:
            loc["para"] = a["paragraph"]
        if a.get("printed") is not None:
            loc["f"] = a["printed"]
            if e is not None and e.get("printed") is not None and e["printed"] != a["printed"]:
                loc["fe"] = e["printed"]
    elif t == "slide":
        if a.get("n") is not None:
            loc["sl"] = a["n"]
    elif t == "sheet":
        if a.get("sheet") is not None:
            loc["sh"] = a["sheet"]
        if a.get("row_from") is not None and a.get("row_to") is not None:
            loc["rows"] = [a["row_from"], a["row_to"]]
    elif t == "verse":
        lf, lt = a.get("line_from"), a.get("line_to")
        if lf is not None:
            loc["v"] = [lf] if lt is None or lt == lf else [lf, lt]
        if a.get("printed") is not None:
            loc["f"] = a["printed"]
    elif t == "canonical":
        if a.get("scheme") is not None and a.get("ref") is not None:
            loc["ref"] = {"scheme": a["scheme"], "ref": a["ref"]}
    if a.get("chars") is not None:
        loc["char"] = list(a["chars"])
    r = a.get("region")
    if isinstance(r, Mapping):
        loc["xywh"] = [r.get("x"), r.get("y"), r.get("w"), r.get("h")]
    return loc


def format_uri(docref: str, locator: Mapping[str, Any]) -> str:
    """Build the canonical anchor URI from a (decoded) docref and a locator (see :func:`parse_uri`)."""
    ref = docref if _SHA_REF.match(docref) else _enc(docref)
    parts: list[str] = []
    for key in _ORDER:
        if key not in locator or locator[key] is None:
            continue
        v = locator[key]
        if key in ("p", "pe", "para", "sl"):
            parts.append(f"{key}={_num_str(v)}")
        elif key in ("f", "fe", "sh"):
            parts.append(f"{key}={_enc(str(v))}")
        elif key == "t":
            parts.append("t=" + ",".join(_num_str(x) for x in v))
        elif key == "s":
            parts.append("s=" + "/".join(_enc(str(x)) for x in v))
        elif key == "rows":
            parts.append(f"rows={_num_str(v[0])}-{_num_str(v[1])}")
        elif key == "v":
            parts.append("v=" + "-".join(_num_str(x) for x in v))
        elif key == "ref":
            parts.append(f"ref={_enc(str(v['scheme']))}:{_enc(str(v['ref']))}")
        elif key == "char":
            parts.append(f"char={_num_str(v[0])},{_num_str(v[1])}")
        elif key == "xywh":
            parts.append("xywh=percent:" + ",".join(_num_str(round(float(x) * 100, 4), 4) for x in v))
    return f"spdf:{ref}" + ("#" + "&".join(parts) if parts else "")


def make_uri(docref: str, anchor: AnchorLike, end: AnchorLike | None = None) -> str:
    """Anchor URI for ``anchor`` (and optional ``end``) in the document ``docref``."""
    return format_uri(docref, anchor_to_locator(anchor, end))


def _parse_int(s: str, key: str) -> int:
    if not _INT_RE.match(s):
        raise InvalidAnchorError(f"anchor URI parameter {key!r} needs a non-negative integer, got {s!r}")
    return int(s)


def _parse_npt(s: str) -> float:
    if _DEC_RE.match(s):
        return float(s)
    m = _CLOCK_RE.match(s)
    if not m:
        raise InvalidAnchorError(f"bad time value {s!r}")
    h = int(m.group(1) or 0)
    return _round6(h * 3600 + int(m.group(2)) * 60 + float(m.group(3)))


def parse_uri(uri: str) -> dict[str, Any]:
    """Parse an anchor URI into ``{"docref": str, "locator": {...}}`` (docref decoded).

    Locator keys (only those present): ``p``, ``pe``, ``para``, ``sl`` (int); ``f``, ``fe``,
    ``sh`` (str); ``t`` ([t0] or [t0, t1], also W3C ``npt:`` clock values); ``s`` (list of
    str); ``rows`` ([a, b]); ``v`` ([a] or [a, b]); ``ref`` ({"scheme", "ref"}); ``char``
    ([a, b]); ``xywh`` ([x, y, w, h] as fractions). Unknown parameters are ignored;
    malformed, duplicated or out-of-range ones raise :class:`InvalidAnchorError`.
    """
    if not isinstance(uri, str) or not uri.startswith("spdf:"):
        raise InvalidAnchorError(f"not an spdf: URI: {uri!r}")
    docref_raw, _, frag = uri[5:].partition("#")
    if not docref_raw:
        raise InvalidAnchorError("anchor URI without document reference")
    docref = _dec(docref_raw)
    loc: dict[str, Any] = {}
    for item in frag.split("&") if frag else []:
        if not item:
            continue
        key, sep, raw = item.partition("=")
        if not sep:
            raise InvalidAnchorError(f"anchor URI parameter without value: {item!r}")
        if key in loc:
            raise InvalidAnchorError(f"duplicate anchor URI parameter {key!r}")
        if key in ("p", "pe", "para", "sl"):
            loc[key] = _parse_int(raw, key)
            if key in ("p", "pe", "sl") and loc[key] < 1:
                raise InvalidAnchorError(f"{key!r} starts at 1")
        elif key in ("f", "fe", "sh"):
            loc[key] = _dec(raw)
        elif key == "t":
            value = raw[4:] if raw.startswith("npt:") else raw
            xs = [_parse_npt(x) for x in value.split(",")]
            if len(xs) > 2 or (len(xs) == 2 and xs[1] < xs[0]):
                raise InvalidAnchorError("bad 't' (expected t0[,t1] with t1 >= t0)")
            loc["t"] = xs
        elif key == "s":
            loc["s"] = [_dec(x) for x in raw.split("/")]
        elif key == "rows":
            a, dash, b = raw.partition("-")
            if not dash:
                raise InvalidAnchorError("'rows' needs <a>-<b>")
            loc["rows"] = [_parse_int(a, key), _parse_int(b, key)]
        elif key == "v":
            bits = raw.split("-")
            if len(bits) > 2:
                raise InvalidAnchorError("bad 'v'")
            loc["v"] = [_parse_int(x, key) for x in bits]
        elif key == "ref":
            scheme, colon, ref = raw.partition(":")
            if not colon or not scheme:
                raise InvalidAnchorError("'ref' needs <scheme>:<ref>")
            loc["ref"] = {"scheme": _dec(scheme), "ref": _dec(ref)}
        elif key == "char":
            bits = raw.split(",")
            if len(bits) != 2:
                raise InvalidAnchorError("'char' needs <start>,<end>")
            a_i, b_i = _parse_int(bits[0], key), _parse_int(bits[1], key)
            if b_i < a_i:
                raise InvalidAnchorError("'char' end before start")
            loc["char"] = [a_i, b_i]
        elif key == "xywh":
            if not raw.startswith("percent:"):
                raise InvalidAnchorError("'xywh' must use percent: (pixels need the image size)")
            nums = raw[8:].split(",")
            if len(nums) != 4 or not all(_DEC_RE.match(x) for x in nums):
                raise InvalidAnchorError("bad 'xywh'")
            loc["xywh"] = [_round6(float(x) / 100) for x in nums]
        # Unknown parameters are ignored.
    return {"docref": docref, "locator": loc}


def locator_to_anchor(locator: Mapping[str, Any]) -> dict[str, Any]:
    """Best-effort anchor object for a locator (the inverse of :func:`anchor_to_locator`)."""
    loc = locator
    a: dict[str, Any]
    if "p" in loc:
        a = {"type": "page", "physical": loc["p"], "printed": loc.get("f")}
    elif "t" in loc:
        t = loc["t"]
        a = {"type": "time", "t0": t[0], "t1": t[1] if len(t) > 1 else t[0]}
    elif "sl" in loc:
        a = {"type": "slide", "n": loc["sl"]}
    elif "sh" in loc:
        rows = loc.get("rows") or [None, None]
        a = {"type": "sheet", "sheet": loc["sh"], "row_from": rows[0], "row_to": rows[1]}
    elif "v" in loc:
        v = loc["v"]
        a = {"type": "verse", "line_from": v[0]}
        if len(v) > 1:
            a["line_to"] = v[1]
        if "f" in loc:
            a["printed"] = loc["f"]
    elif "ref" in loc:
        a = {"type": "canonical", "scheme": loc["ref"]["scheme"], "ref": loc["ref"]["ref"]}
    elif "s" in loc or "para" in loc:
        a = {"type": "section", "path": list(loc.get("s") or [])}
        if "para" in loc:
            a["paragraph"] = loc["para"]
        if "f" in loc:
            a["printed"] = loc["f"]
    elif "f" in loc:
        a = {"type": "page", "printed": loc["f"]}
    else:
        a = {"type": "image"}
    if "char" in loc:
        a["chars"] = list(loc["char"])
    if "xywh" in loc:
        x, y, w, h = loc["xywh"]
        a["region"] = {"x": x, "y": y, "w": w, "h": h}
    return a
