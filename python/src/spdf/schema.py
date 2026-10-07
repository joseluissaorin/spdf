"""The SPDF 5.0 schema and the legacy 4.x name mapping (contract §2 and §7)."""

from __future__ import annotations

from typing import Final

__all__ = [
    "APPLICATION_ID",
    "JSON_COLUMNS",
    "LEGACY_COLUMNS",
    "LEGACY_TABLES",
    "LEGACY_TRIGGERS",
    "REQUIRED_META_KEYS",
    "SCHEMA_50",
    "TABLES_50",
    "USER_VERSION_50",
]

APPLICATION_ID: Final = 1397769286  # 0x53504446, "SPDF"
USER_VERSION_50: Final = 500
SPDF_VERSION: Final = "5.0"

REQUIRED_META_KEYS: Final = ("spdf_version", "profile", "created", "generator", "document_id")
PROFILES: Final = ("core", "semantic", "media", "full")

ANCHOR_TYPES: Final = frozenset(
    {"page", "time", "section", "slide", "sheet", "web", "image", "verse", "canonical"}
)

DOCUMENT_KINDS: Final = frozenset(
    {"pdf", "scanned_pdf", "photos", "image", "audio", "video", "document", "epub", "slides", "sheet", "web"}
)

DTYPE_SIZES: Final = {"f32": 4, "f16": 2, "i8": 1}

SCHEMA_50: Final = """
CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  metadata      TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_ref    TEXT,
  mime          TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  unit_count    INTEGER NOT NULL,
  duration      REAL,
  created       TEXT NOT NULL,
  updated       TEXT NOT NULL,
  title         TEXT,
  authors       TEXT,
  year          INTEGER,
  language      TEXT,
  rights        TEXT
);

CREATE TABLE units (
  id          TEXT PRIMARY KEY,
  document    TEXT NOT NULL REFERENCES documents(id),
  ord         INTEGER NOT NULL,
  anchor      TEXT NOT NULL,
  text        TEXT NOT NULL DEFAULT '',
  notes       TEXT,
  header      TEXT,
  footer      TEXT,
  image       TEXT,
  thumbnail   TEXT,
  reader      TEXT NOT NULL,
  confidence  REAL NOT NULL DEFAULT 1,
  printed     TEXT,
  t0          REAL,
  t1          REAL,
  words       TEXT
);
CREATE INDEX units_doc ON units(document, ord);
CREATE INDEX units_printed ON units(document, printed);

CREATE TABLE sections (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL,
  title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT
);

CREATE TABLE fragments (
  n          INTEGER PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  document   TEXT NOT NULL,
  unit       TEXT NOT NULL,
  ord        INTEGER NOT NULL,
  text       TEXT NOT NULL,
  context    TEXT NOT NULL DEFAULT '',
  section    TEXT,
  anchor     TEXT NOT NULL,
  anchor_end TEXT,
  search_text TEXT
);
CREATE INDEX fragments_doc ON fragments(document, ord);
CREATE INDEX fragments_unit ON fragments(unit);

CREATE VIRTUAL TABLE fragments_fts USING fts5(
  text, context, section, search_text,
  content='fragments', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE figures (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL,
  image TEXT NOT NULL,
  caption TEXT, description TEXT,
  anchor TEXT NOT NULL
);

CREATE TABLE spaces (
  id             TEXT PRIMARY KEY,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  version        TEXT,
  dims           INTEGER NOT NULL,
  dtype          TEXT NOT NULL DEFAULT 'f32',
  normalized     INTEGER NOT NULL DEFAULT 1,
  truncated_from INTEGER,
  modalities     TEXT NOT NULL,
  task_prefixes  TEXT,
  created        TEXT
);

CREATE TABLE vectors (
  target   TEXT NOT NULL,
  id       TEXT NOT NULL,
  space    TEXT NOT NULL REFERENCES spaces(id),
  document TEXT NOT NULL,
  data     BLOB NOT NULL,
  PRIMARY KEY (target, id, space)
);

CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL);

CREATE TABLE provenance (
  document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT,
  detail TEXT, ms INTEGER, at TEXT NOT NULL
);

CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
"""

TRIGRAM_DDL: Final = (
    "CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(text, content='fragments', "
    "content_rowid='n', tokenize='trigram')"
)

# Column lists of every 5.0 table, in DDL order (used by the validator and the legacy view).
TABLES_50: Final[dict[str, tuple[str, ...]]] = {
    "spdf_meta": ("key", "value"),
    "documents": (
        "id", "kind", "metadata", "source_sha256", "source_ref", "mime", "bytes", "unit_count",
        "duration", "created", "updated", "title", "authors", "year", "language", "rights",
    ),
    "units": (
        "id", "document", "ord", "anchor", "text", "notes", "header", "footer", "image", "thumbnail",
        "reader", "confidence", "printed", "t0", "t1", "words",
    ),
    "sections": ("id", "document", "parent", "level", "title", "unit_from", "unit_to", "summary"),
    "fragments": (
        "n", "id", "document", "unit", "ord", "text", "context", "section", "anchor", "anchor_end",
        "search_text",
    ),
    "fragments_fts": ("text", "context", "section", "search_text"),
    "figures": ("id", "document", "unit", "image", "caption", "description", "anchor"),
    "spaces": (
        "id", "provider", "model", "version", "dims", "dtype", "normalized", "truncated_from",
        "modalities", "task_prefixes", "created",
    ),
    "vectors": ("target", "id", "space", "document", "data"),
    "blobs": ("key", "mime", "sha256", "data"),
    "provenance": ("document", "stage", "provider", "model", "detail", "ms", "at"),
    "extensions": ("name", "version", "required"),
}

# Columns that hold JSON text and are parsed in the dump and the API.
JSON_COLUMNS: Final[dict[str, frozenset[str]]] = {
    "documents": frozenset({"metadata", "rights"}),
    "units": frozenset({"anchor", "notes", "words"}),
    "fragments": frozenset({"section", "anchor", "anchor_end"}),
    "figures": frozenset({"anchor"}),
    "spaces": frozenset({"modalities", "task_prefixes"}),
}

# --- Legacy 4.0 / 4.1 ------------------------------------------------------

LEGACY_TABLES: Final[dict[str, str]] = {
    "spdf_meta": "spdf",
    "documents": "documentos",
    "units": "unidades",
    "sections": "secciones",
    "fragments": "fragmentos",
    "fragments_fts": "fragmentos_fts",
    "figures": "figuras",
    "spaces": "espacios",
    "vectors": "vectores",
    "blobs": "blobs",
    "provenance": "procedencia",
}

# 5.0 column -> legacy column, per 5.0 table. Columns absent here have no legacy
# counterpart and read as NULL (or the documented default).
LEGACY_COLUMNS: Final[dict[str, dict[str, str]]] = {
    "spdf_meta": {"key": "clave", "value": "valor"},
    "documents": {
        "id": "id", "kind": "tipo", "metadata": "metadatos", "source_sha256": "huella",
        "source_ref": "original", "mime": "mime", "bytes": "bytes", "unit_count": "unidades",
        "duration": "duracion", "created": "creado", "updated": "actualizado", "title": "titulo",
        "authors": "autores", "year": "anio", "language": "idioma",
    },
    "units": {
        "id": "id", "document": "documento", "ord": "orden", "anchor": "ancla", "text": "texto",
        "notes": "notas", "header": "cabecera", "footer": "pie", "image": "imagen",
        "thumbnail": "miniatura", "reader": "lector", "confidence": "confianza", "printed": "impresa",
        "t0": "t0", "t1": "t1", "words": "palabras",
    },
    "sections": {
        "id": "id", "document": "documento", "parent": "padre", "level": "nivel", "title": "titulo",
        "unit_from": "unidad_desde", "unit_to": "unidad_hasta", "summary": "resumen",
    },
    "fragments": {
        "n": "n", "id": "id", "document": "documento", "unit": "unidad", "ord": "orden", "text": "texto",
        "context": "contexto", "section": "seccion", "anchor": "ancla", "anchor_end": "ancla_fin",
        "search_text": "texto_busqueda",
    },
    "fragments_fts": {
        "text": "texto", "context": "contexto", "section": "seccion", "search_text": "texto_busqueda",
    },
    "figures": {
        "id": "id", "document": "documento", "unit": "unidad", "image": "imagen", "caption": "pie",
        "description": "descripcion", "anchor": "ancla",
    },
    "spaces": {
        "id": "id", "provider": "proveedor", "model": "modelo", "version": "version", "dims": "dims",
        "normalized": "normalizado", "modalities": "modalidades", "created": "creado",
    },
    "vectors": {"target": "objetivo", "id": "id", "space": "espacio", "document": "documento", "data": "valores"},
    "blobs": {"key": "clave", "mime": "mime", "data": "datos"},
    "provenance": {
        "document": "documento", "stage": "fase", "provider": "proveedor", "model": "modelo",
        "detail": "detalle", "ms": "ms", "at": "cuando",
    },
}

# Required legacy tables (a file without them is not a 4.x SPDF).
LEGACY_REQUIRED: Final = ("spdf", "documentos", "unidades", "fragmentos")

# The only triggers a reader tolerates, and only in legacy files.
LEGACY_TRIGGERS: Final = frozenset({"fragmentos_ai", "fragmentos_ad", "fragmentos_au"})

LEGACY_KINDS: Final[dict[str, str]] = {
    "pdf": "pdf",
    "pdf_escaneado": "scanned_pdf",
    "fotos": "photos",
    "imagen": "image",
    "audio": "audio",
    "video": "video",
    "documento": "document",
    "epub": "epub",
    "presentacion": "slides",
    "hoja": "sheet",
    "web": "web",
}

LEGACY_TARGETS: Final[dict[str, str]] = {"fragmento": "fragment", "unidad": "unit", "figura": "figure"}
