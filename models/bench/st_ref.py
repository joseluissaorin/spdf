"""Reference engine: sentence-transformers (PyTorch) on EmbeddingGemma 2.

python -I st_ref.py --device cpu --dtype f32      # the reference ("verdad")
python -I st_ref.py --device mps --dtype bf16
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402

from common import CACHE, MemSampler, Timings, load_audio, load_images, load_texts, mb, read_wav16k, save  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--dtype", default="f32", choices=["f32", "bf16"])
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    from sentence_transformers import SentenceTransformer

    dtype = torch.float32 if a.dtype == "f32" else torch.bfloat16
    engine = f"st-{a.dtype}-{a.device}"
    sampler = MemSampler()
    base = sampler.current()
    with sampler:
        t0 = time.perf_counter()
        model = SentenceTransformer(str(CACHE / "google" / "embeddinggemma-2"), device=a.device,
                                    model_kwargs={"dtype": dtype})
        load_s = time.perf_counter() - t0
        after_load = sampler.current()
        texts = load_texts()
        images = load_images()
        audio = load_audio()
        if a.limit:
            texts, images, audio = texts[: a.limit], images[: a.limit], audio[: a.limit]
        tim = Timings()
        sync = (lambda: torch.mps.synchronize()) if a.device == "mps" else (lambda: None)
        for it in texts[:3]:
            model.encode([it.input])
        tv = {}
        for it in texts:
            t = time.perf_counter()
            v = model.encode([it.input], convert_to_numpy=True)[0]
            sync()
            tim.add("text_" + it.length, time.perf_counter() - t)
            tv[it.id] = v
        iv = {}
        if images:
            model.encode([Image.open(images[0][1]).convert("RGB")])
        for iid, path in images:
            img = Image.open(path).convert("RGB")
            t = time.perf_counter()
            iv[iid] = model.encode([img], convert_to_numpy=True)[0]
            sync()
            tim.add("image", time.perf_counter() - t)
        av = {}
        if audio:
            model.encode([{"audio": {"array": read_wav16k(audio[0][1]), "sampling_rate": 16000}}])
        for aid, path in audio:
            arr = read_wav16k(path)
            t = time.perf_counter()
            av[aid] = model.encode([{"audio": {"array": arr, "sampling_rate": 16000}}], convert_to_numpy=True)[0]
            sync()
            tim.add("audio_10s", time.perf_counter() - t)
    import sentence_transformers
    import transformers

    save(engine, text=tv, image=iv, audio=av, timings=tim,
         memory={"baseline_mb": mb(base), "after_load_mb": mb(after_load), "peak_mb": mb(sampler.peak),
                 "model_mb": mb(after_load - base)},
         meta={"load_s": round(load_s, 2), "torch": torch.__version__, "transformers": transformers.__version__,
               "sentence_transformers": sentence_transformers.__version__, "device": a.device, "dtype": a.dtype,
               "batch": 1, "weights": "google/embeddinggemma-2 (safetensors bf16, rev 914f7f89)"})


if __name__ == "__main__":
    main()
