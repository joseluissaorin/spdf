"""llama.cpp engine (llama-server, Metal) for EmbeddingGemma 2 GGUF + mmproj.

python -I llama_srv.py --quant Q8_0 --mmproj Q8_0 [--resize ref|llama] [--gpu 1|0]

--resize ref    pre-resize images exactly like the reference processor (aspect-preserving, 280 soft
                tokens, bicubic with antialias) before handing them to llama.cpp. This is what
                spdf-infer does.
--resize llama  let llama.cpp resize (its default path; budget forced to 280 tokens).
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from common import CACHE, MemSampler, Timings, load_audio, load_images, load_texts, mb, save  # noqa: E402

LLAMA = Path(os.environ.get("LLAMA_CPP_BIN", CACHE / "src" / "llama.cpp" / "build" / "bin"))
GGUF = CACHE / "ggml-org" / "embeddinggemma-2-GGUF"
PORT = 8199


def gemma4_target_size(w: int, h: int, patch=16, max_soft_tokens=280, pooling=3) -> tuple[int, int]:
    """Port of transformers' get_aspect_ratio_preserving_size. Returns (width, height)."""
    max_patches = max_soft_tokens * pooling * pooling
    target_px = max_patches * patch * patch
    factor = math.sqrt(target_px / (h * w))
    side = pooling * patch
    th = int(math.floor(factor * h / side)) * side
    tw = int(math.floor(factor * w / side)) * side
    max_side = (max_patches // pooling**2) * side
    if th == 0:
        th, tw = side, min(int(math.floor(w / h)) * side, max_side)
    elif tw == 0:
        tw, th = side, min(int(math.floor(h / w)) * side, max_side)
    return tw, th


def ref_resize(img: Image.Image) -> Image.Image:
    tw, th = gemma4_target_size(*img.size)
    if (tw, th) == img.size:
        return img
    return img.resize((tw, th), Image.BICUBIC)


def post(path: str, payload: dict):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.load(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quant", default="Q8_0", choices=["Q8_0", "BF16"])
    ap.add_argument("--mmproj", default="Q8_0", choices=["Q8_0", "BF16"])
    ap.add_argument("--resize", default="ref", choices=["ref", "llama"])
    ap.add_argument("--gpu", type=int, default=1)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    engine = f"llamacpp-{a.quant.lower()}-mm{a.mmproj.lower()}-{'metal' if a.gpu else 'cpu'}-resize{a.resize}"
    cmd = [str(LLAMA / "llama-server"), "-m", str(GGUF / f"embeddinggemma-2-{a.quant}.gguf"),
           "--mmproj", str(GGUF / f"mmproj-embeddinggemma-2-{a.mmproj}.gguf"), "--embeddings",
           "-c", "8192", "-b", "8192", "-ub", "8192", "-ngl", "99" if a.gpu else "0", "--port", str(PORT),
           "--host", "127.0.0.1", "-np", "1", "--image-max-tokens", "280", "--no-warmup"]
    if not a.gpu:
        cmd += ["--no-mmproj-offload", "-t", "8"]
    log = open(f"/tmp/{engine}.log", "w")
    t0 = time.perf_counter()
    proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(240):
            try:
                if json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health")).get("status") == "ok":
                    break
            except Exception:  # noqa: BLE001
                time.sleep(0.25)
        load_s = time.perf_counter() - t0
        marker = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/props"))["media_marker"]
        sampler = MemSampler(proc.pid)
        after_load = sampler.current()

        def emb(content):
            d = post("/embedding", {"content": content})
            v = np.asarray(d[0]["embedding"], dtype=np.float64).reshape(-1)
            return (v / np.linalg.norm(v)).astype(np.float32)

        def media(b: bytes):
            return {"prompt_string": marker, "multimodal_data": [base64.b64encode(b).decode()]}

        texts, images, audio = load_texts(), load_images(), load_audio()
        if a.limit:
            texts, images, audio = texts[: a.limit], images[: a.limit], audio[: a.limit]
        tim = Timings()
        tv, iv, av = {}, {}, {}
        with sampler:
            for it in texts[:3]:
                emb(it.input)
            for it in texts:
                t = time.perf_counter()
                tv[it.id] = emb(it.input)
                tim.add("text_" + it.length, time.perf_counter() - t)
            payloads = []
            for iid, path in images:
                img = Image.open(path).convert("RGB")
                if a.resize == "ref":
                    img = ref_resize(img)
                buf = io.BytesIO()
                img.save(buf, format="PNG")  # lossless: what llama.cpp receives is exactly this bitmap
                payloads.append((iid, buf.getvalue()))
            if payloads:
                emb(media(payloads[0][1]))
            for iid, b in payloads:
                t = time.perf_counter()
                iv[iid] = emb(media(b))
                tim.add("image", time.perf_counter() - t)
            if audio:
                emb(media(audio[0][1].read_bytes()))
            for aid, path in audio:
                b = path.read_bytes()
                t = time.perf_counter()
                av[aid] = emb(media(b))
                tim.add("audio_10s", time.perf_counter() - t)
        commit = subprocess.run(["git", "-C", str(LLAMA.parent.parent), "rev-parse", "--short", "HEAD"],
                                capture_output=True, text=True).stdout.strip()
        save(engine, text=tv, image=iv, audio=av, timings=tim,
             memory={"after_load_mb": mb(after_load), "peak_mb": mb(sampler.peak)},
             meta={"load_s": round(load_s, 2), "llama.cpp": commit, "gguf": f"embeddinggemma-2-{a.quant}.gguf",
                   "mmproj": f"mmproj-embeddinggemma-2-{a.mmproj}.gguf", "resize": a.resize,
                   "backend": "Metal" if a.gpu else "CPU", "transport": "llama-server HTTP, batch 1",
                   "note": "image timings include PNG decode inside llama.cpp; audio = 10 s WAV 16 kHz"})
    finally:
        proc.terminate()
        proc.wait(timeout=30)


if __name__ == "__main__":
    main()
