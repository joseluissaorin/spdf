"""Valen-0.8B on onnxruntime (text states), with the same request/answer contract as model.predict().

Prompt compilation is Valen's own `Compiler` (pinned repo code) when available, so token ids and
role spans are identical to PyTorch; `compile_request()` below is an independent port of the
shared-state compiler (the one ported to Rust and TypeScript), checked against it in compare.py.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

CACHE = Path(os.environ.get("SPDF_MODELS_CACHE", Path.home() / ".cache" / "spdf-models"))
ONNX_DIR = CACHE / "valen-onnx"

NOUL = [("true", "True / 是：满足问题中的条件。"), ("false", "False / 否：不满足问题中的条件。")]


def candidates(q: dict):
    kind = q["type"]
    if kind == "noul":
        return list(NOUL)
    if kind == "choice":
        return list(q["criteria"].items())
    if kind == "score":
        return [(str(i), t) for i, t in enumerate(q["criteria"])]
    raise ValueError(kind)


class Tok:
    """Segment tokenizer with byte offsets (HF tokenizers)."""

    def __init__(self, path: Path):
        from tokenizers import Tokenizer

        self.t = Tokenizer.from_file(str(path))

    def encode(self, text: str) -> list[int]:
        return self.t.encode(text, add_special_tokens=False).ids

    def encode_span(self, text: str, span: tuple[int, int]) -> tuple[list[int], tuple[int, int]]:
        e = self.t.encode(text, add_special_tokens=False)
        idx = [i for i, (a, b) in enumerate(e.offsets) if a < span[1] and b > span[0]]
        if not idx:
            raise ValueError("empty span")
        return e.ids, (idx[0], idx[-1] + 1)


def state_prefix(state: str) -> str:
    """Qwen3.5 chat template for one user text message, no generation prompt."""
    return f"<|im_start|>user\n{state}<|im_end|>\n"


def compile_request(tok: Tok, request: dict):
    """Port of Valen's shared-state compiler (text state). Returns input_ids and per-question readouts."""
    base = tok.encode(state_prefix(request["state"]))
    ids: list[int] = list(base)
    qs = []

    def append(text, span=None):
        start = len(ids)
        if span is None:
            ids.extend(tok.encode(text))
            return None
        t, (a, b) = tok.encode_span(text, span)
        ids.extend(t)
        return (start + a, start + b)

    append("<|im_start|>user\n")
    for index, (qid, q) in enumerate(request["questions"].items()):
        pairs = candidates(q)
        prefix = f"Question {index + 1}\nTask: {q['type']}\nQuestion: "
        instr = append(prefix + q["instructions"] + "\nCandidates:\n", (len(prefix), len(prefix) + len(q["instructions"])))
        positions, spans = [], []
        for key, desc in pairs:
            p = key + ": " if q["type"] != "score" else ""
            spans.append(append(p + desc, (len(p), len(p) + len(desc))))
            positions.append(len(ids) - 1)
            append("\n")
        qs.append({"qid": qid, "kind": q["type"], "keys": [k for k, _ in pairs], "descriptions": [d for _, d in pairs],
                   "context": (0, len(base)), "instruction": instr, "candidates": spans, "decision": -1})
    append("<|im_end|>\n<|im_start|>assistant\n")
    for index, q in enumerate(qs):
        append(f"Question {index + 1} Decision:")
        q["decision"] = len(ids) - 1
        append("\n")
    return ids, qs


def answer(kind, keys, descriptions, logits, temperature=1.0):
    z = np.asarray(logits, dtype=np.float64) / temperature
    p = np.exp(z - z.max())
    p = (p / p.sum()).tolist()
    r = {"type": kind}
    if kind == "noul":
        r["noul"] = p[keys.index("true")]
        return r
    r["probabilities"] = dict(zip(keys, p))
    mode = int(np.argmax(p))
    if kind == "choice":
        r["choice"] = keys[mode]
        r["confidence"] = 1.0 if len(p) == 1 else max(0.0, (max(p) - 1 / len(p)) / (1 - 1 / len(p)))
    else:
        r["score"] = sum(i * x for i, x in enumerate(p))
        r["legend"] = dict(zip(keys, descriptions))
        dist = sum(x * abs(i - mode) for i, x in enumerate(p))
        uniform = sum(abs(i - (len(p) - 1) / 2) for i in range(len(p))) / len(p)
        r["confidence"] = max(0.0, 1.0 - dist / uniform)
    return r


class ValenOnnx:
    def __init__(self, variant: str = "", onnx_dir: Path = ONNX_DIR, providers=("CPUExecutionProvider",), threads: int = 0):
        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        name = "valen_backbone.onnx" if not variant else f"valen_backbone_{variant}.onnx"
        self.bb = ort.InferenceSession(str(onnx_dir / name), so, providers=list(providers))
        self.head = ort.InferenceSession(str(onnx_dir / "valen_head.onnx"), so, providers=["CPUExecutionProvider"])
        self.tok = Tok(onnx_dir / "tokenizer.json")
        self.state_inputs = []
        for i in self.bb.get_inputs():
            if i.name.startswith(("past_conv", "past_recurrent", "past_key_values")):
                self.state_inputs.append(i)

    def hidden(self, ids: list[int]) -> np.ndarray:
        n = len(ids)
        feeds = {"input_ids": np.asarray([ids], dtype=np.int64), "attention_mask": np.ones((1, n), dtype=np.int64),
                 "position_ids": np.broadcast_to(np.arange(n, dtype=np.int64), (3, 1, n)).copy()}
        for i in self.state_inputs:
            shape = [1 if d == "batch_size" else (0 if isinstance(d, str) else d) for d in i.shape]
            feeds[i.name] = np.zeros(shape, dtype=np.float32)
        return self.bb.run(["hidden_states"], feeds)[0][0]

    def features(self, h: np.ndarray, q: dict) -> np.ndarray:
        ctx = h[q["context"][0]:q["context"][1]].mean(0)
        ins = h[q["instruction"][0]:q["instruction"][1]].mean(0)
        dec = h[q["decision"]]
        return np.stack([np.stack([ctx, ins, h[a:b].mean(0), dec]) for a, b in q["candidates"]]).astype(np.float32)

    def predict(self, request: dict, temperature=1.0, compiled=None):
        ids, qs = compiled if compiled is not None else compile_request(self.tok, request)
        h = self.hidden(ids)
        out = {}
        for q in qs:
            logits = self.head.run(["logits"], {"features": self.features(h, q)})[0]
            out[q["qid"]] = answer(q["kind"], q["keys"], q["descriptions"], logits, temperature)
        return {"model": "Valen", "answers": out, "usage": {"input_tokens": len(ids), "output_tokens": 0}}


def compiled_from_valen(model, request):
    """Token ids and readouts produced by Valen's own Compiler (for parity checks)."""
    c = model.make_compiler(execution="shared_state")
    st = c.compile({"request": request})
    ids = st.inputs["input_ids"][0].tolist()
    qs = []
    for q in st.questions:
        b = q.branches[0]
        qs.append({"qid": q.qid, "kind": q.kind, "keys": q.keys, "descriptions": q.descriptions, "context": b.context_span,
                   "instruction": b.instruction_span, "candidates": b.candidate_spans, "decision": b.decision_position})
    return ids, qs


if __name__ == "__main__":
    v = ValenOnnx(sys.argv[1] if len(sys.argv) > 1 else "")
    req = {"state": "A cat is on the sofa.", "questions": {
        "animal": {"type": "choice", "instructions": "Which animal is present?", "criteria": {"cat": "A cat", "dog": "A dog"}},
        "on_sofa": {"type": "noul", "instructions": "The cat is on the sofa."}}}
    print(json.dumps(v.predict(req), ensure_ascii=False))
