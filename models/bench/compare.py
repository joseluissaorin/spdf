"""Space compatibility and speed tables from the bench vectors.

python -I compare.py [--ref st-f32-cpu]  ->  results/compat.json, results/TABLAS.md

Per engine and modality: cosine with the reference vector of the same input (mean, p5, min),
also after Matryoshka truncation to 512/256/128 (both sides truncated and re-normalised).
Retrieval agreement (the case that matters for a reader mixing engines): the 40 queries against
the 290 passages, top-10 overlap with the reference ranking when (a) the engine embeds both sides,
(b) the engine embeds only the queries and the corpus is the reference's, (c) the other way round.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402

from common import RESULTS, VECTORS, load_texts, load_vectors  # noqa: E402

DIMS = [768, 512, 256, 128]


def unit(m: np.ndarray, d: int) -> np.ndarray:
    m = np.asarray(m, dtype=np.float64)[:, :d]
    return m / np.linalg.norm(m, axis=1, keepdims=True)


def cos_stats(a: np.ndarray, b: np.ndarray) -> dict:
    c = (a * b).sum(1)
    return {"n": int(len(c)), "mean": round(float(c.mean()), 5), "p5": round(float(np.percentile(c, 5)), 5),
            "min": round(float(c.min()), 5)}


def topk(q: np.ndarray, docs: np.ndarray, k=10) -> np.ndarray:
    return np.argsort(-(q @ docs.T), axis=1, kind="stable")[:, :k]


def overlap(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean([len(set(x) & set(y)) / len(x) for x, y in zip(a, b)]))


def top3_in_top10(ref_top: np.ndarray, eng_top: np.ndarray) -> float:
    """Share of the reference's 3 best passages that the engine still ranks in its top 10."""
    return float(np.mean([len(set(x[:3]) & set(y[:10])) / 3 for x, y in zip(ref_top, eng_top)]))


def i8_storage(v: np.ndarray) -> np.ndarray:
    """The contract's i8 (q = round(v*127), value = q/127)."""
    return np.clip(np.sign(v) * np.floor(np.abs(v) * 127 + 0.5), -127, 127) / 127


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default="st-f32-cpu")
    a = ap.parse_args()
    ref = load_vectors(a.ref)
    texts = load_texts()
    q_ids = [t.id for t in texts if t.kind == "query"]
    d_ids = [t.id for t in texts if t.kind == "passage"]
    engines = sorted(p.stem for p in VECTORS.glob("*.npz") if p.stem != a.ref)
    out = {"reference": a.ref, "engines": {}}
    for eng in engines:
        v = load_vectors(eng)
        res = {}
        for mod in ("text", "image", "audio"):
            if mod not in v or mod not in ref:
                continue
            ids = [i for i in ref[mod] if i in v[mod]]
            if len(ids) < len(ref[mod]):
                res[f"{mod}_missing"] = len(ref[mod]) - len(ids)
            R = np.stack([ref[mod][i] for i in ids])
            E = np.stack([v[mod][i] for i in ids])
            if not np.isfinite(E).all():
                res[mod] = {"nan": int((~np.isfinite(E)).any(1).sum())}
                continue
            res[mod] = {str(d): cos_stats(unit(R, d), unit(E, d)) for d in DIMS}
        if "text" in v and all(i in v["text"] for i in q_ids + d_ids) and np.isfinite(np.stack(list(v["text"].values()))).all():
            ret = {}
            for d in DIMS:
                rq, rd = unit(np.stack([ref["text"][i] for i in q_ids]), d), unit(np.stack([ref["text"][i] for i in d_ids]), d)
                eq, ed = unit(np.stack([v["text"][i] for i in q_ids]), d), unit(np.stack([v["text"][i] for i in d_ids]), d)
                base = topk(rq, rd)
                ret[str(d)] = {"both": round(overlap(base, topk(eq, ed)), 4), "query_only": round(overlap(base, topk(eq, rd)), 4),
                               "corpus_only": round(overlap(base, topk(rq, ed)), 4),
                               "top3_in_top10_query_only": round(top3_in_top10(base, topk(eq, rd)), 4)}
            res["retrieval_top10_overlap"] = ret
        out["engines"][eng] = res
    # MRL baseline: reference against itself truncated (how much ranking truncation alone changes)
    rq = np.stack([ref["text"][i] for i in q_ids])
    rd = np.stack([ref["text"][i] for i in d_ids])
    out["mrl_self_overlap_vs_768"] = {str(d): round(overlap(topk(unit(rq, 768), unit(rd, 768)), topk(unit(rq, d), unit(rd, d))), 4) for d in DIMS}
    # storage dtypes of the contract applied to the reference corpus (query stays f32)
    out["storage"] = {}
    for name, f in (("f16", lambda m: m.astype(np.float16).astype(np.float64)), ("i8", i8_storage)):
        row = {}
        for d in DIMS:
            rq_, rd_ = unit(rq, d), unit(rd, d)
            st = f(rd_)
            c = (rd_ * (st / np.linalg.norm(st, axis=1, keepdims=True))).sum(1)
            row[str(d)] = {"cos_mean": round(float(c.mean()), 6), "cos_p5": round(float(np.percentile(c, 5)), 6),
                           "top10_overlap": round(overlap(topk(rq_, rd_), topk(rq_, st)), 4),
                           "top3_in_top10": round(top3_in_top10(topk(rq_, rd_), topk(rq_, st)), 4)}
        out["storage"][name] = row
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "compat.json").write_text(json.dumps(out, indent=1) + "\n")

    # ---------------- Markdown
    lines = [f"Referencia: `{a.ref}` (sentence-transformers 6.1, PyTorch f32, CPU). Coseno con el vector de referencia del mismo elemento.", ""]
    lines += ["| Motor | texto media | texto p5 | texto mín | imagen media | imagen p5 | audio media | audio p5 | top-10 ambos | top-10 solo consulta | top-3 en top-10 |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
    for eng, r in out["engines"].items():
        t = r.get("text", {}).get("768", {})
        im = r.get("image", {}).get("768", {})
        au = r.get("audio", {}).get("768", {})
        ov = r.get("retrieval_top10_overlap", {}).get("768", {})
        f = lambda d, k: (f"{d[k]:.4f}" if isinstance(d.get(k), float) else ("NaN" if "nan" in d else "")) if d is not None else ""  # noqa: E731
        lines.append(f"| {eng} | {f(t,'mean')} | {f(t,'p5')} | {f(t,'min')} | {f(im,'mean')} | {f(im,'p5')} | {f(au,'mean')} | {f(au,'p5')} | "
                     f"{ov.get('both','')} | {ov.get('query_only','')} | {ov.get('top3_in_top10_query_only','')} |")
    lines += ["", "Recortes Matryoshka (texto, coseno medio / p5 con la referencia recortada igual):", "",
              "| Motor | 512 | 256 | 128 |", "|---|---|---|---|"]
    for eng, r in out["engines"].items():
        t = r.get("text", {})
        if "512" in t:
            lines.append(f"| {eng} | " + " | ".join(f"{t[d]['mean']:.4f} / {t[d]['p5']:.4f}" for d in ("512", "256", "128")) + " |")
    lines += ["", "Almacenamiento del contrato aplicado a los vectores de referencia (consulta en f32):", "",
              "| dtype | dims | coseno medio | coseno p5 | solape top-10 | top-3 en top-10 |", "|---|---|---|---|---|---|"]
    for name, row in out["storage"].items():
        for d, x in row.items():
            lines.append(f"| {name} | {d} | {x['cos_mean']:.6f} | {x['cos_p5']:.6f} | {x['top10_overlap']} | {x['top3_in_top10']} |")
    lines += ["", "Solape top-10 de la propia referencia recortada frente a 768: " +
              ", ".join(f"{d} → {v}" for d, v in out["mrl_self_overlap_vs_768"].items())]
    # latency table
    lines += ["", "| Motor | texto corto | texto medio | texto largo | consulta | imagen | audio 10 s | memoria pico | carga |",
              "|---|---|---|---|---|---|---|---|---|"]
    for p in sorted(RESULTS.glob("*.json")):
        if p.stem in ("compat", "judges", "gen"):
            continue
        r = json.loads(p.read_text())
        if "latency" not in r:
            continue
        L = r["latency"]
        g = lambda k: f"{L[k]['median_ms']:.0f}" if k in L else ""  # noqa: E731
        mem = r.get("memory", {}).get("peak_mb")
        lines.append(f"| {r['engine']} | {g('text_short')} | {g('text_medium')} | {g('text_long')} | {g('text_query')} | {g('image')} | "
                     f"{g('audio_10s')} | {mem if mem else ''} MB | {r.get('meta', {}).get('load_s', '')} s |")
    (RESULTS / "TABLAS.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
