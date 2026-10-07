"""Typed, read-only records returned by :class:`spdf.SpdfFile`."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .anchors import Anchor

__all__ = [
    "BlobInfo",
    "Document",
    "Extension",
    "Figure",
    "Fragment",
    "Issue",
    "LexicalSearch",
    "Provenance",
    "SearchResult",
    "Section",
    "Space",
    "Unit",
    "ValidationResult",
]


@dataclass(frozen=True)
class Document:
    """The document of a SPDF file (one per file).

    :attr:`metadata` is the CSL-JSON item, with the SPDF extension object under the
    ``"spdf"`` key (provenance per field, undated range, original language, ORCID).
    """

    id: str
    kind: str
    metadata: dict[str, Any]
    source_sha256: str
    source_ref: str | None
    mime: str
    bytes: int
    unit_count: int
    duration: float | None
    created: str
    updated: str
    title: str | None
    authors: str | None
    year: int | None
    language: str | None
    rights: dict[str, Any] | None

    @property
    def csl(self) -> dict[str, Any]:
        """The CSL-JSON item ready for citeproc/Zotero/Pandoc: metadata without ``spdf``, plus ``id``."""
        item = {k: v for k, v in self.metadata.items() if k != "spdf"}
        item.setdefault("id", self.id)
        return item

    @property
    def extension(self) -> dict[str, Any]:
        """The ``spdf`` extension object of the metadata (``{}`` if absent)."""
        ext = self.metadata.get("spdf")
        return dict(ext) if isinstance(ext, dict) else {}

    @property
    def display_title(self) -> str:
        """Title for display: CSL ``title``, else the denormalized column, else the id."""
        t = self.metadata.get("title")
        return t if isinstance(t, str) and t else (self.title or self.id)


@dataclass(frozen=True)
class Unit:
    """A citable unit: a page, a time span, a slide, a section, a sheet range."""

    id: str
    document: str
    ord: int
    anchor: Anchor
    text: str
    notes: list[str] | None
    header: str | None
    footer: str | None
    image: str | None
    thumbnail: str | None
    reader: str
    confidence: float
    printed: str | None
    t0: float | None
    t1: float | None
    words: dict[str, Any] | None


@dataclass(frozen=True)
class Section:
    """An entry of the table of contents."""

    id: str
    document: str
    parent: str | None
    level: int
    title: str
    unit_from: str
    unit_to: str | None
    summary: str | None


@dataclass(frozen=True)
class Fragment:
    """A searchable, citable passage (about 150–300 words) with its anchor."""

    n: int
    id: str
    document: str
    unit: str
    ord: int
    text: str
    context: str
    section: list[str]
    anchor: Anchor
    anchor_end: Anchor | None
    search_text: str | None


@dataclass(frozen=True)
class Figure:
    """A figure (image region with caption and description)."""

    id: str
    document: str
    unit: str
    image: str
    caption: str | None
    description: str | None
    anchor: Anchor


@dataclass(frozen=True)
class Space:
    """A vector space: which model produced the vectors, its size and encoding."""

    id: str
    provider: str
    model: str
    version: str | None
    dims: int
    dtype: str
    normalized: bool
    truncated_from: int | None
    modalities: list[str]
    task_prefixes: dict[str, str] | None
    created: str | None

    def compatible_with(self, other: Space) -> bool:
        """True if vectors of both spaces are comparable (one query vector serves both)."""
        return (
            self.provider == other.provider
            and self.model == other.model
            and self.version == other.version
            and self.dims == other.dims
            and self.normalized == other.normalized
            and self.truncated_from == other.truncated_from
            and self.task_prefixes == other.task_prefixes
        )


@dataclass(frozen=True)
class BlobInfo:
    """An embedded binary (original file, page image, figure crop) without its bytes."""

    key: str
    mime: str
    bytes: int
    sha256: str


@dataclass(frozen=True)
class Provenance:
    """One step of the processing that produced the file."""

    document: str
    stage: str
    provider: str | None
    model: str | None
    detail: Any
    ms: int | None
    at: str


@dataclass(frozen=True)
class Extension:
    """A declared extension (``x_<vendor>_<name>`` tables)."""

    name: str
    version: str
    required: bool


@dataclass(frozen=True)
class SearchResult:
    """One search hit.

    :attr:`via` tells which lists produced it (``"lexical"``, ``"vector"`` or both, in
    that order). :attr:`fragment` is the full fragment, for convenience.
    """

    fragment_id: str
    score: float
    via: tuple[str, ...]
    anchor: Anchor
    anchor_uri: str
    fragment: Fragment | None = field(default=None, compare=False, repr=False)

    def to_dict(self) -> dict[str, Any]:
        """The result item of the reference search (contract §6)."""
        return {
            "fragment_id": self.fragment_id,
            "score": self.score,
            "via": list(self.via),
            "anchor": self.anchor.to_dict(),
            "anchor_uri": self.anchor_uri,
        }


@dataclass(frozen=True)
class LexicalSearch:
    """A lexical search with its execution details (see :meth:`SpdfFile.search_details`)."""

    route: str
    match: str | None
    results: list[SearchResult]


@dataclass(frozen=True)
class Issue:
    """A validation error or warning (``E0xx`` / ``W1xx``)."""

    code: str
    message: str
    where: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "where": self.where}


@dataclass
class ValidationResult:
    """Result of :func:`spdf.validate`. ``valid`` is true when there are no errors."""

    version: str | None
    profile: list[str] = field(default_factory=list)
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.errors

    @property
    def codes(self) -> set[str]:
        """Every error and warning code."""
        return {i.code for i in self.errors} | {i.code for i in self.warnings}

    def to_dict(self) -> dict[str, Any]:
        """The validation result object of the specification (contract §12)."""
        return {
            "valid": self.valid,
            "version": self.version,
            "profile": list(self.profile),
            "errors": [i.to_dict() for i in self.errors],
            "warnings": [i.to_dict() for i in self.warnings],
        }
