"""Engine specs → engine objects.

    --engine local|gemini|openai|fake|none   sets the four roles at once
    --embed  embeddinggemma-2@768 | gemini-embedding-2@768 | openai:<model>[@dims] | fake[@dims] | none
    --vision gemma-4-e4b | gemma-4-e2b | gemini[:<model>] | openai:<model> | tesseract | fake | none
    --llm    same as --vision (tesseract excepted)
    --asr    whisper[-large-v3-turbo] | gemini[:<model>] | openai:<model> | fake | none
"""
from __future__ import annotations

import os
import platform
from typing import Optional

from .base import EngineError

PRESETS = {
    "local": {"embed": "embeddinggemma-2@768", "vision": "gemma-4-e4b", "llm": "gemma-4-e4b", "asr": "whisper-large-v3-turbo"},
    "gemini": {"embed": "gemini-embedding-2@768", "vision": "gemini", "llm": "gemini", "asr": "gemini"},
    "openai": {"embed": "openai:" + os.environ.get("SPDF_OPENAI_EMBED", "text-embedding-3-small"),
               "vision": "openai:" + os.environ.get("SPDF_OPENAI_MODEL", "gpt-4o-mini"),
               "llm": "openai:" + os.environ.get("SPDF_OPENAI_MODEL", "gpt-4o-mini"),
               "asr": "openai:" + os.environ.get("SPDF_OPENAI_ASR", "whisper-1")},
    "fake": {"embed": "fake@64", "vision": "fake", "llm": "fake", "asr": "fake"},
    "none": {"embed": "none", "vision": "none", "llm": "none", "asr": "none"},
}


def _dims(spec: str, default: Optional[int]) -> tuple[str, Optional[int], str]:
    dtype = "f32"
    if ":" in spec.split("@")[-1] and "@" in spec:
        spec, dtype = spec.rsplit(":", 1)
    if "@" in spec:
        name, d = spec.rsplit("@", 1)
        return name, int(d), dtype
    return spec, default, dtype


def apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() == "arm64"


_cache: dict[str, object] = {}


def make_embedder(spec: Optional[str], base_url: Optional[str] = None, images: bool = True):
    if not spec or spec == "none":
        return None
    name, dims, _ = _dims(spec, None)
    if name == "fake":
        from .fake import FakeEmbedder

        return FakeEmbedder(dims or 64)
    if name in ("embeddinggemma-2", "embeddinggemma2", "google/embeddinggemma-2"):
        from .local import EmbeddingGemma2

        return EmbeddingGemma2(dims or 768, images=images)
    if name.startswith("gemini"):
        from .gemini import GeminiEmbedder

        return GeminiEmbedder(name if name != "gemini" else "gemini-embedding-2", dims or 768, images=images)
    if name.startswith("openai:"):
        from .openai_compat import OpenAIEmbedder

        return OpenAIEmbedder(name.split(":", 1)[1], dims, base_url)
    raise EngineError(f"unknown embedder: {spec}")


def make_generator(spec: Optional[str], base_url: Optional[str] = None, role: str = "llm"):
    if not spec or spec == "none":
        return None
    if spec in _cache:
        return _cache[spec]
    e: object
    if spec == "fake":
        from .fake import FakeLLM, FakeVision

        e = FakeVision() if role == "vision" else FakeLLM()
        return e
    if spec == "tesseract":
        if role != "vision":
            raise EngineError("tesseract can only read pages (--vision)")
        from .local import Tesseract

        e = Tesseract()
    elif spec.startswith("gemma-4") or spec.startswith("gemma4"):
        variant = spec.replace("gemma4", "gemma-4").split(":")[0]
        if apple_silicon():
            from .local import Gemma4MLX

            e = Gemma4MLX(variant)
        else:
            from .local import Gemma4Transformers

            e = Gemma4Transformers(variant)
    elif spec.startswith("gemini"):
        from .gemini import GeminiLLM

        model = spec.split(":", 1)[1] if ":" in spec else os.environ.get("SPDF_GEMINI_MODEL", "gemini-flash-latest")
        e = GeminiLLM(model)
    elif spec.startswith("openai:"):
        from .openai_compat import OpenAILLM

        e = OpenAILLM(spec.split(":", 1)[1], base_url)
    else:
        raise EngineError(f"unknown {role} engine: {spec}")
    _cache[spec] = e
    return e


def make_asr(spec: Optional[str], base_url: Optional[str] = None):
    if not spec or spec == "none":
        return None
    if spec == "fake":
        from .fake import FakeTranscriber

        return FakeTranscriber()
    if spec.startswith("whisper"):
        from .local import Whisper

        model = spec if spec != "whisper" else "whisper-large-v3-turbo"
        backend = "auto"
        if ":" in model:
            model, backend = model.split(":", 1)
        return Whisper(model, backend)
    if spec.startswith("gemini"):
        from .gemini import GeminiTranscriber

        return GeminiTranscriber(spec.split(":", 1)[1] if ":" in spec else os.environ.get("SPDF_GEMINI_MODEL", "gemini-flash-latest"))
    if spec.startswith("openai:"):
        from .openai_compat import OpenAITranscriber

        return OpenAITranscriber(spec.split(":", 1)[1], base_url)
    raise EngineError(f"unknown transcriber: {spec}")


def availability() -> dict:
    """What can run here, without loading anything heavy."""
    import importlib.util
    import shutil
    from pathlib import Path

    hf = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub"

    def cached(repo: str) -> bool:
        return (hf / ("models--" + repo.replace("/", "--"))).exists()

    return {
        "embeddinggemma-2": {"package": bool(importlib.util.find_spec("sentence_transformers")), "cached": cached("google/embeddinggemma-2")},
        "gemma-4-e4b (mlx)": {"package": bool(importlib.util.find_spec("mlx_vlm")), "cached": cached("mlx-community/gemma-4-e4b-it-4bit")},
        "gemma-4-e2b (mlx)": {"package": bool(importlib.util.find_spec("mlx_vlm")), "cached": cached("mlx-community/gemma-4-e2b-it-4bit")},
        "whisper (mlx)": {"package": bool(importlib.util.find_spec("mlx_whisper")), "cached": cached("mlx-community/whisper-large-v3-turbo")},
        "whisper.cpp": {"binary": bool(shutil.which("whisper-cli")), "model": bool(__import__("spdf_build.engines.local", fromlist=["_find_ggml"])._find_ggml())},
        "tesseract": {"binary": bool(shutil.which("tesseract"))},
        "ffmpeg": {"binary": bool(shutil.which("ffmpeg"))},
        "gemini": {"key": bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))},
        "openai-compatible": {"key": bool(os.environ.get("OPENAI_API_KEY")), "base_url": os.environ.get("OPENAI_BASE_URL")},
        "openalex": {"key": bool(os.environ.get("OPENALEX_API_KEY"))},
    }
