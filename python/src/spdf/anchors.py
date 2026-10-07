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
from urllib.parse import quote, unquote

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
            "physical", "printed", "roman", "foliation", "source", "confidence", "t0", "t1", "speaker",
            "paragraph", "url", "accessed", "n", "sheet", "row_from", "row_to", "line_from", "line_to",
            "scheme", "ref",
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

_REQUIRED: dict[str, tuple[tuple[str, str], ...]] = {
    "page": (("physical", "int>=1"), ("printed", "str|null")),
    "time": (("t0", "num"), ("t1", "num")),
    "section": (("path", "str[]"),),
    "slide": (("n", "int"),),
    "sheet": (("sheet", "str"), ("row_from", "int"), ("row_to", "int")),
    "web": (("url", "str"),),
    "image": (),
    "verse": (("line_from", "int"),),
    "canonical": (("scheme", "str"), ("ref", "str")),
}


def _type_ok(value: Any, kind: str) -> bool:
    if kind == "int":
        return _int(value) is not None
    if kind == "int>=1":
        i = _int(value)
        return i is not None and i >= 1
    if kind == "num":
        n = _num(value)
        return n is not None and math.isfinite(n)
    if kind == "str":
        return isinstance(value, str)
    if kind == "str|null":
        return value is None or isinstance(value, str)
    if kind == "str[]":
        return isinstance(value, list) and all(isinstance(x, str) for x in value)
    return False


def anchor_problem(data: Any, text_length: int | None = None) -> tuple[str, str] | None:
    """Check an anchor object. Returns ``(code, message)`` for the first problem, or ``None``.

    ``text_length`` (code points of the unit text) enables the ``chars`` range check (E042).
    """
    if not isinstance(data, Mapping):
        return ("E040", "anchor is not a JSON object")
    t = data.get("type")
    if not isinstance(t, str):
        return ("E040", "anchor has no string 'type'")
    if t not in ANCHOR_TYPES:
        return ("E041", f"unknown anchor type {t!r}")
    for member, kind in _REQUIRED[t]:
        if member not in data:
            return ("E040", f"{t} anchor lacks required member {member!r}")
        if not _type_ok(data[member], kind):
            return ("E040", f"{t} anchor member {member!r} must be {kind}")
    if "chars" in data:
        c = data["chars"]
        if not (isinstance(c, list) and len(c) == 2 and all(_int(x) is not None for x in c)):
            return ("E040", "'chars' must be [start, end] integers")
        a, b = _int(c[0]), _int(c[1])
        assert a is not None and b is not None
        if a < 0 or b < a or (text_length is not None and b > text_length):
            limit = "" if text_length is None else f" (unit text has {text_length} code points)"
            return ("E042", f"chars [{a}, {b}] out of range{limit}")
    return None


# --- Anchor URI ---------------------------------------------------------------

_ORDER = ("p", "pe", "f", "fe", "t", "s", "para", "sl", "sh", "rows", "v", "ref", "char", "xywh")


def _enc(s: str) -> str:
    return quote(s, safe="", encoding="utf-8")


def _num_str(x: float, decimals: int) -> str:
    r = round(float(x), decimals)
    if r == 0:
        r = 0.0
    if r.is_integer() and abs(r) < 1e21:
        return str(int(r))
    return es_number(r)


def docref_for(source_sha256: str | None, document_id: str) -> str:
    """The ``<docref>`` of a document: ``sha256-<hex>`` when the hash is valid, else the id."""
    if source_sha256 and _HEX64.match(source_sha256.lower()):
        return "sha256-" + source_sha256.lower()
    return _enc(document_id)


def anchor_to_locator(anchor: AnchorLike, end: AnchorLike | None = None) -> dict[str, Any]:
    """Compute the URI locator (the decoded parameters) of an anchor and optional end anchor."""
    a = _as_dict(anchor) or {}
    e = _as_dict(end)
    t = a.get("type")
    loc: dict[str, Any] = {}
    if t == "page":
        p = _int(a.get("physical"))
        if p is not None:
            loc["p"] = p
            if e is not None and e.get("type") == "page":
                pe = _int(e.get("physical"))
                if pe is not None and pe != p:
                    loc["pe"] = pe
    printed = a.get("printed") if t in ("page", "section", "verse") else None
    if isinstance(printed, str):
        loc["f"] = printed
        if e is not None:
            fe = e.get("printed")
            if isinstance(fe, str) and fe != printed:
                loc["fe"] = fe
    if t == "time":
        t0, t1 = _num(a.get("t0")), _num(a.get("t1"))
        if e is not None and e.get("type") == "time" and _num(e.get("t1")) is not None:
            t1 = _num(e.get("t1"))
        if t0 is not None:
            loc["t"] = [t0] if t1 is None else [t0, t1]
    if t in ("section", "web"):
        path = a.get("path")
        if isinstance(path, list) and path:
            loc["s"] = [str(x) for x in path]
        para = _int(a.get("paragraph"))
        if para is not None:
            loc["para"] = para
    if t == "slide" and _int(a.get("n")) is not None:
        loc["sl"] = _int(a.get("n"))
    if t == "sheet":
        if isinstance(a.get("sheet"), str):
            loc["sh"] = a["sheet"]
        rf, rt = _int(a.get("row_from")), _int(a.get("row_to"))
        if rf is not None and rt is not None:
            loc["rows"] = [rf, rt]
    if t == "verse":
        lf, lt = _int(a.get("line_from")), _int(a.get("line_to"))
        if lf is not None:
            loc["v"] = [lf] if lt is None or lt == lf else [lf, lt]
    if t == "canonical" and isinstance(a.get("scheme"), str) and isinstance(a.get("ref"), str):
        loc["ref"] = {"scheme": a["scheme"], "ref": a["ref"]}
    c = a.get("chars")
    if isinstance(c, list) and len(c) == 2 and _int(c[0]) is not None and _int(c[1]) is not None:
        loc["char"] = [_int(c[0]), _int(c[1])]
    r = a.get("region")
    if isinstance(r, Mapping):
        vals = [_num(r.get(k)) for k in ("x", "y", "w", "h")]
        if all(v is not None for v in vals):
            loc["xywh"] = vals
    return loc


def format_uri(docref: str, locator: Mapping[str, Any]) -> str:
    """Build the canonical anchor URI from a docref and a locator (see :func:`parse_uri`)."""
    parts: list[str] = []
    for key in _ORDER:
        if key not in locator or locator[key] is None:
            continue
        v = locator[key]
        if key in ("p", "pe", "para", "sl"):
            parts.append(f"{key}={int(v)}")
        elif key in ("f", "fe", "sh"):
            parts.append(f"{key}={_enc(str(v))}")
        elif key == "t":
            parts.append("t=" + ",".join(_num_str(x, 6) for x in v))
        elif key == "s":
            parts.append("s=" + "/".join(_enc(str(x)) for x in v))
        elif key == "rows":
            parts.append(f"rows={int(v[0])}-{int(v[1])}")
        elif key == "v":
            parts.append("v=" + "-".join(str(int(x)) for x in v))
        elif key == "ref":
            parts.append(f"ref={_enc(str(v['scheme']))}:{_enc(str(v['ref']))}")
        elif key == "char":
            parts.append(f"char={int(v[0])},{int(v[1])}")
        elif key == "xywh":
            parts.append("xywh=percent:" + ",".join(_num_str(float(x) * 100, 4) for x in v))
    return f"spdf:{docref}#" + "&".join(parts) if parts else f"spdf:{docref}"


def make_uri(docref: str, anchor: AnchorLike, end: AnchorLike | None = None) -> str:
    """Anchor URI for ``anchor`` (and optional ``end``) in the document ``docref``."""
    return format_uri(docref, anchor_to_locator(anchor, end))


def _parse_int(s: str, key: str) -> int:
    try:
        return int(s)
    except ValueError:
        raise InvalidAnchorError(f"anchor URI parameter {key!r} needs an integer, got {s!r}") from None


def _parse_float(s: str, key: str) -> float:
    try:
        x = float(s)
    except ValueError:
        raise InvalidAnchorError(f"anchor URI parameter {key!r} needs a number, got {s!r}") from None
    if not math.isfinite(x):
        raise InvalidAnchorError(f"anchor URI parameter {key!r} must be finite")
    return x


def parse_uri(uri: str) -> dict[str, Any]:
    """Parse an anchor URI into ``{"docref": str, "locator": {...}}``.

    Locator keys (only those present): ``p``, ``pe``, ``para``, ``sl`` (int); ``f``, ``fe``,
    ``sh`` (str); ``t`` ([t0, t1]); ``s`` (list of str); ``rows`` ([a, b]); ``v`` ([a] or
    [a, b]); ``ref`` ({"scheme", "ref"}); ``char`` ([a, b]); ``xywh`` ([x, y, w, h] as
    fractions). Unknown parameters are ignored.
    """
    if not isinstance(uri, str) or not uri.startswith("spdf:"):
        raise InvalidAnchorError(f"not an spdf: URI: {uri!r}")
    rest = uri[5:]
    docref, _, frag = rest.partition("#")
    if not docref:
        raise InvalidAnchorError("anchor URI without document reference")
    loc: dict[str, Any] = {}
    for item in frag.split("&") if frag else []:
        if not item:
            continue
        key, sep, raw = item.partition("=")
        if not sep:
            continue
        if key in ("p", "pe", "para", "sl"):
            loc[key] = _parse_int(unquote(raw), key)
        elif key in ("f", "fe", "sh"):
            loc[key] = unquote(raw)
        elif key == "t":
            loc["t"] = [_parse_float(unquote(x), key) for x in raw.split(",") if x != ""]
        elif key == "s":
            loc["s"] = [unquote(x) for x in raw.split("/")]
        elif key == "rows":
            a, _, b = unquote(raw).partition("-")
            loc["rows"] = [_parse_int(a, key), _parse_int(b or a, key)]
        elif key == "v":
            bits = unquote(raw).split("-")
            loc["v"] = [_parse_int(x, key) for x in bits[:2]]
        elif key == "ref":
            scheme, sep2, ref = raw.partition(":")
            if not sep2:
                raise InvalidAnchorError("'ref' needs <scheme>:<ref>")
            loc["ref"] = {"scheme": unquote(scheme), "ref": unquote(ref)}
        elif key == "char":
            a, _, b = unquote(raw).partition(",")
            loc["char"] = [_parse_int(a, key), _parse_int(b or a, key)]
        elif key == "xywh":
            v = unquote(raw)
            if v.startswith("percent:"):
                nums = [_parse_float(x, key) for x in v[8:].split(",")]
                if len(nums) != 4:
                    raise InvalidAnchorError("'xywh' needs four numbers")
                loc["xywh"] = [_clean(round(x / 100, 6)) for x in nums]
            else:
                # Pixels (W3C default unit) cannot be mapped without the image size: keep raw.
                loc["xywh_pixels"] = [_parse_float(x, key) for x in v.removeprefix("pixel:").split(",")]
    return {"docref": docref, "locator": loc}


def _clean(x: float) -> float:
    return 0.0 if x == 0 else x


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
