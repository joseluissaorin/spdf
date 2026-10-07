from spdf_build.steps.normalize import document_epoch, query_variants, search_text, basic_fold
from spdf_build.text import count_tokens, detect_language, split_sentences

OLD = "Dixo entonces el Cauallero, que assi lo auia de hazer quando la muger se lo pidiesse, y truxo las armas."


def test_old_spanish_keys_match_modern_queries():
    st = search_text(OLD, "es", "old")
    for q in ("dijo", "así", "mujer", "hacer", "cuando", "trajo", "caballero"):
        key = search_text(q, "es", "old") or basic_fold(q)
        assert key.split()[0] in st.split(), (q, key, st)


def test_modern_text_gets_no_layer():
    assert search_text("Dijo entonces el caballero que así lo había de hacer.", "es") == ""
    assert search_text("The origin of species.", "en", "old") == ""


def test_epoch():
    assert document_epoch([OLD] * 3, "es") == "old"
    assert document_epoch(["El caballero dijo que así lo haría cuando la mujer se lo pidiese."] * 3, "es") == "modern"
    assert document_epoch(["texto"], "es", 1737) == "old"


def test_query_variants_include_latin_stems():
    assert any("amor" in v for v in query_variants("amoris"))


def test_text_utils():
    assert split_sentences("C. S. Lewis wrote it. Then he left, p. 23 says so. Fin.") == [
        "C. S. Lewis wrote it.", "Then he left, p. 23 says so.", "Fin."]
    assert count_tokens("una dos tres") >= 3
    assert detect_language("En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero y que se") == "es"
