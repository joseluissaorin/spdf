"""EPUB page markers: a page-list that omits pages must not merge them into the previous one."""
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest

from spdf_build.readers.epub import read_epub
from spdf_build.readers.html import html_blocks

P = "Uno dos tres cuatro cinco seis siete ocho nueve diez. "


def make_epub(path: Path) -> Path:
    body = (f"<p>Portada.</p><p><a class='x-ebookmaker-pageno' title='1' id='Page_1'></a>{P * 5}</p>"
            f"<p>{P * 6} mitad de la frase <a class='x-ebookmaker-pageno' title='2' id='Page_2'></a> sigue en la dos. {P * 6}</p>"
            f"<p>{P * 6}</p><p class='page-break-after'>Este párrafo tiene una clase de maquetación y no es un folio.</p>"
            f"<p>{P * 3}<a class='x-ebookmaker-pageno' title='3' id='Page_3'></a> {P * 6}</p>"
            f"<p>{P * 3}<a class='x-ebookmaker-pageno' title='[4]' id='Page_4'></a> {P * 6}</p>")
    html = ("<?xml version='1.0' encoding='utf-8'?><html xmlns='http://www.w3.org/1999/xhtml'><head><title>t</title></head>"
            f"<body>{body}</body></html>")
    # the page-list omits pages 2 and 4, as Gutenberg's ebookmaker does
    ncx = ("<?xml version='1.0'?><ncx xmlns='http://www.daisy.org/z3986/2005/ncx/'><navMap><navPoint id='n1'><navLabel><text>I</text>"
           "</navLabel><content src='t.xhtml'/></navPoint></navMap><pageList>"
           "<pageTarget value='1'><navLabel><text>[1]</text></navLabel><content src='t.xhtml#Page_1'/></pageTarget>"
           "<pageTarget value='2'><navLabel><text>[3]</text></navLabel><content src='t.xhtml#Page_3'/></pageTarget>"
           "</pageList></ncx>")
    opf = ("<?xml version='1.0'?><package xmlns='http://www.idpf.org/2007/opf' version='3.0'><metadata xmlns:dc='http://purl.org/dc/elements/1.1/'>"
           "<dc:title>Prueba</dc:title><dc:language>es</dc:language></metadata><manifest>"
           "<item id='t' href='t.xhtml' media-type='application/xhtml+xml'/><item id='ncx' href='toc.ncx' media-type='application/x-dtbncx+xml'/>"
           "</manifest><spine toc='ncx'><itemref idref='t'/></spine></package>")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml", "<?xml version='1.0'?><container xmlns='urn:oasis:names:tc:opendocument:xmlns:container' version='1.0'>"
                   "<rootfiles><rootfile full-path='content.opf' media-type='application/oebps-package+xml'/></rootfiles></container>")
        z.writestr("content.opf", opf)
        z.writestr("toc.ncx", ncx)
        z.writestr("t.xhtml", html)
    return path


def test_markers_missing_from_the_page_list_are_page_breaks(tmp_path):
    s = read_epub(make_epub(tmp_path / "p.epub").read_bytes())
    labels = [u.anchor.get("printed") for u in s.units]
    assert labels == [None, "1", "2", "3", "4"]
    two = s.units[2]
    assert two.text.startswith("sigue en la dos.")
    assert two.extra.get("continues")  # the break fell inside a paragraph
    assert not s.units[1].extra.get("continues")  # page 1 starts a paragraph
    assert "clase de maquetación" in s.units[2].text  # a page-break-after paragraph is text, not a marker
    assert all(u.anchor["source"] == "epub" for u in s.units[1:])


def test_continued_paragraph_is_joined_into_one_fragment(tmp_path):
    from spdf_build.engines.fake import FakeEmbedder, FakeLLM
    from spdf_build.pipeline import Engines, Options, build

    out = tmp_path / "p.spdf"
    build([str(make_epub(tmp_path / "p.epub"))], str(out), Engines(embedder=FakeEmbedder(16), llm=FakeLLM()), Options(offline=True))
    db = sqlite3.connect(out)
    rows = [(t, json.loads(a), json.loads(e) if e else None) for t, a, e in db.execute("SELECT text, anchor, anchor_end FROM fragments")]
    crossing = [r for r in rows if "mitad de la frase sigue en la dos" in r[0]]
    assert crossing and crossing[0][2]["printed"] == "2"  # one fragment, ending on p. 2


def test_page_class_tokens():
    bl = html_blocks("<p class='page-break-before'>texto</p><span class='pagenum'>[12]</span><p>más</p>")
    assert [b.kind for b in bl] == ["para", "page", "para"] and bl[1].label == "12"


KAFKA = Path("/tmp/spdf-kafka-epub/kafka-22367.epub")


@pytest.mark.skipif(not KAFKA.exists(), reason="Kafka, Die Verwandlung (PG 22367) not downloaded")
def test_kafka_22367_every_page():
    s = read_epub(KAFKA.read_bytes())
    labels = [u.anchor.get("printed") for u in s.units if u.anchor.get("printed")]
    assert labels == [str(i) for i in range(5, 76)]
    p23 = next(u for u in s.units if u.anchor.get("printed") == "23")
    assert p23.text.startswith("Leibe zu spüren bekommt")


def test_fragments_never_join_numbered_and_unnumbered_pages(tmp_path):
    from spdf_build.model import Unit
    from spdf_build.steps.fragments import chunk

    def page(o, printed, text):
        u = Unit(ord=o, kind="page", text=text)
        u.anchor = {"type": "page", "physical": o, "printed": printed, "roman": False, "foliation": "page",
                    "source": "read" if printed else "none", "confidence": 1}
        return u

    units = [page(1, None, "Portada y créditos de la edición, con algunas palabras más."),
             page(2, "1", "Texto de la primera página que sigue sin terminar la frase y"),
             page(3, "2", "continúa en la segunda página hasta el final del libro. " * 3),
             page(4, None, "*** END OF THE PROJECT GUTENBERG EBOOK *** licencia " * 3)]
    frs = chunk(units, [], "d")
    for f in frs:
        ends = {f.anchor.get("printed") is None, (f.anchor_end or f.anchor).get("printed") is None}
        assert len(ends) == 1, (f.text[:60], f.anchor, f.anchor_end)
    joined = [f for f in frs if "sin terminar la frase y continúa" in f.text]
    assert joined and joined[0].anchor["printed"] == "1" and joined[0].anchor_end["printed"] == "2"
