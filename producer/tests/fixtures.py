"""Small inputs generated at test time (nothing binary is committed).

Texts are public domain: Cervantes (1605), the anonymous Lazarillo (1554),
Bécquer (1871), Darwin (1859).
"""
from __future__ import annotations

import io
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

QUIJOTE = ("En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de "
           "lanza en astillero, adarga antigua, rocín flaco y galgo corredor. Una olla de algo más vaca que carnero, salpicón "
           "las más noches, duelos y quebrantos los sábados, lantejas los viernes, algún palomino de añadidura los domingos, "
           "consumían las tres partes de su hacienda. El resto della concluían sayo de velarte, calzas de velludo para las "
           "fiestas, con sus pantuflos de lo mesmo, y los días de entresemana se honraba con su vellorí de lo más fino.")
LAZARILLO = ("Pues sepa Vuestra Merced, ante todas cosas, que a mí llaman Lázaro de Tormes, hijo de Tomé González y de Antona "
             "Pérez, naturales de Tejares, aldea de Salamanca. Mi nacimiento fue dentro del río Tormes, por la cual causa tomé "
             "el sobrenombre, y fue desta manera. Mi padre, que Dios perdone, tenía cargo de proveer una molienda de una aceña, "
             "que está ribera de aquel río, en la cual fue molinero más de quince años.")
DARWIN = ("When on board H.M.S. Beagle, as naturalist, I was much struck with certain facts in the distribution of the inhabitants "
          "of South America, and in the geological relations of the present to the past inhabitants of that continent. These "
          "facts seemed to me to throw some light on the origin of species, that mystery of mysteries, as it has been called "
          "by one of our greatest philosophers.")
OLD = ("Dixo entonces el Cauallero, que assi lo auia de hazer quando la muger se lo pidiesse, y que no auia cosa en el mundo "
       "que mas desseasse que seruir à su señora. Truxo luego el escudero las armas, y vistiolas el hidalgo con mucho cuydado, "
       "y fuesse por el camino adelante, sin otro proposito que el que su cauallo queria.")


def digital_pdf(path: Path, prelims: int = 3, body: int = 8, labels: bool = False) -> Path:
    import pymupdf

    doc = pymupdf.open()
    roman = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"]
    toc = []
    # title page (no folio)
    p = doc.new_page(width=420, height=600)
    p.insert_text((60, 200), "Origin of Species", fontsize=24)
    p.insert_text((60, 240), "Charles Darwin", fontsize=14)
    for i in range(prelims):
        p = doc.new_page(width=420, height=600)
        if i == 0:
            p.insert_text((60, 80), "Preface", fontsize=18)
            toc.append([1, "Preface", doc.page_count])
        p.insert_textbox(pymupdf.Rect(60, 100, 380, 520), DARWIN, fontsize=10)
        p.insert_text((205, 575), roman[i], fontsize=9)
    for i in range(body):
        p = doc.new_page(width=420, height=600)
        if i % 4 == 0:
            p.insert_text((60, 80), f"Chapter {i // 4 + 1}", fontsize=18)
            toc.append([1, f"Chapter {i // 4 + 1}", doc.page_count])
        p.insert_text((60, 30), "ORIGIN OF SPECIES", fontsize=8)
        p.insert_textbox(pymupdf.Rect(60, 100, 380, 520), (DARWIN + " ") * 2, fontsize=10)
        p.insert_text((205, 575), str(i + 1), fontsize=9)
    doc.set_toc(toc)
    doc.set_metadata({"title": "On the Origin of Species", "author": "Charles Darwin"})
    if labels:
        doc.set_page_labels([{"startpage": 1, "prefix": "", "style": "r", "firstpagenum": 1},
                             {"startpage": 1 + prelims, "prefix": "", "style": "D", "firstpagenum": 1}])
    doc.save(path)
    return path


def scanned_pdf(path: Path, pages: int = 6) -> tuple[Path, dict]:
    """Image-only PDF (blank page images); the simulated reader returns the text of each page."""
    import pymupdf
    from PIL import Image

    doc = pymupdf.open()
    truth = {}
    for i in range(pages):
        im = Image.new("RGB", (400, 600), (245, 240, 225))
        from PIL import ImageDraw

        d = ImageDraw.Draw(im)
        for y in range(80, 540, 18):  # lines of «text», so the page is not taken for a blank one
            d.rectangle((50, y, 350, y + 7), fill=(40, 35, 30))
        buf = io.BytesIO()
        im.save(buf, "JPEG")
        p = doc.new_page(width=400, height=600)
        p.insert_image(p.rect, stream=buf.getvalue())
        folio = "" if i < 2 else str(i - 1)
        truth[i + 1] = {"text": OLD if i else "# HISTORIA DEL CAVALLERO\n\nEn Madrid, por Juan de la Cuesta, 1605.",
                        "folio": folio, "header": "Historia del Cauallero" if i >= 2 else "",
                        "footer": "A2" if i == 3 else "", "language": "es",
                        "figures": [{"caption": "Grabado", "description": "Un caballero a caballo.",
                                     "region": {"x": 0.2, "y": 0.6, "w": 0.5, "h": 0.3}}] if i == 4 else []}
    doc.save(path)
    return path, truth


def epub(path: Path, page_list: bool = True) -> Path:
    chap1 = ("<?xml version='1.0' encoding='utf-8'?><html xmlns='http://www.w3.org/1999/xhtml' xmlns:epub='http://www.idpf.org/2007/ops'>"
             "<head><title>I</title></head><body><h1 id='c1'>Capítulo primero</h1>"
             f"<p>{QUIJOTE}</p><span epub:type='pagebreak' id='p2' title='2'/><p>{QUIJOTE}</p>"
             "</body></html>")
    chap2 = ("<?xml version='1.0' encoding='utf-8'?><html xmlns='http://www.w3.org/1999/xhtml' xmlns:epub='http://www.idpf.org/2007/ops'>"
             "<head><title>II</title></head><body><span epub:type='pagebreak' id='p3' title='3'/><h1 id='c2'>Capítulo segundo</h1>"
             f"<p>{LAZARILLO}</p><span epub:type='pagebreak' id='p4' title='4'/><div class='poem'><p>Volverán las oscuras golondrinas<br/>"
             "en tu balcón sus nidos a colgar,<br/>y otra vez con el ala a sus cristales<br/>jugando llamarán.</p></div></body></html>")
    pl = ("<nav epub:type='page-list'><ol><li><a href='c1.xhtml#p1'>1</a></li><li><a href='c1.xhtml#p2'>2</a></li>"
          "<li><a href='c2.xhtml#p3'>3</a></li><li><a href='c2.xhtml#p4'>4</a></li></ol></nav>") if page_list else ""
    nav = ("<?xml version='1.0' encoding='utf-8'?><html xmlns='http://www.w3.org/1999/xhtml' xmlns:epub='http://www.idpf.org/2007/ops'>"
           "<head><title>nav</title></head><body><nav epub:type='toc'><ol><li><a href='c1.xhtml#c1'>Capítulo primero</a></li>"
           f"<li><a href='c2.xhtml#c2'>Capítulo segundo</a></li></ol></nav>{pl}</body></html>")
    if page_list:
        chap1 = chap1.replace("<h1 id='c1'>", "<span id='p1'/><h1 id='c1'>")
    else:
        import re as _re

        chap1 = _re.sub(r"<span epub:type='pagebreak'[^>]*/>", "", chap1)
        chap2 = _re.sub(r"<span epub:type='pagebreak'[^>]*/>", "", chap2)
    opf = ("<?xml version='1.0' encoding='utf-8'?><package xmlns='http://www.idpf.org/2007/opf' version='3.0' unique-identifier='id'>"
           "<metadata xmlns:dc='http://purl.org/dc/elements/1.1/'><dc:identifier id='id'>urn:test:1</dc:identifier>"
           "<dc:title>El ingenioso hidalgo</dc:title><dc:creator>Miguel de Cervantes Saavedra</dc:creator><dc:language>es</dc:language>"
           "</metadata><manifest><item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav'/>"
           "<item id='c1' href='c1.xhtml' media-type='application/xhtml+xml'/><item id='c2' href='c2.xhtml' media-type='application/xhtml+xml'/>"
           "</manifest><spine><itemref idref='c1'/><itemref idref='c2'/></spine></package>")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", "<?xml version='1.0'?><container version='1.0' xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>"
                   "<rootfiles><rootfile full-path='OEBPS/content.opf' media-type='application/oebps-package+xml'/></rootfiles></container>")
        z.writestr("OEBPS/content.opf", opf)
        z.writestr("OEBPS/nav.xhtml", nav)
        z.writestr("OEBPS/c1.xhtml", chap1)
        z.writestr("OEBPS/c2.xhtml", chap2)
    return path


def docx(path: Path) -> Path:
    W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = (f"<w:p><w:pPr><w:pStyle w:val='Heading1'/></w:pPr><w:r><w:t>Tratado primero</w:t></w:r></w:p>"
            f"<w:p><w:r><w:t>{LAZARILLO}</w:t></w:r><w:r><w:footnoteReference w:id='1'/></w:r></w:p>"
            f"<w:p><w:pPr><w:pStyle w:val='Heading1'/></w:pPr><w:r><w:t>Tratado segundo</w:t></w:r></w:p>"
            f"<w:p><w:r><w:t>{QUIJOTE}</w:t></w:r></w:p>")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", "<?xml version='1.0'?><Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>")
        z.writestr("word/document.xml", f"<?xml version='1.0'?><w:document xmlns:w='{W}'><w:body>{body}</w:body></w:document>")
        z.writestr("word/styles.xml", f"<?xml version='1.0'?><w:styles xmlns:w='{W}'><w:style w:styleId='Heading1'><w:name w:val='heading 1'/></w:style></w:styles>")
        z.writestr("word/footnotes.xml", f"<?xml version='1.0'?><w:footnotes xmlns:w='{W}'><w:footnote w:id='1'><w:p><w:r><w:t>Tejares, aldea de Salamanca.</w:t></w:r></w:p></w:footnote></w:footnotes>")
        z.writestr("docProps/core.xml", "<?xml version='1.0'?><cp:coreProperties xmlns:cp='http://schemas.openxmlformats.org/package/2006/metadata/core-properties' "
                   "xmlns:dc='http://purl.org/dc/elements/1.1/'><dc:title>La vida de Lazarillo de Tormes</dc:title><dc:language>es</dc:language></cp:coreProperties>")
    return path


def pptx(path: Path) -> Path:
    P = "http://schemas.openxmlformats.org/presentationml/2006/main"
    A = "http://schemas.openxmlformats.org/drawingml/2006/main"
    R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

    def slide(title, text):
        return (f"<?xml version='1.0'?><p:sld xmlns:p='{P}' xmlns:a='{A}'><p:cSld><p:spTree>"
                f"<p:sp><p:nvSpPr><p:nvPr><p:ph type='title'/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>{title}</a:t></a:r></a:p></p:txBody></p:sp>"
                f"<p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("ppt/presentation.xml", f"<?xml version='1.0'?><p:presentation xmlns:p='{P}' xmlns:r='{R}'><p:sldIdLst>"
                   "<p:sldId id='256' r:id='rId1'/><p:sldId id='257' r:id='rId2'/></p:sldIdLst></p:presentation>")
        z.writestr("ppt/_rels/presentation.xml.rels", "<?xml version='1.0'?><Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>"
                   "<Relationship Id='rId1' Target='slides/slide1.xml' Type='slide'/><Relationship Id='rId2' Target='slides/slide2.xml' Type='slide'/></Relationships>")
        z.writestr("ppt/slides/slide1.xml", slide("The Beagle", DARWIN))
        z.writestr("ppt/slides/slide2.xml", slide("Mystery of mysteries", DARWIN[:200]))
    return path


def xlsx(path: Path) -> Path:
    S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    rows = "".join(f"<row r='{i}'><c r='A{i}' t='inlineStr'><is><t>{a}</t></is></c><c r='B{i}'><v>{b}</v></c></row>"
                   for i, (a, b) in enumerate([("Isla", "Especies"), ("Chatham", 23), ("Albemarle", 41), ("James", 18)], start=1))
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/workbook.xml", f"<?xml version='1.0'?><workbook xmlns='{S}' xmlns:r='{R}'><sheets><sheet name='Galápagos' sheetId='1' r:id='rId1'/></sheets></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels", "<?xml version='1.0'?><Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>"
                   "<Relationship Id='rId1' Target='worksheets/sheet1.xml' Type='worksheet'/></Relationships>")
        z.writestr("xl/worksheets/sheet1.xml", f"<?xml version='1.0'?><worksheet xmlns='{S}'><sheetData>{rows}</sheetData></worksheet>")
    return path


def odt(path: Path) -> Path:
    T = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    O = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    content = (f"<?xml version='1.0'?><office:document-content xmlns:office='{O}' xmlns:text='{T}'><office:body><office:text>"
               f"<text:h text:outline-level='1'>Rimas</text:h><text:p>{QUIJOTE}</text:p></office:text></office:body></office:document-content>")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/vnd.oasis.opendocument.text", compress_type=zipfile.ZIP_STORED)
        z.writestr("content.xml", content)
    return path


def wav(path: Path, seconds: float = 3.0) -> Path | None:
    ff = shutil.which("ffmpeg")
    if not ff:
        return None
    subprocess.run([ff, "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-ac", "1", "-ar", "16000",
                    str(path)], check=True)
    return path


def mp4(path: Path, seconds: float = 4.0) -> Path | None:
    ff = shutil.which("ffmpeg")
    if not ff:
        return None
    subprocess.run([ff, "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=320x240:rate=10", "-f", "lavfi",
                    "-i", f"sine=frequency=330:duration={seconds}", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    str(path)], check=True, capture_output=True)
    return path


def png(path: Path) -> Path:
    from PIL import Image

    Image.new("RGB", (300, 400), (240, 235, 220)).save(path)
    return path


def all_inputs(d: Path) -> dict[str, Path]:
    """Every fixture kind, generated into `d`."""
    d.mkdir(parents=True, exist_ok=True)
    out = {
        "pdf": digital_pdf(d / "darwin.pdf"),
        "pdf-labels": digital_pdf(d / "darwin-labels.pdf", labels=True),
        "epub": epub(d / "quijote.epub"),
        "epub-sections": epub(d / "quijote-sin-paginas.epub", page_list=False),
        "docx": docx(d / "lazarillo.docx"),
        "odt": odt(d / "rimas.odt"),
        "pptx": pptx(d / "beagle.pptx"),
        "xlsx": xlsx(d / "galapagos.xlsx"),
        "image": png(d / "foto.png"),
    }
    (d / "lazarillo.md").write_text(f"---\ntitle: Lazarillo de Tormes\nlanguage: es\n---\n\n# Prólogo\n\n{LAZARILLO}\n\n## Tratado\n\n{QUIJOTE}\n", "utf-8")
    out["markdown"] = d / "lazarillo.md"
    (d / "quijote.txt").write_text(f"CAPÍTULO PRIMERO\n\n{QUIJOTE}\n\n{OLD}\n", "utf-8")
    out["text"] = d / "quijote.txt"
    (d / "darwin.html").write_text(f"<html lang='en'><head><title>Origin</title><meta name='citation_author' content='Darwin, Charles'></head>"
                                   f"<body><nav>menu</nav><article><h1>Introduction</h1><p>{DARWIN}</p><h2>Variation</h2><p>{DARWIN}</p>"
                                   f"</article></body></html>", "utf-8")
    out["html"] = d / "darwin.html"
    (d / "galapagos.csv").write_text("isla,especies\nChatham,23\nAlbemarle,41\n", "utf-8")
    out["csv"] = d / "galapagos.csv"
    sp, truth = scanned_pdf(d / "cauallero.pdf")
    out["scanned_pdf"] = sp
    (d / "cauallero.truth.json").write_text(json.dumps(truth, ensure_ascii=False), "utf-8")
    w = wav(d / "tono.wav")
    if w:
        out["audio"] = w
    v = mp4(d / "prueba.mp4")
    if v:
        out["video"] = v
    return out
