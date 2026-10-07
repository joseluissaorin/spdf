"""Pure text utilities: tokens, sentences, paragraphs, comparison.

Ported from Scholaris (`packages/ingesta/src/texto.ts`) so both producers cut
text the same way.
"""
from __future__ import annotations

import re
import unicodedata

_WORD = re.compile(r"\S+")


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s or "")


def count_tokens(text: str) -> int:
    """Cheap token estimate (BPE ~ 4 chars per token in English, a bit less in Spanish)."""
    if not text:
        return 0
    words = len(_WORD.findall(text))
    return max(-(-len(text) // 4), -(-int(words * 13) // 10))


ABBREVIATIONS = {
    # English
    "mr", "mrs", "ms", "dr", "prof", "st", "vs", "etc", "e.g", "i.e", "cf", "vol", "vols", "no", "pp", "p", "ed", "eds",
    "fig", "figs", "ch", "chap", "sec", "al", "jr", "sr", "inc", "ltd", "co", "approx", "ca", "viz", "op", "cit", "ibid", "id",
    # Spanish
    "sra", "srta", "dña", "d", "av", "pág", "págs", "cap", "núm", "n", "ob", "trad", "coord", "coords", "ej", "aprox", "art",
    "arts", "col", "cols", "ss", "v", "vid", "lib", "tít", "t", "dir", "reimp", "fol", "fols", "f", "ff",
    # French, German, Latin
    "mme", "mlle", "m", "bd", "bzw", "usw", "vgl", "z.b", "ders", "hrsg", "sq", "sqq", "loc", "ead", "eiusd",
}

def _is_upper_start(s: str) -> bool:
    for ch in s:
        if ch in "\"“«¿¡([—–- ":
            continue
        return ch.isupper() or ch.isdigit()
    return False


def split_sentences(text: str) -> list[str]:
    """Split into sentences, respecting abbreviations, initials and numbers."""
    t = re.sub(r"\s+", " ", text or "").strip()
    if not t:
        return []
    out: list[str] = []
    start = 0
    for m in re.finditer(r"([.!?…]+)([\"”»’)\]]*)(\[\^[^\]]+\]|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?\s+", t):
        end = m.end()
        if not _is_upper_start(t[end:end + 4]):
            continue
        before = t[start:m.start()]
        last = before.split(" ")[-1] if before else ""
        clean = re.sub(r"^[(\"“«¿¡\[]+", "", last).lower()
        if m.group(1) == "." and (
            (len(clean) == 1 and clean.isalpha())
            or clean in ABBREVIATIONS
            or re.fullmatch(r"(?:[^\W\d_]\.)+[^\W\d_]?", clean)
        ):
            continue
        out.append(t[start:end].strip())
        start = end
    rest = t[start:].strip()
    if rest:
        out.append(rest)
    return out


def join_lines(paragraph: str) -> str:
    """Join the lines of a paragraph: «pala-\\nbra» → «palabra»; keeps lists, tables and verse."""
    lines = [l.strip() for l in paragraph.split("\n") if l.strip()]
    if len(lines) <= 1:
        return lines[0] if lines else ""
    if all(re.match(r"^([-*+•]|\d+[.)]|\|)", l) for l in lines):
        return "\n".join(lines)
    short = sum(1 for l in lines if len(l) < 60)
    if len(lines) >= 3 and short >= len(lines) * 0.8 and not any(re.search(r"[^\W\d_]-$", l) for l in lines):
        return "\n".join(lines)
    s = lines[0]
    for l in lines[1:]:
        if re.match(r"^#{1,6}\s", l) or re.match(r"^#{1,6}\s", s.split("\n")[-1]):
            s += "\n" + l
            continue
        if re.search(r"[^\W\d_]-$", s) and l[:1].islower():
            s = s[:-1] + l
        else:
            s += " " + l
    return s


def split_paragraphs(text: str) -> list[str]:
    t = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    return [p for p in (join_lines(x) for x in re.split(r"\n\s*\n", t)) if p]


def clean_markdown(s: str) -> str:
    s = re.sub(r"[*_`]+", "", s)
    s = re.sub(r"\[\^[^\]]+\]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def markdown_title(p: str) -> tuple[int, str] | None:
    m = re.match(r"^(#{1,6})\s+(.+?)\s*#*$", p.strip())
    if not m or "\n" in p.strip():
        return None
    return len(m.group(1)), clean_markdown(m.group(2))


def fold(s: str) -> str:
    """Lowercase, no diacritics, no punctuation: for comparisons."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[\W_]+", " ", s).strip()


def similarity(a: str, b: str) -> float:
    """Dice coefficient over character bigrams of the folded strings."""
    x, y = fold(a).replace(" ", ""), fold(b).replace(" ", "")
    if not x or not y:
        return 0.0
    if x == y:
        return 1.0
    if len(x) < 2 or len(y) < 2:
        return 0.0
    from collections import Counter

    bx = Counter(x[i:i + 2] for i in range(len(x) - 1))
    by = Counter(y[i:i + 2] for i in range(len(y) - 1))
    common = sum(min(n, by[g]) for g, n in bx.items())
    return 2 * common / (len(x) - 1 + len(y) - 1)


def ends_sentence(s: str) -> bool:
    return bool(re.search(r"[.!?…:;»”\"')\]]\s*(\[\^[^\]]+\]|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?\s*$", (s or "").strip()))


def garbage_ratio(s: str) -> float:
    """Share of «impossible» characters (broken text layer, mojibake, CID)."""
    if not s:
        return 1.0
    odd = len(re.findall(r"[�\x00-\x08\x0e-\x1f]|\(cid:\d+\)|[ÃÂ][\x80-¿]", s))
    letters = sum(1 for c in s if c.isalpha())
    return min(1.0, odd * 4 / max(1, len(s)) + (0.5 if letters / max(1, len(s)) < 0.4 else 0))


def letters(s: str) -> int:
    return sum(1 for c in s if c.isalpha())


_STOP = {
    "es": "de la que el en y a los se del las un por con no una su para es al lo como más pero sus le ya o fue este ha sí porque esta son entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante uno ni contra ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual",
    "en": "the of and to in a is that for it as was with be by on not he i this are or his from at which but have an they you were her she there been one all we their has would when if so no what can more its out into who them these will about some him than then could also only other",
    "fr": "de la le et les des en un une du que est pour qui dans par sur pas au plus ne se ce il sont avec ou son mais comme elle nous vous leur aux cette été je on tout ses lui bien sans",
    "it": "di e il la che in a per un è del non una le si da con i al della sono come anche ma gli più nel lo se alla ha dei delle questo ci",
    "pt": "de a o que e do da em um para é com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso",
    "de": "der die und in den von zu das mit sich des auf für ist im dem nicht ein eine als auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis",
    "la": "et in est non ad cum quod ut qui sed quae de ex esse per enim si nec etiam quam sunt autem ab hoc atque eius vel aut quia tamen ita ergo",
    "ca": "de la i el que a les en del un per amb no una els es al com més però dels seu era pel també molt",
}
_STOPSETS = {k: set(v.split()) for k, v in _STOP.items()}


def detect_language(text: str) -> str | None:
    """Very small stop-word vote; enough to pick the rules and the default language."""
    words = re.findall(r"[^\W\d_]+", (text or "").lower())[:20000]
    if len(words) < 20:
        return None
    scores = {k: sum(1 for w in words if w in s) for k, s in _STOPSETS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] >= max(5, 0.08 * len(words)) else None
