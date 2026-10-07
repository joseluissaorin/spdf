#!/usr/bin/env python3
"""Generate the SPDF conformance suite (Python 3.13, standard library only).

    python3 conformance/tools/generar.py            # regenerate conformance/
    python3 conformance/tools/generar.py --out DIR  # generate elsewhere (verificar.py does this)
    python3 conformance/tools/generar.py --sellar   # fill derived fields of the sources first

Inputs (explicit, committed):
  sources/*.json         SPDF 5.0 sources in the canonical dump format, plus vector
                         values (vectors.<space>.items) and blob bytes (blobs[].data_base64)
  legacy-sources/*.json  native rows of authentic 4.0/4.1 files (Spanish schema)
  tools/manual/*.json    hand-written anchor URI and citation cases, search queries

Outputs (generated, committed):
  files/*.spdf  legacy/*.spdf  invalid/*.spdf  expected/*.dump.json  cases/*.json
  manifest.json

The expected dump of a 5.0 file IS its source minus vector values and blob bytes; the
generator writes the file, dumps it back with the reference reader and refuses to go
on if the two differ. Lexical results come from SQLite itself running the reference
SQL; vector and hybrid results are checked with exact rational arithmetic and must
have no ties.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import shutil
import sqlite3
import sys
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spdfref as R  # noqa: E402

HERE = Path(__file__).resolve().parent
CONF = HERE.parent
SUITE_VERSION = "0.4.0"
# Public test key. NEVER use it for anything but this suite.
TEST_SECRET = hashlib.sha256(b"SPDF conformance test key: public, never use it for real signatures").digest()
SIGNED = {"quijote"}
GENERATED_DIRS = ("files", "legacy", "invalid", "expected", "cases")
MIN_GAP = Fraction(1, 10**4)  # minimum distance between consecutive vector/hybrid scores


class Fallo(Exception):
    pass


def check(cond, msg):
    if not cond:
        raise Fallo(msg)


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------


def load_sources() -> dict[str, dict]:
    return {p.stem: R.read_json(p) for p in sorted((CONF / "sources").glob("*.json"))}


def sealed(name: str, src: dict) -> dict:
    s = R.seal_source(src)
    if name in SIGNED:
        R.sign_dump_meta(s, TEST_SECRET)
    return R.canon(s)


def seal_all() -> None:
    for name, src in load_sources().items():
        R.write_json(CONF / "sources" / f"{name}.json", sealed(name, src))
        print(f"sellada sources/{name}.json")


def same(a, b) -> bool:
    return R.jcs(R.canon(a)) == R.jcs(R.canon(b))


# ---------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------


def build_files(out: Path, sources: dict) -> dict[str, dict]:
    dumps = {}
    for name, src in sources.items():
        check(same(sealed(name, src), src), f"sources/{name}.json is not sealed: run generar.py --sellar")
        path = out / "files" / f"{name}.spdf"
        R.write_50(src, path)
        dump = R.dump_file(path)
        expected = R.strip_source(src)
        check(same(dump, expected), f"{name}: the dump of the written file differs from its source")
        R.write_json(out / "expected" / f"{name}.dump.json", expected)
        dumps[name] = expected
    return dumps


def build_legacy(out: Path) -> dict[str, dict]:
    dumps = {}
    for p in sorted((CONF / "legacy-sources").glob("*.json")):
        src = R.read_json(p)
        path = out / "legacy" / f"{p.stem}.spdf"
        R.write_legacy(src, path)
        check(path.read_bytes()[:2] == b"\x1f\x8b", f"{p.stem}: legacy files are gzip-wrapped")
        dump = R.dump_file(path)
        check(dump.get("legacy") is True and dump["spdf_version"] == src["version"], f"{p.stem}: bad legacy detection")
        R.write_json(out / "expected" / f"{p.stem}.dump.json", dump)
        dumps[p.stem] = dump
    return dumps


def _mutate(path: Path, *sql: str, params=()) -> None:
    con = sqlite3.connect(str(path))
    for s in sql:
        con.execute(s, params) if params and "?" in s else con.execute(s)
    con.commit()
    con.execute("VACUUM")
    con.close()


def build_invalid(out: Path, sources: dict) -> list[tuple[str, dict]]:
    """Each file breaks exactly one rule. Returns (file, expect) pairs."""
    inv = out / "invalid"
    inv.mkdir(parents=True, exist_ok=True)
    base = sources["minimo"]
    made: list[tuple[str, dict]] = []

    def fresh(name, src=None):
        path = inv / f"{name}.spdf"
        R.write_50(src or base, path, page_size=1024)  # small pages keep the repository light
        return path

    def expect(name, errors=(), warnings=(), version="5.0"):
        made.append((f"invalid/{name}.spdf", {"valid": not errors, "version": version, "errors": sorted(errors), "warnings": sorted(warnings)}))

    (inv / "E001-not-sqlite.spdf").write_bytes(b"This is not an SPDF file, just text.\n")
    expect("E001-not-sqlite", ["E001"], version=None)
    (inv / "E001-gzip-of-text.spdf").write_bytes(gzip.compress(b"Neither is this.\n", mtime=0))
    expect("E001-gzip-of-text", ["E001"], version=None)

    p = fresh("E002-application-id")
    _mutate(p, "PRAGMA application_id = 0")
    expect("E002-application-id", ["E002"], version=None)
    p = fresh("E002-major-version")
    _mutate(p, "PRAGMA user_version = 600")
    expect("E002-major-version", ["E002"], version=None)

    p = fresh("_tmp")
    data = p.read_bytes()
    p.unlink()
    (inv / "E003-gzip-wrapped.spdf").write_bytes(gzip.compress(data, compresslevel=6, mtime=0))
    expect("E003-gzip-wrapped", warnings=["E003"])

    _mutate(fresh("E010-missing-table"), "DROP TABLE sections")
    expect("E010-missing-table", ["E010"])
    _mutate(fresh("E010-missing-documents"), "DROP TABLE documents")
    expect("E010-missing-documents", ["E010"])
    _mutate(fresh("E011-missing-column"), "ALTER TABLE units DROP COLUMN words")
    expect("E011-missing-column", ["E011"])
    _mutate(fresh("E012-missing-meta-key"), "DELETE FROM spdf_meta WHERE key = 'document_id'")
    expect("E012-missing-meta-key", ["E012"])
    _mutate(fresh("E013-two-documents"),
            "INSERT INTO documents SELECT 'otro', kind, metadata, source_sha256, source_ref, mime, bytes, unit_count, duration, created, updated, title, authors, year, language, rights FROM documents")
    expect("E013-two-documents", ["E013"])
    _mutate(fresh("E020-trigger"), "CREATE TRIGGER units_ai AFTER INSERT ON units BEGIN SELECT 1; END")
    expect("E020-trigger", ["E020"])
    _mutate(fresh("E020-view"), "CREATE VIEW v_units AS SELECT id, text FROM units")
    expect("E020-view", ["E020"])
    _mutate(fresh("E020-virtual-table"), "CREATE VIRTUAL TABLE x_acme_index USING fts5(body)")
    expect("E020-virtual-table", ["E020"])

    space = ("INSERT INTO spaces (id, provider, model, version, dims, dtype, normalized, truncated_from, modalities, task_prefixes, created) "
             "VALUES ('toy@8', 'spdf-conformance', 'toy', '1', 8, '{dtype}', 1, NULL, '[\"text\"]', NULL, NULL)")
    _mutate(fresh("E030-vector-length"), space.format(dtype="f32"),
            "INSERT INTO vectors (target, id, space, document, data) VALUES ('fragment', 'f1', 'toy@8', 'minimo', zeroblob(31))")
    expect("E030-vector-length", ["E030"])
    _mutate(fresh("E031-unknown-space"),
            "INSERT INTO vectors (target, id, space, document, data) VALUES ('fragment', 'f1', 'nope@8', 'minimo', zeroblob(32))")
    expect("E031-unknown-space", ["E031"])
    _mutate(fresh("E032-unknown-dtype"), space.format(dtype="bf16"))
    expect("E032-unknown-dtype", ["E032"])

    _mutate(fresh("E040-anchor-json"), "UPDATE units SET anchor = '{\"type\":\"section\",' WHERE id = 'u1'")
    expect("E040-anchor-json", ["E040"])
    _mutate(fresh("E040-anchor-member"), "UPDATE fragments SET anchor = '{\"type\":\"page\",\"printed\":\"3\"}' WHERE id = 'f1'")
    expect("E040-anchor-member", ["E040"])
    _mutate(fresh("E041-anchor-type"), "UPDATE units SET anchor = '{\"type\":\"chapter\",\"n\":1}' WHERE id = 'u2'")
    expect("E041-anchor-type", ["E041"])
    _mutate(fresh("E042-chars-range"), "UPDATE fragments SET anchor = '{\"chars\":[0,9999],\"line_from\":1,\"line_to\":4,\"type\":\"verse\"}' WHERE id = 'f2'")
    expect("E042-chars-range", ["E042"])
    _mutate(fresh("E050-metadata-json"), "UPDATE documents SET metadata = '{\"type\":'")
    expect("E050-metadata-json", ["E050"])
    _mutate(fresh("E051-metadata-csl"), "UPDATE documents SET metadata = '{\"type\":\"book\"}'")
    expect("E051-metadata-csl", ["E051"])
    _mutate(fresh("E060-required-extension"), "INSERT INTO extensions (name, version, required) VALUES ('x_acme_secret', '1.0', 1)")
    expect("E060-required-extension", ["E060"])
    _mutate(fresh("E070-fts-out-of-sync"), "UPDATE fragments SET text = 'Texto cambiado sin reindexar.' WHERE n = 1")
    expect("E070-fts-out-of-sync", ["E070"])
    _mutate(fresh("E080-blob-sha256"), "UPDATE blobs SET sha256 = '0000000000000000000000000000000000000000000000000000000000000000'")
    expect("E080-blob-sha256", ["E080"])
    _mutate(fresh("E081-content-sha256"),
            "INSERT INTO spdf_meta (key, value) VALUES ('content_sha256', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')")
    expect("E081-content-sha256", ["E081"])
    q = json.loads(json.dumps(sources["quijote"]))
    sig = bytearray(base64.b64decode(q["meta"]["signature"]))
    sig[0] ^= 1
    q["meta"]["signature"] = base64.b64encode(bytes(sig)).decode("ascii")
    fresh("E082-signature", q)
    expect("E082-signature", ["E082"])
    _mutate(fresh("E090-ord-gap"), "UPDATE units SET ord = 3 WHERE id = 'u2'")
    expect("E090-ord-gap", ["E090"])

    _mutate(fresh("OK-integral-number"), "UPDATE units SET anchor = '{\"paragraph\":1.0,\"path\":[\"XXI\"],\"type\":\"section\"}' WHERE id = 'u1'",
            "UPDATE fragments SET anchor = '{\"chars\":[0.0,111],\"line_from\":1.0,\"line_to\":4,\"type\":\"verse\"}' WHERE id = 'f1'")
    expect("OK-integral-number")
    _mutate(fresh("W100-semantic-without-vectors"), "UPDATE spdf_meta SET value = 'core semantic' WHERE key = 'profile'")
    expect("W100-semantic-without-vectors", warnings=["W100"])
    _mutate(fresh("W101-media-without-time"), "UPDATE spdf_meta SET value = 'core media' WHERE key = 'profile'")
    expect("W101-media-without-time", warnings=["W101"])
    _mutate(fresh("W102-unit-count"), "UPDATE documents SET unit_count = 5")
    expect("W102-unit-count", warnings=["W102"])
    _mutate(fresh("W105-newer-minor"), "PRAGMA user_version = 510")
    expect("W105-newer-minor", warnings=["W105"], version="5.1")
    _mutate(fresh("W105-newer-minor-new-anchor-type"), "PRAGMA user_version = 510",
            "UPDATE units SET anchor = '{\"n\":2,\"type\":\"stanza\"}' WHERE id = 'u2'")
    expect("W105-newer-minor-new-anchor-type", warnings=["E041", "W105"], version="5.1")
    return made


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------


def docref(dump: dict) -> str:
    return "sha256-" + dump["document"]["source_sha256"]


def frag_index(dump: dict) -> dict[str, dict]:
    return {f["id"]: f for f in dump["fragments"]}


def result_item(dump, fid, score, via=None, target="fragment"):
    if target == "fragment":
        f = frag_index(dump)[fid]
        item = {"fragment_id": fid, "score": R.canon(float(score)), "anchor_uri": R.format_uri(docref(dump), f["anchor"], f["anchor_end"])}
    else:
        rows = {r["id"]: r for r in dump["units" if target == "unit" else "figures"]}
        item = {f"{target}_id": fid, "score": R.canon(float(score)), "anchor_uri": R.format_uri(docref(dump), rows[fid]["anchor"])}
    if via is not None:
        item["via"] = via
    return item


def assert_gaps(scores: list, what: str) -> None:
    for a, b in zip(scores, scores[1:]):
        check(a - b >= MIN_GAP, f"{what}: scores too close or tied ({float(a)} vs {float(b)})")


def build_cases(out: Path, dumps: dict, legacy: dict, invalid: list) -> list[dict]:
    cases: list[dict] = []

    def add(cid, kind, inp, exp):
        cases.append({"id": cid, "kind": kind, "input": inp, "expect": exp})

    for name, dump in dumps.items():
        add(f"dump-{name}", "dump", {"file": f"files/{name}.spdf"},
            {"dump": f"expected/{name}.dump.json", "content_sha256": R.content_sha256(dump)})
        add(f"roundtrip-{name}", "roundtrip", {"source": f"sources/{name}.json"}, {"dump": f"expected/{name}.dump.json"})
        v = R.validate_file(out / "files" / f"{name}.spdf")
        check(v["valid"] and not v["warnings"], f"{name} must validate cleanly: {v}")
        add(f"validate-{name}", "validate", {"file": f"files/{name}.spdf"},
            {"valid": True, "version": "5.0", "errors": [], "warnings": []})
    for name, dump in legacy.items():
        add(f"legacy-dump-{name}", "legacy_dump", {"file": f"legacy/{name}.spdf"},
            {"dump": f"expected/{name}.dump.json", "content_sha256": R.content_sha256(dump)})
        v = R.validate_file(out / "legacy" / f"{name}.spdf")
        check(v["valid"] and [w["code"] for w in v["warnings"]] == ["W110"], f"{name}: legacy validation {v}")
        add(f"validate-{name}", "validate", {"file": f"legacy/{name}.spdf"},
            {"valid": True, "version": dump["spdf_version"], "errors": [], "warnings": ["W110"]})
    for rel, exp in invalid:
        v = R.validate_file(out / rel)
        got = {"valid": v["valid"], "version": v["version"], "errors": sorted({e["code"] for e in v["errors"]}),
               "warnings": sorted({w["code"] for w in v["warnings"]})}
        check(got == exp, f"{rel}: reference validator says {got}, expected {exp}")
        add(f"validate-{Path(rel).stem}", "validate", {"file": rel}, exp)

    q = R.read_json(HERE / "manual" / "busquedas.json")
    limit = q["lexical_limit"]
    for name, queries in q["lexical"].items():
        dump = dumps[name]
        o = R.open_file(out / "files" / f"{name}.spdf")
        try:
            for i, query in enumerate(queries, start=1):
                r = R.lexical_search(o.con, query, limit)
                exp = {"route": r["route"], "match": r["match"],
                       "results": [result_item(dump, fid, score, ["lexical"]) for _, fid, score in r["results"]]}
                add(f"search-lexical-{name}-{i:02d}", "search_lexical", {"file": f"files/{name}.spdf", "query": query, "limit": limit}, exp)
        finally:
            o.close()
    for i, v in enumerate(q["vector"], start=1):
        name = v["file"]
        o = R.open_file(out / "files" / f"{name}.spdf")
        try:
            target = v.get("target", "fragment")
            exact = R.vector_search(o.con, v["space"], v["query_vector"], 10**6, target=target, exact=True)
            assert_gaps([s for _, _, s in exact], f"vector case {i}")
            approx = R.vector_search(o.con, v["space"], v["query_vector"], v["limit"], target=target)
            check([x[1] for x in approx] == [x[1] for x in exact[: v["limit"]]], f"vector case {i}: float order differs from exact order")
            exp = {"results": [result_item(dumps[name], fid, score, target=target) for _, fid, score in approx]}
            add(f"search-vector-{name}-{i:02d}", "search_vector",
                {"file": f"files/{name}.spdf", "space": v["space"], "target": target, "query_vector": v["query_vector"], "limit": v["limit"]}, exp)
        finally:
            o.close()
    for i, h in enumerate(q["hybrid"], start=1):
        name = h["file"]
        o = R.open_file(out / "files" / f"{name}.spdf")
        try:
            _, full_exact = R.hybrid_search(o.con, h["query"], h["space"], h["query_vector"], h["limit"], exact=True)
            assert_gaps([s for _, _, s, _ in full_exact[: h["limit"] + 1]], f"hybrid case {i}")
            top, _ = R.hybrid_search(o.con, h["query"], h["space"], h["query_vector"], h["limit"])
            check([x[1] for x in top] == [x[1] for x in full_exact[: h["limit"]]], f"hybrid case {i}: float order differs from exact order")
            exp = {"results": [result_item(dumps[name], fid, score, via) for _, fid, score, via in top]}
            add(f"search-hybrid-{name}-{i:02d}", "search_hybrid",
                {"file": f"files/{name}.spdf", "query": h["query"], "space": h["space"], "query_vector": h["query_vector"], "limit": h["limit"]}, exp)
        finally:
            o.close()

    m = R.read_json(HERE / "manual" / "anchor_uri.json")
    for c in m["format"]:
        i, e = R.canon(c["input"]), R.canon(c["expect"])
        got = R.format_uri(i["docref"], i["anchor"], i["anchor_end"])
        check(got == e["uri"], f"{c['id']}: reference formats {got!r}, the hand-written case says {e['uri']!r}")
        parsed = R.parse_uri(e["uri"])
        check(same(parsed, {"docref": i["docref"], "locator": e["locator"]}), f"{c['id']}: reference parses {parsed}")
        check(R.format_locator(parsed["docref"], parsed["locator"]) == e["uri"], f"{c['id']}: no round trip")
        add(c["id"], "anchor_uri", i, e)
    for c in m["parse"]:
        e = c["expect"]
        parsed = R.parse_uri(c["input"]["uri"])
        check(same(parsed, {"docref": e["docref"], "locator": e["locator"]}), f"{c['id']}: reference parses {parsed}")
        check(R.format_locator(parsed["docref"], parsed["locator"]) == e["canonical"], f"{c['id']}: canonical form differs")
        add(c["id"], "anchor_uri", c["input"], e)
    for c in m["errors"]:
        try:
            R.parse_uri(c["input"]["uri"])
        except R.SpdfError:
            pass
        else:
            raise Fallo(f"{c['id']}: the reference accepts an invalid URI")
        add(c["id"], "anchor_uri", c["input"], c["expect"])

    for c in R.read_json(HERE / "manual" / "quantize.json"):
        i, e = R.canon(c["input"]), c["expect"]  # check exactly what the case file will hold
        try:
            got = {"hex": R.quantize(i["values"], i["dtype"]).hex()}
        except R.SpdfError:
            got = {"error": True}
        check(got == e, f"{c['id']}: reference quantizes to {got}, the hand-written case says {e}")
        add(c["id"], "quantize", i, e)

    all_dumps = {f"files/{k}.spdf": v for k, v in dumps.items()} | {f"legacy/{k}.spdf": v for k, v in legacy.items()}

    for c in R.read_json(HERE / "manual" / "locate.json"):
        i, e = R.canon(c["input"]), R.canon(c["expect"])
        got = R.locate(all_dumps[i["file"]], i["reference"])
        check(same(got, e), f"{c['id']}: reference locates {got}, the hand-written case says {e}")
        add(c["id"], "locate", i, e)

    ex = R.read_json(HERE / "manual" / "export.json")
    def run_export(kind, i):
        if kind == "export_structure":
            return R.export_structure(all_dumps[i["file"]], i["format"])
        items = [all_dumps[f]["document"]["metadata"] for f in i["files"]]
        if kind == "export_csl":
            return {"items": R.export_csl(items, i.get("anchor"), i.get("anchor_end"))}
        return {"text": R.export_bibtex(items)}
    for c in ex["manual"]:
        i, e = R.canon(c["input"]), R.canon(c["expect"])
        got = run_export(c["kind"], i)
        if c["kind"] == "export_bibtex":
            check(R.normalize_bibtex(got["text"]) == R.normalize_bibtex(e["text"]) and got["text"] == e["text"],
                  f"{c['id']}: reference exports\n{got['text']}\nthe hand-written case says\n{e['text']}")
        else:
            check(same(got, e), f"{c['id']}: reference exports {got}, the hand-written case says {e}")
        add(c["id"], c["kind"], i, e)
    for c in ex["computed"]:
        i = R.canon(c["input"])
        add(c["id"], c["kind"], i, run_export(c["kind"], i))

    for c in R.read_json(HERE / "manual" / "cite.json"):
        i = R.canon(c["input"])
        got = R.cite(i["anchor"], i["anchor_end"], i["metadata"], i["locale"])
        check(got == c["expect"]["text"], f"{c['id']}: reference cites {got!r}, the hand-written case says {c['expect']['text']!r}")
        add(c["id"], "cite", i, c["expect"])

    ids = [c["id"] for c in cases]
    check(len(ids) == len(set(ids)), "duplicate case ids")
    return cases


def write_cases(out: Path, cases: list[dict]) -> dict:
    d = out / "cases"
    for c in cases:
        R.write_json(d / f"{c['id']}.json", c)
    by_kind: dict[str, int] = {}
    h = hashlib.sha256()
    for c in sorted(cases, key=lambda c: c["id"]):
        by_kind[c["kind"]] = by_kind.get(c["kind"], 0) + 1
        h.update((c["id"] + "\n").encode())
        h.update((d / f"{c['id']}.json").read_bytes())
    manifest = {"suite": "spdf-conformance", "spdf_version": R.SPDF_VERSION, "suite_version": SUITE_VERSION, "cases": len(cases),
                "by_kind": dict(sorted(by_kind.items())), "cases_sha256": h.hexdigest(),
                "test_public_key": "ed25519:" + base64.b64encode(R.ed25519.public_key(TEST_SECRET)).decode("ascii")}
    R.write_json(out / "manifest.json", manifest)
    return manifest


def generate(out: Path) -> dict:
    for d in GENERATED_DIRS:
        shutil.rmtree(out / d, ignore_errors=True)
        (out / d).mkdir(parents=True, exist_ok=True)
    sources = load_sources()
    dumps = build_files(out, sources)
    legacy = build_legacy(out)
    invalid = build_invalid(out, sources)
    cases = build_cases(out, dumps, legacy, invalid)
    return write_cases(out, cases)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=CONF, help="output directory (default: conformance/)")
    ap.add_argument("--sellar", action="store_true", help="fill the derived fields of sources/*.json before generating")
    a = ap.parse_args()
    if a.sellar:
        seal_all()
    try:
        m = generate(a.out.resolve())
    except Fallo as e:
        print(f"generar.py: {e}", file=sys.stderr)
        return 1
    print(f"{m['cases']} casos ({', '.join(f'{k} {v}' for k, v in m['by_kind'].items())}); sha256 {m['cases_sha256'][:16]}…")
    return 0


if __name__ == "__main__":
    sys.exit(main())
