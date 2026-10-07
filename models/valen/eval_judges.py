"""Runs Valen on the judge pairs (models/bench/judges/pairs.jsonl), in PyTorch or onnxruntime.

python -I models/valen/eval_judges.py torch [--device mps]
python -I models/valen/eval_judges.py onnx --variant ""|int8|q4 [--parity]

Writes ~/.cache/spdf-models/bench-out/judges/valen-<engine>.jsonl, one line per pair:
{"id", "ms", "supported", "relation": {name: p}, "relevance"}. --parity also checks that the
ported compiler gives the same token ids and role spans as Valen's own compiler.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
CACHE = Path(os.environ.get("SPDF_MODELS_CACHE", Path.home() / ".cache" / "spdf-models"))
PAIRS = HERE.parent / "bench" / "judges" / "pairs.jsonl"
OUT = CACHE / "bench-out" / "judges"

RELATIONS = {
    "APOYO_DIRECTO": "The passage directly states the claim or logically entails it.",
    "APLICACION_DE_MARCO": "The claim applies a concept or framework from the passage to a new domain the passage does not discuss.",
    "CONTEXTO": "The passage is on the same topic and gives background, but does not establish this specific claim.",
    "CONTRADICCION": "The passage states the opposite of the claim or gives a different fact, number, date or name.",
    "IMPOSIBLE_TEMPORAL": "The source cannot speak about what the claim says because of chronology: it was written before the events, works or ideas the claim attributes to it.",
    "OPINION_REFERIDA": "The claim reports someone's view, and the passage is where that view is stated or reported.",
    "AFIRMACION_NEGATIVA": "The claim says something is absent or does not happen, while the passage only discusses what is present.",
}
RELEVANCE = ["Irrelevant: unrelated to the query.", "Related: same topic, but does not help answer the query.",
             "Relevant: partially answers the query or gives useful evidence for it.",
             "Highly relevant: directly and fully answers the query."]
SUPPORT_Q = ("Does the passage support the claim, so that a skeptical reader checking the citation would agree the "
             "source says it?")


def request_for(p: dict) -> dict:
    if p["kind"] == "support":
        s = p.get("source") or {}
        src = ", ".join(str(x) for x in (s.get("author"), s.get("title"), s.get("year")) if x)
        state = (f"Source: {src}\n" if src else "") + f"Claim: {p['claim']}\nPassage: {p['passage']}"
        return {"state": state, "questions": {
            "support": {"type": "noul", "instructions": SUPPORT_Q},
            "relation": {"type": "choice", "instructions": "How does the passage relate to the claim?", "criteria": RELATIONS}}}
    return {"state": f"Query: {p['query']}\nPassage: {p['passage']}", "questions": {
        "relevance": {"type": "score", "instructions": "How well does the passage answer the search query?", "criteria": RELEVANCE}}}


def summarize(ans: dict) -> dict:
    r = {}
    if "support" in ans:
        r["supported"] = ans["support"]["noul"]
        r["relation"] = ans["relation"]["probabilities"]
    if "relevance" in ans:
        r["relevance"] = ans["relevance"]["score"] / 3.0
        r["relevance_probs"] = ans["relevance"]["probabilities"]
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("engine", choices=["torch", "onnx"])
    ap.add_argument("--device", default="mps")
    ap.add_argument("--variant", default="")
    ap.add_argument("--parity", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    pairs = [json.loads(l) for l in PAIRS.read_text().splitlines() if l.strip()]
    if a.limit:
        pairs = pairs[: a.limit]
    OUT.mkdir(parents=True, exist_ok=True)
    torch_model = None
    if a.engine == "torch" or a.parity:
        import torch
        from transformers import AutoModel

        torch_model = AutoModel.from_pretrained(str(CACHE / "Valen-Team" / "Valen-0.8B"), trust_remote_code=True, dtype="auto",
                                                attn_implementation="sdpa").eval()
        if a.engine == "torch":
            torch_model = torch_model.to(a.device)
    if a.engine == "torch":
        name = f"valen-torch-{a.device}"
        run = lambda req: torch_model.predict(req, execution="shared_state")  # noqa: E731
    else:
        from valen_onnx import ValenOnnx, compile_request, compiled_from_valen

        v = ValenOnnx(a.variant)
        name = f"valen-onnx-{a.variant or 'fp32'}-cpu"
        run = v.predict
        if a.parity:
            bad = 0
            for p in pairs:
                req = request_for(p)
                mine = compile_request(v.tok, req)
                ref = compiled_from_valen(torch_model, req)
                same = mine[0] == ref[0] and all(
                    (m["context"], m["instruction"], [tuple(c) for c in m["candidates"]], m["decision"])
                    == (tuple(r["context"]), tuple(r["instruction"]), [tuple(c) for c in r["candidates"]], r["decision"])
                    for m, r in zip(mine[1], ref[1]))
                bad += not same
            print(json.dumps({"compiler_parity": {"pairs": len(pairs), "mismatches": bad}}))
    with (OUT / f"{name}.jsonl").open("w") as f:
        for i, p in enumerate(pairs):
            req = request_for(p)
            t = time.perf_counter()
            out = run(req)
            ms = (time.perf_counter() - t) * 1000
            f.write(json.dumps({"id": p["id"], "ms": ms, "tokens": out["usage"]["input_tokens"], **summarize(out["answers"])}) + "\n")
            if i % 50 == 0:
                print(f"{name}: {i}/{len(pairs)} ({ms:.0f} ms)", flush=True)
    print(f"wrote {OUT / (name + '.jsonl')}")


if __name__ == "__main__":
    main()
