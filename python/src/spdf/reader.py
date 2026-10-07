"""Reading SPDF files: :func:`open_spdf` (exported as :func:`spdf.open`) and :class:`SpdfFile`.

A legacy 4.0/4.1 file reads exactly like a 5.0 one: table and column names, anchors,
metadata (CSL-JSON) and references are mapped on the fly (contract §7).
"""

from __future__ import annotations

import contextlib
import dataclasses
import hashlib
import json
import os
import sqlite3
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

from . import _sqlite
from .anchors import Anchor, docref_for, locator_to_anchor, make_uri, parse_params, parse_uri
from .canonical import canonical_dumps, round_floats
from .cite import cite as _cite
from .container import (
    DEFAULT_MAX_BLOB_SIZE,
    DEFAULT_MAX_DECOMPRESSED_SIZE,
    Container,
    fts_tokenizer,
    open_container,
)
from .errors import SpdfError, UnsupportedExtensionError
from .legacy import map_anchor, map_kind, map_meta_key, map_metadata, map_modalities, map_target
from .model import (
    BlobInfo,
    Document,
    Extension,
    Figure,
    Fragment,
    LexicalSearch,
    Provenance,
    SearchResult,
    Section,
    Space,
    Unit,
)
from .schema import JSON_COLUMNS, LEGACY_COLUMNS, LEGACY_TABLES, LEGACY_TARGETS, TABLES_50
from .search import is_cjk, parse_query, rrf
from .vectors import decode, scores

__all__ = ["SpdfFile", "open_spdf"]

_REVERSE_TARGETS = {v: k for k, v in LEGACY_TARGETS.items()}
# Integrity keys excluded from the content hash (contract §8).
INTEGRITY_KEYS = ("content_sha256", "signature", "signer")


def _reject_constant(name: str) -> Any:
    raise ValueError(f"invalid JSON number {name}")


def loads_json(value: Any) -> Any:
    """Parse a JSON-in-TEXT column (None stays None). Raises ValueError on bad JSON."""
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        value = bytes(value).decode("utf-8")
    return json.loads(value, parse_constant=_reject_constant)


def _soft_json(value: Any) -> Any:
    try:
        return loads_json(value)
    except (ValueError, TypeError):
        return value


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def open_spdf(
    source: str | os.PathLike[str] | bytes,
    *,
    max_blob_size: int = DEFAULT_MAX_BLOB_SIZE,
    max_decompressed_size: int = DEFAULT_MAX_DECOMPRESSED_SIZE,
) -> SpdfFile:
    """Open a SPDF file (5.x, or legacy 4.0/4.1 possibly gzip-wrapped) read-only and safely.

    ``source`` is a path or the bytes of the file. Use it as a context manager::

        with spdf.open("quijote.spdf") as f:
            print(f.document.display_title)
            for hit in f.search("lanza en astillero"):
                print(f.cite(hit.fragment), hit.fragment.text[:80])

    Raises :class:`~spdf.errors.NotSpdfError` (E001/E002), :class:`~spdf.errors.UnsafeFileError`
    (E020, size limits) or :class:`~spdf.errors.UnsupportedExtensionError` (E060).
    """
    container = open_container(source, max_blob_size=max_blob_size, max_decompressed_size=max_decompressed_size)
    f = SpdfFile(container, owns=True)
    try:
        f._check_extensions()
    except BaseException:
        f.close()
        raise
    return f


class SpdfFile:
    """An open SPDF file (read-only). Create it with :func:`spdf.open`."""

    def __init__(self, container: Container, *, owns: bool = False) -> None:
        self._c = container
        self._owns = owns
        self.conn: sqlite3.Connection = container.conn
        self._columns: dict[str, list[str]] = {}
        self._tables: set[str] = {n for t, n, _ in container.schema_objects if t == "table"}
        self._blob_keys: set[str] | None = None
        self._unit_rank: dict[str, int] | None = None
        self._document: Document | None = None
        self._meta: dict[str, str] | None = None
        self._n_by_id: dict[str, int] | None = None
        self._closed = False

    # -- lifecycle -------------------------------------------------------------

    def close(self) -> None:
        """Close the connection and delete any temporary file."""
        if not self._closed:
            self._closed = True
            self._c.close()

    def __enter__(self) -> SpdfFile:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def __del__(self) -> None:  # pragma: no cover - best effort
        if getattr(self, "_owns", False):
            with contextlib.suppress(Exception):
                self.close()

    def __repr__(self) -> str:
        return f"<SpdfFile {self._c.source!r} version={self.version}>"

    # -- identity --------------------------------------------------------------

    @property
    def path(self) -> str:
        """The path the file was opened from (``"<bytes>"`` for in-memory input)."""
        return self._c.source

    @property
    def version(self) -> str:
        """``"5.0"`` (or a newer 5.x), or ``"4.0"`` / ``"4.1"`` for legacy files."""
        return self._c.version

    @property
    def legacy(self) -> bool:
        """True for legacy 4.x files (read through the 5.0 view)."""
        return self._c.legacy

    @property
    def gzip_wrapped(self) -> bool:
        """True if the input was gzip-compressed."""
        return self._c.gzip_wrapped

    @property
    def meta(self) -> dict[str, str]:
        """The ``spdf_meta`` key/value pairs (legacy keys mapped: ``creado`` → ``created``…)."""
        if self._meta is None:
            self._meta = {r["key"]: r["value"] for r in self._rows("spdf_meta", order='"key"')}
        return dict(self._meta)

    @property
    def profile(self) -> list[str]:
        """Declared profiles (``core``, ``semantic``, ``media``, ``full``)."""
        return [p for p in (self.meta.get("profile") or "").split() if p]

    @property
    def document(self) -> Document:
        """The document of the file."""
        if self._document is None:
            rows = self._rows("documents", order='"id"')
            if not rows:
                raise SpdfError("the file holds no document", "E013")
            wanted = self.meta.get("document_id")
            row = next((r for r in rows if r["id"] == wanted), rows[0])
            self._document = self._make_document(row)
        return self._document

    @property
    def docref(self) -> str:
        """The ``<docref>`` used in anchor URIs (``sha256-<hex>`` when possible)."""
        d = self.document
        return docref_for(d.source_sha256, d.id)

    # -- low-level row access (5.0 names) ------------------------------------------

    def has_table(self, table: str) -> bool:
        """True if the 5.0 table (or its legacy counterpart) exists."""
        return self._physical(table) in self._tables

    def _physical(self, table: str) -> str:
        return LEGACY_TABLES.get(table, table) if self.legacy else table

    def _cols(self, physical: str) -> list[str]:
        if physical not in self._columns:
            try:
                self._columns[physical] = [str(r[1]) for r in self.conn.execute(f"PRAGMA table_info({_q(physical)})")]
            except sqlite3.Error:
                self._columns[physical] = []
        return self._columns[physical]

    def _select(self, table: str, columns: Sequence[str] | None = None) -> str:
        physical = self._physical(table)
        present = set(self._cols(physical))
        wanted = columns or TABLES_50[table]
        exprs = []
        for col in wanted:
            src = LEGACY_COLUMNS.get(table, {}).get(col) if self.legacy else col
            if src is not None and src in present:
                exprs.append(f"{_q(src)} AS {_q(col)}" if src != col else _q(col))
            else:
                exprs.append(f"NULL AS {_q(col)}")
        return f"SELECT {', '.join(exprs)} FROM {_q(physical)}"

    def _raw(
        self,
        table: str,
        *,
        columns: Sequence[str] | None = None,
        where: str = "",
        params: Sequence[Any] = (),
        order: str = "",
        limit: int | None = None,
    ) -> Iterator[dict[str, Any]]:
        if not self.has_table(table):
            return
        sql = self._select(table, columns)
        if where:
            sql += f" WHERE {where}"
        if order:
            sql += f" ORDER BY {order}"
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        cur = self.conn.execute(sql, tuple(params))
        names = [d[0] for d in cur.description]
        for row in cur:
            yield dict(zip(names, row, strict=True))

    def _rows(self, table: str, **kw: Any) -> list[dict[str, Any]]:
        return [self._process(table, r) for r in self._raw(table, **kw)]

    def _iter(self, table: str, **kw: Any) -> Iterator[dict[str, Any]]:
        for r in self._raw(table, **kw):
            yield self._process(table, r)

    def _process(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        """Parse JSON columns and apply the legacy mapping (rows keep 5.0 column names)."""
        r = row
        legacy = self.legacy
        raw_kind = r.get("kind") if table == "documents" else None
        if legacy and table == "documents" and isinstance(raw_kind, str):
            r["kind"] = map_kind(raw_kind)
        for col in JSON_COLUMNS.get(table, ()):
            if col in r:
                r[col] = _soft_json(r[col])
        if table == "provenance" and "detail" in r:
            r["detail"] = _soft_json(r["detail"])
        if not legacy:
            return r
        if table == "spdf_meta" and "key" in r:
            r["key"] = map_meta_key(r["key"])
        elif table == "documents":
            if "metadata" in r:
                r["metadata"] = map_metadata(r["metadata"], raw_kind if isinstance(raw_kind, str) else None)
            if "source_ref" in r:
                r["source_ref"] = self._legacy_ref(r["source_ref"])
            if "rights" in r:
                r["rights"] = None
        elif table == "units":
            if "anchor" in r:
                r["anchor"] = map_anchor(r["anchor"])
            for col in ("image", "thumbnail"):
                if col in r:
                    r[col] = self._legacy_ref(r[col])
            if "ord" in r and "id" in r:
                r["ord"] = self._legacy_unit_rank().get(r["id"], r["ord"])
        elif table == "fragments":
            for col in ("anchor", "anchor_end"):
                if col in r:
                    r[col] = map_anchor(r[col])
        elif table == "figures":
            if "anchor" in r:
                r["anchor"] = map_anchor(r["anchor"])
            if "image" in r and r["image"] != "":
                r["image"] = self._legacy_ref(r["image"])
        elif table == "spaces":
            if "dtype" in r:
                r["dtype"] = "f32"
            if "modalities" in r:
                r["modalities"] = map_modalities(r["modalities"])
        elif table == "vectors" and "target" in r and isinstance(r["target"], str):
            r["target"] = map_target(r["target"])
        return r

    def _legacy_blob_keys(self) -> set[str]:
        if self._blob_keys is None:
            self._blob_keys = (
                {str(r[0]) for r in self.conn.execute("SELECT clave FROM blobs")} if "blobs" in self._tables else set()
            )
        return self._blob_keys

    def _legacy_ref(self, value: Any) -> Any:
        if value is None or value == "":
            return None
        if isinstance(value, str) and value in self._legacy_blob_keys():
            return "blob:" + value
        return value

    def _legacy_unit_rank(self) -> dict[str, int]:
        if self._unit_rank is None:
            self._unit_rank = {
                str(r[0]): i
                for i, r in enumerate(self.conn.execute("SELECT id FROM unidades ORDER BY orden, id"), start=1)
            }
        return self._unit_rank

    def _unit_order(self) -> str:
        return '"orden", "id"' if self.legacy else '"ord", "id"'

    def _check_extensions(self) -> None:
        for ext in self.extensions():
            if ext.required:
                raise UnsupportedExtensionError(
                    f"the file requires extension {ext.name!r} {ext.version}, which this reader does not know",
                    "E060",
                )

    # -- typed records ------------------------------------------------------------------

    @staticmethod
    def _anchor(value: Any) -> Anchor:
        if isinstance(value, Mapping) and isinstance(value.get("type"), str):
            return Anchor.from_dict(value)
        return Anchor(type="unknown", raw=dict(value) if isinstance(value, Mapping) else {})

    def _make_document(self, r: Mapping[str, Any]) -> Document:
        meta = r.get("metadata")
        rights = r.get("rights")
        return Document(
            id=str(r["id"]),
            kind=str(r.get("kind") or ""),
            metadata=dict(meta) if isinstance(meta, Mapping) else {},
            source_sha256=str(r.get("source_sha256") or ""),
            source_ref=r.get("source_ref"),
            mime=str(r.get("mime") or ""),
            bytes=int(r.get("bytes") or 0),
            unit_count=int(r.get("unit_count") or 0),
            duration=r.get("duration"),
            created=str(r.get("created") or ""),
            updated=str(r.get("updated") or ""),
            title=r.get("title"),
            authors=r.get("authors"),
            year=r.get("year"),
            language=r.get("language"),
            rights=dict(rights) if isinstance(rights, Mapping) else None,
        )

    def _make_unit(self, r: Mapping[str, Any]) -> Unit:
        notes = r.get("notes")
        words = r.get("words")
        return Unit(
            id=str(r["id"]),
            document=str(r.get("document") or ""),
            ord=int(r["ord"]),
            anchor=self._anchor(r.get("anchor")),
            text=str(r.get("text") or ""),
            notes=[str(x) for x in notes] if isinstance(notes, list) else None,
            header=r.get("header"),
            footer=r.get("footer"),
            image=r.get("image"),
            thumbnail=r.get("thumbnail"),
            reader=str(r.get("reader") or ""),
            confidence=float(r["confidence"]) if r.get("confidence") is not None else 1.0,
            printed=r.get("printed"),
            t0=r.get("t0"),
            t1=r.get("t1"),
            words=dict(words) if isinstance(words, Mapping) else None,
        )

    def _make_fragment(self, r: Mapping[str, Any]) -> Fragment:
        section = r.get("section")
        end = r.get("anchor_end")
        return Fragment(
            n=int(r["n"]),
            id=str(r["id"]),
            document=str(r.get("document") or ""),
            unit=str(r.get("unit") or ""),
            ord=int(r.get("ord") or 0),
            text=str(r.get("text") or ""),
            context=str(r.get("context") or ""),
            section=[str(x) for x in section] if isinstance(section, list) else [],
            anchor=self._anchor(r.get("anchor")),
            anchor_end=self._anchor(end) if isinstance(end, Mapping) else None,
            search_text=r.get("search_text"),
        )

    def _make_figure(self, r: Mapping[str, Any]) -> Figure:
        return Figure(
            id=str(r["id"]),
            document=str(r.get("document") or ""),
            unit=str(r.get("unit") or ""),
            image=str(r.get("image") or ""),
            caption=r.get("caption"),
            description=r.get("description"),
            anchor=self._anchor(r.get("anchor")),
        )

    @staticmethod
    def _make_space(r: Mapping[str, Any]) -> Space:
        mods = r.get("modalities")
        tp = r.get("task_prefixes")
        return Space(
            id=str(r["id"]),
            provider=str(r.get("provider") or ""),
            model=str(r.get("model") or ""),
            version=r.get("version"),
            dims=int(r.get("dims") or 0),
            dtype=str(r.get("dtype") or "f32"),
            normalized=bool(r.get("normalized", 1)),
            truncated_from=r.get("truncated_from"),
            modalities=[str(x) for x in mods] if isinstance(mods, list) else [],
            task_prefixes={str(k): str(v) for k, v in tp.items()} if isinstance(tp, Mapping) else None,
            created=r.get("created"),
        )

    def units(self) -> list[Unit]:
        """All units in reading order (``ord``)."""
        return list(self.iter_units())

    def iter_units(self) -> Iterator[Unit]:
        """Iterate the units in reading order without loading them all."""
        for r in self._iter("units", order=self._unit_order()):
            yield self._make_unit(r)

    def unit(self, unit_id: str) -> Unit | None:
        """The unit with this id, or ``None``."""
        rows = self._rows("units", where=f"{_q(self._col('units', 'id'))} = ?", params=(unit_id,))
        return self._make_unit(rows[0]) if rows else None

    def unit_by_printed(self, printed: str) -> Unit | None:
        """The first unit whose printed folio is ``printed`` (``"145"``, ``"xiv"``)."""
        rows = self._rows(
            "units",
            where=f"{_q(self._col('units', 'printed'))} = ?",
            params=(printed,),
            order=self._unit_order(),
            limit=1,
        )
        return self._make_unit(rows[0]) if rows else None

    def _col(self, table: str, col: str) -> str:
        return LEGACY_COLUMNS[table][col] if self.legacy else col

    def sections(self) -> list[Section]:
        """The table of contents (ordered by id)."""
        return [
            Section(
                id=str(r["id"]),
                document=str(r.get("document") or ""),
                parent=r.get("parent"),
                level=int(r.get("level") or 0),
                title=str(r.get("title") or ""),
                unit_from=str(r.get("unit_from") or ""),
                unit_to=r.get("unit_to"),
                summary=r.get("summary"),
            )
            for r in self._rows("sections", order='"id"')
        ]

    def fragments(self) -> list[Fragment]:
        """All fragments ordered by ``n``."""
        return list(self.iter_fragments())

    def iter_fragments(self) -> Iterator[Fragment]:
        """Iterate the fragments ordered by ``n``."""
        for r in self._iter("fragments", order='"n"'):
            yield self._make_fragment(r)

    def fragment(self, fragment_id: str) -> Fragment | None:
        """The fragment with this id, or ``None``."""
        rows = self._rows("fragments", where=f"{_q(self._col('fragments', 'id'))} = ?", params=(fragment_id,))
        return self._make_fragment(rows[0]) if rows else None

    def fragment_by_n(self, n: int) -> Fragment | None:
        """The fragment with this ``n`` (the FTS rowid), or ``None``."""
        rows = self._rows("fragments", where='"n" = ?', params=(int(n),))
        return self._make_fragment(rows[0]) if rows else None

    def _fragments_by_n(self, ns: Sequence[int]) -> dict[int, Fragment]:
        out: dict[int, Fragment] = {}
        for i in range(0, len(ns), 500):
            chunk = list(ns[i : i + 500])
            marks = ",".join("?" * len(chunk))
            for r in self._rows("fragments", where=f'"n" IN ({marks})', params=chunk):
                f = self._make_fragment(r)
                out[f.n] = f
        return out

    def figures(self) -> list[Figure]:
        """All figures (ordered by id)."""
        return [self._make_figure(r) for r in self._rows("figures", order='"id"')]

    def spaces(self) -> list[Space]:
        """Vector spaces (ordered by id)."""
        return [self._make_space(r) for r in self._rows("spaces", order='"id"')]

    def space(self, space_id: str | None = None) -> Space:
        """A space by id; with no id, the only space of the file."""
        spaces = self.spaces()
        if space_id is None:
            if len(spaces) != 1:
                ids = ", ".join(s.id for s in spaces) or "none"
                raise SpdfError(f"choose a vector space (available: {ids})")
            return spaces[0]
        for s in spaces:
            if s.id == space_id:
                return s
        raise SpdfError(f"unknown vector space {space_id!r}", "E031")

    def vectors(self, space: str | None = None, target: str = "fragment") -> Iterator[tuple[str, list[float]]]:
        """Iterate ``(id, vector)`` of a space and target (vectors decoded to float lists)."""
        sp = self.space(space)
        for vid, data in self._vector_rows(sp.id, target):
            yield vid, decode(data, sp.dtype)

    def vector_matrix(self, space: str | None = None, target: str = "fragment") -> tuple[list[str], Any]:
        """``(ids, matrix)`` with a float32 numpy matrix (rows = vectors). Requires numpy."""
        import numpy as np

        sp = self.space(space)
        ids: list[str] = []
        blobs: list[bytes] = []
        for vid, data in self._vector_rows(sp.id, target):
            ids.append(vid)
            blobs.append(data)
        np_dtype = {"f32": "<f4", "f16": "<f2", "i8": "i1"}[sp.dtype]
        mat = np.frombuffer(b"".join(blobs), dtype=np_dtype).reshape(len(blobs), sp.dims).astype("float32")
        if sp.dtype == "i8":
            mat = mat / np.float32(127.0)
        return ids, mat

    def _vector_rows(self, space_id: str, target: str) -> Iterator[tuple[str, bytes]]:
        if not self.has_table("vectors"):
            return
        t = _REVERSE_TARGETS.get(target, target) if self.legacy else target
        tcol, scol = self._col("vectors", "target"), self._col("vectors", "space")
        dcol, icol = self._col("vectors", "data"), self._col("vectors", "id")
        sql = (
            f"SELECT {_q(icol)}, {_q(dcol)} FROM {_q(self._physical('vectors'))} "
            f"WHERE {_q(scol)} = ? AND {_q(tcol)} = ? ORDER BY {_q(icol)}"
        )
        for vid, data in self.conn.execute(sql, (space_id, t)):
            yield str(vid), bytes(data)

    def blobs(self) -> list[BlobInfo]:
        """Embedded binaries (ordered by key); ``sha256`` is computed from the bytes."""
        out: list[BlobInfo] = []
        if not self.has_table("blobs"):
            return out
        kcol, mcol, dcol = self._col("blobs", "key"), self._col("blobs", "mime"), self._col("blobs", "data")
        sql = f"SELECT {_q(kcol)}, {_q(mcol)}, {_q(dcol)} FROM {_q(self._physical('blobs'))} ORDER BY {_q(kcol)}"
        for key, mime, data in self.conn.execute(sql):
            b = bytes(data) if data is not None else b""
            out.append(BlobInfo(str(key), str(mime), len(b), hashlib.sha256(b).hexdigest()))
        return out

    def blob(self, key: str) -> bytes | None:
        """The bytes of a blob (``key`` with or without the ``blob:`` prefix), or ``None``."""
        if not self.has_table("blobs"):
            return None
        k = key[5:] if key.startswith("blob:") else key
        kcol, dcol = self._col("blobs", "key"), self._col("blobs", "data")
        row = self.conn.execute(
            f"SELECT {_q(dcol)} FROM {_q(self._physical('blobs'))} WHERE {_q(kcol)} = ?", (k,)
        ).fetchone()
        return bytes(row[0]) if row and row[0] is not None else None

    def blob_mime(self, key: str) -> str | None:
        """The media type of a blob, or ``None``."""
        if not self.has_table("blobs"):
            return None
        k = key[5:] if key.startswith("blob:") else key
        kcol, mcol = self._col("blobs", "key"), self._col("blobs", "mime")
        row = self.conn.execute(
            f"SELECT {_q(mcol)} FROM {_q(self._physical('blobs'))} WHERE {_q(kcol)} = ?", (k,)
        ).fetchone()
        return str(row[0]) if row else None

    def original(self) -> bytes | None:
        """The original source bytes, if shipped inside the file."""
        ref = self.document.source_ref
        return self.blob(ref) if ref and ref.startswith("blob:") else None

    def provenance(self) -> list[Provenance]:
        """Processing steps, in the canonical order."""
        return [
            Provenance(
                document=str(r.get("document") or ""),
                stage=str(r.get("stage") or ""),
                provider=r.get("provider"),
                model=r.get("model"),
                detail=r.get("detail"),
                ms=r.get("ms"),
                at=str(r.get("at") or ""),
            )
            for r in _sort_provenance(self._rows("provenance"))
        ]

    def extensions(self) -> list[Extension]:
        """Declared extensions (none in legacy files)."""
        if self.legacy or not self.has_table("extensions"):
            return []
        return [
            Extension(str(r["name"]), str(r["version"]), bool(r["required"]))
            for r in self._rows("extensions", order='"name"')
        ]

    @property
    def fts_info(self) -> dict[str, Any]:
        """``{"tokenizer": …, "trigram": bool}`` as in the dump."""
        name = self._physical("fragments_fts")
        sql = self._sql_of(name) if name in self._tables else None
        return {"tokenizer": fts_tokenizer(sql), "trigram": "fragments_fts_trigram" in self._tables}

    def _sql_of(self, name: str) -> str | None:
        row = self.conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (name,)).fetchone()
        return str(row[0]) if row and row[0] is not None else None

    # -- anchors, URIs, citations -----------------------------------------------------

    def anchor_uri(
        self,
        item: Fragment | Unit | Figure | Anchor | Mapping[str, Any],
        end: Anchor | Mapping[str, Any] | None = None,
    ) -> str:
        """The anchor URI of a fragment, unit, figure or anchor in this document."""
        anchor, end = _anchor_of(item, end)
        return make_uri(self.docref, anchor, end)

    def cite(
        self,
        item: Fragment | Unit | Figure | Anchor | Mapping[str, Any] | str | None = None,
        *,
        locale: str = "es",
        end: Anchor | Mapping[str, Any] | None = None,
    ) -> str:
        """Short citation for a fragment, unit, figure, anchor or anchor URI: ``(Cervantes, 1605, p. 23)``.

        With no item, the citation of the whole document (``(Cervantes, 1605)``).
        """
        if item is None:
            return _cite(None, self.document.metadata, locale)
        if isinstance(item, str):
            loc = self._locator(item)
            if loc is None:
                raise SpdfError("the anchor URI designates another document")
            return _cite(locator_to_anchor(loc), self.document.metadata, locale)
        anchor, end = _anchor_of(item, end)
        return _cite(anchor, self.document.metadata, locale, end)

    def _locator(self, target: str) -> dict[str, Any] | None:
        """Locator of an anchor URI for this document, of a URL with an anchor fragment
        (``https://…/x.spdf#p=5``, SPEC §24) or of a bare fragment; ``None`` if the URI
        designates another document."""
        if target.startswith("spdf:"):
            parsed = parse_uri(target)
            doc = self.document
            ref = parsed["docref"]
            if ref.startswith("sha256-"):
                if ref[7:] != (doc.source_sha256 or "").lower():
                    return None
            elif ref != doc.id:
                return None
            return dict(parsed["locator"])
        frag = target.split("#", 1)[1] if "#" in target else target
        return parse_params(frag)

    def locate(self, uri: str) -> list[Unit]:
        """Units an anchor URI points at (by physical page, printed folio, time, slide…).

        Returns ``[]`` when the URI designates another document (SPEC §5.4).
        """
        loc = self._locator(uri)
        if loc is None:
            return []
        out: list[Unit] = []
        for u in self.iter_units():
            a = u.anchor
            if "p" in loc:
                hit = a.physical is not None and loc["p"] <= a.physical <= loc.get("pe", loc["p"])
            elif "f" in loc:
                hit = u.printed == loc["f"] or a.printed == loc["f"]
            elif "t" in loc:
                t = loc["t"][0]
                hit = a.t0 is not None and a.t1 is not None and a.t0 <= t < a.t1
            elif "sl" in loc:
                hit = a.n == loc["sl"]
            elif "v" in loc:
                hit = a.line_from is not None and a.line_from <= loc["v"][0] <= (a.line_to or a.line_from)
            elif "ref" in loc:
                hit = a.scheme == loc["ref"]["scheme"] and a.ref == loc["ref"]["ref"]
            elif "s" in loc:
                hit = a.path is not None and list(a.path[: len(loc["s"])]) == loc["s"]
            else:
                hit = False
            if hit:
                out.append(u)
        return out

    # -- search --------------------------------------------------------------------------

    def _result(self, f: Fragment, score: float, via: tuple[str, ...]) -> SearchResult:
        return SearchResult(
            fragment_id=f.id,
            score=score,
            via=via,
            anchor=f.anchor,
            anchor_uri=make_uri(self.docref, f.anchor, f.anchor_end),
            fragment=f,
        )

    def _lexical_ranked(self, query: str, limit: int) -> tuple[str, str | None, list[tuple[int, float]]]:
        """``(route, match, [(n, score)])`` of the reference lexical algorithm."""
        parsed = parse_query(query)
        if not parsed.terms:
            return "fts", None, []
        q = parsed.match
        if is_cjk(query):
            trigram = "fragments_fts_trigram" in self._tables and not self.legacy
            if trigram and all(len(t) >= 3 for t in parsed.terms):
                _sqlite.require_fts5("lexical search")
                sql = (
                    "SELECT rowid, bm25(fragments_fts_trigram) AS r FROM fragments_fts_trigram "
                    "WHERE fragments_fts_trigram MATCH ? ORDER BY r, rowid LIMIT ?"
                )
                return "trigram", q, [(int(n), -float(r)) for n, r in self.conn.execute(sql, (q, int(limit)))]
            return "substring", None, self._substring_ranked(parsed.terms, parsed.phrases, limit)
        _sqlite.require_fts5("lexical search")
        fts = self._physical("fragments_fts")
        ncols = len(self._cols(fts)) or 4
        weights = ", ".join(["1.0", "0.5", "0.5", "1.0"][:ncols] + ["1.0"] * max(0, ncols - 4))
        sql = (
            f"SELECT rowid, bm25({_q(fts)}, {weights}) AS r FROM {_q(fts)} "
            f"WHERE {_q(fts)} MATCH ? ORDER BY r, rowid LIMIT ?"
        )
        return "fts", q, [(int(n), -float(r)) for n, r in self.conn.execute(sql, (q, int(limit)))]

    def _substring_ranked(self, terms: Sequence[str], phrases: bool, limit: int) -> list[tuple[int, float]]:
        tcol = _q(self._col("fragments", "text"))
        hits = " + ".join(f"(instr({tcol}, ?) > 0)" for _ in terms)
        need = len(terms) if phrases else 1
        sql = (
            f"SELECT n, ({hits}) AS h FROM {_q(self._physical('fragments'))} WHERE ({hits}) >= ? "
            f"ORDER BY h DESC, n LIMIT ?"
        )
        params = [*terms, *terms, need, int(limit)]
        return [(int(n), float(h)) for n, h in self.conn.execute(sql, params)]

    def search(self, query: str, *, limit: int = 10) -> list[SearchResult]:
        """Lexical search (BM25 over FTS5) with the reference algorithm.

        Words are OR-ed; quoted phrases (``"…"``, ``“…”``, ``«…»``, ``„…“``) are AND-ed and
        then loose words are ignored. Diacritics and case are folded by the index. Queries
        in Chinese, Japanese or Korean use the trigram index when the file has one, else a
        substring scan.
        """
        return self.search_details(query, limit=limit).results

    def search_details(self, query: str, *, limit: int = 10) -> LexicalSearch:
        """Lexical search plus how it ran: ``route`` (``fts``, ``trigram``, ``substring``) and the MATCH string."""
        route, match, ranked = self._lexical_ranked(query, limit)
        frags = self._fragments_by_n([n for n, _ in ranked])
        results = [self._result(frags[n], s, ("lexical",)) for n, s in ranked if n in frags]
        return LexicalSearch(route=route, match=match, results=results)

    def _n_map(self) -> dict[str, int]:
        if self._n_by_id is None:
            icol = _q(self._col("fragments", "id"))
            self._n_by_id = {
                str(i): int(n) for i, n in self.conn.execute(f"SELECT {icol}, n FROM {_q(self._physical('fragments'))}")
            }
        return self._n_by_id

    def _vector_ranked(
        self, vector: Sequence[float] | Any, space: str | None, limit: int, target: str = "fragment"
    ) -> list[tuple[str, float]]:
        sp = self.space(space)
        q = [float(x) for x in vector]
        if len(q) != sp.dims:
            raise ValueError(f"query vector has {len(q)} dimensions; space {sp.id!r} has {sp.dims}")
        ids: list[str] = []
        blobs: list[bytes] = []
        for vid, data in self._vector_rows(sp.id, target):
            ids.append(vid)
            blobs.append(data)
        s = scores(q, blobs, sp.dtype, sp.normalized)
        tiebreak: dict[str, int] = {}
        if target == "fragment":
            tiebreak = self._n_map()
        elif target == "unit":
            tiebreak = {u.id: u.ord for u in self.iter_units()}
        far = 1 << 62

        def sort_key(i: int) -> tuple[float, int, str]:
            return (-s[i], tiebreak.get(ids[i], far) if tiebreak else 0, ids[i])

        order = sorted(range(len(ids)), key=sort_key)
        return [(ids[i], s[i]) for i in order[: max(0, limit)]]

    def search_vector(
        self,
        vector: Sequence[float] | Any,
        *,
        space: str | None = None,
        limit: int = 10,
        target: str = "fragment",
    ) -> list[SearchResult]:
        """Brute-force vector search (dot product if the space is normalized, else cosine).

        ``vector`` must come from the same model as the space (see ``Space.task_prefixes``).
        With ``target="unit"`` or ``"figure"`` the results point at units or figures and
        ``fragment`` is ``None``.
        """
        ranked = self._vector_ranked(vector, space, limit, target)
        if target == "fragment":
            nmap = self._n_map()
            frags = self._fragments_by_n([nmap[i] for i, _ in ranked if i in nmap])
            return [self._result(frags[nmap[i]], s, ("vector",)) for i, s in ranked if i in nmap and nmap[i] in frags]
        out: list[SearchResult] = []
        for i, s in ranked:
            obj: Unit | Figure | None
            if target == "unit":
                obj = self.unit(i)
            else:
                rows = self._rows("figures", where=f"{_q(self._col('figures', 'id'))} = ?", params=(i,))
                obj = self._make_figure(rows[0]) if rows else None
            if obj is None:
                continue
            out.append(SearchResult(i, s, ("vector",), obj.anchor, make_uri(self.docref, obj.anchor)))
        return out

    def search_hybrid(
        self,
        query: str,
        vector: Sequence[float] | Any,
        *,
        space: str | None = None,
        limit: int = 10,
    ) -> list[SearchResult]:
        """Hybrid search: lexical and vector lists (depth ``max(limit, 50)``) fused with RRF, k = 10."""
        depth = max(limit, 50)
        lex = self._lexical_ranked(query, depth)[2]
        vec = self._vector_ranked(vector, space, depth, "fragment")
        nmap = self._n_map()
        lex_ns = [n for n, _ in lex]
        vec_ns = [nmap[i] for i, _ in vec if i in nmap]
        fused = rrf([[str(n) for n in lex_ns], [str(n) for n in vec_ns]])
        lex_set, vec_set = set(lex_ns), set(vec_ns)
        order = sorted(fused.items(), key=lambda kv: (-kv[1], int(kv[0])))[: max(0, limit)]
        frags = self._fragments_by_n([int(k) for k, _ in order])
        out = []
        for k, score in order:
            n = int(k)
            if n not in frags:
                continue
            via = tuple(v for v, present in (("lexical", n in lex_set), ("vector", n in vec_set)) if present)
            out.append(self._result(frags[n], score, via))
        return out

    # -- dump and integrity -------------------------------------------------------------

    def dump(self) -> dict[str, Any]:
        """The canonical dump (contract §5): a JSON-ready dict, floats rounded to 6 decimals."""
        meta = self.meta
        if self.legacy:
            raw_version = None
            try:
                row = self.conn.execute("SELECT valor FROM spdf WHERE clave = 'spdf_version'").fetchone()
                raw_version = str(row[0]) if row else None
            except sqlite3.Error:
                pass
            version = raw_version or self.version
        else:
            version = meta.get("spdf_version", self.version)
        doc_rows = self._rows("documents", order='"id"')
        wanted = meta.get("document_id")
        doc_row = next((r for r in doc_rows if r["id"] == wanted), doc_rows[0] if doc_rows else None)

        def strip(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return [{k: v for k, v in r.items() if k != "document"} for r in rows]

        out: dict[str, Any] = {
            "spdf_version": version,
            "meta": meta,
            "fts": self.fts_info,
            "document": doc_row,
            "units": strip(self._rows("units", order=self._unit_order())),
            "sections": strip(self._rows("sections", order='"id"')),
            "fragments": strip(self._rows("fragments", order='"n"')),
            "figures": strip(self._rows("figures", order='"id"')),
            "spaces": self._rows("spaces", order='"id"'),
            "vectors": self._vector_digests(),
            "blobs": [dataclasses.asdict(b) for b in self.blobs()],
            "provenance": _sort_provenance(strip(self._rows("provenance"))),
            "extensions": [] if self.legacy else self._rows("extensions", order='"name"'),
        }
        if self.legacy:
            out["legacy"] = True
        return dict(round_floats(out))

    def _vector_digests(self) -> dict[str, Any]:
        if not self.has_table("vectors"):
            return {}
        tcol, scol = _q(self._col("vectors", "target")), _q(self._col("vectors", "space"))
        icol, dcol = _q(self._col("vectors", "id")), _q(self._col("vectors", "data"))
        table = _q(self._physical("vectors"))
        out: dict[str, Any] = {}
        current: str | None = None
        h = hashlib.sha256()
        count = 0
        for space, data in self.conn.execute(f"SELECT {scol}, {dcol} FROM {table} ORDER BY {scol}, {tcol}, {icol}"):
            if space != current:
                if current is not None:
                    out[current] = {"count": count, "sha256": h.hexdigest()}
                current, h, count = str(space), hashlib.sha256(), 0
            h.update(bytes(data) if data is not None else b"")
            count += 1
        if current is not None:
            out[current] = {"count": count, "sha256": h.hexdigest()}
        return out

    def full_dump(self) -> dict[str, Any]:
        """The dump plus vector values and blob bytes (``write_source`` rebuilds the file from it)."""
        import base64

        d = self.dump()
        spaces = {s.id: s for s in self.spaces()}
        for space_id, info in d["vectors"].items():
            sp = spaces.get(space_id)
            dtype = sp.dtype if sp else "f32"
            items = []
            tcol, scol = self._col("vectors", "target"), self._col("vectors", "space")
            icol, dcol = self._col("vectors", "id"), self._col("vectors", "data")
            sql = (
                f"SELECT {_q(tcol)}, {_q(icol)}, {_q(dcol)} FROM {_q(self._physical('vectors'))} "
                f"WHERE {_q(scol)} = ? ORDER BY {_q(tcol)}, {_q(icol)}"
            )
            for target, vid, data in self.conn.execute(sql, (space_id,)):
                raw = bytes(data)
                if dtype == "i8":
                    values: list[Any] = [b - 256 if b > 127 else b for b in raw]
                else:
                    values = decode(raw, dtype)
                t = map_target(str(target)) if self.legacy else str(target)
                items.append({"target": t, "id": str(vid), "values": values})
            info["items"] = sorted(items, key=lambda it: (it["target"], it["id"]))
        for b in d["blobs"]:
            b["data_base64"] = base64.b64encode(self.blob(b["key"]) or b"").decode("ascii")
        return d

    def dump_json(self, *, canonical: bool = True, indent: int | None = None) -> str:
        """The dump as JSON text: canonical (RFC 8785) by default, or indented for reading."""
        d = self.dump()
        if canonical and indent is None:
            return canonical_dumps(d)
        return json.dumps(d, ensure_ascii=False, indent=indent, sort_keys=True)

    def content_sha256(self) -> str:
        """Compute the content hash (contract §8) of this file."""
        return content_hash(self.dump())

    # -- interoperability shortcuts -------------------------------------------------------

    def to_csl_json(self) -> list[dict[str, Any]]:
        """CSL-JSON (a list with one item) for Zotero, citeproc or Pandoc."""
        from .bibliography import to_csl_json

        return to_csl_json(self.document)

    def to_bibtex(self) -> str:
        """A BibTeX entry for the document."""
        from .bibliography import to_bibtex

        return to_bibtex(self.document)

    def to_alto(self) -> str:
        """ALTO XML (v4) with the text of every unit."""
        from .interop.alto import to_alto

        return to_alto(self)

    def to_tei(self) -> str:
        """A minimal TEI P5 document (header from the metadata, ``pb``/``p``/``lg``/``u``/``note``)."""
        from .interop.tei import to_tei

        return to_tei(self)

    def to_iiif(self, base_url: str, **kw: Any) -> dict[str, Any]:
        """A IIIF Presentation 3 manifest with page images and text annotations."""
        from .interop.iiif import to_iiif

        return to_iiif(self, base_url, **kw)

    def to_pandas(self, *, vectors: str | None = None) -> Any:
        """Fragments as a pandas DataFrame (optionally with a vector column). Requires pandas."""
        from .interop.frames import to_pandas

        return to_pandas(self, vectors=vectors)

    def to_arrow(self, *, vectors: str | None = None) -> Any:
        """Fragments as a pyarrow Table (optionally with a fixed-size vector column). Requires pyarrow."""
        from .interop.frames import to_arrow

        return to_arrow(self, vectors=vectors)


def _sort_provenance(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Order provenance entries by the UTF-8 bytes of their JCS form (contract §5, draft 1.1)."""

    def key(r: dict[str, Any]) -> bytes:
        entry = {k: v for k, v in r.items() if k != "document"}
        return canonical_dumps(entry).encode("utf-8")

    return sorted(rows, key=key)


def content_hash(dump: Mapping[str, Any]) -> str:
    """SHA-256 of the JCS dump without the integrity keys of ``meta`` (contract §8)."""
    d = dict(dump)
    meta = {k: v for k, v in dict(d.get("meta") or {}).items() if k not in INTEGRITY_KEYS}
    d["meta"] = meta
    return hashlib.sha256(canonical_dumps(d).encode("utf-8")).hexdigest()


def _anchor_of(
    item: Fragment | Unit | Figure | Anchor | Mapping[str, Any], end: Anchor | Mapping[str, Any] | None
) -> tuple[Anchor | Mapping[str, Any], Anchor | Mapping[str, Any] | None]:
    if isinstance(item, Fragment):
        return item.anchor, end if end is not None else item.anchor_end
    if isinstance(item, (Unit, Figure)):
        return item.anchor, end
    return item, end


def read_path_bytes(path: str | os.PathLike[str]) -> bytes:
    """Read a file fully (helper for the CLI)."""
    return Path(path).read_bytes()
