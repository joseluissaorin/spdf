"""End-to-end test of spdf-infer-web in Chrome headless (WebGPU, --mute-audio), as an app uses it:
ModelManager downloads every file into OPFS (from a local mirror with Hugging Face's URL layout,
verifying SHA-256), then Embedder (text, image, audio, MRL), Generator (MediaPipe .task) and Judge.

python -I web_e2e.py [--embed embeddinggemma-2-onnx-q8] [--gen gemma-4-e2b-it-web] [--judge valen-0.8b-onnx-static1024-q4]
Needs `npm run build` in models/web. Results in results/web-e2e.json.
"""
from __future__ import annotations

import argparse
import http.server
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, MemSampler, mb  # noqa: E402
from tjs_run import CHROME, Handler  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO_DIRS = {"spdf-format/valen-0.8b-onnx": CACHE / "valen-onnx"}


class Mirror(Handler):
    """/hf/<org>/<repo>/resolve/<rev>/<path> -> the local cache (what a Hugging Face mirror serves)."""

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/hf/") and "/resolve/" in path:
            repo, rest = path[4:].split("/resolve/", 1)
            rel = rest.split("/", 1)[1]
            root = REPO_DIRS.get(repo, CACHE / repo)
            p = (root / rel).resolve()
            if root.resolve() in p.parents:
                return self._send_file(p)
            return self.send_error(404)
        return super().do_GET()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--embed", default="embeddinggemma-2-onnx-q8")
    ap.add_argument("--gen", default="gemma-4-e2b-it-web")
    ap.add_argument("--judge", default="valen-0.8b-onnx-static1024-q4")
    a = ap.parse_args()
    web = HERE.parent / "web"
    Mirror.routes = {"/media/": CACHE / "bench-corpus", "/web/": web / "dist", "/noble/": web / "node_modules" / "@noble" / "hashes",
                     "/tjs/": HERE / "tjs" / "node_modules" / "@huggingface" / "transformers" / "dist",
                     "/ort/": HERE / "tjs" / "node_modules" / "onnxruntime-web" / "dist",
                     "/mp/": HERE / "tjs" / "node_modules" / "@mediapipe" / "tasks-genai", "/": HERE / "tjs"}
    Mirror.cfg = {"embed": a.embed, "gen": a.gen, "judge": a.judge, "image": "aic-61603.jpg",
                  "audio": "don_quijote_vol1_0706_librivox-0.wav"}
    Mirror.results = []
    Mirror.done = threading.Event()
    Handler.results, Handler.done = Mirror.results, Mirror.done
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Mirror)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="spdf-chrome-")  # fresh profile: empty OPFS, real downloads
    proc = subprocess.Popen([CHROME, "--headless=new", f"--user-data-dir={profile}", "--no-first-run", "--mute-audio",
                             "--enable-unsafe-webgpu", "--enable-features=WebGPU", "--remote-debugging-port=0",
                             f"http://127.0.0.1:{port}/e2e.html"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    s = MemSampler(proc.pid)
    t0 = time.time()
    try:
        with s:
            ok = Mirror.done.wait(timeout=3600)
        res = {"ok": ok and not any("error" in r for r in Mirror.results), "seconds": round(time.time() - t0, 1),
               "peak_mb": mb(s.peak), "chrome": subprocess.run([CHROME, "--version"], capture_output=True, text=True).stdout.strip(),
               "steps": [{k: v for k, v in r.items() if k != "v"} | ({"vec_dims": len(r["v"])} if "v" in r else {}) for r in Mirror.results]}
        (HERE / "results" / "web-e2e.json").write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n")
        print(json.dumps(res, ensure_ascii=False)[:3000])
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
