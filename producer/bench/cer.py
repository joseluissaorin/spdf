"""Character and word error rate of one page read by a page reader, against a hand transcription.

    python cer.py reading.json <physical page> reference.txt
`reading.json` is what `spdf-build build --save-reading` writes. Titles (# lines) are left out. Two measures:
exact (case and accents count) and folded (lowercase, no accents, no punctuation). Also counts long s read
as «f» (a word with f where the reference has s).
"""
import json
import re
import sys
import unicodedata


def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def body(t):
    return " ".join(l for l in t.split("\n") if not l.strip().startswith("#"))


def norm(t):
    return re.sub(r"\s+", " ", t).strip()


def fold(t):
    t = unicodedata.normalize("NFD", t.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", t)).strip()


units = {u["ord"]: u for u in json.load(open(sys.argv[1]))["units"]}
hyp = norm(body(units[int(sys.argv[2])]["text"]))
ref = norm(open(sys.argv[3], encoding="utf-8").read())
fh, fr = fold(hyp), fold(ref)
wh, wr = fh.split(), fr.split()
long_s = sum(1 for w in wh if "f" in w and w.replace("f", "s") in set(wr) and w not in set(wr))
print(json.dumps({"reading": sys.argv[1], "page": int(sys.argv[2]), "ref_chars": len(ref),
                  "cer_exact": round(lev(hyp, ref) / len(ref), 4), "cer_folded": round(lev(fh, fr) / len(fr), 4),
                  "wer_folded": round(lev(wh, wr) / len(wr), 4), "long_s_as_f": long_s}))
