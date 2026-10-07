"""Folio accuracy of a SPDF against a hand-made truth: python folio_truth.py file.spdf truth.json"""
import json
import sqlite3
import sys

db = sqlite3.connect(sys.argv[1])
truth = {int(k): v for k, v in json.load(open(sys.argv[2])).items()}
rows = {o: json.loads(a) for o, a in db.execute("SELECT ord, anchor FROM units ORDER BY ord")}
ok = bad = 0
errs = []
by_source = {}
for o, t in sorted(truth.items()):
    a = rows.get(o, {})
    got = a.get("printed")
    good = (got or None) == (t or None)
    ok += good
    bad += not good
    s = a.get("source")
    by_source.setdefault(s, [0, 0])[0 if good else 1] += 1
    if not good:
        errs.append((o, got, t, s))
print(json.dumps({"file": sys.argv[1], "checked": len(truth), "correct": ok, "accuracy": round(ok / max(1, len(truth)), 4),
                  "by_source": by_source, "errors": errs[:30]}, ensure_ascii=False))
