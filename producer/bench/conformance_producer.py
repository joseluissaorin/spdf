"""Conformance report of the producer: build every fixture kind with the simulated engines and validate
each output with the reference validators (spdf-format and the conformance oracle conformance/tools/spdfref.py).

    python bench/conformance_producer.py [-o conformance.json]

Prints {"impl","version","passed":[…],"failed":[{"id","reason"}],"skipped":[…],"files":{id: {...}}}.
Exit status 1 if anything failed (CI uploads the JSON as the artifact `conformance-producer`).
"""
from __future__ import annotations

import argparse
import importlib
import json
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tests"))

import spdf  # noqa: E402

from fixtures import all_inputs  # noqa: E402
from spdf_build import __version__  # noqa: E402
from spdf_build.engines.fake import FakeEmbedder, FakeLLM, FakeTranscriber, FakeVision  # noqa: E402
from spdf_build.net import OfflineGuard  # noqa: E402
from spdf_build.pipeline import Engines, Options, build  # noqa: E402


def oracle():
    for parent in HERE.parents:
        t = parent / "conformance" / "tools"
        if (t / "spdfref.py").exists():
            sys.path.insert(0, str(t))
            return importlib.import_module("spdfref")
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--output", default="conformance.json")
    ap.add_argument("--keep", help="keep the generated .spdf files in this folder")
    a = ap.parse_args()
    ref = oracle()
    work = Path(a.keep) if a.keep else Path(tempfile.mkdtemp(prefix="spdf-producer-conf-"))
    work.mkdir(parents=True, exist_ok=True)
    inputs = all_inputs(work / "inputs")
    truth = {int(k): v for k, v in json.loads(inputs["scanned_pdf"].with_suffix(".truth.json").read_text("utf-8")).items()}
    report = {"impl": "spdf-build", "version": __version__, "validators": ["spdf-format/" + spdf.__version__] +
              (["conformance/tools/spdfref.py"] if ref else []), "passed": [], "failed": [], "skipped": [], "files": {}}
    for kind in ["pdf", "pdf-labels", "scanned_pdf", "epub", "epub-sections", "docx", "odt", "pptx", "xlsx", "csv", "markdown",
                 "text", "html", "image", "audio", "video"]:
        cid = f"build-{kind}"
        if kind not in inputs:
            report["skipped"].append(cid)
            continue
        eng = Engines(embedder=FakeEmbedder(32), vision=FakeVision(truth if kind == "scanned_pdf" else None), llm=FakeLLM(),
                      asr=FakeTranscriber(speakers=["Ana", "Luis"]))
        out = work / f"{kind}.spdf"
        t = time.time()
        try:
            with OfflineGuard():
                rep = build([str(inputs[kind])], str(out), eng, Options(offline=True))
                attempts = len(OfflineGuard.attempts)
            v1 = spdf.validate(str(out)).to_dict()
            v2 = ref.validate_file(out) if ref else None
            codes = [e["code"] for e in v1["errors"] + v1["warnings"]] + ([e["code"] for e in v2["errors"] + v2["warnings"]] if v2 else [])
            ok = v1["valid"] and not v1["warnings"] and (v2 is None or (v2["valid"] and not v2["warnings"])) and attempts == 0
            report["files"][cid] = {"input": inputs[kind].name, "kind": rep.kind, "units": rep.units, "fragments": rep.fragments,
                                   "figures": rep.figures, "vectors": rep.vectors, "seconds": round(time.time() - t, 3),
                                   "spdf_format": v1, "oracle": v2, "network_attempts": attempts}
            if ok:
                report["passed"].append(cid)
            else:
                report["failed"].append({"id": cid, "reason": f"codes {codes}, network {attempts}"})
        except Exception as e:  # a crash is a failure, not a stop
            report["failed"].append({"id": cid, "reason": f"{type(e).__name__}: {e}"[:400]})
    Path(a.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps({k: report[k] for k in ("impl", "version", "passed", "failed", "skipped")}, ensure_ascii=False))
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
