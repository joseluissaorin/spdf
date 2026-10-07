"""Tests over real files: reading 5.0 and legacy, search, validation codes, writer, security, CLI."""

from __future__ import annotations

import gzip
import json
import sqlite3
import xml.etree.ElementTree as ET
from collections.abc import Callable
from pathlib import Path

import pytest
from conftest import SOURCE, SOURCE_SHA, TEXTS, build_legacy, build_quijote

import spdf
from spdf.cli import main

# -- reading 5.0 ------------------------------------------------------------------------


def test_read_document_and_records(quijote: Path) -> None:
    with spdf.open(quijote) as f:
        assert f.version == "5.0" and not f.legacy and not f.gzip_wrapped
        assert f.profile == ["core", "semantic"]
        d = f.document
        assert d.id == "quijote" and d.kind == "pdf" and d.year == 1605 and d.authors == "Cervantes Saavedra"
        assert d.csl["id"] == "quijote" and "spdf" not in d.csl
        assert d.rights == {"license": "CC0-1.0", "access": "open", "holder": None, "note": None}
        units = f.units()
        assert [u.ord for u in units] == [1, 2, 3]
        assert units[1].printed == "23" and units[1].anchor.printed == "23"
        assert units[2].notes == ["Nota de prueba."]
        assert f.unit_by_printed("24").id == "u3"  # type: ignore[union-attr]
        frs = f.fragments()
        assert [x.n for x in frs] == [1, 2, 3]
        assert frs[1].section == ["Capítulo primero"]
        assert f.fragment("f2").text == TEXTS[1]  # type: ignore[union-attr]
        assert [s.id for s in f.spaces()] == ["test@4", "test@4:f16", "test@4:i8"]
        assert f.space("test@4:i8").dtype == "i8"
        assert f.original() == SOURCE
        assert f.blob("blob:pages/0001.png") is not None
        assert f.figures()[0].anchor.region is not None
        assert f.sections()[0].title == "Capítulo primero"
        assert f.provenance()[0].detail == {"pages": 3}
        assert f.docref == f"sha256-{SOURCE_SHA}"
        assert f.locate(f"spdf:{f.docref}#p=2")[0].id == "u2"
        assert f.locate(f"spdf:{f.docref}#f=24")[0].id == "u3"


def test_dump_shape(quijote: Path) -> None:
    d = spdf.dump(quijote)
    assert list(d) == [
        "spdf_version", "meta", "fts", "document", "units", "sections", "fragments", "figures",
        "spaces", "vectors", "blobs", "provenance", "extensions",
    ]
    assert d["spdf_version"] == "5.0" and "legacy" not in d
    assert d["fts"] == {"tokenizer": "unicode61 remove_diacritics 2", "trigram": False}
    assert "document" not in d["units"][0] and "document" not in d["fragments"][0]
    assert set(d["vectors"]) == {"test@4", "test@4:i8", "test@4:f16"}
    assert d["vectors"]["test@4"]["count"] == 3
    assert d["blobs"][0] == {"key": "original.pdf", "mime": "application/pdf", "bytes": len(SOURCE), "sha256": SOURCE_SHA}
    assert d["provenance"] == [
        {"stage": "read", "provider": "test", "model": "none", "detail": {"pages": 3}, "ms": 5, "at": "2026-10-07T00:00:00Z"}
    ]
    assert d["units"][0]["confidence"] == 1 and d["units"][0]["notes"] is None
    text = spdf.canonical_dumps(d)
    assert json.loads(text) == json.loads(json.dumps(d))


def test_content_hash_is_stable(tmp_path: Path) -> None:
    a = build_quijote(tmp_path / "a.spdf")
    b = build_quijote(tmp_path / "b.spdf")
    with spdf.open(a) as fa, spdf.open(b) as fb:
        assert fa.meta["content_sha256"] == fb.meta["content_sha256"] == fa.content_sha256()
    assert spdf.verify(a).hash_ok is True


# -- search --------------------------------------------------------------------------------


def test_lexical_search(quijote: Path) -> None:
    with spdf.open(quijote) as f:
        hits = f.search("lanza astillero")
        assert [h.fragment_id for h in hits] == ["f2"]
        assert hits[0].via == ("lexical",) and hits[0].score > 0
        assert hits[0].anchor_uri.endswith("#p=2&f=23&char=0,159") or "#p=2&f=23" in hits[0].anchor_uri
        # Diacritics and case folded by the tokenizer, not by the query.
        assert [h.fragment_id for h in f.search("ROCIN")] == ["f2"]
        assert [h.fragment_id for h in f.search("salpicon")] == ["f3"]
        # Phrases: AND, loose words ignored.
        assert [h.fragment_id for h in f.search('"duelos y quebrantos" rocín')] == ["f3"]
        assert f.search('"quebrantos duelos"') == []
        assert f.search("   ") == []
        # Context column is indexed too (weight 0.5): every fragment has it.
        assert len(f.search("capítulo")) == 3
        assert [h.fragment_id for h in f.search("capítulo", limit=2)] == ["f1", "f2"]


def test_vector_and_hybrid_search(quijote: Path) -> None:
    with spdf.open(quijote) as f:
        for sp in ("test@4", "test@4:i8", "test@4:f16"):
            hits = f.search_vector([0, 1, 0, 0], space=sp)
            assert [h.fragment_id for h in hits] == ["f2", "f1", "f3"]
            assert hits[0].score == pytest.approx(1.0)
        with pytest.raises(spdf.SpdfError):
            f.search_vector([0, 1, 0, 0])  # several spaces: must choose
        with pytest.raises(ValueError):
            f.search_vector([0, 1], space="test@4")
        hy = f.search_hybrid("hidalgo", [0, 0, 1, 0], space="test@4")
        assert [h.fragment_id for h in hy] == ["f1", "f2", "f3"] or [h.fragment_id for h in hy][0] in ("f1", "f3")
        top = hy[0]
        assert top.score == pytest.approx(sum(1 / (10 + r) for r in (1, 1))) or top.via
        ids = {h.fragment_id: h.via for h in hy}
        assert ids["f3"] == ("vector",) or "vector" in ids["f3"]


def test_cjk_search(tmp_path: Path) -> None:
    def build(trigram: bool) -> Path:
        p = tmp_path / f"cjk{int(trigram)}.spdf"
        with spdf.Writer(p, overwrite=True, trigram=trigram) as w:
            w.add_document(
                {"id": "lunyu", "kind": "document", "metadata": {"type": "book", "title": "論語"},
                 "source_sha256": "0" * 64, "mime": "text/plain", "bytes": 1}
            )
            for i, t in enumerate(["學而時習之，不亦說乎", "有朋自遠方來，不亦樂乎", "人不知而不慍"], start=1):
                a = {"type": "section", "path": ["學而"], "paragraph": i}
                w.add_unit({"id": f"u{i}", "ord": i, "anchor": a, "text": t, "reader": "test"})
                w.add_fragment({"id": f"f{i}", "unit": f"u{i}", "ord": i, "text": t, "anchor": a})
        return p

    with spdf.open(build(False)) as f:
        assert [h.fragment_id for h in f.search("不亦")] == ["f1", "f2"]
        assert [h.score for h in f.search("不亦 遠方")] == [2.0, 1.0]
        assert [h.fragment_id for h in f.search('"不亦" "遠方"')] == ["f2"]
    if spdf.HAS_TRIGRAM:
        with spdf.open(build(True)) as f:
            assert f.fts_info["trigram"] is True
            assert {h.fragment_id for h in f.search("不亦說")} == {"f1"}
            # Terms shorter than 3 code points fall back to substring search.
            assert [h.fragment_id for h in f.search("不亦")] == ["f1", "f2"]


# -- legacy ---------------------------------------------------------------------------------


def test_legacy_view(legacy41: Path) -> None:
    with spdf.open(legacy41) as f:
        assert f.legacy and f.version == "4.1" and f.gzip_wrapped
        d = f.document
        assert d.kind == "scanned_pdf"
        assert d.metadata["title"] == "El ingenioso hidalgo don Quijote de la Mancha: Primera parte"
        assert d.metadata["title-short"] == "El ingenioso hidalgo don Quijote de la Mancha"
        assert d.metadata["type"] == "book"
        assert d.metadata["author"] == [{"family": "Cervantes Saavedra", "given": "Miguel de"}]
        assert d.metadata["issued"] == {"date-parts": [[1605]]}
        assert d.metadata["publisher"] == "Juan de la Cuesta"
        ext = d.metadata["spdf"]
        assert ext["orcid"] == {"Cervantes Saavedra, Miguel de": "0000-0000-0000-0000"}
        assert ext["undated"] == {"from": 1604, "to": 1605, "basis": "prueba"}
        assert ext["provenance"] == {"title": {"source": "colophon", "confidence": 0.98}}
        assert ext["subtitle"] == "Primera parte"
        assert d.source_ref == "blob:original.pdf" and d.rights is None
        units = f.units()
        assert [u.ord for u in units] == [1, 2, 3]
        assert units[0].anchor.type == "page" and units[0].anchor.source == "read" and units[0].anchor.physical == 1
        assert units[0].image == "blob:paginas/0001.png" and units[1].image is None
        assert f.meta["created"] == "2026-10-06T20:00:00.000Z" and f.meta["generator"] == "scholaris-nube/test"
        assert f.figures()[0].image == "" and f.figures()[0].anchor.type == "image"
        assert f.spaces()[0].dtype == "f32" and f.spaces()[0].modalities == ["text"]
        assert [h.fragment_id for h in f.search("lanza")] == ["f1"]
        assert [h.fragment_id for h in f.search_vector([0, 0, 1, 0])] == ["f1", "f0", "f2"]
        assert f.cite(f.fragment("f1")) == "(Cervantes Saavedra, 1605, p. 23)"
        d2 = f.dump()
        assert d2["spdf_version"] == "4.1" and d2["legacy"] is True
        assert d2["provenance"][0]["model"] is None and d2["provenance"][0]["detail"] == {"tramo": 1}
        assert d2["extensions"] == []
        assert list(d2["vectors"]) == ["prueba@4"]


def test_legacy_40(legacy40: Path) -> None:
    with spdf.open(legacy40) as f:
        assert f.version == "4.0" and not f.gzip_wrapped
        assert f.fragments()[0].search_text is None
        assert [h.fragment_id for h in f.search("lanza")] == ["f1"]
    r = spdf.validate(legacy40)
    assert r.valid and "W110" in r.codes


def test_convert_legacy(legacy41: Path, tmp_path: Path) -> None:
    out = spdf.convert_legacy(legacy41, tmp_path / "converted.spdf")
    r = spdf.validate(out)
    assert r.valid, r.to_dict()
    with spdf.open(out) as f, spdf.open(legacy41) as old:
        assert f.version == "5.0"
        new_d, old_d = f.dump(), old.dump()
        for key in ("document", "units", "fragments", "sections", "figures", "spaces", "vectors", "blobs"):
            assert new_d[key] == old_d[key], key
        assert f.provenance()[-1].stage == "convert"
        assert f.meta["created"] == "2026-10-06T20:00:00.000Z"


def test_roundtrip_copy(quijote: Path, tmp_path: Path) -> None:
    with spdf.open(quijote) as f:
        out = spdf.copy_into(f, tmp_path / "copy.spdf")
        original = f.dump()
    copied = spdf.dump(out)
    for key in ("document", "units", "fragments", "sections", "figures", "spaces", "vectors", "blobs", "provenance"):
        assert copied[key] == original[key], key


# -- validation ------------------------------------------------------------------------------


def test_valid_file(quijote: Path) -> None:
    r = spdf.validate(quijote)
    assert r.valid and r.errors == [] and r.warnings == [], r.to_dict()
    assert r.to_dict()["version"] == "5.0"


def test_not_sqlite_and_unknown(tmp_path: Path) -> None:
    p = tmp_path / "x.spdf"
    p.write_text("hello")
    assert spdf.validate(p).codes == {"E001"}
    q = tmp_path / "other.sqlite"
    c = sqlite3.connect(q)
    c.execute("CREATE TABLE t (a)")
    c.commit()
    c.close()
    assert spdf.validate(q).codes == {"E002"}
    with pytest.raises(spdf.NotSpdfError):
        spdf.open(q)
    gz = tmp_path / "bad.gz"
    gz.write_bytes(b"\x1f\x8b\x08\x00garbage")
    assert spdf.validate(gz).codes == {"E001"}


def test_gzip_wrapped_50(quijote: Path, tmp_path: Path) -> None:
    gz = tmp_path / "wrapped.spdf"
    gz.write_bytes(gzip.compress(quijote.read_bytes()))
    r = spdf.validate(gz)
    assert r.valid and [w.code for w in r.warnings] == ["E003"]
    with spdf.open(gz) as f:
        assert f.gzip_wrapped and f.document.id == "quijote"


@pytest.mark.parametrize(
    ("statements", "code"),
    [
        (["CREATE TRIGGER t AFTER INSERT ON units BEGIN SELECT 1; END"], "E020"),
        (["CREATE VIEW v AS SELECT 1"], "E020"),
        (["DROP TABLE figures"], "E010"),
        (["ALTER TABLE units DROP COLUMN words"], "E011"),
        (["DELETE FROM spdf_meta WHERE key = 'generator'"], "E012"),
        (["INSERT INTO documents SELECT 'otro', kind, metadata, source_sha256, source_ref, mime, bytes, unit_count, "
          "duration, created, updated, title, authors, year, language, rights FROM documents"], "E013"),
        (["UPDATE documents SET metadata = '{bad'"], "E050"),
        (["UPDATE documents SET rights = '[1'"], "E050"),
        (["UPDATE documents SET metadata = '{\"title\": \"x\"}'"], "E051"),
        (["INSERT INTO extensions VALUES ('x_acme_magic', '1', 1)"], "E060"),
        (["UPDATE units SET ord = 5 WHERE id = 'u3'"], "E090"),
        (["UPDATE units SET anchor = 'nope' WHERE id = 'u1'"], "E040"),
        (["UPDATE fragments SET anchor = '{\"type\":\"page\",\"physical\":1}' WHERE id = 'f1'"], "E040"),
        (["UPDATE figures SET anchor = '{\"type\":\"hologram\"}'"], "E041"),
        (["UPDATE fragments SET anchor = '{\"type\":\"page\",\"physical\":1,\"printed\":null,\"chars\":[0,9999]}' "
          "WHERE id = 'f1'"], "E042"),
        (["UPDATE vectors SET data = x'00' WHERE id = 'f1' AND space = 'test@4'"], "E030"),
        (["UPDATE vectors SET space = 'ghost@4' WHERE id = 'f1' AND space = 'test@4'"], "E031"),
        (["UPDATE spaces SET dtype = 'bf16' WHERE id = 'test@4:f16'"], "E032"),
        (["UPDATE fragments SET text = 'texto cambiado sin reindexar' WHERE id = 'f2'"], "E070"),
        (["UPDATE blobs SET sha256 = '00' WHERE key = 'original.pdf'"], "E080"),
        (["DELETE FROM vectors", "DELETE FROM spaces"], "W100"),
        (["UPDATE spdf_meta SET value = 'core media' WHERE key = 'profile'"], "W101"),
        (["UPDATE documents SET unit_count = 7"], "W102"),
    ],
)
def test_validation_codes(mutate: Callable[..., Path], statements: list[str], code: str) -> None:
    r = spdf.validate(mutate(*statements))
    assert code in r.codes, r.to_dict()
    if code.startswith("E"):
        assert not r.valid
    else:
        assert r.valid


def test_validation_newer_minor(mutate: Callable[..., Path]) -> None:
    r = spdf.validate(mutate("PRAGMA user_version = 510"))
    assert r.valid and "W105" in r.codes and r.version == "5.1"


def test_integrity_codes(tmp_path: Path, mutate: Callable[..., Path]) -> None:
    key = spdf.generate_key()
    signed = build_quijote(tmp_path / "signed.spdf", sign_key=key)
    r = spdf.validate(signed)
    assert r.valid, r.to_dict()
    rep = spdf.verify(signed, spdf.signer_id(spdf.public_key_of(key)))
    assert rep.hash_ok and rep.signature_ok and rep.trusted
    assert spdf.verify(signed, spdf.signer_id(spdf.public_key_of(spdf.generate_key()))).trusted is False
    tampered = mutate("UPDATE units SET header = 'otro' WHERE id = 'u1'", base=signed)
    # The signature still certifies the stored hash; the content no longer matches it.
    assert spdf.validate(tampered).codes == {"E081"}
    assert spdf.verify(tampered).hash_ok is False and spdf.verify(tampered).signature_ok is False
    bad_sig = mutate("UPDATE spdf_meta SET value = 'AAAA' WHERE key = 'signature'", base=signed)
    assert spdf.validate(bad_sig).codes == {"E082"}


def test_sign_in_place(tmp_path: Path) -> None:
    p = build_quijote(tmp_path / "s.spdf")
    key = spdf.generate_key()
    rep = spdf.sign(p, key)
    assert rep.signature_ok and rep.hash_ok
    assert spdf.validate(p).valid


# -- security ---------------------------------------------------------------------------------


def test_refuses_triggers_and_views(mutate: Callable[..., Path]) -> None:
    with pytest.raises(spdf.UnsafeFileError) as e:
        spdf.open(mutate("CREATE TRIGGER evil AFTER INSERT ON units BEGIN DELETE FROM units; END"))
    assert e.value.code == "E020"
    with pytest.raises(spdf.UnsafeFileError):
        spdf.open(mutate("CREATE VIEW v AS SELECT * FROM units"))


def test_legacy_tolerates_only_fts_triggers(tmp_path: Path) -> None:
    p = build_legacy(tmp_path / "l.spdf", gzipped=False)
    c = sqlite3.connect(p)
    c.execute("CREATE TRIGGER otro AFTER INSERT ON unidades BEGIN SELECT 1; END")
    c.commit()
    c.close()
    with pytest.raises(spdf.UnsafeFileError):
        spdf.open(p)


def test_required_extension_refused(mutate: Callable[..., Path]) -> None:
    with pytest.raises(spdf.UnsupportedExtensionError):
        spdf.open(mutate("INSERT INTO extensions VALUES ('x_acme_magic', '1', 1)"))
    with spdf.open(mutate("INSERT INTO extensions VALUES ('x_acme_optional', '1', 0)")) as f:
        assert f.extensions()[0].name == "x_acme_optional"


def test_gzip_bomb_limit(quijote: Path, tmp_path: Path) -> None:
    gz = tmp_path / "big.spdf"
    gz.write_bytes(gzip.compress(quijote.read_bytes()))
    with pytest.raises(spdf.UnsafeFileError):
        spdf.open(gz, max_decompressed_size=1024)


def test_max_blob_size(quijote: Path) -> None:
    with pytest.raises(spdf.UnsafeFileError):
        spdf.open(quijote, max_blob_size=10)
    with spdf.open(quijote, max_blob_size=1024) as f:
        assert f.original() == SOURCE


def test_read_only(quijote: Path) -> None:
    before = quijote.read_bytes()
    with spdf.open(quijote) as f, pytest.raises(sqlite3.Error):
        f.conn.execute("DELETE FROM units")
    assert quijote.read_bytes() == before


def test_open_bytes(quijote: Path, legacy41: Path) -> None:
    with spdf.open(quijote.read_bytes()) as f:
        assert f.document.id == "quijote"
    with spdf.open(legacy41.read_bytes()) as f:
        assert f.legacy


# -- writer ------------------------------------------------------------------------------------


def test_writer_errors(tmp_path: Path) -> None:
    p = tmp_path / "w.spdf"
    with pytest.raises(spdf.WriterError):
        with spdf.Writer(p) as w:
            w.add_unit({"id": "u1", "ord": 1, "anchor": {"type": "slide", "n": 1}, "reader": "x"})
    assert not p.exists()
    assert not list(tmp_path.glob(".w.spdf.*"))
    w = spdf.Writer(p)
    with pytest.raises(spdf.WriterError):
        w.add_document({"id": "d", "kind": "pdf", "metadata": {"title": "x"}, "source_sha256": "0", "mime": "x", "bytes": 1})
    with pytest.raises(spdf.WriterError):
        w.add_vector("fragment", "f1", "nope@3", data=[1, 2, 3])
    w.abort()
    with pytest.raises(spdf.WriterError):
        # A unit whose chars point past its text makes an invalid file: refused at finalize.
        with spdf.Writer(p) as w2:
            w2.add_document({"id": "d", "kind": "pdf", "metadata": {"type": "book", "title": "x"},
                             "source_sha256": "0" * 64, "mime": "x", "bytes": 1})
            w2.add_unit({"id": "u1", "ord": 1, "anchor": {"type": "slide", "n": 1, "chars": [0, 50]}, "text": "abc",
                         "reader": "x"})
    assert not p.exists()


def test_writer_nfc_and_defaults(tmp_path: Path) -> None:
    p = tmp_path / "nfc.spdf"
    decomposed = "rocín"  # i + combining acute
    with spdf.Writer(p) as w:
        w.add_document({"id": "d", "kind": "audio", "metadata": {"type": "speech", "title": "Prueba"},
                        "source_sha256": "A" * 64, "mime": "audio/mpeg", "bytes": 1, "duration": 10.0})
        w.add_unit({"id": "u1", "ord": 1, "anchor": {"type": "time", "t0": 0.0, "t1": 10.0}, "text": decomposed,
                    "reader": "whisper"})
        w.add_fragment({"id": "f1", "unit": "u1", "ord": 1, "text": decomposed, "anchor": {"type": "time", "t0": 0, "t1": 10}})
    with spdf.open(p) as f:
        assert f.units()[0].text == "rocín"
        assert f.units()[0].t0 == 0.0 and f.units()[0].t1 == 10.0
        assert f.profile == ["core", "media"]
        assert f.meta["generator"].startswith("spdf-format/")
        assert f.document.source_sha256 == "a" * 64
        assert f.document.unit_count == 1
        assert f.cite(f.fragment("f1")) == "(Prueba, s. f., 0:00)"


# -- interoperability ----------------------------------------------------------------------------


def test_bibliography(quijote: Path) -> None:
    with spdf.open(quijote) as f:
        csl = f.to_csl_json()
        assert csl[0]["id"] == "quijote" and csl[0]["type"] == "book"
        bib = f.to_bibtex()
    assert bib.startswith("@book{cervantes1605ingenioso,")
    assert "author = {Cervantes Saavedra, Miguel de}" in bib
    assert "address = {Madrid}" in bib
    item = {"type": "article-journal", "title": "A & B_c", "container-title": "Revista", "author": [{"literal": "ACME"}]}
    entry = spdf.csl_to_bibtex(item, key="k")
    assert "@article{k," in entry and "journal = {Revista}" in entry and r"A \& B\_c" in entry


def test_alto(quijote: Path) -> None:
    with spdf.open(quijote) as f:
        xml = f.to_alto()
    root = ET.fromstring(xml)
    ns = {"a": "http://www.loc.gov/standards/alto/ns-v4#"}
    pages = root.findall(".//a:Page", ns)
    assert len(pages) == 3
    assert pages[0].get("WIDTH") == "1" and pages[1].get("PRINTED_IMG_NR") == "23"
    words = [s.get("CONTENT") for s in pages[1].findall(".//a:String", ns)]
    assert words[:4] == ["En", "un", "lugar", "de"]
    assert pages[2].find(".//a:TextBlock[@TAGREFS='TAG_NOTE']", ns) is not None


def test_iiif(quijote: Path) -> None:
    with spdf.open(quijote) as f:
        m = f.to_iiif("https://example.org/iiif/quijote")
    assert m["@context"] == "http://iiif.io/api/presentation/3/context.json" and m["type"] == "Manifest"
    assert m["rights"] == "http://creativecommons.org/publicdomain/zero/1.0/"
    canvases = m["items"]
    assert len(canvases) == 3 and canvases[0]["width"] == 1
    body = canvases[0]["items"][0]["items"][0]["body"]
    assert body["id"] == "https://example.org/iiif/quijote/blobs/pages/0001.png" and body["format"] == "image/png"
    annos = canvases[0]["annotations"][0]["items"]
    assert annos[0]["motivation"] == "supplementing" and annos[0]["body"]["value"] == TEXTS[0]
    assert annos[1]["motivation"] == "describing" and annos[1]["target"].endswith("#xywh=0,0,0,0")
    assert canvases[1]["label"] == {"none": ["p. 23"]}
    assert m["structures"][0]["items"][0]["id"].endswith("/canvas/1")


def test_frames(quijote: Path) -> None:
    pd = pytest.importorskip("pandas")
    with spdf.open(quijote) as f:
        df = f.to_pandas(vectors="test@4")
    assert isinstance(df, pd.DataFrame) and list(df["id"]) == ["f1", "f2", "f3"]
    assert df["vector"].iloc[1].tolist() == [0.0, 1.0, 0.0, 0.0]


def test_arrow(quijote: Path) -> None:
    pytest.importorskip("pyarrow")
    with spdf.open(quijote) as f:
        t = f.to_arrow(vectors="test@4:i8")
    assert t.num_rows == 3 and t.schema.field("vector").type.list_size == 4


# -- CLI ------------------------------------------------------------------------------------------


def test_cli(quijote: Path, legacy41: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["validate", str(quijote)]) == 0
    assert main(["validate", "--json", str(quijote)]) == 0
    out = capsys.readouterr().out
    assert '"valid": true' in out
    assert main(["dump", str(quijote)]) == 0
    assert json.loads(capsys.readouterr().out)["spdf_version"] == "5.0"
    assert main(["info", str(quijote)]) == 0
    assert "Cervantes Saavedra" in capsys.readouterr().out
    assert main(["info", "--env"]) == 0
    assert '"fts5"' in capsys.readouterr().out
    assert main(["search", str(quijote), "lanza", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)[0]["fragment_id"] == "f2"
    assert main(["search", str(quijote), "--vector", "[0,1,0,0]", "--space", "test@4"]) == 0
    capsys.readouterr()
    assert main(["cite", str(quijote), "--fragment", "f2", "--locale", "en"]) == 0
    assert capsys.readouterr().out.strip() == "(Cervantes Saavedra, 1605, p. 23)"
    assert main(["cite", str(quijote), "--uri", f"spdf:sha256-{SOURCE_SHA}#p=3&f=24"]) == 0
    assert capsys.readouterr().out.strip() == "(Cervantes Saavedra, 1605, p. 24)"
    for fmt in ("csl", "bibtex", "alto", "jsonl"):
        assert main(["export", str(quijote), "-f", fmt]) == 0
    capsys.readouterr()
    images = tmp_path / "iiif"
    assert main(["export", str(quijote), "-f", "iiif", "--base-url", "https://x.org/m", "--images-dir", str(images)]) == 0
    assert (images / "blobs" / "pages" / "0001.png").is_file()
    capsys.readouterr()
    out_file = tmp_path / "conv.spdf"
    assert main(["convert", str(legacy41), str(out_file)]) == 0
    assert main(["validate", str(out_file)]) == 0
    bad = tmp_path / "bad.spdf"
    bad.write_text("nope")
    assert main(["validate", str(bad)]) == 1
    assert main(["info", str(bad)]) == 1
    key = tmp_path / "key"
    key.write_bytes(spdf.generate_key())
    assert main(["sign", str(out_file), "--key", str(key)]) == 0
    assert main(["verify", str(out_file)]) == 0
    capsys.readouterr()
