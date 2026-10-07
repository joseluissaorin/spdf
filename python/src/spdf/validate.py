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
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from . import _sqlite
from .anchors import anchor_problem
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

    def error(self, code: str, message: str, where: str | None = None) -> None:
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
            source, max_blob_size=max_blob_size, max_decompressed_size=max_decompressed_size, check_objects=False
        )
    except SpdfError as exc:
        col.error(exc.code or "E001", str(exc).split(": ", 1)[-1] if exc.code else str(exc))
        return result
    try:
        result.version = c.version
        if c.gzip_wrapped and not c.legacy:
            col.warn("E003", "SPDF 5.x files should not be gzip-wrapped (range reads and mmap need plain SQLite)")
        _validate_open(c, col, check_fts=check_fts)
    finally:
        c.close()
    return result


def _validate_open(c: Container, col: _Collector, *, check_fts: bool) -> None:
    f = SpdfFile(c)
    legacy = c.legacy
    conn = c.conn

    # E020 triggers / views
    for kind, name in forbidden_objects(c):
        col.error("E020", f"{kind} {name!r} is not allowed in a distributed file", f"sqlite_master/{name}")

    # E010 / E011 tables and columns
    tables = {n for t, n, _ in c.schema_objects if t == "table"}
    if legacy:
        for t in LEGACY_REQUIRED:
            if t not in tables:
                col.error("E010", f"missing legacy table {t!r}", t)
        if not all(t in tables for t in LEGACY_REQUIRED):
            return
    else:
        missing_tables = [t for t in TABLES_50 if t not in tables]
        for t in missing_tables:
            col.error("E010", f"missing required table {t!r}", t)
        for t, cols in TABLES_50.items():
            if t in missing_tables:
                continue
            try:
                present = {str(r[1]) for r in conn.execute(f'PRAGMA table_info("{t}")')}
            except sqlite3.Error:
                continue  # e.g. FTS5 not compiled in: the virtual table cannot be inspected
            for cname in cols:
                if cname not in present:
                    col.error("E011", f"missing required column {t}.{cname}", f"{t}.{cname}")
        if missing_tables or col.counts.get("E011"):
            # Reading further would only produce noise.
            _profile_warnings(f, c, col, partial=True)
            return

    # E012 spdf_meta keys
    meta = f.meta
    result_profile = [p for p in (meta.get("profile") or "").split() if p]
    col.r.profile = result_profile
    if not legacy:
        for key in REQUIRED_META_KEYS:
            if key not in meta or meta.get(key) in (None, ""):
                col.error("E012", f"spdf_meta lacks required key {key!r}", f"spdf_meta/{key}")

    # E013 exactly one document
    doc_rows = list(f._raw("documents"))
    if len(doc_rows) != 1:
        col.error("E013", f"documents must hold exactly one row (found {len(doc_rows)})", "documents")
    if not legacy and doc_rows and meta.get("document_id") and meta.get("document_id") not in {
        r["id"] for r in doc_rows
    }:
        col.error("E013", "spdf_meta.document_id does not match documents.id", "spdf_meta/document_id")

    # E050 / E051 metadata and rights
    for r in doc_rows:
        where = f"documents/{r['id']}"
        try:
            meta_obj = loads_json(r.get("metadata"))
        except (ValueError, TypeError):
            col.error("E050", "metadata is not valid JSON", f"{where}/metadata")
            meta_obj = None
        else:
            if not isinstance(meta_obj, Mapping):
                col.error("E050", "metadata must be a JSON object", f"{where}/metadata")
                meta_obj = None
        if meta_obj is not None:
            if legacy:
                processed = f._process("documents", dict(r))
                meta_obj = processed.get("metadata")
            if not (
                isinstance(meta_obj, Mapping)
                and isinstance(meta_obj.get("type"), str)
                and isinstance(meta_obj.get("title"), str)
            ):
                col.error("E051", "metadata is not a CSL item (needs string 'type' and 'title')", f"{where}/metadata")
        rights = r.get("rights")
        if rights is not None and not legacy:
            try:
                rv = loads_json(rights)
            except (ValueError, TypeError):
                col.error("E050", "rights is not valid JSON", f"{where}/rights")
            else:
                if rv is not None and not isinstance(rv, Mapping):
                    col.error("E050", "rights must be a JSON object", f"{where}/rights")

    # E060 extensions
    if not legacy:
        try:
            for ext in f.extensions():
                if ext.required:
                    col.error("E060", f"unknown required extension {ext.name!r} {ext.version}", f"extensions/{ext.name}")
        except sqlite3.Error:
            pass

    # E090 units.ord
    unit_text_len: dict[str, int] = {}
    unit_rows = list(f._raw("units", columns=("id", "ord", "anchor", "text"), order=f._unit_order()))
    if not legacy:
        ords = sorted(int(r["ord"]) if isinstance(r["ord"], int) else -1 for r in unit_rows)
        if ords != list(range(1, len(ords) + 1)):
            col.error("E090", "units.ord must be contiguous from 1", "units")

    # E040 / E041 / E042 anchors
    has_time = False
    for r in unit_rows:
        text = r.get("text") or ""
        unit_text_len[str(r["id"])] = len(text) if isinstance(text, str) else 0
        anchor = _anchor_json(f, "units", r.get("anchor"))
        if isinstance(anchor, Mapping) and anchor.get("type") == "time":
            has_time = True
        _check_anchor(col, anchor, unit_text_len[str(r["id"])], f"units/{r['id']}/anchor")
    for r in f._raw("fragments", columns=("n", "id", "unit", "anchor", "anchor_end"), order='"n"'):
        length = unit_text_len.get(str(r.get("unit")))
        _check_anchor(col, _anchor_json(f, "fragments", r.get("anchor")), length, f"fragments/{r['id']}/anchor")
        if r.get("anchor_end") is not None:
            _check_anchor(
                col, _anchor_json(f, "fragments", r.get("anchor_end")), None, f"fragments/{r['id']}/anchor_end"
            )
    for r in f._raw("figures", columns=("id", "unit", "anchor"), order='"id"'):
        length = unit_text_len.get(str(r.get("unit")))
        _check_anchor(col, _anchor_json(f, "figures", r.get("anchor")), length, f"figures/{r['id']}/anchor")

    # E031 / E032 / E030 spaces and vectors
    spaces: dict[str, tuple[int, str]] = {}
    for r in f._rows("spaces", columns=("id", "dims", "dtype")):
        dtype = str(r.get("dtype") or "f32")
        spaces[str(r["id"])] = (int(r.get("dims") or 0), dtype)
    vector_count = 0
    if f.has_table("vectors"):
        scol, tcol, icol, dcol = (f._col("vectors", k) for k in ("space", "target", "id", "data"))
        sql = (
            f'SELECT "{scol}", "{tcol}", "{icol}", length("{dcol}") FROM "{f._physical("vectors")}" '
            f'ORDER BY "{scol}", "{tcol}", "{icol}"'
        )
        bad_dtype_reported: set[str] = set()
        for space, target, vid, length in conn.execute(sql):
            vector_count += 1
            where = f"vectors/{target}/{vid}/{space}"
            if space not in spaces:
                col.error("E031", f"vector space {space!r} is not declared in spaces", where)
                continue
            dims, dtype = spaces[space]
            size = DTYPE_SIZES.get(dtype)
            if size is None:
                if space not in bad_dtype_reported:
                    bad_dtype_reported.add(space)
                    col.error("E032", f"unknown dtype {dtype!r} in space {space!r}", f"spaces/{space}")
                continue
            if length is None or int(length) != dims * size:
                col.error("E030", f"vector has {length} bytes; expected {dims} × {size}", where)
        for sid, (_, dtype) in spaces.items():
            if dtype not in DTYPE_SIZES and sid not in bad_dtype_reported:
                col.error("E032", f"unknown dtype {dtype!r} in space {sid!r}", f"spaces/{sid}")

    # E070 FTS integrity
    if check_fts:
        _check_fts(c, f, col)

    # E080 blobs
    if not legacy and f.has_table("blobs"):
        for key, stored, data in conn.execute('SELECT "key", "sha256", "data" FROM blobs ORDER BY "key"'):
            digest = hashlib.sha256(bytes(data) if data is not None else b"").hexdigest()
            if not isinstance(stored, str) or stored.lower() != digest:
                col.error("E080", f"blob sha256 mismatch for {key!r}", f"blobs/{key}")

    # E081 / E082 integrity
    if not legacy and ("content_sha256" in meta or "signature" in meta):
        try:
            actual = content_hash(f.dump())
        except Exception as exc:  # a broken file can make the dump fail
            col.error("E081", f"cannot compute content_sha256: {exc}", "spdf_meta/content_sha256")
            actual = None
        stored = meta.get("content_sha256")
        if actual is not None and stored is not None and stored.lower() != actual:
            col.error("E081", "content_sha256 does not match the content", "spdf_meta/content_sha256")
        if "signature" in meta:
            signer = meta.get("signer")
            if not signer:
                col.error("E082", "signature without signer", "spdf_meta/signer")
            elif actual is None or not verify_hash(stored or actual, meta["signature"], signer):
                col.error("E082", "signature does not verify", "spdf_meta/signature")
            elif stored is None:
                col.error("E082", "signature present without content_sha256", "spdf_meta/signature")

    # Warnings
    _profile_warnings(f, c, col, partial=False, has_time=has_time, vector_count=vector_count, units=len(unit_rows))


def _anchor_json(f: SpdfFile, table: str, value: Any) -> Any:
    try:
        parsed = loads_json(value)
    except (ValueError, TypeError):
        return _BAD_JSON
    if f.legacy:
        from .legacy import map_anchor

        return map_anchor(parsed)
    return parsed


_BAD_JSON = object()


def _check_anchor(col: _Collector, anchor: Any, text_length: int | None, where: str) -> None:
    if anchor is _BAD_JSON:
        col.error("E040", "anchor is not valid JSON", where)
        return
    problem = anchor_problem(anchor, text_length)
    if problem:
        col.error(problem[0], problem[1], where)


def _check_fts(c: Container, f: SpdfFile, col: _Collector) -> None:
    fts = f._physical("fragments_fts")
    if not f.has_table("fragments_fts"):
        return
    if not _sqlite.HAS_FTS5:
        return  # cannot check; FTS5 missing in this Python (see spdf.info)
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
        targets = [fts]
        if not f.legacy and "fragments_fts_trigram" in {n for t, n, _ in c.schema_objects if t == "table"}:
            targets.append("fragments_fts_trigram")
        for t in targets:
            try:
                copy.execute(f'INSERT INTO "{t}"("{t}", rank) VALUES (\'integrity-check\', 1)')
            except sqlite3.Error as exc:
                col.error("E070", f"FTS index {t!r} is out of sync with its content ({exc})", t)
    except sqlite3.Error as exc:
        col.error("E070", f"cannot check the FTS index: {exc}", fts)
    finally:
        if copy is not None:
            copy.close()
        if tmp is not None:
            with contextlib.suppress(OSError):
                tmp.unlink()


def _profile_warnings(
    f: SpdfFile,
    c: Container,
    col: _Collector,
    *,
    partial: bool,
    has_time: bool = False,
    vector_count: int = 0,
    units: int = 0,
) -> None:
    if not partial:
        profile = set(col.r.profile)
        if ("semantic" in profile or "full" in profile) and vector_count == 0:
            col.warn("W100", "profile 'semantic' declared but the file has no vectors")
        if ("media" in profile or "full" in profile) and not has_time:
            col.warn("W101", "profile 'media' declared but no unit has a time anchor")
        try:
            doc = f.document
            if doc.unit_count != units:
                col.warn("W102", f"documents.unit_count is {doc.unit_count} but there are {units} units")
        except SpdfError:
            pass
    if not c.legacy and c.user_version > 500:
        col.warn("W105", f"file is SPDF {c.version}; this reader implements 5.0")
    if c.legacy:
        col.warn("W110", f"legacy SPDF {c.version} file; convert it with `spdf convert`")
