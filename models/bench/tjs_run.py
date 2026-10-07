"""transformers.js engines: Node (onnxruntime-node) and Chromium headless with WebGPU.

python -I tjs_run.py node --dtype q4 [--device cpu]
python -I tjs_run.py browser --dtype q4 [--device webgpu|wasm]

The browser run serves the bench page, the transformers.js bundle, onnxruntime-web and the model
files (from the local cache) on 127.0.0.1, launches Chrome with a throw-away profile,
--headless=new --enable-unsafe-webgpu --mute-audio, and collects the results posted by the page.
Memory = summed physical footprint of the whole Chrome process tree (GPU process included).
"""
from __future__ import annotations

import argparse
import http.server
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402

from common import CACHE, CORPUS, MemSampler, Timings, mb, save  # noqa: E402

HERE = Path(__file__).resolve().parent
TJS = HERE / "tjs"
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def collect(lines, engine, meta, sampler, after_load_mb=None):
    tim = Timings()
    tim_model = Timings()
    out = {"text": {}, "image": {}, "audio": {}}
    load_ms = None
    for r in lines:
        if r.get("done"):
            load_ms = r.get("loadMs")
            meta.update(r.get("versions", {}))
            continue
        if r.get("error"):
            raise RuntimeError(r["error"])
        v = np.asarray(r["vec"], dtype=np.float32)
        out[r["mod"]][r["id"]] = v / np.linalg.norm(v)
        tim.add(r["cls"], r["ms"] / 1000)
        tim_model.add(r["cls"], r["ms_model"] / 1000)
    meta["load_s"] = round((load_ms or 0) / 1000, 2)
    meta["latency_model_only"] = tim_model.summary()
    meta["note"] = "latency includes transformers.js preprocessing (latency_model_only excludes it)"
    save(engine, text=out["text"], image=out["image"], audio=out["audio"], timings=tim,
         memory={"after_load_mb": after_load_mb, "peak_mb": mb(sampler.peak)}, meta=meta)


def run_node(a):
    engine = f"tjs-node-{a.dtype}-{a.device}"
    cmd = ["node", str(TJS / "node_bench.mjs"), "--dtype", a.dtype, "--device", a.device, "--limit", str(a.limit)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=TJS)
    sampler = MemSampler(proc.pid)
    lines = []
    with sampler:
        for line in proc.stdout:
            lines.append(json.loads(line))
        proc.wait()
    if proc.returncode != 0:
        raise SystemExit(proc.stderr.read())
    collect(lines, engine, {"runtime": "node", "device": a.device, "dtype": a.dtype}, sampler)


class Handler(http.server.BaseHTTPRequestHandler):
    routes: dict[str, Path] = {}
    results: list = []
    done = threading.Event()
    cfg: dict = {}

    def log_message(self, *args):
        pass

    def _send_file(self, p: Path):
        if not p.is_file():
            self.send_error(404)
            return
        size = p.stat().st_size
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if p.suffix in (".mjs", ".js"):
            ctype = "text/javascript"
        if p.suffix == ".wasm":
            ctype = "application/wasm"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.end_headers()
        with p.open("rb") as f:
            shutil.copyfileobj(f, self.wfile, 1 << 20)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/config.json":
            body = json.dumps(self.cfg).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        for prefix, root in self.routes.items():
            if path.startswith(prefix):
                rel = path[len(prefix):].lstrip("/")
                p = (root / rel).resolve()
                if root.resolve() in p.parents or p == root.resolve():
                    return self._send_file(p)
        self.send_error(404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n))
        if self.path == "/result":
            Handler.results.extend(body if isinstance(body, list) else [body])
            if any(r.get("done") or r.get("error") for r in (body if isinstance(body, list) else [body])):
                Handler.done.set()
        elif self.path == "/log":
            print("[page]", body.get("msg"), flush=True)
        self.send_response(204)
        self.end_headers()


def run_browser(a):
    engine = f"tjs-chrome-{a.dtype}-{a.device}"
    Handler.routes = {"/models/": CACHE, "/media/": CACHE / "bench-corpus", "/corpus/": CORPUS,
                      "/tjs/": TJS / "node_modules" / "@huggingface" / "transformers" / "dist",
                      "/ort/": TJS / "node_modules" / "onnxruntime-web" / "dist", "/": TJS}
    Handler.cfg = {"dtype": a.dtype, "device": a.device, "limit": a.limit}
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="spdf-chrome-")
    cmd = [CHROME, "--headless=new", f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
           "--mute-audio", "--enable-unsafe-webgpu", "--enable-features=WebGPU", "--disable-extensions",
           "--remote-debugging-port=0", f"http://127.0.0.1:{port}/page.html"]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    sampler = MemSampler(proc.pid)
    try:
        with sampler:
            ok = Handler.done.wait(timeout=a.timeout)
        if not ok:
            raise SystemExit("timeout waiting for the page")
        gpu = next((r.get("adapter") for r in Handler.results if r.get("adapter")), None)
        collect([r for r in Handler.results if not r.get("adapter")], engine,
                {"runtime": "chrome-headless", "chrome": subprocess.run([CHROME, "--version"], capture_output=True, text=True).stdout.strip(),
                 "device": a.device, "dtype": a.dtype, "adapter": gpu}, sampler)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
        srv.shutdown()
        shutil.rmtree(profile, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runtime", choices=["node", "browser"])
    ap.add_argument("--dtype", default="q4")
    ap.add_argument("--device", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--timeout", type=int, default=3600)
    a = ap.parse_args()
    if a.runtime == "node":
        a.device = a.device or "cpu"
        run_node(a)
    else:
        a.device = a.device or "webgpu"
        run_browser(a)


if __name__ == "__main__":
    main()
