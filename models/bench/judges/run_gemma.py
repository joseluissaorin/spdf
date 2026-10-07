"""Gemma 4 judge (spdf-infer, llama.cpp + Metal) on the judge pairs.

python -I judges/run_gemma.py --model e2b|e4b [--limit N]
Writes ~/.cache/spdf-models/bench-out/judges/gemma-4-<model>-q4_k_m.jsonl (same schema as Valen's).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("SPDF_MODELS_CACHE", Path.home() / ".cache" / "spdf-models"))
BIN = HERE.parents[1] / "rust" / "target" / "release" / "spdf-infer"
MODELS = {"e2b": CACHE / "unsloth" / "gemma-4-E2B-it-GGUF" / "gemma-4-E2B-it-Q4_K_M.gguf",
          "e4b": CACHE / "unsloth" / "gemma-4-E4B-it-GGUF" / "gemma-4-E4B-it-Q4_K_M.gguf"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="e2b", choices=list(MODELS))
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    pairs = [json.loads(l) for l in (HERE / "pairs.jsonl").read_text().splitlines() if l.strip()]
    if a.limit:
        pairs = pairs[: a.limit]
    out = CACHE / "bench-out" / "judges" / f"gemma-4-{a.model}-q4_k_m.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as tmp:
        for p in pairs:
            tmp.write(json.dumps(p, ensure_ascii=False) + "\n")
    proc = subprocess.Popen([str(BIN), "judge-eval", "--model", str(MODELS[a.model]), "--input", tmp.name],
                            stdout=subprocess.PIPE, text=True)
    with out.open("w") as f:
        for i, line in enumerate(proc.stdout):
            r = json.loads(line)
            if "priors" in r:
                f.write(json.dumps({"priors": r["priors"]}) + "\n")
                continue
            f.write(json.dumps({"id": r["id"], "ms": r["ms"], **r["result"]}) + "\n")
            if i % 50 == 0:
                print(f"gemma-4-{a.model}: {i}/{len(pairs)} ({r['ms']:.0f} ms)", flush=True)
    proc.wait()
    os.unlink(tmp.name)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
