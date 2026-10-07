"""Reference lexical query parsing (contract §6) and rank fusion.

The query is split into quoted phrases and words; terms are sent to FTS5 exactly as
written (NFC), because the ``unicode61 remove_diacritics 2`` tokenizer already folds
case and diacritics. Folding in Python first would break matches (``Straße``).
"""

from __future__ import annotations

import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

__all__ = ["ParsedQuery", "fts_string", "is_cjk", "parse_query", "rrf"]

_OPENERS: dict[str, tuple[str, ...]] = {
    '"': ('"',),
    "“": ("”",),
    "«": ("»",),
    "„": ("“", "”"),
}

_CJK_RANGES: tuple[tuple[int, int], ...] = (
    (0x2E80, 0x2FDF),
    (0x3040, 0x30FF),
    (0x3100, 0x312F),
    (0x3130, 0x318F),
    (0x31A0, 0x31FF),
    (0x3400, 0x4DBF),
    (0x4E00, 0x9FFF),
    (0xA960, 0xA97F),
    (0xAC00, 0xD7AF),
    (0xF900, 0xFAFF),
    (0xFF66, 0xFF9F),
    (0x20000, 0x3FFFF),
)

RRF_K = 10


@dataclass(frozen=True)
class ParsedQuery:
    """Terms of a lexical query. ``phrases`` is true when the terms are quoted phrases (AND)."""

    terms: tuple[str, ...]
    phrases: bool

    @property
    def match(self) -> str:
        """The FTS5 MATCH expression."""
        joiner = " AND " if self.phrases else " OR "
        return joiner.join(fts_string(t) for t in self.terms)


def _is_word_char(ch: str) -> bool:
    return unicodedata.category(ch)[0] in ("L", "M", "N")


def _words(text: str) -> list[str]:
    out: list[str] = []
    cur: list[str] = []
    for ch in text:
        if _is_word_char(ch):
            cur.append(ch)
        elif cur:
            out.append("".join(cur))
            cur = []
    if cur:
        out.append("".join(cur))
    return out


def _dedup_key(term: str) -> str:
    decomposed = unicodedata.normalize("NFD", term)
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn").lower()


def _dedup(terms: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for t in terms:
        k = _dedup_key(t)
        if k in seen:
            continue
        seen.add(k)
        out.append(t)
    return out


def parse_query(query: str) -> ParsedQuery:
    """Split a user query into phrase or word terms following the reference algorithm."""
    q = unicodedata.normalize("NFC", query or "")
    phrases: list[str] = []
    loose: list[str] = []
    i = 0
    buf: list[str] = []
    while i < len(q):
        ch = q[i]
        closers = _OPENERS.get(ch)
        if closers is not None:
            end = -1
            for j in range(i + 1, len(q)):
                if q[j] in closers:
                    end = j
                    break
            if end >= 0:
                loose.append("".join(buf))
                buf = []
                words = _words(q[i + 1 : end])
                if words:
                    phrases.append(" ".join(words))
                i = end + 1
                continue
            # Unclosed opening mark: a separator.
            buf.append(" ")
            i += 1
            continue
        buf.append(ch)
        i += 1
    loose.append("".join(buf))
    if phrases:
        return ParsedQuery(tuple(_dedup(phrases)), True)
    words = [w for chunk in loose for w in _words(chunk)]
    return ParsedQuery(tuple(_dedup(words)), False)


def fts_string(term: str) -> str:
    """Quote a term as an FTS5 string literal."""
    return '"' + term.replace('"', '""') + '"'


def is_cjk(text: str) -> bool:
    """True if ``text`` contains a code point of the CJK ranges of the reference algorithm."""
    for ch in text:
        cp = ord(ch)
        for lo, hi in _CJK_RANGES:
            if lo <= cp <= hi:
                return True
    return False


def rrf(lists: Sequence[Sequence[str]], k: int = RRF_K) -> dict[str, float]:
    """Reciprocal rank fusion: ``Σ 1/(k + rank)`` with 1-based ranks."""
    scores: dict[str, float] = {}
    for ranking in lists:
        for rank, key in enumerate(ranking, start=1):
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
    return scores
