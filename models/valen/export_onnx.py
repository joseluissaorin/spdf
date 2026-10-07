"""Exports Valen-0.8B (text path) to ONNX: backbone + Mixer decision head.

    python -I models/valen/export_onnx.py [--out DIR] [--quant fp32,int8,q4]

How (and why this way):
  * Qwen3.5 mixes Gated DeltaNet (linear attention) and full-attention layers. A plain
    torch.onnx export of the delta rule unrolls its loop for one sequence length. The
    onnx-community export of the *base* model (onnx-community/Qwen3.5-0.8B-ONNX) already solved
    it (a Scan for prefill, a direct path for one token), so we reuse that graph and swap in the
    Valen weights: Valen is a full fine-tune of the same architecture. Transforms were found by
    matching every initializer against the Valen tensors (see README): MatMul weights
    transposed, RMSNorm weights stored as 1 + w, A_neg_exp = -exp(A_log), conv weights reshaped.
  * The token embedding table is folded into the graph (input `input_ids`), the LM head (1 GB,
    not used by Valen) is removed, and the output is `hidden_states` [batch, seq, 1024] after
    the final norm, which is what the decision head reads.
  * The Mixer head is exported on its own: features [n_candidates, 4, 1024] -> logits [n].
    Feature extraction (mean pooling of context/instruction/candidate spans + decision token)
    is a few lines in each runtime (valen_onnx.py, spdf-infer, spdf-infer-web).

Outputs in DIR (default ~/.cache/spdf-models/valen-onnx): valen_backbone{,_int8,_q4}.onnx
(+ .onnx_data), valen_head.onnx, tokenizer.json, config.json, export.json (hashes, versions).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

CACHE = Path(os.environ.get("SPDF_MODELS_CACHE", Path.home() / ".cache" / "spdf-models"))
BASE = CACHE / "onnx-community" / "Qwen3.5-0.8B-ONNX" / "onnx"
VALEN = CACHE / "Valen-Team" / "Valen-0.8B"
BASE_REV = "onnx-community/Qwen3.5-0.8B-ONNX"


def valen_name(onnx_name: str) -> str | None:
    if onnx_name.startswith("lm_head"):
        return None
    if "final_norm_layernorm" in onnx_name:
        return "backbone.language_model.norm.weight"
    n = onnx_name.replace("model.layers.", "backbone.language_model.layers.").replace(".gdn.", ".linear_attn.")
    n = n.replace(".attn.", ".self_attn.").replace(".MatMul.weight", ".weight").replace(".layernorm.weight", ".weight")
    n = n.replace("conv1d.weight_3d", "conv1d.weight").replace("A_neg_exp", "A_log")
    return n


def transform(onnx_name: str, w: np.ndarray, shape) -> np.ndarray:
    if onnx_name.endswith(".MatMul.weight"):
        w = w.T
    elif "A_neg_exp" in onnx_name:
        w = -np.exp(w)
    elif any(k in onnx_name for k in ("input_layernorm", "post_attention_layernorm", "q_norm", "k_norm", "final_norm")):
        w = 1.0 + w
    return np.ascontiguousarray(w.reshape(shape).astype(np.float32))


def build_backbone(out: Path) -> Path:
    from safetensors import safe_open

    st = safe_open(str(VALEN / "model.safetensors"), "np")
    m = onnx.load(str(BASE / "decoder_model_merged.onnx"), load_external_data=False)
    g = m.graph
    # 1. swap weights (all go to one external data file, written by onnx.save)
    new_inits = []
    for init in g.initializer:
        if init.name.startswith("/model/constants") or init.name == "model.inv_freq":
            if init.external_data:  # small constants may be external too: load them from the base file
                loc = {e.key: e.value for e in init.external_data}
                with open(BASE / loc["location"], "rb") as fh:
                    fh.seek(int(loc.get("offset", 0)))
                    raw = fh.read(int(loc["length"]))
                arr = np.frombuffer(raw, dtype=helper.tensor_dtype_to_np_dtype(init.data_type)).reshape(list(init.dims))
                new_inits.append(numpy_helper.from_array(arr.copy(), init.name))
            else:
                new_inits.append(init)
            continue
        vn = valen_name(init.name)
        if vn is None:
            continue  # lm_head: dropped
        w = transform(init.name, st.get_tensor(vn).astype(np.float32), list(init.dims))
        new_inits.append(numpy_helper.from_array(w, init.name))
    # 2. fold the embedding table: input_ids -> Gather -> (old) inputs_embeds
    emb = st.get_tensor("backbone.language_model.embed_tokens.weight").astype(np.float32)
    new_inits.append(numpy_helper.from_array(np.ascontiguousarray(emb), "model.embed_tokens.weight"))
    del g.initializer[:]
    g.initializer.extend(new_inits)
    old_in = next(i for i in g.input if i.name == "inputs_embeds")
    g.input.remove(old_in)
    ids = helper.make_tensor_value_info("input_ids", TensorProto.INT64, ["batch_size", "sequence_length"])
    g.input.insert(0, ids)
    g.node.insert(0, helper.make_node("Gather", ["model.embed_tokens.weight", "input_ids"], ["inputs_embeds"],
                                      name="/model/embed_tokens/Gather", axis=0))
    # 3. drop the LM head, expose hidden states
    lm = [n for n in g.node if n.output and n.output[0] == "logits"]
    hid_name = lm[0].input[0]
    for n in lm:
        g.node.remove(n)
    for o in list(g.output):
        if o.name == "logits":
            g.output.remove(o)
    g.output.insert(0, helper.make_tensor_value_info(hid_name, TensorProto.FLOAT, ["batch_size", "sequence_length", 1024]))
    # rename to a stable output name
    for n in g.node:
        for i, x in enumerate(n.output):
            if x == hid_name:
                n.output[i] = "hidden_states"
        for i, x in enumerate(n.input):
            if x == hid_name:
                n.input[i] = "hidden_states"
    g.output[0].name = "hidden_states"
    m.producer_name = "spdf-models valen export"
    dest = out / "valen_backbone.onnx"
    if dest.exists():
        dest.unlink()
    data = out / "valen_backbone.onnx_data"
    if data.exists():
        data.unlink()
    onnx.save(m, str(dest), save_as_external_data=True, all_tensors_to_one_file=True, location=data.name, size_threshold=1024)
    return dest


def build_head(out: Path) -> Path:
    import torch

    sys.path.insert(0, str(VALEN))
    from heads import build_head as valen_build_head  # noqa: E402 (Valen's own code, pinned revision)

    cfg = json.loads((VALEN / "config.json").read_text())
    head = valen_build_head(cfg["text_config"]["hidden_size"], cfg["valen_head"])
    from safetensors.torch import load_file

    sd = {k[len("head."):]: v for k, v in load_file(str(VALEN / "model.safetensors")).items() if k.startswith("head.")}
    head.load_state_dict(sd)
    head.float().eval()

    class Score(torch.nn.Module):
        def __init__(self, h):
            super().__init__()
            self.h = h

        def forward(self, features):
            return self.h.score_features(features)

    dest = out / "valen_head.onnx"
    x = torch.randn(3, 4, 1024)
    torch.onnx.export(Score(head), (x,), str(dest), input_names=["features"], output_names=["logits"],
                      dynamic_axes={"features": {0: "n"}, "logits": {0: "n"}}, opset_version=17, dynamo=False)
    return dest


def quantize(src: Path, kind: str) -> Path:
    if kind == "int8":
        from onnxruntime.quantization import QuantType, quantize_dynamic

        dest = src.with_name("valen_backbone_int8.onnx")
        quantize_dynamic(str(src), str(dest), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gather"],
                         use_external_data_format=True, extra_options={"MatMulConstBOnly": True})
        return dest
    if kind == "q4":
        from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer

        dest = src.with_name("valen_backbone_q4.onnx")
        model = onnx.load(str(src))
        cfg = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, accuracy_level=4,
                                           op_types_to_quantize=("MatMul", "Gather"), quant_axes=(("MatMul", 0), ("Gather", 1)))
        q = MatMulNBitsQuantizer(model, block_size=32, is_symmetric=True, accuracy_level=4, algo_config=cfg)
        q.process()
        data = dest.with_name(dest.name + "_data")
        if data.exists():
            data.unlink()
        q.model.save_model_to_file(str(dest), use_external_data_format=True)
        return dest
    raise ValueError(kind)


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(CACHE / "valen-onnx"))
    ap.add_argument("--quant", default="int8,q4")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    t = time.time()
    bb = build_backbone(out)
    print(f"backbone fp32: {bb} ({time.time() - t:.0f} s)")
    hd = build_head(out)
    print(f"head: {hd}")
    files = [bb, bb.with_name(bb.name + "_data"), hd]
    for q in [x for x in a.quant.split(",") if x]:
        t = time.time()
        p = quantize(bb, q)
        print(f"{q}: {p} ({time.time() - t:.0f} s)")
        files += [p] + ([p.with_name(p.name + "_data")] if p.with_name(p.name + "_data").exists() else [])
    for f in ("tokenizer.json", "tokenizer_config.json", "config.json", "chat_template.jinja"):
        shutil.copy(VALEN / f, out / f)
    manifest = json.loads((VALEN / "export_manifest.json").read_text())
    info = {"source": "Valen-Team/Valen-0.8B", "source_files_sha256": manifest.get("files_sha256", {}),
            "graph_base": BASE_REV, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "files": {f.name: {"bytes": f.stat().st_size, "sha256": sha256(f)} for f in files if f.exists()}}
    (out / "export.json").write_text(json.dumps(info, indent=1) + "\n")
    print(json.dumps(info["files"], indent=1))


if __name__ == "__main__":
    main()
