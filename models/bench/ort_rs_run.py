"""onnxruntime via the Rust `ort` crate (2.0.0-rc.13, CPU EP), same inputs as ort_py.py.

python -I ort_rs_run.py --dtype q4
Inputs are dumped once by `ort_py.py --dump-only --dump-inputs <cache>/bench-out/ort-inputs`.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402

from common import CACHE, MemSampler, Timings, load_texts, mb, save  # noqa: E402

HERE = Path(__file__).resolve().parent
BIN = HERE / "ort-rs" / "target" / "release" / "spdf-bench-ort"
INPUTS = CACHE / "bench-out" / "ort-inputs"
SUFFIX = {"fp32": "", "q8": "_quantized", "q4": "_q4"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dtype", default="q4", choices=list(SUFFIX))
    a = ap.parse_args()
    if not INPUTS.exists():
        subprocess.run([sys.executable, "-I", str(HERE / "ort_py.py"), "--dtype", "fp32", "--dump-only",
                        "--dump-inputs", str(INPUTS)], check=True)
    cls = {t.id: "text_" + t.length for t in load_texts()}
    engine = f"ort-rs-{a.dtype}-cpu"
    proc = subprocess.Popen([str(BIN), str(CACHE / "onnx-community" / "embeddinggemma-2-ONNX" / "onnx"), SUFFIX[a.dtype],
                             str(INPUTS)], stdout=subprocess.PIPE, text=True)
    sampler = MemSampler(proc.pid)
    tim = Timings()
    out = {"text": {}, "image": {}, "audio": {}}
    load_ms = None
    after_load = None
    with sampler:
        for line in proc.stdout:
            r = json.loads(line)
            if "load_ms" in r:
                load_ms = r["load_ms"]
                after_load = sampler.current()
                continue
            v = np.asarray(r["vec"], dtype=np.float32)
            out[r["mod"]][r["id"]] = v / np.linalg.norm(v)
            c = cls.get(r["id"], "image" if r["mod"] == "image" else "audio_10s")
            tim.add(c, r["ms"] / 1000)
        proc.wait()
    save(engine, text=out["text"], image=out["image"], audio=out["audio"], timings=tim,
         memory={"after_load_mb": mb(after_load or 0), "peak_mb": mb(sampler.peak)},
         meta={"load_s": round((load_ms or 0) / 1000, 2), "ort_crate": "2.0.0-rc.13 (download-binaries)", "ep": "cpu",
               "dtype": a.dtype, "note": "latency excludes preprocessing (reference processor, dumped once)"})


if __name__ == "__main__":
    main()
