"""Safe opening of SPDF containers (contract §1).

* gzip input (legacy 4.x) is decompressed to a private temporary file, bounded by
  ``max_decompressed_size`` (default 4 GiB);
* the SQLite header is checked before SQLite sees the file (E001);
* the database is opened read-only by URI (``mode=ro``), with ``query_only``,
  ``trusted_schema=OFF``, ``cell_size_check``, ``SQLITE_DBCONFIG_DEFENSIVE`` (Python ≥ 3.12)
  and a length limit of ``max_blob_size`` (checked on every blob and vector at open,
  and enforced by SQLite with ``setlimit`` on Python ≥ 3.11); extensions are never loaded;
* ``application_id`` / ``user_version`` decide between 5.x and legacy 4.x (E002);
* triggers and views are refused, except the three FTS triggers of legacy files (E020).
"""

from __future__ import annotations

import contextlib
import gzip
import os
import re
import sqlite3
import tempfile
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NoReturn

from . import _sqlite
from .errors import NotSpdfError, UnsafeFileError
from .schema import APPLICATION_ID, LEGACY_TRIGGERS

__all__ = [
    "DEFAULT_MAX_BLOB_SIZE",
    "DEFAULT_MAX_DECOMPRESSED_SIZE",
    "Container",
    "open_container",
]

DEFAULT_MAX_BLOB_SIZE = 512 * 1024 * 1024
DEFAULT_MAX_DECOMPRESSED_SIZE = 4 * 1024 * 1024 * 1024

SQLITE_MAGIC = b"SQLite format 3\x00"
GZIP_MAGIC = b"\x1f\x8b"


@dataclass
class Container:
    """An opened SPDF container (internal; use :func:`spdf.open`)."""

    conn: sqlite3.Connection
    source: str
    db_path: Path
    temporary: bool
    gzip_wrapped: bool
    flavor: str  # "5" or "legacy"
    version: str  # "5.0", "5.1", "4.0", "4.1"
    application_id: int
    user_version: int
    schema_objects: list[tuple[str, str, str]] = field(default_factory=list)  # (type, name, tbl_name)

    @property
    def legacy(self) -> bool:
        return self.flavor == "legacy"

    def close(self) -> None:
        with contextlib.suppress(Exception):
            self.conn.close()
        if self.temporary:
            with contextlib.suppress(OSError):
                self.db_path.unlink()


def _gunzip(src: Path | bytes, max_size: int) -> Path:
    fd, tmp = tempfile.mkstemp(prefix="spdf-", suffix=".sqlite")
    total = 0
    try:
        with os.fdopen(fd, "wb") as out:
            raw: Any = gzip.GzipFile(fileobj=_BytesReader(src)) if isinstance(src, bytes) else gzip.open(src, "rb")
            with raw:
                while True:
                    chunk = raw.read(1 << 20)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_size:
                        raise UnsafeFileError(
                            f"gzip content exceeds the maximum decompressed size ({max_size} bytes)"
                        )
                    out.write(chunk)
    except (OSError, EOFError, zlib.error) as exc:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise NotSpdfError(f"corrupt gzip data: {exc}", "E001") from exc
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    return Path(tmp)


class _BytesReader:
    """Minimal file object over bytes (avoids importing io just for BytesIO typing)."""

    def __init__(self, data: bytes) -> None:
        self._data = memoryview(data)
        self._pos = 0

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            n = len(self._data) - self._pos
        chunk = self._data[self._pos : self._pos + n].tobytes()
        self._pos += len(chunk)
        return chunk

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return False

    def close(self) -> None:
        pass


def _connect(db_path: Path, *, immutable: bool, max_blob_size: int) -> sqlite3.Connection:
    uri = db_path.resolve().as_uri() + "?mode=ro"
    if immutable:
        uri += "&immutable=1"
    drv = _sqlite.driver
    conn: sqlite3.Connection = drv.connect(uri, uri=True, isolation_level=None)
    try:
        setconfig = getattr(conn, "setconfig", None)
        if setconfig is not None:
            for name, value in (
                ("SQLITE_DBCONFIG_DEFENSIVE", True),
                ("SQLITE_DBCONFIG_TRUSTED_SCHEMA", False),
                ("SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION", False),
                ("SQLITE_DBCONFIG_ENABLE_TRIGGER", False),
                ("SQLITE_DBCONFIG_ENABLE_VIEW", False),
            ):
                const = getattr(drv, name, None)
                if const is not None:
                    with contextlib.suppress(Exception):
                        setconfig(const, value)
        setlimit = getattr(conn, "setlimit", None)
        limit_const = getattr(drv, "SQLITE_LIMIT_LENGTH", None)
        if setlimit is not None and limit_const is not None:
            setlimit(limit_const, max(1_000_000, int(max_blob_size)))
        conn.execute("PRAGMA query_only = 1")
        conn.execute("PRAGMA trusted_schema = OFF")
        conn.execute("PRAGMA cell_size_check = ON")
    except BaseException:
        conn.close()
        raise
    return conn


def _version_from_user_version(uv: int) -> str:
    return f"{uv // 100}.{(uv % 100) // 10}"


def open_container(
    source: str | os.PathLike[str] | bytes,
    *,
    max_blob_size: int = DEFAULT_MAX_BLOB_SIZE,
    max_decompressed_size: int = DEFAULT_MAX_DECOMPRESSED_SIZE,
    check_objects: bool = True,
) -> Container:
    """Open a SPDF container safely. Raises :class:`NotSpdfError` or :class:`UnsafeFileError`."""
    temporary = False
    gz = False
    label: str
    if isinstance(source, (bytes, bytearray, memoryview)):
        data = bytes(source)
        label = "<bytes>"
        if data[:2] == GZIP_MAGIC:
            db_path = _gunzip(data, max_decompressed_size)
            gz = True
        else:
            fd, tmp = tempfile.mkstemp(prefix="spdf-", suffix=".sqlite")
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            db_path = Path(tmp)
        temporary = True
    else:
        path = Path(os.fspath(source))
        label = str(path)
        if not path.is_file():
            raise FileNotFoundError(f"no such file: {path}")
        with path.open("rb") as f:
            head = f.read(2)
        if head == GZIP_MAGIC:
            db_path = _gunzip(path, max_decompressed_size)
            gz = True
            temporary = True
        else:
            db_path = path

    def fail(exc: BaseException) -> NoReturn:
        if temporary:
            with contextlib.suppress(OSError):
                db_path.unlink()
        raise exc

    with db_path.open("rb") as f:
        header = f.read(100)
    if not header.startswith(SQLITE_MAGIC):
        fail(NotSpdfError(f"{label} is not a SQLite database", "E001"))

    try:
        conn = _connect(db_path, immutable=temporary, max_blob_size=max_blob_size)
    except sqlite3.Error as exc:
        fail(NotSpdfError(f"{label} cannot be opened as SQLite: {exc}", "E001"))

    try:
        app_id = int(conn.execute("PRAGMA application_id").fetchone()[0])
        uv = int(conn.execute("PRAGMA user_version").fetchone()[0])
        objects = [
            (str(t), str(n), str(tb))
            for t, n, tb in conn.execute("SELECT type, name, tbl_name FROM sqlite_master")
        ]
    except sqlite3.DatabaseError as exc:
        conn.close()
        fail(NotSpdfError(f"{label} is not a valid SQLite database: {exc}", "E001"))

    tables = {n for t, n, _ in objects if t == "table"}
    flavor: str
    version: str
    if app_id == APPLICATION_ID:
        if 500 <= uv <= 599:
            flavor, version = "5", _version_from_user_version(uv)
        else:
            conn.close()
            fail(NotSpdfError(f"unsupported SPDF user_version {uv} (this reader handles 5.x and 4.x)", "E002"))
    elif "spdf" in tables and "documentos" in tables:
        row_version = None
        with contextlib.suppress(sqlite3.Error):
            row = conn.execute("SELECT valor FROM spdf WHERE clave = 'spdf_version'").fetchone()
            row_version = str(row[0]) if row and row[0] is not None else None
        if row_version and row_version.startswith("4"):
            flavor, version = "legacy", row_version
        elif uv in (400, 410):
            flavor, version = "legacy", _version_from_user_version(uv)
        else:
            conn.close()
            fail(NotSpdfError(f"unknown legacy SPDF version {row_version or uv!r}", "E002"))
    elif "metadata" in tables and "chunks" in tables:
        conn.close()
        fail(
            NotSpdfError(
                "this is a legacy SPDF 3.x file (Scholaris v1–v3); import it into Scholaris "
                "or a 3.x importer to convert it",
                "E002",
            )
        )
    else:
        conn.close()
        fail(NotSpdfError(f"{label} is SQLite but not SPDF (application_id {app_id}, user_version {uv})", "E002"))

    container = Container(
        conn=conn,
        source=label,
        db_path=db_path,
        temporary=temporary,
        gzip_wrapped=gz,
        flavor=flavor,
        version=version,
        application_id=app_id,
        user_version=uv,
        schema_objects=objects,
    )
    if check_objects:
        bad = forbidden_objects(container)
        if bad:
            container.close()
            names = ", ".join(f"{t} {n!r}" for t, n in bad)
            raise UnsafeFileError(f"refusing a file with triggers or views: {names}", "E020")
        # length() reads only the record header, so this is cheap even for large files.
        _check_blob_sizes(container, max_blob_size)
    return container


def forbidden_objects(c: Container) -> list[tuple[str, str]]:
    """Triggers and views a safe reader must refuse (legacy FTS triggers are tolerated)."""
    out: list[tuple[str, str]] = []
    for t, name, tbl in c.schema_objects:
        if t not in ("trigger", "view"):
            continue
        if c.legacy and t == "trigger" and name in LEGACY_TRIGGERS and tbl == "fragmentos":
            continue
        out.append((t, name))
    return out


def _check_blob_sizes(c: Container, max_blob_size: int) -> None:
    checks = (
        [("vectores", "valores"), ("blobs", "datos")] if c.legacy else [("vectors", "data"), ("blobs", "data")]
    )
    tables = {n for t, n, _ in c.schema_objects if t == "table"}
    for table, col in checks:
        if table not in tables:
            continue
        try:
            row = c.conn.execute(f'SELECT max(length("{col}")) FROM "{table}"').fetchone()
        except sqlite3.Error:
            continue
        if row and row[0] is not None and int(row[0]) > max_blob_size:
            c.close()
            raise UnsafeFileError(f"a value in {table}.{col} exceeds the maximum blob size ({max_blob_size} bytes)")


_TOKENIZE_RE = re.compile(r"tokenize\s*=\s*(?:'((?:[^']|'')*)'|\"((?:[^\"]|\"\")*)\")", re.I)


def fts_tokenizer(sql: str | None) -> str | None:
    """Extract the ``tokenize=`` argument of a ``CREATE VIRTUAL TABLE … USING fts5`` statement."""
    if not sql:
        return None
    m = _TOKENIZE_RE.search(sql)
    if not m:
        return "unicode61"
    value = m.group(1) if m.group(1) is not None else (m.group(2) or "")
    return value.replace("''", "'").replace('""', '"')
