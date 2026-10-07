"""spdf-infer (this repository's Rust crate, llama.cpp linked in) as a bench engine.

python -I spdf_infer_run.py --quant Q8_0 --mmproj Q8_0 [--cpu]
Build first: cargo build --release -p spdf-infer (in models/rust).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402

from common import CACHE, CORPUS, MEDIA, MemSampler, Timings, mb, save  # noqa: E402

BIN = Path(__file__).resolve().parents[1] / "rust" / "target" / "release" / "spdf-infer"
GGUF = CACHE / "ggml-org" / "embeddinggemma-2-GGUF"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quant", default="Q8_0", choices=["Q8_0", "BF16"])
    ap.add_argument("--mmproj", default="Q8_0", choices=["Q8_0", "BF16", "none"])
    ap.add_argument("--cpu", action="store_true")
    a = ap.parse_args()
    engine = f"spdf-infer-{a.quant.lower()}-mm{a.mmproj.lower()}-{'cpu' if a.cpu else 'metal'}"
    cmd = [str(BIN), "bench-embed", "--model", str(GGUF / f"embeddinggemma-2-{a.quant}.gguf"), "--corpus", str(CORPUS),
           "--media", str(MEDIA)]
    if a.mmproj != "none":
        cmd += ["--mmproj", str(GGUF / f"mmproj-embeddinggemma-2-{a.mmproj}.gguf")]
    if a.cpu:
        cmd += ["--cpu"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True)
    sampler = MemSampler(proc.pid)
    tim = Timings()
    out = {"text": {}, "image": {}, "audio": {}}
    meta = {}
    after_load = 0
    with sampler:
        for line in proc.stdout:
            r = json.loads(line)
            if "load_ms" in r:
                meta = {"load_s": round(r["load_ms"] / 1000, 2), "llama.cpp": r.get("llama_cpp", "")[:9]}
                after_load = sampler.current()
                continue
            if r.get("done"):
                continue
            out[r["mod"]][r["id"]] = np.asarray(r["vec"], dtype=np.float32)
            tim.add(r["cls"], r["ms"] / 1000)
        proc.wait()
    if proc.returncode:
        raise SystemExit(f"spdf-infer exited with {proc.returncode}")
    meta.update({"backend": "CPU" if a.cpu else "Metal", "gguf": f"embeddinggemma-2-{a.quant}.gguf",
                 "mmproj": a.mmproj, "note": "in-process (no HTTP); image latency includes decode + reference resize"})
    save(engine, text=out["text"], image=out["image"], audio=out["audio"], timings=tim,
         memory={"after_load_mb": mb(after_load), "peak_mb": mb(sampler.peak)}, meta=meta)


if __name__ == "__main__":
    main()
