"""Bibliographic record (CSL-JSON + "spdf" extension) with provenance per field.

Sources, fused field by field (the highest confidence wins; what the user
passes on the command line always wins):

- embedded metadata: PDF info, EPUB OPF, HTML meta tags, ID3 tags (0.55-0.75);
- credits and colophon read without a model: ISBN with check digit, DOI,
  arXiv id, imprint years (0.7-0.9);
- the LLM reading the first and last pages (0.8): title, authors, translators,
  editors, year of the edition and of the work, publisher or printer, place,
  container, edition statement, CSL type and language;
- open catalogues when there is network and not `--offline`: Crossref (by DOI,
  else bibliographic query that must match title and author), OpenAlex (by DOI
  or title; ORCID of authors, never before 1990, as Scholaris learnt with C. S.
  Lewis) with `OPENALEX_API_KEY` from the environment if present, and Open
  Library (by ISBN, else title+author search; `first_publish_year` only from
  1830 on, before that it catalogues single editions).

Port of the logic in Scholaris `packages/ingesta` (METADATOS.md), simplified.
"""
from __future__ import annotations

import os
import re
import urllib.parse
from typing import Any, Optional

from .. import net
from ..text import fold, similarity

PARTICLES = {"de", "del", "de la", "de las", "de los", "da", "das", "do", "dos", "di", "du", "van", "von", "van der", "van den",
             "der", "le", "la", "y"}

CSL_BY_KIND = {"audio": "speech", "video": "motion_picture", "web": "webpage", "slides": "speech", "sheet": "dataset",
               "image": "graphic", "photos": "graphic"}


def parse_name(raw: str, lang: Optional[str] = None) -> dict:
    s = re.sub(r"\s+", " ", (raw or "").strip().strip(",;"))
    s = re.sub(r"\s*\(\d{3,4}\s*[-–]\s*\d{0,4}\)\s*$", "", s)  # «Unamuno, Miguel de (1864-1936)»
    s = re.sub(r",\s*\d{3,4}-\d{0,4}\.?$", "", s)
    if not s:
        return {}
    if re.search(r"\b(inc|ltd|institute|university|universidad|national|agency|press|society|academia|real academia)\b", s, re.I):
        return {"literal": s}
    if "," in s:
        fam, giv = [x.strip() for x in s.split(",", 1)]
        m = re.match(r"^(.*?)\s+((?:de|del|de la|da|di|du|van|von)(?:\s+(?:la|los|las|der|den))?)$", giv, re.I)
        out = {"family": fam, "given": giv}
        if m:
            out = {"family": fam, "given": m.group(1), "dropping-particle": m.group(2)}
        return out
    toks = s.split(" ")
    if len(toks) == 1:
        return {"family": s}
    for i in range(1, len(toks) - 1):
        two = " ".join(toks[i:i + 2]).lower()
        if two in PARTICLES and i + 2 < len(toks):
            return {"given": " ".join(toks[:i]), "dropping-particle": " ".join(toks[i:i + 2]), "family": " ".join(toks[i + 2:])}
        if toks[i].lower() in PARTICLES and toks[i].islower():
            return {"given": " ".join(toks[:i]), "dropping-particle": toks[i], "family": " ".join(toks[i + 1:])}
    if (lang or "").startswith(("es", "pt", "ca", "gl")) and len(toks) >= 3:
        k = len(toks) - 2
        return {"given": " ".join(toks[:k]), "family": " ".join(toks[k:])}
    return {"given": " ".join(toks[:-1]), "family": toks[-1]}


def family_of(a: dict) -> str:
    return a.get("literal") or a.get("family") or a.get("given") or ""


# ---------------------------------------------------------------------------
# Identifiers in the text
# ---------------------------------------------------------------------------


def isbn_ok(s: str) -> bool:
    d = re.sub(r"[^\dX]", "", s.upper())
    if len(d) == 13 and d.isdigit():
        return sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(d)) % 10 == 0
    if len(d) == 10:
        tot = sum((10 - i) * (10 if c == "X" else int(c)) for i, c in enumerate(d) if c.isdigit() or c == "X")
        return tot % 11 == 0
    return False


def find_ids(text: str) -> dict:
    out: dict = {}
    for m in re.finditer(r"ISBN(?:-1[03])?:?\s*((?:97[89][\s-]?)?(?:\d[\s-]?){9}[\dX])", text, re.I):
        cand = re.sub(r"[\s-]", "", m.group(1))
        if isbn_ok(cand):
            out.setdefault("ISBN", cand)
    m = re.search(r"\b(10\.\d{4,9}/[^\s\"<>,;]+[^\s\"<>,;.)\]])", text)
    if m:
        out["DOI"] = m.group(1)
    m = re.search(r"arXiv:\s?(\d{4}\.\d{4,5})(v\d+)?", text)
    if m:
        out["arxiv"] = m.group(1)
    return out


# ---------------------------------------------------------------------------
# LLM reading of the credits
# ---------------------------------------------------------------------------

RECORD_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"}, "subtitle": {"type": "string"},
        "authors": {"type": "array", "items": {"type": "object", "properties": {
            "given": {"type": "string"}, "family": {"type": "string"}}, "required": ["given", "family"]}},
        "editors": {"type": "array", "items": {"type": "string"}},
        "translators": {"type": "array", "items": {"type": "string"}},
        "year": {"type": "integer"}, "original_year": {"type": "integer"},
        "publisher": {"type": "string"}, "place": {"type": "string"},
        "container": {"type": "string"}, "collection": {"type": "string"}, "edition": {"type": "string"},
        "csl_type": {"type": "string"}, "language": {"type": "string"}, "original_language": {"type": "string"},
        "doi": {"type": "string"}, "isbn": {"type": "string"},
    },
    "required": ["title", "authors", "language", "csl_type"],
}

RECORD_SYSTEM = (
    "You are a rare-books cataloguer. From the first and last pages of a document (title page, credits, colophon, "
    "imprint) you write its bibliographic record. Only what the pages support; empty or omitted fields when unknown. "
    "title = main title as printed (modern capitalization, keep the original spelling); subtitle apart. authors = "
    "persons responsible for the content (given + family as cited in that language's practice; for Spanish names keep "
    "both surnames in family, and a particle like «de» goes with given only when it is not part of how the name is cited). "
    "year = year of THIS edition or printing (from the imprint, «Año de 1737», the colophon or ©); original_year = first "
    "publication of the work if different and stated. publisher = publisher or printer (for old books, the printer as "
    "named: «Imprenta de Antonio Villargordo»); place = city of publication. csl_type: book, chapter, article-journal, "
    "paper-conference, report, thesis, webpage, speech, song, motion_picture, broadcast, interview, manuscript. "
    "language = BCP-47 of the text."
)


def llm_record(llm, units, kind: str, hint: str = "") -> tuple[dict, dict]:
    texts = [u for u in units if (u.text or "").strip()]
    first = texts[:5]
    last = texts[-3:] if len(texts) > 8 else []
    parts = []
    for u in first + [u for u in last if u not in first]:
        loc = u.anchor.get("printed") or u.ord if u.anchor else u.ord
        parts.append(f"<page n=\"{u.ord}\" printed=\"{loc}\">\n{(u.header + chr(10)) if u.header else ''}{u.text[:3500]}\n"
                     f"{u.footer or ''}\n</page>")
    prompt = (f"Kind of source: {kind}. {hint}\n\n" + "\n".join(parts) +
              "\n\nWrite the bibliographic record as JSON.")
    r = llm.json(RECORD_SYSTEM, prompt, RECORD_SCHEMA, max_tokens=2048, temperature=0.0)
    return (r if isinstance(r, dict) else {}), {"pages": [u.ord for u in first + last]}


# ---------------------------------------------------------------------------
# Catalogues
# ---------------------------------------------------------------------------

def _mailto() -> str:
    return os.environ.get("SPDF_CONTACT_EMAIL", "")


def crossref_doi(doi: str) -> Optional[dict]:
    q = f"?mailto={urllib.parse.quote(_mailto())}" if _mailto() else ""
    r = net.get_json(f"https://api.crossref.org/works/{urllib.parse.quote(doi)}{q}", timeout=10)
    return (r or {}).get("message")


def crossref_search(title: str, author: str) -> Optional[dict]:
    q = urllib.parse.urlencode({"query.bibliographic": title, "query.author": author, "rows": 3,
                                **({"mailto": _mailto()} if _mailto() else {})})
    r = net.get_json(f"https://api.crossref.org/works?{q}", timeout=10)
    for it in ((r or {}).get("message") or {}).get("items", []):
        t = (it.get("title") or [""])[0]
        fams = [a.get("family", "") for a in it.get("author", [])]
        if similarity(t, title) >= 0.85 and (not author or any(similarity(f, author) > 0.8 for f in fams)):
            return it
    return None


def openalex(doi: Optional[str], title: Optional[str]) -> Optional[dict]:
    key = os.environ.get("OPENALEX_API_KEY")
    extra = f"&api_key={urllib.parse.quote(key)}" if key else ""
    if doi:
        r = net.get_json(f"https://api.openalex.org/works/https://doi.org/{urllib.parse.quote(doi)}?select=id,doi,title,publication_year,authorships,language,type{extra}", timeout=10)
        return r
    if title:
        r = net.get_json(f"https://api.openalex.org/works?search={urllib.parse.quote(title)}&per-page=3&select=id,doi,title,publication_year,authorships,language,type{extra}", timeout=10)
        for it in (r or {}).get("results", []):
            if similarity(it.get("title") or "", title) >= 0.9:
                return it
    return None


def openlibrary_isbn(isbn: str) -> Optional[dict]:
    r = net.get_json(f"https://openlibrary.org/isbn/{isbn}.json", timeout=10)
    return r


def openlibrary_search(title: str, author: str) -> Optional[dict]:
    q = urllib.parse.urlencode({"title": title, "author": author, "limit": 5,
                                "fields": "key,title,author_name,first_publish_year,publisher,publish_place,language"})
    r = net.get_json(f"https://openlibrary.org/search.json?{q}", timeout=10)
    for d in (r or {}).get("docs", []):
        if similarity(d.get("title") or "", title) >= 0.85 and (not author or any(similarity(fold(a).split()[-1] if fold(a) else "", fold(author).split()[-1] if fold(author) else "") > 0.8 for a in d.get("author_name") or [])):
            return d
    return None


# ---------------------------------------------------------------------------
# Fusion
# ---------------------------------------------------------------------------


class Record:
    def __init__(self):
        self.fields: dict[str, Any] = {}
        self.prov: dict[str, dict] = {}

    def put(self, key: str, value: Any, source: str, confidence: float, force: bool = False):
        if isinstance(value, str):
            value = re.sub(r"\s+", " ", value).strip()
        if value in (None, "", [], {}):
            return
        cur = self.prov.get(key)
        if force or cur is None or confidence > cur["confidence"] + 1e-9:
            self.fields[key] = value
            self.prov[key] = {"source": source, "confidence": round(confidence, 3)}


def _year(s: Any) -> Optional[int]:
    if isinstance(s, int):
        return s if 0 < s < 2200 else None
    m = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", str(s or ""))
    return int(m.group(1)) if m else None


def build_metadata(source, units, kind: str, language: Optional[str], llm=None, online: bool = True,
                   user: Optional[dict] = None, log=None) -> tuple[dict, list[dict]]:
    """Returns (CSL item with "spdf" extension, provenance entries)."""
    rec = Record()
    events: list[dict] = []
    h = source.hints or {}
    # 1. embedded
    emb = 0.6 if kind in ("pdf", "scanned_pdf") else 0.75
    title_h = h.get("title")
    if title_h and not re.fullmatch(r"(untitled|microsoft word.*|document\d*|.*\.(docx?|pdf|tex))", title_h, re.I):
        rec.put("title", title_h, "embedded", emb)
    if h.get("authors"):
        rec.put("author", [parse_name(a, language) for a in h["authors"]], "embedded", emb)
    elif h.get("author_raw"):
        parts = re.split(r"\s*(?:;|\band\b|&|, (?=[A-Z][a-z]+ [A-Z]))\s*", h["author_raw"])
        rec.put("author", [parse_name(a, language) for a in parts if a.strip()], "embedded", emb - 0.1 if kind not in ("audio", "video") else 0.5)
    if h.get("language"):
        rec.put("language", h["language"], "embedded", emb)
    if h.get("publisher") and kind not in ("epub",):
        rec.put("publisher", h["publisher"], "embedded", emb - 0.1)
    if h.get("date") and kind not in ("epub",):  # Gutenberg's date is the e-text release, not the work
        y = _year(h["date"])
        if y:
            rec.put("issued", {"date-parts": [[y]]}, "embedded", emb - 0.15)
    if h.get("url"):
        rec.put("URL", h["url"], "embedded", 0.9)
    if h.get("isbn") and isbn_ok(h["isbn"]):
        rec.put("ISBN", h["isbn"], "embedded", 0.9)
    if h.get("doi"):
        rec.put("DOI", h["doi"], "embedded", 0.85)
    if h.get("container"):
        rec.put("container-title", h["container"], "embedded", 0.7)
    if h.get("performer"):
        rec.put("_performer", h["performer"], "embedded", 0.7)
    if h.get("accessed"):
        rec.put("accessed", {"date-parts": [[int(x) for x in h["accessed"].split("-")]]}, "fetch", 1.0)
    # 2. identifiers in the first and last pages
    sample = "\n".join((u.text or "")[:6000] + "\n" + (u.footer or "") for u in (units[:12] + units[-3:]))
    ids = find_ids(sample)
    if ids.get("ISBN"):
        rec.put("ISBN", ids["ISBN"], "colophon", 0.9)
    if ids.get("DOI"):
        rec.put("DOI", ids["DOI"], "colophon", 0.85)
    if ids.get("arxiv"):
        rec.put("URL", f"https://arxiv.org/abs/{ids['arxiv']}", "colophon", 0.85)
    # 3. LLM
    if llm is not None and units:
        try:
            r, det = llm_record(llm, units, kind, hint=f"File name: {os.path.basename(source.path or '') or 'unknown'}.")
            name = getattr(llm, "name", "llm")
            c = 0.8
            title = (r.get("title") or "").strip()
            if title:
                rec.put("title", title, name, c)
                if r.get("subtitle"):
                    rec.put("_subtitle", r["subtitle"].strip(), name, c)
            auths = [a for a in (r.get("authors") or []) if isinstance(a, dict) and (a.get("family") or a.get("given"))]
            if auths:
                rec.put("author", [{k: v.strip() for k, v in a.items() if isinstance(v, str) and v.strip()} for a in auths], name, c)
            for k, csl in (("editors", "editor"), ("translators", "translator")):
                if r.get(k):
                    rec.put(csl, [parse_name(x, language) for x in r[k] if isinstance(x, str) and x.strip()], name, c)
            y = _year(r.get("year"))
            if y:
                rec.put("issued", {"date-parts": [[y]]}, name, c)
            oy = _year(r.get("original_year"))
            if oy and (not y or oy < y):
                rec.put("original-date", {"date-parts": [[oy]]}, name, c - 0.1)
            for k, csl in (("publisher", "publisher"), ("place", "publisher-place"), ("container", "container-title"),
                           ("collection", "collection-title"), ("edition", "edition")):
                if (r.get(k) or "").strip():
                    rec.put(csl, r[k].strip(), name, c - 0.05)
            if (r.get("csl_type") or "").strip():
                rec.put("type", r["csl_type"].strip(), name, 0.7)
            if (r.get("language") or "").strip():
                rec.put("language", r["language"].strip(), name, 0.75)
            if (r.get("original_language") or "").strip():
                rec.put("_original_language", r["original_language"].strip(), name, 0.7)
            if r.get("isbn") and isbn_ok(r["isbn"]):
                rec.put("ISBN", re.sub(r"[^\dX]", "", r["isbn"].upper()), name, 0.85)
            if (r.get("doi") or "").startswith("10."):
                rec.put("DOI", r["doi"].strip(), name, 0.8)
            events.append({"stage": "metadata", "provider": name, "model": getattr(llm, "model", None), "detail": det})
        except Exception as e:  # the record is still built from the other sources
            events.append({"stage": "metadata", "provider": getattr(llm, "name", "llm"), "detail": {"error": str(e)[:300]}})
    # 4. catalogues
    if online:
        title = rec.fields.get("title")
        authors = rec.fields.get("author") or []
        fam = family_of(authors[0]) if authors else ""
        doi = rec.fields.get("DOI")
        tried = []
        try:
            cr = crossref_doi(doi) if doi else (crossref_search(title, fam) if title and kind in ("pdf",) else None)
            tried.append("crossref")
            if cr:
                ok = bool(doi) or True
                c = 0.95 if doi else 0.85
                if ok:
                    t = (cr.get("title") or [None])[0]
                    if t:
                        sub = (cr.get("subtitle") or [None])[0]
                        rec.put("title", t, "crossref", c)
                        if sub:
                            rec.put("_subtitle", sub, "crossref", c)
                    if cr.get("author"):
                        rec.put("author", [{k: a[k] for k in ("given", "family", "literal") if a.get(k)} or {"literal": a.get("name", "")}
                                           for a in cr["author"]], "crossref", c)
                    y = ((cr.get("issued") or {}).get("date-parts") or [[None]])[0][0]
                    if y:
                        rec.put("issued", {"date-parts": [[int(y)]]}, "crossref", c)
                    if cr.get("publisher"):
                        rec.put("publisher", cr["publisher"], "crossref", c - 0.05)
                    if cr.get("container-title"):
                        rec.put("container-title", cr["container-title"][0], "crossref", c)
                    if cr.get("type"):
                        t = {"journal-article": "article-journal", "proceedings-article": "paper-conference", "book-chapter": "chapter",
                             "monograph": "book", "report": "report", "book": "book", "dissertation": "thesis",
                             "posted-content": "article", "standard": "standard"}.get(cr["type"], None)
                        if t:
                            rec.put("type", t, "crossref", 0.9)
                    if cr.get("DOI"):
                        rec.put("DOI", cr["DOI"], "crossref", 0.97)
                    if cr.get("URL"):
                        rec.put("URL", cr["URL"], "crossref", 0.8)
        except Exception as e:
            events.append({"stage": "metadata", "provider": "crossref", "detail": {"error": str(e)[:200]}})
        try:
            year = ((rec.fields.get("issued") or {}).get("date-parts") or [[None]])[0][0]
            if (doi or title) and (not year or year >= 1990) and kind in ("pdf", "web", "document"):
                oa = openalex(rec.fields.get("DOI"), title if not doi else None)
                tried.append("openalex")
                if oa:
                    orcid = {}
                    for au in oa.get("authorships") or []:
                        a = au.get("author") or {}
                        if a.get("orcid") and a.get("display_name"):
                            orcid[a["display_name"]] = a["orcid"].rsplit("/", 1)[-1]
                    if orcid:
                        rec.put("_orcid", orcid, "openalex", 0.85)
                    if oa.get("language"):
                        rec.put("language", oa["language"], "openalex", 0.7)
        except Exception as e:
            events.append({"stage": "metadata", "provider": "openalex", "detail": {"error": str(e)[:200]}})
        try:
            ol = None
            if rec.fields.get("ISBN"):
                ol = openlibrary_isbn(rec.fields["ISBN"])
                tried.append("openlibrary")
                if ol:
                    if ol.get("publishers"):
                        rec.put("publisher", ol["publishers"][0], "openlibrary", 0.88)
                    y = _year(ol.get("publish_date"))
                    if y:
                        rec.put("issued", {"date-parts": [[y]]}, "openlibrary", 0.88)
                    if ol.get("publish_places"):
                        rec.put("publisher-place", ol["publish_places"][0], "openlibrary", 0.85)
            elif title and fam and kind in ("epub", "pdf", "scanned_pdf", "document"):
                ol = openlibrary_search(title, fam)
                tried.append("openlibrary")
                if ol and ol.get("first_publish_year") and ol["first_publish_year"] >= 1830:
                    rec.put("original-date", {"date-parts": [[int(ol["first_publish_year"])]]}, "openlibrary", 0.75)
        except Exception as e:
            events.append({"stage": "metadata", "provider": "openlibrary", "detail": {"error": str(e)[:200]}})
        events.append({"stage": "metadata", "provider": "catalogues", "detail": {"tried": tried}})
    # 5. user overrides
    for k, v in (user or {}).items():
        if v in (None, ""):
            continue
        if k == "author":
            v = [parse_name(x, language) for x in (v if isinstance(v, list) else [v])]
        if k in ("issued", "original-date") and not isinstance(v, dict):
            v = {"date-parts": [[int(v)]]}
        rec.put(k, v, "user", 1.0, force=True)

    item: dict = {"type": rec.fields.get("type") or CSL_BY_KIND.get(kind, "book")}
    title = rec.fields.get("title") or os.path.splitext(os.path.basename(source.path or "untitled"))[0]
    if "title" not in rec.prov:
        rec.prov["title"] = {"source": "filename", "confidence": 0.3}
    sub = rec.fields.get("_subtitle")
    if sub and fold(sub) not in fold(title):
        title = title.rstrip(" :.;")
        item["title"] = f"{title}: {sub}"
        item["title-short"] = title
    else:
        item["title"] = title
    try:  # the work's year only when it differs from the edition's
        if rec.fields["original-date"]["date-parts"][0][0] >= rec.fields["issued"]["date-parts"][0][0]:
            rec.fields.pop("original-date")
            rec.prov.pop("original-date", None)
    except (KeyError, IndexError, TypeError):
        pass
    for k in ("author", "editor", "translator", "issued", "original-date", "publisher", "publisher-place", "container-title",
              "collection-title", "edition", "DOI", "ISBN", "URL", "language", "accessed"):
        if k in rec.fields:
            item[k] = rec.fields[k]
    if "language" not in item and language:
        item["language"] = language
        rec.prov.setdefault("language", {"source": "detected", "confidence": 0.7})
    ext: dict = {"provenance": {k.lstrip("_"): v for k, v in rec.prov.items()}}
    if rec.fields.get("_original_language"):
        ext["original_language"] = rec.fields["_original_language"]
    if rec.fields.get("_orcid"):
        ext["orcid"] = rec.fields["_orcid"]
    if sub:
        ext["subtitle"] = sub
    if rec.fields.get("_performer"):
        ext["performer"] = rec.fields["_performer"]
    item["spdf"] = ext
    return item, events
