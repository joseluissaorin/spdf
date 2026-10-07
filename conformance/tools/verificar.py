#!/usr/bin/env python3
"""Check the SPDF conformance suite (Python 3.13, standard library only).

    python3 conformance/tools/verificar.py            # full check (used by CI)
    python3 conformance/tools/verificar.py --runner   # only run the cases, print the runner report

What it checks:
  1. Every case file is well formed: id = file name, known kind, the inputs and
     expectations that kind needs, and every referenced file exists.
  2. The generator is deterministic: two runs in temporary directories produce the
     same bytes for every JSON output (cases, expected dumps, manifest) and the same
     dumps for every .spdf file, and they match what is committed.
  3. The reference runner (spdfref.py) passes every committed case against the
     committed files. Its report has the shape every implementation must print:
     {"impl", "version", "passed", "failed", "skipped"}.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spdfref as R  # noqa: E402

HERE = Path(__file__).resolve().parent
CONF = HERE.parent
KINDS = {
    "dump": ({"file"}, {"dump", "content_sha256"}),
    "legacy_dump": ({"file"}, {"dump", "content_sha256"}),
    "roundtrip": ({"source"}, {"dump"}),
    "validate": ({"file"}, {"valid", "version", "errors", "warnings"}),
    "search_lexical": ({"file", "query", "limit"}, {"route", "match", "results"}),
    "search_vector": ({"file", "space", "target", "query_vector", "limit"}, {"results"}),
    "search_hybrid": ({"file", "query", "space", "query_vector", "limit"}, {"results"}),
    "anchor_uri": (set(), set()),
    "cite": ({"anchor", "anchor_end", "metadata", "locale"}, {"text"}),
    "quantize": ({"dtype", "values"}, set()),
}
TOL = 1e-6


def problems_in_cases() -> list[str]:
    out = []
    for p in sorted((CONF / "cases").glob("*.json")):
        try:
            c = R.read_json(p)
        except json.JSONDecodeError as e:
            out.append(f"{p.name}: invalid JSON ({e})")
            continue
        if set(c) != {"id", "kind", "input", "expect"}:
            out.append(f"{p.name}: keys must be id, kind, input, expect")
            continue
        if c["id"] != p.stem:
            out.append(f"{p.name}: id {c['id']!r} does not match the file name")
        if c["kind"] not in KINDS:
            out.append(f"{p.name}: unknown kind {c['kind']!r}")
            continue
        need_in, need_out = KINDS[c["kind"]]
        if not need_in <= set(c["input"]):
            out.append(f"{p.name}: input lacks {sorted(need_in - set(c['input']))}")
        if not need_out <= set(c["expect"]):
            out.append(f"{p.name}: expect lacks {sorted(need_out - set(c['expect']))}")
        if c["kind"] == "anchor_uri":
            i, e = c["input"], c["expect"]
            ok = ({"docref", "anchor", "anchor_end"} <= set(i) and {"uri", "locator"} <= set(e)) or \
                 (set(i) == {"uri"} and ({"docref", "locator", "canonical"} <= set(e) or e == {"error": True}))
            if not ok:
                out.append(f"{p.name}: anchor_uri case is neither format, parse nor error")
        for key in ("file", "source"):
            if key in c["input"] and not (CONF / c["input"][key]).exists():
                out.append(f"{p.name}: missing {c['input'][key]}")
        if "dump" in c["expect"] and not (CONF / c["expect"]["dump"]).exists():
            out.append(f"{p.name}: missing {c['expect']['dump']}")
    return out


def _close(a, b) -> bool:
    return abs(float(a) - float(b)) <= TOL


def _results_equal(got: list[dict], exp: list[dict]) -> str | None:
    if [g["fragment_id"] for g in got] != [e["fragment_id"] for e in exp]:
        return f"order {[g['fragment_id'] for g in got]} != {[e['fragment_id'] for e in exp]}"
    for g, e in zip(got, exp):
        if not _close(g["score"], e["score"]):
            return f"{e['fragment_id']}: score {g['score']} != {e['score']}"
        if g.get("anchor_uri") != e.get("anchor_uri"):
            return f"{e['fragment_id']}: anchor_uri {g.get('anchor_uri')} != {e.get('anchor_uri')}"
        if "via" in e and g.get("via") != e["via"]:
            return f"{e['fragment_id']}: via {g.get('via')} != {e['via']}"
    return None


def run_case(c: dict, base: Path = CONF) -> str | None:
    """None if the reference passes the case, else the reason."""
    k, i, e = c["kind"], c["input"], c["expect"]
    if k in ("dump", "legacy_dump"):
        d = R.dump_file(base / i["file"])
        if not R.jcs(d) == R.jcs(R.canon(R.read_json(base / e["dump"]))):
            return "dump differs"
        if R.content_sha256(d) != e["content_sha256"]:
            return "content_sha256 differs"
        return None
    if k == "roundtrip":
        with tempfile.TemporaryDirectory() as t:
            path = Path(t) / "x.spdf"
            R.write_50(R.read_json(base / i["source"]), path)
            d = R.dump_file(path)
        return None if R.jcs(d) == R.jcs(R.canon(R.read_json(base / e["dump"]))) else "roundtrip dump differs"
    if k == "validate":
        v = R.validate_file(base / i["file"])
        got = {"valid": v["valid"], "version": v["version"], "errors": sorted({x["code"] for x in v["errors"]}),
               "warnings": sorted({x["code"] for x in v["warnings"]})}
        return None if got == e else f"got {got}"
    if k in ("search_lexical", "search_vector", "search_hybrid"):
        dump = R.dump_file(base / i["file"])
        frags = {f["id"]: f for f in dump["fragments"]}
        ref = "sha256-" + dump["document"]["source_sha256"]
        uri = lambda fid: R.format_uri(ref, frags[fid]["anchor"], frags[fid]["anchor_end"])
        o = R.open_file(base / i["file"])
        try:
            if k == "search_lexical":
                r = R.lexical_search(o.con, i["query"], i["limit"])
                if r["route"] != e["route"] or r["match"] != e["match"]:
                    return f"route/match {r['route']}/{r['match']!r}"
                got = [{"fragment_id": f, "score": s, "via": ["lexical"], "anchor_uri": uri(f)} for _, f, s in r["results"]]
            elif k == "search_vector":
                got = [{"fragment_id": f, "score": s, "anchor_uri": uri(f)}
                       for _, f, s in R.vector_search(o.con, i["space"], i["query_vector"], i["limit"], i["target"])]
            else:
                top, _ = R.hybrid_search(o.con, i["query"], i["space"], i["query_vector"], i["limit"])
                got = [{"fragment_id": f, "score": s, "via": via, "anchor_uri": uri(f)} for _, f, s, via in top]
        finally:
            o.close()
        return _results_equal(got, e["results"])
    if k == "anchor_uri":
        if "anchor" in i:
            u = R.format_uri(i["docref"], i["anchor"], i["anchor_end"])
            if u != e["uri"]:
                return f"format gives {u}"
            p = R.parse_uri(u)
            if R.jcs(p) != R.jcs(R.canon({"docref": i["docref"], "locator": e["locator"]})):
                return f"parse gives {p}"
            return None if R.format_locator(p["docref"], p["locator"]) == u else "no round trip"
        if e.get("error"):
            try:
                R.parse_uri(i["uri"])
            except R.SpdfError:
                return None
            return "accepted an invalid URI"
        p = R.parse_uri(i["uri"])
        if R.jcs(p) != R.jcs(R.canon({"docref": e["docref"], "locator": e["locator"]})):
            return f"parse gives {p}"
        return None if R.format_locator(p["docref"], p["locator"]) == e["canonical"] else "canonical form differs"
    if k == "quantize":
        try:
            got = {"hex": R.quantize(i["values"], i["dtype"]).hex()}
        except R.SpdfError:
            got = {"error": True}
        return None if got == e else f"got {got}"
    if k == "cite":
        t = R.cite(i["anchor"], i["anchor_end"], i["metadata"], i["locale"])
        return None if t == e["text"] else f"got {t!r}"
    return f"unknown kind {k}"


def runner_report() -> dict:
    passed, failed = [], []
    for p in sorted((CONF / "cases").glob("*.json")):
        c = R.read_json(p)
        try:
            reason = run_case(c)
        except Exception as ex:  # a crash is a failure, never a pass
            reason = f"{type(ex).__name__}: {ex}"
        (failed.append({"id": c["id"], "reason": reason}) if reason else passed.append(c["id"]))
    manifest = R.read_json(CONF / "manifest.json")
    return {"impl": "conformance/tools (reference)", "version": manifest["suite_version"], "passed": passed, "failed": failed, "skipped": []}


def schema_problems() -> list[str]:
    """spec/json-schema/*.json must accept the corpus and the examples."""
    import esquemas
    folder = CONF.parent / "spec" / "json-schema"
    if not folder.exists():
        return []
    S = esquemas.Schemas(folder)
    out = []
    def chk(instance, name, where):
        out.extend(f"{where}: {e}" for e in S.errors(instance, S.get(name))[:3])
    for p in sorted((CONF / "expected").glob("*.dump.json")):
        chk(R.read_json(p), "dump.schema.json", f"expected/{p.name}")
    for p in sorted((CONF / "cases").glob("*.json")):
        c = R.read_json(p)
        if c["kind"] == "validate":
            chk(R.validate_file(CONF / c["input"]["file"]), "validation-result.schema.json", f"validate {c['id']}")
        elif c["kind"] == "anchor_uri" and "anchor" in c["input"]:
            chk(c["input"]["anchor"], "anchor.schema.json", c["id"])
            if c["input"]["anchor_end"] is not None:
                chk(c["input"]["anchor_end"], "anchor.schema.json", c["id"])
        elif c["kind"] == "cite":
            chk(c["input"]["metadata"], "metadata.schema.json", c["id"])
            chk(c["input"]["anchor"], "anchor.schema.json", c["id"])
    ex = CONF.parent / "spec" / "examples"
    for p in sorted(ex.glob("*.spdfa.json")):
        chk(R.read_json(p), "annotation.schema.json", f"spec/examples/{p.name}")
    for p in sorted(ex.glob("*.spdfl.json")):
        chk(R.read_json(p), "collection.schema.json", f"spec/examples/{p.name}")
    # negative checks: the schemas must reject what the specification forbids
    bad = [({"type": "chapter"}, "anchor.schema.json"), ({"type": "page", "printed": "3"}, "anchor.schema.json"),
           ({"type": "book"}, "metadata.schema.json"), ({"valid": True}, "validation-result.schema.json")]
    for inst, name in bad:
        if not S.errors(inst, S.get(name)):
            out.append(f"{name} accepts {inst}")
    return out


def generated_outputs(root: Path) -> dict[str, bytes]:
    out = {}
    for d in ("cases", "expected"):
        for p in sorted((root / d).glob("*.json")):
            out[f"{d}/{p.name}"] = p.read_bytes()
    out["manifest.json"] = (root / "manifest.json").read_bytes()
    return out


def spdf_files(root: Path) -> list[str]:
    return sorted(str(p.relative_to(root)) for d in ("files", "legacy", "invalid") for p in (root / d).glob("*.spdf"))


def file_fingerprint(path: Path):
    try:
        return R.jcs(R.dump_file(path))
    except (R.SpdfError, Exception):
        v = R.validate_file(path)
        return R.jcs({"errors": sorted({x["code"] for x in v["errors"]}), "warnings": sorted({x["code"] for x in v["warnings"]})})


def determinism() -> list[str]:
    errs = []
    with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
        runs = []
        for d in (a, b):
            r = subprocess.run([sys.executable, str(HERE / "generar.py"), "--out", d], capture_output=True, text=True)
            if r.returncode != 0:
                return [f"generar.py failed: {r.stderr.strip()}"]
            runs.append(Path(d))
        ga, gb, gc = generated_outputs(runs[0]), generated_outputs(runs[1]), generated_outputs(CONF)
        if ga != gb:
            errs += [f"not deterministic: {k}" for k in sorted(set(ga) | set(gb)) if ga.get(k) != gb.get(k)]
        if ga != gc:
            errs += [f"committed output is stale (run generar.py): {k}" for k in sorted(set(ga) | set(gc)) if ga.get(k) != gc.get(k)]
        fa, fc = spdf_files(runs[0]), spdf_files(CONF)
        if fa != fc:
            errs.append(f"committed .spdf set differs: {sorted(set(fa) ^ set(fc))}")
        for rel in fa:
            x, y = file_fingerprint(runs[0] / rel), file_fingerprint(runs[1] / rel)
            if x != y:
                errs.append(f"not deterministic: {rel}")
            if (CONF / rel).exists() and x != file_fingerprint(CONF / rel):
                errs.append(f"committed file differs in content: {rel}")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--runner", action="store_true", help="only run the cases and print the runner report")
    ap.add_argument("--report", type=Path, help="also write the runner report to this file")
    a = ap.parse_args()
    report = runner_report()
    if a.report:
        a.report.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if a.runner:
        print(json.dumps(report, ensure_ascii=False))
        return 1 if report["failed"] else 0
    errs = problems_in_cases()
    errs += [f"reference fails {f['id']}: {f['reason']}" for f in report["failed"]]
    errs += determinism()
    errs += schema_problems()
    for e in errs:
        print("ERROR", e)
    m = R.read_json(CONF / "manifest.json")
    print(f"{len(report['passed'])}/{m['cases']} casos pasan con la referencia; {len(errs)} problemas.")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
