"""EPUB 2/3: metadata from the OPF, spine order, TOC (nav or NCX) and printed pages.

Printed pages come from the page-list (EPUB3 nav `page-list`, or NCX
`pageList`, whose label is the folio: «23» or Gutenberg's «[23]») and from
`pagebreak` markers in the content. With printed pages, units are the printed
pages (anchor source "epub"); without them, units are sections.
"""
from __future__ import annotations

import posixpath
import re
import zipfile
from html import unescape
from io import BytesIO
from typing import Optional
from xml.etree import ElementTree as ET

from ..model import FigureRead, Source, TocEntry
from .blocks import units_by_pages, units_by_sections
from .html import html_blocks

NS = {"opf": "http://www.idpf.org/2007/opf", "dc": "http://purl.org/dc/elements/1.1/", "ncx": "http://www.daisy.org/z3986/2005/ncx/",
      "c": "urn:oasis:names:tc:opendocument:xmlns:container", "x": "http://www.w3.org/1999/xhtml", "epub": "http://www.idpf.org/2007/ops"}


def _clean_label(s: str) -> str:
    from .html import clean_page_label

    return clean_page_label(s)


def _split_href(base_dir: str, href: str) -> tuple[str, Optional[str]]:
    path, _, frag = href.partition("#")
    from urllib.parse import unquote

    return posixpath.normpath(posixpath.join(base_dir, unquote(path))), (frag or None)


def read_epub(data: bytes, path: Optional[str] = None) -> Source:
    z = zipfile.ZipFile(BytesIO(data))
    container = ET.fromstring(z.read("META-INF/container.xml"))
    opf_path = container.find(".//c:rootfile", NS).get("full-path")
    opf_dir = posixpath.dirname(opf_path)
    opf = ET.fromstring(z.read(opf_path))
    md = opf.find("opf:metadata", NS)
    hints: dict = {}

    def dc(tag):
        return [unescape((e.text or "").strip()) for e in md.findall(f"dc:{tag}", NS) if (e.text or "").strip()] if md is not None else []

    if dc("title"):
        hints["title"] = dc("title")[0]
    if dc("creator"):
        hints["authors"] = dc("creator")
    if dc("language"):
        hints["language"] = dc("language")[0]
    if dc("publisher"):
        hints["publisher"] = dc("publisher")[0]
    if dc("date"):
        hints["date"] = dc("date")[0]
    for ident in dc("identifier"):
        m = re.search(r"(97[89][\d-]{10,14}|\b\d{9}[\dX]\b)", ident)
        if m and "isbn" not in hints:
            hints["isbn"] = m.group(1).replace("-", "")
        if "gutenberg.org" in ident:
            hints["url"] = ident
    if dc("source"):
        hints["source_note"] = dc("source")[0]
    if dc("rights"):
        hints["rights"] = dc("rights")[0]

    manifest = {}
    for it in opf.findall("opf:manifest/opf:item", NS):
        manifest[it.get("id")] = (posixpath.normpath(posixpath.join(opf_dir, it.get("href"))), it.get("media-type"), it.get("properties") or "")
    spine = [manifest[i.get("idref")][0] for i in opf.findall("opf:spine/opf:itemref", NS) if i.get("idref") in manifest]
    names = set(z.namelist())

    # TOC and page list
    toc_raw: list[tuple[int, str, str, Optional[str]]] = []  # level, title, file, frag
    pages_raw: list[tuple[str, str, Optional[str]]] = []  # label, file, frag
    nav = next((p for p, mt, props in manifest.values() if "nav" in props.split()), None)
    if nav and nav in names:
        x = z.read(nav).decode("utf-8", "replace")
        ndir = posixpath.dirname(nav)
        for m in re.finditer(r"<nav\b([^>]*)>(.*?)</nav>", x, re.S | re.I):
            attrs, body = m.group(1), m.group(2)
            if re.search(r"page-list", attrs) or re.search(r"class\s*=\s*[\"'][^\"']*pagelist", attrs, re.I) or \
                    re.search(r"aria-label\s*=\s*[\"']Page List", attrs, re.I):
                for a in re.finditer(r"<a\b[^>]*href\s*=\s*[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", body, re.S | re.I):
                    f, frag = _split_href(ndir, a.group(1))
                    pages_raw.append((_clean_label(a.group(2)), f, frag))
            elif re.search(r"epub:type\s*=\s*[\"']toc", attrs):
                depth = 0
                for t in re.finditer(r"<(/?)(ol|a)\b([^>]*)>(.*?)(?=<)", body, re.S | re.I):
                    if t.group(2).lower() == "ol":
                        depth += -1 if t.group(1) else 1
                        continue
                    if t.group(1):
                        continue
                    href = re.search(r"href\s*=\s*[\"']([^\"']+)", t.group(3))
                    if href:
                        f, frag = _split_href(ndir, href.group(1))
                        title = unescape(re.sub(r"\s+", " ", t.group(4))).strip()
                        if title:
                            toc_raw.append((max(1, depth), title, f, frag))
    ncx = next((p for p, mt, props in manifest.values() if mt == "application/x-dtbncx+xml"), None)
    if ncx and ncx in names:
        n = ET.fromstring(z.read(ncx))
        ndir = posixpath.dirname(ncx)
        if not toc_raw:
            def walk(el, depth):
                for np_ in el.findall("ncx:navPoint", NS):
                    lab = np_.find("ncx:navLabel/ncx:text", NS)
                    src = np_.find("ncx:content", NS)
                    if lab is not None and src is not None:
                        f, frag = _split_href(ndir, src.get("src"))
                        toc_raw.append((depth, (lab.text or "").strip(), f, frag))
                    walk(np_, depth + 1)
            nm = n.find("ncx:navMap", NS)
            if nm is not None:
                walk(nm, 1)
        if not pages_raw:
            for pt in n.findall("ncx:pageList/ncx:pageTarget", NS):
                lab = pt.find("ncx:navLabel/ncx:text", NS)
                src = pt.find("ncx:content", NS)
                if lab is not None and src is not None:
                    f, frag = _split_href(ndir, src.get("src"))
                    pages_raw.append((_clean_label(lab.text or pt.get("value") or ""), f, frag))
    pages_raw = [p for p in pages_raw if p[0]]

    # Content
    page_ids: dict[str, dict[str, str]] = {}
    for lab, f, frag in pages_raw:
        if frag:
            page_ids.setdefault(f, {})[frag] = lab
    blocks_all = []
    file_first_block: dict[str, int] = {}
    images: dict[str, bytes] = {}
    for f in spine:
        if f not in names:
            continue
        html = z.read(f).decode("utf-8", "replace")
        bl = html_blocks(html, page_ids.get(f, {}))
        file_first_block[f] = len(blocks_all)
        for b in bl:
            b.ids = [f"{f}#{i}" for i in b.ids]
            if b.kind == "figure" and b.src:
                ip, _ = _split_href(posixpath.dirname(f), b.src)
                b.src = ip
                if ip in names and ip not in images:
                    images[ip] = z.read(ip)
        from .html import Block

        blocks_all.append(Block("anchor", ids=[f"{f}#"]))
        blocks_all += bl

    has_pages = sum(1 for b in blocks_all if b.kind == "page") >= 3
    if has_pages:
        units, ids = units_by_pages(blocks_all, "epub", "epub")
        kind_note = "pages"
    else:
        units, ids, _toc_sections = units_by_sections(blocks_all, "epub", split_level=2)
        kind_note = "sections"
    for u in units:
        for fig in u.figures:
            src = fig.mime
            fig.mime = "image/jpeg"
            if src in images:
                fig.image = images[src]
                fig.mime = "image/png" if src.lower().endswith(".png") else ("image/gif" if src.lower().endswith(".gif") else "image/jpeg")
    toc = []
    for level, title, f, frag in toc_raw:
        o = ids.get(f"{f}#{frag}") if frag else ids.get(f"{f}#")
        if o is None:
            o = ids.get(f"{f}#")
        toc.append(TocEntry(title, level, o))
    src = Source(path=path, kind="epub", mime="application/epub+zip", data=data, units=units, toc=toc, hints=hints)
    note = {"units": kind_note, "page_list": len(pages_raw), "spine": len(spine),
            "page_markers": sum(1 for b in blocks_all if b.kind == "page")}
    suspicious = long_pages(units)
    if suspicious:
        note["suspicious_long_pages"] = suspicious
        src.warnings.append(f"EPUB: printed pages {suspicious} hold far more words than the median page: possibly "
                            f"several pages merged (a page marker missed)")
    src.provenance_note = note  # type: ignore[attr-defined]
    return src


def long_pages(units) -> list[str]:
    """Coherence check: printed pages with more than 3x the median words (and over 400) are suspicious."""
    counts = [(u.anchor.get("printed"), len(u.text.split())) for u in units if u.anchor.get("printed")]
    if len(counts) < 5:
        return []
    ws = sorted(c for _, c in counts)
    med = ws[len(ws) // 2]
    return [p for p, c in counts if c > max(3 * med, 400)]
