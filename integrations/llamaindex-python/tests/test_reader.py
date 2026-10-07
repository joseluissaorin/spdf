from __future__ import annotations

import json
import math
from types import GeneratorType

import pytest
import spdf
from conftest import BROKEN, EN, ES, FIXTURES, SPACE
from llama_index.core import SimpleDirectoryReader, VectorStoreIndex
from llama_index.core.embeddings import MockEmbedding
from llama_index.core.llms import MockLLM
from llama_index.core.schema import Document, MetadataMode, QueryBundle

from spdf_llamaindex import SpdfReader

# El docref sale del propio fichero (SHA-256 del PDF original): no se fija a mano.
with spdf.open(EN) as _f:
    DOCREF_EN = _f.docref


def by_fragment(docs: list[Document]) -> dict[str, Document]:
    return {d.metadata["fragment_id"]: d for d in docs}


# -- counts and text ----------------------------------------------------------------------------


def test_fragments_and_units_count() -> None:
    assert len(SpdfReader().load_data(EN)) == 8
    assert len(SpdfReader(granularity="unit").load_data(EN)) == 6


def test_lazy_load_is_a_generator() -> None:
    gen = SpdfReader().lazy_load_data(str(EN))
    assert isinstance(gen, GeneratorType)
    first = next(gen)
    assert first.metadata["fragment_id"] == "f2-1"
    gen.close()


def test_text_is_the_literal_passage_and_ids_are_stable() -> None:
    docs = SpdfReader().load_data(EN)
    with spdf.open(EN) as f:
        fragments = f.fragments()
    assert [d.text for d in docs] == [fr.text for fr in fragments]
    assert [d.id_ for d in docs] == [f"{DOCREF_EN}:{fr.id}" for fr in fragments]
    assert [d.id_ for d in SpdfReader().load_data(EN)] == [d.id_ for d in docs]


# -- metadata -------------------------------------------------------------------------------------


def test_metadata_of_first_fragment_in_english() -> None:
    md = SpdfReader().load_data(EN)[0].metadata
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
    assert "t0" not in md and "t1" not in md and "anchor_end" not in md


def test_inferred_folio_on_the_plate() -> None:
    plate = by_fragment(SpdfReader().load_data(EN))["f4-1"].metadata
    assert plate["citation"] == "(Saorín Ferrer, 2026, p. [3])"
    assert plate["folio_inferred"] is True
    assert plate["physical_page"] == 4
    assert plate["printed_folio"] == "3"


def test_spanish_booklet_with_spanish_locale() -> None:
    docs = SpdfReader(locale="es").load_data(ES)
    assert docs[0].metadata["citation"] == "(Saorín Ferrer, 2026, p. 1)"
    assert docs[0].metadata["section"] == "I. Anclas"
    assert docs[0].metadata["language"] == "es"
    assert by_fragment(docs)["f4-1"].metadata["citation"] == "(Saorín Ferrer, 2026, p. [3])"
    cover = SpdfReader(granularity="unit", locale="es").load_data(ES)[0].metadata
    assert cover["citation"] == "(Saorín Ferrer, 2026, s. p.)"
    assert "printed_folio" not in cover
    cover_en = SpdfReader(granularity="unit", locale="en").load_data(ES)[0].metadata
    assert cover_en["citation"] == "(Saorín Ferrer, 2026, n. pag.)"


def test_metadata_is_flat_and_json_serialisable() -> None:
    for gran in ("fragment", "unit"):
        for d in SpdfReader(granularity=gran).load_data([EN, ES]):
            for key, value in d.metadata.items():
                assert isinstance(value, (str, int, float, bool)), (key, value)
            json.dumps(d.metadata)


@pytest.mark.parametrize("path", [EN, ES])
def test_anchor_uri_round_trip(path) -> None:
    for d in SpdfReader().load_data(path):
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
    units = SpdfReader(granularity="unit").load_data(EN)
    assert [u.metadata["unit_id"] for u in units] == ["u1", "u2", "u3", "u4", "u5", "u6"]
    assert all("fragment_id" not in u.metadata for u in units)
    with spdf.open(EN) as f:
        assert [u.text for u in units] == [u.text for u in f.units()]
    cover, plate = units[0].metadata, units[3].metadata
    assert cover["citation"] == "(Saorín Ferrer, 2026, n. pag.)"
    assert cover["physical_page"] == 1 and "printed_folio" not in cover and "section" not in cover
    assert plate["citation"] == "(Saorín Ferrer, 2026, p. [3])" and plate["folio_inferred"] is True
    assert units[1].metadata["section"] == "I. Anchors"
    assert units[2].metadata["section"] == "I. Anchors | II. Provenance | III. Read once, query many"
    assert units[2].id_ == f"{DOCREF_EN}:u3"


# -- inputs ---------------------------------------------------------------------------------------


def test_folder_is_searched_recursively(library) -> None:
    docs = SpdfReader().load_data(library)
    assert len(docs) == 16  # the hidden copy and notes.txt are skipped
    assert {d.metadata["spdf_doc_id"] for d in docs} == {"spdf-in-five-pages", "spdf-en-cinco-paginas"}
    assert len(SpdfReader(granularity="unit").load_data(str(library))) == 12


def test_list_of_files_and_folders(library) -> None:
    docs = SpdfReader().load_data([EN, library / "es"])
    assert len(docs) == 16
    assert docs[0].metadata["source"] == str(EN)


def test_extra_info_is_merged() -> None:
    d = SpdfReader().load_data(EN, extra_info={"collection": "booklets", "title": "Override"})[0]
    assert d.metadata["collection"] == "booklets"
    assert d.metadata["title"] == "Override"
    assert "collection" in d.excluded_llm_metadata_keys


def test_simple_directory_reader_integration(library) -> None:
    try:
        SimpleDirectoryReader.supported_suffix_fn()
    except ImportError:  # llama-index-core 0.12.0 needs llama-index-readers-file here
        pytest.skip("SimpleDirectoryReader needs llama-index-readers-file in this llama-index-core")
    docs = SimpleDirectoryReader(
        input_dir=str(library), recursive=True, required_exts=[".spdf"], file_extractor={".spdf": SpdfReader()}
    ).load_data()
    assert len(docs) == 16
    assert all(d.metadata["citation"].startswith("(Saorín Ferrer, 2026") for d in docs)
    assert all("file_name" in d.metadata for d in docs)


def test_fsspec_filesystem() -> None:
    fsspec = pytest.importorskip("fsspec")
    fs = fsspec.filesystem("memory")
    fs.mkdir("/booklets/es")
    fs.pipe("/booklets/en.spdf", EN.read_bytes())
    fs.pipe("/booklets/es/es.spdf", ES.read_bytes())
    docs = SpdfReader().load_data("/booklets", fs=fs)
    assert len(docs) == 16
    assert docs[0].metadata["citation"] == "(Saorín Ferrer, 2026, p. 1)"


# -- errors ----------------------------------------------------------------------------------------


def test_broken_file_raises_a_clear_error() -> None:
    with pytest.raises(spdf.UnsafeFileError) as exc:
        SpdfReader().load_data(BROKEN)
    assert exc.value.code == "E020"
    assert str(BROKEN) in str(exc.value)
    assert "view" in str(exc.value)


def test_folder_with_a_broken_file_raises() -> None:
    with pytest.raises(spdf.UnsafeFileError):
        SpdfReader().load_data(FIXTURES)


def test_missing_path_and_bad_options() -> None:
    with pytest.raises(FileNotFoundError):
        SpdfReader().load_data(FIXTURES / "nope.spdf")
    with pytest.raises(ValueError, match="granularity"):
        SpdfReader(granularity="page")
    with pytest.raises(spdf.SpdfError, match="no vector space"):
        SpdfReader(include_embeddings="nomic@768").load_data(EN)


# -- embeddings and indexes ---------------------------------------------------------------------


def test_embeddings_come_from_the_file() -> None:
    assert all(d.embedding is None for d in SpdfReader().load_data(EN))
    docs = SpdfReader(include_embeddings=SPACE).load_data(EN)
    with spdf.open(EN) as f:
        stored = dict(f.vectors(SPACE))
    for d in docs:
        assert len(d.embedding) == 384
        assert d.embedding == pytest.approx(stored[d.metadata["fragment_id"]])
        assert math.isclose(math.sqrt(sum(x * x for x in d.embedding)), 1.0, rel_tol=1e-5)
        assert d.metadata["vector_space"] == SPACE
    # The fixtures have no unit vectors: units keep embedding=None and the index embeds them.
    assert all(u.embedding is None for u in SpdfReader(granularity="unit", include_embeddings=SPACE).load_data(EN))


def test_default_metadata_visibility() -> None:
    d = SpdfReader().load_data(EN)[0]
    embed_text = d.get_content(metadata_mode=MetadataMode.EMBED)
    llm_text = d.get_content(metadata_mode=MetadataMode.LLM)
    assert "section: I. Anchors" in embed_text and "title: SPDF in five pages" in embed_text
    assert DOCREF_EN not in embed_text and '"chars"' not in embed_text and "citation" not in embed_text
    assert "citation: (Saorín Ferrer, 2026, p. 1)" in llm_text
    assert DOCREF_EN not in llm_text and '"chars"' not in llm_text
    assert d.text in embed_text and d.text in llm_text


def test_custom_metadata_visibility() -> None:
    d = SpdfReader(excluded_embed_metadata_keys=[], excluded_llm_metadata_keys=["anchor"]).load_data(EN)[0]
    assert d.excluded_embed_metadata_keys == []
    assert d.excluded_llm_metadata_keys == ["anchor"]
    assert "anchor_uri: spdf:" in d.get_content(metadata_mode=MetadataMode.LLM)


def test_vector_store_index_keeps_citations() -> None:
    docs = SpdfReader().load_data([EN, ES])
    index = VectorStoreIndex.from_documents(docs, embed_model=MockEmbedding(embed_dim=384))
    nodes = index.as_retriever(similarity_top_k=5).retrieve("Where does a passage come from?")
    assert len(nodes) == 5
    for n in nodes:
        assert n.node.metadata["citation"].startswith("(Saorín Ferrer, 2026, p. ")
        assert n.node.metadata["anchor_uri"].startswith("spdf:sha256-")
        assert "citation: (Saorín Ferrer" in n.node.get_content(metadata_mode=MetadataMode.LLM)


class _NoTextEmbedding(MockEmbedding):
    """An embedding model that refuses to embed passages: proves the stored vectors are used."""

    def _get_text_embedding(self, text: str) -> list[float]:
        raise AssertionError("the passages should not be embedded again")

    def _get_text_embeddings(self, texts: list[str]) -> list[list[float]]:
        raise AssertionError("the passages should not be embedded again")


def test_index_uses_the_stored_vectors() -> None:
    docs = SpdfReader(include_embeddings=SPACE).load_data(EN)
    index = VectorStoreIndex(docs, embed_model=_NoTextEmbedding(embed_dim=384))
    plate = by_fragment(docs)["f4-1"]
    query = QueryBundle(query_str="the plate", embedding=plate.embedding)
    hits = index.as_retriever(similarity_top_k=3).retrieve(query)
    assert hits[0].node.node_id == plate.id_
    assert hits[0].score == pytest.approx(1.0, abs=1e-5)
    assert hits[0].node.metadata["citation"] == "(Saorín Ferrer, 2026, p. [3])"


def test_query_engine_sources_and_prompt_carry_the_citation() -> None:
    docs = SpdfReader().load_data(EN)
    index = VectorStoreIndex(docs, embed_model=MockEmbedding(embed_dim=8))
    response = index.as_query_engine(llm=MockLLM(), similarity_top_k=2).query("How is the plate cited?")
    assert len(response.source_nodes) == 2
    for source in response.source_nodes:
        assert source.node.metadata["citation"].startswith("(Saorín Ferrer, 2026, p. ")
    # MockLLM echoes its prompt: the LLM is shown the citation next to each passage.
    assert "citation: (Saorín Ferrer, 2026, p. " in str(response)
    assert DOCREF_EN not in str(response)
