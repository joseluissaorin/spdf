"""Shared helpers for the SPDF models bench: corpus, timing, memory, results."""
from __future__ import annotations

import ctypes
import json
import os
import platform
import statistics
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "corpus"
RESULTS = HERE / "results"
CACHE = Path(os.environ.get("SPDF_MODELS_CACHE", Path.home() / ".cache" / "spdf-models"))
MEDIA = CACHE / "bench-corpus"
VECTORS = CACHE / "bench-out" / "vectors"

DOC_PREFIX = "title: none | text: "
QUERY_PREFIX = "task: search result | query: "


@dataclass
class TextItem:
    id: str
    kind: str
    lang: str
    length: str
    text: str

    @property
    def input(self) -> str:
        return (QUERY_PREFIX if self.kind == "query" else DOC_PREFIX) + self.text


def load_texts() -> list[TextItem]:
    out = []
    with (CORPUS / "texts.jsonl").open(encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            out.append(TextItem(d["id"], d["kind"], d["lang"], d["length"], d["text"]))
    return out


def load_images() -> list[tuple[str, Path]]:
    items = json.loads((CORPUS / "images.json").read_text())
    return [(it["id"], MEDIA / "images" / it["file"]) for it in items]


def load_audio() -> list[tuple[str, Path]]:
    p = CORPUS / "audio.json"
    if not p.exists():
        return []
    items = json.loads(p.read_text())
    return [(it["id"], MEDIA / "audio" / it["file"]) for it in items]


def read_wav16k(path: Path) -> np.ndarray:
    import soundfile as sf

    data, sr = sf.read(str(path), dtype="float32")
    assert sr == 16000, sr
    if data.ndim > 1:
        data = data.mean(axis=1)
    return data


# ------------------------------------------------------------------ memory

class _RUsageInfoV2(ctypes.Structure):
    _fields_ = [
        ("ri_uuid", ctypes.c_uint8 * 16), ("ri_user_time", ctypes.c_uint64), ("ri_system_time", ctypes.c_uint64),
        ("ri_pkg_idle_wkups", ctypes.c_uint64), ("ri_interrupt_wkups", ctypes.c_uint64),
        ("ri_pageins", ctypes.c_uint64), ("ri_wired_size", ctypes.c_uint64), ("ri_resident_size", ctypes.c_uint64),
        ("ri_phys_footprint", ctypes.c_uint64), ("ri_proc_start_abstime", ctypes.c_uint64),
        ("ri_proc_exit_abstime", ctypes.c_uint64), ("ri_child_user_time", ctypes.c_uint64),
        ("ri_child_system_time", ctypes.c_uint64), ("ri_child_pkg_idle_wkups", ctypes.c_uint64),
        ("ri_child_interrupt_wkups", ctypes.c_uint64), ("ri_child_pageins", ctypes.c_uint64),
        ("ri_child_elapsed_abstime", ctypes.c_uint64), ("ri_diskio_bytesread", ctypes.c_uint64),
        ("ri_diskio_byteswritten", ctypes.c_uint64),
    ]


_libproc = None


def phys_footprint(pid: int) -> int:
    """Physical footprint of a process in bytes (macOS: includes Metal/unified GPU memory)."""
    global _libproc
    if platform.system() != "Darwin":
        import psutil

        return psutil.Process(pid).memory_info().rss
    if _libproc is None:
        _libproc = ctypes.CDLL("/usr/lib/libproc.dylib")
    info = _RUsageInfoV2()
    rc = _libproc.proc_pid_rusage(ctypes.c_int(pid), ctypes.c_int(2), ctypes.byref(info))
    if rc != 0:
        return 0
    return int(info.ri_phys_footprint)


def tree_pids(root: int) -> list[int]:
    import psutil

    try:
        p = psutil.Process(root)
        return [root] + [c.pid for c in p.children(recursive=True)]
    except psutil.NoSuchProcess:
        return []


class MemSampler:
    """Samples the summed physical footprint of a process tree; keeps baseline and peak."""

    def __init__(self, pid: int | None = None, interval: float = 0.05):
        self.pid = pid or os.getpid()
        self.interval = interval
        self.peak = 0
        self._stop = threading.Event()
        self._t: threading.Thread | None = None

    def current(self) -> int:
        return sum(phys_footprint(p) for p in tree_pids(self.pid))

    def __enter__(self):
        self.peak = self.current()
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()
        return self

    def _run(self):
        while not self._stop.is_set():
            self.peak = max(self.peak, self.current())
            time.sleep(self.interval)

    def __exit__(self, *exc):
        self._stop.set()
        if self._t:
            self._t.join()
        self.peak = max(self.peak, self.current())


# ------------------------------------------------------------------ results

@dataclass
class Timings:
    by_class: dict[str, list[float]] = field(default_factory=dict)

    def add(self, cls: str, seconds: float):
        self.by_class.setdefault(cls, []).append(seconds * 1000.0)

    def summary(self) -> dict:
        out = {}
        for k, v in self.by_class.items():
            v = sorted(v)
            out[k] = {"n": len(v), "median_ms": round(statistics.median(v), 2),
                      "p90_ms": round(v[min(len(v) - 1, int(0.9 * len(v)))], 2), "mean_ms": round(sum(v) / len(v), 2)}
        return out


def machine() -> dict:
    chip = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip()
    mem = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True).stdout.strip() or 0)
    return {"chip": chip, "memory_gb": round(mem / 2**30), "os": platform.platform()}


def save(engine: str, *, text: dict | None = None, image: dict | None = None, audio: dict | None = None,
         timings: Timings | None = None, memory: dict | None = None, meta: dict | None = None):
    """text/image/audio: {id: np.ndarray(768)}; written to the cache, summary JSON to results/."""
    VECTORS.mkdir(parents=True, exist_ok=True)
    RESULTS.mkdir(parents=True, exist_ok=True)
    arrays = {}
    for mod, d in (("text", text), ("image", image), ("audio", audio)):
        if d:
            ids = sorted(d)
            arrays[f"{mod}_ids"] = np.array(ids)
            arrays[f"{mod}_vecs"] = np.stack([np.asarray(d[i], dtype=np.float32) for i in ids])
    np.savez_compressed(VECTORS / f"{engine}.npz", **arrays)
    summary = {"engine": engine, "machine": machine(), "date": time.strftime("%Y-%m-%d"),
               "latency": timings.summary() if timings else {}, "memory": memory or {}, "meta": meta or {},
               "counts": {m: len(d) for m, d in (("text", text), ("image", image), ("audio", audio)) if d}}
    (RESULTS / f"{engine}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({k: summary[k] for k in ("engine", "latency", "memory", "counts")}, ensure_ascii=False))


def load_vectors(engine: str) -> dict[str, dict[str, np.ndarray]]:
    z = np.load(VECTORS / f"{engine}.npz")
    out = {}
    for mod in ("text", "image", "audio"):
        if f"{mod}_ids" in z:
            out[mod] = dict(zip(z[f"{mod}_ids"].tolist(), z[f"{mod}_vecs"]))
    return out


def normalize(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def mb(x: int) -> float:
    return round(x / 2**20, 1)
