"""Builds models/manifest.json from the Hugging Face API.

Every URL is pinned to a repository revision (commit), every file carries its size and SHA-256
(the LFS oid for large files; small files are downloaded and hashed). Run:

    python -I models/tools/build_manifest.py            # writes models/manifest.json
    python -I models/tools/build_manifest.py --check    # fails if the published files changed
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

MODELS = Path(__file__).resolve().parents[1]
HF = "https://huggingface.co"
UA = {"User-Agent": "spdf-models-manifest/0.1 (https://github.com/joseluissaorin/spdf)"}

# Pinned revisions (update deliberately, then re-run the bench for the embedders).
REV = {
    "google/embeddinggemma-2": "914f7f89142e33e77833254d9c9b90c3cef7303b",
    "ggml-org/embeddinggemma-2-GGUF": "bfcd298762cc34d0357ece5ebdd31791a3a374d8",
    "onnx-community/embeddinggemma-2-ONNX": "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
    "mlx-community/embeddinggemma-2-bf16": None,
    "mlx-community/embeddinggemma-2-8bit": "7505ef2f8ddef45efef6d060865f27989b3c9cec",
    "mlx-community/embeddinggemma-2-4bit": None,
    "litert-community/embeddinggemma-2-text-270m-litert-lm": "9be6e8b90982095dc05c2bd162e4b954ee4dbac7",
    "litert-community/embeddinggemma-2-text-vision-440m-litert-lm": None,
    "litert-community/embeddinggemma-2-740m-litert-lm": None,
    "unsloth/gemma-4-E2B-it-GGUF": "0314792d7f1f7e229411f620751375812bb9faf2",
    "unsloth/gemma-4-E4B-it-GGUF": "bfc15c382204943c3a8fff0c750b94ae2364d7a3",
    "litert-community/gemma-4-E2B-it-litert-lm": "b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1",
    "litert-community/gemma-4-E4B-it-litert-lm": "2eee7ac325f20eb8c9ac1d0e972f7c84663062da",
    "lmstudio-community/gemma-4-E2B-it-MLX-4bit": "31512dab743c73974a99795270031a6f85072d94",
    "lmstudio-community/gemma-4-E4B-it-MLX-4bit": "ce713a0013bb7090305edfb8e3773a07ccae35c1",
    "onnx-community/gemma-4-E2B-it-ONNX": "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6",
    "Valen-Team/Valen-0.8B": "4c858f2e26f4978640fa3f6d0de26a75b790b661",
}

APACHE = ("Apache-2.0", "https://www.apache.org/licenses/LICENSE-2.0")
NATIVE = ["macos", "windows", "linux", "ios", "android"]
EG2_VERSION = "914f7f89"
ONNX_SMALL = ["config.json", "config_sentence_transformers.json", "preprocessor_config.json", "processor_config.json",
              "tokenizer.json", "tokenizer_config.json"]


def onnx_files(dtype_sfx: str, encoders=("model", "vision_encoder", "audio_encoder")):
    out = [(r, r) for r in ONNX_SMALL]
    for enc in encoders:
        out.append(("onnx", f"onnx/{enc}{dtype_sfx}.onnx"))
        out.append(("onnx_data", f"onnx/{enc}{dtype_sfx}.onnx_data"))
    return out


# id, name, family, kinds, engine, format, repo, [(role, path)], modalities, platforms, min_memory_mb, extra
ENTRIES = [
    # ---- EmbeddingGemma 2, native (llama.cpp) ----
    dict(id="embeddinggemma-2-gguf-q8_0", name="EmbeddingGemma 2 · GGUF Q8_0 + mmproj Q8_0 (texto, imagen, audio)",
         family="embeddinggemma-2", kinds=["embed"], engine="llama.cpp", format="gguf", repo="ggml-org/embeddinggemma-2-GGUF",
         files=[("model", "embeddinggemma-2-Q8_0.gguf"), ("mmproj", "mmproj-embeddinggemma-2-Q8_0.gguf")],
         modalities=["text", "image", "audio"], platforms=NATIVE, min_memory_mb=1400, space_version=EG2_VERSION),
    dict(id="embeddinggemma-2-gguf-q8_0-text", name="EmbeddingGemma 2 · GGUF Q8_0, solo texto",
         family="embeddinggemma-2", kinds=["embed"], engine="llama.cpp", format="gguf", repo="ggml-org/embeddinggemma-2-GGUF",
         files=[("model", "embeddinggemma-2-Q8_0.gguf")], modalities=["text"], platforms=NATIVE, min_memory_mb=500,
         space_version=EG2_VERSION),
    dict(id="embeddinggemma-2-gguf-bf16", name="EmbeddingGemma 2 · GGUF BF16 + mmproj BF16",
         family="embeddinggemma-2", kinds=["embed"], engine="llama.cpp", format="gguf", repo="ggml-org/embeddinggemma-2-GGUF",
         files=[("model", "embeddinggemma-2-BF16.gguf"), ("mmproj", "mmproj-embeddinggemma-2-BF16.gguf")],
         modalities=["text", "image", "audio"], platforms=["macos", "windows", "linux"], min_memory_mb=2200, space_version=EG2_VERSION),
    # ---- EmbeddingGemma 2, web (transformers.js) ----
    dict(id="embeddinggemma-2-onnx-q8", name="EmbeddingGemma 2 · ONNX q8 (WASM y WebGPU)",
         family="embeddinggemma-2", kinds=["embed"], engine="transformers.js", format="onnx", repo="onnx-community/embeddinggemma-2-ONNX",
         files=onnx_files("_quantized"), modalities=["text", "image", "audio"], platforms=["web"], min_memory_mb=1500,
         space_version=EG2_VERSION, dtype="q8"),
    dict(id="embeddinggemma-2-onnx-q8-text", name="EmbeddingGemma 2 · ONNX q8, solo texto",
         family="embeddinggemma-2", kinds=["embed"], engine="transformers.js", format="onnx", repo="onnx-community/embeddinggemma-2-ONNX",
         files=onnx_files("_quantized", ("model",)), modalities=["text"], platforms=["web"], min_memory_mb=700,
         space_version=EG2_VERSION, dtype="q8"),
    dict(id="embeddinggemma-2-onnx-fp16", name="EmbeddingGemma 2 · ONNX fp16 (WebGPU)",
         family="embeddinggemma-2", kinds=["embed"], engine="transformers.js", format="onnx", repo="onnx-community/embeddinggemma-2-ONNX",
         files=onnx_files("_fp16"), modalities=["text", "image", "audio"], platforms=["web"], min_memory_mb=2500,
         space_version=EG2_VERSION, dtype="fp16"),
    dict(id="embeddinggemma-2-onnx-q4", name="EmbeddingGemma 2 · ONNX q4 (WebGPU)",
         family="embeddinggemma-2", kinds=["embed"], engine="transformers.js", format="onnx", repo="onnx-community/embeddinggemma-2-ONNX",
         files=onnx_files("_q4"), modalities=["text", "image", "audio"], platforms=["web"], min_memory_mb=1200,
         space_version=EG2_VERSION + "+q4", dtype="q4"),
    dict(id="embeddinggemma-2-onnx-q4f16", name="EmbeddingGemma 2 · ONNX q4f16 (WebGPU)",
         family="embeddinggemma-2", kinds=["embed"], engine="transformers.js", format="onnx", repo="onnx-community/embeddinggemma-2-ONNX",
         files=onnx_files("_q4f16"), modalities=["text", "image", "audio"], platforms=["web"], min_memory_mb=1100,
         space_version=EG2_VERSION + "+q4", dtype="q4f16"),
    dict(id="embeddinggemma-2-onnx-q4f16-text", name="EmbeddingGemma 2 · ONNX q4f16, solo texto (el más pequeño)",
         family="embeddinggemma-2", kinds=["embed"], engine="transformers.js", format="onnx", repo="onnx-community/embeddinggemma-2-ONNX",
         files=onnx_files("_q4f16", ("model",)), modalities=["text"], platforms=["web"], min_memory_mb=500,
         space_version=EG2_VERSION + "+q4", dtype="q4f16"),
    # ---- EmbeddingGemma 2, other formats (measured, not used by spdf-infer) ----
    dict(id="embeddinggemma-2-mlx-8bit", name="EmbeddingGemma 2 · MLX 8 bits", family="embeddinggemma-2", kinds=["embed"],
         engine="mlx", format="mlx", repo="mlx-community/embeddinggemma-2-8bit", files="*",
         modalities=["text", "image", "audio"], platforms=["macos"], min_memory_mb=1800, space_version=EG2_VERSION),
    dict(id="embeddinggemma-2-litert-text-270m", name="EmbeddingGemma 2 · LiteRT-LM texto 270M (CPU/GPU; variantes NPU en el repo)",
         family="embeddinggemma-2", kinds=["embed"], engine="litert-lm", format="litertlm", repo="litert-community/embeddinggemma-2-text-270m-litert-lm",
         files=[("model", "embeddinggemma-2-text-270m.litertlm")], modalities=["text"], platforms=["android"], min_memory_mb=400,
         space_version=None, notes="Sin medir: LiteRT-LM no corre en macOS en este banco. Variantes NPU: _Google_Tensor_G5/G6, _Qualcomm_SM8550…SM8850, _MediaTek_MT6991/MT6993."),
    dict(id="embeddinggemma-2-st-reference", name="EmbeddingGemma 2 · safetensors bf16 (referencia, sentence-transformers)",
         family="embeddinggemma-2", kinds=["embed"], engine="sentence-transformers", format="safetensors", repo="google/embeddinggemma-2",
         files="*", modalities=["text", "image", "audio", "video"], platforms=["macos", "windows", "linux"], min_memory_mb=4000,
         space_version=EG2_VERSION),
    # ---- Gemma 4, native ----
    dict(id="gemma-4-e2b-it-gguf-q4_k_m", name="Gemma 4 E2B instruct · GGUF Q4_K_M", family="gemma-4-e2b", kinds=["generate", "judge"],
         engine="llama.cpp", format="gguf", repo="unsloth/gemma-4-E2B-it-GGUF", files=[("model", "gemma-4-E2B-it-Q4_K_M.gguf")],
         modalities=["text"], platforms=NATIVE, min_memory_mb=4000,
         # temperatures fitted on the SPDF judge bench (models/bench/judges): the letter logits are overconfident
         judge_calibration={"choice": {"temperature": 3.669, "prior_correction": False}, "noul": {"temperature": 3.888, "prior_correction": False}}),
    dict(id="gemma-4-e4b-it-gguf-q4_k_m", name="Gemma 4 E4B instruct · GGUF Q4_K_M", family="gemma-4-e4b", kinds=["generate", "judge"],
         engine="llama.cpp", format="gguf", repo="unsloth/gemma-4-E4B-it-GGUF", files=[("model", "gemma-4-E4B-it-Q4_K_M.gguf")],
         modalities=["text"], platforms=["macos", "windows", "linux", "ios", "android"], min_memory_mb=6500,
         judge_calibration={"choice": {"temperature": 4.12, "prior_correction": False}, "noul": {"temperature": 3.669, "prior_correction": False}}),
    # ---- Gemma 4, web and other formats ----
    dict(id="gemma-4-e2b-it-web", name="Gemma 4 E2B instruct · LiteRT web (.task, MediaPipe GenAI)", family="gemma-4-e2b",
         kinds=["generate"], engine="mediapipe", format="task", repo="litert-community/gemma-4-E2B-it-litert-lm",
         files=[("task", "gemma-4-E2B-it-web.task")], modalities=["text"], platforms=["web"], min_memory_mb=4000),
    dict(id="gemma-4-e4b-it-web", name="Gemma 4 E4B instruct · LiteRT web (.task)", family="gemma-4-e4b",
         kinds=["generate"], engine="mediapipe", format="task", repo="litert-community/gemma-4-E4B-it-litert-lm",
         files=[("task", "gemma-4-E4B-it-web.task")], modalities=["text"], platforms=["web"], min_memory_mb=6000),
    dict(id="gemma-4-e2b-it-litert-lm", name="Gemma 4 E2B instruct · LiteRT-LM (Android CPU/GPU)", family="gemma-4-e2b",
         kinds=["generate"], engine="litert-lm", format="litertlm", repo="litert-community/gemma-4-E2B-it-litert-lm",
         files=[("model", "gemma-4-E2B-it.litertlm")], modalities=["text"], platforms=["android"], min_memory_mb=4000,
         notes="Variantes NPU en el repo: _Google_Tensor_G5/G6, _qualcomm_sm8750, _qualcomm_qcs8275, _intel_LNL/PTL."),
    dict(id="gemma-4-e2b-it-mlx-4bit", name="Gemma 4 E2B instruct · MLX 4 bits", family="gemma-4-e2b", kinds=["generate"],
         engine="mlx", format="mlx", repo="lmstudio-community/gemma-4-E2B-it-MLX-4bit", files="*", modalities=["text"],
         platforms=["macos"], min_memory_mb=5500),
    dict(id="gemma-4-e4b-it-mlx-4bit", name="Gemma 4 E4B instruct · MLX 4 bits", family="gemma-4-e4b", kinds=["generate"],
         engine="mlx", format="mlx", repo="lmstudio-community/gemma-4-E4B-it-MLX-4bit", files="*", modalities=["text"],
         platforms=["macos"], min_memory_mb=8000),
    # ---- Valen ----
    dict(id="valen-0.8b-server", name="Valen 0.8B · safetensors (servidor Python opcional)", family="valen-0.8b", kinds=["judge"],
         engine="server", format="safetensors", repo="Valen-Team/Valen-0.8B", files="*", modalities=["text", "image", "video"],
         platforms=["macos", "windows", "linux"], min_memory_mb=6000,
         notes="models/valen/server.py; trust_remote_code (código del repo, fijado por revisión)."),
]


VALEN_REPO = "spdf-format/valen-0.8b-onnx"  # not published yet: needs José Luis's Hugging Face account
VALEN_DIR = Path(__import__("os").environ.get("SPDF_MODELS_CACHE", Path.home() / ".cache" / "spdf-models")) / "valen-onnx"
VALEN_ENTRIES = [
    dict(id="valen-0.8b-onnx-int8", name="Valen 0.8B · ONNX int8 (onnxruntime nativo)", family="valen-0.8b", kinds=["judge"],
         engine="onnxruntime", format="onnx", dtype="int8",
         files=[("onnx", "valen_backbone_int8.onnx"), ("onnx_data", "valen_backbone_int8.onnx.data"), ("head", "valen_head.onnx"),
                ("tokenizer", "tokenizer.json"), ("tokenizer_config", "tokenizer_config.json"), ("config", "config.json")],
         modalities=["text"], platforms=["macos", "windows", "linux"], min_memory_mb=2500),
    dict(id="valen-0.8b-onnx-static1024-q4", name="Valen 0.8B · ONNX q4 estático (1024 tokens, WebGPU)", family="valen-0.8b",
         kinds=["judge"], engine="onnxruntime-web", format="onnx", dtype="static1024_q4",
         files=[("onnx", "valen_backbone_static1024_q4.onnx"), ("onnx_data", "valen_backbone_static1024_q4.onnx.data"),
                ("head", "valen_head.onnx"), ("tokenizer", "tokenizer.json"), ("tokenizer_config", "tokenizer_config.json"),
                ("config", "config.json")],
         modalities=["text"], platforms=["web"], min_memory_mb=3000),
]


def local_entries() -> list[dict]:
    """Valen ONNX exports (models/valen/export_onnx.py, export_static.py), hashed from the local cache."""
    out = []
    for e in VALEN_ENTRIES:
        fes = []
        for role, path in e["files"]:
            f = VALEN_DIR / path
            if not f.exists():
                break
            h = hashlib.sha256()
            with f.open("rb") as fh:
                for b in iter(lambda: fh.read(1 << 20), b""):
                    h.update(b)
            fes.append({"role": role, "path": path, "url": f"{HF}/{VALEN_REPO}/resolve/main/{path}", "bytes": f.stat().st_size,
                        "sha256": h.hexdigest()})
        else:
            lic, lic_url = APACHE
            out.append({"id": e["id"], "name": e["name"], "family": e["family"], "kind": "judge", "kinds": e["kinds"],
                        "engine": e["engine"], "format": e["format"], "license": lic, "license_url": lic_url,
                        "source": f"{HF}/{VALEN_REPO}", "revision": "main", "bytes": sum(f["bytes"] for f in fes), "files": fes,
                        "modalities": e["modalities"], "platforms": e["platforms"], "min_memory_mb": e["min_memory_mb"],
                        "space_version": None, "judge_calibration": {"choice": {"temperature": 1.0, "prior_correction": False},
                                                                     "noul": {"temperature": 1.0, "prior_correction": False}},
                        "notes": "Exportación propia de Valen-Team/Valen-0.8B (rev. 4c858f2e) sobre el grafo de onnx-community/Qwen3.5-0.8B-ONNX; "
                                 "sin publicar todavía: constrúyela con models/valen y regístrala con ModelManager::import_local.",
                        "published": False, "dtype": e["dtype"]})
    return out


def get(url: str):
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception:  # noqa: BLE001
            if attempt == 4:
                raise
            time.sleep(2 + 2 * attempt)


def tree(repo: str, rev: str) -> dict[str, dict]:
    d = json.loads(get(f"{HF}/api/models/{repo}/tree/{rev}?recursive=true"))
    return {f["path"]: f for f in d if f["type"] == "file"}


def resolve(repo: str) -> str:
    return json.loads(get(f"{HF}/api/models/{repo}"))["sha"]


def file_entry(repo: str, rev: str, files: dict, role: str, path: str, cache: dict) -> dict:
    f = files[path]
    url = f"{HF}/{repo}/resolve/{rev}/{urllib.parse.quote(path)}"
    if f.get("lfs"):
        sha = f["lfs"]["oid"]
        size = f["lfs"]["size"]
    else:
        key = (repo, rev, path)
        if key not in cache:
            data = get(url)
            cache[key] = (hashlib.sha256(data).hexdigest(), len(data))
        sha, size = cache[key]
    return {"role": role, "path": path, "url": url, "bytes": size, "sha256": sha}


def build() -> dict:
    cache_p = MODELS / "tools" / ".small-file-hashes.json"
    cache = {}
    if cache_p.exists():
        cache = {tuple(k.split("\t")): tuple(v) for k, v in json.loads(cache_p.read_text()).items()}
    out = []
    for e in ENTRIES:
        repo = e["repo"]
        rev = REV.get(repo) or resolve(repo)
        files = tree(repo, rev)
        spec = e["files"]
        if spec == "*":
            spec = [("model" if p.endswith((".safetensors", ".gguf")) else ("tokenizer" if p.startswith("tokenizer") else "file"), p)
                    for p in sorted(files) if not p.startswith(".") and not p.endswith(".md")]
        fes = [file_entry(repo, rev, files, role, path, cache) for role, path in spec]
        lic, lic_url = APACHE
        entry = {
            "id": e["id"], "name": e["name"], "family": e["family"], "kind": e["kinds"][0], "kinds": e["kinds"],
            "engine": e["engine"], "format": e["format"], "license": lic, "license_url": lic_url,
            "source": f"{HF}/{repo}", "revision": rev, "bytes": sum(f["bytes"] for f in fes), "files": fes,
            "modalities": e["modalities"], "platforms": e["platforms"], "min_memory_mb": e["min_memory_mb"],
            "space_version": e.get("space_version"), "judge_calibration": e.get("judge_calibration"),
            "notes": e.get("notes"),
        }
        if "dtype" in e:
            entry["dtype"] = e["dtype"]
        out.append(entry)
        print(f"  {e['id']:40s} {entry['bytes'] / 1e6:9.1f} MB  {len(fes)} files", file=sys.stderr)
    cache_p.write_text(json.dumps({"\t".join(k): list(v) for k, v in cache.items()}, indent=0))
    out += local_entries()
    return out


RECOMMENDATIONS = {
    # first entry that fits in half the device memory wins (ModelManager::recommend)
    "macos": {"embed": ["embeddinggemma-2-gguf-q8_0"], "generate": ["gemma-4-e4b-it-gguf-q4_k_m", "gemma-4-e2b-it-gguf-q4_k_m"],
              "judge": ["gemma-4-e4b-it-gguf-q4_k_m", "gemma-4-e2b-it-gguf-q4_k_m"]},
    "windows": {"embed": ["embeddinggemma-2-gguf-q8_0"], "generate": ["gemma-4-e4b-it-gguf-q4_k_m", "gemma-4-e2b-it-gguf-q4_k_m"],
                "judge": ["gemma-4-e4b-it-gguf-q4_k_m", "gemma-4-e2b-it-gguf-q4_k_m"]},
    "linux": {"embed": ["embeddinggemma-2-gguf-q8_0"], "generate": ["gemma-4-e4b-it-gguf-q4_k_m", "gemma-4-e2b-it-gguf-q4_k_m"],
              "judge": ["gemma-4-e4b-it-gguf-q4_k_m", "gemma-4-e2b-it-gguf-q4_k_m"]},
    "ios": {"embed": ["embeddinggemma-2-gguf-q8_0", "embeddinggemma-2-gguf-q8_0-text"], "generate": ["gemma-4-e2b-it-gguf-q4_k_m"],
            "judge": ["gemma-4-e2b-it-gguf-q4_k_m"]},
    "android": {"embed": ["embeddinggemma-2-gguf-q8_0", "embeddinggemma-2-gguf-q8_0-text"], "generate": ["gemma-4-e2b-it-gguf-q4_k_m"],
                "judge": ["gemma-4-e2b-it-gguf-q4_k_m"]},
    "web": {"embed": ["embeddinggemma-2-onnx-q8", "embeddinggemma-2-onnx-q8-text"], "generate": ["gemma-4-e2b-it-web"],
            "judge": ["gemma-4-e2b-it-web"]},
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    models = build()
    manifest = {"spdf_models": 1, "updated": time.strftime("%Y-%m-%d"), "models": models, "recommendations": RECOMMENDATIONS}
    dest = MODELS / "manifest.json"
    text = json.dumps(manifest, ensure_ascii=False, indent=1) + "\n"
    if a.check:
        old = json.loads(dest.read_text())
        old["updated"] = manifest["updated"]
        if json.dumps(old, sort_keys=True) != json.dumps(manifest, sort_keys=True):
            sys.exit("manifest.json is out of date")
        print("manifest.json is up to date")
        return
    dest.write_text(text)
    print(f"wrote {dest} ({len(models)} models)")


if __name__ == "__main__":
    main()
