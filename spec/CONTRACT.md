# SPDF 5.0 implementation contract (draft 1, 2026-10-07)

This is the working contract every implementation in this repository codes against
while the normative specification (`SPEC.md`) is being written. `SPEC.md` absorbs
and supersedes it; if they disagree, raise it and the spec agent decides, recording the
change here. Key words MUST, SHOULD, MAY as in RFC 2119.

## Change log (read this first)

- **2026-10-07, draft 1 (spec agent).** Fixes every ambiguity reported by the rust, js,
  python and langs-a agents. Changes against draft 0, all binding from now on:
  1. **Canonical JSON = RFC 8785 (JCS)** after rounding: keys sorted by UTF-16 code units,
     no whitespace, ECMAScript number form (`1.0` → `1`, `1e-6` → `0.000001`, `-0` → `0`),
     raw UTF-8 (escape only `"`, `\` and U+0000–U+001F). Non-integer numbers are first
     rounded to 6 decimals (round half to even on the exact binary value). NULL columns
     appear as `null`, never omitted. Empty tables as `[]`, no vectors as `{}`. (§5)
  2. Dump ordering fixed for every array; `document` columns dropped from child rows;
     **`provenance` is part of the dump**; new top-level `fts` object. (§5)
  3. **Lexical search does not casefold or decompose the terms it sends to FTS5**: the
     tokenizer already folds case and diacritics, and NFKD/casefold break matches
     (`Straße` → `strasse` and `ﬁn` → `fin` are not in a `unicode61` index; `ſ` → `s`
     already is). Exact algorithm, dedup key, CJK route with `trigram` and a substring
     fallback in §6.
  4. Vector scores in f64; i8 = q/127; f16 = IEEE binary16; ties per target; quantization
     rule for writers. Hybrid: each list to depth `max(limit, 50)`, RRF k = 10. (§6)
  5. **Anchor URI aligned with W3C Media Fragments and RFC 5147**: `c=a-b` becomes
     `char=a,b`; `xywh=` now carries `percent:` (0–100) as in Media Fragments, instead of
     bare fractions (bare numbers mean pixels in Media Fragments); new `pe=` (physical
     end page). Canonical parameter order and percent-encoding fixed. (§3)
  6. Citation: no printed folio → `s. p.` (es) / `n. pag.` (en), never the physical index
     dressed as a page; `section` with `printed` cites the page; `§` paths add
     `párr.`/`para.`; Spanish `y` → `e` before /i/. (§10)
  7. Integrity: Ed25519 over a domain-separated message; formats of `signature`/`signer`
     fixed; new codes E081/E082. (§8)
  8. Legacy view: rules for `original`/image keys, unit `ord` renumbering (4.x is
     0-based), meta key mapping, dropped columns. (§7)
  9. Validation: all §2 tables are REQUIRED except `fragments_fts_trigram`; deterministic
     check order; new codes E013, E032, E081, E082, W100–W110. (§12)
  10. Conformance layout and case formats fixed (§11; details in `conformance/README.md`).

## 1. Container

- A SPDF 5.0 file is a SQLite 3 database, **uncompressed**, page size 4096 recommended,
  `PRAGMA application_id = 1397769286` (0x53504446, "SPDF"), `PRAGMA user_version = 500`,
  journal mode DELETE, compacted with `VACUUM` before distribution.
- `user_version` = major × 100 + minor × 10 (5.0 → 500, 5.1 → 510; legacy 4.0 → 400,
  4.1 → 410). A 5.0 reader MUST accept 500–599 (same major) and SHOULD warn (W105) on a
  newer minor; other majors → E002.
- Extension `.spdf`. Media type `application/vnd.spdf` (registration pending).
- One file = one document. (Libraries/collections are separate manifests, §9.)
- Readers MUST also accept legacy 4.0/4.1 files (Spanish schema, `user_version` 400/410 or
  `spdf.spdf_version` row; `application_id` 0), which are usually **gzip-wrapped** SQLite
  (magic `1f 8b`): decompress to a temp file or memory first (bounded, see max size).
  Legacy 3.0 (Scholaris v1-v3: gzip-wrapped SQLite with tables `metadata` and `chunks`,
  `metadata.schema_version`) MAY be supported through an importer.
- Distributed 5.0 files MUST NOT contain triggers or views. Writers keep the FTS index
  in sync themselves (or `INSERT INTO fragments_fts(fragments_fts) VALUES('rebuild')`
  before finalizing). Legacy 4.x files contain the three FTS sync triggers
  (`fragmentos_ai/ad/au`); readers tolerate exactly those.

### Safe opening (all readers)
Open read-only (`SQLITE_OPEN_READONLY` / `mode=ro`), `PRAGMA query_only=1`,
`PRAGMA trusted_schema=OFF`, enable `SQLITE_DBCONFIG_DEFENSIVE` where the binding allows,
never load extensions, reject files whose `sqlite_master` contains `trigger` or `view`
entries other than the tolerated legacy triggers, and enforce a configurable max blob
size (default 512 MiB) and max decompressed size for gzip input (default 4 GiB).
The FTS `integrity-check` is a write command: validators run it on an in-memory copy.

## 2. Schema 5.0

```sql
PRAGMA application_id = 1397769286;
PRAGMA user_version = 500;

CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- REQUIRED keys: spdf_version='5.0', profile (space-separated subset of
-- 'core semantic media full'), created (ISO 8601 UTC), generator ('name/version'),
-- document_id (= documents.id). OPTIONAL: content_sha256, signature, signer (§8),
-- license_note.

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,   -- pdf|scanned_pdf|photos|image|audio|video|document|epub|slides|sheet|web
  metadata      TEXT NOT NULL,   -- JSON: CSL-JSON item + "spdf" extension object (§4)
  source_sha256 TEXT NOT NULL,   -- hex SHA-256 of the original bytes (lowercase)
  source_ref    TEXT,            -- 'blob:<key>', URL, or NULL if not shipped
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
  ord        INTEGER NOT NULL,     -- reading order within the document
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
  id             TEXT PRIMARY KEY,   -- 'embeddinggemma-2@768', 'embeddinggemma-2@768:i8'
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
  detail TEXT, ms INTEGER, at TEXT NOT NULL   -- detail: JSON object or NULL
);

CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
-- Extension tables MUST be named x_<vendor>_<name>. A reader that meets a required
-- extension it does not know MUST refuse with error E060; optional ones are ignored.
```

Space ids: `<model>@<dims>` for f32, `<model>@<dims>:<dtype>` otherwise; a `+<variant>`
suffix MAY follow (legacy Scholaris uses it). Two spaces are **compatible** (vectors
comparable, so one query vector serves both) iff `provider`, `model`, `version`, `dims`,
`normalized`, `truncated_from` and `task_prefixes` are equal; `dtype` may differ.
Writers quantize f32 → i8 as `q = clamp(round_half_away_from_zero(v × 127), −127, 127)`,
and f32 → f16 with IEEE round-to-nearest-even.

## 3. Anchors (JSON in `anchor` / `anchor_end`)

```jsonc
{"type":"page","physical":10,"printed":"4","roman":false,"foliation":"page","source":"read","confidence":0.97}
//   foliation: page (default if absent) | leaf ("fol. 1r") | column ; source: read | inferred | epub | none
//   inferred folios are cited in brackets: "p. [21]"; printed null = unnumbered page
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
`"chars":[start,end]` (code points in NFC `units.text` of the anchor's unit, end
exclusive). Required members: page → `physical` (int ≥ 1), `printed` (string or null);
time → `t0`, `t1`; section → `path`; slide → `n`; sheet → `sheet`, `row_from`, `row_to`;
web → `url`; image → none; verse → `line_from`; canonical → `scheme`, `ref`.

### Anchor URI
`spdf:<docref>#<params>`. `<docref>` is `sha256-<64 lowercase hex of source_sha256>`
(preferred, portable) or the percent-encoded document id. Params are `key=value`,
joined with `&`, **in this canonical order**:

| key | value | from |
|---|---|---|
| `p` | physical page (int) | page `physical` |
| `pe` | physical end page (int), only if ≠ `p` | `anchor_end.physical` |
| `f` | printed folio (encoded) | `printed` of page / section / verse |
| `fe` | printed end folio, only if non-null and ≠ `f` | `anchor_end.printed` |
| `t` | `<t0>,<t1>` seconds (W3C Media Fragments npt) | time `t0`, `t1` (or `anchor_end.t1`) |
| `s` | path elements encoded, joined by literal `/` | section / web `path` |
| `para` | int | `paragraph` |
| `sl` | int | slide `n` |
| `sh` | sheet name (encoded) | sheet `sheet` |
| `rows` | `<a>-<b>` | sheet `row_from`, `row_to` |
| `v` | `<a>` or `<a>-<b>` (single if equal or no `line_to`) | verse `line_from`, `line_to` |
| `ref` | `<scheme>:<ref>`, both encoded, `:` literal | canonical |
| `char` | `<start>,<end>` (RFC 5147 style) | `chars` |
| `xywh` | `percent:<x>,<y>,<w>,<h>` (W3C Media Fragments) | `region` × 100 |

- Encoding: UTF-8, percent-encode every byte except RFC 3986 unreserved
  (`A–Z a–z 0–9 - . _ ~`), uppercase hex. Parsers decode leniently.
- Numbers: integers plain; `t` values rounded to 6 decimals and written in ECMAScript
  shortest form (`4160`, `4175.5`); `xywh` percent = fraction × 100 rounded to 4 decimals,
  shortest form (`0.125` → `12.5`); parsing divides by 100 and rounds to 6 decimals.
- Parse result (the **locator**): `{"docref": "...", "locator": {...}}` with only the
  present keys: `p`, `pe` (int), `f`, `fe`, `sh` (string), `t` ([t0, t1]), `s`
  (string[]), `para`, `sl` (int), `rows` ([a, b]), `v` ([a] or [a, b]), `ref`
  ({"scheme","ref"}), `char` ([a, b]), `xywh` ([x, y, w, h] as fractions). Unknown keys
  are ignored. `format(locator)` MUST reproduce the canonical URI byte for byte.
- Example: `spdf:sha256-3f2a…#p=29&f=21&char=118,301`.

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
`dump(file)` returns one JSON object. Every JSON-in-TEXT column is parsed; SQLite INTEGER →
JSON integer, REAL → number, TEXT → string, NULL → `null` (never omitted). Every
non-integer number (also inside parsed JSON) is rounded to 6 decimals. Serialization for
hashing is **RFC 8785 (JCS)**; conformance compares parsed JSON (numbers as f64).

```jsonc
{"spdf_version":"5.0",                    // legacy: "4.0"/"4.1" plus "legacy": true
 "meta":{…spdf_meta rows as key: value…},
 "fts":{"tokenizer":"unicode61 remove_diacritics 2","trigram":false},
 "document":{"id","kind","metadata","source_sha256","source_ref","mime","bytes","unit_count",
             "duration","created","updated","title","authors","year","language","rights"},
 "units":[{"id","ord","anchor","text","notes","header","footer","image","thumbnail","reader",
           "confidence","printed","t0","t1","words"}],                       // ORDER BY ord
 "sections":[{"id","parent","level","title","unit_from","unit_to","summary"}], // ORDER BY id
 "fragments":[{"n","id","unit","ord","text","context","section","anchor",
               "anchor_end","search_text"}],                                  // ORDER BY n
 "figures":[{"id","unit","image","caption","description","anchor"}],          // ORDER BY id
 "spaces":[{"id","provider","model","version","dims","dtype","normalized",
            "truncated_from","modalities","task_prefixes","created"}],        // ORDER BY id
 "vectors":{"<space id>":{"count":N,"sha256":"<hex sha256 of the data blobs of that space
            concatenated in ORDER BY target, id>"}},
 "blobs":[{"key","mime","bytes","sha256"}],   // ORDER BY key; sha256 COMPUTED from data
 "provenance":[{"stage","provider","model","detail","ms","at"}],
              // ORDER BY at, stage, provider, model, detail, ms (SQLite order, NULLs first)
 "extensions":[{"name","version","required"}]}                                // ORDER BY name
```
All ORDER BY use SQLite's BINARY collation (= code point order). Booleans stored as
INTEGER (`normalized`, `required`) stay integers. `legacy` is absent in 5.0 dumps.

## 6. Reference search (what conformance tests; products MAY rank better)

### Lexical
1. `q = NFC(query)`.
2. **Phrases**: scan left to right; an opening mark `"` `“` `«` `„` opens a phrase closed by
   `"`, `”`, `»`, `“`-or-`”` respectively. An opening mark with no closing mark is a
   separator.
3. **Words** = maximal runs of characters of Unicode general category L, M or N.
   A phrase term = its words joined by one space (empty phrases are dropped).
4. If there is at least one phrase: the terms are the phrases (loose words are
   discarded), joined with ` AND `. Otherwise the terms are the words, joined with ` OR `.
   Duplicates are removed keeping the first, by key `lower(remove_Mn(NFD(term)))` (key used
   ONLY for deduplication). No stopwords. No terms → empty result.
5. Each term is sent **as written** (NFC, no case folding, no decomposition) as an FTS5
   string: `"` + term with `"` doubled + `"`.
6. `SELECT n, bm25(fragments_fts, 1.0, 0.5, 0.5, 1.0) AS r FROM fragments_fts WHERE
   fragments_fts MATCH ? ORDER BY r, n LIMIT ?`; score = −r. (`search_text` is the 4th
   indexed column, so the modernized layer matches automatically.)
7. **CJK route**: if `q` contains any code point in U+2E80–U+2FDF, U+3040–U+30FF,
   U+3100–U+312F, U+3130–U+318F, U+31A0–U+31FF, U+3400–U+4DBF, U+4E00–U+9FFF,
   U+A960–U+A97F, U+AC00–U+D7AF, U+F900–U+FAFF, U+FF66–U+FF9F or U+20000–U+3FFFF:
   - if `fragments_fts_trigram` exists and every term has ≥ 3 code points: same MATCH
     string on `fragments_fts_trigram`, `ORDER BY bm25(fragments_fts_trigram), n`, score = −bm25;
   - otherwise **substring fallback** on `fragments.text`: hits = number of terms `t` with
     `instr(text, t) > 0`; keep rows with hits > 0 (with phrases: hits = number of
     phrases, all required); `ORDER BY hits DESC, n`; score = hits.
- Result item: `{fragment_id, score, via: ["lexical"], anchor, anchor_uri}`.

### Vector
Brute force over the vectors of the requested space and target (default `fragment`).
Every component is converted to f64 (f32 and f16 exactly; i8 as q/127); the query vector
is used as given (not normalized). `normalized=1` → score = dot product;
`normalized=0` → cosine. Order: score desc, then fragment `n` / unit `ord` / figure `id`.

### Hybrid
Lexical list and vector list (target fragment), each to depth `max(limit, 50)`; reciprocal
rank fusion: score = Σ 1/(10 + rank), rank 1-based; order score desc, then `n`; `via` lists
the contributing lists in the order `["lexical","vector"]`; cut to `limit`.

Scores are compared with absolute tolerance 1e-6; order MUST match exactly.

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
filaHasta→row_to, consultada→accessed, region→region. Unknown members are kept verbatim.
Metadata (MetadatosDocumento → CSL): titulo→title, subtitulo→appended as "Title: Subtitle"
(plus `title-short` = titulo) and kept in spdf.subtitle, tituloOriginal→original-title,
autores[{nombre,apellidos,orcid}]→author[{given,family}] (+spdf.orcid {"Family, Given": id}),
editores→editor, traductores→translator, entrevistadores→interviewer, anio→issued,
anioOriginal→original-date, editorial→publisher, lugar→publisher-place,
revista→container-title, contenedor→container-title (if no revista),
coleccion→collection-title, volumen→volume, numero→issue, paginas→page, edicion→edition,
doi→DOI, isbn→ISBN, url→URL, idioma→language, tipoCSL→type (default by kind: audio→speech,
video→motion_picture, web→webpage, presentacion→speech, hoja→dataset, imagen/fotos→graphic,
revista present→article-journal, else book), resumen→abstract,
idiomaOriginal→spdf.original_language, fecha→issued (full date, if its year = anio),
sinFecha{desde,hasta,fundamento}→spdf.undated{from,to,basis}, procedencia→spdf.provenance
(fuente→source, confianza→confidence). Empty or absent fields are omitted.

Further legacy rules (draft 1):
- `spdf_meta`: `creado`→`created`, `generador`→`generator`; other keys verbatim.
  `spdf_version` in the dump = the row value (`"4.0"`/`"4.1"`), plus `"legacy": true`.
- Dropped: `documentos.estado`, `documentos.bibliotecas`, index-only columns.
  `rights` = null; `spaces.dtype` = `"f32"`; `truncated_from`, `task_prefixes` = null;
  `spaces.created` ← `creado`; `provenance.model` = null; `blobs.sha256` computed.
- References (`original`, unit `imagen`/`miniatura`, figure `imagen`): `''` → null
  (figures: `''` stays `''`); a value equal to a key in `blobs` → `'blob:' + value`;
  anything else verbatim.
- `units.ord` = 1-based rank by (`orden`, `id`) (4.x numbers units from 0).
  `fragments.ord` = `orden` verbatim.

## 8. Integrity
`spdf_meta.content_sha256` (optional) = lowercase hex SHA-256 of the JCS serialization of
the canonical dump with `meta.content_sha256`, `meta.signature` and `meta.signer` removed.
`signature` (optional) = standard base64 (with padding) of the Ed25519 (RFC 8032, pure)
signature over the ASCII bytes `spdf-content-sha256:` + that hex; `signer` =
`ed25519:` + standard base64 of the 32-byte public key. Mismatch → E081 (hash) / E082
(signature).

## 9. Sidecars
- Collection manifest `*.spdfl.json`: `{"spdf_library":"1.0","name":…,"items":[{"sha256","title",
  "authors","year","url"?}]}`.
- Annotations `*.spdfa.json`: W3C Web Annotation (JSON-LD), target `source` = anchor URI
  without fragment, selector `{"type":"SpdfAnchorSelector","value":"<anchor URI>"}` plus a
  `TextQuoteSelector` for robustness.

## 10. Short citation (`cite(anchor, anchor_end?, metadata, locale)`)
`(` names `, ` year [`, ` locator] `)`. Locales `es` and `en` (others fall back to `en`).
- Names from CSL `author`: name = `literal`, or [`non-dropping-particle` + space] +
  `family`, or `given`. 1 → `A`; 2 → `A y B` (es; `e` instead of `y` when B starts with
  the sound /i/: `i`, `í`, `hi`, `hí` not followed by a vowel) / `A and B` (en); ≥ 3 →
  `A et al.` (both). No authors → `title-short`, else the title up to the first `:`
  (trimmed).
- Year: first `issued.date-parts` year (negative → `350 a. C.` / `350 BC`); none →
  `s. f.` (es) / `n.d.` (en); the `undated` range is not printed here.
- Locator:
  - page: `p. 145`; roman as printed (`p. xiv`); inferred (`source: inferred`) →
    `p. [21]`; `foliation: leaf` → `fol. 1r`, `column` → `col. 45`; ranges (anchor_end
    page with a different printed) → `pp. 145-146`, `fols. 1r-2v`, `cols. 45-46`
    (each end bracketed if inferred); printed null → `s. p.` (es) / `n. pag.` (en).
  - time: t0 as `h:mm:ss` from one hour, else `m:ss` (`1:09:20`, `0:42`), floor seconds;
    with a time anchor_end → `0:42-1:05` using `anchor_end.t1`.
  - section/web: with `printed` → as a page; else `§ <last path element>` plus
    `, párr. N` (es) / `, para. N` (en) when `paragraph` is present; empty path →
    `párr. N` / `para. N`.
  - slide → `diap. 3` / `slide 3`; sheet → `Data, filas 4-9` / `Data, rows 4-9`;
    verse → `v. 1234` / `vv. 1234-1240` (both locales); canonical → `<ref>`;
    image → no locator.
- Bibliography export: CSL-JSON (always), BibTeX (MUST), full CSL styles MAY via citeproc.

## 11. Conformance protocol
Layout under `conformance/`: `sources/*.json` (full dumps: dump + vector values + blob
bytes), `files/*.spdf` (5.0, generated), `legacy/*.spdf` (4.x, gzip), `invalid/*.spdf`,
`expected/*.dump.json`, `cases/*.json` (one case per file), `tools/generar.py`,
`tools/verificar.py`. Case: `{"id","kind","input":{…},"expect":{…}}`, kinds `dump`,
`validate`, `search_lexical`, `search_vector`, `search_hybrid`, `anchor_uri`, `cite`,
`legacy_dump`, `roundtrip`. Paths are relative to `conformance/`. Exact input/expect
shapes per kind: `conformance/README.md`. Every implementation ships a runner that prints
`{"impl","version","passed":[…],"failed":[{"id","reason"}],"skipped":[…]}`; CI fails on
any failure. Implementations MAY declare a profile subset (e.g. reader-only skips
`roundtrip`).

## 12. Validation
Order (stop marks a fatal error): gzip? (5.0 inside → E003, reported in `warnings`; legacy → continue) ·
SQLite header (E001, stop) · application_id/user_version (E002, stop) · triggers/views
(E020) · required tables (E010, each) · required columns (E011, each) · spdf_meta keys
(E012) · exactly one document (E013) · metadata (E050/E051) · extensions (E060) ·
units.ord (E090) · anchors of units, fragments, figures (E040/E041/E042) · spaces/vectors
(E031/E032/E030) · FTS integrity on an in-memory copy (E070) · blobs (E080) · integrity
(E081/E082) · profile warnings.

Codes: E001 not SQLite · E002 unknown application_id/version · E003 gzip-wrapped 5.0
(**warning**) · E010 missing required table · E011 missing required column · E012 missing
spdf_meta key · E013 documents must hold exactly one row · E020 trigger or view present ·
E030 vector length ≠ dims × dtype size · E031 vector space unknown · E032 unknown dtype ·
E040 invalid anchor (bad JSON or missing/ill-typed required member) · E041 anchor type
unknown · E042 chars out of range · E050 invalid metadata/rights JSON · E051 metadata not
CSL-like (no string `type` and `title`) · E060 unknown required extension · E070 FTS
index out of sync · E080 blob sha256 mismatch · E081 content_sha256 mismatch · E082 bad
signature · E090 units.ord not contiguous from 1 · W100 profile `semantic` without vectors
· W101 profile `media` without time anchors · W102 unit_count ≠ number of units · W105 newer
minor version · W110 legacy 4.x file.
Result: `{"valid":bool,"version":"5.0","profile":[…],"errors":[{"code","message","where"}],
"warnings":[…]}`; `valid` = no errors. Conformance compares the sets of codes.
