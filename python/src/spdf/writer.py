"""Writing SPDF 5.0 files: :class:`Writer` and :func:`convert_legacy`.

The writer builds the database in a temporary file next to the destination, keeps
the FTS index in sync with a ``rebuild`` (no triggers), computes ``content_sha256``,
optionally signs it, compacts with ``VACUUM``, validates the result and only then
moves it into place. Usage::

    with spdf.Writer("out.spdf") as w:
        w.add_document({"id": "quijote", "kind": "pdf", "metadata": {...},
                        "source_sha256": "…", "mime": "application/pdf", "bytes": 123})
        w.add_unit({"id": "u1", "ord": 1, "anchor": {"type": "page", "physical": 1,
                    "printed": "1"}, "text": "…", "reader": "pdf-text-layer"})
        w.add_fragment({"id": "f1", "unit": "u1", "ord": 1, "text": "…",
                        "anchor": {"type": "page", "physical": 1, "printed": "1"}})
"""

from __future__ import annotations

import base64
import contextlib
import dataclasses
import hashlib
import json
import os
import secrets
import sqlite3
import struct
import unicodedata
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import _sqlite
from ._version import __version__
from .anchors import Anchor
from .container import open_container
from .errors import WriterError
from .integrity import sign_hash
from .reader import SpdfFile, open_spdf
from .reader import content_hash as _content_hash
from .schema import APPLICATION_ID, DTYPE_SIZES, SCHEMA_50, TRIGRAM_DDL, USER_VERSION_50
from .vectors import encode

__all__ = ["Writer", "convert_legacy", "copy_into", "now_iso", "write_source"]

GENERATOR = f"spdf-format/{__version__}"


def now_iso() -> str:
    """Current UTC time as ISO 8601 with ``Z`` (millisecond precision)."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _nfc(value: Any) -> Any:
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, list):
        return [_nfc(v) for v in value]
    if isinstance(value, dict):
        return {k: _nfc(v) for k, v in value.items()}
    return value


def _as_mapping(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, Anchor):
        return obj.to_dict()
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        out: dict[str, Any] = {}
        for f in dataclasses.fields(obj):
            v = getattr(obj, f.name)
            out[f.name] = v.to_dict() if isinstance(v, Anchor) else v
        return out
    if isinstance(obj, Mapping):
        return dict(obj)
    raise TypeError(f"expected a mapping or a dataclass, got {type(obj).__name__}")


def _json(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, Anchor):
        value = value.to_dict()
    if isinstance(value, str):
        # Already JSON text: validate and keep as is.
        json.loads(value)
        return value
    if isinstance(value, tuple):
        value = list(value)
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _detail_json(detail: Any) -> str | None:
    if detail is None:
        return None
    if isinstance(detail, str):
        try:
            json.loads(detail)
            return detail
        except ValueError:
            return json.dumps(detail, ensure_ascii=False)
    return _json(detail)


def _need(d: Mapping[str, Any], what: str, *keys: str) -> None:
    missing = [k for k in keys if d.get(k) is None]
    if missing:
        raise WriterError(f"{what} lacks required field(s): {', '.join(missing)}")


def _year_of(metadata: Mapping[str, Any]) -> int | None:
    issued = metadata.get("issued")
    if isinstance(issued, Mapping):
        parts = issued.get("date-parts")
        if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
            y = parts[0][0]
            if isinstance(y, int) and not isinstance(y, bool):
                return y
            if isinstance(y, str) and y.lstrip("-").isdigit():
                return int(y)
    return None


def _authors_of(metadata: Mapping[str, Any]) -> str | None:
    people = metadata.get("author")
    if not isinstance(people, list):
        return None
    names = []
    for p in people:
        if isinstance(p, Mapping):
            n = p.get("family") or p.get("literal") or p.get("given")
            if isinstance(n, str) and n:
                names.append(n)
    return "; ".join(names) or None


class Writer:
    """Builder of SPDF 5.0 files.

    Fields are passed as dicts (or dataclasses such as :class:`spdf.Unit`) using the
    column names of the 5.0 schema; JSON columns (``anchor``, ``metadata``, ``notes``,
    ``section``, ``words``, ``rights``, ``modalities``, ``task_prefixes``, ``detail``)
    take Python objects. Text is normalized to NFC.
    """

    def __init__(
        self,
        path: str | os.PathLike[str],
        *,
        overwrite: bool = False,
        trigram: bool = False,
        page_size: int = 4096,
        defaults: bool = True,
    ) -> None:
        _sqlite.require_fts5("writing SPDF files")
        self._defaults = defaults
        self.path = Path(os.fspath(path))
        if self.path.exists() and not overwrite:
            raise FileExistsError(f"{self.path} exists (pass overwrite=True to replace it)")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._tmp = self.path.with_name(f".{self.path.name}.{secrets.token_hex(4)}.tmp")
        self.conn: sqlite3.Connection = _sqlite.driver.connect(str(self._tmp), isolation_level=None)
        self._document: dict[str, Any] | None = None
        self._meta: dict[str, str] = {}
        self._integrity_meta: dict[str, str] = {}
        self._spaces: dict[str, tuple[int, str]] = {}
        self._next_n = 1
        self._units = 0
        self._has_time = False
        self._vectors = 0
        self._done = False
        self._trigram = bool(trigram and _sqlite.HAS_TRIGRAM)
        c = self.conn
        c.execute(f"PRAGMA page_size = {int(page_size)}")
        c.execute("PRAGMA journal_mode = OFF")
        c.execute("PRAGMA synchronous = OFF")
        c.execute(f"PRAGMA application_id = {APPLICATION_ID}")
        c.execute(f"PRAGMA user_version = {USER_VERSION_50}")
        c.executescript(SCHEMA_50)
        if self._trigram:
            c.execute(TRIGRAM_DDL)
        c.execute("BEGIN")

    # -- context manager -------------------------------------------------------------

    def __enter__(self) -> Writer:
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self._done:
            return
        if exc_type is None:
            self.finalize()
        else:
            self.abort()

    def abort(self) -> None:
        """Discard everything written so far."""
        if self._done:
            return
        self._done = True
        with contextlib.suppress(Exception):
            self.conn.close()
        with contextlib.suppress(OSError):
            self._tmp.unlink()

    def _check_open(self) -> None:
        if self._done:
            raise WriterError("the writer is already finalized or aborted")

    def _doc_id(self, d: Mapping[str, Any]) -> str:
        doc = d.get("document")
        if doc:
            return str(doc)
        return str(self._document["id"]) if self._document else ""

    # -- metadata --------------------------------------------------------------------------

    def set_meta(self, key: str | None = None, value: str | None = None, **pairs: str) -> None:
        """Set ``spdf_meta`` keys: ``set_meta("license_note", "…")`` or ``set_meta(profile="core")``."""
        self._check_open()
        if key is not None:
            if value is None:
                raise WriterError("set_meta(key, value) needs a value")
            pairs = {key: value, **pairs}
        for k, v in pairs.items():
            if k in ("content_sha256", "signature", "signer"):
                raise WriterError(f"{k!r} is computed by finalize()")
            self._meta[str(k)] = str(v)

    def add_document(self, document: Mapping[str, Any] | Any) -> None:
        """Set the document (one per file). ``unit_count`` defaults to the number of units."""
        self._check_open()
        if self._document is not None:
            raise WriterError("a SPDF file holds exactly one document")
        d = _as_mapping(document)
        _need(d, "document", "id", "kind", "metadata", "source_sha256", "mime", "bytes")
        meta = d["metadata"]
        if not isinstance(meta, Mapping):
            raise WriterError("document metadata must be a CSL-JSON object")
        if not isinstance(meta.get("type"), str) or not isinstance(meta.get("title"), str):
            raise WriterError("document metadata needs string 'type' and 'title' (CSL-JSON)")
        self._document = _nfc(d)

    def add_unit(self, unit: Mapping[str, Any] | Any) -> None:
        """Add a citable unit (page, time span, slide…)."""
        self._check_open()
        u = _nfc(_as_mapping(unit))
        _need(u, "unit", "id", "ord", "anchor", "reader")
        anchor = _as_mapping(u["anchor"])
        printed = u.get("printed", anchor.get("printed") if isinstance(anchor.get("printed"), str) else None)
        t0 = u.get("t0", anchor.get("t0") if anchor.get("type") == "time" else None)
        t1 = u.get("t1", anchor.get("t1") if anchor.get("type") == "time" else None)
        if anchor.get("type") == "time":
            self._has_time = True
        self.conn.execute(
            "INSERT INTO units (id, document, ord, anchor, text, notes, header, footer, image, thumbnail, "
            "reader, confidence, printed, t0, t1, words) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                u["id"],
                self._doc_id(u),
                int(u["ord"]),
                _json(anchor),
                u.get("text") or "",
                _json(u.get("notes")),
                u.get("header"),
                u.get("footer"),
                u.get("image"),
                u.get("thumbnail"),
                u["reader"],
                float(u.get("confidence", 1.0) if u.get("confidence") is not None else 1.0),
                printed,
                t0,
                t1,
                _json(u.get("words")),
            ),
        )
        self._units += 1

    def add_section(self, section: Mapping[str, Any] | Any) -> None:
        """Add a table-of-contents entry."""
        self._check_open()
        s = _nfc(_as_mapping(section))
        _need(s, "section", "id", "level", "title", "unit_from")
        self.conn.execute(
            "INSERT INTO sections (id, document, parent, level, title, unit_from, unit_to, summary) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                s["id"],
                self._doc_id(s),
                s.get("parent"),
                int(s["level"]),
                s["title"],
                s["unit_from"],
                s.get("unit_to"),
                s.get("summary"),
            ),
        )

    def add_fragment(self, fragment: Mapping[str, Any] | Any) -> int:
        """Add a fragment; returns its ``n`` (assigned sequentially when not given)."""
        self._check_open()
        f = _nfc(_as_mapping(fragment))
        _need(f, "fragment", "id", "unit", "ord", "text", "anchor")
        n = int(f["n"]) if f.get("n") is not None else self._next_n
        self._next_n = max(self._next_n, n + 1)
        section = f.get("section")
        self.conn.execute(
            "INSERT INTO fragments (n, id, document, unit, ord, text, context, section, anchor, anchor_end, "
            "search_text) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                n,
                f["id"],
                self._doc_id(f),
                f["unit"],
                int(f["ord"]),
                f["text"],
                f.get("context") or "",
                _json(list(section) if isinstance(section, (list, tuple)) else section),
                _json(_as_mapping(f["anchor"])),
                _json(_as_mapping(f["anchor_end"])) if f.get("anchor_end") is not None else None,
                f.get("search_text"),
            ),
        )
        return n

    def add_figure(self, figure: Mapping[str, Any] | Any) -> None:
        """Add a figure."""
        self._check_open()
        g = _nfc(_as_mapping(figure))
        _need(g, "figure", "id", "unit", "image", "anchor")
        self.conn.execute(
            "INSERT INTO figures (id, document, unit, image, caption, description, anchor) VALUES (?,?,?,?,?,?,?)",
            (
                g["id"],
                self._doc_id(g),
                g["unit"],
                g["image"],
                g.get("caption"),
                g.get("description"),
                _json(_as_mapping(g["anchor"])),
            ),
        )

    def add_space(self, space: Mapping[str, Any] | Any) -> None:
        """Declare a vector space (before adding its vectors)."""
        self._check_open()
        s = _as_mapping(space)
        _need(s, "space", "id", "provider", "model", "dims")
        dtype = str(s.get("dtype") or "f32")
        if dtype not in DTYPE_SIZES:
            raise WriterError(f"unknown dtype {dtype!r} (f32, f16 or i8)")
        normalized = s.get("normalized", True)
        self.conn.execute(
            "INSERT INTO spaces (id, provider, model, version, dims, dtype, normalized, truncated_from, "
            "modalities, task_prefixes, created) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                s["id"],
                s["provider"],
                s["model"],
                s.get("version"),
                int(s["dims"]),
                dtype,
                1 if normalized else 0,
                s.get("truncated_from"),
                _json(list(s["modalities"]) if "modalities" in s else ["text"]),
                _json(s.get("task_prefixes")),
                s["created"] if "created" in s else now_iso(),
            ),
        )
        self._spaces[str(s["id"])] = (int(s["dims"]), dtype)

    def add_vector(
        self,
        target: str,
        id: str,
        space: str,
        document: str | None = None,
        data: bytes | Sequence[float] | Any = None,
    ) -> None:
        """Add a vector. ``data`` is raw little-endian bytes, a list of floats or a numpy array.

        Floats are encoded with the dtype of the space (``i8`` quantized as ``round(v × 127)``).
        """
        self._check_open()
        if data is None:
            raise WriterError("add_vector needs data")
        if target not in ("fragment", "unit", "figure"):
            raise WriterError(f"unknown vector target {target!r}")
        if space not in self._spaces:
            raise WriterError(f"declare space {space!r} with add_space() before its vectors")
        dims, dtype = self._spaces[space]
        try:
            blob = encode(data, dtype)
        except ValueError as exc:
            raise WriterError(f"vector {target}/{id}: {exc}") from exc
        if len(blob) != dims * DTYPE_SIZES[dtype]:
            raise WriterError(f"vector {target}/{id} has {len(blob)} bytes; space {space!r} needs {dims} × {dtype}")
        doc = document or (str(self._document["id"]) if self._document else "")
        self.conn.execute(
            "INSERT INTO vectors (target, id, space, document, data) VALUES (?,?,?,?,?)",
            (target, id, space, doc, blob),
        )
        self._vectors += 1

    def add_blob(self, key: str, mime: str, data: bytes) -> str:
        """Embed a binary; returns its reference ``"blob:<key>"``."""
        self._check_open()
        b = bytes(data)
        self.conn.execute(
            "INSERT INTO blobs (key, mime, sha256, data) VALUES (?,?,?,?)",
            (key, mime, hashlib.sha256(b).hexdigest(), b),
        )
        return "blob:" + key

    def add_provenance(self, entry: Mapping[str, Any] | Any) -> None:
        """Record a processing step (``stage``, ``provider``, ``model``, ``detail``, ``ms``, ``at``)."""
        self._check_open()
        p = _as_mapping(entry)
        _need(p, "provenance", "stage")
        detail = p.get("detail")
        self.conn.execute(
            "INSERT INTO provenance (document, stage, provider, model, detail, ms, at) VALUES (?,?,?,?,?,?,?)",
            (
                self._doc_id(p),
                p["stage"],
                p.get("provider"),
                p.get("model"),
                _detail_json(detail),
                int(p["ms"]) if p.get("ms") is not None else None,
                p.get("at") or now_iso(),
            ),
        )

    def add_extension(self, name: str, version: str, required: bool = False) -> None:
        """Declare an extension (its tables must be named ``x_<vendor>_<name>``)."""
        self._check_open()
        self.conn.execute(
            "INSERT INTO extensions (name, version, required) VALUES (?,?,?)",
            (name, version, 1 if required else 0),
        )

    def execute(self, sql: str, params: Sequence[Any] = ()) -> None:
        """Run raw SQL inside the file being written (for ``x_<vendor>_<name>`` extension tables)."""
        self._check_open()
        self.conn.execute(sql, tuple(params))

    # -- finalize -----------------------------------------------------------------------

    def finalize(
        self,
        *,
        content_hash: bool = True,
        sign_key: bytes | None = None,
        validate: bool = True,
    ) -> Path:
        """Finish the file: FTS rebuild, ``content_sha256``, optional signature, VACUUM, validation.

        ``sign_key`` is a 32-byte Ed25519 private key (see :mod:`spdf.integrity`).
        Returns the final path. On a validation error the file is discarded and
        :class:`~spdf.errors.WriterError` lists the problems.
        """
        self._check_open()
        if self._document is None:
            self.abort()
            raise WriterError("add_document() was never called")
        try:
            self._write_document()
            c = self.conn
            c.execute(
                "INSERT INTO fragments_fts(fragments_fts) VALUES ('rebuild')",
            )
            if self._trigram:
                c.execute("INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES ('rebuild')")
            final_meta = self._final_meta() if self._defaults else {**self._meta, **self._integrity_meta}
            for k, v in sorted(final_meta.items()):
                c.execute("INSERT OR REPLACE INTO spdf_meta (key, value) VALUES (?, ?)", (k, v))
            c.execute("COMMIT")
            if content_hash or sign_key is not None:
                container = open_container(self._tmp)
                try:
                    digest = _content_hash(SpdfFile(container).dump())
                finally:
                    container.close()
                rows = [("content_sha256", digest)]
                if sign_key is not None:
                    signature, signer = sign_hash(digest, sign_key)
                    rows += [("signature", signature), ("signer", signer)]
                c.executemany("INSERT OR REPLACE INTO spdf_meta (key, value) VALUES (?, ?)", rows)
            c.execute("PRAGMA journal_mode = DELETE")
            c.execute("VACUUM")
            c.close()
        except BaseException:
            self.abort()
            raise
        self._done = True
        if validate:
            from .validate import validate as _validate

            result = _validate(self._tmp)
            if not result.valid:
                with contextlib.suppress(OSError):
                    self._tmp.unlink()
                problems = "; ".join(f"{i.code} {i.message} ({i.where})" for i in result.errors[:10])
                raise WriterError(f"the written file does not validate: {problems}")
        os.replace(self._tmp, self.path)
        return self.path

    def _write_document(self) -> None:
        assert self._document is not None
        d = self._document
        meta = d["metadata"]
        now = now_iso()
        unit_count = d.get("unit_count")
        if unit_count is None:
            unit_count = self._units
        title = d.get("title", meta.get("title"))
        language = d.get("language", meta.get("language"))
        self.conn.execute(
            "INSERT INTO documents (id, kind, metadata, source_sha256, source_ref, mime, bytes, unit_count, "
            "duration, created, updated, title, authors, year, language, rights) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                d["id"],
                d["kind"],
                _json(meta),
                str(d["source_sha256"]).lower(),
                d.get("source_ref"),
                d["mime"],
                int(d["bytes"]),
                int(unit_count),
                d.get("duration"),
                d.get("created") or now,
                d.get("updated") or d.get("created") or now,
                title,
                d.get("authors", _authors_of(meta)),
                d.get("year", _year_of(meta)),
                language,
                _json(d.get("rights")),
            ),
        )
        doc_id = str(d["id"])
        for table in ("units", "sections", "fragments", "figures", "vectors", "provenance"):
            self.conn.execute(f"UPDATE {table} SET document = ? WHERE document = ''", (doc_id,))

    def _final_meta(self) -> dict[str, str]:
        assert self._document is not None
        meta = dict(self._meta)
        meta["spdf_version"] = "5.0"
        meta.setdefault("created", now_iso())
        meta.setdefault("generator", GENERATOR)
        meta["document_id"] = str(self._document["id"])
        if "profile" not in meta:
            profile = ["core"]
            if self._vectors:
                profile.append("semantic")
            if self._has_time:
                profile.append("media")
            meta["profile"] = " ".join(profile)
        return meta


def _pack_values(values: Sequence[Any], dtype: str) -> bytes:
    """Pack vector values of a full dump: floats for f32/f16, raw integers (q) for i8."""
    if dtype == "i8":
        ints = [int(v) for v in values]
        if any(not -127 <= v <= 127 for v in ints):
            raise WriterError("i8 vector values in a full dump are integers in [-127, 127]")
        return struct.pack(f"<{len(ints)}b", *ints)
    fmt = {"f32": "f", "f16": "e"}.get(dtype)
    if fmt is None:
        raise WriterError(f"unknown dtype {dtype!r}")
    return struct.pack(f"<{len(values)}{fmt}", *(float(v) for v in values))


def write_source(
    source: Mapping[str, Any],
    destination: str | os.PathLike[str],
    *,
    overwrite: bool = True,
    validate: bool = True,
) -> Path:
    """Write a SPDF 5.0 file from a *full dump*: the canonical dump plus vector values
    (``vectors.<space>.items = [{"target", "id", "values"}]``, ``i8`` as raw integers) and
    blob bytes (``blobs[].data_base64``). Everything is written verbatim, including
    ``meta`` (integrity keys too), so dumping the result gives the source back without
    the values and bytes. This is the format of ``conformance/sources``.
    """
    doc = dict(source["document"])
    fts = source.get("fts") or {}
    w = Writer(destination, overwrite=overwrite, trigram=bool(fts.get("trigram")), defaults=False)
    try:
        for k, v in (source.get("meta") or {}).items():
            if k in ("content_sha256", "signature", "signer"):
                w._integrity_meta[str(k)] = str(v)
            else:
                w._meta[str(k)] = str(v)
        w.add_document(doc)
        for u in source.get("units") or []:
            w.add_unit(u)
        for x in source.get("sections") or []:
            w.add_section(x)
        for f in source.get("fragments") or []:
            w.add_fragment(f)
        for g in source.get("figures") or []:
            w.add_figure(g)
        dtypes: dict[str, str] = {}
        for sp in source.get("spaces") or []:
            w.add_space(sp)
            dtypes[str(sp["id"])] = str(sp.get("dtype") or "f32")
        for space, v in (source.get("vectors") or {}).items():
            dtype = dtypes.get(space, "f32")
            for it in sorted(v.get("items") or [], key=lambda it: (it["target"], it["id"])):
                w.add_vector(it["target"], it["id"], space, doc["id"], _pack_values(it["values"], dtype))
        for b in source.get("blobs") or []:
            w.add_blob(b["key"], b["mime"], base64.b64decode(b.get("data_base64") or ""))
        for p in source.get("provenance") or []:
            w.add_provenance(p)
        for e in source.get("extensions") or []:
            w.add_extension(e["name"], e["version"], bool(e.get("required")))
        return w.finalize(content_hash=False, validate=validate)
    except BaseException:
        w.abort()
        raise


def convert_legacy(
    source: str | os.PathLike[str] | bytes,
    destination: str | os.PathLike[str],
    *,
    overwrite: bool = False,
    sign_key: bytes | None = None,
) -> Path:
    """Convert a legacy SPDF 4.0/4.1 file (gzip or not) into a valid SPDF 5.0 file.

    Everything goes through the 5.0 view (CSL metadata, mapped anchors, 1-based unit
    order, ``blob:`` references); a ``convert`` provenance entry records the origin.
    A 5.x input is copied through the writer as well (re-normalized and re-hashed).
    """
    with open_spdf(source) as src:
        return copy_into(src, destination, overwrite=overwrite, sign_key=sign_key)


def copy_into(
    src: SpdfFile,
    destination: str | os.PathLike[str],
    *,
    overwrite: bool = False,
    sign_key: bytes | None = None,
) -> Path:
    """Write the content of an open file into a new 5.0 file."""
    doc_row = src.dump()["document"]
    meta = src.meta
    w = Writer(destination, overwrite=overwrite, trigram=src.fts_info.get("trigram", False))
    try:
        skip = {"spdf_version", "content_sha256", "signature", "signer", "document_id", "generator"}
        if src.legacy:
            skip.add("profile")
        for k, v in meta.items():
            if k not in skip:
                w.set_meta(k, v)
        doc = dict(doc_row)
        w.add_document(doc)
        for r in src._iter("units", order=src._unit_order()):
            w.add_unit(r)
        for r in src._iter("sections", order='"id"'):
            w.add_section(r)
        for r in src._iter("fragments", order='"n"'):
            w.add_fragment(r)
        for r in src._iter("figures", order='"id"'):
            w.add_figure(r)
        for r in src._iter("spaces", order='"id"'):
            w.add_space(r)
        if src.has_table("vectors"):
            for r in src._iter("vectors", order='"space", "target", "id"'):
                w.add_vector(r["target"], r["id"], r["space"], r.get("document"), bytes(r["data"]))
        if src.has_table("blobs"):
            for info in src.blobs():
                data = src.blob(info.key)
                w.add_blob(info.key, info.mime, data or b"")
        for p in src.provenance():
            w.add_provenance(dataclasses.asdict(p))
        if src.legacy:
            w.add_provenance(
                {
                    "stage": "convert",
                    "provider": GENERATOR,
                    "detail": {"from": src.version, "generator": meta.get("generator")},
                }
            )
        else:
            for ext in src.extensions():
                w.add_extension(ext.name, ext.version, ext.required)
        return w.finalize(sign_key=sign_key)
    except BaseException:
        w.abort()
        raise
