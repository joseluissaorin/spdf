"""spdf: read, validate, search, cite and write SPDF files.

SPDF (Semantic Processed Document Format) is a SQLite container for documents that
have been read once and can be cited forever: every passage carries its exact anchor
(printed page, folio, second of a recording, slide, verse).

Quick tour::

    import spdf

    with spdf.open("quijote.spdf") as f:          # 5.0, or legacy 4.x (gzip too)
        doc = f.document                          # spdf.Document (CSL-JSON metadata)
        for hit in f.search("lanza en astillero"):
            print(hit.anchor_uri, f.cite(hit.fragment))   # (Cervantes Saavedra, 1605, p. 23)

    report = spdf.validate("quijote.spdf")        # spdf.ValidationResult
    print(report.valid, report.to_dict())

Only the standard library is required. Optional extras: ``numpy`` (fast vectors),
``crypto`` (Ed25519 via ``cryptography``), ``pandas``, ``arrow``.
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Mapping
from typing import Any

from . import _sqlite
from ._sqlite import HAS_FTS5, HAS_TRIGRAM, driver_info
from ._version import __version__
from .anchors import Anchor, Region, anchor_to_locator, format_uri, make_uri, parse_uri
from .bibliography import csl_to_bibtex
from .canonical import canonical_dumps
from .cite import cite as _cite
from .errors import (
    Fts5UnavailableError,
    InvalidAnchorError,
    NotSpdfError,
    SignatureError,
    SpdfError,
    UnsafeFileError,
    UnsupportedExtensionError,
    WriterError,
)
from .integrity import IntegrityReport, generate_key, public_key_of, sign_hash, signer_id, verify_hash
from .model import (
    BlobInfo,
    Document,
    Extension,
    Figure,
    Fragment,
    Issue,
    Provenance,
    SearchResult,
    Section,
    Space,
    Unit,
    ValidationResult,
)
from .reader import SpdfFile, content_hash, open_spdf
from .validate import validate
from .writer import Writer, convert_legacy, copy_into, write_source

open = open_spdf

__all__ = [
    "HAS_FTS5",
    "HAS_TRIGRAM",
    "Anchor",
    "BlobInfo",
    "Document",
    "Extension",
    "Figure",
    "Fragment",
    "Fts5UnavailableError",
    "IntegrityReport",
    "InvalidAnchorError",
    "Issue",
    "NotSpdfError",
    "Provenance",
    "Region",
    "SearchResult",
    "Section",
    "SignatureError",
    "Space",
    "SpdfError",
    "SpdfFile",
    "Unit",
    "UnsafeFileError",
    "UnsupportedExtensionError",
    "ValidationResult",
    "Writer",
    "WriterError",
    "__version__",
    "anchor_to_locator",
    "canonical_dumps",
    "cite",
    "content_hash",
    "convert_legacy",
    "copy_into",
    "csl_to_bibtex",
    "driver_info",
    "dump",
    "format_uri",
    "generate_key",
    "make_uri",
    "open",
    "parse_uri",
    "public_key_of",
    "sign",
    "sign_hash",
    "signer_id",
    "validate",
    "verify",
    "verify_hash",
    "write_source",
]


def cite(
    anchor: Anchor | Mapping[str, Any] | None,
    document: Document | Mapping[str, Any],
    locale: str = "es",
    end: Anchor | Mapping[str, Any] | None = None,
) -> str:
    """Short citation ``(names, year, locator)`` for an anchor of a document.

    ``document`` is a :class:`Document` or its CSL-JSON metadata dict.
    """
    metadata = document.metadata if isinstance(document, Document) else document
    return _cite(anchor, metadata, locale, end)


def dump(source: str | os.PathLike[str] | bytes) -> dict[str, Any]:
    """Open a file and return its canonical dump (contract §5)."""
    with open_spdf(source) as f:
        return f.dump()


def verify(source: str | os.PathLike[str] | bytes, public_key: bytes | str | None = None) -> IntegrityReport:
    """Check ``content_sha256`` and the signature of a file.

    With ``public_key`` (raw 32 bytes or ``ed25519:<base64>``), ``trusted`` tells whether
    the file was signed by that key; without it, only internal consistency is checked.
    """
    from .integrity import load_public_key

    with open_spdf(source) as f:
        meta = f.meta
        actual = content_hash(f.dump())
    stored = meta.get("content_sha256")
    signature = meta.get("signature")
    signer = meta.get("signer")
    sig_ok: bool | None = None
    if signature is not None:
        sig_ok = (
            bool(signer) and stored is not None and stored == actual and verify_hash(actual, signature, signer or "")
        )
    trusted: bool | None = None
    if public_key is not None:
        expected = signer_id(load_public_key(public_key))
        trusted = bool(sig_ok) and signer == expected
    return IntegrityReport(
        content_sha256=actual,
        stored_sha256=stored,
        hash_ok=None if stored is None else stored == actual,
        signed=signature is not None,
        signature_ok=sig_ok,
        signer=signer,
        trusted=trusted,
    )


def sign(path: str | os.PathLike[str], private_key: bytes) -> IntegrityReport:
    """Add (or refresh) ``content_sha256``, ``signature`` and ``signer`` in a 5.0 file, in place."""
    with open_spdf(path) as f:
        if f.legacy:
            raise SpdfError("legacy files cannot be signed; convert them first (spdf convert)")
        digest = content_hash(f.dump())
    signature, signer = sign_hash(digest, private_key)
    _sqlite.require_fts5("signing")
    conn: sqlite3.Connection = _sqlite.driver.connect(os.fspath(path), isolation_level=None)
    try:
        conn.execute("BEGIN")
        conn.executemany(
            "INSERT OR REPLACE INTO spdf_meta (key, value) VALUES (?, ?)",
            [("content_sha256", digest), ("signature", signature), ("signer", signer)],
        )
        conn.execute("COMMIT")
        conn.execute("VACUUM")
    finally:
        conn.close()
    return verify(path)
