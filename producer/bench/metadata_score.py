"""Score the bibliographic record of a SPDF against a hand-made truth.  python metadata_score.py file.spdf work"""
import json
import re
import sqlite3
import sys
import unicodedata
from pathlib import Path


def f(s):
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return re.sub(r"[^a-z0-9 ]+", " ", "".join(c for c in s if not unicodedata.combining(c))).split()


truth = json.loads((Path(__file__).parent / "metadata_truth.json").read_text("utf-8"))[sys.argv[2]]
db = sqlite3.connect(sys.argv[1])
md = json.loads(db.execute("SELECT metadata FROM documents").fetchone()[0])
res = {}
if "title" in truth:
    res["title"] = " ".join(f(truth["title"])) in " ".join(f(md.get("title")))
if "family" in truth:
    a = (md.get("author") or [{}])[0]
    res["author"] = " ".join(f(truth["family"])) in " ".join(f(a.get("family") or a.get("literal")))
if "year" in truth:
    try:
        res["year"] = md["issued"]["date-parts"][0][0] == truth["year"]
    except Exception:
        res["year"] = False
for k, csl in (("place", "publisher-place"), ("publisher", "publisher"), ("container", "container-title")):
    if k in truth:
        res[k] = " ".join(f(truth[k])) in " ".join(f(md.get(csl)))
if "language" in truth:
    res["language"] = (md.get("language") or "").split("-")[0] == truth["language"]
if "type" in truth:
    res["type"] = md.get("type") in truth["type"]
if "DOI" in truth:
    res["DOI"] = (md.get("DOI") or "").lower() == truth["DOI"]
if "speaker" in truth:
    sp = {json.loads(a).get("speaker") for (a,) in db.execute("SELECT anchor FROM units")}
    res["speaker"] = truth["speaker"] in sp
print(json.dumps({"file": sys.argv[1], "score": f"{sum(res.values())}/{len(res)}", "fields": res}, ensure_ascii=False))
