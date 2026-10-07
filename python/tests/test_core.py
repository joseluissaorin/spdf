"""Unit tests of the pure parts: canonical JSON, anchors and URIs, citations, query parsing, vectors."""

from __future__ import annotations

import base64

import pytest

import spdf
from spdf import _ed25519
from spdf.anchors import anchor_problem, anchor_to_locator, format_uri, locator_to_anchor, parse_uri
from spdf.canonical import canonical_dumps, es_number, round_floats
from spdf.cite import cite, format_time
from spdf.search import is_cjk, parse_query, rrf
from spdf.vectors import decode, encode

# -- canonical JSON -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0.0, "0"),
        (-0.0, "0"),
        (1.0, "1"),
        (4160.0, "4160"),
        (4175.5, "4175.5"),
        (0.1, "0.1"),
        (1e-6, "0.000001"),
        (1e-7, "1e-7"),
        (1.5e-7, "1.5e-7"),
        (1e21, "1e+21"),
        (1e20, "100000000000000000000"),
        (123456789012345680000.0, "123456789012345680000"),
        (-2.5, "-2.5"),
        (0.000123, "0.000123"),
        (5e-324, "5e-324"),
        (1.7976931348623157e308, "1.7976931348623157e+308"),
        (7, "7"),
    ],
)
def test_es_number(value: float, expected: str) -> None:
    assert es_number(value) == expected


def test_canonical_json_sorting_and_escaping() -> None:
    obj = {"b": 1, "a": [1.0, 0.1234567, None, True], "é": "x\ny\u0001\"\\", "דּ": 3, "€": 1, "\U0001f600": 2}
    out = canonical_dumps(obj)
    # RFC 8785 sorts keys by UTF-16 code units: U+20AC < U+1F600 (D83D DE00) < U+FB33.
    assert out == '{"a":[1,0.123457,null,true],"b":1,"é":"x\\ny\\u0001\\"\\\\","€":1,"\U0001f600":2,"דּ":3}'


def test_round_half_even_on_binary_value() -> None:
    assert round_floats(0.0078125) == 0.007812  # exact tie -> half to even
    assert round_floats(2.0000005) == 2.000001 or round_floats(2.0000005) == 2.0


# -- anchors and URIs -----------------------------------------------------------------


def test_anchor_from_dict_keeps_raw() -> None:
    raw = {"type": "page", "physical": 10, "printed": "4", "roman": False, "x_custom": 1}
    a = spdf.Anchor.from_dict(raw)
    assert a.physical == 10 and a.printed == "4" and a.roman is False
    assert a.to_dict() == raw
    assert a.get("x_custom") == 1


def test_anchor_problems() -> None:
    assert anchor_problem({"type": "page", "physical": 1, "printed": None}) is None
    assert anchor_problem({"type": "page", "physical": 0, "printed": None})[0] == "E040"  # type: ignore[index]
    assert anchor_problem({"type": "page", "physical": 1})[0] == "E040"  # type: ignore[index]
    assert anchor_problem({"type": "nope"})[0] == "E041"  # type: ignore[index]
    assert anchor_problem([1, 2])[0] == "E040"  # type: ignore[index]
    assert anchor_problem({"type": "image", "chars": [0, 5]}, 4)[0] == "E042"  # type: ignore[index]
    assert anchor_problem({"type": "image", "chars": [0, 4]}, 4) is None
    assert anchor_problem({"type": "time", "t0": 1, "t1": True})[0] == "E040"  # type: ignore[index]
    assert anchor_problem({"type": "canonical", "scheme": "stephanus", "ref": "514a"}) is None


def test_uri_page_with_chars() -> None:
    sha = "3f" * 32
    a = {"type": "page", "physical": 29, "printed": "21", "chars": [118, 301]}
    uri = spdf.make_uri(f"sha256-{sha}", a)
    assert uri == f"spdf:sha256-{sha}#p=29&f=21&char=118,301"
    parsed = parse_uri(uri)
    assert parsed["docref"] == f"sha256-{sha}"
    assert parsed["locator"] == {"p": 29, "f": "21", "char": [118, 301]}
    assert format_uri(parsed["docref"], parsed["locator"]) == uri


def test_uri_ranges_and_encoding() -> None:
    a = {"type": "page", "physical": 10, "printed": "fol. 1r", "region": {"x": 0.125, "y": 0.1, "w": 0.5, "h": 0.25}}
    e = {"type": "page", "physical": 11, "printed": "fol. 2v"}
    uri = spdf.make_uri("doc%201", a, e)
    assert uri == "spdf:doc%201#p=10&pe=11&f=fol.%201r&fe=fol.%202v&xywh=percent:12.5,10,50,25"
    loc = parse_uri(uri)["locator"]
    assert loc["xywh"] == [0.125, 0.1, 0.5, 0.25]
    assert format_uri("doc%201", loc) == uri


def test_uri_time_section_sheet_verse_canonical() -> None:
    d = "sha256-" + "a" * 64
    assert spdf.make_uri(d, {"type": "time", "t0": 4160.0, "t1": 4175.5}) == f"spdf:{d}#t=4160,4175.5"
    assert (
        spdf.make_uri(d, {"type": "section", "path": ["Chapter 3", "3.2 The panopticon/x"], "paragraph": 4})
        == f"spdf:{d}#s=Chapter%203/3.2%20The%20panopticon%2Fx&para=4"
    )
    assert spdf.make_uri(d, {"type": "sheet", "sheet": "Data", "row_from": 4, "row_to": 9}) == f"spdf:{d}#sh=Data&rows=4-9"
    assert spdf.make_uri(d, {"type": "verse", "line_from": 1234, "line_to": 1240}) == f"spdf:{d}#v=1234-1240"
    assert spdf.make_uri(d, {"type": "verse", "line_from": 7, "line_to": 7}) == f"spdf:{d}#v=7"
    assert spdf.make_uri(d, {"type": "canonical", "scheme": "stephanus", "ref": "514a"}) == f"spdf:{d}#ref=stephanus:514a"
    assert spdf.make_uri(d, {"type": "slide", "n": 3}) == f"spdf:{d}#sl=3"
    for uri in (
        f"spdf:{d}#t=4160,4175.5",
        f"spdf:{d}#s=Chapter%203/3.2%20The%20panopticon%2Fx&para=4",
        f"spdf:{d}#sh=Data&rows=4-9",
        f"spdf:{d}#v=1234-1240",
        f"spdf:{d}#ref=stephanus:514a",
        f"spdf:{d}#sl=3",
        f"spdf:{d}#p=1&f=%C3%B1",
    ):
        p = parse_uri(uri)
        assert format_uri(p["docref"], p["locator"]) == uri
    assert parse_uri(f"spdf:{d}#s=Chapter%203/3.2%20The%20panopticon%2Fx")["locator"]["s"] == [
        "Chapter 3",
        "3.2 The panopticon/x",
    ]


def test_uri_time_with_end_anchor() -> None:
    loc = anchor_to_locator({"type": "time", "t0": 42.0, "t1": 50.0}, {"type": "time", "t0": 50.0, "t1": 65.25})
    assert loc == {"t": [42.0, 65.25]}


def test_locator_to_anchor() -> None:
    assert locator_to_anchor({"p": 3, "f": "xiv"}) == {"type": "page", "physical": 3, "printed": "xiv"}
    assert locator_to_anchor({"t": [1.0, 2.0]})["type"] == "time"
    with pytest.raises(spdf.InvalidAnchorError):
        parse_uri("http://example.org")


# -- citation ---------------------------------------------------------------------------

META = {"type": "book", "title": "Don Quijote: primera parte", "author": [{"family": "Cervantes"}], "issued": {"date-parts": [[1605]]}}


@pytest.mark.parametrize(
    ("anchor", "end", "locale", "expected"),
    [
        ({"type": "page", "physical": 9, "printed": "145"}, None, "es", "(Cervantes, 1605, p. 145)"),
        ({"type": "page", "physical": 9, "printed": "xiv", "roman": True}, None, "en", "(Cervantes, 1605, p. xiv)"),
        ({"type": "page", "physical": 9, "printed": "21", "source": "inferred"}, None, "es", "(Cervantes, 1605, p. [21])"),
        ({"type": "page", "physical": 9, "printed": None}, None, "es", "(Cervantes, 1605, s. p.)"),
        ({"type": "page", "physical": 9, "printed": None}, None, "en", "(Cervantes, 1605, n. pag.)"),
        ({"type": "page", "physical": 9, "printed": "1r", "foliation": "leaf"}, None, "es", "(Cervantes, 1605, fol. 1r)"),
        (
            {"type": "page", "physical": 9, "printed": "1r", "foliation": "leaf"},
            {"type": "page", "physical": 10, "printed": "2v", "foliation": "leaf"},
            "es",
            "(Cervantes, 1605, fols. 1r-2v)",
        ),
        ({"type": "page", "physical": 9, "printed": "45", "foliation": "column"}, None, "es", "(Cervantes, 1605, col. 45)"),
        (
            {"type": "page", "physical": 9, "printed": "145"},
            {"type": "page", "physical": 10, "printed": "146"},
            "en",
            "(Cervantes, 1605, pp. 145-146)",
        ),
        (
            {"type": "page", "physical": 9, "printed": "20", "source": "inferred"},
            {"type": "page", "physical": 10, "printed": "21", "source": "inferred"},
            "es",
            "(Cervantes, 1605, pp. [20]-[21])",
        ),
        ({"type": "time", "t0": 4160.9, "t1": 4175.5}, None, "es", "(Cervantes, 1605, 1:09:20)"),
        ({"type": "time", "t0": 42.0, "t1": 50}, {"type": "time", "t0": 50, "t1": 65}, "es", "(Cervantes, 1605, 0:42-1:05)"),
        ({"type": "section", "path": ["Cap. 3", "3.2"], "paragraph": 4}, None, "es", "(Cervantes, 1605, § 3.2, párr. 4)"),
        ({"type": "section", "path": ["Cap. 3"], "paragraph": 4}, None, "en", "(Cervantes, 1605, § Cap. 3, para. 4)"),
        ({"type": "section", "path": [], "paragraph": 2}, None, "es", "(Cervantes, 1605, párr. 2)"),
        ({"type": "section", "path": ["Cap. 3"], "paragraph": 4, "printed": "145"}, None, "es", "(Cervantes, 1605, p. 145)"),
        ({"type": "slide", "n": 3}, None, "es", "(Cervantes, 1605, diap. 3)"),
        ({"type": "slide", "n": 3}, None, "en", "(Cervantes, 1605, slide 3)"),
        ({"type": "sheet", "sheet": "Data", "row_from": 4, "row_to": 9}, None, "es", "(Cervantes, 1605, Data, filas 4-9)"),
        ({"type": "verse", "line_from": 1234}, None, "es", "(Cervantes, 1605, v. 1234)"),
        ({"type": "verse", "line_from": 1234, "line_to": 1240}, None, "en", "(Cervantes, 1605, vv. 1234-1240)"),
        ({"type": "canonical", "scheme": "stephanus", "ref": "514a"}, None, "es", "(Cervantes, 1605, 514a)"),
        ({"type": "image"}, None, "es", "(Cervantes, 1605)"),
        ({"type": "page", "physical": 1, "printed": "3"}, None, "fr", "(Cervantes, 1605, p. 3)"),
    ],
)
def test_cite_locators(anchor: dict, end: dict | None, locale: str, expected: str) -> None:
    assert cite(anchor, META, locale, end) == expected


def test_cite_names_and_years() -> None:
    two = {"author": [{"family": "Deleuze"}, {"family": "Guattari"}], "issued": {"date-parts": [[1980]]}}
    assert cite(None, two, "es") == "(Deleuze y Guattari, 1980)"
    assert cite(None, two, "en") == "(Deleuze and Guattari, 1980)"
    i_sound = {"author": [{"family": "Pérez"}, {"family": "Iglesias"}], "issued": {"date-parts": [[2001]]}}
    assert cite(None, i_sound, "es") == "(Pérez e Iglesias, 2001)"
    assert cite(None, {**i_sound, "author": [{"family": "Pérez"}, {"family": "Hinojosa"}]}, "es") == "(Pérez e Hinojosa, 2001)"
    assert cite(None, {**i_sound, "author": [{"family": "Pérez"}, {"family": "Hierro"}]}, "es") == "(Pérez y Hierro, 2001)"
    three = {"author": [{"family": "A"}, {"family": "B"}, {"family": "C"}]}
    assert cite(None, three, "es") == "(A et al., s. f.)"
    assert cite(None, three, "en") == "(A et al., n.d.)"
    particle = {"author": [{"family": "Gogh", "non-dropping-particle": "van"}], "issued": {"date-parts": [[1888]]}}
    assert cite(None, particle, "en") == "(van Gogh, 1888)"
    literal = {"author": [{"literal": "UNESCO"}], "issued": {"date-parts": [["2019"]]}}
    assert cite(None, literal, "en") == "(UNESCO, 2019)"
    no_author = {"title": "Lazarillo de Tormes: vida", "issued": {"date-parts": [[1554]]}}
    assert cite(None, no_author, "es") == "(Lazarillo de Tormes, 1554)"
    assert cite(None, {**no_author, "title-short": "Lazarillo"}, "es") == "(Lazarillo, 1554)"
    bc = {"author": [{"family": "Platón"}], "issued": {"date-parts": [[-380]]}}
    assert cite(None, bc, "es") == "(Platón, 380 a. C.)"
    assert cite(None, bc, "en") == "(Platón, 380 BC)"


def test_format_time() -> None:
    assert format_time(42.9) == "0:42"
    assert format_time(4160) == "1:09:20"
    assert format_time(3599.99) == "59:59"


# -- query parsing ---------------------------------------------------------------------------


def test_parse_query_words_and_dedup() -> None:
    q = parse_query("Lanza, lanza; ASTILLERO astillero rocín rocin")
    assert q.terms == ("Lanza", "ASTILLERO", "rocín")
    assert not q.phrases
    assert q.match == '"Lanza" OR "ASTILLERO" OR "rocín"'


def test_parse_query_phrases() -> None:
    q = parse_query('hidalgo "lanza en  astillero" «duelos y quebrantos» „ojo“ “fin”')
    assert q.phrases
    assert q.terms == ("lanza en astillero", "duelos y quebrantos", "ojo", "fin")
    assert q.match == '"lanza en astillero" AND "duelos y quebrantos" AND "ojo" AND "fin"'


def test_parse_query_unclosed_and_empty() -> None:
    assert parse_query('"lanza astillero').terms == ("lanza", "astillero")
    assert parse_query('"" ...').terms == ()
    assert parse_query("Straße").terms == ("Straße",)


def test_is_cjk_and_rrf() -> None:
    assert is_cjk("中文") and is_cjk("한국어") and is_cjk("カタカナ") and not is_cjk("Quijote")
    s = rrf([["a", "b"], ["b", "c"]])
    assert s["b"] == pytest.approx(1 / 12 + 1 / 11)
    assert s["a"] == pytest.approx(1 / 11)


# -- vectors ---------------------------------------------------------------------------------


def test_vector_codecs() -> None:
    v = [0.5, -1.0, 0.25, 1.0]
    assert decode(encode(v, "f32"), "f32") == v
    assert decode(encode(v, "f16"), "f16") == v
    q = encode([0.5, -1.0, 2.0, 0.0039], "i8")
    assert list(q) == [64, (256 - 127), 127, 0]
    assert decode(q, "i8")[0] == pytest.approx(64 / 127)
    with pytest.raises(ValueError):
        decode(b"\x00" * 3, "f32")


# -- Ed25519 ----------------------------------------------------------------------------------


def test_ed25519_rfc8032_vector_1() -> None:
    secret = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
    public = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
    sig = bytes.fromhex(
        "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
    )
    assert _ed25519.public_key(secret) == public
    assert _ed25519.sign(secret, b"") == sig
    assert _ed25519.verify(public, b"", sig)
    assert not _ed25519.verify(public, b"x", sig)


def test_sign_hash_roundtrip() -> None:
    key = spdf.generate_key()
    signature, signer = spdf.sign_hash("ab" * 32, key)
    assert signer.startswith("ed25519:") and len(base64.b64decode(signer[8:])) == 32
    assert spdf.verify_hash("ab" * 32, signature, signer)
    assert not spdf.verify_hash("cd" * 32, signature, signer)
