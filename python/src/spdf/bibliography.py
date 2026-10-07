"""Bibliography export: CSL-JSON and BibTeX (SPEC §19).

* CSL-JSON: the metadata item without its ``spdf`` member, with ``id`` set to the BibTeX
  key. :func:`csl_citation_item` adds the CSL ``locator`` and ``label`` of an anchor.
* BibTeX: entry type from the CSL type, key = first author's family name (or the first
  word of the title) folded to ASCII letters, lowercased, plus the year (or ``nd``);
  collisions inside one export get ``a``, ``b``, ``c``… Exports never invent data.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from .anchors import Anchor
from .cite import format_time
from .model import Document

__all__ = ["bibtex_key", "csl_citation_item", "csl_locator", "csl_to_bibtex", "to_bibtex", "to_csl_json"]

_BIBTEX_TYPES: dict[str, str] = {
    "book": "book",
    "article-journal": "article",
    "article-magazine": "article",
    "article-newspaper": "article",
    "chapter": "incollection",
    "paper-conference": "inproceedings",
    "thesis": "phdthesis",
    "report": "techreport",
}

# (CSL variable, BibTeX field) after author, editor, title, year and the container.
_SIMPLE_FIELDS: tuple[tuple[str, str], ...] = (
    ("publisher", "publisher"),
    ("publisher-place", "address"),
    ("collection-title", "series"),
    ("volume", "volume"),
    ("issue", "number"),
    ("page", "pages"),
    ("edition", "edition"),
    ("DOI", "doi"),
    ("ISBN", "isbn"),
    ("URL", "url"),
    ("language", "language"),
    ("note", "note"),
)


def _ascii_letters(s: str) -> str:
    folded = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    return re.sub(r"[^A-Za-z]", "", folded).lower()


def _year(item: Mapping[str, Any]) -> str | None:
    issued = item.get("issued")
    if isinstance(issued, Mapping):
        parts = issued.get("date-parts")
        if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
            y = parts[0][0]
            if isinstance(y, bool):
                return None
            if isinstance(y, (int, float)) and float(y).is_integer():
                return str(int(y))
            if isinstance(y, str) and y.strip().lstrip("-").isdigit():
                return str(int(y))
    return None


def bibtex_key(item: Mapping[str, Any]) -> str:
    """The base citation key of an item: ``cervantessaavedra1605``, ``lazarillo1554``, ``hookend``."""
    base = ""
    authors = item.get("author")
    if isinstance(authors, list) and authors and isinstance(authors[0], Mapping):
        a = authors[0]
        base = _ascii_letters(str(a.get("family") or a.get("literal") or a.get("given") or ""))
    if not base:
        words = str(item.get("title") or "").split()
        base = _ascii_letters(words[0]) if words else ""
    return (base or "spdf") + (_year(item) or "nd")


_ESCAPES = {"\\": "\\textbackslash{}", "{": "\\{", "}": "\\}"}


def _escape(value: str) -> str:
    return "".join(_ESCAPES.get(c, c) for c in value)


def _protect_title(title: str) -> str:
    """Escape and brace every word the source capitalizes (so styles cannot lowercase it)."""
    out = []
    for token in re.split(r"(\s+)", title):
        esc = _escape(token)
        out.append("{" + esc + "}" if any(c.isupper() for c in token) else esc)
    return "".join(out)


def _names(people: Any) -> str | None:
    if not isinstance(people, Sequence) or isinstance(people, str):
        return None
    out = []
    for p in people:
        if not isinstance(p, Mapping):
            continue
        if p.get("literal"):
            out.append("{" + _escape(str(p["literal"])) + "}")
            continue
        family = str(p.get("family") or "")
        particle = str(p.get("non-dropping-particle") or "")
        if particle and family:
            family = f"{particle} {family}"
        given = str(p.get("given") or "")
        if family and given:
            out.append(f"{_escape(family)}, {_escape(given)}")
        elif family or given:
            out.append("{" + _escape(family or given) + "}")
    return " and ".join(out) or None


def csl_to_bibtex(item: Mapping[str, Any], key: str | None = None) -> str:
    """Convert one CSL-JSON item into a BibTeX entry (SPEC §19)."""
    entry = _BIBTEX_TYPES.get(str(item.get("type") or ""), "misc")
    fields: list[tuple[str, str]] = []
    authors = _names(item.get("author"))
    if authors:
        fields.append(("author", authors))
    editors = _names(item.get("editor"))
    if editors:
        fields.append(("editor", editors))
    title = item.get("title")
    if title:
        fields.append(("title", _protect_title(str(title))))
    year = _year(item)
    if year:
        fields.append(("year", year))
    container = item.get("container-title")
    if container:
        fields.append(("journal" if entry == "article" else "booktitle", _protect_title(str(container))))
    for csl_key, bib_key in _SIMPLE_FIELDS:
        v = item.get(csl_key)
        if v not in (None, "", []):
            fields.append((bib_key, _escape(str(v))))
    k = key or bibtex_key(item)
    body = ",\n".join(f"  {name} = {{{value}}}" for name, value in fields)
    return f"@{entry}{{{k},\n{body}\n}}\n"


def _suffix(n: int) -> str:
    letters = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        letters = chr(97 + r) + letters
    return letters


def _keys(items: Sequence[Mapping[str, Any]]) -> list[str]:
    bases = [bibtex_key(it) for it in items]
    counts: dict[str, int] = {}
    for b in bases:
        counts[b] = counts.get(b, 0) + 1
    seen: dict[str, int] = {}
    out = []
    for b in bases:
        if counts[b] == 1:
            out.append(b)
            continue
        n = seen.get(b, 0)
        seen[b] = n + 1
        out.append(b + _suffix(n))
    return out


def _csl_item(document: Document | Mapping[str, Any]) -> dict[str, Any]:
    meta = document.metadata if isinstance(document, Document) else document
    return {k: v for k, v in meta.items() if k != "spdf"}


def to_csl_json(documents: Document | Iterable[Document]) -> list[dict[str, Any]]:
    """CSL-JSON array (``id`` = BibTeX key, ``spdf`` member removed)."""
    docs = [documents] if isinstance(documents, Document) else list(documents)
    items = [_csl_item(d) for d in docs]
    for item, key in zip(items, _keys(items), strict=True):
        item["id"] = key
    return items


def to_bibtex(documents: Document | Iterable[Document]) -> str:
    """BibTeX entries of one or several documents (keys disambiguated with a, b, c…)."""
    docs = [documents] if isinstance(documents, Document) else list(documents)
    items = [_csl_item(d) for d in docs]
    return "\n".join(csl_to_bibtex(it, k) for it, k in zip(items, _keys(items), strict=True))


def _anchor_dict(a: Anchor | Mapping[str, Any] | None) -> dict[str, Any] | None:
    if a is None:
        return None
    return a.to_dict() if isinstance(a, Anchor) else dict(a)


def _folio(a: Mapping[str, Any]) -> str | None:
    p = a.get("printed")
    if p is None:
        return None
    return f"[{p}]" if a.get("source") == "inferred" else str(p)


def csl_locator(
    anchor: Anchor | Mapping[str, Any], end: Anchor | Mapping[str, Any] | None = None
) -> tuple[str, str] | None:
    """The CSL ``(label, locator)`` of an anchor (``("page", "145-146")``), or ``None``."""
    a = _anchor_dict(anchor) or {}
    e = _anchor_dict(end)
    t = a.get("type")
    if t == "page" or (t in ("section", "web") and a.get("printed") is not None):
        start = _folio(a)
        if start is None:
            return None
        label = "page"
        if t == "page":
            label = {"leaf": "folio", "column": "column"}.get(str(a.get("foliation") or "page"), "page")
        if e is not None and e.get("type") == t and e.get("printed") not in (None, a.get("printed")):
            return label, f"{start}-{_folio(e)}"
        return label, start
    if t == "time" and isinstance(a.get("t0"), (int, float)):
        loc = format_time(float(a["t0"]))
        if e is not None and e.get("type") == "time" and isinstance(e.get("t1"), (int, float)):
            loc += "-" + format_time(float(e["t1"]))
        return "timestamp", loc
    if t in ("section", "web"):
        if a.get("paragraph") is not None:
            return "paragraph", str(a["paragraph"])
        path = a.get("path")
        if isinstance(path, list) and path:
            return "section", str(path[-1])
        return None
    if t == "verse" and a.get("line_from") is not None:
        lf, lt = a["line_from"], a.get("line_to")
        return "verse", str(lf) if lt is None or lt == lf else f"{lf}-{lt}"
    if t == "canonical" and a.get("ref") is not None:
        return "section", str(a["ref"])
    if t == "sheet" and a.get("row_from") is not None:
        rf, rt = a["row_from"], a.get("row_to")
        return "line", str(rf) if rt in (None, rf) else f"{rf}-{rt}"
    return None


def csl_citation_item(
    document: Document,
    anchor: Anchor | Mapping[str, Any] | None,
    end: Anchor | Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """CSL-JSON item of the document plus ``locator`` and ``label`` for an anchor (for citeproc)."""
    item = to_csl_json(document)[0]
    if anchor is not None:
        loc = csl_locator(anchor, end)
        if loc is not None:
            item["label"], item["locator"] = loc
    return item
