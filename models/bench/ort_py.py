"""onnxruntime (Python) engine for onnx-community/embeddinggemma-2-ONNX.

python -I ort_py.py --dtype q4 [--ep cpu|coreml] [--dump-inputs DIR]

dtype: fp32 | fp16 | q8 (files *_quantized) | q4 | q4f16. Preprocessing uses the reference
processor (transformers), so differences come from the graph and its quantization only.
--dump-inputs writes the preprocessed tensors (npz) so the Rust `ort` bench uses identical inputs.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
from PIL import Image  # noqa: E402

from common import CACHE, MemSampler, Timings, load_audio, load_images, load_texts, mb, read_wav16k, save  # noqa: E402

ONNX = CACHE / "onnx-community" / "embeddinggemma-2-ONNX"
SUFFIX = {"fp32": "", "fp16": "_fp16", "q8": "_quantized", "q4": "_q4", "q4f16": "_q4f16"}


class OrtEmbedder:
    def __init__(self, dtype: str, ep: str = "cpu", modalities=("text", "image", "audio")):
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        providers = ["CPUExecutionProvider"]
        if ep == "coreml":
            providers = [("CoreMLExecutionProvider", {"ModelFormat": "MLProgram", "MLComputeUnits": "ALL"}),
                         "CPUExecutionProvider"]
        sfx = SUFFIX[dtype]
        self.text = ort.InferenceSession(str(ONNX / "onnx" / f"model{sfx}.onnx"), so, providers=providers)
        self.vision = (ort.InferenceSession(str(ONNX / "onnx" / f"vision_encoder{sfx}.onnx"), so, providers=providers)
                       if "image" in modalities else None)
        self.audio = (ort.InferenceSession(str(ONNX / "onnx" / f"audio_encoder{sfx}.onnx"), so, providers=providers)
                      if "audio" in modalities else None)
        self.float_t = np.float16 if dtype in ("fp16",) else np.float32
        from transformers import AutoProcessor

        self.proc = AutoProcessor.from_pretrained(str(ONNX))
        self.empty = np.zeros((0, 512), dtype=self._feat_dtype())

    def _feat_dtype(self):
        t = [i for i in self.text.get_inputs() if i.name == "image_features"][0].type
        return np.float16 if "float16" in t else np.float32

    def _run_text(self, input_ids, attention_mask, image=None, audio=None):
        feeds = {"input_ids": input_ids.astype(np.int64), "attention_mask": attention_mask.astype(np.int64),
                 "image_features": image if image is not None else self.empty,
                 "video_features": self.empty, "audio_features": audio if audio is not None else self.empty}
        out = self.text.run(["sentence_embedding"], feeds)[0][0].astype(np.float32)
        return out / np.linalg.norm(out)

    # -- preprocessing (reference processor) -------------------------------------------------------
    def prep_text(self, s: str):
        t = self.proc.tokenizer([s], return_tensors="np")
        return {"input_ids": t["input_ids"], "attention_mask": t["attention_mask"]}

    def prep_image(self, img: Image.Image):
        o = self.proc(images=[img], return_tensors="np")
        vin = self.vision.get_inputs()
        pv = o["pixel_values"].astype(np.float16 if "float16" in vin[0].type else np.float32)
        return {"input_ids": o["input_ids"], "attention_mask": o["attention_mask"], "pixel_values": pv,
                "pixel_position_ids": o["image_position_ids"].astype(np.int64)}

    def prep_audio(self, wav: np.ndarray):
        o = self.proc(audio=[wav], return_tensors="np")
        ain = self.audio.get_inputs()
        feats = o["input_features"].astype(np.float16 if "float16" in ain[0].type else np.float32)
        return {"input_ids": o["input_ids"], "attention_mask": o["attention_mask"], "input_features": feats,
                "input_features_mask": o["input_features_mask"].astype(bool)}

    # -- inference ------------------------------------------------------------------------------
    def run(self, p: dict) -> np.ndarray:
        if "pixel_values" in p:
            f = self.vision.run(None, {"pixel_values": p["pixel_values"], "pixel_position_ids": p["pixel_position_ids"]})[0]
            return self._run_text(p["input_ids"], p["attention_mask"], image=f.astype(self.empty.dtype))
        if "input_features" in p:
            f = self.audio.run(None, {"input_features": p["input_features"],
                                      "input_features_mask": p["input_features_mask"]})[0]
            return self._run_text(p["input_ids"], p["attention_mask"], audio=f.astype(self.empty.dtype))
        return self._run_text(p["input_ids"], p["attention_mask"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dtype", default="q4", choices=list(SUFFIX))
    ap.add_argument("--ep", default="cpu", choices=["cpu", "coreml"])
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dump-inputs", default="")
    ap.add_argument("--dump-only", action="store_true")
    a = ap.parse_args()
    engine = f"ort-py-{a.dtype}-{a.ep}"
    sampler = MemSampler()
    base = sampler.current()
    t0 = time.perf_counter()
    e = OrtEmbedder(a.dtype, a.ep)
    load_s = time.perf_counter() - t0
    after_load = sampler.current()
    texts, images, audio = load_texts(), load_images(), load_audio()
    if a.limit:
        texts, images, audio = texts[: a.limit], images[: a.limit], audio[: a.limit]
    preps = {"text": [(it.id, "text_" + it.length, e.prep_text(it.input)) for it in texts],
             "image": [(iid, "image", e.prep_image(Image.open(p).convert("RGB"))) for iid, p in images],
             "audio": [(aid, "audio_10s", e.prep_audio(read_wav16k(p))) for aid, p in audio]}
    if a.dump_inputs:
        d = Path(a.dump_inputs)
        d.mkdir(parents=True, exist_ok=True)
        for mod, lst in preps.items():
            for iid, cls, p in lst:
                np.savez(d / f"{mod}__{iid}.npz", **p)
        if a.dump_only:
            return
    tim = Timings()
    out = {"text": {}, "image": {}, "audio": {}}
    with sampler:
        for mod, lst in preps.items():
            if lst:
                e.run(lst[0][2])
            for iid, cls, p in lst:
                t = time.perf_counter()
                out[mod][iid] = e.run(p)
                tim.add(cls, time.perf_counter() - t)
    save(engine, text=out["text"], image=out["image"], audio=out["audio"], timings=tim,
         memory={"baseline_mb": mb(base), "after_load_mb": mb(after_load), "peak_mb": mb(sampler.peak),
                 "model_mb": mb(after_load - base)},
         meta={"load_s": round(load_s, 2), "onnxruntime": ort.__version__, "ep": a.ep, "dtype": a.dtype,
               "files": f"model{SUFFIX[a.dtype]}.onnx + vision_encoder{SUFFIX[a.dtype]} + audio_encoder{SUFFIX[a.dtype]}",
               "note": "latency excludes preprocessing (done by the reference processor)"})


if __name__ == "__main__":
    main()
