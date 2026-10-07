"""Minimal TEI P5 export (SPEC §19).

``teiHeader`` from the metadata (``titleStmt``, ``publicationStmt`` with the rights,
``sourceDesc`` with the CSL fields) and a ``body`` with ``<pb n="…" facs="…"/>`` before
each page (``n="[21]"`` for inferred folios, no ``n`` for unnumbered pages), ``<p>`` for
paragraphs, ``<lg>``/``<l n>`` for verse, ``<u who>`` for speaker turns and
``<note place="foot">`` for notes. Light Markdown markers are removed; nothing is invented.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any
from xml.sax.saxutils import escape, quoteattr

from .._version import __version__

if TYPE_CHECKING:
    from ..model import Unit
    from ..reader import SpdfFile

__all__ = ["to_tei"]

TEI_NS = "http://www.tei-c.org/ns/1.0"
_MD_PREFIX = re.compile(r"^\s{0,3}(#{1,6}\s+|>\s?)")
_MD_INLINE = re.compile(r"(\*\*|__|`)")
_SPEAKER = re.compile(r"^\*\*([^*]{1,80}):\*\*\s*")


def _clean(text: str) -> str:
    return _MD_INLINE.sub("", _MD_PREFIX.sub("", text))


def _paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _person(p: Any) -> str:
    if not isinstance(p, dict):
        return ""
    if p.get("literal"):
        return str(p["literal"])
    family = " ".join(x for x in (p.get("non-dropping-particle"), p.get("family")) if x)
    given = p.get("given")
    return f"{family}, {given}" if family and given else str(family or given or "")


def _year(meta: dict[str, Any]) -> str | None:
    issued = meta.get("issued")
    if isinstance(issued, dict):
        parts = issued.get("date-parts")
        if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
            return "-".join(f"{int(x):04d}" if i == 0 else f"{int(x):02d}" for i, x in enumerate(parts[0]))
    return None


def _header(f: SpdfFile) -> list[str]:
    d = f.document
    m = d.metadata
    out = ["<teiHeader>", "<fileDesc>", "<titleStmt>", f"<title>{escape(d.display_title)}</title>"]
    for p in m.get("author") or []:
        name = _person(p)
        if name:
            out.append(f"<author>{escape(name)}</author>")
    for p in m.get("editor") or []:
        name = _person(p)
        if name:
            out.append(f"<editor>{escape(name)}</editor>")
    out += ["</titleStmt>", "<publicationStmt>"]
    out.append(
        f"<p>Exported from SPDF <ref target={quoteattr('spdf:' + f.docref)}>spdf:{escape(f.docref)}</ref>"
        f" with spdf-format {escape(__version__)}.</p>"
    )
    rights = d.rights or {}
    if rights:
        lic = rights.get("license")
        note = " ".join(str(x) for x in (rights.get("holder"), rights.get("note")) if x)
        attr = f" target={quoteattr(str(lic))}" if isinstance(lic, str) and lic.startswith("http") else ""
        text = escape(" ".join(x for x in (str(lic) if lic else "", note) if x))
        out.append(f"<availability><licence{attr}>{text}</licence></availability>")
    out += ["</publicationStmt>", "<sourceDesc>", "<bibl>"]
    out.append(f"<title>{escape(str(m.get('title') or d.display_title))}</title>")
    for p in m.get("author") or []:
        name = _person(p)
        if name:
            out.append(f"<author>{escape(name)}</author>")
    for csl, tag in (
        ("container-title", 'title level="m"'),
        ("publisher-place", "pubPlace"),
        ("publisher", "publisher"),
        ("edition", "edition"),
        ("collection-title", "series"),
    ):
        v = m.get(csl)
        if v:
            close = tag.split()[0]
            out.append(f"<{tag}>{escape(str(v))}</{close}>")
    year = _year(m)
    if year:
        out.append(f"<date when={quoteattr(year)}>{escape(year)}</date>")
    for csl, kind in (("DOI", "DOI"), ("ISBN", "ISBN"), ("URL", "URI")):
        v = m.get(csl)
        if v:
            out.append(f"<idno type={quoteattr(kind)}>{escape(str(v))}</idno>")
    out += ["</bibl>", "</sourceDesc>", "</fileDesc>"]
    if d.language:
        out += [
            "<profileDesc>",
            "<langUsage>",
            f"<language ident={quoteattr(d.language)}/>",
            "</langUsage>",
            "</profileDesc>",
        ]
    out.append("</teiHeader>")
    return out


def _unit(u: Unit) -> list[str]:
    a = u.anchor
    out: list[str] = []
    if a.type == "page":
        attrs = ""
        printed = u.printed if u.printed is not None else a.printed
        if printed is not None:
            attrs += f" n={quoteattr(f'[{printed}]' if a.source == 'inferred' else printed)}"
        if u.image:
            attrs += f" facs={quoteattr(u.image)}"
        out.append(f"<pb{attrs}/>")
    if a.type == "verse" and a.line_from is not None:
        out.append("<lg>")
        lines = [ln for ln in u.text.split("\n") if ln.strip()]
        for i, line in enumerate(lines):
            out.append(f"<l n={quoteattr(str(a.line_from + i))}>{escape(_clean(line).strip())}</l>")
        out.append("</lg>")
    elif a.type == "time":
        for para in _paragraphs(u.text):
            m = _SPEAKER.match(para)
            who = m.group(1).strip() if m else a.speaker
            body = para[m.end() :] if m else para
            who_attr = f" who={quoteattr('#' + re.sub(r'[^A-Za-z0-9_.-]+', '_', who))}" if who else ""
            out.append(f"<u{who_attr}>{escape(_clean(body))}</u>")
    elif a.type in ("section", "web") and a.path:
        out.append("<div>")
        out.append(f"<head>{escape(a.path[-1])}</head>")
        out += [f"<p>{escape(_clean(para))}</p>" for para in _paragraphs(u.text)]
        out += [f'<note place="foot">{escape(_clean(n))}</note>' for n in u.notes or []]
        out.append("</div>")
        return out
    else:
        out += [f"<p>{escape(_clean(para))}</p>" for para in _paragraphs(u.text)]
    out += [f'<note place="foot">{escape(_clean(n))}</note>' for n in u.notes or []]
    return out


def to_tei(f: SpdfFile) -> str:
    """A minimal TEI P5 document with the text of every unit."""
    lang = f.document.language
    lang_attr = f" xml:lang={quoteattr(lang)}" if lang else ""
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', f'<TEI xmlns="{TEI_NS}"{lang_attr}>']
    lines += _header(f)
    lines += ["<text>", "<body>"]
    for u in f.iter_units():
        lines += _unit(u)
    lines += ["</body>", "</text>", "</TEI>", ""]
    return "\n".join(lines)
