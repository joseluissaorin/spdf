"""Sections of the document.

With a table of contents (PDF outline, EPUB nav, DOCX headings) the TOC wins:
each entry is anchored to the paragraph of its page that best matches the
title. Without one, the titles the reader marked (# in Markdown). Running
heads repeated on many pages are not sections. Port of Scholaris
`pasos/estructura.ts`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..model import Section, TocEntry, Unit
from ..text import fold, markdown_title, similarity, split_paragraphs


def paragraphs_of(u: Unit) -> list[str]:
    return split_paragraphs(u.text)


@dataclass
class _Title:
    unit: int
    para: int
    level: int
    text: str


def titles_from_text(units: list[Unit]) -> list[_Title]:
    found: list[_Title] = []
    for u in units:
        for i, p in enumerate(paragraphs_of(u)):
            t = markdown_title(p)
            if t and len(t[1]) >= 2 and len(t[1].split()) <= 20:
                found.append(_Title(u.ord, i, t[0], t[1]))
    times: dict[str, int] = {}
    for t in found:
        k = fold(t.text)
        times[k] = times.get(k, 0) + 1
    limit = max(3, len(units) * 0.05)
    return [t for t in found if times.get(fold(t.text), 0) < limit and not re.fullmatch(r"[\divxlcdm.\s]+", t.text, re.I)]


def _compact(ts: list[_Title]) -> list[_Title]:
    levels = sorted({t.level for t in ts})
    m = {n: i + 1 for i, n in enumerate(levels)}
    return [_Title(t.unit, t.para, m.get(t.level, t.level), t.text) for t in ts]


def build_sections(titles: list[_Title], total_units: int, doc_id: str) -> list[Section]:
    ordered = sorted(titles, key=lambda t: (t.unit, t.para))
    sections: list[Section] = []
    stack: list[Section] = []
    for k, t in enumerate(ordered):
        while stack and stack[-1].level >= t.level:
            stack.pop()
        s = Section(id=f"{doc_id}:s{k + 1}", parent=stack[-1].id if stack else None, level=t.level, title=t.text,
                    unit_from=t.unit, para_from=t.para, unit_to=total_units)
        sections.append(s)
        stack.append(s)
    for i, s in enumerate(sections):
        nxt = next((x for x in sections[i + 1:] if x.level <= s.level), None)
        if nxt:
            s.unit_to = max(s.unit_from, nxt.unit_from - 1) if nxt.para_from == 0 else nxt.unit_from
    return sections


def _strip_number(t: str) -> str:
    return re.sub(r"^\s*(chapter|cap[ií]tulo|part|parte|libro|book)?\s*([\dIVXLC]+[.)]?)+(\s*[.:—–-])?\s+", "", t, flags=re.I).strip()


def anchor_toc(toc: list[TocEntry], units: list[Unit]) -> list[_Title]:
    by_ord = {u.ord: u for u in units}
    out: list[_Title] = []
    last = (-1, -1)

    def after(u: int, p: int) -> bool:
        return u > last[0] or (u == last[0] and p > last[1])

    for e in toc:
        if e.unit is None:
            continue
        title = _strip_number(e.title) or e.title
        best = None
        score = 0.0
        for o, limit in ((e.unit, 400), (e.unit + 1, 6)):
            u = by_ord.get(o)
            if not u:
                continue
            for i, p in enumerate(paragraphs_of(u)[:limit]):
                if not after(u.ord, i):
                    continue
                md = markdown_title(p)
                clean = _strip_number(md[1] if md else p[:300])
                s = max(similarity(clean, title), similarity(clean[:len(title) + 2], title) - 0.05) + (0.1 if (md or len(p) < 120) else 0)
                if s > score:
                    score, best = s, _Title(u.ord, i, e.level, e.title)
            if score >= 0.7:
                break
        u = by_ord.get(e.unit)
        t = best if best and score >= 0.6 else (_Title(u.ord, 0, e.level, e.title) if u else None)
        if not t:
            continue
        un = by_ord.get(t.unit)
        if un:
            ps = paragraphs_of(un)
            while t.para > 0 and after(t.unit, t.para - 1):
                prev = markdown_title(ps[t.para - 1] if t.para - 1 < len(ps) else "")
                if not prev or len(prev[1].split()) > 5:
                    break
                t = _Title(t.unit, t.para - 1, t.level, t.text)
        if not after(t.unit, t.para):
            t = _Title(last[0], last[1], t.level, t.text)
        last = (t.unit, t.para)
        out.append(t)
    return out


def step_structure(units: list[Unit], toc: list[TocEntry], doc_id: str) -> tuple[list[Section], dict]:
    useful = [e for e in toc if e.unit is not None and e.title.strip()]
    if len(useful) >= 2:
        titles = anchor_toc(useful, units)
        origin = "toc"
        levels = {e.level for e in useful}
        if len(levels) == 1 and titles:
            first = min(titles, key=lambda y: (y.unit, y.para))
            from_text = [x for x in titles_from_text(units) if (x.unit, x.para) > (first.unit, first.para)]
            from_text = [x for x in from_text if not any(similarity(x.text, y.text) > 0.8 or (x.unit == y.unit and y.para - 2 <= x.para <= y.para) for y in titles)]
            base = max(levels)
            if from_text and len(from_text) < len(units) * 1.5:
                titles += [_Title(x.unit, x.para, base + 1, x.text) for x in from_text]
                origin = "toc+text"
    else:
        titles = _compact(titles_from_text(units))
        origin = "text"
    sections = build_sections(titles, len(units), doc_id)
    return sections, {"sections": len(sections), "origin": origin}


def path_of(section: Section | None, by_id: dict[str, Section]) -> list[str]:
    path: list[str] = []
    s = section
    while s:
        path.insert(0, s.title)
        s = by_id.get(s.parent) if s.parent else None
    return path


def remove_running_heads(units: list[Unit]) -> int:
    """Running heads that slipped into the body as «## The Discarded Image» are removed."""
    def form(t: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r"\b[\divxlcdm]+\b", "", fold(t))).strip()

    count: dict[str, int] = {}
    for u in units:
        for zone in (u.header, u.footer):
            for part in re.split(r"\s+/\s+|\n", zone or ""):
                f = form(part)
                if len(f) >= 4:
                    count[f] = count.get(f, 0) + 1
    heads = {f for f, n in count.items() if n >= 3}
    if not heads:
        return 0
    removed = 0
    for u in units:
        ps = split_paragraphs(u.text)
        keep = []
        for i, p in enumerate(ps):
            md = markdown_title(p)
            t = md[1] if md else (p if len(p) < 90 and (i == 0 or i == len(ps) - 1) else None)
            if t is not None and form(t) in heads:
                removed += 1
                continue
            keep.append(p)
        if len(keep) != len(ps):
            u.text = "\n\n".join(keep)
    return removed
