"""Static-shape export of Valen-0.8B's backbone (no Scan): chunked gated delta rule unrolled for a
fixed input length, so WebGPU runs it as plain kernels.

    python -I models/valen/export_static.py --length 1024 [--quant q4,int8]

Inputs are right-padded to `length`: every layer is causal (gated delta rule, causal conv, causal
attention), so positions before the padding are unaffected. Output `hidden_states`
[1, length, 1024]. The Mixer head is the same valen_head.onnx as the dynamic export.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch

CACHE = Path(os.environ.get("SPDF_MODELS_CACHE", Path.home() / ".cache" / "spdf-models"))
VALEN = CACHE / "Valen-Team" / "Valen-0.8B"
OUT = CACHE / "valen-onnx"


def neumann_chunk_gated_delta_rule(query, key, value, g, beta, chunk_size=64, initial_state=None, output_final_state=False,
                                   use_qk_l2norm_in_kernel=False, **kwargs):
    """transformers' torch_chunk_gated_delta_rule with the unit-lower-triangular solve replaced by an exact
    product (I+N)(I+N^2)(I+N^4)…(I+N^32): N is strictly lower triangular, so N^64 = 0 and the product is the
    inverse. Six 64x64 matmuls instead of a triangular solve (which ONNX lacks) or a 63-step loop."""
    import torch.nn.functional as F

    initial_dtype = query.dtype
    batch_size, sequence_length, _, k_head_dim = key.shape
    num_v_heads, v_head_dim = value.shape[-2:]
    query, key, value, beta, decay = [x.transpose(1, 2).to(torch.float32).contiguous() for x in (query, key, value, beta, g)]
    if use_qk_l2norm_in_kernel:
        query = query * torch.rsqrt((query * query).sum(-1, keepdim=True) + 1e-6)
        key = key * torch.rsqrt((key * key).sum(-1, keepdim=True) + 1e-6)
    query = query * (query.shape[-1] ** -0.5)
    pad_size = (chunk_size - sequence_length % chunk_size) % chunk_size
    query, key, value = (F.pad(x, (0, 0, 0, pad_size)) for x in (query, key, value))
    beta, decay = (F.pad(x, (0, pad_size)) for x in (beta, decay))
    num_chunks = (sequence_length + pad_size) // chunk_size
    v_beta = value * beta.unsqueeze(-1)
    k_beta = key * beta.unsqueeze(-1)
    query, key, k_beta, v_beta = [x.reshape(x.shape[0], x.shape[1], -1, chunk_size, x.shape[-1]) for x in (query, key, k_beta, v_beta)]
    decay = decay.reshape(decay.shape[0], decay.shape[1], -1, chunk_size)
    upper = torch.ones(chunk_size, chunk_size, dtype=torch.bool).triu(1)
    cum_decay = decay.cumsum(dim=3)
    pairwise = (cum_decay.unsqueeze(4) - cum_decay.unsqueeze(3)).masked_fill(upper, float("-inf")).exp()
    ut_system = (k_beta @ key.transpose(-1, -2)) * pairwise
    intra = (query @ key.transpose(-1, -2)) * pairwise
    decayed_k_beta = k_beta * cum_decay.exp().unsqueeze(-1)
    eye = torch.eye(chunk_size, dtype=ut_system.dtype)
    n = -ut_system.tril(-1)
    inv = eye + n
    pw = n
    steps = max(1, (chunk_size - 1).bit_length() - 1)
    for _ in range(steps):
        pw = pw @ pw
        inv = inv @ (eye + pw)
    new_values, k_cumdecay = inv @ v_beta, inv @ decayed_k_beta
    state = (torch.zeros((batch_size, num_v_heads, k_head_dim, v_head_dim), dtype=new_values.dtype) if initial_state is None
             else initial_state.to(new_values))
    query = query * cum_decay.exp().unsqueeze(-1)
    key = key * (cum_decay[..., -1:] - cum_decay).exp().unsqueeze(-1)
    chunk_decay = cum_decay[..., -1].exp()[..., None, None]
    outs = []
    for i in range(num_chunks):
        v_new = new_values[:, :, i] - k_cumdecay[:, :, i] @ state
        outs.append(query[:, :, i] @ state + intra[:, :, i] @ v_new)
        state = state * chunk_decay[:, :, i] + key[:, :, i].transpose(-1, -2) @ v_new
    out = torch.stack(outs, dim=2).reshape(batch_size, num_v_heads, -1, v_head_dim)[:, :, :sequence_length]
    return out.transpose(1, 2).to(initial_dtype).contiguous(), (state if output_final_state else None)


class Backbone(torch.nn.Module):
    def __init__(self, lm):
        super().__init__()
        self.lm = lm

    def forward(self, input_ids):
        return self.lm(input_ids=input_ids, use_cache=False, return_dict=True).last_hidden_state


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--length", type=int, default=1024)
    ap.add_argument("--quant", default="q4")
    ap.add_argument("--check", type=int, default=1)
    a = ap.parse_args()
    from transformers import AutoModel
    import transformers.masking_utils as mu

    # one unpacked sequence per row: skip packed-sequence detection (torch.diff has no ONNX export)
    mu.find_packed_sequence_indices = lambda position_ids: None
    import transformers.models.qwen3_5.modeling_qwen3_5 as q35

    # transformers' export path: forward substitution instead of linalg.solve_triangular (no ONNX op).
    # (A Neumann-product inverse is exact in theory but numerically unstable on real chunks.)
    q35.is_torchdynamo_exporting = lambda: True

    m = AutoModel.from_pretrained(str(VALEN), trust_remote_code=True, dtype=torch.float32, attn_implementation="eager").eval()
    lm = m.backbone.language_model
    wrap = Backbone(lm).eval()
    L = a.length
    ids = torch.randint(10, 1000, (1, L), dtype=torch.long)
    dest = OUT / f"valen_backbone_static{L}.onnx"
    t = time.time()
    import tempfile

    import onnx

    with tempfile.TemporaryDirectory(dir=OUT) as tmp:
        raw = Path(tmp) / "model.onnx"
        with torch.no_grad():
            torch.onnx.export(wrap, (ids,), str(raw), input_names=["input_ids"], output_names=["hidden_states"], opset_version=18,
                              dynamo=False, do_constant_folding=True, external_data=True)
        model = onnx.load(str(raw))
        for p in (dest, dest.with_name(dest.name + "_data")):
            if p.exists():
                p.unlink()
        onnx.save(model, str(dest), save_as_external_data=True, all_tensors_to_one_file=True, location=dest.name + "_data",
                  size_threshold=1024)
    print(f"exported {dest} in {time.time() - t:.0f} s")
    if a.check:
        import onnxruntime as ort

        s = ort.InferenceSession(str(dest), providers=["CPUExecutionProvider"])
        x = torch.randint(10, 50000, (1, L), dtype=torch.long)
        with torch.no_grad():
            ref = wrap(x).numpy()[0]
        got = s.run(None, {"input_ids": x.numpy()})[0][0]
        cos = (ref * got).sum(-1) / (np.linalg.norm(ref, axis=-1) * np.linalg.norm(got, axis=-1))
        print("hidden-state cosine vs PyTorch: min", float(cos.min()), "mean", float(cos.mean()))
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import export_onnx as ex

    for q in [x for x in a.quant.split(",") if x]:
        t = time.time()
        p = ex.quantize(dest, q, OUT / f"valen_backbone_static{L}_{q}.onnx")
        print(f"{q}: {p} ({time.time() - t:.0f} s)")


if __name__ == "__main__":
    main()
