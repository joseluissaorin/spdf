"""Speakers of a recording.

- When the transcriber separates voices (Gemini, or any engine that labels
  segments), generic labels («Speaker 1», «SPEAKER_00») are replaced by names
  only when the recording itself supports them (the name is said in the
  transcript); the LLM proposes, the transcript must contain the name.
- When it does not (whisper has no diarization), the LLM decides from the
  transcript whether this is a single voice (an audiobook reader, a lecturer)
  and who; only then every unit gets that speaker. Several voices without
  diarization stay unlabeled: nothing is invented.
"""
from __future__ import annotations

import re

from ..text import fold

SINGLE_SCHEMA = {"type": "object", "properties": {
    "single_speaker": {"type": "boolean"}, "speaker": {"type": "string"}, "evidence": {"type": "string"}},
    "required": ["single_speaker", "speaker", "evidence"]}
MAP_SCHEMA = {"type": "object", "properties": {"speakers": {"type": "array", "items": {"type": "object", "properties": {
    "label": {"type": "string"}, "name": {"type": "string"}}, "required": ["label", "name"]}}}, "required": ["speakers"]}

GENERIC = re.compile(r"^(speaker|hablante|locutor|voz|voice|spk)[\s_-]*\d+$", re.I)


def _said(name: str, transcript: str, catalogue: list[str] | None = None) -> bool:
    f = fold(transcript)
    parts = [p for p in fold(name).split() if len(p) > 2]
    if bool(parts) and any(p in f for p in parts[-2:]):
        return True
    joined = fold(name).replace(" ", "")
    return any(joined and joined == fold(c).replace(" ", "") for c in catalogue or [])


def _from_catalogue(name: str, catalogue: list[str] | None) -> str:
    """The transcript hears «Eva Folk»; the catalogue lists the reader as «evafolch»: same first name, a username
    that starts with it and a surname that sounds alike → «Eva Folch»."""
    if not name or not catalogue:
        return name
    toks = fold(name).split()
    if len(toks) < 2:
        return name
    first = toks[0]
    for c in catalogue:
        u = fold(c).replace(" ", "")
        if u.startswith(first) and len(u) > len(first) + 2:
            rest = u[len(first):]
            heard = "".join(toks[1:])
            if rest == heard:
                return name
            import difflib

            if rest[0] == heard[0] and difflib.SequenceMatcher(None, rest, heard).ratio() >= 0.6:
                return " ".join([name.split()[0], rest.capitalize()])
    return name


def name_speakers(units, llm, hints: dict) -> dict:
    transcript = "\n".join(u.text for u in units)
    labels = sorted({u.speaker for u in units if u.speaker} | {s for u in units for s in re.findall(r"\*\*([^*]+):\*\*", u.text)})
    if not labels:
        r = llm.json("You identify who speaks in a recording from its transcript.",
                     f"Recording metadata: {hints}\n\nTranscript (beginning and end):\n{transcript[:3000]}\n…\n{transcript[-1500:]}\n\n"
                     "Is this a single voice (an audiobook read by one person, a lecture)? If so, who is speaking, by the name "
                     "said in the recording (e.g. «read by …», «grabado por …»)? speaker = \"\" if not said.", SINGLE_SCHEMA,
                     max_tokens=300, temperature=0.0)
        name = (r.get("speaker") or "").strip()
        cat = hints.get("catalogue_readers")
        if r.get("single_speaker") and name and _said(name, transcript, cat):
            fixed = _from_catalogue(name, cat)
            if fixed != name:
                name = fixed
            for u in units:
                u.speaker = name
                u.anchor["speaker"] = name
            return {"mode": "single", "speaker": name, "evidence": (r.get("evidence") or "")[:200]}
        return {"mode": "none", "reason": "no diarization and not a single named voice"}
    generic = [l for l in labels if GENERIC.match(l)]
    if not generic:
        return {"mode": "labels", "speakers": labels}
    r = llm.json("You give names to the speaker labels of a transcript, only when the recording says them.",
                 f"Recording metadata: {hints}\n\nTranscript:\n{transcript[:12000]}\n\nFor each label in {generic}, its real name if "
                 "the transcript makes it clear (introductions, «gracias, Joaquín»); otherwise name = \"\".", MAP_SCHEMA,
                 max_tokens=600, temperature=0.0)
    mapping = {}
    for s in r.get("speakers") or []:
        lab, name = (s.get("label") or "").strip(), (s.get("name") or "").strip()
        if lab in generic and name and _said(name, transcript):
            mapping[lab] = name
    if mapping:
        for u in units:
            if u.speaker in mapping:
                u.speaker = mapping[u.speaker]
                u.anchor["speaker"] = u.speaker
            for a, b in mapping.items():
                u.text = u.text.replace(f"**{a}:**", f"**{b}:**")
    return {"mode": "labels", "named": mapping, "unnamed": [l for l in generic if l not in mapping]}
