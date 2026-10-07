"""Office and text formats, standard library only.

- DOCX: paragraphs with heading styles → titles, footnotes with their call,
  embedded images as figures. Units = sections (Heading 1/2).
- ODT: text:h / text:p, same units.
- PPTX: one unit per slide (anchor slide n), with the speaker notes; slide
  images if LibreOffice (`soffice`) is available to render them.
- XLSX / CSV: one or more units per sheet, blocks of rows (anchor sheet,
  row_from, row_to), as Markdown tables.
- Markdown / TXT / HTML file: sections by headings.
"""
from __future__ import annotations

import csv
import io
import posixpath
import re
import shutil
import subprocess
import tempfile
import zipfile
from typing import Optional
from xml.etree import ElementTree as ET

from ..model import FigureRead, Source, TocEntry, Unit
from .blocks import text_to_blocks, units_by_sections
from .html import Block, html_blocks, html_meta, html_title, main_content

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"
DC = "{http://purl.org/dc/elements/1.1/}"


def _core_props(z: zipfile.ZipFile, name: str = "docProps/core.xml") -> dict:
    out = {}
    try:
        root = ET.fromstring(z.read(name))
    except Exception:
        return out
    for el in root:
        tag = el.tag.split("}")[-1]
        v = (el.text or "").strip()
        if not v:
            continue
        if tag == "title":
            out["title"] = v
        elif tag == "creator":
            out["authors"] = [x.strip() for x in re.split(r";", v) if x.strip()]
        elif tag == "language":
            out["language"] = v
        elif tag in ("created",):
            out["date"] = v
    return out


def _rels(z: zipfile.ZipFile, part: str) -> dict[str, str]:
    d, f = posixpath.split(part)
    rp = posixpath.join(d, "_rels", f + ".rels")
    try:
        root = ET.fromstring(z.read(rp))
    except Exception:
        return {}
    return {r.get("Id"): posixpath.normpath(posixpath.join(d, r.get("Target"))) for r in root.findall(f"{PKG}Relationship")
            if r.get("TargetMode") != "External"}


def _docx_text(p, footnote_calls: bool = True) -> str:
    out = []
    for r in p.iter():
        tag = r.tag
        if tag == f"{W}t":
            out.append(r.text or "")
        elif tag == f"{W}tab":
            out.append(" ")
        elif tag in (f"{W}br", f"{W}cr"):
            out.append("\n")
        elif tag == f"{W}footnoteReference" and footnote_calls:
            out.append(f"[^{r.get(f'{W}id')}]")
    return "".join(out)


def read_docx(data: bytes, path: Optional[str] = None) -> Source:
    z = zipfile.ZipFile(io.BytesIO(data))
    doc = ET.fromstring(z.read("word/document.xml"))
    rels = _rels(z, "word/document.xml")
    styles = {}
    try:
        st = ET.fromstring(z.read("word/styles.xml"))
        for s in st.findall(f"{W}style"):
            name = s.find(f"{W}name")
            sid = s.get(f"{W}styleId")
            if name is not None and sid:
                styles[sid] = name.get(f"{W}val", "")
    except Exception:
        pass
    notes: dict[str, str] = {}
    try:
        fn = ET.fromstring(z.read("word/footnotes.xml"))
        for n in fn.findall(f"{W}footnote"):
            i = n.get(f"{W}id")
            t = " ".join(_docx_text(p, False) for p in n.iter(f"{W}p")).strip()
            if t and i and int(i) > 0:
                notes[i] = t
    except Exception:
        pass
    blocks: list[Block] = []
    body = doc.find(f"{W}body")
    for el in list(body) if body is not None else []:
        if el.tag == f"{W}p":
            ppr = el.find(f"{W}pPr")
            style = ""
            if ppr is not None and ppr.find(f"{W}pStyle") is not None:
                sid = ppr.find(f"{W}pStyle").get(f"{W}val", "")
                style = styles.get(sid, sid)
            text = _docx_text(el).strip()
            for blip in el.iter(f"{A}blip"):
                rid = blip.get(f"{R}embed")
                if rid in rels:
                    b = Block("figure", "", src=rels[rid])
                    blocks.append(b)
            if not text:
                continue
            m = re.match(r"(?i)^(heading|título|titulo|überschrift)\s*(\d)", style)
            if m or style.lower() == "title":
                blocks.append(Block("title", re.sub(r"\s+", " ", text), level=int(m.group(2)) if m else 1))
            else:
                calls = re.findall(r"\[\^(\d+)\]", text)
                blocks.append(Block("para", text if "\n" not in text else text))
                for c in calls:
                    if c in notes:
                        blocks.append(Block("note", f"[^{c}]: {notes[c]}"))
        elif el.tag == f"{W}tbl":
            rows = []
            for tr in el.iter(f"{W}tr"):
                cells = [" ".join(_docx_text(p) for p in tc.iter(f"{W}p")).strip() for tc in tr.findall(f"{W}tc")]
                rows.append("| " + " | ".join(c.replace("|", "/") for c in cells) + " |")
            if rows:
                ncol = rows[0].count("|") - 1
                rows.insert(1, "|" + "---|" * max(1, ncol))
                blocks.append(Block("verse", "\n".join(rows)))
    units, _ids, toc = _sections_with_notes(blocks, "docx")
    for u in units:
        for f in u.figures:
            src = f.mime
            f.mime = "image/png" if (src or "").lower().endswith(".png") else "image/jpeg"
            if src in z.namelist():
                f.image = z.read(src)
    return Source(path=path, kind="document", mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  data=data, units=units, toc=toc, hints=_core_props(z))


def _sections_with_notes(blocks: list[Block], reader: str):
    # Notes become their own paragraphs right after the paragraph that calls them, then move to unit.notes.
    units, ids, toc = units_by_sections([b if b.kind != "note" else Block("para", "\u0000NOTE" + b.text) for b in blocks], reader)
    for u in units:
        paras = u.text.split("\n\n")
        u.notes = [p[5:] for p in paras if p.startswith("\u0000NOTE")]
        u.text = "\n\n".join(p for p in paras if not p.startswith("\u0000NOTE"))
    return units, ids, toc


def read_odt(data: bytes, path: Optional[str] = None) -> Source:
    z = zipfile.ZipFile(io.BytesIO(data))
    root = ET.fromstring(z.read("content.xml"))
    TX = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
    blocks: list[Block] = []

    def text_of(el) -> str:
        out = [el.text or ""]
        for c in el:
            tag = c.tag
            if tag == f"{TX}note":
                cit = c.find(f"{TX}note-citation")
                body = c.find(f"{TX}note-body")
                lab = (cit.text if cit is not None else "") or "*"
                out.append(f"[^{lab}]")
                if body is not None:
                    blocks_notes.append((lab, " ".join(text_of(p) for p in body)))
            elif tag == f"{TX}line-break":
                out.append("\n")
            elif tag in (f"{TX}tab", f"{TX}s"):
                out.append(" ")
            else:
                out.append(text_of(c))
            out.append(c.tail or "")
        return "".join(out)

    blocks_notes: list[tuple[str, str]] = []
    for el in root.iter():
        if el.tag == f"{TX}h":
            lvl = int(el.get(f"{TX}outline-level") or 1)
            t = text_of(el).strip()
            if t:
                blocks.append(Block("title", t, level=lvl))
        elif el.tag == f"{TX}p":
            blocks_notes = []
            t = text_of(el).strip()
            if t:
                blocks.append(Block("para", t))
                for lab, nt in blocks_notes:
                    blocks.append(Block("note", f"[^{lab}]: {nt.strip()}"))
    hints = {}
    try:
        meta = ET.fromstring(z.read("meta.xml"))
        t = meta.find(f".//{DC}title")
        c = meta.find(f".//{DC}creator")
        lg = meta.find(f".//{DC}language")
        if t is not None and (t.text or "").strip():
            hints["title"] = t.text.strip()
        if c is not None and (c.text or "").strip():
            hints["authors"] = [c.text.strip()]
        if lg is not None and (lg.text or "").strip():
            hints["language"] = lg.text.strip()
    except Exception:
        pass
    units, _ids, toc = _sections_with_notes(blocks, "odt")
    return Source(path=path, kind="document", mime="application/vnd.oasis.opendocument.text", data=data, units=units, toc=toc, hints=hints)


def _render_with_soffice(data: bytes, suffix: str) -> Optional[bytes]:
    exe = shutil.which("soffice") or shutil.which("libreoffice")
    if not exe:
        return None
    with tempfile.TemporaryDirectory() as d:
        src = f"{d}/in{suffix}"
        open(src, "wb").write(data)
        subprocess.run([exe, "--headless", "--convert-to", "pdf", "--outdir", d, src], capture_output=True, timeout=300)
        try:
            return open(f"{d}/in.pdf", "rb").read()
        except FileNotFoundError:
            return None


def read_pptx(data: bytes, path: Optional[str] = None, render: bool = True) -> Source:
    z = zipfile.ZipFile(io.BytesIO(data))
    pres = ET.fromstring(z.read("ppt/presentation.xml"))
    prels = _rels(z, "ppt/presentation.xml")
    slides = [prels[s.get(f"{R}id")] for s in pres.iter(f"{P}sldId") if s.get(f"{R}id") in prels]
    units = []
    toc = []
    for i, sp in enumerate(slides):
        root = ET.fromstring(z.read(sp))
        paras = []
        title = None
        for shape in root.iter(f"{P}sp"):
            ph = shape.find(f".//{P}ph")
            is_title = ph is not None and (ph.get("type") or "") in ("title", "ctrTitle")
            for p in shape.iter(f"{A}p"):
                t = "".join(r.text or "" for r in p.iter(f"{A}t")).strip()
                if not t:
                    continue
                if is_title and title is None:
                    title = t
                    paras.append(f"# {t}")
                else:
                    paras.append(t)
        notes = []
        rels = _rels(z, sp)
        for target in rels.values():
            if "notesSlide" in target and target in z.namelist():
                nr = ET.fromstring(z.read(target))
                for shape in nr.iter(f"{P}sp"):
                    ph = shape.find(f".//{P}ph")
                    if ph is not None and ph.get("type") == "sldImg":
                        continue
                    t = " ".join("".join(r.text or "" for r in p.iter(f"{A}t")) for p in shape.iter(f"{A}p")).strip()
                    if t and not re.fullmatch(r"\d+", t):
                        notes.append(t)
        figs = []
        for blip in root.iter(f"{A}blip"):
            rid = blip.get(f"{R}embed")
            if rid in rels and rels[rid] in z.namelist():
                f = FigureRead(image=z.read(rels[rid]))
                f.mime = "image/png" if rels[rid].lower().endswith(".png") else "image/jpeg"
                figs.append(f)
        u = Unit(ord=i + 1, kind="slide", text="\n\n".join(paras), notes=notes, reader="pptx", confidence=1.0, figures=figs,
                 titles=[(1, title)] if title else [])
        u.anchor = {"type": "slide", "n": i + 1}
        if title:
            toc.append(TocEntry(title, 1, i + 1))
        units.append(u)
    pdf = _render_with_soffice(data, ".pptx") if render else None
    if pdf:
        import pymupdf

        d = pymupdf.open(stream=pdf, filetype="pdf")
        for u in units:
            if u.ord - 1 < d.page_count:
                pg = d[u.ord - 1]
                z_ = 1600 / max(pg.rect.width, pg.rect.height)
                u.image = pg.get_pixmap(matrix=pymupdf.Matrix(z_, z_)).tobytes("jpeg", jpg_quality=82)
    return Source(path=path, kind="slides", mime="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  data=data, units=units, toc=toc, hints=_core_props(z))


def _sheet_units(name: str, rows: list[list[str]], start_ord: int, block: int = 40) -> list[Unit]:
    rows = [r for r in rows if any((c or "").strip() for c in r)]
    if not rows:
        return []
    header = rows[0]
    out = []
    for k in range(1, max(2, len(rows)), block):
        chunk = rows[k:k + block] if len(rows) > 1 else []
        lines = ["| " + " | ".join(c.replace("|", "/") for c in header) + " |", "|" + "---|" * len(header)]
        lines += ["| " + " | ".join((c or "").replace("|", "/") for c in r) + " |" for r in chunk]
        u = Unit(ord=start_ord + len(out), kind="sheet", text="\n".join(lines), reader="sheet", confidence=1.0)
        u.anchor = {"type": "sheet", "sheet": name, "row_from": k + 1, "row_to": k + max(1, len(chunk))}
        out.append(u)
    return out


def read_xlsx(data: bytes, path: Optional[str] = None) -> Source:
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    try:
        ss = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in ss.findall(f"{S}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{S}t")))
    except KeyError:
        pass
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = _rels(z, "xl/workbook.xml")
    units: list[Unit] = []
    toc = []
    for sh in wb.iter(f"{S}sheet"):
        name = sh.get("name")
        target = rels.get(sh.get(f"{R}id"))
        if not target or target not in z.namelist():
            continue
        root = ET.fromstring(z.read(target))
        rows = []
        for row in root.iter(f"{S}row"):
            cells: dict[int, str] = {}
            for c in row.findall(f"{S}c"):
                ref = c.get("r") or ""
                col = 0
                for ch in re.match(r"[A-Z]*", ref).group(0):
                    col = col * 26 + (ord(ch) - 64)
                v = c.find(f"{S}v")
                t = c.get("t")
                if t == "s" and v is not None:
                    val = shared[int(v.text)]
                elif t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(f"{S}t"))
                else:
                    val = v.text if v is not None else ""
                cells[max(1, col)] = val or ""
            if cells:
                rows.append([cells.get(i, "") for i in range(1, max(cells) + 1)])
        width = max((len(r) for r in rows), default=0)
        rows = [r + [""] * (width - len(r)) for r in rows]
        su = _sheet_units(name, rows, len(units) + 1)
        if su:
            toc.append(TocEntry(name, 1, su[0].ord))
        units += su
    return Source(path=path, kind="sheet", mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data=data,
                  units=units, toc=toc, hints=_core_props(z))


def read_csv(data: bytes, path: Optional[str] = None) -> Source:
    text = data.decode("utf-8-sig", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:5000], delimiters=",;\t|")
    except Exception:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    name = posixpath.splitext(posixpath.basename(path or "data.csv"))[0]
    units = _sheet_units(name, rows, 1)
    return Source(path=path, kind="sheet", mime="text/csv", data=data, units=units)


def read_text(data: bytes, path: Optional[str] = None, markdown: bool = False) -> Source:
    text = data.decode("utf-8-sig", errors="replace")
    hints = {}
    if markdown and text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end > 0:
            for line in text[4:end].splitlines():
                m = re.match(r"(\w+):\s*(.+)", line)
                if m:
                    k, v = m.group(1).lower(), m.group(2).strip().strip("\"'")
                    if k == "title":
                        hints["title"] = v
                    elif k in ("author", "authors"):
                        hints["authors"] = [x.strip() for x in re.split(r";|,(?=\s*[A-Z])", v.strip("[]")) if x.strip()]
                    elif k in ("lang", "language"):
                        hints["language"] = v
                    elif k == "date":
                        hints["date"] = v
            text = text[end + 4:]
    blocks = text_to_blocks(text, markdown=markdown)
    units, _ids, toc = units_by_sections(blocks, "markdown" if markdown else "text")
    return Source(path=path, kind="document", mime="text/markdown" if markdown else "text/plain", data=data, units=units,
                  toc=toc, hints=hints)


def read_html_file(data: bytes, path: Optional[str] = None) -> Source:
    html = data.decode("utf-8", errors="replace")
    hints = html_meta(html)
    t = hints.get("title") or html_title(html)
    if t:
        hints["title"] = t
    blocks = html_blocks(main_content(html), web=True)
    units, _ids, toc = units_by_sections(blocks, "html")
    return Source(path=path, kind="document", mime="text/html", data=data, units=units, toc=toc, hints=hints)


def read_images(files: list[tuple[str, bytes]], kind: str) -> Source:
    """Photos of pages or a single image. EXIF orientation is applied; reading is done by the vision engine."""
    from PIL import Image, ImageOps

    units = []
    for i, (name, data) in enumerate(files):
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im).convert("RGB")
        out = io.BytesIO()
        im.save(out, "JPEG", quality=88)
        u = Unit(ord=i + 1, kind="page" if kind == "photos" else "image", reader="none", confidence=0.0, needs_vision=True)
        u.image = out.getvalue()
        u.extra["file"] = name
        units.append(u)
    if len(files) == 1:
        data = files[0][1]
        mime = Image.open(io.BytesIO(data)).get_format_mimetype() or "image/jpeg"
    else:
        # several photos: the source is the concatenation in order (its hash identifies the set)
        data = b"".join(d for _, d in files)
        mime = "application/x-spdf-photo-set"

    def render(ord_: int, long_side: int = 1600) -> bytes:
        return units[ord_ - 1].image  # type: ignore[return-value]

    return Source(path=files[0][0] if len(files) == 1 else None, kind=kind, mime=mime, data=data, units=units, render=render)
