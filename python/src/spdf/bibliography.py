"""Bibliography export: CSL-JSON and BibTeX (contract §10)."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from typing import Any

from .model import Document

__all__ = ["bibtex_key", "csl_to_bibtex", "to_bibtex", "to_csl_json"]

_BIBTEX_TYPES: dict[str, str] = {
    "book": "book",
    "article": "article",
    "article-journal": "article",
    "article-magazine": "article",
    "article-newspaper": "article",
    "chapter": "incollection",
    "entry-encyclopedia": "incollection",
    "entry-dictionary": "incollection",
    "paper-conference": "inproceedings",
    "thesis": "phdthesis",
    "report": "techreport",
    "manuscript": "unpublished",
    "webpage": "online",
    "post-weblog": "online",
    "speech": "misc",
    "interview": "misc",
    "broadcast": "misc",
    "motion_picture": "misc",
    "song": "misc",
    "dataset": "misc",
    "graphic": "misc",
    "document": "misc",
}

_SIMPLE_FIELDS: tuple[tuple[str, str], ...] = (
    ("publisher", "publisher"),
    ("publisher-place", "address"),
    ("volume", "volume"),
    ("issue", "number"),
    ("page", "pages"),
    ("edition", "edition"),
    ("DOI", "doi"),
    ("ISBN", "isbn"),
    ("ISSN", "issn"),
    ("URL", "url"),
    ("language", "language"),
    ("collection-title", "series"),
    ("abstract", "abstract"),
    ("original-title", "origtitle"),
    ("note", "note"),
)


def to_csl_json(document: Document) -> list[dict[str, Any]]:
    """CSL-JSON array with the document's item (``id`` = document id; ``spdf`` extension removed)."""
    return [document.csl]


def _ascii(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def bibtex_key(item: Mapping[str, Any]) -> str:
    """A citation key ``familyYEARword`` in ASCII (``cervantes1605ingenioso``)."""
    family = ""
    authors = item.get("author") or item.get("editor")
    if isinstance(authors, list) and authors and isinstance(authors[0], Mapping):
        a = authors[0]
        family = str(a.get("family") or a.get("literal") or a.get("given") or "")
    year = ""
    issued = item.get("issued")
    if isinstance(issued, Mapping):
        parts = issued.get("date-parts")
        if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
            year = str(parts[0][0])
    title = str(item.get("title") or "")
    stop = {
        "a",
        "an",
        "the",
        "el",
        "la",
        "los",
        "las",
        "lo",
        "un",
        "una",
        "de",
        "del",
        "le",
        "les",
        "il",
        "der",
        "die",
    }
    word = next((w for w in re.findall(r"\w+", _ascii(title).lower()) if w not in stop), "")
    words = family.split()
    # First capitalized word of the family name ("Cervantes Saavedra" -> cervantes, "de la Fuente" -> fuente).
    first = next((w for w in words if w[:1].isupper()), words[0] if words else "")
    family_key = re.sub(r"[^a-z0-9]", "", _ascii(first).lower())
    key = f"{family_key}{year}{word}"
    return key or "spdf"


_SPECIAL = {
    "\\": r"\textbackslash{}",
    "{": r"\{",
    "}": r"\}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}


def _escape(value: str) -> str:
    return "".join(_SPECIAL.get(c, c) for c in value)


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
        if particle:
            family = f"{particle} {family}"
        given = str(p.get("given") or "")
        if family and given:
            out.append(f"{_escape(family)}, {_escape(given)}")
        elif family or given:
            out.append("{" + _escape(family or given) + "}")
    return " and ".join(out) or None


def _date(item: Mapping[str, Any], key: str) -> tuple[str | None, str | None]:
    issued = item.get(key)
    if not isinstance(issued, Mapping):
        return None, None
    parts = issued.get("date-parts")
    if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
        year = str(parts[0][0])
        month = str(parts[0][1]) if len(parts[0]) > 1 else None
        return year, month
    literal = issued.get("literal") or issued.get("raw")
    return (str(literal), None) if literal else (None, None)


def csl_to_bibtex(item: Mapping[str, Any], key: str | None = None) -> str:
    """Convert one CSL-JSON item into a BibTeX entry (biblatex-compatible field names)."""
    csl_type = str(item.get("type") or "document")
    entry = _BIBTEX_TYPES.get(csl_type, "misc")
    fields: list[tuple[str, str]] = []
    authors = _names(item.get("author"))
    if authors:
        fields.append(("author", authors))
    editors = _names(item.get("editor"))
    if editors:
        fields.append(("editor", editors))
    translators = _names(item.get("translator"))
    if translators:
        fields.append(("translator", translators))
    title = item.get("title")
    if title:
        fields.append(("title", "{" + _escape(str(title)) + "}"))
    container = item.get("container-title")
    if container:
        field_name = {"article": "journal", "incollection": "booktitle", "inproceedings": "booktitle"}.get(
            entry, "howpublished"
        )
        fields.append((field_name, _escape(str(container))))
    year, month = _date(item, "issued")
    if year:
        fields.append(("year", _escape(year)))
    if month:
        fields.append(("month", month))
    orig_year, _ = _date(item, "original-date")
    if orig_year:
        fields.append(("origdate", _escape(orig_year)))
    for csl_key, bib_key in _SIMPLE_FIELDS:
        v = item.get(csl_key)
        if v not in (None, ""):
            fields.append((bib_key, _escape(str(v))))
    if csl_type == "thesis" and item.get("genre"):
        fields.append(("type", _escape(str(item["genre"]))))
    if entry == "misc" and csl_type not in ("document", "misc"):
        fields.append(("entrysubtype", csl_type))
    k = key or bibtex_key(item)
    body = ",\n".join(f"  {name} = {{{value}}}" for name, value in fields)
    return f"@{entry}{{{k},\n{body}\n}}\n"


def to_bibtex(document: Document) -> str:
    """BibTeX entry of a document."""
    return csl_to_bibtex(document.csl)
