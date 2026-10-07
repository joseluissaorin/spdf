"""Conformance runner (contract §11, ``conformance/README.md``).

Discovers every ``cases/*.json`` under the conformance directory, runs it and returns
the report object::

    {"impl": "spdf-format (Python)", "version": "…", "passed": [...],
     "failed": [{"id", "reason"}], "skipped": [{"id", "reason"}]}

Run it with ``spdf conformance [DIR]`` (exit status 1 when a case fails).
"""

from __future__ import annotations

import json
import math
import os
import tempfile
import traceback
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import Any

from ._version import __version__
from .anchors import format_uri, make_uri, parse_uri
from .bibliography import csl_citation_item, to_bibtex, to_csl_json
from .cite import cite
from .model import Document, SearchResult
from .reader import content_hash, open_spdf
from .validate import validate
from .vectors import quantize
from .writer import write_source

__all__ = ["IMPL", "find_conformance_dir", "json_equal", "run"]

IMPL = "spdf-format (Python)"
SCORE_TOLERANCE = 1e-6


class CaseFailure(Exception):
    """A case did not produce the expected output."""


def find_conformance_dir(start: str | os.PathLike[str] | None = None) -> Path | None:
    """Locate the ``conformance/`` directory: ``$SPDF_CONFORMANCE``, else search upwards."""
    env = os.environ.get("SPDF_CONFORMANCE")
    if env and (Path(env) / "cases").is_dir():
        return Path(env)
    bases = [Path(start) if start else Path.cwd(), Path(__file__).resolve().parent]
    for base in bases:
        for d in (base, *base.parents):
            if (d / "cases").is_dir() and (d / "manifest.json").is_file():
                return d
            cand = d / "conformance"
            if (cand / "cases").is_dir():
                return cand
    return None


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def json_diff(a: Any, b: Any, path: str = "$", tol: float = 0.0) -> str | None:
    """First difference between two JSON values (numbers compared as doubles), or ``None``."""
    if _num(a) and _num(b):
        fa, fb = float(a), float(b)
        if fa == fb or (tol and math.isclose(fa, fb, rel_tol=0.0, abs_tol=tol)):
            return None
        return f"{path}: {a!r} != {b!r}"
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None or isinstance(a, str) or isinstance(b, str):
        return None if type(a) is type(b) and a == b else f"{path}: {a!r} != {b!r}"
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            d = json_diff(x, y, f"{path}[{i}]", tol)
            if d:
                return d
        return None
    if isinstance(a, Mapping) and isinstance(b, Mapping):
        ka, kb = set(a), set(b)
        if ka != kb:
            extra = sorted(ka - kb)
            missing = sorted(kb - ka)
            return f"{path}: keys differ (unexpected {extra}, missing {missing})"
        for k in sorted(ka):
            d = json_diff(a[k], b[k], f"{path}.{k}", tol)
            if d:
                return d
        return None
    return f"{path}: {type(a).__name__} != {type(b).__name__}"


def json_equal(a: Any, b: Any) -> bool:
    """Structural JSON equality (``1 == 1.0``; booleans are not numbers)."""
    return json_diff(a, b) is None


def _load(root: Path, rel: str) -> Any:
    return json.loads((root / rel).read_text(encoding="utf-8"))


def _check(cond: bool, reason: str) -> None:
    if not cond:
        raise CaseFailure(reason)


def _compare_dump(actual: dict[str, Any], expect: Mapping[str, Any], root: Path) -> None:
    expected = _load(root, expect["dump"])
    diff = json_diff(actual, expected)
    _check(diff is None, f"dump differs at {diff}")
    if "content_sha256" in expect:
        got = content_hash(actual)
        _check(got == expect["content_sha256"], f"content_sha256 {got} != {expect['content_sha256']}")


def _case_dump(case: Mapping[str, Any], root: Path) -> None:
    with open_spdf(root / case["input"]["file"]) as f:
        actual = f.dump()
    _compare_dump(actual, case["expect"], root)


def _case_roundtrip(case: Mapping[str, Any], root: Path) -> None:
    source = _load(root, case["input"]["source"])
    with tempfile.TemporaryDirectory(prefix="spdf-roundtrip-") as tmp:
        out = write_source(source, Path(tmp) / "roundtrip.spdf")
        with open_spdf(out) as f:
            actual = f.dump()
    _compare_dump(actual, case["expect"], root)


def _case_validate(case: Mapping[str, Any], root: Path) -> None:
    r = validate(root / case["input"]["file"])
    e = case["expect"]
    _check(r.valid == e["valid"], f"valid {r.valid} != {e['valid']}")
    _check(r.version == e["version"], f"version {r.version!r} != {e['version']!r}")
    errors = {i.code for i in r.errors}
    warnings = {i.code for i in r.warnings}
    _check(errors == set(e["errors"]), f"errors {sorted(errors)} != {sorted(e['errors'])}")
    _check(warnings == set(e["warnings"]), f"warnings {sorted(warnings)} != {sorted(e['warnings'])}")


def _expected_id(x: Mapping[str, Any]) -> str:
    for key in ("fragment_id", "unit_id", "figure_id"):
        if key in x:
            return str(x[key])
    raise CaseFailure(f"result item without an id: {x}")


def _compare_results(got: list[SearchResult], expected: list[Mapping[str, Any]], *, with_via: bool) -> None:
    ids = [h.id for h in got]
    exp_ids = [_expected_id(x) for x in expected]
    _check(ids == exp_ids, f"result ids {ids} != {exp_ids}")
    for h, x in zip(got, expected, strict=True):
        key = next(k for k in ("fragment_id", "unit_id", "figure_id") if k in x)
        _check(key == f"{h.target}_id", f"{h.id}: result is a {h.target}, expected {key}")
        _check(
            math.isclose(h.score, float(x["score"]), rel_tol=0.0, abs_tol=SCORE_TOLERANCE),
            f"score of {h.id}: {h.score} != {x['score']}",
        )
        _check(h.anchor_uri == x["anchor_uri"], f"anchor_uri of {h.id}: {h.anchor_uri} != {x['anchor_uri']}")
        if with_via and "via" in x:
            _check(list(h.via) == list(x["via"]), f"via of {h.id}: {list(h.via)} != {x['via']}")


def _case_search_lexical(case: Mapping[str, Any], root: Path) -> None:
    i, e = case["input"], case["expect"]
    with open_spdf(root / i["file"]) as f:
        res = f.search_details(i["query"], limit=int(i.get("limit", 10)))
    if "route" in e:
        _check(res.route == e["route"], f"route {res.route} != {e['route']}")
    if "match" in e:
        _check(res.match == e["match"], f"match {res.match!r} != {e['match']!r}")
    _compare_results(res.results, e["results"], with_via=True)


def _case_search_vector(case: Mapping[str, Any], root: Path) -> None:
    i, e = case["input"], case["expect"]
    with open_spdf(root / i["file"]) as f:
        got = f.search_vector(
            i["query_vector"],
            space=i["space"],
            limit=int(i.get("limit", 10)),
            target=i.get("target", "fragment"),
        )
    _compare_results(got, e["results"], with_via=False)


def _case_search_hybrid(case: Mapping[str, Any], root: Path) -> None:
    i, e = case["input"], case["expect"]
    with open_spdf(root / i["file"]) as f:
        got = f.search_hybrid(i["query"], i["query_vector"], space=i["space"], limit=int(i.get("limit", 10)))
    _compare_results(got, e["results"], with_via=True)


def _case_anchor_uri(case: Mapping[str, Any], root: Path) -> None:
    i, e = case["input"], case["expect"]
    if e.get("error"):
        try:
            parse_uri(i["uri"])
        except Exception:
            return
        raise CaseFailure(f"parse({i['uri']!r}) should fail")
    if "anchor" in i:
        uri = make_uri(i["docref"], i["anchor"], i.get("anchor_end"))
        _check(uri == e["uri"], f"format gave {uri} != {e['uri']}")
        parsed = parse_uri(e["uri"])
        expected = {"docref": i["docref"], "locator": e["locator"]}
        diff = json_diff(parsed, expected)
        _check(diff is None, f"parse differs at {diff}")
        again = format_uri(parsed["docref"], parsed["locator"])
        _check(again == e["uri"], f"format(parse(uri)) gave {again}")
        return
    parsed = parse_uri(i["uri"])
    diff = json_diff(parsed, {"docref": e["docref"], "locator": e["locator"]})
    _check(diff is None, f"parse differs at {diff}")
    again = format_uri(parsed["docref"], parsed["locator"])
    _check(again == e["canonical"], f"format(parse(uri)) gave {again} != {e['canonical']}")


def _case_cite(case: Mapping[str, Any], root: Path) -> None:
    i, e = case["input"], case["expect"]
    text = cite(i.get("anchor"), i["metadata"], i.get("locale", "es"), i.get("anchor_end"))
    _check(text == e["text"], f"cite gave {text!r} != {e['text']!r}")


def _case_quantize(case: Mapping[str, Any], root: Path) -> None:
    i, e = case["input"], case["expect"]
    if e.get("error"):
        try:
            quantize(i["values"], i["dtype"])
        except ValueError:
            return
        raise CaseFailure(f"quantize({i['values']!r}, {i['dtype']}) should fail")
    got = quantize(i["values"], i["dtype"]).hex()
    _check(got == e["hex"], f"quantize gave {got} != {e['hex']}")


def _case_cite_passage(case: Mapping[str, Any], root: Path) -> None:
    i, e = case["input"], case["expect"]
    with open_spdf(root / i["file"]) as f:
        got = f.cite_passage(i["fragment"], i["quote"], locale=i.get("locale", "es"))
    _check(got.text == e["text"], f"citation {got.text!r} != {e['text']!r}")
    _check(got.uri == e["uri"], f"uri {got.uri} != {e['uri']}")


def _case_locate(case: Mapping[str, Any], root: Path) -> None:
    i, e = case["input"], case["expect"]
    with open_spdf(root / i["file"]) as f:
        got = f.locate(i["reference"]).to_dict()
    diff = json_diff(got, dict(e))
    _check(diff is None, f"locate differs at {diff}")


def _documents(root: Path, files: Iterable[str]) -> list[Document]:
    docs = []
    for rel in files:
        with open_spdf(root / rel) as f:
            docs.append(f.document)
    return docs


def _case_export_csl(case: Mapping[str, Any], root: Path) -> None:
    i, e = case["input"], case["expect"]
    docs = _documents(root, i["files"])
    if i.get("anchor") is not None and len(docs) == 1:
        items = [csl_citation_item(docs[0], i["anchor"], i.get("anchor_end"))]
    else:
        items = to_csl_json(docs)
    diff = json_diff(items, e["items"])
    _check(diff is None, f"CSL-JSON differs at {diff}")


def _bib_lines(text: str) -> list[str]:
    return [line.strip() for line in text.replace("\r\n", "\n").split("\n") if line.strip()]


def _case_export_bibtex(case: Mapping[str, Any], root: Path) -> None:
    i, e = case["input"], case["expect"]
    got, exp = _bib_lines(to_bibtex(_documents(root, i["files"]))), _bib_lines(e["text"])
    if got != exp:
        first = next((k for k, (a, b) in enumerate(zip(got, exp, strict=False)) if a != b), min(len(got), len(exp)))
        raise CaseFailure(
            f"BibTeX line {first + 1}: {got[first] if first < len(got) else None!r} != "
            f"{exp[first] if first < len(exp) else None!r}"
        )


def _case_export_structure(case: Mapping[str, Any], root: Path) -> None:
    import xml.etree.ElementTree as ET

    i, e = case["input"], case["expect"]
    fmt = i["format"]
    with open_spdf(root / i["file"]) as f:
        pages: list[dict[str, Any]] = []
        if fmt == "alto":
            tree = ET.fromstring(f.to_alto())
            for page in tree.iter("{http://www.loc.gov/standards/alto/ns-v4#}Page"):
                pages.append({"physical": int(page.get("PHYSICAL_IMG_NR") or 0), "printed": page.get("PRINTED_IMG_NR")})
        elif fmt == "tei":
            tree = ET.fromstring(f.to_tei())
            body = tree.find("{http://www.tei-c.org/ns/1.0}text/{http://www.tei-c.org/ns/1.0}body")
            for pb in body.iter("{http://www.tei-c.org/ns/1.0}pb") if body is not None else []:
                pages.append({"n": pb.get("n")})
        elif fmt == "iiif":
            base = "https://example.org/iiif"
            manifest = f.to_iiif(base)
            page_canvases = {f"{base}/canvas/{u.ord}" for u in f.iter_units() if u.anchor.type == "page"}
            for canvas in manifest["items"]:
                if canvas["id"] in page_canvases:
                    label = canvas.get("label")
                    pages.append({"label": next(iter(label.values()))[0] if label else None})
        else:
            raise CaseFailure(f"unknown format {fmt!r}")
    diff = json_diff(pages, e["pages"])
    _check(diff is None, f"{fmt} page sequence differs at {diff}")


HANDLERS: dict[str, Callable[[Mapping[str, Any], Path], None]] = {
    "dump": _case_dump,
    "legacy_dump": _case_dump,
    "roundtrip": _case_roundtrip,
    "validate": _case_validate,
    "search_lexical": _case_search_lexical,
    "search_vector": _case_search_vector,
    "search_hybrid": _case_search_hybrid,
    "anchor_uri": _case_anchor_uri,
    "cite": _case_cite,
    "quantize": _case_quantize,
    "locate": _case_locate,
    "cite_passage": _case_cite_passage,
    "export_csl": _case_export_csl,
    "export_bibtex": _case_export_bibtex,
    "export_structure": _case_export_structure,
}


def run(root: str | os.PathLike[str], only: Iterable[str] | None = None) -> dict[str, Any]:
    """Run every case under ``root/cases`` (or only the ids in ``only``) and return the report."""
    base = Path(root)
    wanted = set(only) if only else None
    passed: list[str] = []
    failed: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    for path in sorted((base / "cases").glob("*.json")):
        try:
            case = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as exc:
            failed.append({"id": path.stem, "reason": f"unreadable case: {exc}"})
            continue
        cid = str(case.get("id", path.stem))
        if wanted is not None and cid not in wanted:
            continue
        handler = HANDLERS.get(str(case.get("kind")))
        if handler is None:
            failed.append({"id": cid, "reason": f"unknown kind {case.get('kind')!r}"})
            continue
        try:
            handler(case, base)
        except CaseFailure as exc:
            failed.append({"id": cid, "reason": str(exc)})
        except Exception as exc:  # a case that throws is a failure
            tb = traceback.extract_tb(exc.__traceback__)[-1]
            failed.append({"id": cid, "reason": f"{type(exc).__name__}: {exc} ({Path(tb.filename).name}:{tb.lineno})"})
        else:
            passed.append(cid)
    return {"impl": IMPL, "version": __version__, "passed": passed, "failed": failed, "skipped": skipped}
