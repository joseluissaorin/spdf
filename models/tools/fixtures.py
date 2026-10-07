"""Cross-language fixtures for spdf-infer (Rust) and spdf-infer-web (TypeScript).

python -I models/tools/fixtures.py   (needs the bench venv: transformers, tokenizers, pillow)

Writes models/web/test/fixtures/:
  valen_compile.json  Valen prompts compiled by the Python port, checked here against Valen's own
                      compiler when the model code is in the cache.
  fake.json           FakeEmbedder vectors (FNV-1a + splitmix64) for a few strings.
  image.json          target sizes and a Pillow bicubic resize of a synthetic image (SHA-256 of bytes).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "web" / "test" / "fixtures"
CACHE = Path(os.environ.get("SPDF_MODELS_CACHE", Path.home() / ".cache" / "spdf-models"))
sys.path.insert(0, str(HERE.parent / "valen"))


def fake_vec(s: str, dims: int) -> list[float]:
    M = (1 << 64) - 1
    h = 0xcbf29ce484222325
    for b in s.encode():
        h ^= b
        h = (h * 0x100000001b3) & M
    v = []
    for _ in range(dims):
        h = (h + 0x9e3779b97f4a7c15) & M
        z = h
        z = ((z ^ (z >> 30)) * 0xbf58476d1ce4e5b9) & M
        z = ((z ^ (z >> 27)) * 0x94d049bb133111eb) & M
        z ^= z >> 31
        v.append((z >> 11) / 2**53 * 2 - 1)
    n = sum(x * x for x in v) ** 0.5
    return [x / n for x in v]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # fake embedder (document task, no title)
    fake = [{"text": t, "input": "title: none | text: " + t, "dims": 16, "vec": fake_vec("title: none | text: " + t, 16)}
            for t in ["hola", "En un lugar de la Mancha", "是"]]
    (OUT / "fake.json").write_text(json.dumps(fake, ensure_ascii=False, indent=1) + "\n")

    # image sizes + a Pillow resize
    from PIL import Image

    sizes = [{"w": w, "h": h, "target": None} for w, h in [(843, 1265), (843, 1014), (843, 621), (4000, 3000), (100, 4000), (48, 48)]]
    sys.path.insert(0, str(HERE.parent / "bench"))
    from llama_srv import gemma4_target_size

    for s in sizes:
        s["target"] = list(gemma4_target_size(s["w"], s["h"]))
    w, h = 173, 97
    data = bytes((x * 7 + y * 13 + c * 101) % 256 for y in range(h) for x in range(w) for c in range(3))
    img = Image.frombytes("RGB", (w, h), data)
    resized = {}
    for tw, th in [(96, 48), (288, 192), (40, 200)]:
        r = img.resize((tw, th), Image.BICUBIC).tobytes()
        resized[f"{tw}x{th}"] = hashlib.sha256(r).hexdigest()
    (OUT / "image.json").write_text(json.dumps({"sizes": sizes, "synthetic": {"w": w, "h": h, "formula": "(x*7 + y*13 + c*101) % 256"},
                                                "pillow_bicubic_sha256": resized}, indent=1) + "\n")

    # Valen compiler
    tok_path = CACHE / "valen-onnx" / "tokenizer.json"
    if not tok_path.exists():
        print("valen tokenizer not in cache: skipping valen_compile.json")
        return
    from valen_onnx import Tok, compile_request

    tok = Tok(tok_path)
    reqs = [
        ("readme", {"state": "A cat is on the sofa.", "questions": {
            "animal": {"type": "choice", "instructions": "Which animal is present?", "criteria": {"cat": "A cat", "dog": "A dog"}},
            "on_sofa": {"type": "noul", "instructions": "The cat is on the sofa."}}}),
        ("support-es", {"state": "Source: Lope de Vega, El casamiento en la muerte, 1700\nClaim: Bernardo rechaza a Carlomagno.\nPassage: ¿Qué es retirar? Por Alà, que he de vèr lo que hay.",
                        "questions": {"support": {"type": "noul", "instructions": "Does the passage support the claim?"},
                                      "relation": {"type": "choice", "instructions": "How does the passage relate to the claim?",
                                                   "criteria": {"APOYO_DIRECTO": "The passage directly states the claim.", "CONTEXTO": "Background only."}}}}),
        ("score-zh", {"state": "Query: 賈寶玉與林黛玉\nPassage: 一句沒說完，只听喊道：“好了！",
                      "questions": {"relevance": {"type": "score", "instructions": "How well does the passage answer the search query?",
                                                  "criteria": ["Irrelevant", "Related", "Relevant", "Highly relevant"]}}}),
    ]
    cases = []
    valen_check = None
    try:
        import torch  # noqa: F401
        from transformers import AutoModel
        from valen_onnx import compiled_from_valen

        m = AutoModel.from_pretrained(str(CACHE / "Valen-Team" / "Valen-0.8B"), trust_remote_code=True, dtype="auto")
        valen_check = lambda r: compiled_from_valen(m, r)  # noqa: E731
    except Exception as exc:  # noqa: BLE001
        print("Valen's own compiler not available, fixtures not cross-checked:", exc)
    for name, req in reqs:
        ids, qs = compile_request(tok, req)
        if valen_check:
            rids, rqs = valen_check(req)
            assert ids == rids, name
            for a, b in zip(qs, rqs):
                assert (tuple(a["instruction"]), [tuple(c) for c in a["candidates"]], a["decision"]) == \
                       (tuple(b["instruction"]), [tuple(c) for c in b["candidates"]], b["decision"]), name
        cases.append({"name": name, "request": req, "ids": ids,
                      "readouts": [{"qid": q["qid"], "instruction": list(q["instruction"]), "candidates": [list(c) for c in q["candidates"]],
                                    "decision": q["decision"], "context": list(q["context"])} for q in qs]})
    (OUT / "valen_compile.json").write_text(json.dumps(cases, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {OUT} ({len(cases)} Valen cases{', cross-checked with Valen' if valen_check else ''})")


if __name__ == "__main__":
    main()
