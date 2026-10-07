"""Validation of SPDF files (contract §12).

:func:`validate` never raises for a bad file: it returns a :class:`ValidationResult`
with the error and warning codes, in the deterministic order of the specification.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import sqlite3
import tempfile
import unicodedata
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from . import _sqlite
from .anchors import anchor_identity, anchor_problem, matter_of
from .container import (
    DEFAULT_MAX_BLOB_SIZE,
    DEFAULT_MAX_DECOMPRESSED_SIZE,
    Container,
    forbidden_objects,
    open_container,
)
from .errors import SpdfError
from .integrity import verify_hash
from .model import Issue, ValidationResult
from .reader import SpdfFile, content_hash, loads_json
from .schema import DTYPE_SIZES, LEGACY_REQUIRED, REQUIRED_META_KEYS, TABLES_50

__all__ = ["validate"]

_MAX_PER_CODE = 50  # issues of the same code beyond this are summarized
_MEMORY_COPY_LIMIT = 512 * 1024 * 1024


class _Collector:
    def __init__(self, result: ValidationResult) -> None:
        self.r = result
        self.counts: dict[str, int] = {}
        # Codes reported as warnings (newer minor versions may define them, SPEC §22.1 step 4).
        self.lenient: frozenset[str] = frozenset()

    def error(self, code: str, message: str, where: str | None = None) -> None:
        if code in self.lenient:
            self._add(self.r.warnings, code, message, where)
            return
        self._add(self.r.errors, code, message, where)

    def warn(self, code: str, message: str, where: str | None = None) -> None:
        self._add(self.r.warnings, code, message, where)

    def _add(self, bucket: list[Issue], code: str, message: str, where: str | None) -> None:
        n = self.counts.get(code, 0) + 1
        self.counts[code] = n
        if n <= _MAX_PER_CODE:
            bucket.append(Issue(code, message, where))
        elif n == _MAX_PER_CODE + 1:
            bucket.append(Issue(code, f"more {code} issues omitted", None))


def validate(
    source: str | os.PathLike[str] | bytes,
    *,
    max_blob_size: int = DEFAULT_MAX_BLOB_SIZE,
    max_decompressed_size: int = DEFAULT_MAX_DECOMPRESSED_SIZE,
    check_fts: bool = True,
) -> ValidationResult:
    """Validate a SPDF file (5.x or legacy 4.x) and return every problem found.

    ``result.valid`` is true when there are no errors; ``result.to_dict()`` is the
    object of the specification.
    """
    result = ValidationResult(version=None)
    col = _Collector(result)
    try:
        c = open_container(
            source,
            max_blob_size=max_blob_size,
            max_decompressed_size=max_decompressed_size,
            check_objects=False,
        )
    except SpdfError as exc:
        col.error(exc.code or "E001", str(exc).split(": ", 1)[-1] if exc.code else str(exc))
        return result
    try:
        result.version = c.version
        if c.gzip_wrapped and not c.legacy:
            col.warn("E003", "SPDF 5.x files should not be gzip-wrapped (range reads and mmap need plain SQLite)")
        try:
            _validate_open(c, col, check_fts=check_fts)
        except sqlite3.DatabaseError as exc:  # corrupt pages and the like
            col.error("E001", f"the database is damaged: {exc}")
    finally:
        c.close()
    return result


def _validate_open(c: Container, col: _Collector, *, check_fts: bool) -> None:
    conn = c.conn
    tables = {n for t, n, _ in c.schema_objects if t == "table"}

    if c.legacy:
        col.warn("W110", f"legacy SPDF {c.version} file; convert it with `spdf convert`")
        for t in (*LEGACY_REQUIRED, "fragmentos_fts"):
            if t not in tables:
                col.error("E010", f"missing legacy table {t!r}", t)
        for kind, name in forbidden_objects(c):
            col.error("E020", f"{kind} {name!r} is not allowed", name)
        return

    if c.user_version != 500:
        col.warn("W105", f"file is SPDF {c.version}; this reader implements 5.0")
        # Forward compatibility: a later minor version may define new anchor types and dtypes.
        col.lenient = frozenset({"E041", "E032"})

    # E020 triggers / views
    for kind, name in forbidden_objects(c):
        col.error("E020", f"{kind} {name!r} is not allowed in a distributed file", name)

    # E010 / E011 tables and columns
    present: dict[str, set[str]] = {}
    for t, cols in TABLES_50.items():
        if t not in tables:
            col.error("E010", f"missing required table {t!r}", t)
            continue
        try:
            have = {str(r[1]) for r in conn.execute(f'PRAGMA table_info("{t}")')}
        except sqlite3.Error:
            have = set(cols)  # e.g. FTS5 not compiled in: the virtual table cannot be inspected
        present[t] = have
        if t == "fragments_fts":
            continue
        for cname in cols:
            if cname not in have:
                col.error("E011", f"missing required column {t}.{cname}", f"{t}.{cname}")

    def ok(table: str, *cols: str) -> bool:
        return table in present and all(x in present[table] for x in cols)

    # E012 spdf_meta keys
    meta: dict[str, str] = {}
    if ok("spdf_meta", "key", "value"):
        meta = {str(k): str(v) for k, v in conn.execute("SELECT key, value FROM spdf_meta")}
        for key in REQUIRED_META_KEYS:
            if key not in meta:
                col.error("E012", f"spdf_meta lacks required key {key!r}", key)
        col.r.profile = (meta.get("profile") or "").split()

    # E013 / E050 / E051 document
    docs: list[tuple[Any, Any, Any, Any]] = []
    if ok("documents", "id", "metadata"):
        if ok("documents", "rights", "unit_count"):
            docs = list(conn.execute("SELECT id, metadata, rights, unit_count FROM documents"))
        else:
            docs = [(i, m, None, None) for i, m in conn.execute("SELECT id, metadata FROM documents")]
        if len(docs) != 1:
            col.error("E013", f"documents must hold exactly one row (found {len(docs)})", "documents")
        for did, md, rights, _ in docs:
            try:
                m = loads_json(md)
            except (ValueError, TypeError):
                col.error("E050", "metadata is not valid JSON", str(did))
            else:
                if not (isinstance(m, Mapping) and isinstance(m.get("type"), str) and isinstance(m.get("title"), str)):
                    col.error("E051", "metadata is not a CSL item (needs string 'type' and 'title')", str(did))
            if rights is not None:
                try:
                    loads_json(rights)
                except (ValueError, TypeError):
                    col.error("E050", "rights is not valid JSON", str(did))

    # E060 extensions
    if ok("extensions", "name", "required"):
        for name, req in conn.execute("SELECT name, required FROM extensions ORDER BY name"):
            if req:
                col.error("E060", f"unknown required extension {name!r}", str(name))

    # E090 units.ord, W102, anchors (E040 / E041 / E042)
    texts: dict[str, int] = {}
    units_count: int | None = None
    if ok("units", "id", "ord", "anchor", "text"):
        rows = list(conn.execute("SELECT id, ord, anchor, text FROM units ORDER BY ord, id"))
        units_count = len(rows)
        if [r[1] for r in rows] != list(range(1, len(rows) + 1)):
            col.error("E090", "units.ord must be contiguous from 1", "units")
        if len(docs) == 1 and docs[0][3] is not None and docs[0][3] != len(rows):
            col.warn(
                "W102",
                f"documents.unit_count is {docs[0][3]} but there are {len(rows)} units",
                "documents.unit_count",
            )
        for uid, _, anc, text in rows:
            length = len(unicodedata.normalize("NFC", text)) if isinstance(text, str) else None
            texts[str(uid)] = length if length is not None else 0
            _check_anchor(col, anc, length, f"units/{uid}")
    if ok("fragments", "id", "unit", "anchor"):
        end_col = "anchor_end" if "anchor_end" in present["fragments"] else "NULL"
        order = "n" if "n" in present["fragments"] else "rowid"
        for fid, unit, anc, end in conn.execute(f"SELECT id, unit, anchor, {end_col} FROM fragments ORDER BY {order}"):
            _check_anchor(col, anc, texts.get(str(unit)), f"fragments/{fid}")
            if end is not None:
                _check_anchor(col, end, None, f"fragments/{fid}/anchor_end")
    if ok("figures", "id", "unit", "anchor"):
        for gid, unit, anc in conn.execute("SELECT id, unit, anchor FROM figures ORDER BY id"):
            _check_anchor(col, anc, texts.get(str(unit)), f"figures/{gid}")

    # E032 / E031 / E030 spaces and vectors
    spaces: dict[str, tuple[int, str]] = {}
    if ok("spaces", "id", "dims", "dtype"):
        for sid, dims, dtype in conn.execute("SELECT id, dims, dtype FROM spaces ORDER BY id"):
            spaces[str(sid)] = (int(dims) if isinstance(dims, int) else -1, str(dtype))
            if dtype not in DTYPE_SIZES:
                col.error("E032", f"unknown dtype {dtype!r} in space {sid!r}", str(sid))
    vector_count = 0
    if ok("vectors", "target", "id", "space", "data"):
        for target, vid, space, length in conn.execute(
            "SELECT target, id, space, length(data) FROM vectors ORDER BY space, target, id"
        ):
            vector_count += 1
            where = f"vectors/{space}/{target}/{vid}"
            if space not in spaces:
                col.error("E031", f"vector space {space!r} is not declared in spaces", where)
                continue
            dims, dtype = spaces[space]
            size = DTYPE_SIZES.get(dtype)
            if size is None:
                continue
            if length is None or int(length) != dims * size:
                col.error("E030", f"vector has {length} bytes; expected {dims} × {size}", where)

    # E070 FTS integrity (on a copy: integrity-check is a write command)
    if check_fts and "fragments_fts" in tables:
        _check_fts(c, col)

    # E080 blobs
    if ok("blobs", "key", "sha256", "data"):
        for key, stored, data in conn.execute('SELECT "key", "sha256", "data" FROM blobs ORDER BY "key"'):
            digest = hashlib.sha256(bytes(data) if data is not None else b"").hexdigest()
            if stored != digest:
                col.error("E080", f"blob sha256 mismatch for {key!r}", str(key))

    # E081 / E082 integrity (only meaningful on an otherwise valid file)
    if "content_sha256" in meta and not col.r.errors:
        try:
            actual: str | None = content_hash(SpdfFile(c).dump())
        except Exception:  # a broken file can make the dump fail
            actual = None
        if actual != meta["content_sha256"]:
            col.error("E081", "content_sha256 does not match the canonical dump", "spdf_meta.content_sha256")
        elif "signature" in meta and not verify_hash(actual, meta["signature"], meta.get("signer", "")):
            col.error("E082", "signature does not verify", "spdf_meta.signature")

    # W103 fragments that cross matter, or from a page with a folio to one without (SPEC §4.4)
    if ok("units", "id", "ord", "anchor") and ok("fragments", "id", "unit", "anchor_end"):
        _check_crossings(conn, col)

    # Profile warnings
    profile = set(col.r.profile)
    if "semantic" in profile and vector_count == 0:
        col.warn("W100", "profile 'semantic' declared but the file has no vectors")
    if "media" in profile and ok("units", "anchor"):
        has_time = False
        for (anc,) in conn.execute("SELECT anchor FROM units"):
            try:
                a = loads_json(anc)
            except (ValueError, TypeError):
                continue
            if isinstance(a, Mapping) and a.get("type") == "time":
                has_time = True
                break
        if not has_time:
            col.warn("W101", "profile 'media' declared but no unit has a time anchor")
    _ = units_count


def _check_crossings(conn: sqlite3.Connection, col: _Collector) -> None:
    units: list[tuple[str, Any]] = []
    for uid, raw in conn.execute("SELECT id, anchor FROM units ORDER BY ord, id"):
        try:
            units.append((str(uid), loads_json(raw)))
        except (ValueError, TypeError):
            units.append((str(uid), None))
    index = {uid: i for i, (uid, _) in enumerate(units)}
    for fid, unit, raw_end in conn.execute(
        "SELECT id, unit, anchor_end FROM fragments WHERE anchor_end IS NOT NULL ORDER BY n"
    ):
        start = index.get(str(unit))
        if start is None:
            continue
        try:
            end = anchor_identity(loads_json(raw_end))
        except (ValueError, TypeError):
            continue
        a1 = units[start][1]
        a2 = next((a for _, a in units[start + 1 :] if anchor_identity(a) == end), None)
        if not isinstance(a1, Mapping) or not isinstance(a2, Mapping):
            continue
        folio_change = a1.get("type") == a2.get("type") == "page" and (a1.get("printed") is None) != (
            a2.get("printed") is None
        )
        if matter_of(a1) != matter_of(a2) or folio_change:
            col.warn(
                "W103",
                f"fragment crosses from {matter_of(a1)} to {matter_of(a2)} matter, "
                "or between a page with a folio and one without",
                f"fragments/{fid}",
            )


def _check_anchor(col: _Collector, raw: Any, text_length: int | None, where: str) -> None:
    try:
        anchor = loads_json(raw)
    except (ValueError, TypeError):
        col.error("E040", "anchor is not valid JSON", where)
        return
    problem = anchor_problem(anchor, text_length)
    if problem:
        col.error(problem[0], problem[1], where)


def _check_fts(c: Container, col: _Collector) -> None:
    if not _sqlite.HAS_FTS5:
        return  # cannot check; FTS5 missing in this Python (see `spdf info --env`)
    tables = {n for t, n, _ in c.schema_objects if t == "table"}
    size = c.db_path.stat().st_size
    tmp: Path | None = None
    copy: sqlite3.Connection | None = None
    try:
        if size <= _MEMORY_COPY_LIMIT:
            copy = _sqlite.driver.connect(":memory:")
        else:
            fd, name = tempfile.mkstemp(prefix="spdf-fts-", suffix=".sqlite")
            os.close(fd)
            tmp = Path(name)
            copy = _sqlite.driver.connect(name)
        assert copy is not None
        c.conn.backup(copy)
        copy.execute("PRAGMA trusted_schema = OFF")
        for t in ("fragments_fts", "fragments_fts_trigram"):
            if t not in tables:
                continue
            try:
                copy.execute(f'INSERT INTO "{t}"("{t}", rank) VALUES (\'integrity-check\', 1)')
            except sqlite3.Error as exc:
                col.error("E070", f"FTS index {t!r} is out of sync with its content ({exc})", t)
                return
    except sqlite3.Error as exc:
        col.error("E070", f"cannot check the FTS index: {exc}", "fragments_fts")
    finally:
        if copy is not None:
            copy.close()
        if tmp is not None:
            with contextlib.suppress(OSError):
                tmp.unlink()
