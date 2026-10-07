"""SQLite driver selection and FTS5 detection.

The ``sqlite3`` module of the standard library is used whenever its SQLite was
compiled with FTS5 (python.org installers, Homebrew, uv/python-build-standalone,
conda and most Linux distributions do). If it lacks FTS5 and the optional
``pysqlite3`` package (``pip install pysqlite3-binary``) is importable and has
FTS5, that driver is used instead. Otherwise the standard module is kept and the
operations that need FTS5 raise :class:`spdf.errors.Fts5UnavailableError` with an
explanation. Set ``SPDF_SQLITE=stdlib`` or ``SPDF_SQLITE=pysqlite3`` to force one.
"""

from __future__ import annotations

import os
import sqlite3
from types import ModuleType
from typing import Any

from .errors import Fts5UnavailableError

__all__ = ["HAS_FTS5", "HAS_TRIGRAM", "driver", "driver_info", "require_fts5"]


def _probe(mod: Any, sql: str) -> bool:
    try:
        con = mod.connect(":memory:")
    except Exception:
        return False
    try:
        con.execute(sql)
        return True
    except Exception:
        return False
    finally:
        con.close()


_FTS5_SQL = "CREATE VIRTUAL TABLE t USING fts5(a, tokenize='unicode61 remove_diacritics 2')"
_TRIGRAM_SQL = "CREATE VIRTUAL TABLE t USING fts5(a, tokenize='trigram')"


def _load_pysqlite3() -> ModuleType | None:
    try:
        from pysqlite3 import dbapi2
    except ImportError:
        return None
    return dbapi2


def _choose() -> ModuleType:
    forced = os.environ.get("SPDF_SQLITE", "").strip().lower()
    if forced == "stdlib":
        return sqlite3
    if forced == "pysqlite3":
        alt = _load_pysqlite3()
        if alt is None:
            raise ImportError("SPDF_SQLITE=pysqlite3 but pysqlite3 is not installed (pip install pysqlite3-binary)")
        return alt
    if _probe(sqlite3, _FTS5_SQL):
        return sqlite3
    alt = _load_pysqlite3()
    if alt is not None and _probe(alt, _FTS5_SQL):
        return alt
    return sqlite3


driver: ModuleType = _choose()
"""The DB-API module in use (``sqlite3`` or ``pysqlite3.dbapi2``)."""

HAS_FTS5: bool = _probe(driver, _FTS5_SQL)
"""True if the selected SQLite has FTS5 with the ``unicode61`` tokenizer."""

HAS_TRIGRAM: bool = HAS_FTS5 and _probe(driver, _TRIGRAM_SQL)
"""True if the selected SQLite has the FTS5 ``trigram`` tokenizer (SQLite ≥ 3.34)."""


FTS5_HELP = (
    "This Python's sqlite3 module was compiled without FTS5, which SPDF lexical search, "
    "writing and the FTS integrity check need. Use a Python whose SQLite has FTS5 "
    "(python.org installers, Homebrew, `uv python install`, conda and most Linux "
    "distributions do), or install the fallback driver: pip install pysqlite3-binary "
    "(Linux) and it will be picked up automatically."
)


def require_fts5(what: str = "this operation") -> None:
    """Raise :class:`Fts5UnavailableError` if FTS5 is missing."""
    if not HAS_FTS5:
        raise Fts5UnavailableError(f"{what} needs SQLite FTS5. {FTS5_HELP}")


def driver_info() -> dict[str, Any]:
    """Describe the SQLite in use (for ``spdf info --env`` and bug reports)."""
    return {
        "driver": driver.__name__,
        "sqlite_version": driver.sqlite_version,
        "fts5": HAS_FTS5,
        "trigram": HAS_TRIGRAM,
    }
