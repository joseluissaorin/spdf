"""Context lines: one line that situates each fragment in the work (contextual retrieval).

One LLM call per group of consecutive fragments of the same section (12 at
most, ~30 000 characters): the section text goes once and the model writes all
lines at once. What the model does not give (safety filters on literary texts,
errors, `--no-llm`) gets an extractive line: title, authors, year, section and
place. Port of Scholaris `pasos/contexto.ts`.
"""
from __future__ import annotations

import concurrent.futures as cf
from typing import Optional

from ..model import Fragment

SCHEMA = {
    "type": "object",
    "properties": {"contexts": {"type": "array", "items": {"type": "object", "properties": {
        "n": {"type": "integer"}, "context": {"type": "string"}}, "required": ["n", "context"]}}},
    "required": ["contexts"],
}


def describe_anchor(a: dict) -> str:
    t = a.get("type")
    if t == "page":
        return f"p. {a['printed']}" if a.get("printed") else f"physical page {a.get('physical')}"
    if t == "time":
        s = int(a.get("t0") or 0)
        return f"{s // 60}:{s % 60:02d}" + (f", {a['speaker']}" if a.get("speaker") else "")
    if t == "slide":
        return f"slide {a.get('n')}"
    if t == "sheet":
        return f"{a.get('sheet')}, rows {a.get('row_from')}-{a.get('row_to')}"
    if t in ("section", "web"):
        return " › ".join(a.get("path") or [])
    return ""


def _names(meta: dict) -> str:
    out = []
    for a in meta.get("author") or []:
        out.append(a.get("literal") or " ".join(x for x in (a.get("given"), a.get("dropping-particle"), a.get("family")) if x))
    return ", ".join(out)


def _year(meta: dict) -> Optional[int]:
    try:
        return int(meta["issued"]["date-parts"][0][0])
    except Exception:
        return None


def extractive(f: Fragment, meta: dict) -> str:
    parts = [f"«{meta.get('title', '')}»", _names(meta), str(_year(meta) or ""), " › ".join(f.section), describe_anchor(f.anchor)]
    return ", ".join(p for p in parts if p) + "."


def groups(fragments: list[Fragment], max_chars: int = 30_000, max_frag: int = 12) -> list[list[Fragment]]:
    out: list[list[Fragment]] = []
    key = None
    chars = 0
    for f in fragments:
        k = f.section_id or " › ".join(f.section)
        if not out or k != key or chars + len(f.text) > max_chars or len(out[-1]) >= max_frag:
            out.append([])
            key = k
            chars = 0
        out[-1].append(f)
        chars += len(f.text)
    return out


def contextualize(fragments: list[Fragment], meta: dict, llm, concurrency: int = 8, log=None) -> dict:
    lang = meta.get("language") or "the language of the text"
    title = meta.get("title", "")
    work = " ".join(x for x in (f"«{title}»", f"by {_names(meta)}" if _names(meta) else "", f"({_year(meta)})" if _year(meta) else "") if x)
    system = ("For each fragment of a work you write ONE short line (15-35 words) that situates it for a search engine: which "
              "work and part it belongs to, who speaks or what it is about, and what pronouns or ellipses refer to («he», "
              "«this method», «the queen»). Do not summarize the whole work or repeat the fragment; invent nothing that is not "
              f"in the text. Write in the language «{lang}».")
    gs = groups(fragments)
    done = {"groups": len(gs), "failed": 0}

    def one(g: list[Fragment]) -> dict[str, str]:
        body = "\n".join(f"<fragment n=\"{i + 1}\" place=\"{describe_anchor(f.anchor)}\">\n{f.text}\n</fragment>" for i, f in enumerate(g))
        prompt = (f"Work: {work}\nSection: {' › '.join(g[0].section) or '(untitled)'}\n\n{body}\n\n"
                  f"Return one context line for each of the {len(g)} fragments, with its number n.")
        r = llm.json(system, prompt, SCHEMA, max_tokens=min(8192, 200 + len(g) * 120), temperature=0.2)
        out = {}
        for c in (r or {}).get("contexts") or []:
            try:
                f = g[int(c["n"]) - 1]
            except Exception:
                continue
            t = " ".join(str(c.get("context") or "").split())
            if t:
                out[f.id] = t
        return out

    result: dict[str, str] = {}
    workers = concurrency if not getattr(llm, "offline", False) else 1
    with cf.ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        futs = {ex.submit(one, g): g for g in gs}
        for fut in cf.as_completed(futs):
            try:
                result.update(fut.result())
            except Exception as e:
                done["failed"] += 1
                if log:
                    log(f"context: a group failed ({str(e)[:120]})")
    done["covered"] = len(result)
    return {"contexts": result, "detail": done}
