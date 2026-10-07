# SPDF: Semantic Processed Document Format, version 5.0

- **Status:** Working Draft, 2026-10-07. Stable enough to implement; changes go through
  the RFC process (`spec/rfcs/`) and are logged in `spec/CONTRACT.md` until 5.0 is final.
- **Editor:** José Luis Saorín Ferrer.
- **This version:** `spec/SPEC.md` in <https://github.com/joseluissaorin/spdf>.
- **Spanish translation:** [`SPEC.es.md`](SPEC.es.md) (faithful; in case of conflict the
  English text prevails).
- **License:** this specification is published under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Code in the repository is
  MIT OR Apache-2.0. Contributors commit not to assert patents against implementations.

## Abstract

SPDF is an open, portable file format for documents that have been **read once and can
be cited forever**. A `.spdf` file holds the text of one document (a printed book, a scan,
a recording, a slide deck, a spreadsheet, a web page) as a set of citable units and
searchable fragments, and every fragment carries an exact **anchor**: the printed page or
leaf, the second of a recording, the slide, the verse, the canonical reference. A citation
produced from an SPDF file can only print what the source says. The container is a plain
SQLite 3 database, the metadata is a CSL-JSON item, the full-text index uses tokenizers
that ship with every SQLite, and optional embedding vectors from several models can live
side by side. Any language with SQLite can read SPDF without special libraries.

## Status of this document

This is the first public version of the format (earlier versions, 3.0 to 4.1, were
internal to Scholaris and are covered as legacy in [§20](#legacy)). The conformance suite
in `conformance/` is part of the specification: where this text and a conformance case
disagree, the disagreement is a bug to be resolved through the RFC process; until it is,
implementations follow the conformance case.

## Contents

- [Preface](#preface)
- [1. Conventions and terminology](#terminology)
- [2. Container](#container)
- [3. Schema](#schema)
- [4. Anchors](#anchors)
- [5. Anchor URI](#anchor-uri)
- [6. Metadata](#metadata)
- [7. Text, normalization and offsets](#text-normalization)
- [8. Reference search](#search)
- [9. Vector spaces](#vectors)
- [10. Profiles](#profiles)
- [11. Extensions](#extensions)
- [12. Canonical dump](#dump)
- [13. Integrity and signatures](#integrity)
- [14. Security considerations](#security)
- [15. Privacy considerations](#privacy)
- [16. Rights](#rights)
- [17. Annotations and collections](#annotations)
- [18. Short citation](#citation)
- [19. Exports](#exports)
- [20. Legacy formats](#legacy)
- [21. Conformance](#conformance)
- [22. Validation](#validation)
- [23. Versioning and compatibility](#versioning)
- [24. Media type and file identification](#media-type)
- [25. Internationalization](#i18n)
- [References](#references)
- [Appendix A. Changes from SPDF 4.1](#changes)

<a id="preface"></a>
## Preface

SPDF was born inside Scholaris, an application written by José Luis Saorín Ferrer to
insert verified, page-exact citations into academic writing. Scholaris needed to read a
source once (with a PDF text layer, a vision model, or a speech recognizer), keep what it
had read, and answer for years afterwards the only question a citation must answer
honestly: *where exactly does the source say this?* The answer had to survive the
original file being moved, the reading model being replaced and the search engine being
rewritten. The result was a file per document, the *Scholaris Processed Document Format*,
which went through a gzip-compressed JSON-and-SQLite version (3.0) and a Spanish-named
SQLite schema (4.0 and 4.1).

Version 5.0 is the first version designed for everyone. It keeps what experience proved
right and drops what tied it to one program: identifiers are in English, the container is
uncompressed so it can be memory-mapped and read by HTTP ranges, the metadata is plain
CSL-JSON so that Zotero, citeproc and Pandoc understand it, and every number in a
conformance case comes from an oracle that anyone can rerun. The name became *Semantic
Processed Document Format*; the initials did not change.

Five principles guide every decision in this specification:

1. **Anchors first.** Every fragment knows exactly where it comes from: physical page and
   printed folio, leaf and side, second, slide, verse, canonical reference. Nothing that
   cannot be anchored is citable.
2. **Provenance.** A file says who read each unit and with what confidence, which model
   produced each vector, and how each metadata field was obtained. Derived data can be
   recomputed from the original plus the units.
3. **Read once, query many times.** Reading a document is expensive (vision models,
   speech recognition, human correction); querying it must be cheap, offline, and
   possible from any language with SQLite.
4. **Portability.** One file, one document, no server, no proprietary dependency, no
   compression layer to undo, no code inside the file. Readers in many languages pass
   the same conformance suite.
5. **Honest citation.** A citation prints only what an anchor says. A folio that was
   inferred is printed in brackets; an unnumbered page is cited as unnumbered; the
   modernized spelling used for search is never quoted.

<a id="terminology"></a>
## 1. Conventions and terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD
NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in BCP 14 [RFC 2119] [RFC 8174] when, and only when, they appear
in all capitals, as shown here.

ABNF follows [RFC 5234]. JSON follows [RFC 8259]; "JSON object", "array", "string" and
"number" have their RFC 8259 meanings. SQL follows SQLite's dialect.

- **Document**: the work an SPDF file describes (one per file).
- **Original**: the bytes the document was read from (PDF, image set, audio, EPUB…).
- **Unit**: a citable division of the document: a page or leaf, a time span, a slide, a
  section, a sheet range. Units are ordered and numbered from 1.
- **Fragment**: a searchable, citable passage of roughly 150 to 300 words, with the anchor
  of its start and, if it crosses units, of its end.
- **Anchor**: a JSON object that locates a unit, a fragment or a figure in the document
  ([§4](#anchors)).
- **Anchor URI**: the textual form of an anchor, `spdf:<docref>#<params>` ([§5](#anchor-uri)).
- **Space**: a vector space, i.e. the model, dimensions and encoding that produced a set
  of embedding vectors ([§9](#vectors)).
- **Reader**: software that opens SPDF files and exposes their content. **Writer**:
  software that creates SPDF files. **Validator**: software that checks files against
  this specification. **Producer**: a writer that also reads originals (OCR, speech
  recognition, embeddings).
- **Code point**: a Unicode scalar value. Lengths and offsets in this specification count
  code points, never bytes or UTF-16 code units.
- **NFC**: Unicode Normalization Form C [UAX #15].
- **JCS**: the JSON Canonicalization Scheme [RFC 8785].

<a id="container"></a>
## 2. Container

### 2.1 File

An SPDF 5.0 file is a SQLite 3 database file [SQLITE-FORMAT] holding exactly one
document. It MUST NOT be wrapped in any compression or archive layer: the database
header MUST start at byte 0.

Writers MUST set:

- `PRAGMA application_id = 1397769286` (hexadecimal 0x53504446). SQLite stores it
  big-endian at byte offset 68 of the header, so bytes 68 to 71 read "SPDF" in ASCII.
- `PRAGMA user_version = 500`. The value encodes the specification version as
  major × 100 + minor × 10 (5.0 → 500, 5.1 → 510).
- The `spdf_meta` row `spdf_version` to `"5.0"` ([§3.2](#schema)).

Writers SHOULD use a page size of 4096 bytes, the rollback journal in `DELETE` mode (never
leave a `-wal` or `-journal` file next to a distributed file), and run `VACUUM` after
the last write so the file has no free pages. Writers SHOULD NOT use `auto_vacuum`.

A file MUST NOT contain triggers or views, and MUST NOT contain virtual tables other
than the FTS5 tables defined in [§3](#schema). Writers keep the full-text index in sync
themselves (for example with `INSERT INTO fragments_fts(fragments_fts) VALUES('rebuild')`
before `VACUUM`).

### 2.2 Name and type

The file extension is `.spdf`. The media type is `application/vnd.spdf+sqlite3`
([§24](#media-type)). One file holds one document; libraries of documents are described
by a separate collection manifest ([§17](#annotations)).

### 2.3 Gzip input

Legacy 4.x files are SQLite databases wrapped in gzip [RFC 1952] ([§20](#legacy)).
Readers MUST therefore accept a file that starts with the gzip magic bytes `1F 8B`,
decompress it (to memory or to a temporary file) with a configurable limit on the
decompressed size (RECOMMENDED default 4 GiB), and continue with the result. A gzip-wrapped
5.0 file is readable but non-conforming: validators report it as `E003` in the warnings
list ([§22](#validation)).

### 2.4 Safe opening

SPDF files come from strangers. Every reader MUST open them as follows, and MUST refuse
the file if a step cannot be honoured by its SQLite binding:

1. Open the database read-only (`SQLITE_OPEN_READONLY`, or the URI parameter `mode=ro`).
   Never open a distributed file read-write in place.
2. `PRAGMA query_only = 1` and `PRAGMA trusted_schema = OFF`.
3. Enable `SQLITE_DBCONFIG_DEFENSIVE` where the binding exposes it, and keep extension
   loading disabled (`sqlite3_enable_load_extension(db, 0)`; never call
   `load_extension`).
4. Read `sqlite_master` and refuse the file if it contains a trigger, a view, or a
   virtual table other than `fragments_fts` and `fragments_fts_trigram` declared `USING
   fts5`. Legacy 4.x files are allowed exactly the three triggers `fragmentos_ai`,
   `fragmentos_ad` and `fragmentos_au` ([§20](#legacy)), which never fire on a read-only
   connection.
5. Enforce a configurable maximum size for any single BLOB or TEXT value read (RECOMMENDED
   default 512 MiB), for example with `sqlite3_limit(db, SQLITE_LIMIT_LENGTH, …)`.

Readers SHOULD also disable memory-mapped I/O (`PRAGMA mmap_size = 0`) and enable
`PRAGMA cell_size_check = ON` for files from untrusted sources, and MAY run
`PRAGMA quick_check` before use. Operations that need to write, such as the FTS5
`integrity-check` command, MUST run on a private copy (for example an in-memory copy made
with the backup API), never on the file. [§14](#security) explains the threats.

<a id="schema"></a>
## 3. Schema

### 3.1 Overview

The normative schema is the SQL script [`schema/spdf-5.0.sql`](schema/spdf-5.0.sql),
reproduced in full below. Every table in it is REQUIRED, even when empty; only
`fragments_fts_trigram` is OPTIONAL. Column names, types and constraints MUST be as
written. Writers MUST NOT add columns to these tables; data that does not fit goes into
extension tables ([§11](#extensions)). Readers MUST ignore columns they do not know (a
later minor version may add OPTIONAL columns, [§23](#versioning)).

JSON stored in TEXT columns MUST be valid JSON [RFC 8259] encoded in UTF-8; writers MAY
serialize it in any form (the canonical dump re-serializes it, [§12](#dump)). Timestamps
are ISO 8601 / RFC 3339 strings in UTC with a `Z` suffix. Identifiers (`id` columns) are
non-empty strings chosen by the writer; they are opaque, case-sensitive and stable for the
life of the file.

```sql
PRAGMA application_id = 1397769286;  -- 0x53504446, "SPDF"
PRAGMA user_version = 500;

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
-- OPTIONAL:
-- CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(
--   text, content='fragments', content_rowid='n', tokenize='trigram');

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
```

### 3.2 `spdf_meta`

Key/value pairs about the file. REQUIRED keys:

| key | value |
|---|---|
| `spdf_version` | `"5.0"` |
| `profile` | space-separated profile names, a subset of `core semantic media full` ([§10](#profiles)); always includes `core` |
| `created` | creation time of the file (UTC) |
| `generator` | `name/version` of the writer, e.g. `spdf-producer/0.3.1` |
| `document_id` | equal to `documents.id` |

OPTIONAL keys: `content_sha256`, `signature`, `signer` ([§13](#integrity)) and
`license_note` (free text for humans). Other keys MAY be added by later versions or by
extensions (prefixed `x_<vendor>_`); readers MUST ignore keys they do not know.

### 3.3 `documents`

Exactly one row.

- `kind`: one of `pdf` (PDF with a usable text layer), `scanned_pdf` (PDF read by
  vision), `photos` (a set of page photographs), `image` (a single image), `audio`,
  `video`, `document` (DOCX, ODT, RTF, HTML, Markdown, plain text), `epub`, `slides`,
  `sheet`, `web`. Readers MUST accept unknown kinds and treat them as `document`.
- `metadata`: the CSL-JSON item with the `spdf` extension ([§6](#metadata)).
- `source_sha256`: lowercase hexadecimal SHA-256 of the original bytes. It identifies the
  document across copies and is the preferred document reference in anchor URIs.
- `source_ref`: where the original is: `blob:<key>` when shipped inside the file, an
  absolute URL, or NULL.
- `mime`, `bytes`: media type and size in bytes of the original.
- `unit_count`: number of rows in `units` (a mismatch is warning W102).
- `duration`: seconds, for audio and video; NULL otherwise.
- `created`, `updated`: when the document record was created and last changed.
- `title`, `authors`, `year`, `language`: denormalized copies for filtering without
  parsing JSON: the CSL `title`; the family names (or literal names) of the CSL `author`
  list joined with `"; "`; the first year of `issued`; the CSL `language`. They MUST
  agree with `metadata` when present.
- `rights`: JSON rights object ([§16](#rights)) or NULL.

### 3.4 `units`

One row per citable unit, `ord` = 1, 2, 3… without gaps (E090), in reading order.

- `anchor`: the unit's anchor ([§4](#anchors)).
- `text`: the full text of the unit as read, NFC, light Markdown ([§7](#text-normalization)).
  Empty string for units without text (a blank page, a photograph).
- `notes`: JSON array of strings (footnotes detached from the body) or NULL.
- `header`, `footer`: running heads and feet, kept out of `text`, or NULL.
- `image`, `thumbnail`: `blob:<key>` or URL of the unit's image (page, frame, slide) and
  of its thumbnail, or NULL.
- `reader`: what produced `text` (`pdf-text-layer`, `tesseract-5`, `gemma-4-e4b`,
  `whisper-large-v3-turbo`, `human`…). `confidence`: 0 to 1.
- `printed`: the printed folio of a page unit, copied from its anchor, so readers can
  "go to page 145" with an index.
- `t0`, `t1`: start and end in seconds, copied from a time anchor; NULL otherwise.
- `words`: word timings for audio and video ([§7.4](#text-normalization)) or NULL.

### 3.5 `sections`

The heading tree. `level` starts at 1; `parent` is the id of the enclosing section or
NULL; `unit_from` and `unit_to` are the first and last unit ids (`unit_to` NULL when the
section ends with the document); `summary` is OPTIONAL text in the document language.

### 3.6 `fragments`

- `n`: a positive integer, unique, stable: it is the rowid the FTS5 index uses (an
  implicit rowid may change on `VACUUM`).
- `unit`: id of the unit where the fragment starts. `ord`: reading order within the
  document (increasing with the position of the fragment in the text).
- `text`: the literal passage, NFC, exactly as in the source (never modernized).
- `context`: one line that situates the fragment in the work ("Chapter III: the struggle
  for existence"), used by search; empty string if none.
- `section`: JSON array of strings, the heading path, or NULL.
- `anchor`: anchor of the start of the fragment. `anchor_end`: anchor of its end when it
  crosses into another unit; NULL otherwise.
- `search_text`: the modernized-spelling layer ([§25.3](#i18n)): text used ONLY for
  search (`aſsi` → `así`, `V. M.` → `vuestra merced`). Empty string when it adds
  nothing; NULL when not computed. It MUST NOT be displayed as the text of the source or
  quoted.

### 3.7 `fragments_fts` and `fragments_fts_trigram`

`fragments_fts` is an external-content FTS5 index over `fragments` with the columns
`text`, `context`, `section` and `search_text` in this order and the tokenizer
`unicode61 remove_diacritics 2`, which every SQLite with FTS5 provides. It MUST be in sync
with `fragments` (E070). `fragments_fts_trigram` is OPTIONAL, indexes `text` only with the
`trigram` tokenizer (SQLite 3.34 or later), and SHOULD be present when the document is
mostly in Chinese, Japanese or Korean.

### 3.8 `figures`

Figures, plates, tables as images, photographs inside a page. `image` is `blob:<key>` of
a cropped image, or the unit's image together with a `region` in the anchor. `caption`
is the printed caption, if any; `description` is a description in the document language
(for accessibility and search). `anchor` normally carries a `region`.

### 3.9 `spaces` and `vectors`

See [§9](#vectors). `vectors.target` is `fragment`, `unit` or `figure` and `vectors.id`
is the id of that row; `data` is the little-endian vector.

### 3.10 `blobs`

Binary content shipped inside the file: the original, page images, cropped figures,
thumbnails. `key` is an opaque string (by convention path-like, `pages/0001.png`), `mime`
its media type, `sha256` the lowercase hex SHA-256 of `data` (E080). Other tables refer
to a blob as `blob:<key>`.

### 3.11 `provenance`

One row per production step: `stage` (`reading`, `transcription`, `folios`,
`metadata`, `embedding`, `figures`…), `provider`, `model`, `detail` (JSON object or
NULL), `ms` (duration in milliseconds) and `at` (UTC timestamp). See [§15](#privacy) for
what not to record.

### 3.12 `extensions`

See [§11](#extensions).

<a id="anchors"></a>
## 4. Anchors

### 4.1 General

An anchor is a JSON object with a string member `type`. The types defined by this version
and their members are:

| type | REQUIRED members | OPTIONAL members |
|---|---|---|
| `page` | `physical` (integer ≥ 1), `printed` (string or null) | `roman` (boolean), `foliation` (`page`, `leaf`, `column`; default `page`), `source` (`read`, `inferred`, `epub`, `none`), `confidence` (0–1) |
| `time` | `t0`, `t1` (seconds, 0 ≤ t0 ≤ t1) | `speaker` (string) |
| `section` | `path` (array of strings) | `paragraph` (integer ≥ 1), `printed` (string) |
| `slide` | `n` (integer ≥ 1) | |
| `sheet` | `sheet` (string), `row_from`, `row_to` (integers) | |
| `web` | `url` (string) | `path`, `paragraph`, `accessed` (ISO date) |
| `image` | | |
| `verse` | `line_from` (integer) | `line_to` (integer), `printed` (string) |
| `canonical` | `scheme` (string), `ref` (string) | |

Every anchor MAY also carry:

- `region`: `{"x", "y", "w", "h"}`, numbers between 0 and 1, fractions of the width and
  height of the unit's image, origin at the top left;
- `chars`: `[start, end]`, code point offsets into the NFC `text` of the anchor's unit,
  `0 ≤ start ≤ end ≤ length`, end exclusive (E042);
- `matter`: what kind of matter the unit is: `body` (the text of the work), `front`
  (preliminaries: title page, contents, licences, dedication, prologue of an edition),
  `back` (index, colophon, appendices of an edition), `plate` (a plate or fold-out
  outside the text pages), `cover`, `library` (bookplates, stamps, library or digitizer
  pages, licences of a digital edition) or `blank`. Absent means `body`; readers MUST
  treat values they do not know as `body`. Writers SHOULD set it on the units of paged
  documents whenever it is not `body`.

In this specification an "integer" is a JSON number with an integral value: `10` and
`10.0` are the same JSON value and both are integers. An anchor whose JSON is invalid or
that lacks or mistypes a REQUIRED member is invalid (E040); an unknown `type` is E041. Readers MUST preserve members they do not know when
they copy anchors.

### 4.2 Pages, folios and leaves

`physical` is the 1-based position of the page in the original (the PDF page index, the
photo number). `printed` is the folio exactly as printed on the page ("23", "xiv", "A-3",
"1r"), or null when the page carries no number.

- `roman: true` marks folios in roman numerals (front matter).
- `foliation` describes what the printed numbers count: `page` (each page numbered),
  `leaf` (each leaf numbered, sides `r`ecto and `v`erso, printed as `"1r"`, `"1v"`), or
  `column` (columns numbered, as in some dictionaries and early printed books).
- `source` says how `printed` was obtained: `read` (seen on the page), `inferred`
  (deduced from neighbouring pages, e.g. an unnumbered verso), `epub` (from an EPUB page
  list), `none` (no folio; `printed` is null).
- An inferred folio is cited in brackets, `p. [21]`; a page without folio is cited as
  unnumbered ([§18](#citation)). A producer MUST NOT invent folios: if no evidence
  supports a number, `printed` is null and `source` is `none`.

### 4.3 Time, sections, verses and canonical references

Time anchors locate recordings in seconds from the start of the original; `speaker` names
who speaks. Section anchors locate unpaginated text (EPUB, DOCX, HTML) by heading path and
paragraph number, and MAY add the equivalent printed page when the edition provides a page
list. Verse anchors count lines of verse (`line_from`, `line_to`), as printed editions
number them. Canonical anchors use a citation system that is independent of any edition:
`stephanus` (Plato), `bekker` (Aristotle), `bible` (book chapter:verse), `cts` (a CTS URN
[CTS]), or any other documented scheme; schemes are lowercase ASCII.

### 4.4 Start and end

A fragment's `anchor` locates its start; `anchor_end`, when present, locates its end and
has the same `type`. A citation of the whole fragment then prints a range
(`pp. 145-146`).

- The **end unit** of a fragment is the first unit after its start unit (in `ord` order)
  whose anchor equals `anchor_end` once `chars` and `region` are removed from both.
- `chars` in `anchor` gives the part of the fragment that lies in the start unit, and
  `chars` in `anchor_end` the part that lies in the end unit (usually `[0, b]`). Writers
  SHOULD set both on crossing fragments, so that readers know which unit each part of
  the passage comes from.
- Writers SHOULD NOT let a fragment cross from a unit of one `matter` to a unit of
  another (body text into a plate, a cover, a library page or a licence), nor from a page
  with a printed folio to a page without one: the citation of such a fragment would mix
  locators of different natures. Validators report such fragments as W103.

<a id="anchor-uri"></a>
## 5. Anchor URI

### 5.1 Syntax

An anchor URI names a place in a document independently of any file:

```
spdf:sha256-3f2a…c9#p=29&f=21&char=118,301
```

The document reference is `sha256-` followed by the 64 lowercase hex digits of
`documents.source_sha256` (RECOMMENDED: it is the same for every copy of the document), or
the percent-encoded document id. The fragment is a list of parameters. The parameters
reuse W3C Media Fragments syntax [MEDIA-FRAGMENTS] for time (`t=`) and space (`xywh=`) and
RFC 5147 [RFC 5147] syntax for character ranges (`char=`), so tools that know those
standards can interpret them.

The canonical form is defined by this ABNF [RFC 5234]:

```abnf
spdf-uri    = "spdf:" docref [ "#" params ]
docref      = hash-ref / id-ref
hash-ref    = "sha256-" 64lhex
lhex        = DIGIT / %x61-66                     ; 0-9 a-f
id-ref      = 1*vchar                             ; percent-encoded document id
params      = param *( "&" param )
param       = p / pe / f / fe / t / s / para / sl / sh / rows / v / ref / char / xywh
p           = "p=" posint                         ; physical page
pe          = "pe=" posint                        ; physical end page
f           = "f=" value                          ; printed folio
fe          = "fe=" value                         ; printed end folio
t           = "t=" number [ "," number ]          ; seconds, Media Fragments npt
s           = "s=" value *( "/" value )           ; section path
para        = "para=" uint                        ; paragraph
sl          = "sl=" posint                        ; slide
sh          = "sh=" value                         ; sheet name
rows        = "rows=" uint "-" uint               ; sheet rows
v           = "v=" uint [ "-" uint ]              ; verse lines
ref         = "ref=" value ":" value              ; canonical scheme ":" reference
char        = "char=" uint "," uint               ; code points, RFC 5147 style
xywh        = "xywh=percent:" number "," number "," number "," number
value       = *vchar
vchar       = unreserved / pct-encoded
unreserved  = ALPHA / DIGIT / "-" / "." / "_" / "~"
pct-encoded = "%" HEXDIG HEXDIG                   ; uppercase in the canonical form
posint      = %x31-39 *DIGIT
uint        = "0" / posint
number      = uint [ "." 1*DIGIT ]
```

In the canonical form, parameters appear at most once and in the order of the `param`
rule above (`p`, `pe`, `f`, `fe`, `t`, `s`, `para`, `sl`, `sh`, `rows`, `v`, `ref`,
`char`, `xywh`); values are UTF-8 strings in which every byte other than an unreserved
character is percent-encoded with uppercase hex digits; in `s` the separators between path
elements are literal `/` and a `/` inside an element is `%2F`; in `ref` the first literal
`:` separates the scheme from the reference, and colons inside them are `%3A`. Numbers
use the shortest decimal form of ECMAScript (`4160`, `4175.5`, `0.125`), never an exponent.

### 5.2 From an anchor to a URI

Formatting maps an anchor (and optionally an end anchor) to parameters:

| anchor | parameters |
|---|---|
| `page` | `p` = `physical`; `f` = `printed` if not null; with an end page: `pe` = its `physical` if different, `fe` = its `printed` if not null and different from `printed` |
| `time` | `t` = `t0`, then `t1` (or the end anchor's `t1`) |
| `section`, `web` | `s` = `path` if not empty; `para` = `paragraph`; `f` = `printed`; `fe` as for pages |
| `slide` | `sl` = `n` |
| `sheet` | `sh` = `sheet`; `rows` = `row_from`-`row_to` |
| `verse` | `v` = `line_from`, or `line_from`-`line_to` when `line_to` is present and different; `f` = `printed` |
| `canonical` | `ref` = `scheme`:`ref` |
| `image` | none |
| any | `char` = `chars`; `xywh` = `region` × 100, as `percent:` |

`t` values are rounded to 6 decimal places. `xywh` values are fractions × 100 rounded to 4
decimal places (`0.125` → `12.5`, `0.333333` → `33.3333`). A URI without parameters
(`spdf:<docref>`) designates the whole document.

### 5.3 Parsing

Parsing returns the document reference and a **locator** object with one member per
parameter present: `p`, `pe`, `para`, `sl` (integers); `f`, `fe`, `sh` (strings); `t`
(array of one or two numbers); `s` (array of strings); `rows` (two integers); `v` (one or
two integers); `ref` (object with `scheme` and `ref`); `char` (two integers); `xywh` (four
fractions, the percent values divided by 100 and rounded to 6 decimals).

Parsers MUST accept percent-encoding with lowercase hex digits, parameters in any order,
unencoded non-ASCII characters (IRI form [RFC 3987]), the `npt:` prefix and the clock
forms `h:mm:ss[.f]` and `mm:ss[.f]` in `t`. Parsers MUST ignore parameters whose names
they do not know. Parsers MUST reject: a scheme other than `spdf:`; an empty document
reference; a repeated parameter; malformed numbers; `p`, `pe` or `sl` equal to 0; a
`char` or `t` range whose end precedes its start; `xywh` without the `percent:` unit
(pixel coordinates cannot be resolved without the image); percent-encoding that does not
decode to valid UTF-8.

Formatting a parsed locator MUST give back the canonical URI byte for byte. The
conformance suite checks format, parse and round trip for every anchor type.

### 5.4 Resolution

`locate(file, reference)` resolves an anchor URI, or the URL of an SPDF resource with a
fragment identifier ([§24](#media-type)), against a file, and returns:

```json
{"document": true, "units": ["p5", "p6"], "fragments": ["q4"], "char": [101, 278], "xywh": null}
```

1. **Reference.** An `spdf:` URI is parsed as in [§5.3](#anchor-uri); `document` is true
   when its document reference is `sha256-` followed by the file's `source_sha256`, or the
   file's document id. Any other reference (an `https:` URL, a file path) designates the
   file itself: `document` is true and the text after its first `#`, if any, is parsed as
   the parameter list of §5.3. When `document` is false, `units` and `fragments` are empty
   (implementations MAY report this as an error instead; conformance runners map such an
   error to `document: false`).
2. **Rule.** The first parameter present in the order `p`, `f`, `t`, `sl`, `v`, `ref`,
   `s`, `sh` selects the predicate below. Without any of them (no fragment, or only
   `char` and `xywh`) the reference designates the whole document and `units` and
   `fragments` are empty.
3. **Predicate** on an anchor (members absent from the anchor never match):
   - `p`: a `page` anchor with `p ≤ physical ≤ pe` (`pe` defaults to `p`);
   - `f`: `printed` equal to `f` (for units, the `units.printed` column);
   - `t`: a `time` anchor with `t0 ≤ t < t1`, where `t` is the first value of the
     parameter; the last unit with a time anchor (in `ord` order) also matches when `t`
     equals its `t1`;
   - `sl`: a `slide` anchor with `n = sl`;
   - `v`: a `verse` anchor with `line_from ≤ v ≤ line_to` (`line_to` defaults to
     `line_from`), where `v` is the first value of the parameter;
   - `ref`: a `canonical` anchor with the same `scheme` and `ref`;
   - `s`: a `section` or `web` anchor whose `path` starts with the elements of `s`; when
     `para` is present, the `path` must equal `s` and `paragraph` must equal `para`;
   - `sh`: a `sheet` anchor with `sheet = sh` and, when `rows` is present,
     `row_from ≤ a ≤ row_to` for its first value `a`.
4. **Matches.** `units` are the ids of the units whose anchor matches, in `ord` order.
   `fragments` are the ids of the fragments whose start `anchor` or whose `anchor_end`
   matches, in `n` order (a fragment that ends on a page is found from that page). When
   no unit matches but some fragments do, `units` are the distinct start units of those
   fragments, in `ord` order.
5. **Characters.** `char` refers to the text of the first unit of `units`. When `char` =
   `[c, d]` is present, a fragment is kept in `fragments` only if its start unit is that
   unit and its `anchor` has `chars` = `[a, b]` that overlap the range, or its end unit
   ([§4.4](#anchors)) is that unit and its `anchor_end` has `chars` that overlap it;
   `[a, b]` overlaps `[c, d]` when `a < d` and `c < b` (for `c < d`), or when
   `a ≤ c < b` (for `c = d`).
6. `char` and `xywh` are copied from the locator, or null.

Several units may match (two pages printed "1", a verse number repeated in two poems):
`locate` returns them all and the reader lets the user choose; `p` always disambiguates
pages, which is why formatted URIs carry it.

The `spdf` URI scheme is intended for provisional registration [RFC 7595]; the request is
drafted in `governance/drafts/uri-scheme-spdf.md`.

<a id="metadata"></a>
## 6. Metadata

### 6.1 CSL-JSON item

`documents.metadata` is one CSL-JSON item [CSL-JSON] describing the document as it should
be cited: at least `type` (a CSL type such as `book`, `article-journal`, `chapter`,
`thesis`, `speech`, `interview`, `broadcast`, `motion_picture`, `webpage`, `dataset`,
`graphic`) and `title` (E051 if either is missing). Common members: `author`, `editor`,
`translator`, `interviewer` (arrays of names `{family, given}` or `{literal}`, with the
CSL particles `non-dropping-particle` and `dropping-particle` when needed), `issued`
(`{"date-parts": [[year, month, day]]}`), `original-date`, `title-short`,
`original-title`, `container-title`, `collection-title`, `publisher`, `publisher-place`,
`volume`, `issue`, `page`, `edition`, `DOI`, `ISBN`, `ISSN`, `URL`, `accessed`,
`language` (BCP 47), `abstract`, `note`. The `id` member is OPTIONAL inside the file;
exports set it ([§19](#exports)).

Writers MUST NOT invent metadata. A field that cannot be supported by the original or by
a cited external source is omitted.

### 6.2 The `spdf` extension object

The member `spdf` of the item holds what CSL cannot express. All its members are OPTIONAL:

```json
"spdf": {
  "provenance": {"title": {"source": "title-page", "confidence": 0.99},
                 "issued": {"source": "colophon", "confidence": 0.95}},
  "undated": {"from": 1600, "to": 1610, "basis": "printer active years"},
  "original_language": "fr",
  "subtitle": "con anotaciones de Fernando de Herrera",
  "orcid": {"Foucault, Michel": "0000-0000-0000-0000"}
}
```

- `provenance`: per CSL field, where the value came from (`reading`, `title-page`,
  `colophon`, `crossref`, `openalex`, `wikidata`, `user`, `epub`, `pdf`, …) and a confidence
  between 0 and 1.
- `undated`: for works without a printed date, a plausible range (`from`, `to`, years,
  negative for BCE) and the evidence (`basis`). It MUST NOT be copied into `issued`: a
  citation prints "s. f." / "n.d." ([§18](#citation)).
- `original_language`: BCP 47 tag of the original language of a translation.
- `subtitle`: the subtitle when the CSL `title` is "Title: Subtitle".
- `orcid`: ORCID identifiers by name ("Family, Given").

Other members MAY be added by extensions with the prefix `x_<vendor>_`.

<a id="text-normalization"></a>
## 7. Text, normalization and offsets

### 7.1 Encoding and normalization

All text is UTF-8 in NFC. Writers MUST normalize to NFC before storing and before
computing offsets. Writers MUST NOT store U+0000, unpaired surrogates or noncharacters,
and SHOULD NOT store other control characters except U+0009 (tab) and U+000A (line feed).
Lines end with U+000A only.

### 7.2 Offsets

`chars` offsets ([§4.1](#anchors)) and every length in this specification count code
points of the NFC text. Implementations whose strings are UTF-16 (JavaScript, Java, C#,
Swift's `NSString`) MUST convert: a character outside the Basic Multilingual Plane counts
as one code point but two UTF-16 units.

### 7.3 Light Markdown

`units.text` MAY use this subset of CommonMark [COMMONMARK]: paragraphs separated by a
blank line; `#` to `######` headings; `*emphasis*` and `**strong**`; `-` and `1.` lists;
`>` quotations; tables in GitHub style; footnote markers `[^1]` whose text goes to
`notes`. Readers MUST NOT interpret raw HTML in `text`; they display it as text.
Offsets count the stored characters, markup included. Fragments SHOULD keep the markup of
their source unit so that `fragments.text` is a substring of the unit's `text` whenever
the fragment does not cross units.

Speaker turns in transcripts start with the label `**Name:**` followed by one space
(`**Neil Armstrong:** Houston, Tranquility Base here.`).

### 7.4 Word timings

`units.words` is the JSON object `{"v": 1, "t0": <seconds>, "cs": [start, duration,
start, duration, …]}`: one pair of integers per word, in centiseconds from `t0` (which
equals the unit's `t0`). The words are the maximal runs of non-whitespace characters of the
unit's `text` after removing the speaker labels (`**Name:**`); `cs` therefore holds
exactly twice as many integers as there are words. Readers use it to highlight the word
being spoken and to turn a `char` range into a time range.

<a id="search"></a>
## 8. Reference search

The reference search defines what conformance tests: results that every implementation
returns identically from the same file. Products MAY rank better (stopwords, query
expansion, reranking, filters); they MUST still offer the reference behaviour to pass
the suite, and SHOULD label the difference in their documentation.

A result item is `{"fragment_id", "score", "via", "anchor", "anchor_uri"}` where `via`
lists the contributing methods (`"lexical"`, `"vector"`) in that order, `anchor` is the
fragment's anchor and `anchor_uri` the URI formatted from `anchor` and `anchor_end` with
the `sha256-` document reference.

### 8.1 Lexical search

Given a query string and a limit:

1. **Normalize**: `q` = NFC(query).
2. **Phrases**: scan `q` from left to right. An opening mark `"` (U+0022), `“` (U+201C),
   `«` (U+00AB) or `„` (U+201E) opens a phrase that the next `"`, `”` (U+201D), `»`
   (U+00BB) or, for `„`, `“` or `”` respectively closes. The text between the marks is the
   phrase. An opening mark without a closing mark is treated as a separator.
3. **Words**: maximal runs of characters whose Unicode general category is a letter (L),
   a mark (M) or a number (N). A phrase term is the phrase's words joined with one space;
   phrases without words are dropped.
4. **Terms**: if there is at least one phrase term, the terms are the phrase terms (loose
   words outside quotes are discarded) and the operator is `AND`. Otherwise the terms are
   the words of `q` and the operator is `OR`. Duplicate terms are removed, keeping the
   first, comparing them by the key `lower(remove_Mn(NFD(term)))` (Unicode default
   lowercase, after removing nonspacing marks); the key is used only to detect duplicates.
   No stopwords are removed. Without terms the result is empty.
5. **MATCH string**: every term, **as written** (no case folding, no decomposition), is
   an FTS5 string: `"` + the term with each `"` doubled + `"`; the strings are joined
   with ` AND ` or ` OR `. The tokenizer folds case and diacritics itself; folding the
   query beforehand would break matches (`Straße`, `ﬁn`).
6. **Query**:
   ```sql
   SELECT f.n, f.id, bm25(fragments_fts, 1.0, 0.5, 0.5, 1.0) AS r
     FROM fragments_fts JOIN fragments f ON f.n = fragments_fts.rowid
    WHERE fragments_fts MATCH ?1 ORDER BY r, f.n LIMIT ?2
   ```
   The score is −r. Because `search_text` is the fourth indexed column, a query in modern
   spelling finds old spelling without any special step. Since `n` is the rowid of the
   index, implementations MAY rank inside the index alone (`SELECT rowid, bm25(…) FROM
   fragments_fts WHERE fragments_fts MATCH ?1 ORDER BY 2, 1 LIMIT ?2`) and look up the
   fragment ids of the returned rows only; the result is identical. Readers that fetch
   files by HTTP ranges SHOULD do so, as it avoids reading every matching fragment.
7. **CJK route**: if `q` contains a code point in one of the ranges U+2E80–U+2FDF,
   U+3040–U+30FF, U+3100–U+312F, U+3130–U+318F, U+31A0–U+31FF, U+3400–U+4DBF,
   U+4E00–U+9FFF, U+A960–U+A97F, U+AC00–U+D7AF, U+F900–U+FAFF, U+FF66–U+FF9F or
   U+20000–U+3FFFF, step 6 is replaced:
   - if `fragments_fts_trigram` exists and every term has at least 3 code points, the same
     MATCH string runs against `fragments_fts_trigram`, ordered by
     `bm25(fragments_fts_trigram)` then `n`; the score is −bm25;
   - otherwise (no trigram index, or a term shorter than 3 code points, which a trigram
     index cannot match) the **substring fallback** runs on `fragments.text`: for each
     fragment, `hits` = the number of terms `t` with `instr(text, t) > 0`; fragments with
     `hits` ≥ 1 (with the `OR` operator) or `hits` = number of terms (with `AND`) are
     returned ordered by `hits` descending, then `n`; the score is `hits`.

### 8.2 Vector search

Given a space, a target (`fragment` by default, or `unit`, `figure`), a query vector of
`dims` numbers and a limit: compare the query with every vector of that space and target
by brute force. Every component is converted to an IEEE 754 binary64 number (f32 and f16
exactly; i8 as q/127). The query is used as given, not normalized. When the space has
`normalized = 1` the score is the dot product; otherwise it is the cosine similarity.
Results are ordered by score descending, then by fragment `n`, unit `ord` or figure `id`.
A result item for the target `unit` or `figure` carries `unit_id` or `figure_id` instead
of `fragment_id`, and the anchor URI of the unit's or figure's own anchor. Products MAY
use approximate indexes; the reference is exhaustive.

### 8.3 Hybrid search

Run the lexical search and the vector search (target `fragment`), each with depth
`max(limit, 50)`, and fuse them by reciprocal rank fusion [RRF] with k = 10:
score = Σ 1/(10 + rank) over the lists that contain the fragment, rank starting at 1.
Order by score descending, then `n`; keep `limit` results. The constant 10 was measured
in Scholaris: the classic 60 flattens short, good lists.

### 8.4 Comparison in conformance

Result order MUST match exactly; scores MUST match within an absolute tolerance of 1e-6.
The lexical scores are those of SQLite's own `bm25()`, which is the oracle.

<a id="vectors"></a>
## 9. Vector spaces

### 9.1 Spaces

A row of `spaces` describes how a set of vectors was produced:

- `id`: `<model>@<dims>` for `f32` vectors and `<model>@<dims>:<dtype>` otherwise
  (`embeddinggemma-2@768`, `embeddinggemma-2@256:i8`). A suffix `+<variant>` MAY follow
  to separate vectors of the same model computed from different inputs (legacy Scholaris
  uses `+contexto`).
- `provider` (who ran the model: `local`, `google`, `inferbox`…), `model`, `version`.
- `dims`: number of components.
- `dtype`: `f32` (IEEE 754 binary32), `f16` (binary16) or `i8` (signed byte; the value is
  q/127). Other values are invalid (E032).
- `normalized`: 1 if every stored vector has unit Euclidean norm (before quantization).
- `truncated_from`: for Matryoshka truncation [MRL], the original dimension (`768` for a
  vector cut to 256); NULL otherwise. Truncated vectors SHOULD be renormalized before
  storing, with `normalized = 1`.
- `modalities`: JSON array of the input modalities the model accepts (`text`, `image`,
  `audio`, `video`, `pdf`).
- `task_prefixes`: JSON object with the prefixes or instructions used at encoding time,
  `{"document": "…", "query": "…"}`, so that a reader can encode queries the same way; NULL
  if none.

A file MAY hold several spaces; a file without spaces is valid (profile `core`).

### 9.2 Vectors

`vectors.data` is the vector as `dims` little-endian values of the space's `dtype`, so its
length is `dims` × 4, 2 or 1 bytes (E030). Every vector refers to a space in `spaces`
(E031). Writers quantize as follows: f32 → f16 with IEEE round-to-nearest-even;
f32 → i8 with `q = clamp(round_half_away_from_zero(v × 127), −127, 127)`. The value −128
is not used. A value that does not fit the dtype (a finite f32 above 65504 that would round
to infinity in f16, a non-finite value) is an error for the writer, never silently
stored.

### 9.3 Compatibility between spaces and quantizations

Two spaces are **compatible**, and one query vector serves both, when `provider`,
`model`, `version`, `dims`, `normalized`, `truncated_from` and `task_prefixes` are equal;
`dtype` may differ. A reader holding a model MAY therefore search an `f32` space and its
`i8` copy with the same query. Spaces that differ in any other field are not comparable:
readers MUST NOT mix scores across incompatible spaces, and MUST NOT compare vectors of
different dimensions. A Matryoshka space (`truncated_from` = 768, `dims` = 256) is
compatible with a query only if the query was truncated to the same dimensions and
renormalized.

<a id="profiles"></a>
## 10. Profiles

`spdf_meta.profile` declares which promises a file makes. Profiles are cumulative labels;
a file lists every profile it satisfies.

| profile | requirements |
|---|---|
| `core` | REQUIRED in every file. All tables of [§3](#schema); at least one unit; every unit, fragment and figure anchored; text in NFC; FTS index in sync. |
| `semantic` | At least one space, and vectors for every fragment in at least one space. A `semantic` file without vectors raises W100. |
| `media` | `kind` is `audio` or `video`; units carry `time` anchors and `t0`/`t1`; `duration` is set; `words` SHOULD be present. A `media` file without time anchors raises W101. |
| `full` | `semantic` and, for audio and video, `media`; for paged kinds, page images (`units.image`) and figures where the original has them. |

Readers MUST NOT refuse a file because of its profile; profiles tell readers what to
expect and validators what to check.

<a id="extensions"></a>
## 11. Extensions

Data that this specification does not define goes into **extension tables** named
`x_<vendor>_<name>` (lowercase ASCII letters, digits and `_`; `<vendor>` is a name the
author controls, e.g. `x_scholaris_claims`). Each extension in use is declared in the
`extensions` table with its `name` (`<vendor>_<name>` or the table prefix), a `version`,
and `required`:

- `required = 0`: readers that do not know the extension ignore it.
- `required = 1`: the file cannot be understood without it; a reader that does not know
  it MUST refuse the file with E060.

Extensions MUST NOT change the meaning of the core tables, MUST NOT add columns to them,
and SHOULD NOT be required. Extension tables are not part of the canonical dump. An
extension that proves useful to several implementations becomes part of the core through
the RFC process ([§23](#versioning)).

<a id="dump"></a>
## 12. Canonical dump

The canonical dump is a JSON view of a file that every implementation produces
identically. It is the oracle of the conformance suite and the input of integrity hashing.

```jsonc
{"spdf_version": "5.0",            // legacy files: "4.0"/"4.1" and "legacy": true
 "meta": {"<key>": "<value>", …},  // every spdf_meta row
 "fts": {"tokenizer": "unicode61 remove_diacritics 2", "trigram": false},
 "document": {"id", "kind", "metadata", "source_sha256", "source_ref", "mime", "bytes",
              "unit_count", "duration", "created", "updated", "title", "authors",
              "year", "language", "rights"},
 "units": [{"id", "ord", "anchor", "text", "notes", "header", "footer", "image",
            "thumbnail", "reader", "confidence", "printed", "t0", "t1", "words"}],
 "sections": [{"id", "parent", "level", "title", "unit_from", "unit_to", "summary"}],
 "fragments": [{"n", "id", "unit", "ord", "text", "context", "section", "anchor",
                "anchor_end", "search_text"}],
 "figures": [{"id", "unit", "image", "caption", "description", "anchor"}],
 "spaces": [{"id", "provider", "model", "version", "dims", "dtype", "normalized",
             "truncated_from", "modalities", "task_prefixes", "created"}],
 "vectors": {"<space id>": {"count": 6, "sha256": "<hex>"}},
 "blobs": [{"key", "mime", "bytes", "sha256"}],
 "provenance": [{"stage", "provider", "model", "detail", "ms", "at"}],
 "extensions": [{"name", "version", "required"}]}
```

Rules:

1. Every member listed is present. SQL NULL becomes `null`; INTEGER a JSON integer; REAL a
   JSON number; TEXT a string. Columns that hold JSON (`metadata`, `rights`, `anchor`,
   `anchor_end`, `notes`, `words`, `section`, `modalities`, `task_prefixes`, `detail`) are
   parsed and embedded as JSON values. The `document` column of child tables is omitted.
   Booleans stored as integers (`normalized`, `required`) stay integers.
2. Every number that is not an integer, including those inside parsed JSON, is rounded to
   6 decimal places (round half to even on its exact binary value); a result of −0 becomes
   0.
3. Order: `units` by `ord`; `fragments` by `n`; `sections`, `figures` and `spaces` by `id`;
   `blobs` by `key`; `extensions` by `name` (code point order, which is SQLite's `BINARY`
   collation over UTF-8); `provenance` by the UTF-8 bytes of the JCS serialization of each
   entry. `fts.trigram` is true if and only if `fragments_fts_trigram` exists;
   `fts.tokenizer` is the value of the `tokenize` option of `fragments_fts` as declared,
   without its quotes and with runs of whitespace collapsed to one space
   (`unicode61 remove_diacritics 2`; `unicode61`, the FTS5 default, if absent).
4. `vectors` has one member per distinct `vectors.space`: `count` is the number of rows and
   `sha256` the hex SHA-256 of their `data` blobs concatenated in order of `target`, then
   `id`.
5. `blobs[].bytes` and `blobs[].sha256` are computed from `data`, not copied from the
   `sha256` column.
6. Serialization, whenever bytes matter (hashing), is JCS [RFC 8785]: no whitespace, object
   members sorted by the UTF-16 code units of their names, numbers in the ECMAScript form
   (`1`, not `1.0`; `0.000001`, not `1e-6`), strings in UTF-8 with only `"`, `\` and
   U+0000–U+001F escaped.

For legacy files the dump is the 5.0 view defined in [§20](#legacy), with the legacy
`spdf_version` and `"legacy": true`.

<a id="integrity"></a>
## 13. Integrity and signatures

`spdf_meta.content_sha256` (OPTIONAL) is the lowercase hex SHA-256 of the JCS
serialization of the canonical dump from which the members `meta.content_sha256`,
`meta.signature` and `meta.signer` have been removed. It covers all content except
extension tables, and it is independent of SQLite's page layout, so two writers that store
the same content produce the same hash.

`spdf_meta.signature` (OPTIONAL, requires `content_sha256` and `signer`) is the standard
base64 encoding, with padding, of an Ed25519 signature [RFC 8032] over the ASCII bytes of
the string `spdf-content-sha256:` followed by the hex `content_sha256`. `spdf_meta.signer`
is `ed25519:` followed by the standard base64 encoding of the 32-byte public key.

Validators that meet `content_sha256` MUST recompute it (E081 on mismatch) and, if a
signature is present, MUST verify it (E082 on failure). A valid signature proves that the
holder of the key produced this content; it says nothing about whether the key is
trustworthy. Readers SHOULD show who signed (the key, or a name the user associated with
it) and MUST NOT present an unknown key as trusted.

<a id="security"></a>
## 14. Security considerations

An SPDF file is a database written by someone else. Opening it is parsing untrusted input
with a complex engine. The threats, and the rules of this specification that answer them:

- **Code in the schema.** Triggers, views and virtual tables can run SQL or call modules
  when the database is used. Files MUST NOT contain them ([§2.1](#container)); readers MUST
  refuse them, open read-only with `query_only`, `trusted_schema = OFF` and the defensive
  flag, and never load extensions ([§2.4](#container)). The legacy FTS triggers are
  tolerated only because they never fire on a read-only connection.
- **Malformed databases.** SQLite is robust against corrupt files but recommends extra
  care for untrusted ones [SQLITE-SECURITY]: disable memory-mapped I/O, enable
  `cell_size_check`, set length limits, consider `quick_check`.
- **Decompression bombs.** Gzip input (legacy) MUST be decompressed with a size limit
  ([§2.3](#container)).
- **Oversized values.** Blobs, texts and JSON values MUST be bounded; JSON parsers SHOULD
  limit nesting depth (RECOMMENDED 64).
- **Query injection.** User text never reaches FTS5 as syntax: every term is a quoted
  FTS5 string ([§8.1](#search)). SQL is always parameterized. Implementations MAY cap the
  number of terms (RECOMMENDED 64) to bound query cost.
- **Paths.** Blob keys are opaque strings, not file names. A reader that extracts blobs to
  disk MUST sanitize them (no absolute paths, no `..`, no device names).
- **Remote references.** `source_ref`, `image`, `thumbnail`, `URL` and `web` anchors may
  point to the network. Readers MUST NOT fetch them automatically: fetching discloses that
  the file was opened and can reach internal services. Fetch only on a user action, and
  show the address first.
- **Active content.** `text` is light Markdown; readers MUST NOT render raw HTML from it,
  and MUST escape text before inserting it into HTML. Images from blobs are untrusted
  input to image decoders; SVG MUST NOT be rendered with scripts enabled.
- **Forged provenance.** Provenance, confidence and metadata are claims made by the
  writer. Only a signature from a trusted key ([§13](#integrity)) attributes them.
- **Model inputs.** Text read from a file may contain instructions aimed at language
  models ("ignore the previous instructions…"). Applications that pass SPDF text to a
  model MUST treat it as data, not as instructions.

<a id="privacy"></a>
## 15. Privacy considerations

- **Vectors can leak text.** Embeddings can be inverted: published attacks reconstruct
  most of a short input from its vector [VEC2TEXT]. Distributing the vectors of a text is
  close to distributing the text. Rights and confidentiality rules that apply to the text
  apply to its vectors ([§16](#rights)); a writer asked to strip the text of a restricted
  document MUST strip its vectors too.
- **Provenance can leak the producer.** Writers SHOULD NOT record local file paths, user
  names, machine names, account identifiers, API keys or prompts containing personal data
  in `provenance.detail` or `generator`.
- **People in documents.** Interviews and recordings name speakers and may contain
  personal data. Producers SHOULD let users remove or pseudonymize `speaker` names, and
  readers SHOULD NOT index speaker names into shared services without consent.
- **Annotations are personal.** User annotations live outside the file, in `.spdfa.json`
  sidecars ([§17](#annotations)), so that sharing a document never shares its reader's
  notes.
- **Opening is observable** only if a reader fetches remote references; see
  [§14](#security).

<a id="rights"></a>
## 16. Rights

`documents.rights` is NULL or a JSON object:

```json
{"license": "CC-BY-4.0", "access": "open", "holder": "Universidad de La Laguna",
 "note": "Text and images under CC BY 4.0; page scans courtesy of the library."}
```

- `license`: an SPDX license identifier or expression [SPDX] (`CC-BY-4.0`,
  `CC0-1.0`), or the URL of a license or rights statement (for the public domain,
  `https://creativecommons.org/publicdomain/mark/1.0/`; for rights statements,
  `http://rightsstatements.org/vocab/InC/1.0/`).
- `access`: `open` (anyone may receive the file), `restricted` (only the audience the
  holder allows: a class, a library), or `private` (personal copy).
- `holder`: the rights holder, or null. `note`: free text.

SPDF does not grant rights. A file made from a copyrighted work is a copy of that work,
including its vectors ([§15](#privacy)). Producers SHOULD fill `rights` when they know
them, SHOULD default `access` to `private` when they do not, and readers SHOULD show
`rights` before sharing a file. Public-domain status depends on jurisdiction; `note` is
the place to say which.

<a id="annotations"></a>
## 17. Annotations and collections

### 17.1 Annotations: `.spdfa.json`

User annotations (highlights, notes, tags) are stored outside the document, in a file
with the extension `.spdfa.json`, as a W3C Web Annotation [WEB-ANNOTATION]
`AnnotationCollection` in JSON-LD:

```json
{"@context": "http://www.w3.org/ns/anno.jsonld",
 "type": "AnnotationCollection", "spdf_annotations": "1.0",
 "label": "Notas de lectura",
 "first": {"type": "AnnotationPage", "items": [
   {"id": "urn:uuid:7b0c…", "type": "Annotation", "motivation": "commenting",
    "created": "2026-10-07T09:00:00Z",
    "body": {"type": "TextualBody", "value": "Origen del tópico.", "format": "text/plain", "language": "es"},
    "target": {"source": "spdf:sha256-3f2a…c9",
               "selector": [
                 {"type": "SpdfAnchorSelector", "value": "spdf:sha256-3f2a…c9#p=29&f=21&char=118,301"},
                 {"type": "TextQuoteSelector", "exact": "En un lugar de la Mancha",
                  "prefix": "", "suffix": ", de cuyo nombre"}]}}]}}
```

`target.source` is the anchor URI without fragment. The `SpdfAnchorSelector` carries the
full anchor URI; the `TextQuoteSelector` [WEB-ANNOTATION] lets the annotation survive a
re-reading that shifts offsets. Readers that cannot resolve the anchor SHOULD fall back to
the quote. The member `spdf_annotations` gives the version of this profile. Selectors of
other types (a `FragmentSelector` conforming to Media Fragments for time and region) MAY
be added for tools that do not know SPDF.

### 17.2 Collections: `.spdfl.json`

A library is a manifest, not a container:

```json
{"spdf_library": "1.0", "name": "Tesis: fuentes", "created": "2026-10-07T00:00:00Z",
 "items": [{"sha256": "3f2a…c9", "title": "El ingenioso hidalgo…", "authors": "Cervantes Saavedra",
            "year": 1605, "url": "https://example.org/quijote.spdf", "file_sha256": "…"}]}
```

`sha256` is the document's `source_sha256` (the identity used by anchor URIs); `url` and
`file_sha256` (SHA-256 of the `.spdf` file bytes) are OPTIONAL and let a reader fetch and
check a copy. Items are ordered as the user ordered them.

JSON Schemas for both sidecars are in [`json-schema/`](json-schema/).

<a id="citation"></a>
## 18. Short citation

`cite(anchor, anchor_end, metadata, locale)` produces an author-date citation in
parentheses, the form most styles share, so that every implementation prints the same
locator. Full bibliographies and other styles are produced from the CSL-JSON item with a
CSL processor ([§19](#exports)).

### 18.1 Citing an anchor

```
( names ", " year [ ", " locator ] ")"
```

The locales `es` and `en` are defined; a locale is matched by its primary language subtag
(`es-ES` → `es`), and any other locale falls back to `en`.

**Names**, from CSL `author`. The name of a person is `literal` if present; otherwise the
`non-dropping-particle`, a space and `family`; otherwise `given`. With one author, that
name; with two, `A y B` (es) or `A and B` (en), where Spanish writes `e` instead of `y`
when the second name begins with the sound /i/ (`i`, `í`, `hi` or `hí` not followed by a
vowel: `Gómez e Iglesias`, `Gómez e Hidalgo`, but `Gómez y Hierro`); with three or more,
`A et al.` in both locales. Without authors, the `title-short`, or else the `title` up to
its first colon, trimmed.

**Year**: the first year of `issued`; negative years are written as `375 a. C.` (es) or
`375 BC` (en). Without a year, `s. f.` (es) or `n.d.` (en). The `spdf.undated` range is
not printed in a short citation.

**Locator**:

| anchor | es | en |
|---|---|---|
| page, folio read | `p. 145` | `p. 145` |
| page, roman folio | `p. xiv` | `p. xiv` |
| page, inferred folio | `p. [21]` | `p. [21]` |
| page without folio | `s. p.` | `n. pag.` |
| page range (end with another folio) | `pp. 145-146`, `pp. 20-[21]` | same |
| leaf / leaf range | `fol. 1r`, `fol. [2v]`, `fols. 1r-[1v]` | same |
| column / column range | `col. 45`, `cols. 45-46` | same |
| time (t0, floor seconds) | `1:09:20`, `0:42` | same |
| time range (end anchor's t1) | `0:12-0:24` | same |
| section or web with `printed` | as a page | as a page |
| section or web | `§ 3.2 El panóptico, párr. 4` | `§ 3.2 El panóptico, para. 4` |
| slide | `diap. 3` | `slide 3` |
| sheet | `Datos, filas 4-9`, `Datos, fila 4` | `Datos, rows 4-9`, `Datos, row 4` |
| verse | `v. 1234`, `vv. 1234-1240` | same |
| canonical | `514a` | same |
| image | (no locator) | (no locator) |

Times are written `h:mm:ss` from one hour on and `m:ss` below (hours are not wrapped:
ground elapsed time `109:24:48`). A range is printed only when both ends have a printed
folio and the folios differ; brackets mark each inferred end separately. An end without
a printed folio never takes part in a range: the citation prints the folio of the other
end alone (`p. 211`, never `pp. s. p.-211`), and `s. p.` / `n. pag.` only when neither end
has one. The locator is omitted when it would be empty, giving `(Hooke, 1665)`.

### 18.2 Citing a passage

A citation MUST locate the passage it quotes, not the fragment that happens to contain
it. `cite_passage(fragment, quote, locale)` cites a quotation taken from a fragment:

1. Split the fragment into its parts: the text of the start unit between the two values
   of `anchor.chars`, and, for a crossing fragment, the text of the end unit
   ([§4.4](#anchors)) between the two values of `anchor_end.chars` (the whole text of a
   unit when `chars` is absent).
2. If the quotation lies in the start part, cite the start unit's anchor, with `chars`
   giving the position of the quotation in that unit. Otherwise, if it lies in the end
   part, cite the end unit's anchor alone, with its `chars`. Otherwise, if it spans both
   parts, cite the range from the start unit's anchor to the end unit's anchor, without
   `chars`, under the range rule above (an end without a folio does not count).
3. The result is the short citation of §18 and the anchor URI of the cited anchor or
   range ([§5](#anchor-uri)).

Readers and citation tools MUST NOT cite a passage with the start `anchor` of its
fragment when the passage is not in the start unit: a quotation from the second page of
a fragment that begins on an unnumbered plate cites the folio of the second page.

<a id="exports"></a>
## 19. Exports

Implementations MUST export CSL-JSON and BibTeX as defined in §19.1 to §19.3, and MAY
export the other formats of §19.4. Exports never invent data: fields absent from the
file are absent from the export. An export takes one or several documents, in order.

### 19.1 Keys

Every exported document gets a key, used as the CSL `id` and as the BibTeX key:

1. Take the first name of the CSL `author` list: its `family`, else its `literal`, else
   its `given`. Fold it: decompose with NFKD, keep only the ASCII letters `A`–`Z` and
   `a`–`z`, lowercase. (`Cervantes Saavedra` → `cervantessaavedra`.)
2. If that is empty (no author, or no ASCII letter in the name), fold in the same way the
   first whitespace-separated word of `title-short`, or of `title` when there is no
   `title-short`. (`Lazarillo de Tormes` → `lazarillo`.)
3. If that is still empty, use `anon`.
4. Append the first year of `issued` in decimal (negative years keep their sign), or
   `nd` when there is none: `cervantessaavedra1605`, `anonnd`.
5. When the same key occurs more than once in one export, every occurrence gets a
   suffix in export order: `a`, `b`, … `z`, `aa`, `ab`…

### 19.2 CSL-JSON

The CSL-JSON export is a JSON array with one item per document: the `metadata` item
without its `spdf` member, with `id` set to the key. It is compared as JSON.

A citation of a passage adds to the item the CSL `label` and `locator` of an anchor and
optional end anchor, so that a CSL processor can print it in any style:

| anchor | `label` | `locator` |
|---|---|---|
| `page`, foliation `page` / `leaf` / `column` | `page` / `folio` / `column` | the folio as in [§18](#citation): `145`, `[21]`, `xiv`, `1r`, ranges `145-146`, `1r-[1v]`; no label or locator when `printed` is null |
| `section` or `web` with `printed` | `page` | as for pages |
| `section` or `web` with `paragraph` | `paragraph` | the paragraph number |
| other `section` or `web` with a path | `section` | the last element of the path |
| `time` | `timestamp` | `1:09:20`, ranges `0:12-0:24` (as in §18) |
| `verse` | `verse` | `1234` or `1234-1240` |
| `canonical` | `section` | the `ref` |
| `sheet` | `line` | `4` or `4-9` |
| `slide`, `image` | none | none (CSL has no slide locator; the short citation of §18 prints it) |

### 19.3 BibTeX

The BibTeX export is text with one entry per document, in export order, separated by
one empty line:

```bibtex
@book{cervantessaavedra1605,
  author = {Cervantes Saavedra, Miguel de},
  title = {{El} ingenioso hidalgo don {Quijote} de la {Mancha}},
  year = {1605},
  publisher = {Juan de la Cuesta},
  address = {Madrid},
  language = {es}
}
```

- **Entry type** from the CSL `type`: `book` → `book`; `article-journal`,
  `article-magazine`, `article-newspaper` → `article`; `chapter` → `incollection`;
  `paper-conference` → `inproceedings`; `thesis` → `phdthesis`; `report` →
  `techreport`; anything else → `misc`.
- **Fields**, in this order, each only when its source is present and not empty:
  `author` (CSL `author`), `editor` (`editor`), `title`, `year` (first year of `issued`),
  `journal` for `article` entries or else `booktitle` (`container-title`), `publisher`,
  `address` (`publisher-place`), `series` (`collection-title`), `volume`, `number`
  (`issue`), `pages` (`page`), `edition`, `doi` (`DOI`), `isbn` (`ISBN`), `url` (`URL`),
  `language`, `note`.
- **Values** are written `{…}` in UTF-8. In every value, `\` becomes `\textbackslash{}`,
  `{` becomes `\{` and `}` becomes `\}`; nothing else is escaped.
- **Names**: a `literal` name is written in braces, `{National Aeronautics and Space
  Administration}`; otherwise the family name (preceded by the `non-dropping-particle`
  and a space, if any) and the `given` name are written `Family, Given`, or in braces
  when only one of them exists. Names are joined with ` and `.
- **Capitals**: in `title` and in `journal`/`booktitle`, every whitespace-separated word
  that contains an uppercase letter (Unicode general category Lu) is wrapped in braces,
  after escaping, so that styles cannot lowercase it: `{El} ingenioso hidalgo don
  {Quijote}`.
- **Comparison**: two exports are equal when, after removing leading and trailing
  whitespace from every line and dropping empty lines, their lines are identical.

### 19.4 Other formats

- **ALTO** [ALTO] (MAY): ALTO 4, one `Page` per page unit, with `PHYSICAL_IMG_NR` =
  `physical` and `PRINTED_IMG_NR` = `printed` only when `printed` is not null and its
  `source` is not `inferred` (ALTO records printed numbers, and an inferred folio is not
  printed); one `TextBlock` per paragraph and one `TextLine` per line; coordinates only
  when the producer has them (from an extension), never invented.
- **TEI** [TEI] (MAY, minimal): `teiHeader` from the metadata (`titleStmt`,
  `publicationStmt` with the rights, `sourceDesc` with the CSL fields), and a `body` with
  a `<pb/>` before each page unit, whose `n` is the folio as cited in §18 without its
  label (`n="ii"`, `n="[iv]"`, `n="1r"`; no `n` for unnumbered pages) and whose `facs`
  is the unit image, if any; `<p>` for paragraphs, `<lg>`/`<l n>` for verse, `<u who>`
  for speaker turns, and `<note place="foot">` for notes.
- **IIIF Presentation 3** [IIIF] (MAY): a `Manifest` with one `Canvas` per unit, in
  `ord` order; the `label` of a page canvas is `{"none": [n]}` with `n` as the TEI `n`,
  and page canvases of unnumbered pages have no `label`; the unit image is the painting
  annotation and the text a `supplementing` annotation; audio and video are one
  time-based canvas with `duration` and a `Range` per unit or section; sections become
  `structures`; anchors with a region become `#xywh=percent:` targets.
- **Web Annotation** (MAY): citations and search results as annotations with the selectors
  of [§17.1](#annotations).

The conformance suite checks, for paged documents, the page sequence of these exports:
the `PHYSICAL_IMG_NR`/`PRINTED_IMG_NR` pairs of ALTO, the `n` of each TEI `pb` and the
`label` of each IIIF page canvas, in order.

<a id="legacy"></a>
## 20. Legacy formats

### 20.1 SPDF 4.0 and 4.1

Scholaris 4.x files MUST be readable by every reader. They are SQLite databases, usually
wrapped in gzip, with Spanish identifiers. Detection, after decompressing: a table `spdf`
(`clave`, `valor`) whose row `spdf_version` starts with `4.`, or `user_version` 400 or
410 together with a table `documentos`. `application_id` is 0. The schema is reproduced
verbatim in [`schema/spdf-4.1.sql`](schema/spdf-4.1.sql) and
[`schema/spdf-4.0.sql`](schema/spdf-4.0.sql) (4.0 lacks `unidades.palabras` and
`fragmentos.texto_busqueda`). Legacy files contain the triggers `fragmentos_ai`,
`fragmentos_ad` and `fragmentos_au`, tolerated by [§2.4](#container).

Readers present legacy files through the **5.0 view**:

- **Tables**: `spdf` → `spdf_meta` (`clave` → `key`, `valor` → `value`), `documentos` →
  `documents`, `unidades` → `units`, `secciones` → `sections`, `fragmentos` →
  `fragments`, `figuras` → `figures`, `espacios` → `spaces`, `vectores` → `vectors`,
  `blobs` → `blobs`, `procedencia` → `provenance`; no extensions.
- **Columns**: `tipo` → `kind`, `metadatos` → `metadata`, `huella` → `source_sha256`,
  `original` → `source_ref`, `unidades` → `unit_count`, `duracion` → `duration`, `creado`
  → `created`, `actualizado` → `updated`, `titulo` → `title`, `autores` → `authors`,
  `anio` → `year`, `idioma` → `language`; `orden` → `ord`, `ancla` → `anchor`, `texto` →
  `text`, `notas` → `notes`, `cabecera` → `header`, `pie` → `footer`, `imagen` → `image`,
  `miniatura` → `thumbnail`, `lector` → `reader`, `confianza` → `confidence`, `impresa`
  → `printed`, `palabras` → `words`; `padre` → `parent`, `nivel` → `level`,
  `unidad_desde` → `unit_from`, `unidad_hasta` → `unit_to`, `resumen` → `summary`;
  `unidad` → `unit`, `contexto` → `context`, `seccion` → `section`, `ancla_fin` →
  `anchor_end`, `texto_busqueda` → `search_text`; in figures `pie` → `caption`,
  `descripcion` → `description`; `proveedor` → `provider`, `modelo` → `model`,
  `normalizado` → `normalized`, `modalidades` → `modalities` (`texto` → `text`, `imagen`
  → `image`); `objetivo` → `target` (`fragmento` → `fragment`, `unidad` → `unit`,
  `figura` → `figure`), `espacio` → `space`, `valores` → `data`; `clave` → `key`,
  `datos` → `data`; `fase` → `stage`, `detalle` → `detail`, `cuando` → `at`.
- **Kinds**: `pdf`, `pdf_escaneado` → `scanned_pdf`, `fotos` → `photos`, `imagen` →
  `image`, `audio`, `video`, `documento` → `document`, `epub`, `presentacion` → `slides`,
  `hoja` → `sheet`, `web`.
- **Anchors**: `tipo` → `type` (`pagina` → `page`, `tiempo` → `time`, `seccion` →
  `section`, `diapositiva` → `slide`, `hoja` → `sheet`, `web`, `imagen` → `image`),
  `fisica` → `physical`, `impresa` → `printed`, `romana` → `roman`, `origen` → `source`
  (`leido` → `read`, `deducido` → `inferred`, `epub`, `ninguno` → `none`), `confianza` →
  `confidence`, `hablante` → `speaker`, `ruta` → `path`, `parrafo` → `paragraph`, `n`,
  `hoja` → `sheet`, `filaDesde` → `row_from`, `filaHasta` → `row_to`, `consultada` →
  `accessed`, `region`. Unknown members are kept as they are.
- **Metadata** (`MetadatosDocumento` → CSL-JSON): `titulo` → `title`, or `"titulo:
  subtitulo"` with `title-short` = `titulo` and `spdf.subtitle` = `subtitulo`;
  `tituloOriginal` → `original-title`; `autores`, `editores`, `traductores`,
  `entrevistadores` (`{nombre, apellidos, orcid}`) → `author`, `editor`, `translator`,
  `interviewer` (`{family: apellidos, given: nombre}`, empty parts omitted; ORCID to
  `spdf.orcid` under `"apellidos, nombre"`); `fecha` → `issued` with its full date parts
  when its year equals `anio` or there is no `anio`, otherwise `anio` → `issued`;
  `anioOriginal` → `original-date`; `editorial` → `publisher`; `lugar` →
  `publisher-place`; `revista`, else `contenedor` → `container-title`; `coleccion` →
  `collection-title`; `volumen` → `volume`; `numero` → `issue`; `paginas` → `page`;
  `edicion` → `edition`; `doi` → `DOI`; `isbn` → `ISBN`; `url` → `URL`; `idioma` →
  `language`; `resumen` → `abstract`; `idiomaOriginal` → `spdf.original_language`;
  `sinFecha` `{desde, hasta, fundamento}` → `spdf.undated` `{from, to, basis}`;
  `procedencia` → `spdf.provenance`, with field names mapped as above and `fuente` →
  `source` (`lectura` → `reading`, `usuario` → `user`, `colofon` → `colophon`,
  `impresores` → `printers`, others unchanged), `confianza` → `confidence`. `tipoCSL` →
  `type`; without it, the type is `article-journal` when `revista` is present, otherwise
  by kind: `audio` and `presentacion` → `speech`, `video` → `motion_picture`, `web` →
  `webpage`, `hoja` → `dataset`, `imagen` and `fotos` → `graphic`, anything else →
  `book`. Empty strings, nulls and empty arrays are omitted.
- **Other rules**: `spdf_meta` keys `creado` → `created` and `generador` → `generator`,
  others unchanged; `documentos.estado` and `documentos.bibliotecas` are dropped; `rights`
  is null; spaces get `dtype` `f32`, `truncated_from` and `task_prefixes` null and
  `created` from `creado`; `provenance.model` is null; blob hashes are computed; units are
  renumbered `ord` = 1, 2, 3… in order of (`orden`, `id`), because 4.x numbers units from
  0; `fragments.ord` keeps `orden`. References in `original`, `imagen` and `miniatura`:
  an empty string becomes null (in figures it stays an empty string), a value equal to a
  key of `blobs` becomes `blob:<key>`, any other value is kept as an opaque reference.

The 4.x anchor has no `foliation`; leaf folios did not exist in 4.x.

### 20.2 SPDF 3.0 and earlier

Scholaris v1 to v3 wrote gzip-wrapped SQLite databases with the tables `metadata` (key,
value, including `schema_version`) and `chunks`, among others. Readers MAY import them;
importing is a conversion with losses (cross-modal links, scenes and some embeddings have
no place in 5.0) and the importer SHOULD report what it dropped. Version 3.0 is documented
historically in the Scholaris repository; this specification does not define it.

<a id="conformance"></a>
## 21. Conformance

### 21.1 Product classes

- A **conforming reader** opens files safely ([§2.4](#container)), reads 5.0 and legacy
  4.x files, produces the canonical dump ([§12](#dump)), parses and formats anchor URIs
  ([§5](#anchor-uri)), produces short citations ([§18](#citation)), runs the reference
  lexical search ([§8.1](#search)) and exports CSL-JSON and BibTeX ([§19](#exports)).
  A **semantic reader** also runs the reference vector and hybrid search.
- A **conforming writer** produces files that validate without errors or warnings for
  the profiles they declare and whose canonical dump equals the dump the writer was given
  (round trip).
- A **conforming validator** reports exactly the codes of [§22](#validation) for the
  validation cases of the suite.

### 21.2 Levels

An implementation states its class and the profiles it covers, for example "reader and
writer, profiles core and semantic". Its claim is backed by the conformance suite: it
passes every case of the kinds its class requires (`dump`, `legacy_dump`, `anchor_uri`,
`cite`, `cite_passage`, `search_lexical`, `validate`, `locate`, `export_csl`,
`export_bibtex` for readers; plus `search_vector` and `search_hybrid` for semantic readers; plus `roundtrip`
and `quantize` for writers; `export_structure` for implementations that export ALTO, TEI
or IIIF), with the suite
version it was tested against. Partial implementations MAY exist but MUST NOT call
themselves conforming.

### 21.3 The suite

The suite (`conformance/` in the repository) is normative for behaviour. Its protocol
(case format, runner report, CI convention) is in `conformance/README.md`. Each suite
release has a version and a manifest with the number of cases and their hash.

<a id="validation"></a>
## 22. Validation

### 22.1 Procedure

A validator checks a file in this order; a step marked *stop* ends validation:

1. If the file starts with `1F 8B`, decompress it ([§2.3](#container)).
2. If the result is not a SQLite database: E001, *stop*.
3. Determine the version: `application_id` 1397769286 with `user_version` 500–599 is
   5.x; the legacy detection of [§20.1](#legacy) is 4.x; anything else: E002, *stop*.
   For 4.x, report W110 and check only: the tables `spdf`, `documentos`, `unidades`,
   `fragmentos`, `fragmentos_fts` exist (E010 each) and there is no trigger or view other
   than the three tolerated triggers (E020); *stop*.
4. A gzip-wrapped 5.x file: E003 in the warnings. A minor version above 0: W105; for
   such a file, unknown anchor types (E041) and unknown dtypes (E032) are reported in
   the warnings instead of the errors, because a later minor version may define them.
5. Triggers, views and foreign virtual tables: E020 for each.
6. Required tables (E010 each) and required columns (E011 each).
7. `spdf_meta` keys (E012 each).
8. `documents` holds exactly one row (E013); `metadata` and `rights` are valid JSON
   (E050); `metadata` has string `type` and `title` (E051).
9. Required extensions unknown to the validator (E060).
10. `units.ord` is 1…N (E090); `unit_count` equals N (W102).
11. Anchors of units, fragments (start and end) and figures (E040, E041, E042);
    fragments that cross `matter` or a folio boundary (W103, [§4.4](#anchors)).
12. Spaces: `dtype` (E032). Vectors: known space (E031), length (E030).
13. FTS index in sync: run `INSERT INTO fragments_fts(fragments_fts, rank)
    VALUES('integrity-check', 1)` (and the same on `fragments_fts_trigram`) on a private
    copy; an error is E070.
14. Blobs: stored `sha256` equals the computed one (E080).
15. If there were no errors so far and `content_sha256` is present: recompute it (E081);
    if it matches and `signature` is present, verify it (E082).
16. Profile warnings: W100, W101.

The result is a JSON object (schema in [`json-schema/validation-result.schema.json`](json-schema/validation-result.schema.json)):

```json
{"valid": false, "version": "5.0", "profile": ["core"],
 "errors": [{"code": "E090", "message": "units.ord is not 1..N", "where": "units"}],
 "warnings": []}
```

`valid` is true if and only if `errors` is empty. `version` is null when unknown.
Messages are free text; conformance compares the sets of codes.

### 22.2 Codes

| code | meaning |
|---|---|
| E001 | not a SQLite database (or bad gzip) |
| E002 | unknown `application_id` or version |
| E003 | gzip-wrapped 5.0 file (reported as a warning) |
| E010 | missing required table |
| E011 | missing required column |
| E012 | missing required `spdf_meta` key |
| E013 | `documents` does not hold exactly one row |
| E020 | trigger, view or foreign virtual table present |
| E030 | vector length ≠ dims × dtype size |
| E031 | vector refers to an unknown space |
| E032 | unknown dtype |
| E040 | invalid anchor (bad JSON, missing or mistyped required member) |
| E041 | unknown anchor type |
| E042 | `chars` out of range |
| E050 | invalid metadata or rights JSON |
| E051 | metadata without string `type` and `title` |
| E060 | unknown required extension |
| E070 | FTS index out of sync |
| E080 | blob sha256 mismatch |
| E081 | `content_sha256` mismatch |
| E082 | signature does not verify |
| E090 | `units.ord` not contiguous from 1 |
| W100 | profile `semantic` without vectors |
| W101 | profile `media` without time anchors |
| W102 | `unit_count` ≠ number of units |
| W103 | fragment crosses between units of different `matter`, or between a page with a printed folio and one without |
| W105 | newer minor version than the validator's |
| W110 | legacy 4.x file |

Codes are never reused with another meaning. New codes are added by minor versions.

<a id="versioning"></a>
## 23. Versioning and compatibility

The specification is versioned MAJOR.MINOR; editorial corrections do not change the
version. `user_version` encodes it ([§2.1](#container)).

- A **minor** version (5.1, 5.2…) only adds OPTIONAL things: tables, columns, `spdf_meta`
  keys, anchor members or types, metadata members, validation warnings or errors for
  things that were already forbidden. A 5.0 reader reads every 5.x file, ignoring what it
  does not know; it MAY warn (W105). Validators report the anchor types and dtypes of a
  newer minor version as warnings, not errors ([§22.1](#validation)). A 5.x writer that
  uses nothing new SHOULD write `user_version` 500.
- A **major** version (6.0) may change or remove things. Readers MUST refuse majors they
  do not know (E002) and SHOULD keep reading older majors (as 5.0 reads 4.x).
- **Deprecation**: a feature is deprecated in a minor version, with the reason and the
  replacement, and removed no earlier than the next major and at least 24 months later.
- **Promise**: a file that conforms to 5.0 will be readable by every conforming reader of
  any later 5.x version, and its anchor URIs will keep resolving.
- The conformance suite and each library have their own version numbers; the suite's
  manifest says which specification version it tests.

Changes are proposed and decided through the RFC process in `spec/rfcs/` and
`governance/`.

<a id="media-type"></a>
## 24. Media type and file identification

- Media type: `application/vnd.spdf+sqlite3` (registration with IANA in preparation; template in
  `governance/drafts/iana-media-type.md`). The structured syntax suffix `+sqlite3` tells
  generic tools that the file is a SQLite 3 database. OPTIONAL parameter `version`
  (`"5.0"`). Encoding: binary. Legacy 4.x files are gzip data and have no registered type
  of their own.
- Fragment identifiers: for a resource of type `application/vnd.spdf+sqlite3`, the fragment
  identifier is the `params` rule of [§5.1](#anchor-uri), with the meaning it has in an
  anchor URI for the document in that resource:
  `https://example.org/quijote.spdf#p=5&f=1r`.
- Extension: `.spdf`. Sidecars: `.spdfa.json` and `.spdfl.json`, served as
  `application/json` (or `application/ld+json` for annotations).
- Magic numbers: bytes 0–15 are `53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33 00`
  ("SQLite format 3" and a NUL); bytes 68–71 are `53 50 44 46` ("SPDF"); bytes 60–63 hold
  `user_version` big-endian (`00 00 01 F4` for 5.0). Legacy 4.x files start with `1F 8B`
  and cannot be told from other gzip files without decompressing.
- Uniform Type Identifier (Apple platforms): `com.joseluissaorin.spdf`, conforming to
  `public.data` and `public.database`, until a vendor-neutral identifier is agreed.

<a id="i18n"></a>
## 25. Internationalization

### 25.1 Languages and scripts

Language tags are BCP 47 [BCP 47]: `es`, `en-GB`, `la`, `grc` (Ancient Greek), `lzh`
(Literary Chinese), `ar`. `documents.language` is the main language; fragments in other
languages need no tagging in this version. Text is stored in logical order, whatever its
direction.

### 25.2 Right-to-left text

Arabic, Hebrew, Syriac and other right-to-left scripts are stored in logical order,
without bidirectional control characters except those present in the source. Readers
display them with the Unicode Bidirectional Algorithm [UAX #9] and SHOULD isolate
user-supplied strings (`dir="auto"`). Anchor URIs percent-encode such text, so they are
direction-neutral; when an IRI form is displayed, readers SHOULD isolate it. `chars`
offsets count code points in logical order.

### 25.3 Old texts

The `text` of a unit or fragment is the text of the source, never modernized: long s
(`ſ`), `u`/`v` and `i`/`j` alternations, abbreviations and tildes stay as printed. The
`search_text` layer carries a modernized form used only by search. The `unicode61`
tokenizer with `remove_diacritics 2` already folds case, Latin diacritics and `ſ`; it does
not fold Greek accents and breathings, ligatures such as `æ` and `œ`, or `ß`, so producers
SHOULD put the folded forms they need in `search_text` (for polytonic Greek, the text
without diacritics). Citations quote `text`, never `search_text`.

### 25.4 Chinese, Japanese and Korean

The `unicode61` tokenizer treats a run of Han characters as one token. Files whose text is
mostly CJK SHOULD include `fragments_fts_trigram`; the reference search then matches
substrings of three or more characters by trigram and shorter ones by substring
([§8.1](#search)). Producers MAY add a segmented form (words separated by spaces) to
`search_text`.

### 25.5 Numbers and folios

Printed folios are stored as printed, in any script (`"xiv"`, `"٣٤"`, `"三"`). Readers
MUST NOT convert them for citation; they MAY offer conversions for navigation.

<a id="references"></a>
## References

### Normative

- [BCP 47] Phillips, A., Davis, M., "Tags for Identifying Languages", BCP 47, RFC 5646.
- [COMMONMARK] CommonMark Spec, version 0.31.2, <https://spec.commonmark.org/0.31.2/>.
- [CSL-JSON] Citation Style Language, CSL-JSON schema, <https://github.com/citation-style-language/schema>.
- [MEDIA-FRAGMENTS] W3C, "Media Fragments URI 1.0 (basic)", Recommendation, 2012.
- [RFC 1952] Deutsch, P., "GZIP file format specification version 4.3".
- [RFC 2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels".
- [RFC 3986] Berners-Lee, T., et al., "Uniform Resource Identifier (URI): Generic Syntax".
- [RFC 3987] Duerst, M., Suignard, M., "Internationalized Resource Identifiers (IRIs)".
- [RFC 5147] Wilde, E., Duerst, M., "URI Fragment Identifiers for the text/plain Media Type".
- [RFC 5234] Crocker, D., Overell, P., "Augmented BNF for Syntax Specifications: ABNF".
- [RFC 8032] Josefsson, S., Liusvaara, I., "Edwards-Curve Digital Signature Algorithm (EdDSA)".
- [RFC 8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words".
- [RFC 8259] Bray, T., "The JavaScript Object Notation (JSON) Data Interchange Format".
- [RFC 8785] Rundgren, A., et al., "JSON Canonicalization Scheme (JCS)".
- [SQLITE-FORMAT] SQLite, "Database File Format", <https://www.sqlite.org/fileformat.html>.
- [SQLITE-FTS5] SQLite, "SQLite FTS5 Extension", <https://www.sqlite.org/fts5.html>.
- [UAX #15] Unicode Standard Annex #15, "Unicode Normalization Forms".
- [WEB-ANNOTATION] W3C, "Web Annotation Data Model", Recommendation, 2017.

### Informative

- [ALTO] Library of Congress, "ALTO: Technical Metadata for Layout and Text Objects", version 4.
- [CTS] "Canonical Text Services" protocol and URN scheme, <http://cite-architecture.github.io/>.
- [IIIF] IIIF Consortium, "IIIF Presentation API 3.0".
- [MRL] Kusupati, A., et al., "Matryoshka Representation Learning", NeurIPS 2022.
- [RFC 6838] Freed, N., Klensin, J., Hansen, T., "Media Type Specifications and Registration Procedures".
- [RFC 7595] Thaler, D., et al., "Guidelines and Registration Procedures for URI Schemes".
- [RRF] Cormack, G. V., Clarke, C. L. A., Büttcher, S., "Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods", SIGIR 2009.
- [SPDX] SPDX License List, <https://spdx.org/licenses/>.
- [SQLITE-SECURITY] SQLite, "Defense Against The Dark Arts", <https://www.sqlite.org/security.html>.
- [TEI] TEI Consortium, "TEI P5: Guidelines for Electronic Text Encoding and Interchange".
- [UAX #9] Unicode Standard Annex #9, "Unicode Bidirectional Algorithm".
- [VEC2TEXT] Morris, J. X., et al., "Text Embeddings Reveal (Almost) As Much As Text", EMNLP 2023.

<a id="changes"></a>
## Appendix A. Changes from SPDF 4.1

- Uncompressed container with `application_id` and `user_version`; gzip only for legacy.
- English identifiers; legacy files read through the 5.0 view.
- Metadata as a CSL-JSON item with the `spdf` extension object.
- New anchor types `verse` and `canonical`; `foliation` (leaves and columns); `chars` and
  `region` on any anchor.
- Anchor URI with ABNF, aligned with W3C Media Fragments and RFC 5147.
- `spaces.dtype` (`f32`, `f16`, `i8`), `truncated_from`, `task_prefixes`; space
  compatibility.
- Profiles, extensions, `rights`, blob hashes, provenance `model`.
- No triggers or views in distributed files; safe opening procedure.
- Canonical dump, integrity hash and Ed25519 signatures.
- Units numbered from 1.
- Removed: `documentos.estado` and `documentos.bibliotecas` (library membership belongs
  to collection manifests).
