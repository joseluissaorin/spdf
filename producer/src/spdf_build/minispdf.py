"""Fallback SPDF 5.0 writer and checker, used only when `spdf-format` is not installed.

It mirrors the public API of `spdf.Writer` (python/ in this repository) so the
producer switches to the reference library without code changes. The schema is
copied from `spec/CONTRACT.md` §2. The reference validator lives in
`spdf-format`; `basic_check` here only catches gross mistakes.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import struct
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

SCHEMA = """
CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE documents (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, metadata TEXT NOT NULL, source_sha256 TEXT NOT NULL, source_ref TEXT,
  mime TEXT NOT NULL, bytes INTEGER NOT NULL, unit_count INTEGER NOT NULL, duration REAL, created TEXT NOT NULL,
  updated TEXT NOT NULL, title TEXT, authors TEXT, year INTEGER, language TEXT, rights TEXT
);
CREATE TABLE units (
  id TEXT PRIMARY KEY, document TEXT NOT NULL REFERENCES documents(id), ord INTEGER NOT NULL, anchor TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '', notes TEXT, header TEXT, footer TEXT, image TEXT, thumbnail TEXT, reader TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1, printed TEXT, t0 REAL, t1 REAL, words TEXT
);
CREATE INDEX units_doc ON units(document, ord);
CREATE INDEX units_printed ON units(document, printed);
CREATE TABLE sections (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL,
  title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT
);
CREATE TABLE fragments (
  n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT NOT NULL, unit TEXT NOT NULL, ord INTEGER NOT NULL,
  text TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', section TEXT, anchor TEXT NOT NULL, anchor_end TEXT, search_text TEXT
);
CREATE INDEX fragments_doc ON fragments(document, ord);
CREATE INDEX fragments_unit ON fragments(unit);
CREATE VIRTUAL TABLE fragments_fts USING fts5(
  text, context, section, search_text, content='fragments', content_rowid='n', tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE figures (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL, image TEXT NOT NULL,
  caption TEXT, description TEXT, anchor TEXT NOT NULL
);
CREATE TABLE spaces (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, version TEXT, dims INTEGER NOT NULL,
  dtype TEXT NOT NULL DEFAULT 'f32', normalized INTEGER NOT NULL DEFAULT 1, truncated_from INTEGER,
  modalities TEXT NOT NULL, task_prefixes TEXT, created TEXT
);
CREATE TABLE vectors (
  target TEXT NOT NULL, id TEXT NOT NULL, space TEXT NOT NULL REFERENCES spaces(id), document TEXT NOT NULL,
  data BLOB NOT NULL, PRIMARY KEY (target, id, space)
);
CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL);
CREATE TABLE provenance (
  document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT, detail TEXT, ms INTEGER, at TEXT NOT NULL
);
CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
"""

JSON_COLUMNS = {"anchor", "anchor_end", "metadata", "notes", "section", "words", "rights", "modalities", "task_prefixes", "detail"}
GENERATOR = "spdf-build-minispdf/0.1"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _nfc(v: Any) -> Any:
    if isinstance(v, str):
        return unicodedata.normalize("NFC", v)
    if isinstance(v, list):
        return [_nfc(x) for x in v]
    if isinstance(v, dict):
        return {k: _nfc(x) for k, x in v.items()}
    return v


def _cell(col: str, v: Any) -> Any:
    if v is None:
        return None
    if col in JSON_COLUMNS and not isinstance(v, str):
        return json.dumps(_nfc(v), ensure_ascii=False, separators=(",", ":"))
    if isinstance(v, str):
        return _nfc(v)
    if isinstance(v, bool):
        return int(v)
    return v


def encode_vector(values, dtype: str) -> bytes:
    try:
        import numpy as np
    except ImportError:  # pragma: no cover
        np = None
    if isinstance(values, (bytes, bytearray)):
        return bytes(values)
    if np is not None:
        a = np.asarray(values, dtype=np.float32)
        if dtype == "f32":
            return a.astype("<f4").tobytes()
        if dtype == "f16":
            return a.astype("<f2").tobytes()
        if dtype == "i8":
            q = np.clip(np.sign(a) * np.floor(np.abs(a) * 127 + 0.5), -127, 127).astype("<i1")
            return q.tobytes()
    vals = [float(x) for x in values]
    if dtype == "f32":
        return struct.pack(f"<{len(vals)}f", *vals)
    if dtype == "f16":
        return struct.pack(f"<{len(vals)}e", *vals)
    return bytes((max(-127, min(127, int(round(v * 127)))) & 0xFF) for v in vals)


class Writer:
    """Minimal clone of `spdf.Writer`."""

    def __init__(self, path, overwrite: bool = False):
        self.path = Path(path)
        if self.path.exists() and not overwrite:
            raise FileExistsError(self.path)
        self.tmp = self.path.with_name(self.path.name + ".tmp")
        if self.tmp.exists():
            self.tmp.unlink()
        self.db = sqlite3.connect(self.tmp)
        self.db.executescript(SCHEMA)
        self.meta: dict[str, str] = {}
        self.doc_id: Optional[str] = None
        self.dtypes: dict[str, str] = {}
        self._n = 0
        self._has_vectors = False
        self._has_time = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.finalize()
        else:
            self.db.close()
            self.tmp.unlink(missing_ok=True)

    def _insert(self, table: str, row: dict) -> None:
        cols = list(row)
        self.db.execute(f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                        [_cell(c, row[c]) for c in cols])

    def set_meta(self, key=None, value=None, **kv):
        if key is not None:
            kv[key] = value
        for k, v in kv.items():
            self.meta[k] = str(v)

    def add_document(self, d: dict):
        self.doc_id = d["id"]
        self._insert("documents", d)

    def add_unit(self, u: dict):
        if u.get("t0") is not None:
            self._has_time = True
        self._insert("units", u)

    def add_section(self, s: dict):
        self._insert("sections", s)

    def add_fragment(self, f: dict):
        if "n" not in f or f["n"] is None:
            self._n += 1
            f = {**f, "n": self._n}
        else:
            self._n = max(self._n, int(f["n"]))
        self._insert("fragments", f)

    def add_figure(self, f: dict):
        self._insert("figures", f)

    def add_space(self, s: dict):
        self.dtypes[s["id"]] = s.get("dtype", "f32")
        self._insert("spaces", s)

    def add_vector(self, target: str, id: str, space: str, document: str, data) -> None:
        self._has_vectors = True
        self._insert("vectors", {"target": target, "id": id, "space": space, "document": document,
                                 "data": encode_vector(data, self.dtypes.get(space, "f32"))})

    def add_blob(self, key: str, mime: str, data: bytes) -> str:
        self._insert("blobs", {"key": key, "mime": mime, "sha256": hashlib.sha256(data).hexdigest(), "data": data})
        return f"blob:{key}"

    def add_provenance(self, p: dict):
        row = {"at": _now(), **p}
        self._insert("provenance", row)

    def add_extension(self, name: str, version: str, required: bool = False):
        self._insert("extensions", {"name": name, "version": version, "required": int(required)})

    def finalize(self, content_hash: bool = False, sign_key=None) -> Path:
        meta = dict(self.meta)
        meta.setdefault("spdf_version", "5.0")
        meta.setdefault("created", _now())
        meta.setdefault("generator", GENERATOR)
        if self.doc_id:
            meta.setdefault("document_id", self.doc_id)
        if "profile" not in meta:
            prof = ["core"]
            if self._has_vectors:
                prof.append("semantic")
            if self._has_time:
                prof.append("media")
            meta["profile"] = " ".join(prof)
        for k, v in meta.items():
            self.db.execute("INSERT INTO spdf_meta (key, value) VALUES (?, ?)", (k, v))
        self.db.execute("INSERT INTO fragments_fts(fragments_fts) VALUES('rebuild')")
        self.db.execute("PRAGMA application_id = 1397769286")
        self.db.execute("PRAGMA user_version = 500")
        self.db.commit()
        self.db.execute("PRAGMA journal_mode = DELETE")
        self.db.execute("VACUUM")
        self.db.close()
        os.replace(self.tmp, self.path)
        return self.path


def basic_check(path) -> dict:
    """Very small subset of §12, only for when the reference validator is not installed."""
    errors: list[dict] = []
    warnings: list[dict] = []
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        app = db.execute("PRAGMA application_id").fetchone()[0]
        ver = db.execute("PRAGMA user_version").fetchone()[0]
        if app != 1397769286 or not 500 <= ver < 600:
            errors.append({"code": "E002", "message": f"application_id={app} user_version={ver}", "where": None})
        kinds = db.execute("SELECT type FROM sqlite_master WHERE type IN ('trigger','view')").fetchall()
        if kinds:
            errors.append({"code": "E020", "message": "trigger or view", "where": None})
        meta = dict(db.execute("SELECT key, value FROM spdf_meta").fetchall())
        for k in ("spdf_version", "profile", "created", "generator", "document_id"):
            if k not in meta:
                errors.append({"code": "E012", "message": f"missing {k}", "where": "spdf_meta"})
        n = db.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        if n != 1:
            errors.append({"code": "E013", "message": f"{n} documents", "where": None})
        md = json.loads(db.execute("SELECT metadata FROM documents").fetchone()[0])
        if not isinstance(md.get("type"), str) or not isinstance(md.get("title"), str):
            errors.append({"code": "E051", "message": "metadata needs type and title", "where": "documents"})
        ords = [r[0] for r in db.execute("SELECT ord FROM units ORDER BY ord")]
        if ords != list(range(1, len(ords) + 1)):
            errors.append({"code": "E090", "message": "units.ord not contiguous", "where": "units"})
        for table, col in (("units", "anchor"), ("fragments", "anchor"), ("fragments", "anchor_end"), ("figures", "anchor")):
            for rid, a in db.execute(f"SELECT rowid, {col} FROM {table}"):
                if a is None and col == "anchor_end":
                    continue
                try:
                    obj = json.loads(a)
                    assert isinstance(obj, dict) and isinstance(obj.get("type"), str)
                except Exception:
                    errors.append({"code": "E040", "message": f"bad anchor in {table}", "where": f"{table}:{rid}"})
        dims = {r[0]: (r[1], r[2]) for r in db.execute("SELECT id, dims, dtype FROM spaces")}
        size = {"f32": 4, "f16": 2, "i8": 1}
        for t, i, s, d in db.execute("SELECT target, id, space, data FROM vectors"):
            if s not in dims:
                errors.append({"code": "E031", "message": f"space {s}", "where": f"vectors:{t}:{i}"})
            elif len(d) != dims[s][0] * size.get(dims[s][1], 4):
                errors.append({"code": "E030", "message": "vector length", "where": f"vectors:{t}:{i}"})
        prof = meta.get("profile", "").split()
        if "semantic" in prof and not dims:
            warnings.append({"code": "W100", "message": "semantic without vectors", "where": None})
    finally:
        db.close()
    return {"valid": not errors, "version": "5.0", "profile": meta.get("profile", "").split() if 'meta' in dir() else [],
            "errors": errors, "warnings": warnings, "validator": "minispdf.basic_check"}
