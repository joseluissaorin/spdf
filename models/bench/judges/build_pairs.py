"""Judge evaluation pairs from Scholaris' public quality bench (~/Developer/scholaris-nube/bench/calidad).

Sources (all reusable): Lope de Vega, «El casamiento en la muerte…» (public domain), Bécquer,
«El monte de las ánimas» (public domain, LibriVox reading), and Kanerva et al., «OCR Error
Post-Correction with LLMs in Historical Documents: No Free Lunches» (arXiv:2502.01205, CC BY 4.0).
Labels: Scholaris' claim set (gold vs negative passages) and its «plata» relevance judgments
(0-3, Gemini Flash + DeepSeek, Gemini Pro on disagreement). No label comes from the Jev API.

python -I judges/build_pairs.py [--relevance 400]  ->  judges/pairs.jsonl
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import random
import sqlite3
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHO = Path(os.environ.get("SCHOLARIS_BENCH", Path.home() / "Developer" / "scholaris-nube" / "bench" / "calidad"))
SOURCES = {"Becquer": ("becquer-monte", "Gustavo Adolfo Bécquer", "El monte de las ánimas", 1861),
           "Casamiento": ("el-casamiento-en-la-", "Lope de Vega", "El casamiento en la muerte y hechos de Bernardo del Carpio", 1700),
           "OCR": ("ocr-no-free-lunches", "Kanerva, Ledins, Käpyaho, Ginter", "OCR Error Post-Correction with LLMs in Historical Documents: No Free Lunches", 2025)}


def fragments() -> dict[str, dict]:
    out = {}
    for short, (label, author, title, year) in SOURCES.items():
        raw = (SCHO / "fuentes" / f"{label}.spdf").read_bytes()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
            tmp.write(raw)
            tmp.flush()
            c = sqlite3.connect(f"file:{tmp.name}?mode=ro", uri=True)
            for fid, text in c.execute("select id, texto from fragmentos"):
                out[fid] = {"text": text, "doc": short, "source": {"author": author, "title": title, "year": year}}
            c.close()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--relevance", type=int, default=400)
    a = ap.parse_args()
    frags = fragments()
    pairs = []
    for c in json.loads((SCHO / "citas.json").read_text()):
        for label, ids in ((1, c.get("oro", [])), (0, c.get("negativos", []))):
            for fid in ids:
                if fid not in frags:
                    continue
                f = frags[fid]
                pairs.append({"id": f"{c['id']}:{fid}", "kind": "support", "claim": c["texto"], "passage": f["text"],
                              "label": label, "claim_type": c["tipo"], "doc": f["doc"], "source": f["source"]})
    queries = {q["id"]: q for q in json.loads((SCHO / "consultas.json").read_text())}
    judged = json.loads((SCHO / "juicios.json").read_text())
    rel = []
    for qid, js in judged.items():
        if qid not in queries:
            continue
        for fid, j in js.items():
            if fid in frags and isinstance(j.get("nota"), (int, float)):
                rel.append({"id": f"{qid}:{fid}", "kind": "relevance", "query": queries[qid]["consulta"], "qid": qid,
                            "passage": frags[fid]["text"], "grade": j["nota"], "doc": frags[fid]["doc"]})
    rng = random.Random(20261007)
    by_grade: dict[int, list] = {}
    for r in rel:
        by_grade.setdefault(int(round(r["grade"])), []).append(r)
    per = a.relevance // max(1, len(by_grade))
    sample = []
    for g in sorted(by_grade):
        rng.shuffle(by_grade[g])
        sample += by_grade[g][:per]
    pairs += sorted(sample, key=lambda r: r["id"])
    dest = HERE / "pairs.jsonl"
    with dest.open("w", encoding="utf-8") as f:
        for p in pairs:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
    n_sup = sum(1 for p in pairs if p["kind"] == "support")
    print(f"{dest}: {n_sup} support pairs ({sum(p['label'] for p in pairs if p['kind']=='support')} positive), "
          f"{len(sample)} relevance pairs (of {len(rel)}; per grade {per}: { {g: min(per, len(v)) for g, v in by_grade.items()} })")


if __name__ == "__main__":
    main()
