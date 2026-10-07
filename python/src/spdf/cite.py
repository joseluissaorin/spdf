"""Short author-date citations (contract §10): ``(Cervantes, 1605, p. 23)``.

The citation only prints what the anchor says: the printed folio, the second of the
recording, the slide. Pages without a printed folio are cited as ``s. p.`` / ``n. pag.``,
never with the physical index dressed up as a page number.
"""

from __future__ import annotations

import math
import unicodedata
from collections.abc import Mapping, Sequence
from typing import Any

from .anchors import Anchor

__all__ = ["cite", "format_time", "locator_label", "names_label", "year_label"]

_VOWELS = set("aeiouáéíóúü")

_L10N: dict[str, dict[str, str]] = {
    "es": {
        "and": "y",
        "nd": "s. f.",
        "np": "s. p.",
        "slide": "diap.",
        "rows": "filas",
        "row": "fila",
        "para": "párr.",
        "bc": "a. C.",
    },
    "en": {
        "and": "and",
        "nd": "n.d.",
        "np": "n. pag.",
        "slide": "slide",
        "rows": "rows",
        "row": "row",
        "para": "para.",
        "bc": "BC",
    },
}


def _l10n(locale: str) -> dict[str, str]:
    base = (locale or "en").split("-")[0].split("_")[0].lower()
    return _L10N.get(base, _L10N["en"])


def _is_es(locale: str) -> bool:
    return (locale or "").split("-")[0].split("_")[0].lower() == "es"


def _name(person: Any) -> str:
    if isinstance(person, str):
        return person
    if not isinstance(person, Mapping):
        return ""
    literal = person.get("literal")
    if literal:
        return str(literal)
    family = person.get("family")
    if family:
        particle = person.get("non-dropping-particle")
        return (f"{particle} " if particle else "") + str(family)
    given = person.get("given")
    return str(given) if given else ""


def _starts_with_i_sound(word: str) -> bool:
    w = unicodedata.normalize("NFC", word).lower()
    if w.startswith(("hi", "hí")):
        rest = w[2:]
    elif w.startswith(("i", "í")):
        rest = w[1:]
    else:
        return False
    return not (rest and rest[0] in _VOWELS)


def _short_title(metadata: Mapping[str, Any]) -> str:
    short = metadata.get("title-short")
    if short:
        return str(short)
    title = metadata.get("title") or ""
    return str(title).split(":", 1)[0].strip()


def names_label(metadata: Mapping[str, Any], locale: str = "es") -> str:
    """The names part of a citation: ``Cervantes``, ``Deleuze y Guattari``, ``Pérez et al.``."""
    authors = metadata.get("author")
    names = [n for n in (_name(a) for a in authors) if n] if isinstance(authors, list) else []
    if not names:
        return _short_title(metadata)
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        conj = _l10n(locale)["and"]
        if _is_es(locale) and _starts_with_i_sound(names[1]):
            conj = "e"
        return f"{names[0]} {conj} {names[1]}"
    return f"{names[0]} et al."


def year_label(metadata: Mapping[str, Any], locale: str = "es") -> str:
    """The year part: ``1605``, ``350 a. C.`` / ``350 BC``, or ``s. f.`` / ``n.d.``."""
    words = _l10n(locale)
    issued = metadata.get("issued")
    year: int | None = None
    if isinstance(issued, Mapping):
        parts = issued.get("date-parts")
        if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
            first = parts[0][0]
            if isinstance(first, bool):
                first = None
            if isinstance(first, (int, float)) and float(first).is_integer():
                year = int(first)
            elif isinstance(first, str) and first.strip().lstrip("-").isdigit():
                year = int(first.strip())
    if year is None:
        return words["nd"]
    if year <= 0:
        return f"{-year} {words['bc']}"
    return str(year)


def format_time(seconds: float) -> str:
    """``h:mm:ss`` from one hour on, ``m:ss`` below (seconds floored)."""
    s = math.floor(max(0.0, float(seconds)))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def _anchor_dict(a: Anchor | Mapping[str, Any] | None) -> dict[str, Any] | None:
    if a is None:
        return None
    if isinstance(a, Anchor):
        return a.to_dict()
    return dict(a)


def _folio(a: Mapping[str, Any]) -> str:
    printed = str(a.get("printed"))
    return f"[{printed}]" if a.get("source") == "inferred" else printed


def _page_label(a: Mapping[str, Any], e: Mapping[str, Any] | None, locale: str, page_only: bool = False) -> str:
    """Page locator; ends without a printed folio never contribute to a range (SPEC §18)."""
    words = _l10n(locale)
    foliation = "page" if page_only else (a.get("foliation") or "page")
    single, plural = {"leaf": ("fol.", "fols."), "column": ("col.", "cols.")}.get(foliation, ("p.", "pp."))
    ends = [a] + ([e] if e is not None and e.get("type") == a.get("type") else [])
    with_folio = [x for x in ends if x.get("printed") is not None]
    if not with_folio:
        return words["np"]
    first, last = with_folio[0], with_folio[-1]
    if last is not first and last.get("printed") != first.get("printed"):
        return f"{plural} {_folio(first)}-{_folio(last)}"
    return f"{single} {_folio(first)}"


def locator_label(
    anchor: Anchor | Mapping[str, Any],
    end: Anchor | Mapping[str, Any] | None = None,
    locale: str = "es",
) -> str:
    """The locator part of a citation (``p. 145``, ``1:09:20``, ``diap. 3``…), or ``''``."""
    a = _anchor_dict(anchor) or {}
    e = _anchor_dict(end)
    words = _l10n(locale)
    t = a.get("type")
    if t == "page":
        return _page_label(a, e, locale)
    if t == "time":
        t0 = a.get("t0")
        if not isinstance(t0, (int, float)) or isinstance(t0, bool):
            return ""
        label = format_time(t0)
        if e is not None and e.get("type") == "time" and isinstance(e.get("t1"), (int, float)):
            label += "-" + format_time(e["t1"])
        return label
    if t in ("section", "web"):
        if a.get("printed") is not None:
            return _page_label(a, e, locale, page_only=True)
        parts = []
        path = a.get("path")
        if isinstance(path, Sequence) and not isinstance(path, str) and path:
            parts.append(f"§ {path[-1]}")
        if a.get("paragraph") is not None:
            parts.append(f"{words['para']} {a.get('paragraph')}")
        return ", ".join(parts)
    if t == "slide":
        return f"{words['slide']} {a.get('n')}"
    if t == "sheet":
        rf, rt = a.get("row_from"), a.get("row_to")
        if rf == rt:
            return f"{a.get('sheet')}, {words['row']} {rf}"
        return f"{a.get('sheet')}, {words['rows']} {rf}-{rt}"
    if t == "verse":
        lf, lt = a.get("line_from"), a.get("line_to")
        if lt is not None and lt != lf:
            return f"vv. {lf}-{lt}"
        return f"v. {lf}"
    if t == "canonical":
        ref = a.get("ref")
        return str(ref) if ref is not None else ""
    return ""


def cite(
    anchor: Anchor | Mapping[str, Any] | None,
    metadata: Mapping[str, Any],
    locale: str = "es",
    end: Anchor | Mapping[str, Any] | None = None,
) -> str:
    """Short citation ``(names, year[, locator])`` for an anchor in a document.

    ``metadata`` is the CSL-JSON item of the document (``Document.metadata``).
    ``locale`` is ``"es"`` or ``"en"`` (anything else falls back to English).
    """
    parts = [names_label(metadata, locale), year_label(metadata, locale)]
    if anchor is not None:
        loc = locator_label(anchor, end, locale)
        if loc:
            parts.append(loc)
    return "(" + ", ".join(p for p in parts if p) + ")"
