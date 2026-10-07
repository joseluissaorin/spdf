"""Word error rate of the transcript of a SPDF against the reference text.

    python wer.py file.spdf reference.txt

Both sides are folded (lowercase, no diacritics, no punctuation): 1902 spelling («á», «vió») and the ASR's modern
spelling should not count as errors. The LibriVox preamble and outro, which are not in the book, are cut off by
aligning the first and last matching runs of words.
"""
import difflib
import json
import re
import sqlite3
import sys
import unicodedata


def fold(s: str) -> list[str]:
    s = s.replace("_", " ").replace("--", " ")
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.findall(r"[a-z0-9ñ]+", s.replace("ñ", "ñ"))


def edit(a: list[str], b: list[str]) -> tuple[int, int, int]:
    """(substitutions, deletions, insertions) turning reference a into hypothesis b."""
    n, m = len(a), len(b)
    prev = list(range(m + 1))
    ops_prev = [(0, 0, j) for j in range(m + 1)]
    for i in range(1, n + 1):
        cur = [i] + [0] * m
        ops = [(0, i, 0)] + [None] * m
        ai = a[i - 1]
        for j in range(1, m + 1):
            if ai == b[j - 1]:
                cur[j], ops[j] = prev[j - 1], ops_prev[j - 1]
                continue
            s, d, ins = prev[j - 1], prev[j], cur[j - 1]
            if s <= d and s <= ins:
                cur[j] = s + 1
                o = ops_prev[j - 1]
                ops[j] = (o[0] + 1, o[1], o[2])
            elif d <= ins:
                cur[j] = d + 1
                o = ops_prev[j]
                ops[j] = (o[0], o[1] + 1, o[2])
            else:
                cur[j] = ins + 1
                o = ops[j - 1]
                ops[j] = (o[0], o[1], o[2] + 1)
        prev, ops_prev = cur, ops
    return ops_prev[m]


db = sqlite3.connect(sys.argv[1])
hyp_raw = " ".join(re.sub(r"\*\*[^*]+:\*\*", " ", t) for (t,) in db.execute("SELECT text FROM units ORDER BY ord"))
ref = fold(open(sys.argv[2], encoding="utf-8").read())
hyp_all = fold(hyp_raw)
sm = difflib.SequenceMatcher(None, ref, hyp_all, autojunk=False)
blocks = [b for b in sm.get_matching_blocks() if b.size >= 4]
start = max(0, blocks[0].b - blocks[0].a - 5)
end = min(len(hyp_all), blocks[-1].b + blocks[-1].size + (len(ref) - blocks[-1].a - blocks[-1].size) + 5)
hyp = hyp_all[start:end]
s, d, i = edit(ref, hyp)
print(json.dumps({"file": sys.argv[1], "ref_words": len(ref), "hyp_words": len(hyp), "outside_text": len(hyp_all) - len(hyp),
                  "substitutions": s, "deletions": d, "insertions": i, "wer": round((s + d + i) / len(ref), 4)}))
