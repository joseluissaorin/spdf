"""Fragments: chunking that respects structure (port of Scholaris `pasos/fragmentos.ts`).

- Never crosses sections.
- Respects paragraphs: a paragraph is only split if it does not fit, and then
  by sentences (or by lines, in verse and drama).
- Aims at 250-450 estimated tokens (contract: ~150-300 words).
- A paragraph that continues on the next page is joined, and the fragment
  carries `anchor` and `anchor_end` (the citation prints «pp. 23-24»).
- Footnotes go with the fragment that calls them ([^n] or superscript); the
  ones nobody calls become their own fragment for the page.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from typing import Optional

from ..model import Fragment, Section, Unit
from ..text import count_tokens, ends_sentence, markdown_title, split_sentences
from .structure import paragraphs_of, path_of


def _looks_continuation(text: str) -> bool:
    return bool(text) and (text[0].islower() or text[0] in "(«\"“,;")


@dataclass
class _Sent:
    text: str
    u0: int
    u1: int
    p0: int
    title: bool = False


@dataclass
class _Para:
    sents: list[_Sent]
    title: bool
    verse: bool
    u0: int
    p0: int


_SUPER = "⁰¹²³⁴⁵⁶⁷⁸⁹"


def _from_super(s: str) -> str:
    return "".join(str(_SUPER.index(c)) for c in s)


def _sentences(text: str, u: int, p: int) -> list[_Sent]:
    if "\n" in text:
        return [_Sent(l.strip(), u, u, p) for l in text.split("\n") if l.strip()]
    return [_Sent(f, u, u, p) for f in split_sentences(text)]


def _split_long(f: _Sent, maximum: int) -> list[_Sent]:
    if count_tokens(f.text) <= maximum:
        return [f]
    pieces: list[_Sent] = []
    cur: list[str] = []
    for w in f.text.split():
        cur.append(w)
        if count_tokens(" ".join(cur)) >= maximum * 0.9:
            pieces.append(_Sent(" ".join(cur), f.u0, f.u1, f.p0))
            cur = []
    if cur:
        pieces.append(_Sent(" ".join(cur), f.u0, f.u1, f.p0))
    last = len(pieces) - 1
    return [_Sent(t.text, f.u0 if i == 0 else (f.u0 if f.u1 == f.u0 else f.u1), f.u1 if i == last else f.u0, f.p0)
            for i, t in enumerate(pieces)]


def _stream(units: list[Unit], sections: list[Section]):
    starts = sorted(sections, key=lambda s: (s.unit_from, s.para_from))
    groups: list[dict] = [{"section": None, "paras": []}]
    si = 0
    prev: Optional[_Para] = None
    for u in units:
        for i, text in enumerate(paragraphs_of(u)):
            changed = False
            while si < len(starts) and (starts[si].unit_from < u.ord or (starts[si].unit_from == u.ord and starts[si].para_from <= i)):
                groups.append({"section": starts[si], "paras": []})
                si += 1
                changed = True
            group = groups[-1]
            t = markdown_title(text)
            if t:
                group["paras"].append(_Para([_Sent(t[1], u.ord, u.ord, i, True)], True, False, u.ord, i))
                prev = None
                continue
            verse = "\n" in text
            if not changed and i == 0 and prev and prev.u0 < u.ord and not prev.verse and not verse:
                last = prev.sents[-1]
                if not ends_sentence(last.text) and _looks_continuation(text):
                    new = _sentences(text, u.ord, i)
                    first = new.pop(0) if new else None
                    if first:
                        joined = last.text[:-1] + first.text if re.search(r"[^\W\d_]-$", last.text) else f"{last.text} {first.text}"
                        prev.sents[-1] = _Sent(joined, last.u0, u.ord, last.p0)
                    prev.sents.extend(new)
                    continue
            p = _Para(_sentences(text, u.ord, i), False, verse, u.ord, i)
            if p.sents:
                group["paras"].append(p)
            prev = p
    return [g for g in groups if g["paras"]]


def _note_label(note: str) -> Optional[str]:
    m = re.match(r"^\s*(?:\[\^([^\]]+)\]:?|([⁰¹²³⁴⁵⁶⁷⁸⁹]+)|(\d{1,3})[.)]?(?=\s)|([*†‡§]+))", note)
    if not m:
        return None
    if m.group(1):
        return m.group(1)
    if m.group(2):
        return _from_super(m.group(2))
    return m.group(3) or m.group(4)


def _calls(text: str) -> list[str]:
    s = set(re.findall(r"\[\^([^\]]+)\]", text))
    for m in re.finditer(r"(?<=[^\W\d_]|[.,;:!?»”\")])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)", text):
        s.add(_from_super(m.group(1)))
    return list(s)


def _anchor_for(by_ord: dict[int, Unit], u: int, p: int) -> dict:
    un = by_ord.get(u)
    a = copy.deepcopy(un.anchor) if un and un.anchor else {"type": "page", "physical": u, "printed": None, "roman": False,
                                                          "foliation": "page", "source": "none", "confidence": 0}
    if a.get("type") in ("section", "web"):
        a["paragraph"] = int(a.get("paragraph") or 0) + p
    return a


def chunk(units: list[Unit], sections: list[Section], doc_id: str, minimum: int = 250, target: int = 350,
          maximum: int = 450) -> list[Fragment]:
    by_id = {s.id: s for s in sections}
    by_ord = {u.ord: u for u in units}
    out: list[Fragment] = []

    for group in _stream(units, sections):
        path = path_of(group["section"], by_id)
        sec_id = group["section"].id if group["section"] else None
        done: list[dict] = []
        cur = {"sents": [], "parts": [], "tokens": 0}

        def close():
            nonlocal cur
            if cur["sents"]:
                done.append({"sents": cur["sents"], "parts": cur["parts"]})
            cur = {"sents": [], "parts": [], "tokens": 0}

        def add(fs: list[_Sent], new_para: bool, verse: bool):
            text = ("\n" if verse else " ").join(f.text for f in fs)
            if new_para or not cur["parts"]:
                cur["parts"].append(text)
            else:
                cur["parts"][-1] += ("\n" if verse else " ") + text
            cur["sents"].extend(fs)
            cur["tokens"] = count_tokens("\n\n".join(cur["parts"]))

        for p in group["paras"]:
            if p.title:
                if cur["tokens"] >= minimum * 0.6:
                    close()
                cur["parts"].append(f"## {p.sents[0].text}")
                cur["sents"].extend(p.sents)
                cur["tokens"] = count_tokens("\n\n".join(cur["parts"]))
                continue
            tp = count_tokens(" ".join(f.text for f in p.sents))
            if cur["tokens"] + tp <= maximum:
                add(p.sents, True, p.verse)
                if cur["tokens"] >= target:
                    close()
                continue
            if cur["tokens"] >= minimum:
                close()
            if cur["tokens"] + tp <= maximum:
                add(p.sents, True, p.verse)
                if cur["tokens"] >= target:
                    close()
                continue
            sents = [x for f in p.sents for x in _split_long(f, maximum)]
            total = cur["tokens"] + tp
            k = max(2, -(-total // target))
            goal = total / k
            first = True
            for f in sents:
                tf = count_tokens(f.text)
                if cur["tokens"] > 0 and (cur["tokens"] + tf > maximum or (cur["tokens"] >= goal * 0.92 and cur["tokens"] + tf / 2 > goal)):
                    close()
                    first = True
                add([f], first, p.verse)
                first = False
            if cur["tokens"] >= target:
                close()
        close()
        if len(done) >= 2:
            last, before = done[-1], done[-2]
            tl = count_tokens("\n\n".join(last["parts"]))
            if tl < minimum * 0.4 and count_tokens("\n\n".join(before["parts"])) + tl <= maximum:
                before["parts"].extend(last["parts"])
                before["sents"].extend(last["sents"])
                done.pop()
        for g in done:
            text = "\n\n".join(g["parts"]).strip()
            if not text or all(x.startswith("## ") for x in g["parts"]):
                continue
            body = [f for f in g["sents"] if not f.title]
            first_s = body[0] if body else g["sents"][0]
            u0 = min(f.u0 for f in (body or g["sents"]))
            u1 = max(f.u1 for f in g["sents"])
            fr = Fragment(id="", ord=0, unit=u0, text=text, section=path, section_id=sec_id,
                          anchor=_anchor_for(by_ord, u0, first_s.p0), tokens=count_tokens(text))
            if u1 != u0:
                fr.unit_end = u1
                fr.anchor_end = _anchor_for(by_ord, u1, 0)
            out.append(fr)

    # Footnotes: with whoever calls them; the rest, apart.
    used: set[str] = set()
    for fr in out:
        ls = _calls(fr.text)
        if not ls:
            continue
        attached = []
        for u in range(fr.unit, (fr.unit_end or fr.unit) + 1):
            un = by_ord.get(u)
            if not un:
                continue
            for i, note in enumerate(un.notes):
                lab = _note_label(note)
                key = f"{u}:{i}"
                if lab and lab in ls and key not in used and count_tokens(note) + fr.tokens <= maximum * 1.6:
                    used.add(key)
                    attached.append(note.strip() if re.match(r"^\s*\[\^", note) else
                                    f"[^{lab}]: " + re.sub(r"^\s*(\d{1,3}[.)]?|[⁰¹²³⁴⁵⁶⁷⁸⁹]+|[*†‡§]+)\s*", "", note))
        if attached:
            fr.text += "\n\n" + "\n".join(attached)
            fr.tokens = count_tokens(fr.text)
    orphans: list[Fragment] = []
    for u in units:
        free = [n for i, n in enumerate(u.notes) if f"{u.ord}:{i}" not in used]
        if not free:
            continue
        ref = next((f for f in reversed(out) if f.unit <= u.ord <= (f.unit_end or f.unit)), None) or \
            next((f for f in reversed(out) if f.unit <= u.ord), None)
        piece: list[str] = []

        def dump():
            if not piece:
                return
            text = "\n".join(piece)
            orphans.append(Fragment(id="", ord=0, unit=u.ord, text=text, section=list(ref.section) if ref else [],
                                    section_id=ref.section_id if ref else None, anchor=_anchor_for(by_ord, u.ord, 0),
                                    tokens=count_tokens(text)))
            piece.clear()

        for note in free:
            if count_tokens("\n".join(piece + [note])) > maximum and piece:
                dump()
            piece.append(note)
        dump()
    allf = list(out)
    for h in orphans:
        pos = len(allf)
        for i in range(len(allf) - 1, -1, -1):
            if allf[i].unit <= h.unit:
                pos = i + 1
                break
        allf.insert(pos, h)
    seen: set[str] = set()
    dedup = []
    for f in allf:
        key = "›".join(f.section) + "|" + f.text
        if len(f.text) > 200 and key in seen:
            continue
        seen.add(key)
        dedup.append(f)
    final = [f for f in dedup if sum(1 for c in f.text if c.isalpha()) >= 12]
    for i, f in enumerate(final):
        f.ord = i + 1
        f.id = f"{doc_id}:f{i + 1}"
        f.text = re.sub(r"\n{3,}", "\n\n", f.text)
    return final


def media_fragments(units: list[Unit], doc_id: str) -> list[Fragment]:
    out = []
    for u in units:
        if not u.text.strip():
            continue
        out.append(Fragment(id=f"{doc_id}:f{len(out) + 1}", ord=len(out) + 1, unit=u.ord, text=u.text,
                            anchor=copy.deepcopy(u.anchor), tokens=count_tokens(u.text)))
    return out
