"""Check that each printed page of an EPUB-built SPDF starts where the source marks the page break.

    python epub_pages.py file.spdf book.epub
For every unit with a printed page, the first words of its text must appear right after the page marker
of that folio in the EPUB content (Gutenberg: span.x-ebookmaker-pageno / ids in the page-list).
"""
import json
import re
import sqlite3
import sys
import unicodedata
import zipfile


def fold(s):
    s = unicodedata.normalize("NFD", s.lower())
    return " ".join(re.findall(r"[a-z0-9]+", "".join(c for c in s if not unicodedata.combining(c))))


z = zipfile.ZipFile(sys.argv[2])
html = "".join(z.read(n).decode("utf-8", "replace") for n in z.namelist() if n.endswith((".xhtml", ".html", ".htm")) and "toc" not in n)
text = re.sub(r"<span[^>]*pageno[^>]*title=\"\[?([^\]\"]+)\]?\"[^>]*>.*?</span>", r" ⟦\1⟧ ", html, flags=re.S)
text = re.sub(r"<[^>]+>", " ", text)
after = {}
for m in re.finditer(r"⟦([^⟧]+)⟧", text):
    after.setdefault(m.group(1), fold(text[m.end():m.end() + 400])[:60])
db = sqlite3.connect(sys.argv[1])
ok = bad = 0
errs = []
for o, a, t in db.execute("SELECT ord, anchor, text FROM units ORDER BY ord"):
    p = json.loads(a).get("printed")
    if not p or p not in after:
        continue
    first = fold(t)[:25]
    if first and after[p].startswith(first[:20]):
        ok += 1
    else:
        bad += 1
        errs.append((o, p, first[:30], after[p][:30]))
print(json.dumps({"file": sys.argv[1], "pages_checked": ok + bad, "correct": ok, "errors": errs[:10]}, ensure_ascii=False))
