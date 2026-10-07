"""MLX engine (mlx-vlm, Metal) for mlx-community/embeddinggemma-2-{bf16,8bit,4bit,...}.

python -I mlx_bench.py --variant 8bit

Needs mlx-vlm at revision 3d87e884 (branch pc/embeddinggemma-2), as the model card says.
Preprocessing: the reference processor (transformers), as MLX-VLM does.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mlx.core as mx  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from common import CACHE, MemSampler, Timings, load_audio, load_images, load_texts, mb, read_wav16k, save  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="8bit")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    from mlx_vlm.embedding_loader import load_embedding_model
    from transformers import AutoProcessor

    path = CACHE / "mlx-community" / f"embeddinggemma-2-{a.variant}"
    engine = f"mlx-{a.variant}"
    sampler = MemSampler()
    base = sampler.current()
    t0 = time.perf_counter()
    model = load_embedding_model(path)
    mx.eval(model.parameters())
    proc = AutoProcessor.from_pretrained(str(CACHE / "google" / "embeddinggemma-2"))
    load_s = time.perf_counter() - t0
    after_load = sampler.current()

    def run(inputs: dict) -> np.ndarray:
        out = model(**{k: mx.array(v) for k, v in inputs.items()}).text_embeds
        mx.eval(out)
        v = np.array(out[0].astype(mx.float32))
        return v / np.linalg.norm(v)

    texts, images, audio = load_texts(), load_images(), load_audio()
    if a.limit:
        texts, images, audio = texts[: a.limit], images[: a.limit], audio[: a.limit]
    preps = {"text": [(it.id, "text_" + it.length, dict(proc.tokenizer([it.input], return_tensors="np"))) for it in texts],
             "image": [(iid, "image", dict(proc(images=[Image.open(p).convert("RGB")], return_tensors="np")))
                       for iid, p in images],
             "audio": [(aid, "audio_10s", dict(proc(audio=[read_wav16k(p)], return_tensors="np"))) for aid, p in audio]}
    tim = Timings()
    out = {"text": {}, "image": {}, "audio": {}}
    with sampler:
        for mod, lst in preps.items():
            if lst:
                run(lst[0][2])
            for iid, cls, p in lst:
                t = time.perf_counter()
                out[mod][iid] = run(p)
                tim.add(cls, time.perf_counter() - t)
    import mlx_vlm

    save(engine, text=out["text"], image=out["image"], audio=out["audio"], timings=tim,
         memory={"baseline_mb": mb(base), "after_load_mb": mb(after_load), "peak_mb": mb(sampler.peak),
                 "model_mb": mb(after_load - base)},
         meta={"load_s": round(load_s, 2), "mlx": mx.__version__, "mlx_vlm": getattr(mlx_vlm, "__version__", "?") + " @3d87e884",
               "weights": f"mlx-community/embeddinggemma-2-{a.variant}",
               "note": "latency excludes preprocessing (reference processor)"})


if __name__ == "__main__":
    main()
