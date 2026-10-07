-- A synthetic SPDF 5.0 file for the spdf.lua tests: one document whose units
-- carry the anchor types the shared fixtures lack (verse, slide, sheet,
-- canonical). The texts are in the public domain (Garcilaso de la Vega,
-- Égloga I, 1543; Plato, Republic VII, tr. Jowett, 1871); the layout and the
-- source hash are made up, as the CSL note says. test/run.sh builds it with
--   sqlite3 test/build/mixed.spdf < test/fixtures/mixed.sql
-- Dedicated to the public domain (CC0 1.0).

PRAGMA application_id = 1397769286;
PRAGMA user_version = 500;
PRAGMA page_size = 4096;

CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE documents (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, metadata TEXT NOT NULL,
  source_sha256 TEXT NOT NULL, source_ref TEXT, mime TEXT NOT NULL,
  bytes INTEGER NOT NULL, unit_count INTEGER NOT NULL, duration REAL,
  created TEXT NOT NULL, updated TEXT NOT NULL,
  title TEXT, authors TEXT, year INTEGER, language TEXT, rights TEXT);

CREATE TABLE units (
  id TEXT PRIMARY KEY, document TEXT NOT NULL REFERENCES documents(id),
  ord INTEGER NOT NULL, anchor TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
  notes TEXT, header TEXT, footer TEXT, image TEXT, thumbnail TEXT,
  reader TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, printed TEXT,
  t0 REAL, t1 REAL, words TEXT);
CREATE INDEX units_doc ON units(document, ord);
CREATE INDEX units_printed ON units(document, printed);

CREATE TABLE sections (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL,
  title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT);

CREATE TABLE fragments (
  n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT NOT NULL,
  unit TEXT NOT NULL, ord INTEGER NOT NULL, text TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '', section TEXT, anchor TEXT NOT NULL,
  anchor_end TEXT, search_text TEXT);
CREATE INDEX fragments_doc ON fragments(document, ord);
CREATE INDEX fragments_unit ON fragments(unit);

CREATE VIRTUAL TABLE fragments_fts USING fts5(
  text, context, section, search_text,
  content='fragments', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2');

CREATE TABLE figures (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL,
  image TEXT NOT NULL, caption TEXT, description TEXT, anchor TEXT NOT NULL);

CREATE TABLE spaces (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, version TEXT,
  dims INTEGER NOT NULL, dtype TEXT NOT NULL DEFAULT 'f32',
  normalized INTEGER NOT NULL DEFAULT 1, truncated_from INTEGER,
  modalities TEXT NOT NULL, task_prefixes TEXT, created TEXT);

CREATE TABLE vectors (
  target TEXT NOT NULL, id TEXT NOT NULL, space TEXT NOT NULL REFERENCES spaces(id),
  document TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (target, id, space));

CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL,
  data BLOB NOT NULL);

CREATE TABLE provenance (
  document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT,
  detail TEXT, ms INTEGER, at TEXT NOT NULL);

CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0);

INSERT INTO spdf_meta VALUES
  ('spdf_version', '5.0'),
  ('profile', 'core'),
  ('created', '2026-10-07T00:00:00Z'),
  ('generator', 'spdf-lua-tests/1.0'),
  ('document_id', 'mixed-anchors');

INSERT INTO documents VALUES (
  'mixed-anchors', 'document',
  '{"type":"book","title":"Anchors of every kind","author":[{"family":"Garcilaso de la Vega"},{"family":"Plato"}],"issued":{"date-parts":[[1871]]},"language":"en","note":"Synthetic test fixture for spdf.lua: layout and source hash are made up."}',
  'b74f52c7fbbf58aac689f9b78a79891bbf6b7b316a278bd16f857e21921fb214',
  NULL, 'text/plain', 1024, 6, NULL,
  '2026-10-07T00:00:00Z', '2026-10-07T00:00:00Z',
  'Anchors of every kind', 'Garcilaso de la Vega; Plato', 1871, 'en', NULL);

INSERT INTO units (id, document, ord, anchor, text, reader, printed) VALUES
  ('v1', 'mixed-anchors', 1, '{"type":"verse","line_from":1,"line_to":3,"printed":"16"}',
   'El dulce lamentar de dos pastores,' || char(10) || 'Salicio juntamente y Nemoroso,' || char(10) || 'he de contar, sus quejas imitando;',
   'human', '16'),
  ('v2', 'mixed-anchors', 2, '{"type":"verse","line_from":4,"line_to":6,"printed":"17"}',
   'cuyas ovejas al cantar sabroso' || char(10) || 'estaban muy atentas, los amores,' || char(10) || 'de pacer olvidadas, escuchando.',
   'human', '17'),
  ('s1', 'mixed-anchors', 3, '{"type":"slide","n":1}', '# Anchors', 'human', NULL),
  ('s2', 'mixed-anchors', 4, '{"type":"slide","n":2}', '# Citations', 'human', NULL),
  ('h1', 'mixed-anchors', 5, '{"type":"sheet","sheet":"Data","row_from":1,"row_to":12}', 'year | verses', 'human', NULL),
  ('c1', 'mixed-anchors', 6, '{"type":"canonical","scheme":"stephanus","ref":"514a"}',
   'And now, I said, let me show in a figure how far our nature is enlightened or unenlightened.',
   'human', NULL);
