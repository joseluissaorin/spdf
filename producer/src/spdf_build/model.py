"""In-memory model of a document while it is being built.

Everything here is plain data: readers fill `Source` and its `Unit`s, the steps
add folios, sections, fragments, figures and vectors, and `output.write_spdf`
turns the result into a SPDF 5.0 file. Field names follow `spec/CONTRACT.md`
(English identifiers), so the mapping to the schema is one-to-one.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass
class FigureRead:
    """A figure as a reader saw it: region in fractions of the unit image."""

    caption: str = ""
    description: str = ""
    region: Optional[dict] = None  # {x,y,w,h} 0-1
    image: Optional[bytes] = None  # cropped image, if already available
    mime: str = "image/jpeg"


@dataclass
class Unit:
    """A citable unit: a page, a time span, a slide, a section, a sheet."""

    ord: int  # 1-based
    kind: str  # page | time | section | slide | sheet | web | image
    text: str = ""
    notes: list[str] = field(default_factory=list)
    header: str = ""
    footer: str = ""
    folio_seen: Optional[str] = None  # printed folio as the reader saw it
    label: Optional[str] = None  # PDF /PageLabels entry
    titles: list[tuple[int, str]] = field(default_factory=list)
    figures: list[FigureRead] = field(default_factory=list)
    empty: bool = False
    reader: str = "none"
    confidence: float = 1.0
    language: Optional[str] = None
    anchor: dict = field(default_factory=dict)
    # page image (scans, photos, slides, video frames); loaded lazily by readers
    image: Optional[bytes] = None
    image_mime: str = "image/jpeg"
    thumbnail: Optional[bytes] = None
    needs_vision: bool = False
    # media
    t0: Optional[float] = None
    t1: Optional[float] = None
    words: Optional[list[dict]] = None  # [{w, t0, t1, speaker?}]
    speaker: Optional[str] = None
    # free-form extras for readers (e.g. EPUB printed page, sheet name)
    extra: dict = field(default_factory=dict)

    @property
    def physical(self) -> int:
        return self.ord


@dataclass
class TocEntry:
    title: str
    level: int
    unit: Optional[int]  # 1-based unit ord where it starts


@dataclass
class Section:
    id: str
    parent: Optional[str]
    level: int
    title: str
    unit_from: int  # ord
    para_from: int
    unit_to: Optional[int] = None
    summary: Optional[str] = None


@dataclass
class Fragment:
    id: str
    ord: int
    unit: int  # ord of the start unit
    text: str
    context: str = ""
    section: list[str] = field(default_factory=list)
    section_id: Optional[str] = None
    anchor: dict = field(default_factory=dict)
    unit_end: Optional[int] = None
    anchor_end: Optional[dict] = None
    search_text: str = ""
    tokens: int = 0


@dataclass
class Figure:
    id: str
    unit: int
    image_key: Optional[str]
    caption: str
    description: str
    anchor: dict
    image: Optional[bytes] = None
    mime: str = "image/jpeg"


@dataclass
class Provenance:
    stage: str
    provider: Optional[str] = None
    model: Optional[str] = None
    detail: Any = None
    ms: Optional[int] = None


@dataclass
class Source:
    """What a reader returns: the document before the semantic steps."""

    path: Optional[str]
    kind: str  # pdf|scanned_pdf|photos|image|audio|video|document|epub|slides|sheet|web
    mime: str
    data: bytes
    units: list[Unit] = field(default_factory=list)
    toc: list[TocEntry] = field(default_factory=list)
    hints: dict = field(default_factory=dict)  # embedded metadata: title, author, language, isbn, url, accessed…
    duration: Optional[float] = None
    # lazily renders the image of unit `ord` at a given long side (pixels)
    render: Optional[Callable[[int, int], bytes]] = None
    provenance: list[Provenance] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


@dataclass
class Built:
    """Everything that goes into the file."""

    source: Source
    doc_id: str
    metadata: dict  # CSL-JSON item + "spdf" extension
    units: list[Unit]
    sections: list[Section]
    fragments: list[Fragment]
    figures: list[Figure]
    spaces: list[dict]
    vectors: list[tuple[str, str, str, Any]]  # (target, id, space, ndarray)
    provenance: list[Provenance]
    blobs: dict[str, tuple[str, bytes]] = field(default_factory=dict)  # key -> (mime, data)
    rights: Optional[dict] = None
    warnings: list[str] = field(default_factory=list)
