"""Gemma 4 E2B/E4B generation speed and memory: llama.cpp (Metal), MLX, LiteRT web (MediaPipe).

python -I gen_bench.py llama --model e2b|e4b      # spdf-infer (llama.cpp linked in), Metal
python -I gen_bench.py llamabench --model e2b|e4b # upstream llama-bench, for reference
python -I gen_bench.py mlx --model e2b|e4b        # mlx-lm, lmstudio-community 4-bit
python -I gen_bench.py web --model e2b|e4b        # MediaPipe GenAI .task in Chrome headless, WebGPU

Same workload everywhere: a ~512-token public-domain prompt (Cervantes), 256 new tokens, greedy
when the engine allows it. Results in results/gen-<engine>-<model>.json.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, RESULTS, MemSampler, machine, mb  # noqa: E402

HERE = Path(__file__).resolve().parent
GGUF = {"e2b": CACHE / "unsloth" / "gemma-4-E2B-it-GGUF" / "gemma-4-E2B-it-Q4_K_M.gguf",
        "e4b": CACHE / "unsloth" / "gemma-4-E4B-it-GGUF" / "gemma-4-E4B-it-Q4_K_M.gguf"}
MLX = {"e2b": CACHE / "lmstudio-community" / "gemma-4-E2B-it-MLX-4bit", "e4b": CACHE / "lmstudio-community" / "gemma-4-E4B-it-MLX-4bit"}
TASK = {"e2b": ("litert-community/gemma-4-E2B-it-litert-lm", "gemma-4-E2B-it-web.task"),
        "e4b": ("litert-community/gemma-4-E4B-it-litert-lm", "gemma-4-E4B-it-web.task")}
BASE = ("En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de "
        "lanza en astillero, adarga antigua, rocín flaco y galgo corredor. ")
N_PROMPT, N_GEN = 512, 256


def save(name, data):
    RESULTS.mkdir(exist_ok=True)
    data = {"engine": name, "machine": machine(), "date": time.strftime("%Y-%m-%d"), "prompt_tokens_target": N_PROMPT,
            "gen_tokens_target": N_GEN, **data}
    (RESULTS / f"gen-{name}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(data, ensure_ascii=False))


def run_llama(model):
    binp = HERE.parent / "rust" / "target" / "release" / "spdf-infer"
    p = subprocess.Popen([str(binp), "bench-gen", "--model", str(GGUF[model]), "--prompt-tokens", str(N_PROMPT),
                          "--gen-tokens", str(N_GEN)], stdout=subprocess.PIPE, text=True)
    s = MemSampler(p.pid)
    runs, load = [], None
    with s:
        for line in p.stdout:
            r = json.loads(line)
            if "load_ms" in r:
                load = r["load_ms"] / 1000
            else:
                runs.append(r)
        p.wait()
    save(f"spdf-infer-metal-{model}-q4_k_m", {
        "load_s": round(load, 2), "runs": runs, "pp_tok_s": round(statistics.median(r["pp_tok_s"] for r in runs), 1),
        "tg_tok_s": round(statistics.median(r["tg_tok_s"] for r in runs), 1), "peak_mb": mb(s.peak),
        "gguf": GGUF[model].name, "note": "in-process llama.cpp (spdf-infer), Metal, n_ctx 4096, greedy"})


def run_llamabench(model):
    exe = CACHE / "src" / "llama.cpp" / "build" / "bin" / "llama-bench"
    out = subprocess.run([str(exe), "-m", str(GGUF[model]), "-p", str(N_PROMPT), "-n", str(N_GEN), "-ngl", "99", "-r", "3", "-o", "json"],
                         capture_output=True, text=True, check=True).stdout
    rows = json.loads(out)
    pp = next(r for r in rows if r["n_prompt"] > 0 and r["n_gen"] == 0)
    tg = next(r for r in rows if r["n_gen"] > 0 and r["n_prompt"] == 0)
    save(f"llama-bench-metal-{model}-q4_k_m", {"pp_tok_s": round(pp["avg_ts"], 1), "tg_tok_s": round(tg["avg_ts"], 1),
                                                "build": pp.get("build_commit"), "gguf": GGUF[model].name})


def run_mlx(model):
    import mlx.core as mx
    from mlx_lm import load, stream_generate
    from mlx_lm.sample_utils import make_sampler

    sampler = MemSampler()
    base = sampler.current()
    t0 = time.perf_counter()
    m, tok = load(str(MLX[model]))
    load_s = time.perf_counter() - t0
    text = ""
    while len(tok.encode(text)) < N_PROMPT - 40:
        text += BASE
    runs = []
    with sampler:
        for run in range(3):
            msgs = [{"role": "user", "content": f"{text}\n\nWrite a long, detailed essay in English about the passage above. (run {run})"}]
            prompt = tok.apply_chat_template(msgs, add_generation_prompt=True, tokenize=False)
            last = None
            for resp in stream_generate(m, tok, prompt, max_tokens=N_GEN, sampler=make_sampler(temp=0.0)):
                last = resp
            runs.append({"prompt_tokens": last.prompt_tokens, "generated_tokens": last.generation_tokens,
                         "pp_tok_s": last.prompt_tps, "tg_tok_s": last.generation_tps, "peak_gb": last.peak_memory})
    import mlx_lm

    save(f"mlx-{model}-4bit", {"load_s": round(load_s, 2), "runs": runs, "pp_tok_s": round(statistics.median(r["pp_tok_s"] for r in runs), 1),
                               "tg_tok_s": round(statistics.median(r["tg_tok_s"] for r in runs), 1), "peak_mb": mb(sampler.peak),
                               "mlx_peak_mb": round(max(r["peak_gb"] for r in runs) * 1024, 1), "baseline_mb": mb(base),
                               "mlx_lm": mlx_lm.__version__, "weights": str(MLX[model].relative_to(CACHE))})


def run_web(model):
    import http.server
    import shutil

    from tjs_run import CHROME, Handler

    repo, fname = TASK[model]
    task_path = CACHE / repo / fname
    if not task_path.exists():
        subprocess.run(["hf", "download", repo, fname, "--local-dir", str(CACHE / repo)], check=True)
    Handler.routes = {"/models/": CACHE, "/mp/": HERE / "tjs" / "node_modules" / "@mediapipe" / "tasks-genai", "/": HERE / "tjs"}
    text = BASE * 20
    Handler.cfg = {"task": f"/models/{repo}/{fname}", "prompt": text, "n_prompt": N_PROMPT, "n_gen": N_GEN}
    Handler.results = []
    Handler.done = threading.Event()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="spdf-chrome-")
    proc = subprocess.Popen([CHROME, "--headless=new", f"--user-data-dir={profile}", "--no-first-run", "--mute-audio",
                             "--enable-unsafe-webgpu", "--enable-features=WebGPU", "--remote-debugging-port=0",
                             f"http://127.0.0.1:{port}/gen.html"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    s = MemSampler(proc.pid)
    try:
        with s:
            ok = Handler.done.wait(timeout=1800)
        if not ok:
            raise SystemExit("timeout")
        res = [r for r in Handler.results if "runs" in r or "error" in r]
        if res and "error" in res[0]:
            raise SystemExit(res[0]["error"])
        r = res[0]
        save(f"mediapipe-webgpu-{model}", {**r, "pp_tok_s": round(statistics.median(x["pp_tok_s"] for x in r["runs"]), 1),
                                            "tg_tok_s": round(statistics.median(x["tg_tok_s"] for x in r["runs"]), 1), "peak_mb": mb(s.peak),
                                            "task": fname, "chrome": subprocess.run([CHROME, "--version"], capture_output=True, text=True).stdout.strip()})
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
    ap.add_argument("engine", choices=["llama", "llamabench", "mlx", "web"])
    ap.add_argument("--model", default="e2b", choices=["e2b", "e4b"])
    a = ap.parse_args()
    {"llama": run_llama, "llamabench": run_llamabench, "mlx": run_mlx, "web": run_web}[a.engine](a.model)


if __name__ == "__main__":
    main()
