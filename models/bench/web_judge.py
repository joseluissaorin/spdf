"""Valen or Gemma 4 judge in Chrome headless (onnxruntime-web / transformers.js) through spdf-infer-web.

python -I web_valen.py --variant q4 [--device webgpu|wasm] [--every 4] [--limit N]
Writes ~/.cache/spdf-models/bench-out/judges/valen-onnx-<variant>-<device>-sub.jsonl (scored by
judges/score.py) and the peak memory of the Chrome process tree.
Needs `npm run build` in models/web (the page imports models/web/dist).
"""
from __future__ import annotations

import argparse
import http.server
import json
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, MemSampler, mb  # noqa: E402
from tjs_run import CHROME, Handler  # noqa: E402

HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="q4")
    ap.add_argument("--judge", default="valen", choices=["valen", "gemma"])
    ap.add_argument("--repo", default="onnx-community/gemma-4-E2B-it-ONNX")
    ap.add_argument("--dtype", default="q4f16")
    ap.add_argument("--device", default="webgpu")
    ap.add_argument("--every", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--smoke", action="store_true", help="time the README request only")
    a = ap.parse_args()
    web = HERE.parent / "web"
    Handler.routes = {"/models/": CACHE, "/judges/": HERE / "judges", "/web/": web / "dist",
                      "/noble/": web / "node_modules" / "@noble" / "hashes",
                      "/tjs/": HERE / "tjs" / "node_modules" / "@huggingface" / "transformers" / "dist",
                      "/ort/": HERE / "tjs" / "node_modules" / "onnxruntime-web" / "dist",
                      "/mp/": HERE / "tjs" / "node_modules" / "@mediapipe" / "tasks-genai", "/": HERE / "tjs"}
    Handler.cfg = {"variant": a.variant, "device": a.device, "every": a.every, "limit": a.limit, "repo": a.repo, "dtype": a.dtype, "smoke": a.smoke}
    Handler.results = []
    Handler.done = threading.Event()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="spdf-chrome-")
    proc = subprocess.Popen([CHROME, "--headless=new", f"--user-data-dir={profile}", "--no-first-run", "--mute-audio",
                             "--enable-unsafe-webgpu", "--enable-features=WebGPU", "--remote-debugging-port=0",
                             f"http://127.0.0.1:{port}/{'valen' if a.judge == 'valen' else 'gemmajudge'}.html"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    s = MemSampler(proc.pid)
    try:
        with s:
            ok = Handler.done.wait(timeout=7200)
        if not ok:
            raise SystemExit("timeout")
        err = [r for r in Handler.results if "error" in r]
        if err:
            raise SystemExit(err[0]["error"])
        rows = [r for r in Handler.results if "id" in r or "priors" in r]
        meta = next((r["meta"] for r in Handler.results if "meta" in r), {})
        name = f"valen-onnx-{a.variant}-{a.device}" if a.judge == "valen" else f"gemma-4-e2b-{a.dtype}-{a.device}"
        out = CACHE / "bench-out" / "judges" / f"{name}-sub.jsonl"
        with out.open("w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        info = {"engine": name, "pairs": len([r for r in rows if "id" in r]), "peak_mb": mb(s.peak), **meta}
        (HERE / "results" / f"web-judge-{name}.json").write_text(json.dumps(info, indent=1) + "\n")
        print(json.dumps(info))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
        srv.shutdown()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
