"""Scores the judges on judges/pairs.jsonl.

python -I judges/score.py  ->  results/judges.json (+ a Markdown table on stdout)

Support (claim–passage, label = gold passage vs negative): AUC, accuracy at 0.5, Brier, ECE, NLL,
for P(yes) of the yes/no question and for P(APOYO_DIRECTO) of the relation question.
Calibration: temperature fitted by leave-one-claim-out (never on the claim being scored);
for Gemma also the content-free prior correction. Relevance (query–passage, 0-3 grades):
Spearman, AUC for grade >= 2, and pairwise ordering accuracy within each query.
"""
from __future__ import annotations

import json
import math
import os
import statistics
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("SPDF_MODELS_CACHE", Path.home() / ".cache" / "spdf-models"))
OUTS = CACHE / "bench-out" / "judges"
RELS = ["APOYO_DIRECTO", "APLICACION_DE_MARCO", "CONTEXTO", "CONTRADICCION", "IMPOSIBLE_TEMPORAL", "OPINION_REFERIDA",
        "AFIRMACION_NEGATIVA"]


def softmax(z, t=1.0):
    z = np.asarray(z, dtype=np.float64) / t
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def auc(scores, labels):
    s = np.asarray(scores, dtype=float)
    y = np.asarray(labels, dtype=int)
    pos, neg = s[y == 1], s[y == 0]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    gt = (pos[:, None] > neg[None, :]).sum() + 0.5 * (pos[:, None] == neg[None, :]).sum()
    return float(gt / (len(pos) * len(neg)))


def spearman(a, b):
    def rank(x):
        x = np.asarray(x, dtype=float)
        order = x.argsort()
        r = np.empty(len(x))
        r[order] = np.arange(len(x))
        # average ties
        for v in np.unique(x):
            m = x == v
            r[m] = r[m].mean()
        return r
    ra, rb = rank(a), rank(b)
    return float(np.corrcoef(ra, rb)[0, 1])


def ece(p, y, bins=10):
    p, y = np.asarray(p), np.asarray(y)
    e = 0.0
    for i in range(bins):
        m = (p >= i / bins) & (p < (i + 1) / bins if i < bins - 1 else p <= 1)
        if m.any():
            e += m.mean() * abs(p[m].mean() - y[m].mean())
    return float(e)


def binary_metrics(p, y):
    p = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, dtype=int)
    return {"auc": round(auc(p, y), 4), "acc@0.5": round(float(((p >= 0.5) == y).mean()), 4),
            "brier": round(float(((p - y) ** 2).mean()), 4), "ece": round(ece(p, y), 4),
            "nll": round(float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean()), 4)}


def fit_temperature(logits_list, labels, idx_pos=0):
    """T minimising the NLL of P(option idx_pos) on binary labels."""
    best = (1e9, 1.0)
    for t in np.exp(np.linspace(np.log(0.05), np.log(50), 120)):
        p = np.array([softmax(z, t)[idx_pos] for z in logits_list])
        p = np.clip(p, 1e-6, 1 - 1e-6)
        y = np.asarray(labels)
        nll = -(y * np.log(p) + (1 - y) * np.log(1 - p)).mean()
        if nll < best[0]:
            best = (nll, float(t))
    return best[1]


def loco(logits_list, labels, groups, idx_pos=0):
    """Leave-one-claim-out calibrated probabilities."""
    out = np.zeros(len(labels))
    groups = np.asarray(groups)
    for g in np.unique(groups):
        tr = groups != g
        t = fit_temperature([z for z, m in zip(logits_list, tr) if m], np.asarray(labels)[tr], idx_pos)
        for i in np.where(~tr)[0]:
            out[i] = softmax(logits_list[i], t)[idx_pos]
    return out


def load(name):
    rows, priors = {}, None
    for line in (OUTS / f"{name}.jsonl").read_text().splitlines():
        r = json.loads(line)
        if "priors" in r:
            priors = r["priors"]
        else:
            rows[r["id"]] = r
    return rows, priors


def score_engine(name, pairs):
    rows, priors = load(name)
    sup = [p for p in pairs if p["kind"] == "support" and p["id"] in rows]
    rel = [p for p in pairs if p["kind"] == "relevance" and p["id"] in rows]
    res = {"engine": name, "n_support": len(sup), "n_relevance": len(rel),
           "ms_median": round(statistics.median(r["ms"] for r in rows.values()), 1)}
    y = [p["label"] for p in sup]
    groups = [p["id"].split(":")[0] for p in sup]
    if sup:
        if "support_logits" in rows[sup[0]["id"]]:  # Gemma: raw logits
            zs = [np.asarray(rows[p["id"]]["support_logits"]) for p in sup]
            zr = [np.asarray(rows[p["id"]]["relation_logits"]) for p in sup]
            if priors:  # content-free prior correction: subtract the prior log-probs
                lp_s = np.log(softmax(priors["support"]))
                lp_r = np.log(softmax(priors["relation"]))
                zs_pc = [np.log(softmax(z)) - lp_s for z in zs]
                zr_pc = [np.log(softmax(z)) - lp_r for z in zr]
            else:
                zs_pc, zr_pc = zs, zr
        else:  # Valen: probabilities -> log-probs (temperature scaling is the same on log p)
            zs = [np.log(np.clip([rows[p["id"]]["supported"], 1 - rows[p["id"]]["supported"]], 1e-9, 1)) for p in sup]
            zr = [np.log(np.clip([rows[p["id"]]["relation"][k] for k in RELS], 1e-9, 1)) for p in sup]
            zs_pc, zr_pc = zs, zr
        res["support_yesno_raw"] = binary_metrics([softmax(z)[0] for z in zs], y)
        res["support_yesno_loco_T"] = binary_metrics(loco(zs, y, groups), y)
        res["support_relation_raw"] = binary_metrics([softmax(z)[0] for z in zr], y)
        res["support_relation_loco_T"] = binary_metrics(loco(zr, y, groups), y)
        if priors:
            res["support_yesno_prior_loco_T"] = binary_metrics(loco(zs_pc, y, groups), y)
            res["support_relation_prior_loco_T"] = binary_metrics(loco(zr_pc, y, groups), y)
        res["temperature_yesno"] = round(fit_temperature(zs, y), 3)
        res["temperature_relation"] = round(fit_temperature(zr, y), 3)
        # predicted relation distribution on gold vs negative passages
        lab = lambda z: RELS[int(np.argmax(z))]  # noqa: E731
        res["relation_on_gold"] = {k: sum(1 for p, z in zip(sup, zr) if p["label"] == 1 and lab(z) == k) for k in RELS}
        res["relation_on_negative"] = {k: sum(1 for p, z in zip(sup, zr) if p["label"] == 0 and lab(z) == k) for k in RELS}
    if rel:
        if "relevance_logits" in rows[rel[0]["id"]]:
            pr = [softmax(rows[p["id"]]["relevance_logits"]) for p in rel]
            pred = [float(np.dot(q, np.arange(4)) / 3) for q in pr]
        else:
            pred = [rows[p["id"]]["relevance"] for p in rel]
        gold = [p["grade"] for p in rel]
        res["relevance_spearman"] = round(spearman(pred, gold), 4)
        res["relevance_auc_ge2"] = round(auc(pred, [int(g >= 2) for g in gold]), 4)
        ok = tot = 0
        by_q = {}
        for p, s in zip(rel, pred):
            by_q.setdefault(p["qid"], []).append((p["grade"], s))
        for lst in by_q.values():
            for i in range(len(lst)):
                for j in range(i + 1, len(lst)):
                    if lst[i][0] != lst[j][0]:
                        tot += 1
                        ok += (lst[i][1] - lst[j][1]) * (lst[i][0] - lst[j][0]) > 0
        res["relevance_pairwise_acc"] = round(ok / tot, 4) if tot else None
    return res


def main():
    pairs = [json.loads(l) for l in (HERE / "pairs.jsonl").read_text().splitlines() if l.strip()]
    names = sys.argv[1:] or sorted(p.stem for p in OUTS.glob("*.jsonl"))
    results = [score_engine(n, pairs) for n in names]
    (HERE.parent / "results" / "judges.json").write_text(json.dumps(results, indent=1, ensure_ascii=False) + "\n")
    print("| Juez | pares | AUC sí/no | AUC relación | Brier sí/no (T) | ECE sí/no (T) | Spearman relevancia | AUC relev. ≥2 | orden por pares | ms/par |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in results:
        s1, s2 = r.get("support_yesno_loco_T", {}), r.get("support_relation_loco_T", {})
        print(f"| {r['engine']} | {r['n_support']}+{r['n_relevance']} | {s1.get('auc','')} | {s2.get('auc','')} | {s1.get('brier','')} | "
              f"{s1.get('ece','')} | {r.get('relevance_spearman','')} | {r.get('relevance_auc_ge2','')} | {r.get('relevance_pairwise_acc','')} | {r['ms_median']} |")


if __name__ == "__main__":
    main()
