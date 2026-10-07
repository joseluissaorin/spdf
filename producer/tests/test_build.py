"""End-to-end builds of every input kind with simulated engines; every output must validate."""
import json
import sqlite3

import pytest
import spdf

from spdf_build.engines.fake import FakeEmbedder, FakeLLM, FakeTranscriber, FakeVision
from spdf_build.pipeline import Engines, Options, build


def engines(vision=None, asr=True):
    return Engines(embedder=FakeEmbedder(32), vision=vision or FakeVision(), llm=FakeLLM({"title": "Obra de prueba",
                   "authors": [{"given": "Miguel", "family": "Cervantes"}], "year": 1605, "language": "es", "csl_type": "book"}),
                   asr=FakeTranscriber(speakers=["Ana", "Luis"]) if asr else None)


def run(inputs, kind, tmp_path, eng=None, **kw):
    out = tmp_path / f"{kind}.spdf"
    rep = build([str(inputs[kind])], str(out), eng or engines(), Options(offline=True, **kw))
    v = spdf.validate(str(out))
    assert v.valid, (kind, v.to_dict())
    assert not v.warnings, (kind, v.to_dict())
    return rep, sqlite3.connect(out)


KINDS = ["pdf", "pdf-labels", "epub", "epub-sections", "docx", "odt", "pptx", "xlsx", "csv", "markdown", "text", "html", "image"]


@pytest.mark.parametrize("kind", KINDS)
def test_every_kind_builds_a_valid_file(inputs, kind, tmp_path):
    rep, db = run(inputs, kind, tmp_path)
    assert rep.units >= 1
    if kind != "image":
        assert rep.fragments >= 1
        assert db.execute("SELECT count(*) FROM vectors WHERE target='fragment'").fetchone()[0] == rep.fragments
    md = json.loads(db.execute("SELECT metadata FROM documents").fetchone()[0])
    assert md["type"] and md["title"]
    assert "provenance" in md["spdf"]


def test_digital_pdf_folios_and_sections(inputs, tmp_path):
    rep, db = run(inputs, "pdf", tmp_path)
    printed = [json.loads(a)["printed"] for (a,) in db.execute("SELECT anchor FROM units ORDER BY ord")]
    assert printed == [None, "i", "ii", "iii", "1", "2", "3", "4", "5", "6", "7", "8"]
    titles = [t for (t,) in db.execute("SELECT title FROM sections ORDER BY unit_from")]
    assert "Preface" in titles and "Chapter 1" in titles
    # the running head is not in the text
    assert not db.execute("SELECT count(*) FROM units WHERE instr(text, 'ORIGIN OF SPECIES') > 0").fetchone()[0]


def test_epub_printed_pages(inputs, tmp_path):
    rep, db = run(inputs, "epub", tmp_path)
    anchors = [json.loads(a) for (a,) in db.execute("SELECT anchor FROM units ORDER BY ord")]
    assert [a["printed"] for a in anchors] == ["1", "2", "3", "4"]
    assert all(a["source"] == "epub" for a in anchors)
    # verse keeps its lines
    assert db.execute("SELECT count(*) FROM units WHERE text LIKE '%golondrinas' || char(10) || '%'").fetchone()[0] == 1


def test_epub_without_page_list_uses_sections(inputs, tmp_path):
    rep, db = run(inputs, "epub-sections", tmp_path)
    anchors = [json.loads(a) for (a,) in db.execute("SELECT anchor FROM units ORDER BY ord")]
    assert all(a["type"] == "section" for a in anchors)
    assert anchors[0]["path"] == ["Capítulo primero"]


def test_scanned_pdf_with_simulated_reader(inputs, scanned_truth, tmp_path):
    rep, db = run(inputs, "scanned_pdf", tmp_path, eng=engines(FakeVision(scanned_truth)))
    rows = db.execute("SELECT ord, anchor, reader, image FROM units ORDER BY ord").fetchall()
    printed = [json.loads(a)["printed"] for _, a, _, _ in rows]
    assert printed[2:] == ["1", "2", "3", "4"]
    assert all(r == "fake-vision" for _, _, r, _ in rows)
    assert all(img and img.startswith("blob:") for *_, img in rows)  # facsimile shipped
    fig = db.execute("SELECT caption, description, anchor FROM figures").fetchall()
    assert fig and json.loads(fig[0][2])["region"]["w"] == 0.5
    # old spelling: the modernized layer is there and finds «así» and «mujer»
    assert db.execute("SELECT count(*) FROM fragments WHERE search_text != ''").fetchone()[0] >= 1
    hits = db.execute("SELECT count(*) FROM fragments_fts WHERE fragments_fts MATCH ?", ('"asi" AND "mujer"',)).fetchone()[0]
    assert hits >= 1
    assert db.execute("SELECT count(*) FROM vectors WHERE target='unit'").fetchone()[0] >= 1


@pytest.mark.parametrize("kind", ["audio", "video"])
def test_media(inputs, kind, tmp_path):
    if kind not in inputs:
        pytest.skip("ffmpeg not available")
    rep, db = run(inputs, kind, tmp_path)
    (anchor, words, text) = db.execute("SELECT anchor, words, text FROM units ORDER BY ord LIMIT 1").fetchone()
    a = json.loads(anchor)
    w = json.loads(words)
    assert a["type"] == "time" and a["t1"] > a["t0"]
    tokens = text.replace("**Ana:** ", "").replace("**Luis:** ", "").split()
    assert len(w["cs"]) == 2 * len(tokens)
    meta = dict(db.execute("SELECT key, value FROM spdf_meta").fetchall())
    assert "media" in meta["profile"].split()
    if kind == "video":
        assert db.execute("SELECT count(*) FROM units WHERE image IS NOT NULL").fetchone()[0] >= 1


def test_blank_pages_skip_the_vision_engine(tmp_path):
    import io

    import pymupdf
    from PIL import Image, ImageDraw

    from spdf_build.pipeline import ink_ratio

    doc = pymupdf.open()
    for k in range(3):
        im = Image.new("RGB", (400, 600), (245, 240, 225))
        if k != 1:
            ImageDraw.Draw(im).rectangle((50, 100, 350, 500), fill=(30, 30, 30))
        b = io.BytesIO()
        im.save(b, "JPEG")
        if k == 1:
            assert ink_ratio(b.getvalue()) < 0.0025
        p = doc.new_page(width=400, height=600)
        p.insert_image(p.rect, stream=b.getvalue())
    path = tmp_path / "b.pdf"
    doc.save(path)
    vision = FakeVision({1: {"text": "Texto de la primera página, bastante largo para no ser poco."},
                         2: {"text": "ALUCINACIÓN"}, 3: {"text": "Texto de la tercera página."}})
    out = tmp_path / "b.spdf"
    build([str(path)], str(out), engines(vision), Options(offline=True))
    db = sqlite3.connect(out)
    assert db.execute("SELECT reader, text FROM units WHERE ord = 2").fetchone() == ("blank-page-detector", "")
    assert spdf.validate(str(out)).valid
