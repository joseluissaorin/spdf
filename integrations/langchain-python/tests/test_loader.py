from __future__ import annotations

import json
import math
from types import GeneratorType

import pytest
import spdf
from conftest import BROKEN, EN, ES, FIXTURES, SPACE
from langchain_core.documents import Document
from langchain_core.embeddings import DeterministicFakeEmbedding, Embeddings
from langchain_core.vectorstores import InMemoryVectorStore

from spdf_langchain import SpdfLoader

# El docref sale del propio fichero (SHA-256 del PDF original): no se fija a mano.
with spdf.open(EN) as _f:
    DOCREF_EN = _f.docref


def by_fragment(docs: list[Document]) -> dict[str, Document]:
    return {d.metadata["fragment_id"]: d for d in docs}


# -- counts and text ----------------------------------------------------------------------------


def test_fragments_and_units_count() -> None:
    assert len(SpdfLoader(EN).load()) == 8
    assert len(SpdfLoader(EN, granularity="unit").load()) == 6


def test_lazy_load_is_a_generator() -> None:
    gen = SpdfLoader(str(EN)).lazy_load()
    assert isinstance(gen, GeneratorType)
    assert next(gen).metadata["fragment_id"] == "f2-1"
    gen.close()


def test_page_content_is_the_literal_passage_and_ids_are_stable() -> None:
    docs = SpdfLoader(EN).load()
    with spdf.open(EN) as f:
        fragments = f.fragments()
    assert [d.page_content for d in docs] == [fr.text for fr in fragments]
    assert [d.id for d in docs] == [f"{DOCREF_EN}:{fr.id}" for fr in fragments]


# -- metadata -------------------------------------------------------------------------------------


def test_metadata_of_first_fragment_in_english() -> None:
    md = SpdfLoader(EN).load()[0].metadata
    assert md["citation"] == "(Saorín Ferrer, 2026, p. 1)"
    assert md["source"] == str(EN)
    assert md["spdf_version"] == "5.0"
    assert md["spdf_doc_id"] == "spdf-in-five-pages"
    assert md["docref"] == DOCREF_EN
    assert md["title"] == "SPDF in five pages"
    assert md["authors"] == "Saorín Ferrer"
    assert md["year"] == 2026
    assert md["language"] == "en"
    assert md["kind"] == "pdf"
    assert md["fragment_id"] == "f2-1"
    assert md["unit_id"] == "u2"
    assert md["anchor_type"] == "page"
    assert md["physical_page"] == 2
    assert md["printed_folio"] == "1"
    assert md["folio_inferred"] is False
    assert md["section"] == "I. Anchors"
    assert md["context"] == "SPDF in five pages, I. Anchors"
    assert json.loads(md["anchor"]) == {
        "type": "page", "physical": 2, "printed": "1", "source": "read", "confidence": 1, "chars": [15, 307],
    }
    assert md["anchor_uri"] == f"spdf:{DOCREF_EN}#p=2&f=1&char=15,307"
    assert not {"t0", "t1", "anchor_end", "vector", "vector_space"} & md.keys()


def test_inferred_folio_on_the_plate() -> None:
    plate = by_fragment(SpdfLoader(EN).load())["f4-1"].metadata
    assert plate["citation"] == "(Saorín Ferrer, 2026, p. [3])"
    assert plate["folio_inferred"] is True
    assert plate["physical_page"] == 4
    assert plate["printed_folio"] == "3"


def test_spanish_booklet_with_spanish_locale() -> None:
    docs = SpdfLoader(ES, locale="es").load()
    assert docs[0].metadata["citation"] == "(Saorín Ferrer, 2026, p. 1)"
    assert docs[0].metadata["section"] == "I. Anclas"
    assert by_fragment(docs)["f4-1"].metadata["citation"] == "(Saorín Ferrer, 2026, p. [3])"
    cover = SpdfLoader(ES, granularity="unit", locale="es").load()[0].metadata
    assert cover["citation"] == "(Saorín Ferrer, 2026, s. p.)"
    assert "printed_folio" not in cover


def test_metadata_is_flat_and_json_serialisable() -> None:
    for gran in ("fragment", "unit"):
        for d in SpdfLoader([EN, ES], granularity=gran).load():
            for key, value in d.metadata.items():
                assert isinstance(value, (str, int, float, bool)), (key, value)
            json.dumps(d.metadata)


@pytest.mark.parametrize("path", [EN, ES])
def test_anchor_uri_round_trip(path) -> None:
    for d in SpdfLoader(path).load():
        md = d.metadata
        parsed = spdf.parse_uri(md["anchor_uri"])
        assert parsed["docref"] == md["docref"]
        loc = parsed["locator"]
        assert loc["p"] == md["physical_page"]
        assert loc["f"] == md["printed_folio"]
        assert loc["char"] == json.loads(md["anchor"])["chars"]
        assert spdf.format_uri(parsed["docref"], loc) == md["anchor_uri"]
        with spdf.open(path) as f:
            assert list(f.locate(md["anchor_uri"]).units) == [md["unit_id"]]


def test_unit_granularity() -> None:
    units = SpdfLoader(EN, granularity="unit").load()
    assert [u.metadata["unit_id"] for u in units] == ["u1", "u2", "u3", "u4", "u5", "u6"]
    assert all("fragment_id" not in u.metadata for u in units)
    with spdf.open(EN) as f:
        assert [u.page_content for u in units] == [u.text for u in f.units()]
    cover, plate = units[0].metadata, units[3].metadata
    assert cover["citation"] == "(Saorín Ferrer, 2026, n. pag.)"
    assert cover["physical_page"] == 1 and "printed_folio" not in cover and "section" not in cover
    assert plate["citation"] == "(Saorín Ferrer, 2026, p. [3])" and plate["folio_inferred"] is True
    assert units[2].metadata["section"] == "I. Anchors | II. Provenance | III. Read once, query many"
    assert units[2].id == f"{DOCREF_EN}:u3"


# -- inputs ---------------------------------------------------------------------------------------


def test_folder_is_searched_recursively(library) -> None:
    docs = SpdfLoader(library).load()
    assert len(docs) == 16  # the hidden copy and notes.txt are skipped
    assert {d.metadata["spdf_doc_id"] for d in docs} == {"spdf-in-five-pages", "spdf-en-cinco-paginas"}
    assert len(SpdfLoader(str(library), granularity="unit").load()) == 12


def test_list_and_generator_inputs(library) -> None:
    assert len(SpdfLoader([EN, library / "es"]).load()) == 16
    loader = SpdfLoader(p for p in (EN, ES))
    assert len(loader.load()) == 16
    assert len(loader.load()) == 16  # a generator input can be loaded twice


# -- errors ----------------------------------------------------------------------------------------


def test_broken_file_raises_a_clear_error() -> None:
    with pytest.raises(spdf.UnsafeFileError) as exc:
        SpdfLoader(BROKEN).load()
    assert exc.value.code == "E020"
    assert str(BROKEN) in str(exc.value)
    assert "view" in str(exc.value)


def test_folder_with_a_broken_file_raises() -> None:
    with pytest.raises(spdf.UnsafeFileError):
        SpdfLoader(FIXTURES).load()


def test_missing_path_and_bad_options() -> None:
    with pytest.raises(FileNotFoundError):
        SpdfLoader(FIXTURES / "nope.spdf").load()
    with pytest.raises(ValueError, match="granularity"):
        SpdfLoader(EN, granularity="page")
    with pytest.raises(spdf.SpdfError, match="no vector space"):
        SpdfLoader(EN, with_vectors="nomic@768").load()


# -- vectors and vector stores --------------------------------------------------------------------


def test_with_vectors_puts_the_stored_vector_in_metadata() -> None:
    docs = SpdfLoader(EN, with_vectors=SPACE).load()
    with spdf.open(EN) as f:
        stored = dict(f.vectors(SPACE))
    for d in docs:
        vec = d.metadata["vector"]
        assert len(vec) == 384
        assert vec == pytest.approx(stored[d.metadata["fragment_id"]])
        assert math.isclose(math.sqrt(sum(x * x for x in vec)), 1.0, rel_tol=1e-5)
        assert d.metadata["vector_space"] == SPACE
    json.dumps(docs[0].metadata)


def test_in_memory_vector_store_keeps_citations() -> None:
    docs = SpdfLoader([EN, ES]).load()
    store = InMemoryVectorStore(embedding=DeterministicFakeEmbedding(size=384))
    store.add_documents(docs, ids=[d.id for d in docs])  # explicit ids: langchain-core 0.3.0 ignores Document.id
    hits = store.similarity_search("Where does a passage come from?", k=5)
    assert len(hits) == 5
    for h in hits:
        assert h.metadata["citation"].startswith("(Saorín Ferrer, 2026, p. ")
        assert h.metadata["anchor_uri"].startswith("spdf:sha256-")
    plate_id = f"{DOCREF_EN}:f4-1"
    [plate] = store.get_by_ids([plate_id])
    assert plate.metadata["citation"] == "(Saorín Ferrer, 2026, p. [3])"


class _StoredVectors(Embeddings):
    """Embeddings looked up from the vectors shipped in the file (no model needed)."""

    def __init__(self, docs: list[Document]) -> None:
        self.by_text = {d.page_content: d.metadata["vector"] for d in docs}

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self.by_text[t] for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self.by_text[text]


def test_stored_vectors_work_in_a_vector_store() -> None:
    docs = SpdfLoader(EN, with_vectors=SPACE).load()
    store = InMemoryVectorStore(embedding=_StoredVectors(docs))
    store.add_documents(docs, ids=[d.id for d in docs])
    plate = by_fragment(docs)["f4-1"]
    [(hit, score)] = store.similarity_search_with_score_by_vector(plate.metadata["vector"], k=1)
    assert hit.id == plate.id
    assert score == pytest.approx(1.0, abs=1e-5)
    assert hit.metadata["citation"] == "(Saorín Ferrer, 2026, p. [3])"
