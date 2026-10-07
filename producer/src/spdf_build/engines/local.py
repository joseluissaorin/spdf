"""Local engines: nothing leaves the machine.

- `EmbeddingGemma2`: google/embeddinggemma-2 (Apache 2.0) with
  sentence-transformers. CUDA/MPS in bfloat16, CPU in float32. Never float16:
  the model card warns it returns NaN. Matryoshka truncation 768/512/256/128
  (re-normalized). Task prefixes from the model card: documents
  `title: {title|none} | text: {content}`, queries `task: search result | query: {q}`.
  Images go without prefix (multimodal space).
- `Gemma4MLX`: Gemma 4 E4B/E2B instruct (Apache 2.0) through mlx-vlm on Apple
  silicon, for reading scanned pages, the bibliographic record, context lines
  and figure descriptions. `Gemma4Transformers` is the same with transformers
  on other systems (slower; GGUF through llama.cpp is the other route, served
  with an OpenAI-compatible endpoint: use `openai:` with `--llm-base-url`).
- `Whisper`: mlx-whisper on Apple silicon, else whisper.cpp (`whisper-cli`)
  with a ggml model; word timestamps in both.
- `Tesseract`: classic OCR as a cheap reader without GPU (layout from TSV).
"""
from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

import numpy as np

from .base import EngineError, PAGE_SCHEMA, downscale, l2_normalize, looping, normalize_pages, parse_json_loose, reading_instructions

_LOCK = threading.Lock()

EG2_DIMS = (768, 512, 256, 128)
EG2_PREFIXES = {"query": "task: search result | query: ", "document": "title: {title} | text: "}


def _device(pref: Optional[str] = None):
    import torch

    if pref:
        return pref, (torch.float32 if pref == "cpu" else torch.bfloat16)
    if torch.cuda.is_available():
        return "cuda", (torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32)
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps", torch.bfloat16
    return "cpu", torch.float32


class EmbeddingGemma2:
    provider = "google"
    model = "embeddinggemma-2"
    version = "google/embeddinggemma-2"
    offline = True

    def __init__(self, dims: int = 768, images: bool = True, model_path: Optional[str] = None, device: Optional[str] = None,
                 batch_size: int = 16):
        if dims not in EG2_DIMS:
            raise EngineError(f"embeddinggemma-2 supports {EG2_DIMS} dimensions, not {dims}")
        self.dims = dims
        self.truncated_from = 768 if dims != 768 else None
        self.modalities = ["text", "image"] if images else ["text"]
        self.task_prefixes = dict(EG2_PREFIXES)
        self.path = model_path or os.environ.get("EMBEDDINGGEMMA_MODEL", "google/embeddinggemma-2")
        self.device = device
        self.batch_size = batch_size
        self._m = None

    def _model(self):
        if self._m is None:
            from sentence_transformers import SentenceTransformer

            dev, dtype = _device(self.device)
            cfg = {"audio_config": None}
            if "image" not in self.modalities:
                cfg["vision_config"] = None
            self._m = SentenceTransformer(self.path, device=dev, model_kwargs={"torch_dtype": dtype}, config_kwargs=cfg)
            self.device_used = f"{dev} ({str(dtype).replace('torch.', '')})"
        return self._m

    def _encode(self, items) -> np.ndarray:
        with _LOCK:
            v = self._model().encode(items, normalize_embeddings=True, truncate_dim=self.dims, batch_size=self.batch_size,
                                     convert_to_numpy=True)
        v = np.asarray(v, dtype=np.float32)
        if not np.isfinite(v).all():
            raise EngineError("embeddinggemma-2 returned NaN (float16?)")
        return l2_normalize(v)

    def embed_documents(self, texts, title=None):
        t = (title or "none").replace("|", "/").strip() or "none"
        return self._encode([f"title: {t} | text: {x}" for x in texts]) if texts else np.zeros((0, self.dims), np.float32)

    def embed_query(self, text):
        return self._encode([EG2_PREFIXES["query"] + text])[0]

    def embed_images(self, images):
        from PIL import Image

        if not images:
            return np.zeros((0, self.dims), np.float32)
        items = [{"image": Image.open(io.BytesIO(b)).convert("RGB")} for b in images]
        return self._encode(items)


# ---------------------------------------------------------------------------
# Gemma 4
# ---------------------------------------------------------------------------

GEMMA4_MLX = {"gemma-4-e4b": "mlx-community/gemma-4-e4b-it-4bit", "gemma-4-e2b": "mlx-community/gemma-4-e2b-it-4bit"}
GEMMA4_HF = {"gemma-4-e4b": "google/gemma-4-E4B-it", "gemma-4-e2b": "google/gemma-4-E2B-it"}


class Gemma4MLX:
    offline = True

    def __init__(self, variant: str = "gemma-4-e4b", repo: Optional[str] = None, image_tokens: int = 1120,
                 long_side: int = 1600):
        self.name = variant
        self.model = variant
        self.repo = repo or os.environ.get("GEMMA4_MLX_REPO") or GEMMA4_MLX.get(variant, variant)
        self.image_tokens = image_tokens
        self.long_side = long_side
        self._m = None
        self.stats = {"calls": 0, "prompt_tokens": 0, "generation_tokens": 0, "seconds": 0.0}

    def _load(self):
        if self._m is None:
            from mlx_vlm import load

            model, processor = load(self.repo)
            ip = getattr(processor, "image_processor", None)
            if ip is not None and hasattr(ip, "max_soft_tokens"):
                ip.max_soft_tokens = self.image_tokens
            self._m = (model, processor)
        return self._m

    def generate(self, prompt: str, images: list[tuple[bytes, str]] = (), max_tokens: int = 4096,
                 temperature: float = 0.0) -> str:
        from mlx_vlm import generate
        from mlx_vlm.prompt_utils import apply_chat_template

        model, processor = self._load()
        paths = []
        tmpdir = tempfile.mkdtemp(prefix="spdf-g4-")
        try:
            for i, (data, _mime) in enumerate(images):
                small, _ = downscale(data, self.long_side, 90)
                p = os.path.join(tmpdir, f"{i}.jpg")
                with open(p, "wb") as f:
                    f.write(small)
                paths.append(p)
            formatted = apply_chat_template(processor, model.config, prompt, num_images=len(paths))
            t = time.time()
            with _LOCK:
                r = generate(model, processor, formatted, paths or None, max_tokens=max_tokens, temperature=temperature,
                             verbose=False, repetition_penalty=1.05)
            self.stats["calls"] += 1
            self.stats["seconds"] += time.time() - t
            self.stats["prompt_tokens"] += int(getattr(r, "prompt_tokens", 0) or 0)
            self.stats["generation_tokens"] += int(getattr(r, "generation_tokens", 0) or 0)
            return getattr(r, "text", str(r))
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    # LLM role
    def json(self, system, prompt, schema, images=(), max_tokens=4096, temperature=0.2):
        full = f"{system}\n\n{prompt}\n\nAnswer ONLY with a JSON object that follows this JSON Schema:\n{json.dumps(schema, ensure_ascii=False)}"
        last = None
        for attempt in range(2):
            out = self.generate(full, list(images), max_tokens=max_tokens, temperature=0.0 if attempt == 0 else 0.3)
            try:
                return parse_json_loose(out)
            except EngineError as e:
                last = e
        raise last  # type: ignore[misc]

    # Vision role: one page per call (small models lose track of several pages), tagged output
    # instead of JSON (long transcriptions with quotes break the JSON of a 4B model).
    def read_pages(self, images, first_physical, hint="", language=None):
        out = []
        for i, img in enumerate(images):
            phys = first_physical + i
            page = None
            for attempt in range(2):
                txt = self.generate(tagged_instructions(hint) + ("" if attempt == 0 else "\nWrite each line once, never repeat."),
                                    [img], max_tokens=3000, temperature=0.0 if attempt == 0 else 0.2)
                cand = parse_tagged(txt, phys)
                if not looping(cand["text"]) and (cand["text"] or cand["empty"]):
                    page = cand
                    break
            out.append(page or normalize_pages({}, 1, phys)[0])
        return out

    def describe(self, images, language):
        lang = language or "the language of the document"
        out = []
        for img in images:
            txt = self.generate(f"Describe this image from a document for a search engine in one or two sentences, in {lang}: "
                                f"what is shown, legible text (formulas, labels), kind (diagram, table, photo, engraving, map). "
                                f"No preamble.", [img], max_tokens=200, temperature=0.0)
            out.append(txt.strip().strip('"'))
        return out


TAGGED = """You are an expert palaeographer. Transcribe the page in the image.{hint}
Rules: copy exactly what is printed, keeping the old spelling (dixo, assi, muger, u/v, i/j/y, ç, accents as printed); do
not modernize, translate or correct. The long s (ſ) is written s. Join the lines of a paragraph and rejoin words hyphenated
at line end; blank line between paragraphs; in verse, one verse per line. Read columns left to right.
Answer ONLY with these tags, each on its own lines:
<header>running head, without the page number</header>
<folio>the page number exactly as printed («23», «xiv», «Pag. 1»), or empty if none</folio>
<titles>one per line: level|title (only section titles that start on this page)</titles>
<text>the body of the page</text>
<notes>one footnote per line, with its call first</notes>
<footer>footer, printer's signature and catchword</footer>
<figures>one per line: caption|short description|x,y,w,h (fractions 0-1 of the page)</figures>
<language>BCP-47 code</language>"""


def dehyphenate(text: str) -> str:
    """Small models keep the printed line breaks: join them when the paragraph is clearly hyphenated prose."""
    out = []
    for para in re.split(r"\n\s*\n", text):
        lines = [l.strip() for l in para.split("\n") if l.strip()]
        hyph = sum(1 for l in lines if re.search(r"[^\W\d_][-¬]$", l))
        if len(lines) >= 3 and hyph >= 0.15 * len(lines):
            s = lines[0]
            for l in lines[1:]:
                if re.search(r"[^\W\d_][-¬]$", s) and l[:1].isalpha() and l[:1].islower():
                    s = s[:-1] + l
                else:
                    s += " " + l
            out.append(s)
        else:
            out.append("\n".join(lines))
    return "\n\n".join(out)


def tagged_instructions(hint: str = "") -> str:
    return TAGGED.replace("{hint}", f" Document: {hint}." if hint else "")


def _tag(txt: str, name: str) -> str:
    m = re.search(rf"<{name}>(.*?)(?:</{name}>|(?=<(?:header|folio|titles|text|notes|footer|figures|language)>)|$)", txt, re.S)
    return m.group(1).strip() if m else ""


def parse_tagged(txt: str, phys: int) -> dict:
    t = re.sub(r"^```\w*|```$", "", txt.strip()).strip()
    titles = []
    for line in _tag(t, "titles").splitlines():
        if "|" in line:
            lv, tt = line.split("|", 1)
            try:
                titles.append({"level": int(lv.strip() or 1), "text": tt.strip()})
            except ValueError:
                titles.append({"level": 1, "text": line.strip()})
    figs = []
    for line in _tag(t, "figures").splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) == 3:
            nums = re.findall(r"[\d.]+", parts[2])
            if len(nums) == 4:
                figs.append({"caption": parts[0], "description": parts[1], "region": dict(zip("xywh", map(float, nums)))})
    text = dehyphenate(_tag(t, "text"))
    obj = {"pages": [{"physical": 1, "header": _tag(t, "header"), "folio": _tag(t, "folio"), "titles": titles, "text": text,
                      "notes": [l for l in _tag(t, "notes").splitlines() if l.strip()], "footer": _tag(t, "footer"),
                      "figures": figs, "language": _tag(t, "language"), "empty": not text.strip(), "confidence": 0.7}]}
    return normalize_pages(obj, 1, phys)[0]


def _salvage_page(txt: str) -> dict:
    """When the JSON is broken (often an unescaped quote), keep at least the fields that parse."""
    page: dict = {"physical": None}
    for k in ("header", "folio", "footer", "language"):
        m = re.search(rf'"{k}"\s*:\s*"((?:[^"\\]|\\.)*)"', txt)
        if m:
            page[k] = m.group(1).encode("utf-8").decode("unicode_escape", "ignore") if "\\u" in m.group(1) else m.group(1)
    m = re.search(r'"text"\s*:\s*"(.*?)"\s*,\s*"(?:notes|footer|figures|language|confidence)"', txt, re.S)
    if m:
        page["text"] = m.group(1).replace("\\n", "\n").replace('\\"', '"')
    page["confidence"] = 0.5
    return {"pages": [page]}


class Gemma4Transformers(Gemma4MLX):
    """Gemma 4 through transformers (CUDA/MPS/CPU)."""

    def __init__(self, variant: str = "gemma-4-e4b", repo: Optional[str] = None, image_tokens: int = 1120, long_side: int = 1600):
        super().__init__(variant, repo or GEMMA4_HF.get(variant, variant), image_tokens, long_side)

    def _load(self):
        if self._m is None:
            from transformers import AutoModelForImageTextToText, AutoProcessor

            dev, dtype = _device()
            proc = AutoProcessor.from_pretrained(self.repo)
            model = AutoModelForImageTextToText.from_pretrained(self.repo, torch_dtype=dtype).to(dev)
            self._m = (model, proc)
        return self._m

    def generate(self, prompt, images=(), max_tokens=4096, temperature=0.0):
        from PIL import Image

        model, proc = self._load()
        content = [{"type": "image", "image": Image.open(io.BytesIO(downscale(d, self.long_side)[0]))} for d, _ in images]
        content.append({"type": "text", "text": prompt})
        msgs = [{"role": "user", "content": content}]
        inputs = proc.apply_chat_template(msgs, add_generation_prompt=True, tokenize=True, return_dict=True,
                                          return_tensors="pt").to(model.device)
        t = time.time()
        with _LOCK:
            ids = model.generate(**inputs, max_new_tokens=max_tokens, do_sample=temperature > 0,
                                 temperature=temperature if temperature > 0 else None)
        self.stats["calls"] += 1
        self.stats["seconds"] += time.time() - t
        new = ids[0][inputs["input_ids"].shape[-1]:]
        return proc.decode(new, skip_special_tokens=True)


# ---------------------------------------------------------------------------
# Whisper
# ---------------------------------------------------------------------------


def _find_ggml() -> Optional[str]:
    env = os.environ.get("SPDF_WHISPER_GGML")
    if env and Path(env).exists():
        return env
    for d in (Path.home() / "filmlab" / "modelos", Path.home() / ".cache" / "whisper", Path("/opt/homebrew/share/whisper-cpp")):
        if d.is_dir():
            for pat in ("ggml-large-v3-turbo*.bin", "ggml-large-v3*.bin", "ggml-*.bin"):
                hits = sorted(d.glob(pat))
                if hits:
                    return str(hits[0])
    return None


class Whisper:
    offline = True

    def __init__(self, model: str = "whisper-large-v3-turbo", backend: str = "auto"):
        self.model = model
        self.name = model
        self.backend = backend
        if backend == "auto":
            try:
                import mlx_whisper  # noqa: F401

                self.backend = "mlx"
            except Exception:
                self.backend = "cpp"
        self.repo = os.environ.get("SPDF_WHISPER_MLX_REPO", f"mlx-community/{model}")

    def transcribe(self, wav_path, language=None):
        if self.backend == "mlx":
            import mlx_whisper

            with _LOCK:
                r = mlx_whisper.transcribe(wav_path, path_or_hf_repo=self.repo, word_timestamps=True, language=language,
                                           condition_on_previous_text=False, verbose=None)
            segs = []
            for s in r.get("segments", []):
                words = [{"w": w["word"].strip(), "t0": float(w["start"]), "t1": float(w["end"]),
                          "p": float(w.get("probability", 1.0))} for w in s.get("words", []) if w.get("word", "").strip()]
                segs.append({"t0": float(s["start"]), "t1": float(s["end"]), "text": s["text"].strip(), "words": words,
                             "speaker": None})
            return {"language": r.get("language") or language, "segments": segs, "backend": f"mlx-whisper:{self.repo}"}
        exe = shutil.which("whisper-cli") or shutil.which("whisper-cpp")
        model = _find_ggml()
        if not exe or not model:
            raise EngineError("whisper: neither mlx-whisper nor whisper-cli with a ggml model is available "
                              "(set SPDF_WHISPER_GGML)")
        with tempfile.TemporaryDirectory() as d:
            base = os.path.join(d, "out")
            cmd = [exe, "-m", model, "-f", wav_path, "-ojf", "-of", base, "-ml", "1", "-sow", "-np"]
            if language:
                cmd += ["-l", language]
            else:
                cmd += ["-l", "auto"]
            subprocess.run(cmd, check=True, capture_output=True)
            data = json.loads(Path(base + ".json").read_text("utf-8", errors="replace"))
        words = []
        for item in data.get("transcription", []):
            w = item.get("text", "").strip()
            if not w:
                continue
            off = item.get("offsets", {})
            words.append({"w": w, "t0": off.get("from", 0) / 1000, "t1": off.get("to", 0) / 1000})
        segs = _words_to_segments(words)
        return {"language": (data.get("result") or {}).get("language") or language, "segments": segs,
                "backend": f"whisper.cpp:{Path(model).name}"}


def _words_to_segments(words: list[dict], max_len: float = 30.0) -> list[dict]:
    segs, cur = [], []
    for w in words:
        cur.append(w)
        if re.search(r"[.!?…]$", w["w"]) or (cur[-1]["t1"] - cur[0]["t0"]) > max_len:
            segs.append({"t0": cur[0]["t0"], "t1": cur[-1]["t1"], "text": " ".join(x["w"] for x in cur), "words": cur,
                         "speaker": None})
            cur = []
    if cur:
        segs.append({"t0": cur[0]["t0"], "t1": cur[-1]["t1"], "text": " ".join(x["w"] for x in cur), "words": cur, "speaker": None})
    return segs


# ---------------------------------------------------------------------------
# Tesseract
# ---------------------------------------------------------------------------


class Tesseract:
    """Classic OCR (no GPU). Header and footer from the line positions."""

    offline = True
    name = "tesseract"

    def __init__(self, languages: str = "spa+lat+eng"):
        self.exe = shutil.which("tesseract")
        if not self.exe:
            raise EngineError("tesseract is not installed")
        out = subprocess.run([self.exe, "--list-langs"], capture_output=True, text=True).stdout.split()
        have = set(out[1:]) if out else set()
        self.languages = "+".join(l for l in languages.split("+") if l in have) or "eng"
        self.model = f"tesseract-{self.languages}"
        try:
            self.version = subprocess.run([self.exe, "--version"], capture_output=True, text=True).stdout.split()[1]
        except Exception:
            self.version = None

    def read_pages(self, images, first_physical, hint="", language=None):
        out = []
        for i, (data, _mime) in enumerate(images):
            out.append(self._page(data, first_physical + i))
        return out

    def _page(self, data: bytes, phys: int) -> dict:
        from PIL import Image

        im = Image.open(io.BytesIO(data)).convert("L")
        W, H = im.size
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "p.png")
            im.save(p)
            tsv = subprocess.run([self.exe, p, "stdout", "-l", self.languages, "--psm", "3", "tsv"], capture_output=True,
                                 text=True).stdout
        lines: dict[tuple, dict] = {}
        confs = []
        for row in tsv.splitlines()[1:]:
            c = row.split("\t")
            if len(c) < 12 or c[0] != "5" or not c[11].strip():
                continue
            key = (int(c[2]), int(c[3]), int(c[4]))
            x, y, w, h, conf = int(c[6]), int(c[7]), int(c[8]), int(c[9]), float(c[10])
            l = lines.setdefault(key, {"words": [], "y0": y, "y1": y + h, "x0": x})
            l["words"].append(c[11])
            l["y0"], l["y1"], l["x0"] = min(l["y0"], y), max(l["y1"], y + h), min(l["x0"], x)
            if conf >= 0:
                confs.append(conf)
        header, footer, body = [], [], []
        paras: dict[tuple, list[str]] = {}
        for key in sorted(lines, key=lambda k: (lines[k]["y0"], lines[k]["x0"])):
            l = lines[key]
            text = " ".join(l["words"])
            if l["y1"] <= 0.09 * H:
                header.append(text)
            elif l["y0"] >= 0.91 * H:
                footer.append(text)
            else:
                paras.setdefault(key[:2], []).append(text)
        from ..text import join_lines

        body = [join_lines("\n".join(ls)) for ls in paras.values()]
        text = "\n\n".join(b for b in body if b)
        return {"physical": phys, "text": text, "notes": [], "header": " / ".join(header), "footer": " / ".join(footer),
                "folio": "", "titles": [], "figures": [], "empty": not text.strip(), "language": "",
                "confidence": round((sum(confs) / len(confs) / 100) if confs else 0.0, 3)}

    def describe(self, images, language):
        return ["" for _ in images]
