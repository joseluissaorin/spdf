"""Audio and video: decode with ffmpeg, transcribe, segment into citable units, key frames.

- Audio is decoded to mono 16 kHz WAV (what whisper and EmbeddingGemma 2 expect).
- The transcript is cut into units of 30-60 s at sentence ends, preferring a
  change of speaker once past the minimum (Scholaris `pasos/medios.ts`).
  Each unit carries word timings `{"v":1,"t0":…,"cs":[start,dur,…]}` in
  centiseconds from t0, one pair per whitespace token of the unit text (speaker
  labels excluded).
- Video key frames: scene changes (luminance difference) at least 3 s apart, or
  one every 20 s; each frame is attached to the unit that contains it.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from typing import Optional

from ..model import Source, Unit


def ffprobe(path: str) -> dict:
    exe = shutil.which("ffprobe")
    if not exe:
        raise RuntimeError("ffprobe is not installed (needed for audio and video)")
    r = subprocess.run([exe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], capture_output=True,
                       text=True, check=True)
    return json.loads(r.stdout)


def decode_wav(path: str, out: str, t0: Optional[float] = None, dur: Optional[float] = None) -> str:
    cmd = [shutil.which("ffmpeg") or "ffmpeg", "-nostdin", "-v", "error", "-y"]
    if t0 is not None:
        cmd += ["-ss", f"{t0:.3f}"]
    cmd += ["-i", path]
    if dur is not None:
        cmd += ["-t", f"{dur:.3f}"]
    cmd += ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out]
    subprocess.run(cmd, check=True, capture_output=True)
    return out


def key_frames(path: str, duration: float, outdir: str, min_gap: float = 3.0, period: float = 20.0,
               threshold: float = 0.3, long_side: int = 960) -> list[tuple[float, str]]:
    """Scene-change frames (ffmpeg `select=gt(scene,…)`) plus periodic ones, thinned to `min_gap`."""
    ff = shutil.which("ffmpeg") or "ffmpeg"
    pattern = os.path.join(outdir, "scene_%05d.jpg")
    r = subprocess.run([ff, "-nostdin", "-v", "info", "-i", path, "-vf",
                        f"select='gt(scene,{threshold})',showinfo,scale='if(gt(iw,ih),{long_side},-2)':'if(gt(iw,ih),-2,{long_side})'",
                        "-vsync", "vfr", "-q:v", "4", pattern], capture_output=True, text=True)
    times = [float(m.group(1)) for m in re.finditer(r"pts_time:([\d.]+)", r.stderr)]
    scenes = sorted((t, os.path.join(outdir, f"scene_{i + 1:05d}.jpg")) for i, t in enumerate(times)
                    if os.path.exists(os.path.join(outdir, f"scene_{i + 1:05d}.jpg")))
    chosen: list[tuple[float, str]] = []
    for t, p in scenes:
        if not chosen or t - chosen[-1][0] >= min_gap:
            chosen.append((t, p))
    # periodic frames to fill gaps longer than `period`
    fill = []
    marks = [0.0] + [t for t, _ in chosen] + [duration]
    for a, b in zip(marks, marks[1:]):
        t = a + period
        while t < b - min_gap:
            fill.append(t)
            t += period
    if not chosen:
        fill = [min(1.0, duration / 2)] + fill
    for k, t in enumerate(fill):
        p = os.path.join(outdir, f"periodic_{k:05d}.jpg")
        subprocess.run([ff, "-nostdin", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1", "-vf",
                        f"scale='if(gt(iw,ih),{long_side},-2)':'if(gt(iw,ih),-2,{long_side})'", "-q:v", "4", p], capture_output=True)
        if os.path.exists(p):
            chosen.append((t, p))
    return sorted(chosen)


CLOSE = re.compile(r"^[,.;:!?…»”)\]]+$")
OPEN = re.compile(r"^[«“(¿¡\[]+$")


def tokens_of(words: list[dict]) -> list[dict]:
    """ASR words as text tokens: detached punctuation glued, so each whitespace token has one time."""
    out: list[dict] = []
    opening: Optional[dict] = None
    for w in words:
        pieces = str(w["w"]).strip().split()
        if not pieces:
            continue
        d = (w["t1"] - w["t0"]) / len(pieces)
        for k, p in enumerate(pieces):
            tok = {"w": p, "t0": w["t0"] + d * k, "t1": w["t0"] + d * (k + 1), "speaker": w.get("speaker")}
            if CLOSE.match(p) and out and not opening:
                out[-1]["w"] += p
                out[-1]["t1"] = max(out[-1]["t1"], tok["t1"])
                continue
            if opening:
                tok["w"] = opening["w"] + tok["w"]
                tok["t0"] = opening["t0"]
                opening = None
            if OPEN.match(p):
                opening = tok
                continue
            out.append(tok)
    if opening:
        out.append(opening)
    return out


def sentences_of(words: list[dict]) -> list[dict]:
    punct = any(re.search(r"[.!?][\"»”)]*$", w["w"]) for w in words)
    out, cur = [], []

    def close():
        nonlocal cur
        if cur:
            toks = tokens_of(cur)
            if toks:
                out.append({"text": " ".join(t["w"] for t in toks), "t0": cur[0]["t0"], "t1": cur[-1]["t1"],
                            "speaker": cur[0].get("speaker"), "tokens": toks})
        cur = []

    for i, w in enumerate(words):
        if cur and w.get("speaker") is not None and cur[-1].get("speaker") != w.get("speaker"):
            close()
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        pause = (nxt["t0"] - w["t1"]) if nxt else 0
        if (re.search(r"[.!?…][\"»”)]*$", w["w"]) if punct else pause > 0.7) or pause > 2.5:
            close()
    close()
    return out


def compact_words(tokens: list[dict], t0: float) -> dict:
    base = round(t0 * 100)
    cs: list[int] = []
    for t in tokens:
        a = max(0, round(t["t0"] * 100) - base)
        cs += [a, max(1, round(t["t1"] * 100) - base - a)]
    return {"v": 1, "t0": base / 100, "cs": cs}


def segment(words: list[dict], minimum: float = 30, target: float = 45, maximum: float = 60, reader: str = "asr",
            confidence: float = 0.9) -> list[Unit]:
    sents = sentences_of(words)
    groups: list[list[dict]] = []
    g: list[dict] = []
    for s in sents:
        if g:
            dur = s["t1"] - g[0]["t0"]
            change = s.get("speaker") is not None and g[-1].get("speaker") != s.get("speaker")
            cur = g[-1]["t1"] - g[0]["t0"]
            if dur > maximum or cur >= target or (change and cur >= minimum):
                groups.append(g)
                g = []
        g.append(s)
    if g:
        dg = g[-1]["t1"] - g[0]["t0"]
        if groups and dg < minimum / 2 and g[-1]["t1"] - groups[-1][0]["t0"] <= maximum * 1.25:
            groups[-1] += g
        else:
            groups.append(g)
    units = []
    for i, fr in enumerate(groups):
        t0, t1 = fr[0]["t0"], fr[-1]["t1"]
        by_spk: dict[str, float] = {}
        for s in fr:
            if s.get("speaker"):
                by_spk[s["speaker"]] = by_spk.get(s["speaker"], 0) + (s["t1"] - s["t0"])
        speaker = max(by_spk, key=by_spk.get) if by_spk else None
        several = len(by_spk) > 1
        lines: list[str] = []
        turn = None
        for s in fr:
            if several and s.get("speaker") != turn:
                lines.append(f"**{s.get('speaker') or '?'}:** {s['text']}")
                turn = s.get("speaker")
            elif lines:
                lines[-1] += " " + s["text"]
            else:
                lines.append(s["text"])
        toks = [t for s in fr for t in s["tokens"]]
        u = Unit(ord=i + 1, kind="time", text="\n\n".join(lines), reader=reader, confidence=confidence,
                 t0=round(t0, 2), t1=round(t1, 2), speaker=speaker)
        u.anchor = {"type": "time", "t0": round(t0, 2), "t1": round(t1, 2)}
        if speaker:
            u.anchor["speaker"] = speaker
        u.words = compact_words(toks, round(t0, 2))  # type: ignore[assignment]
        units.append(u)
    return units


def read_media(data: bytes, path: str, kind: str, transcriber, language: Optional[str] = None, frames: bool = True,
               chunk: float = 600.0, log=None) -> Source:
    info = ffprobe(path)
    duration = float((info.get("format") or {}).get("duration") or 0)
    tags = {k.lower(): v for k, v in ((info.get("format") or {}).get("tags") or {}).items()}
    hints = {}
    if tags.get("title"):
        hints["title"] = tags["title"]
    if tags.get("artist"):
        hints["performer"] = tags["artist"]
    if tags.get("album"):
        hints["container"] = tags["album"]
    if tags.get("date") or tags.get("year"):
        hints["date"] = tags.get("date") or tags.get("year")
    if tags.get("language"):
        hints["language"] = tags["language"]
    mime = {"audio": "audio/mpeg", "video": "video/mp4"}[kind]
    ext = os.path.splitext(path)[1].lower()
    mime = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac",
            ".m4a": "audio/mp4", ".aac": "audio/aac", ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
            ".webm": "video/webm", ".avi": "video/x-msvideo"}.get(ext, mime)
    tmp = tempfile.mkdtemp(prefix="spdf-media-")
    words: list[dict] = []
    lang = language
    backend = None
    word_timing = "asr"
    try:
        # chunks with 2 s overlap; words in the overlap belong to the previous chunk
        t = 0.0
        k = 0
        while t < duration - 0.5 or k == 0:
            dur = min(chunk + 2.0, duration - t) if duration else None
            wav = decode_wav(path, os.path.join(tmp, f"c{k}.wav"), t if k else None, dur)
            r = transcriber.transcribe(wav, lang)
            lang = lang or r.get("language")
            backend = r.get("backend")
            word_timing = r.get("word_timing", word_timing)
            for s in r.get("segments", []):
                spk = s.get("speaker")
                for w in s.get("words") or []:
                    w = dict(w)
                    w["t0"] += t
                    w["t1"] += t
                    if k and w["t0"] < t + 1.0:  # overlap with the previous chunk
                        continue
                    if spk and not w.get("speaker"):
                        w["speaker"] = f"{spk}" if spk else None
                    words.append(w)
            if log:
                log(f"transcribed {min(duration, t + chunk):.0f}/{duration:.0f} s")
            k += 1
            t += chunk
            if not duration:
                break
        words.sort(key=lambda w: w["t0"])
        units = segment(words, reader=getattr(transcriber, "model", "asr"))
        if kind == "video" and frames:
            fdir = os.path.join(tmp, "frames")
            os.makedirs(fdir, exist_ok=True)
            for ft, fp in key_frames(path, duration, fdir):
                u = next((u for u in units if (u.t0 or 0) <= ft <= (u.t1 or 0) + 0.01), None)
                if u is None and units:
                    u = min(units, key=lambda x: abs((x.t0 or 0) - ft))
                if u is None:
                    continue
                img = open(fp, "rb").read()
                if u.image is None:
                    u.image = img
                    u.image_mime = "image/jpeg"
                    u.extra["frame_t"] = ft
                else:
                    from ..model import FigureRead

                    u.figures.append(FigureRead(caption="", description="", region=None, image=img))
                    u.figures[-1].mime = "image/jpeg"
                    u.extra.setdefault("frame_times", []).append(ft)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    src = Source(path=path, kind=kind, mime=mime, data=data, units=units, hints=hints, duration=duration)
    src.provenance_note = {"duration": duration, "words": len(words), "backend": backend, "language": lang,  # type: ignore[attr-defined]
                           "word_timing": word_timing}
    if lang:
        src.hints.setdefault("language_detected", lang)
    return src
