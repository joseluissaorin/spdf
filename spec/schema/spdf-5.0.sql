-- SPDF 5.0 schema (normative). Specification: spec/SPEC.md, section 6.
-- License: CC BY 4.0.
--
-- A SPDF 5.0 file is an uncompressed SQLite 3 database holding exactly one document.
-- Distributed files MUST NOT contain triggers or views: writers keep the FTS5 index
-- in sync themselves, e.g. with
--   INSERT INTO fragments_fts(fragments_fts) VALUES('rebuild');
-- before VACUUM. Extension tables MUST be named x_<vendor>_<name>.

PRAGMA application_id = 1397769286;  -- 0x53504446, "SPDF"
PRAGMA user_version = 500;           -- major * 100 + minor * 10

CREATE TABLE spdf_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

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
  id        TEXT PRIMARY KEY,
  document  TEXT NOT NULL,
  parent    TEXT,
  level     INTEGER NOT NULL,
  title     TEXT NOT NULL,
  unit_from TEXT NOT NULL,
  unit_to   TEXT,
  summary   TEXT
);

CREATE TABLE fragments (
  n           INTEGER PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE,
  document    TEXT NOT NULL,
  unit        TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  text        TEXT NOT NULL,
  context     TEXT NOT NULL DEFAULT '',
  section     TEXT,
  anchor      TEXT NOT NULL,
  anchor_end  TEXT,
  search_text TEXT
);
CREATE INDEX fragments_doc ON fragments(document, ord);
CREATE INDEX fragments_unit ON fragments(unit);

CREATE VIRTUAL TABLE fragments_fts USING fts5(
  text, context, section, search_text,
  content='fragments', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2'
);

-- OPTIONAL, for Chinese, Japanese and Korean text:
-- CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(
--   text, content='fragments', content_rowid='n', tokenize='trigram'
-- );

CREATE TABLE figures (
  id          TEXT PRIMARY KEY,
  document    TEXT NOT NULL,
  unit        TEXT NOT NULL,
  image       TEXT NOT NULL,
  caption     TEXT,
  description TEXT,
  anchor      TEXT NOT NULL
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

CREATE TABLE blobs (
  key    TEXT PRIMARY KEY,
  mime   TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  data   BLOB NOT NULL
);

CREATE TABLE provenance (
  document TEXT NOT NULL,
  stage    TEXT NOT NULL,
  provider TEXT,
  model    TEXT,
  detail   TEXT,
  ms       INTEGER,
  at       TEXT NOT NULL
);

CREATE TABLE extensions (
  name     TEXT PRIMARY KEY,
  version  TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0
);
