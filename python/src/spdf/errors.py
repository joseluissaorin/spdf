"""Exceptions raised by :mod:`spdf`.

Every exception derives from :class:`SpdfError`. When an error corresponds to a
validation code of the specification (``E001``, ``E020``…), it is available as
:attr:`SpdfError.code`.
"""

from __future__ import annotations

__all__ = [
    "Fts5UnavailableError",
    "InvalidAnchorError",
    "NotSpdfError",
    "SignatureError",
    "SpdfError",
    "UnsafeFileError",
    "UnsupportedExtensionError",
    "WriterError",
]


class SpdfError(Exception):
    """Base class of every error raised by this package."""

    code: str | None

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code

    def __str__(self) -> str:
        base = super().__str__()
        return f"{self.code}: {base}" if self.code else base


class NotSpdfError(SpdfError):
    """The file is not SQLite (E001) or not a SPDF version this library knows (E002)."""


class UnsafeFileError(SpdfError):
    """The file contains something a safe reader must refuse (triggers, views, oversized blobs…)."""


class UnsupportedExtensionError(SpdfError):
    """The file requires an extension this reader does not implement (E060)."""


class Fts5UnavailableError(SpdfError):
    """The ``sqlite3`` module of this Python was compiled without FTS5.

    Reading works without FTS5; lexical search, writing and the FTS integrity
    check need it.
    """


class InvalidAnchorError(SpdfError, ValueError):
    """An anchor or anchor URI cannot be parsed."""


class WriterError(SpdfError):
    """The :class:`spdf.Writer` was given inconsistent data or produced an invalid file."""


class SignatureError(SpdfError):
    """A signature is missing, malformed or does not verify."""
