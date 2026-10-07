"""Printed folios: the heart of a citation.

Faithful port of Scholaris `@scholaris/folios` (candidatos.ts, secuencia.ts,
folios.ts and the parts of the v3 deducer that folios.ts uses):

1. `extract_candidates`: numbers in the header, footer, the edges of the body
   text and what the reader said the folio was.
2. `choose_sequence`: the longest coherent chain of readings (a Viterbi with
   jumps): footnote calls, years, chapter numbers and OCR errors fall out of
   the chain without a rule for each case.
3. Piecewise deduction: between two readings that agree, interpolate; if the
   numbering advances less than the pages, the extra pages are unnumbered
   plates; if it advances more, leaves are missing; before the first and after
   the last reading, extrapolate with decreasing confidence; romans → arabic
   transition.
4. PDF page labels win when they agree with what is seen.
5. Covers, dust jackets and blank end pages lose their folio.

Golden rule: if there is no reading at all, nothing is invented (source
"none"): a citation only prints what has been seen.

Output anchors follow the 5.0 contract: {"type":"page","physical","printed",
"roman","foliation","source":"read|inferred|none","confidence"}.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field, replace
from typing import Optional

# ---------------------------------------------------------------------------
# Romans
# ---------------------------------------------------------------------------

ROMAN_STRICT = re.compile(r"^(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$", re.I)
_ROMAN_VALUES = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
_ROMANS = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"),
           (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]


def roman_to_int(s: str) -> int:
    t = s.strip().lower()
    if not ROMAN_STRICT.match(t):
        return 0
    total = prev = 0
    for ch in reversed(t):
        v = _ROMAN_VALUES.get(ch, 0)
        total += -v if v < prev else v
        prev = max(prev, v)
    return total


def int_to_roman(n: int, upper: bool = False) -> str:
    if n <= 0 or n > 3999:
        return str(n)
    s = ""
    for v, r in _ROMANS:
        while n >= v:
            s += r
            n -= v
    return s.upper() if upper else s


# ---------------------------------------------------------------------------
# Lines
# ---------------------------------------------------------------------------


def clean_line(line: str) -> str:
    line = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", line)
    line = re.sub(r"<[^>]+>", " ", line)
    line = re.sub(r"^\s*#+\s*", "", line)
    line = re.sub(r"[*_`]+", " ", line)
    return re.sub(r"\s+", " ", line).strip()


def useful_lines(text: Optional[str]) -> list[str]:
    if not text:
        return []
    out = []
    for raw in re.split(r"\r?\n", text):
        l = clean_line(raw)
        if l and not re.fullmatch(r"[-=_*~\s]{3,}", l) and not re.fullmatch(r"\|?[\s|:-]*\|?", l):
            out.append(l)
    return out


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------

_DECO = r"[\s\-–—~.,:;*·•_=|\[\](){}<>«»‹›\"'“”‘’/\\]"
_DECO_EDGES = re.compile(rf"^{_DECO}+|{_DECO}+$")

NOT_FOLIO_WORD = re.compile(
    r"^(?:cap[íi]tulo|cap|chapter|chap|chapitre|capitolo|kapitel|part|parte|partie|teil|libro|book|livre|tomo|vol|volumen|"
    r"volume|band|acto|act|jornada|canto|escena|scene|secci[óo]n|section|art|art[íi]culo|lecci[óo]n|tema|n[ºo°]|no|n[úu]m|num|"
    r"n[úu]mero|number|nummer|fig|figura|figure|tabla|table|tab|l[áa]m|l[áa]mina|plate|ed|edici[óo]n|edition|año|year|anno|isbn|"
    r"issn|doi|tel|telephone|tel[ée]fono)\.?$",
    re.I,
)
FOLIO_WORD = re.compile(r"^(?:p|pp|p[áa]g|p[áa]gs|p[áa]gina|page|pg|seite|s|fol|f|folio|fº|f°|fo)\.?$", re.I)

BASE_WEIGHT = {"reader": 0.9, "footer": 0.9, "header": 0.85, "text-end": 0.6, "text-start": 0.5, "judge": 1.0}


@dataclass
class Candidate:
    value: float
    roman: bool
    upper: bool
    text: str
    source: str  # reader | footer | header | text-start | text-end | judge
    weight: float
    corrected: bool
    right: Optional[int] = None  # two-up: right page number
    side: Optional[str] = None  # 'r' | 'v'


@dataclass
class _Reading:
    value: int
    roman: bool
    upper: bool
    corrected: bool
    side: Optional[str] = None


def read_token(raw: str, romans: bool = True, fix_ocr: bool = True) -> Optional[_Reading]:
    tok = _DECO_EDGES.sub("", raw)
    if not tok or len(tok) > 9:
        return None
    if re.fullmatch(r"\d{1,4}", tok):
        return _Reading(int(tok), False, False, False)
    m = re.fullmatch(r"(\d{1,4})([rv])", tok, re.I)
    if m:
        return _Reading(int(m.group(1)), False, False, False, m.group(2).lower())
    if fix_ocr and re.search(r"\d", tok) and re.fullmatch(r"[\dlIO|o]{2,4}", tok):
        fixed = re.sub(r"[Oo]", "0", re.sub(r"[lI|]", "1", tok))
        if fixed.isdigit():
            return _Reading(int(fixed), False, False, True)
    if romans and ROMAN_STRICT.match(tok):
        lower, upper = tok == tok.lower(), tok == tok.upper()
        if not lower and not upper:
            return None
        v = roman_to_int(tok)
        if v > 0:
            return _Reading(v, True, upper, False)
    return None


def _is_year(r: _Reading) -> bool:
    return not r.roman and 1400 <= r.value <= 2099


def _cand(r: _Reading, text: str, source: str, weight: float, **extra) -> Candidate:
    p = weight
    if r.corrected:
        p *= 0.8
    if _is_year(r) and source != "reader":
        p *= 0.4
    if r.roman and r.value > 60:
        p *= 0.6
    return Candidate(r.value, r.roman, r.upper, text.strip(), source, round(min(1.0, p), 3), r.corrected,
                     side=r.side, **extra)


def candidates_in_line(line: str, source: str) -> list[Candidate]:
    base = BASE_WEIGHT[source]
    in_text = source in ("text-start", "text-end")
    l = clean_line(line)
    if not l:
        return []
    if re.match(r"^[¹²³⁴⁵⁶⁷⁸⁹⁰]", l):
        return []
    out: list[Candidate] = []
    whole = read_token(l)
    if whole:
        return [_cand(whole, l, source, base)]
    tokens = [t for t in l.split() if t]
    clean = [c for c in (_DECO_EDGES.sub("", t) for t in tokens) if c]
    # 2. digits split by OCR: «1 3», «1·2»
    if 2 <= len(clean) <= 3 and all(re.fullmatch(r"\d", c) for c in clean):
        out.append(_cand(_Reading(int("".join(clean)), False, False, True), l, source, base * 0.85))
    m = re.fullmatch(r"[\s\-–—~.*·•]*(\d)[·.](\d)[\s\-–—~.*·•]*", l)
    if m:
        out.append(_cand(_Reading(int(m.group(1) + m.group(2)), False, False, True), l, source, base * 0.8))
    # 3. two-up: «12 13»
    if len(clean) >= 2:
        a = read_token(clean[0], romans=False)
        b = read_token(clean[-1], romans=False)
        if a and b and not a.roman and not b.roman and b.value == a.value + 1 and not _is_year(a):
            out.append(_cand(a, l, source, base * 0.75, right=b.value))
    # 4. explicit markers «p. 23», «fol. 12v» (not in body text: there they are references)
    if not in_text:
        for i in range(len(clean) - 1):
            if FOLIO_WORD.match(tokens[i] if i < len(tokens) else "") or FOLIO_WORD.match(clean[i]):
                r = read_token(clean[i + 1])
                if r:
                    out.append(_cand(r, l, source, base))
    # 5. running heads: number at either end of a short line
    short = len(clean) <= 8 and len(l) <= 90
    very_short = len(clean) <= 4 and len(l) <= 40
    if short:
        for i, f in enumerate(clean):
            edge = i == 0 or i == len(clean) - 1
            if not edge and not very_short:
                continue
            prev = tokens[i - 1] if i > 0 and i - 1 < len(tokens) else ""
            if prev and (NOT_FOLIO_WORD.match(prev) or NOT_FOLIO_WORD.match(_DECO_EDGES.sub("", prev))):
                continue
            if prev and FOLIO_WORD.match(prev) and not in_text:
                continue
            r = read_token(f, romans=edge)
            if not r:
                continue
            if r.roman and len(f) == 1 and r.upper:
                continue
            if in_text and (not very_short or (r.roman and len(clean) > 1)):
                continue
            out.append(_cand(r, l, source, base * (0.8 if edge else 0.6)))
    return out


def merge_candidates(lst: list[Candidate]) -> list[Candidate]:
    groups: dict[str, list[Candidate]] = {}
    for c in lst:
        k = f"{'r' if c.roman else 'a'}{c.value}{c.side or ''}{c.right if c.right is not None else ''}"
        groups.setdefault(k, []).append(c)
    out = []
    for g in groups.values():
        g.sort(key=lambda c: -c.weight)
        best = replace(g[0])
        sources = {c.source for c in g}
        if len(sources) > 1:
            best.weight = min(1.0, round(best.weight + 0.05 * (len(sources) - 1), 3))
        out.append(best)
    out.sort(key=lambda c: (-c.weight, c.value))
    return out


def extract_candidates(page: dict) -> list[Candidate]:
    lst: list[Candidate] = []
    folio = (page.get("folio") or "").strip()
    if folio:
        conf = page.get("confidence")
        k = min(1.0, 0.6 + 0.4 * conf) if isinstance(conf, (int, float)) and conf > 0 else 1.0
        for c in candidates_in_line(folio, "reader"):
            c.weight = round(c.weight * k, 3)
            lst.append(c)
    for l in useful_lines(page.get("header")):
        lst += candidates_in_line(l, "header")
    for l in useful_lines(page.get("footer")):
        lst += candidates_in_line(l, "footer")
    body = useful_lines(page.get("text"))
    if body:
        start = body[:2]
        end = body[-3:] if len(body) > 2 else body[len(start):]
        for l in start:
            lst += candidates_in_line(l, "text-start")
        for l in end:
            lst += candidates_in_line(l, "text-end")
    return merge_candidates(lst)


def candidate_text(c: Candidate) -> str:
    base = int_to_roman(int(c.value), c.upper) if c.roman else str(int(c.value))
    return f"{base}{c.side}" if c.side else base


# ---------------------------------------------------------------------------
# Sequence (dynamic programming)
# ---------------------------------------------------------------------------

FITS = 1.0
BREAKS = -3.0


def link(a: Candidate, b: Candidate, distance: int, step: float) -> float:
    if a.roman == b.roman:
        expected = a.value + step * distance
        diff = b.value - expected
        if abs(diff) < 1e-9:
            return FITS
        if diff < 0:
            plates = -diff / step
            if float(round(plates * 1000) / 1000).is_integer() and plates <= min(4, distance - 1):
                return -0.9 - 0.1 * plates
            return BREAKS
        if diff <= 2 * max(1, step):
            return -1.0
        return BREAKS
    if a.roman and not b.roman:
        return 0.3 if b.value <= 1 + step * distance else -1.0
    return BREAKS


@dataclass
class SequenceResult:
    chosen: list[Optional[int]]
    margins: list[Optional[float]]
    total: float
    scores: list[list[float]]
    support: list[int]


def choose_sequence(cands: list[list[Candidate]], step: float, window: int = 150) -> SequenceResult:
    n = len(cands)
    fwd = [[0.0] * len(cs) for cs in cands]
    back = [[0.0] * len(cs) for cs in cands]
    prev: list[list[Optional[tuple[int, int]]]] = [[None] * len(cs) for cs in cands]
    # Only pages with candidates matter for the inner loop.
    with_c = [i for i in range(n) if cands[i]]
    pos = {p: k for k, p in enumerate(with_c)}
    for i in with_c:
        ci = cands[i]
        k = pos[i]
        lo = i - window
        js = [j for j in with_c[max(0, k - window):k] if j >= lo]
        for a, ca in enumerate(ci):
            best = 0.0
            frm = None
            for j in js:
                fj = fwd[j]
                for b, cb in enumerate(cands[j]):
                    v = fj[b] + link(cb, ca, i - j, step)
                    if v > best:
                        best, frm = v, (j, b)
            fwd[i][a] = ca.weight + best
            prev[i][a] = frm
    for i in reversed(with_c):
        ci = cands[i]
        k = pos[i]
        hi = i + window
        ks = [q for q in with_c[k + 1:k + 1 + window] if q <= hi]
        for a, ca in enumerate(ci):
            best = 0.0
            for q in ks:
                bq = back[q]
                for b, cb in enumerate(cands[q]):
                    v = link(ca, cb, q - i, step) + cb.weight + bq[b]
                    if v > best:
                        best = v
            back[i][a] = best
    total = 0.0
    end = None
    scores = [[fwd[i][a] + back[i][a] for a in range(len(cands[i]))] for i in range(n)]
    for i in with_c:
        for a in range(len(cands[i])):
            if fwd[i][a] > total:
                total, end = fwd[i][a], (i, a)
    chosen: list[Optional[int]] = [None] * n
    chain: list[tuple[int, int]] = []
    e = end
    while e:
        chosen[e[0]] = e[1]
        chain.insert(0, e)
        e = prev[e[0]][e[1]]
    support = [0] * n
    for k, (p, c) in enumerate(chain):
        cc = cands[p][c]
        if k > 0:
            pp, pc = chain[k - 1]
            if link(cands[pp][pc], cc, p - pp, step) > 0:
                support[p] += 1
        if k + 1 < len(chain):
            sp, sc = chain[k + 1]
            if link(cc, cands[sp][sc], sp - p, step) > 0:
                support[p] += 1
    margins: list[Optional[float]] = []
    for i, cs in enumerate(cands):
        if not cs:
            margins.append(None)
            continue
        sc = scores[i]
        el = chosen[i]
        if el is None:
            margins.append(total - max(sc))
        else:
            others = [s for a, s in enumerate(sc) if a != el]
            margins.append(sc[el] - max(others) if others else sc[el])
    return SequenceResult(chosen, margins, total, scores, support)


def estimate_step(cands: list[list[Candidate]]) -> tuple[float, dict]:
    votes = {"1": 0.0, "2": 0.0, "0.5": 0.0}
    n = len(cands)
    for i in range(n):
        for a in cands[i]:
            if a.weight < 0.5:
                continue
            for d in range(1, 5):
                if i + d >= n:
                    break
                for b in cands[i + d]:
                    if b.weight < 0.5 or b.roman != a.roman:
                        continue
                    r = (b.value - a.value) / d
                    for p, key in ((1, "1"), (2, "2"), (0.5, "0.5")):
                        if abs(r - p) < 1e-9:
                            votes[key] += min(a.weight, b.weight)
    for cs in cands:
        for c in cs:
            if c.right is not None and c.weight >= 0.5:
                votes["2"] += 0.5
    step = 1.0
    if votes["2"] > votes["1"] * 1.5 and votes["2"] >= 2:
        step = 2.0
    elif votes["0.5"] > votes["1"] * 1.5 and votes["0.5"] >= 2:
        step = 0.5
    return step, votes


# ---------------------------------------------------------------------------
# Structural markers (from the v3 deducer, Latin, Greek, Cyrillic and CJK scripts)
# ---------------------------------------------------------------------------

_MARKERS: list[tuple[str, re.Pattern]] = [
    ("chapter_start", re.compile(r"^\s*(?:CHAPTER|CHAPITRE|CAP[ÍI]TULO|CAPITOLO|KAPITEL|KAPITTEL|KAPITOLA|HOOFDSTUK|ROZDZIA[ŁL]|"
                                 r"FEJEZET|LUKU|CAPITOL|POGLAVLJE|ГЛАВА|РОЗДІЛ|ΚΕΦ[ΑΆ]ΛΑΙΟ|CAPUT)\s+[IVXLCDM\d]", re.I)),
    ("chapter_start", re.compile(r"^\s*(?:PART|PARTIE|PARTE|TEIL|DEEL|DEL|OSA|RÉSZ|ČÁST|CZĘŚ[ĆC]|ЧАСТЬ|ΜΕΡΟΣ|PARS|KISIM|BÖLÜM)"
                                 r"\s+[IVXLCDM\d]", re.I)),
    ("chapter_start", re.compile(r"第\s*[\d一二三四五六七八九十百]+\s*[章部篇]")),
    ("contents", re.compile(r"^\s*(?:CONTENTS|TABLE\s+OF\s+CONTENTS|TABLE\s+DES\s+MATI[ÈE]RES|SOMMAIRE|[ÍI]NDICE(?:\s+(?:GENERAL|"
                            r"DE\s+CONTENIDOS?))?|SUM[ÁA]RIO|CONTE[ÚU]DO|INDICE|SOMMARIO|INHALTSVERZEICHNIS|INHALT|INHOUD|"
                            r"СОДЕРЖАНИЕ|ОГЛАВЛЕНИЕ|ΠΕΡΙΕΧ[ΌO]ΜΕΝΑ)", re.I)),
    ("contents", re.compile(r"^\s*目\s*[次录錄]")),
    ("preface", re.compile(r"^\s*(?:PREFACE|FOREWORD|PREF[ÁA]CIO|PREFACIO|PR[ÉE]FACE|AVANT[\s-]PROPOS|PR[ÓO]LOGO|PREFAZIONE|"
                           r"PREMESSA|VORWORT|GELEITWORT|VOORWOORD|PRZEDMOWA|ПРЕДИСЛОВИЕ|ΠΡ[ΌO]ΛΟΓΟΣ|PRAEFATIO)", re.I)),
    ("introduction", re.compile(r"^\s*(?:INTRODUCTION|INTRODUCCI[ÓO]N|INTRODUÇÃO|INTRODUZIONE|EINLEITUNG|EINF[ÜU]HRUNG|INLEIDING|"
                                r"WPROWADZENIE|ВВЕДЕНИЕ|ΕΙΣΑΓΩΓ[ΉH])", re.I)),
    ("index", re.compile(r"^\s*(?:(?:SUBJECT\s+|NAME\s+|AUTHOR\s+)?INDEX|[ÍI]NDICE\s+(?:ANAL[ÍI]TICO|DE\s+NOMBRES|REMISSIVO|"
                         r"ONOMÁSTICO)|INDICE\s+(?:ANALITICO|DEI\s+NOMI)|(?:SACH|NAMEN|STICHWORT)(?:REGISTER|VERZEICHNIS)|REGISTER|"
                         r"УКАЗАТЕЛЬ)", re.I)),
    ("bibliography", re.compile(r"^\s*(?:BIBLIOGRAPHY|REFERENCES|WORKS\s+CITED|SOURCES|BIBLIOGRA(?:PH|F)[ÍI][AE]|REFERENCIAS|"
                                r"BIBLIOGRAFIA|RIFERIMENTI|LITERATURVERZEICHNIS|BIBLIOGRAPHIE|БИБЛИОГРАФИЯ|ЛИТЕРАТУРА)", re.I)),
    ("appendix", re.compile(r"^\s*(?:APPENDIX|APPENDICE|AP[ÉE]NDICE|ANEXO|ANNEXE|ANHANG|ANLAGE|BIJLAGE|ПРИЛОЖЕНИЕ)", re.I)),
]
_LATIN_CHAPTER = {0, 1}
PRELIM_MARKERS = {"contents", "preface"}
BODY_START_MARKERS = {"chapter_start", "introduction"}
FINAL_MARKERS = {"index", "bibliography", "appendix"}


def detect_markers(texts: dict[int, str], strict: bool = True) -> dict[int, str]:
    out: dict[int, str] = {}
    for phys, text in texts.items():
        if not text:
            continue
        clean = re.sub(r"<[^>]+>", " ", text)
        clean = re.sub(r"#+\s*", "", clean)
        clean = re.sub(r"\b((?:[A-Z] )+)([A-Z][A-Za-z]*)", lambda m: m.group(1).replace(" ", "") + m.group(2), clean)
        clean = re.sub(r"\s+", " ", clean).strip()[:300]
        for k, (name, pat) in enumerate(_MARKERS):
            if pat.search(clean):
                if strict and k in _LATIN_CHAPTER:
                    m = re.match(r"^\s*\S+\s+([^\s.,:;]+)", clean)
                    if not m or not re.fullmatch(r"(?:[IVXLCDM]+|\d+)", m.group(1)):
                        continue
                out[phys] = name
                break
    return out


def _filter_outliers(anchors: dict[int, int], total: int, per_phys: int) -> dict[int, int]:
    if not anchors:
        return anchors
    maximum = total * per_phys * 2
    f = {p: v for p, v in anchors.items() if abs(v) <= maximum}
    if len(f) < 3:
        return f
    ordered = sorted(f.items())
    incs = []
    for i in range(1, len(ordered)):
        dp = ordered[i][0] - ordered[i - 1][0]
        df = ordered[i][1] - ordered[i - 1][1]
        if dp > 0:
            incs.append((i, df / dp))
    if not incs:
        return f
    vals = sorted(v for _, v in incs)
    median = vals[len(vals) // 2]
    good = {0}
    for i, inc in incs:
        if abs(inc - median) <= per_phys * 2:
            good.add(i)
            good.add(i - 1)
    return {p: v for k, (p, v) in enumerate(ordered) if k in good}


def _first_numbered(total: int, texts: dict[int, str], markers: dict[int, str], romans: dict[int, int],
                    confidences: dict[int, float]) -> int:
    if romans:
        first = min(romans)
        p0 = first
        p = first - 1
        while p > 0:
            if len((texts.get(p) or "").strip()) > 50:
                p0 = p
            else:
                break
            p -= 1
        return max(1, p0)
    prelim = sorted(p for p, m in markers.items() if m in PRELIM_MARKERS)
    if prelim:
        return prelim[0]
    for p in range(1, min(total + 1, 15)):
        t = texts.get(p) or ""
        c = confidences.get(p, 0.5)
        if len(t.strip()) > 50 and c >= 0.2:
            return p
    return 1


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------


@dataclass
class PageFolio:
    physical: int
    printed: Optional[str] = None
    roman: bool = False
    source: str = "none"  # read | inferred | none
    confidence: float = 0.0
    page_type: str = "body"  # cover|title|prelim|body|final|plate|endpaper
    candidates: list[Candidate] = field(default_factory=list)
    chosen: Optional[Candidate] = None
    pair: Optional[tuple[str, str]] = None


@dataclass
class FolioResult:
    pages: list[PageFolio]
    strategy: str  # read | inferred | none
    layout: str  # single | double | double_rtl
    foliation: bool
    transition: Optional[int]
    first_numbered: int
    origin: str  # sequence | labels
    anchors: int
    warnings: list[str]

    def anchor(self, i: int) -> dict:
        f = self.pages[i]
        a = {"type": "page", "physical": f.physical, "printed": f.printed, "roman": f.roman,
             "foliation": "leaf" if self.foliation else "page", "source": f.source,
             "confidence": round(f.confidence, 3)}
        return a


@dataclass
class _Prep:
    pages: list[dict]
    cands: list[list[Candidate]]
    step: float
    layout: str
    foliation: bool
    warnings: list[str]


def _prepare(pages: list[dict], layout: str = "auto", foliation: str | bool = "auto") -> _Prep:
    pages = sorted(pages, key=lambda p: p["physical"])
    cands = [extract_candidates(p) for p in pages]
    step, lay, fol = 1.0, "single", False
    if layout != "auto":
        lay = layout
        step = 1.0 if layout == "single" else 2.0
    if foliation is True:
        fol, step = True, 0.5
    if layout == "auto" and foliation == "auto":
        step, _ = estimate_step(cands)
        if step == 2:
            lay = "double"
        if step == 0.5:
            fol = True
    if step == 2:
        for cs in cands:
            for c in cs:
                if c.right is not None:
                    c.weight = min(1.0, c.weight + 0.1)
    return _Prep(pages, cands, step, lay, fol, [])


def _conf_reading(c: Candidate, support: int) -> float:
    if c.source == "judge":
        return round(max(0.85, c.weight), 3)
    if support >= 2:
        return round(min(1.0, 0.9 + 0.1 * c.weight), 3)
    if support == 1:
        return round(min(0.97, 0.85 + 0.1 * c.weight), 3)
    return round(0.6 + 0.3 * c.weight, 3)


def _choose_plates(prep: _Prep, lo: int, hi: int, count: int) -> set[int]:
    pts = []
    for i in range(lo, hi + 1):
        p = prep.pages[i]
        length = len((p.get("text") or "").strip())
        s = 0.0
        if p.get("empty"):
            s += 2
        if p.get("figures") and length < 400:
            s += 1.5
        if not prep.cands[i]:
            s += 0.5
        s += max(0.0, 1 - length / 600)
        pts.append((i, s))
    pts.sort(key=lambda t: (-t[1], t[0]))
    return {i for i, _ in pts[:count]}


def _cut_point(a: int, b: int, markers: dict[int, str]) -> int:
    for i in range(a + 1, b):
        m = markers.get(i + 1)
        if m in ("chapter_start", "introduction"):
            return i
    return math.ceil((a + b) / 2)


def _assemble(prep: _Prep, seq: SequenceResult) -> FolioResult:
    pages, cands, step = prep.pages, prep.cands, prep.step
    n = len(pages)
    warnings = list(prep.warnings)
    anchors = [(i, cands[i][el], seq.support[i]) for i, el in enumerate(seq.chosen) if el is not None]
    if len(anchors) > 1:
        strong = [a for a in anchors if a[2] > 0 or a[1].weight >= 0.85 or a[1].source == "judge"]
        if strong:
            anchors = strong
    elif len(anchors) == 1 and anchors[0][1].weight < 0.85:
        warnings.append("Only one folio reading and it is weak: not used.")
        anchors = []

    # A roman zone needs two readings or a strong one: a lone «i» at the edge of the body text is
    # OCR noise far more often than a preliminary page (Tesseract on a 1737 title page).
    rom = [a for a in anchors if a[1].roman]
    if len(rom) == 1 and rom[0][1].weight < 0.85 and rom[0][1].source != "judge":
        anchors = [a for a in anchors if not a[1].roman]
        warnings.append("A single weak roman reading was ignored.")
        if not anchors:
            warnings.append("No reliable folio reading: pages stay without a printed number.")
            out = [PageFolio(p["physical"], None, False, "none", 0.0, "body", cands[i]) for i, p in enumerate(pages)]
            return FolioResult(out, "none", prep.layout, prep.foliation, None, pages[0]["physical"] if pages else 1,
                               "sequence", 0, warnings)

    texts = {i + 1: (p.get("text") or "")[:300] for i, p in enumerate(pages)}
    confs = {i + 1: p["confidence"] for i, p in enumerate(pages) if isinstance(p.get("confidence"), (int, float))}
    markers = detect_markers(texts, strict=True)
    per_phys = 2 if prep.layout in ("double", "double_rtl") else 1
    v3_romans = {a[0] + 1: -int(a[1].value) for a in anchors if a[1].roman}
    for p in list(v3_romans):
        if markers.get(p) in BODY_START_MARKERS:
            v3_romans.pop(p)
    v3_romans = _filter_outliers(v3_romans, n, per_phys)
    v3_first = _first_numbered(n, texts, markers, v3_romans, confs)

    romans = [a for a in anchors if a[1].roman]
    arabic = [a for a in anchors if not a[1].roman]
    upper = sum(1 for a in romans if a[1].upper) > len(romans) / 2

    if not anchors:
        warnings.append("No reliable folio reading: pages stay without a printed number.")
        out = [PageFolio(p["physical"], None, False, "none", 0.0, "body", cands[i]) for i, p in enumerate(pages)]
        return FolioResult(out, "none", prep.layout, prep.foliation, None, pages[0]["physical"] if pages else 1,
                           "sequence", 0, warnings)

    transition: Optional[int] = None
    if arabic:
        a0 = arabic[0]
        estimated = round(a0[0] - (a0[1].value - 1) / step)
        last_roman = romans[-1][0] if romans else -1
        if estimated > 0 or romans:
            transition = max(last_roman + 1, min(a0[0], estimated))
            if transition <= 0 and not romans:
                transition = None
    elif romans:
        last = romans[-1][0]
        chapters = [p - 1 for p, m in markers.items() if m == "chapter_start" and p - 1 > last]
        transition = min(chapters) if chapters else None

    first = min(v3_first - 1, anchors[0][0])
    if romans:
        r0 = romans[0]
        first = max(0, min(first, round(r0[0] - (r0[1].value - 1) / step)))
    elif transition is not None:
        first = min(first, transition)
    first = max(0, first)

    value: list[Optional[float]] = [None] * n
    conf = [0.0] * n
    origin = ["none"] * n
    plate = [False] * n
    chosen: list[Optional[Candidate]] = [None] * n

    def fill(zone, lo: int, hi: int, is_roman: bool):
        if hi < lo:
            return
        if not zone:
            # A zone without a single reading (unnumbered preliminaries before the first «Pag. 1») gets no
            # folio: Scholaris/v3 counted them as i, ii, iii…, but a citation only prints what has been seen.
            if hi >= lo:
                warnings.append(f"Physical pages {pages[lo]['physical']}-{pages[hi]['physical']}: {'roman' if is_roman else 'arabic'} "
                                f"zone without any reading, left without folio.")
            return
        in_range = [a for a in zone if lo <= a[0] <= hi]
        if not in_range:
            return
        for (i, c, sup) in in_range:
            value[i] = c.value
            conf[i] = _conf_reading(c, sup)
            origin[i] = "read"
            chosen[i] = c
        p0 = in_range[0]
        for i in range(p0[0] - 1, lo - 1, -1):
            v = p0[1].value - step * (p0[0] - i)
            if v < 1 - 1e-9:
                break
            value[i] = v
            conf[i] = max(0.5, 0.9 - 0.005 * (p0[0] - i))
            origin[i] = "inferred"
        for k in range(len(in_range) - 1):
            a, b = in_range[k], in_range[k + 1]
            inside = b[0] - a[0] - 1
            if inside <= 0:
                continue
            gap = (b[1].value - a[1].value) - step * (b[0] - a[0])
            if abs(gap) < 1e-9:
                for i in range(a[0] + 1, b[0]):
                    value[i] = a[1].value + step * (i - a[0])
                    conf[i] = 0.95
                    origin[i] = "inferred"
                continue
            plates = round(-gap / step)
            if gap < 0 and plates <= inside and abs(-gap / step - plates) < 1e-9:
                chosen_plates = _choose_plates(prep, a[0] + 1, b[0] - 1, plates)
                v = a[1].value
                for i in range(a[0] + 1, b[0]):
                    if i in chosen_plates:
                        plate[i] = True
                        value[i] = None
                        conf[i] = 0.7
                        origin[i] = "none"
                        continue
                    v += step
                    value[i] = v
                    conf[i] = 0.85
                    origin[i] = "inferred"
                warnings.append(f"Between physical pages {pages[a[0]]['physical']} and {pages[b[0]]['physical']} "
                                f"there are {plates} unnumbered page(s) (plates).")
                continue
            cut = _cut_point(a[0], b[0], markers)
            for i in range(a[0] + 1, b[0]):
                v = a[1].value + step * (i - a[0]) if i < cut else b[1].value - step * (b[0] - i)
                if v < 1 - 1e-9:
                    continue
                value[i] = v
                conf[i] = 0.6
                origin[i] = "inferred"
            if gap > 0:
                warnings.append(f"Between physical pages {pages[a[0]]['physical']} and {pages[b[0]]['physical']} the "
                                f"numbering jumps {gap / step:g} page(s): leaves missing in the scan.")
            else:
                warnings.append(f"Between physical pages {pages[a[0]]['physical']} and {pages[b[0]]['physical']} the "
                                f"numbering breaks ({a[1].value:g} to {b[1].value:g}).")
        pn = in_range[-1]
        for i in range(pn[0] + 1, hi + 1):
            value[i] = pn[1].value + step * (i - pn[0])
            conf[i] = max(0.5, 0.9 - 0.005 * (i - pn[0]))
            origin[i] = "inferred"

    if transition is None:
        if arabic:
            fill(arabic, first, n - 1, False)
        else:
            fill(romans, first, n - 1, True)
    else:
        fill(romans, first, transition - 1, True)
        fill(arabic, transition, n - 1, False)

    out: list[PageFolio] = []
    for i, p in enumerate(pages):
        v = value[i]
        is_roman = i < transition if transition is not None else (not arabic and bool(romans))
        ptype = "title" if i < first else ("prelim" if is_roman else "body")
        m = markers.get(i + 1)
        if m in FINAL_MARKERS and not is_roman:
            ptype = "final"
        if plate[i]:
            ptype = "plate"
        f = PageFolio(p["physical"], None, False, "none", 0.0, ptype, cands[i])
        el = chosen[i]
        if el:
            f.chosen = el
        if v is None or i < first:
            f.confidence = 0.7 if i < first else (conf[i] if plate[i] else 0.0)
            out.append(f)
            continue
        f.source = origin[i]
        f.confidence = round(conf[i], 3)
        if is_roman:
            f.roman = True
            f.printed = int_to_roman(int(round(v)), upper)
        elif prep.foliation:
            leaf = math.floor(v + 1e-9)
            f.printed = f"{leaf}{'r' if abs(v - leaf) < 1e-9 else 'v'}"
        else:
            f.printed = str(int(round(v)))
        if step == 2:
            left, right = int(round(v)), int(round(v)) + 1
            if is_roman:
                f.pair = (int_to_roman(left, upper), int_to_roman(right, upper))
            elif prep.layout == "double_rtl":
                f.pair = (str(right), str(left))
                f.printed = str(right)
            else:
                f.pair = (str(left), str(right))
        if f.source == "read" and el and abs(el.value - v) > 1e-9:
            f.source = "inferred"
        out.append(f)

    read = sum(1 for f in out if f.source == "read")
    numbered = sum(1 for f in out if f.printed is not None)
    return FolioResult(out, "read" if read > numbered * 0.5 else ("inferred" if numbered else "none"), prep.layout,
                       prep.foliation, pages[transition]["physical"] if transition is not None and transition < n else None,
                       pages[first]["physical"] if first < n else 1, "sequence", len(anchors), warnings)


# ---------------------------------------------------------------------------
# Outside the numbered body
# ---------------------------------------------------------------------------

COVER_SIGNAL = re.compile(
    r"\b(?:jacket design(?:ed)? by|cover design(?:ed)? by|continued on (?:the )?(?:back|front) flap|(?:front|back|inside) "
    r"(?:cover|flap)|dust ?jacket|sobrecubierta|contracubierta|solapa|dise[ñn]o de (?:la )?(?:cubierta|portada|colecci[óo]n)|"
    r"ilustraci[óo]n de (?:la )?(?:cubierta|portada)|couverture|umschlag)\b",
    re.I,
)
COVER_LABEL = re.compile(r"^(?:dj\b.*|jacket.*|(?:front|back|inside)?\s*cover.*|cubierta.*|contracubierta.*|tapa.*|c\d|[ib]?fc|"
                         r"[ib]?bc|ifc|ibc)$", re.I)


def no_content(p: dict) -> bool:
    if p.get("empty") is True:
        return True
    if p.get("empty") is False:
        return False
    return not any((p.get(k) or "").strip() for k in ("text", "header", "footer", "folio")) and not p.get("figures")


def is_cover(p: dict) -> bool:
    lab = (p.get("label") or "").strip()
    if lab and COVER_LABEL.match(lab):
        return True
    return bool(COVER_SIGNAL.search(f"{p.get('header') or ''}\n{(p.get('text') or '')[:1500]}\n{p.get('footer') or ''}"))


def _trim(prep: _Prep, r: FolioResult) -> FolioResult:
    ps = prep.pages
    n = len(ps)
    last = n - 1
    while last >= 0 and no_content(ps[last]):
        last -= 1
    first_c = 0
    while first_c < n and no_content(ps[first_c]):
        first_c += 1
    with_f = [i for i, f in enumerate(r.pages) if f.printed is not None]
    first_f = with_f[0] if with_f else n
    last_f = with_f[-1] if with_f else -1
    endpapers = covers = 0

    def empty(f: PageFolio, t: str) -> PageFolio:
        return PageFolio(f.physical, None, False, "none", 0.8, t, f.candidates)

    pages = []
    for i, f in enumerate(r.pages):
        if i > last or i < first_c:
            if f.printed is not None:
                endpapers += 1
            pages.append(empty(f, "endpaper" if i > last else "title"))
            continue
        edge = f.source != "read" and (i <= first_f or i >= last_f)
        if edge and is_cover(ps[i]):
            if f.printed is not None:
                covers += 1
            pages.append(empty(f, "cover"))
            continue
        pages.append(f)
    warnings = list(r.warnings)
    if endpapers:
        warnings.append(f"{endpapers} page(s) without content outside the body (endpapers) left without folio.")
    if covers:
        warnings.append(f"{covers} cover or dust-jacket page(s) left without folio.")
    r.pages = pages
    r.warnings = warnings
    return r


# ---------------------------------------------------------------------------
# PDF page labels
# ---------------------------------------------------------------------------


def _read_label(e: Optional[str]) -> Optional[tuple[int, bool, bool]]:
    t = (e or "").strip()
    if re.fullmatch(r"\d{1,5}", t):
        return (int(t), False, False) if int(t) > 0 else None
    v = roman_to_int(t)
    if v > 0 and (t == t.lower() or t == t.upper()):
        return v, True, t == t.upper()
    return None


def folios_from_labels(prep: _Prep) -> Optional[FolioResult]:
    ps = prep.pages
    with_l = [p for p in ps if (p.get("label") or "").strip()]
    if not ps or len(with_l) < len(ps) * 0.8:
        return None
    if not any((p.get("label") or "").strip() != str(p["physical"]) for p in with_l):
        return None
    agree = compared = 0
    for i, p in enumerate(ps):
        e = _read_label(p.get("label"))
        cs = prep.cands[i]
        if not e or not cs:
            continue
        compared += 1
        if any(c.value == e[0] and c.roman == e[1] for c in cs):
            agree += 1
    if compared > 0 and agree / compared < 0.5:
        return None
    # Runs of labels that advance by one in the same style. A run that no page confirms with what
    # is seen (while other runs are confirmed) is the editor's bookkeeping, not a printed folio:
    # NIST SP 800-63B-4 labels its unnumbered cover pages «I, I, I, II».
    labels = [_read_label(p.get("label")) for p in ps]
    run_of = [-1] * len(ps)
    runs: list[list[int]] = []
    for i, e in enumerate(labels):
        if not e:
            continue
        prev = labels[i - 1] if i > 0 else None
        if prev and runs and run_of[i - 1] == len(runs) - 1 and e[1] == prev[1] and e[2] == prev[2] and e[0] == prev[0] + 1:
            runs[-1].append(i)
        else:
            runs.append([i])
        run_of[i] = len(runs) - 1
    seen_run = [any(any(c.value == labels[i][0] and c.roman == labels[i][1] for c in prep.cands[i]) for i in r) for r in runs]
    if any(seen_run):
        for k, r in enumerate(runs):
            if not seen_run[k] and len(r) <= 8:
                for i in r:
                    labels[i] = None
    numeric = [i for i, e in enumerate(labels) if e]
    first_n = numeric[0] if numeric else len(ps)
    last_n = numeric[-1] if numeric else -1
    out = []
    for i, p in enumerate(ps):
        cs = prep.cands[i]
        e = labels[i]
        if not e and _read_label(p.get("label")):
            base = PageFolio(p["physical"], None, False, "none", 0.8, "title" if i < first_n else "body", cs)
            out.append(base)
            continue
        base = PageFolio(p["physical"], None, False, "none", 0.0, "body", cs)
        if not e:
            text = (p.get("label") or "").strip()
            if not text or i < first_n or i > last_n or COVER_LABEL.match(text):
                base.confidence = 0.8
                base.page_type = "cover" if (i < first_n or (text and COVER_LABEL.match(text))) else "endpaper"
                out.append(base)
                continue
            base.printed, base.source, base.confidence = text, "inferred", 0.7
            out.append(base)
            continue
        seen = next((c for c in cs if c.value == e[0] and c.roman == e[1]), None)
        base.printed = int_to_roman(e[0], e[2]) if e[1] else str(e[0])
        base.roman = e[1]
        base.source = "read" if seen else "inferred"
        base.confidence = 0.99 if seen else (0.93 if compared > 0 else 0.8)
        base.page_type = "prelim" if e[1] else "body"
        if seen:
            base.chosen = seen
        out.append(base)
    read = sum(1 for f in out if f.source == "read")
    numbered = sum(1 for f in out if f.printed is not None)
    first_arabic = next((f for f in out if f.printed and not f.roman and f.printed.isdigit()), None)
    return FolioResult(out, "read" if read > numbered * 0.5 else ("inferred" if numbered else "none"), prep.layout, False,
                       first_arabic.physical if any(f.roman for f in out) and first_arabic else None,
                       ps[first_n]["physical"] if first_n < len(ps) else 1, "labels", read,
                       [f"Folios taken from the PDF page labels ({agree} of {compared} comparable pages agree with what is seen)."])


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def deduce_folios(pages: list[dict], layout: str = "auto", foliation: str | bool = "auto") -> FolioResult:
    """Folios without a judge: pure logic.

    `pages`: dicts with `physical` (1-based) and optionally `header`, `footer`,
    `folio` (what the reader saw), `text`, `empty`, `confidence`, `figures`, `label`.
    """
    if not pages:
        return FolioResult([], "none", "single", False, None, 1, "sequence", 0, [])
    prep = _prepare(pages, layout, foliation)
    by_labels = folios_from_labels(prep)
    if by_labels:
        return _trim(prep, by_labels)
    seq = choose_sequence(prep.cands, prep.step)
    return _trim(prep, _assemble(prep, seq))


def pages_from_units(units) -> list[dict]:
    out = []
    for u in units:
        out.append({
            "physical": u.ord, "header": u.header, "footer": u.footer, "folio": u.folio_seen or "",
            "text": u.text, "empty": u.empty, "confidence": u.confidence,
            "figures": [1 for _ in u.figures], "label": u.label,
        })
    return out
