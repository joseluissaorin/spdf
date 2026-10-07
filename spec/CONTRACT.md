# SPDF 5.0 implementation contract (draft 0, 2026-10-07)

This is the working contract every implementation in this repository codes against
while the normative specification (`SPEC.md`) is being written. `SPEC.md` will absorb
and supersede it; if they disagree, raise it and the spec agent decides, recording the
change here. Key words MUST, SHOULD, MAY as in RFC 2119.

## 1. Container

- A SPDF 5.0 file is a SQLite 3 database, **uncompressed**, page size 4096 recommended,
  `PRAGMA application_id = 1397769286` (0x53504446, "SPDF"), `PRAGMA user_version = 500`,
  journal mode DELETE, compacted with `VACUUM` before distribution.
- Extension `.spdf`. Media type `application/vnd.spdf` (registration pending).
- One file = one document. (Libraries/collections are separate manifests, §9.)
- Readers MUST also accept legacy 4.0/4.1 files (Spanish schema, `user_version` 400/410 or
  `spdf.spdf_version` row), which are usually **gzip-wrapped** SQLite (magic `1f 8b`):
  decompress to a temp file or memory first. Legacy 3.0 (Scholaris v1, gzip JSON) MAY be
  supported through an importer.
- Distributed 5.0 files MUST NOT contain triggers or views. Writers keep the FTS index
  in sync themselves (or `INSERT INTO fragments_fts(fragments_fts) VALUES('rebuild')`
  before finalizing). Legacy 4.x files contain the three FTS sync triggers
  (`fragmentos_ai/ad/au`); readers tolerate exactly those.

### Safe opening (all readers)
Open read-only (`SQLITE_OPEN_READONLY` / `mode=ro`), `PRAGMA query_only=1`,
`PRAGMA trusted_schema=OFF`, enable `SQLITE_DBCONFIG_DEFENSIVE` where the binding allows,
never load extensions, reject files whose `sqlite_master` contains `trigger` or `view`
entries other than the tolerated legacy triggers, and enforce a configurable max blob
size (default 512 MiB).

## 2. Schema 5.0

```sql
PRAGMA application_id = 1397769286;
PRAGMA user_version = 500;

CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- REQUIRED keys: spdf_version='5.0', profile (space-separated subset of
-- 'core semantic media full'), created (ISO 8601 UTC), generator ('name/version'),
-- document_id. OPTIONAL: content_sha256 (§8), signature, license_note.

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,   -- pdf|scanned_pdf|photos|image|audio|video|document|epub|slides|sheet|web
  metadata      TEXT NOT NULL,   -- JSON: CSL-JSON item + "spdf" extension object (§4)
  source_sha256 TEXT NOT NULL,   -- hex SHA-256 of the original bytes
  source_ref    TEXT,            -- blob key ('blob:<key>'), URL, or NULL if not shipped
  mime          TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  unit_count    INTEGER NOT NULL,
  duration      REAL,            -- seconds (audio/video)
  created       TEXT NOT NULL,
  updated       TEXT NOT NULL,
  -- denormalized, for filtering without parsing JSON:
  title         TEXT,
  authors       TEXT,            -- 'Family; Family'
  year          INTEGER,
  language      TEXT,            -- BCP 47
  rights        TEXT             -- JSON {license (SPDX id or URL), access, holder, note}
);

CREATE TABLE units (            -- citable units: pages, time spans, slides, sections, sheets
  id          TEXT PRIMARY KEY,
  document    TEXT NOT NULL REFERENCES documents(id),
  ord         INTEGER NOT NULL, -- 1-based, contiguous
  anchor      TEXT NOT NULL,    -- JSON anchor (§3)
  text        TEXT NOT NULL DEFAULT '',  -- NFC, light Markdown
  notes       TEXT,             -- JSON string[] (footnotes)
  header      TEXT,
  footer      TEXT,
  image       TEXT,             -- 'blob:<key>' or URL (page image, frame, slide)
  thumbnail   TEXT,
  reader      TEXT NOT NULL,    -- who produced the text: 'pdf-text-layer', 'gemma-4-e4b', 'whisper-large-v3-turbo'…
  confidence  REAL NOT NULL DEFAULT 1,
  printed     TEXT,             -- printed folio, denormalized from anchor
  t0          REAL,
  t1          REAL,
  words       TEXT              -- JSON word timings {"v":1,"t0":…,"cs":[start,dur,…]} (centiseconds from t0)
);
CREATE INDEX units_doc ON units(document, ord);
CREATE INDEX units_printed ON units(document, printed);

CREATE TABLE sections (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL,
  title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT
);

CREATE TABLE fragments (        -- searchable, citable passages (~150-300 words)
  n          INTEGER PRIMARY KEY,   -- stable rowid used by FTS
  id         TEXT NOT NULL UNIQUE,
  document   TEXT NOT NULL,
  unit       TEXT NOT NULL,
  ord        INTEGER NOT NULL,
  text       TEXT NOT NULL,        -- literal text, NFC (never modernized)
  context    TEXT NOT NULL DEFAULT '',  -- one line situating the fragment in the work
  section    TEXT,                 -- JSON string[] heading path
  anchor     TEXT NOT NULL,        -- JSON anchor of the start
  anchor_end TEXT,                 -- JSON anchor if the fragment crosses units
  search_text TEXT                 -- modernized-spelling layer, search only ('' = nothing to add)
);
CREATE INDEX fragments_doc ON fragments(document, ord);
CREATE INDEX fragments_unit ON fragments(unit);

CREATE VIRTUAL TABLE fragments_fts USING fts5(
  text, context, section, search_text,
  content='fragments', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2'
);
-- OPTIONAL (CJK): CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(text,
--   content='fragments', content_rowid='n', tokenize='trigram');

CREATE TABLE figures (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL,
  image TEXT NOT NULL,            -- 'blob:<key>' (cropped) or the unit image + region in anchor
  caption TEXT, description TEXT, -- description in the document language
  anchor TEXT NOT NULL            -- JSON anchor with "region"
);

CREATE TABLE spaces (
  id             TEXT PRIMARY KEY,   -- 'embeddinggemma-2@768', 'gemini-embedding-2@1536'
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  version        TEXT,
  dims           INTEGER NOT NULL,
  dtype          TEXT NOT NULL DEFAULT 'f32',  -- f32 | f16 | i8 (i8: value/127)
  normalized     INTEGER NOT NULL DEFAULT 1,
  truncated_from INTEGER,           -- Matryoshka: original dims if truncated
  modalities     TEXT NOT NULL,     -- JSON ["text","image","audio","video"]
  task_prefixes  TEXT,              -- JSON {"query": "...", "document": "..."} used at encode time
  created        TEXT
);

CREATE TABLE vectors (
  target   TEXT NOT NULL,   -- fragment | unit | figure
  id       TEXT NOT NULL,
  space    TEXT NOT NULL REFERENCES spaces(id),
  document TEXT NOT NULL,
  data     BLOB NOT NULL,   -- little-endian, dims × sizeof(dtype)
  PRIMARY KEY (target, id, space)
);

CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL);

CREATE TABLE provenance (       -- what produced what, for audit and reproducibility
  document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT,
  detail TEXT, ms INTEGER, at TEXT NOT NULL
);

CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
-- Extension tables MUST be named x_<vendor>_<name>. A reader that meets a required
-- extension it does not know MUST refuse with error E060; optional ones are ignored.
```

## 3. Anchors (JSON in `anchor` / `anchor_end`)

```jsonc
{"type":"page","physical":10,"printed":"4","roman":false,"foliation":"page","source":"read","confidence":0.97}
//   foliation: page | leaf ("fol. 1r") | column ; source: read | inferred | epub | none
//   inferred folios are cited in brackets: "p. [21]"
{"type":"time","t0":4160.0,"t1":4175.5,"speaker":"Julio Cortázar"}
{"type":"section","path":["Chapter 3","3.2 The panopticon"],"paragraph":4,"printed":"145"}
{"type":"slide","n":3}
{"type":"sheet","sheet":"Data","row_from":4,"row_to":9}
{"type":"web","url":"https://…","path":["…"],"paragraph":2,"accessed":"2026-10-07"}
{"type":"image","region":{"x":0.1,"y":0.2,"w":0.3,"h":0.1}}
{"type":"verse","line_from":1234,"line_to":1240,"printed":"…"}        // new in 5.0
{"type":"canonical","scheme":"stephanus","ref":"514a"}                  // new: stephanus|bekker|bible|cts|…
```
Any anchor MAY add `"region":{x,y,w,h}` (fractions 0–1 of the unit image) and
`"chars":[start,end]` (code points in NFC `units.text`, end exclusive).

### Anchor URI
`spdf:<docref>#<params>` where `<docref>` is `sha256-<hex of source_sha256>` (preferred,
portable) or the document id. Params, `&`-separated, percent-encoded values:
`p=<physical>` · `f=<printed folio>` · `t=<t0>[,<t1>]` (seconds, decimal) · `s=<path joined
by '/'>` · `para=<n>` · `sl=<n>` · `sh=<sheet>` · `rows=<a>-<b>` · `v=<a>[-<b>]` ·
`ref=<scheme>:<ref>` · `c=<start>-<end>` · `xywh=<x>,<y>,<w>,<h>` (fractions) · `fe=<printed end>`.
Example: `spdf:sha256-3f2a…#p=29&f=21&c=118-301`. The spec agent writes the ABNF; parse ∘
format MUST round-trip for every conformance case.

## 4. Metadata (`documents.metadata`)
A CSL-JSON item (`type`, `title`, `author` [{family, given}], `editor`, `translator`,
`interviewer`, `issued` {"date-parts":[[1605]]}, `original-date`, `publisher`,
`publisher-place`, `container-title`, `collection-title`, `volume`, `issue`, `page`,
`edition`, `DOI`, `ISBN`, `URL`, `language`, `abstract`, …) plus:
```json
"spdf": {"provenance": {"title": {"source":"colophon","confidence":0.98}},
         "undated": {"from":1600,"to":1610,"basis":"printer active years"},
         "original_language": "fr", "orcid": {"Foucault, Michel": "0000-…"}}
```
Legacy 4.x `metadatos` (Spanish keys) map to CSL in §7.

## 5. Canonical JSON dump (conformance oracle)
`dump(file)` returns one JSON object, keys sorted, floats rounded to 6 decimals, arrays in
`ord`/`n` order, all JSON-in-TEXT columns parsed:
```jsonc
{"spdf_version":"5.0",
 "meta":{…spdf_meta rows…},
 "document":{"id","kind","metadata","source_sha256","source_ref","mime","bytes","unit_count",
             "duration","created","updated","title","authors","year","language","rights"},
 "units":[{"id","ord","anchor","text","notes","header","footer","image","thumbnail","reader",
           "confidence","printed","t0","t1","words"}],
 "sections":[…], "fragments":[{"n","id","unit","ord","text","context","section","anchor",
 "anchor_end","search_text"}], "figures":[…],
 "spaces":[…], "vectors":{"<space id>":{"count":N,"sha256":"<sha256 of concatenated
 data blobs ordered by (target,id)>"}},
 "blobs":[{"key","mime","bytes","sha256"}], "extensions":[…]}
```
For legacy files, `dump` returns the **5.0 view** (mapped names) with `"spdf_version":"4.1"`
and `"legacy":true`.

## 6. Reference search (what conformance tests; products MAY rank better)
- **Lexical**: normalize the query to NFKD, drop combining marks, casefold; quoted phrases
  stay phrases; split the rest on non-letter/non-digit; each term becomes `"term"` (FTS5
  string, double quotes escaped); terms joined with ` OR `; phrases joined with ` AND ` and,
  if present, alone. If `search_text` is non-empty for any row, also match it (the column is
  already in the index). SQL: `SELECT n FROM fragments_fts WHERE fragments_fts MATCH ? ORDER
  BY bm25(fragments_fts, 1.0, 0.5, 0.5, 1.0), n LIMIT ?`. No stopword removal in the
  reference algorithm.
- **Vector**: brute-force cosine (dot product when `normalized=1`) between the query vector
  and every vector of the requested space and target; order by score desc, then `n` asc.
- **Hybrid**: reciprocal rank fusion, score = Σ 1/(k + rank), rank 1-based, **k = 10**
  (measured in Scholaris: 60 flattens short, good lists), ties by `n`.
- Result item: `{fragment_id, score, via: ["lexical"|"vector"], anchor, anchor_uri}`.

## 7. Legacy 4.x → 5.0 mapping
Tables: spdf→spdf_meta(clave→key, valor→value), documentos→documents, unidades→units,
secciones→sections, fragmentos→fragments, figuras→figures, espacios→spaces,
vectores→vectors, blobs→blobs, procedencia→provenance.
Columns: tipo→kind (pdf, pdf_escaneado→scanned_pdf, fotos→photos, imagen→image, audio,
video, documento→document, epub, presentacion→slides, hoja→sheet, web), metadatos→metadata,
huella→source_sha256, original→source_ref, unidades→unit_count, duracion→duration,
creado→created, actualizado→updated, titulo→title, autores→authors, anio→year,
idioma→language; orden→ord, ancla→anchor, texto→text, notas→notes, cabecera→header,
pie→footer, imagen→image, miniatura→thumbnail, lector→reader, confianza→confidence,
impresa→printed, palabras→words; padre→parent, nivel→level, unidad_desde→unit_from,
unidad_hasta→unit_to, resumen→summary; contexto→context, seccion→section,
ancla_fin→anchor_end, texto_busqueda→search_text; pie (figures)→caption,
descripcion→description; proveedor→provider, modelo→model, normalizado→normalized,
modalidades→modalities; objetivo→target (fragmento→fragment, unidad→unit, figura→figure),
espacio→space, valores→data; fase→stage, detalle→detail, cuando→at.
Anchor JSON: tipo→type (pagina→page, tiempo→time, seccion→section, diapositiva→slide,
hoja→sheet, web, imagen→image), fisica→physical, impresa→printed, romana→roman,
origen→source (leido→read, deducido→inferred, epub, ninguno→none), confianza→confidence,
hablante→speaker, ruta→path, parrafo→paragraph, n, hoja→sheet, filaDesde→row_from,
filaHasta→row_to, consultada→accessed, region→region.
Metadata (MetadatosDocumento → CSL): titulo→title, subtitulo→appended as "Title: Subtitle"
and kept in spdf.subtitle, tituloOriginal→original-title, autores[{nombre,apellidos,orcid}]→
author[{given,family}] (+spdf.orcid), editores→editor, traductores→translator,
entrevistadores→interviewer, anio→issued, anioOriginal→original-date, editorial→publisher,
lugar→publisher-place, revista→container-title, contenedor→container-title (if no revista),
coleccion→collection-title, volumen→volume, numero→issue, paginas→page, edicion→edition,
doi→DOI, isbn→ISBN, url→URL, idioma→language, tipoCSL→type, resumen→abstract,
idiomaOriginal→spdf.original_language, fecha→issued (full date), sinFecha→spdf.undated,
procedencia→spdf.provenance. Legacy `spaces.dtype` is f32; `blobs.sha256` is computed.

## 8. Integrity
`spdf_meta.content_sha256` (optional) = SHA-256 over the canonical dump with
`meta.content_sha256` and `meta.signature` removed (UTF-8, no whitespace). `signature`
(optional) = minisign/Ed25519 over that hash, with `signer` key id in `spdf_meta`.

## 9. Sidecars
- Collection manifest `*.spdfl.json`: `{"spdf_library":"1.0","name":…,"items":[{"sha256","title",
  "authors","year","url"?}]}`.
- Annotations `*.spdfa.json`: W3C Web Annotation (JSON-LD), target `source` = anchor URI
  without fragment, selector `{"type":"SpdfAnchorSelector","value":"<anchor URI>"}` plus a
  `TextQuoteSelector` for robustness.

## 10. Short citation (`cite(anchor, document, locale)`)
Author-date in parentheses: `(Family, Year, locator)`.
- Authors: 1 → `Family`; 2 → `Family y Family` (es) / `Family and Family` (en); ≥3 →
  `Family et al.`; none → short title in italics-free form.
- Year: `issued` year; none → `s. f.` (es) / `n.d.` (en); `undated` range is not printed here.
- Locator: page → `p. 145` (es/en), roman as printed (`p. xiv`), inferred → `p. [21]`,
  leaf foliation → `fol. 1r`; ranges → `pp. 145-146`; time → `h:mm:ss` (`1:09:20`, `0:42`
  under an hour as `m:ss`); slide → `diap. 3`/`slide 3`; verse → `v. 1234`/`vv. 1234-1240`;
  canonical → `<ref>`; section → `§ <last path element>`.
- Bibliography export: CSL-JSON (always), BibTeX (MUST), full CSL styles MAY via citeproc.

## 11. Conformance protocol
`conformance/cases/*.json`, each `{"id","kind","input":{…},"expect":{…}}` with kinds:
`dump`, `validate`, `search_lexical`, `search_vector`, `search_hybrid`, `anchor_uri`
(format and parse), `cite`, `legacy_dump`, `roundtrip` (write a file from a dump, dump it
again, compare). Files referenced relative to `conformance/`. Every implementation ships a
runner (CLI or test) that executes all cases and prints `{"impl","version","passed":[…],
"failed":[{"id","reason"}]}`; CI fails on any failure. Implementations MAY declare a profile
subset (e.g. reader-only skips `roundtrip`).

## 12. Validation error codes
E001 not SQLite · E002 unknown application_id/version · E003 gzip-wrapped 5.0 (warning) ·
E010 missing required table · E011 missing required column · E012 missing spdf_meta key ·
E020 trigger or view present · E030 vector length ≠ dims × dtype size · E031 space unknown ·
E040 invalid anchor JSON · E041 anchor type unknown · E042 chars out of range ·
E050 invalid metadata JSON · E051 metadata not CSL-like (no type/title) · E060 unknown
required extension · E070 FTS index out of sync (integrity-check) · E080 blob sha256 mismatch ·
E090 units.ord not contiguous · W100… warnings (e.g. no vectors in a 'semantic' profile).
Result: `{"valid":bool,"version":"5.0","profile":[…],"errors":[{"code","message","where"}],
"warnings":[…]}`.
