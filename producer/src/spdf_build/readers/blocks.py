"""From a stream of HTML blocks to citable units (printed pages or sections)."""
from __future__ import annotations

import re
from typing import Optional

from ..model import FigureRead, TocEntry, Unit
from ..steps.folios import ROMAN_STRICT, roman_to_int
from .html import Block


GUTENBERG = re.compile(r"project gutenberg|\*\*\*\s*(?:start|end) of (?:the|this) project", re.I)


def block_text(b: Block) -> str:
    if b.kind == "title":
        return f"{'#' * max(1, min(6, b.level))} {b.text}"
    return b.text


def units_by_pages(blocks: list[Block], reader: str, source: str = "epub",
                   on_unit=None) -> tuple[list[Unit], dict[str, int]]:
    """Split at ("page", label) events. Returns units and a map id → unit ord."""
    units: list[Unit] = []
    ids: dict[str, int] = {}
    cur: list[str] = []
    figs: list[FigureRead] = []
    titles: list[tuple[int, str]] = []
    label: Optional[str] = None
    started = False
    starts_cont = False

    def close():
        nonlocal cur, figs, titles
        text = "\n\n".join(cur).strip()
        if not text and not figs and not started and not units:
            cur, figs, titles = [], [], []
            return
        o = len(units) + 1
        printed = label
        roman = bool(printed and ROMAN_STRICT.match(printed) and roman_to_int(printed) > 0)
        u = Unit(ord=o, kind="page", text=text, titles=titles, figures=figs, reader=reader, confidence=1.0,
                 empty=not text, folio_seen=printed)
        nonlocal starts_cont
        if starts_cont:
            u.extra["continues"] = True  # its first paragraph is the end of one split by the page break
        starts_cont = False
        u.anchor = {"type": "page", "physical": o, "printed": printed, "roman": roman, "foliation": "page",
                    "source": source if printed else "none", "confidence": 1.0 if printed else 0.0}
        u.extra["printed"] = printed
        if not printed:
            u.anchor["matter"] = "library" if GUTENBERG.search(text[:3000]) else ("front" if not units else "back")
        units.append(u)
        if on_unit:
            on_unit(u)
        cur, figs, titles = [], [], []

    pending_ids: list[str] = []
    for b in blocks:
        if b.kind == "page":
            if cur or figs or units or started:
                close()
            elif cur or figs:
                close()
            label = b.label
            started = True
            continue
        for i in b.ids:
            pending_ids.append(i)
        if b.kind == "anchor":
            continue
        if label is not None and re.search(r"\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG", b.text, re.I):
            # Project Gutenberg licence after the last printed page: its own unit, without folio.
            close()
            label = None
        for i in pending_ids:
            ids[i] = len(units) + 1
        pending_ids = []
        if b.kind == "figure":
            figs.append(FigureRead(caption=b.text, description="", region=None, image=None))
            figs[-1].mime = b.src or ""
            continue
        if b.kind == "title":
            titles.append((b.level, b.text))
        if b.cont and not cur:
            starts_cont = True
        cur.append(block_text(b))
    close()
    for i in pending_ids:
        ids[i] = len(units)
    return units, ids


def units_by_sections(blocks: list[Block], reader: str, split_level: int = 2, anchor_type: str = "section",
                      base_anchor: Optional[dict] = None, max_chars: int = 40_000) -> tuple[list[Unit], dict[str, int], list[TocEntry]]:
    """Split at titles of level <= split_level. Each unit anchors {"type":"section","path":[…]}."""
    units: list[Unit] = []
    ids: dict[str, int] = {}
    toc: list[TocEntry] = []
    path: list[tuple[int, str]] = []
    cur: list[str] = []
    figs: list[FigureRead] = []
    titles: list[tuple[int, str]] = []
    cur_path: list[str] = []

    def close():
        nonlocal cur, figs, titles
        text = "\n\n".join(cur).strip()
        if not text and not figs:
            cur, figs, titles = [], [], []
            return
        o = len(units) + 1
        a = dict(base_anchor or {})
        a.update({"type": anchor_type, "path": list(cur_path), "paragraph": 0})
        if GUTENBERG.search(text[:3000]) and anchor_type == "section":
            a["matter"] = "library"
        u = Unit(ord=o, kind=anchor_type, text=text, titles=titles, figures=figs, reader=reader, confidence=1.0, anchor=a)
        units.append(u)
        cur, figs, titles = [], [], []

    pending: list[str] = []
    size = 0
    for b in blocks:
        pending += b.ids
        if b.kind in ("anchor", "page"):
            continue
        if b.kind == "title" and b.level <= split_level:
            close()
            size = 0
            while path and path[-1][0] >= b.level:
                path.pop()
            path.append((b.level, b.text))
            cur_path = [t for _, t in path]
            toc.append(TocEntry(b.text, b.level, len(units) + 1))
        elif size > max_chars and b.kind == "para":
            close()
            size = 0
        for i in pending:
            ids[i] = len(units) + 1
        pending = []
        if b.kind == "figure":
            figs.append(FigureRead(caption=b.text))
            figs[-1].mime = b.src or ""
            continue
        if b.kind == "title":
            titles.append((b.level, b.text))
        t = block_text(b)
        cur.append(t)
        size += len(t)
    close()
    return units, ids, toc


def text_to_blocks(text: str, markdown: bool = True) -> list[Block]:
    """Markdown or plain text → blocks (titles by #, or by «CHAPTER I» lines in plain text)."""
    out: list[Block] = []
    for para in re.split(r"\n\s*\n", text.replace("\r\n", "\n").replace("\r", "\n")):
        p = para.strip("\n")
        if not p.strip():
            continue
        m = re.match(r"^(#{1,6})\s+(.+?)\s*#*$", p.strip()) if markdown else None
        if m and "\n" not in p.strip():
            out.append(Block("title", m.group(2).strip(), level=len(m.group(1))))
            continue
        if markdown and re.match(r"^[^\n]+\n(=+|-+)\s*$", p.strip()):
            t, u = p.strip().split("\n")
            out.append(Block("title", t.strip(), level=1 if u.startswith("=") else 2))
            continue
        img = re.match(r"^!\[([^\]]*)\]\(([^)\s]+)", p.strip()) if markdown else None
        if img:
            out.append(Block("figure", img.group(1), src=img.group(2)))
            continue
        lines = [l.rstrip() for l in p.split("\n")]
        if not markdown and len(lines) == 1 and re.match(r"^(CHAPTER|CAP[ÍI]TULO|BOOK|LIBRO|PART|PARTE|ACTO|ACT)\b", lines[0].strip(), re.I):
            out.append(Block("title", lines[0].strip(), level=1))
            continue
        short = sum(1 for l in lines if len(l.strip()) < 60)
        if len(lines) >= 3 and short >= len(lines) * 0.8 and not any(re.search(r"\w-$", l) for l in lines):
            out.append(Block("verse", "\n".join(l.strip() for l in lines)))
        else:
            from ..text import join_lines

            out.append(Block("para", join_lines(p)))
    return out
