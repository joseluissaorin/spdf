# SPDF: Semantic Processed Document Format

SPDF is an open file format for documents that have been **read once and can be cited
forever**. A `.spdf` file holds the text of one book, article, scan, recording, slide
deck or web page, split into citable units and searchable passages, and every passage
carries its exact anchor: the printed page or leaf, the second of a recording, the slide,
the verse, the canonical reference. A citation produced from an SPDF file can only print
what the source says.

- **Specification:** [`spec/SPEC.md`](spec/SPEC.md) (version 5.0, working draft), with a
  faithful Spanish translation in [`spec/SPEC.es.md`](spec/SPEC.es.md).
- **Conformance suite:** [`conformance/`](conformance/), the cases every implementation
  passes, generated from public-domain texts by a deterministic oracle.
- **Website:** <https://spdf.joseluissaorin.com> (documentation, validator in the browser,
  web reader).
- **License:** specification and documentation under CC BY 4.0; code under MIT OR
  Apache-2.0, at your option; contributors do not assert patents against implementations.

## Why

A citation is a promise that a passage is where the reference says it is. Scholarly tools
usually keep a PDF and hope the page numbers can be recovered; recordings, slides and
scanned books fare worse. Reading a document well (vision models, speech recognition,
human correction, page numbers checked against the printed folios) is expensive, so it
should happen once and the result should be kept in an open, durable, portable form.

SPDF is that form:

- **Anchors first.** Physical page and printed folio (roman, inferred `[21]`, leaves
  `fol. 1r`, columns), time with speaker and per-word timings, sections and paragraphs,
  slides, sheet rows, verses and canonical references (Stephanus, Bekker, CTS). Anchors
  have a URI form aligned with W3C Media Fragments:
  `spdf:sha256-fa38…4c75#p=5&pe=6&f=1r&fe=1v&char=101,278`.
- **Plain SQLite.** One uncompressed SQLite 3 file, `application_id` "SPDF". Any language
  with SQLite opens it; readers can memory-map it or fetch it by HTTP ranges. No code in
  the file: no triggers, no views, read-only, defensive opening.
- **CSL-JSON metadata.** The document is described as a CSL-JSON item, so Zotero,
  citeproc and Pandoc understand it, with provenance and confidence per field.
- **Search built in.** An FTS5 index with tokenizers that every SQLite ships
  (`unicode61 remove_diacritics 2`, and `trigram` for Chinese, Japanese and Korean), a
  modernized-spelling layer that finds `así` in `aſsi` without ever quoting it, and
  optional embedding vectors from several models side by side (f32, f16, i8).
- **Honest citations.** Reference rules for a short citation, `(Cervantes Saavedra, 1605,
  fols. 1r-[1v])`, that every implementation prints identically, and exports to CSL-JSON,
  BibTeX, IIIF, TEI, ALTO and W3C Web Annotation.

## A look inside

```sh
$ sqlite3 -readonly conformance/files/quijote.spdf
sqlite> SELECT value FROM spdf_meta WHERE key = 'profile';
core
sqlite> SELECT ord, printed, json_extract(anchor, '$.source') FROM units LIMIT 6;
1||none
2|ii|read
3|iii|read
4|iv|inferred
5|1r|read
6|1v|inferred
sqlite> SELECT f.id, bm25(fragments_fts, 1.0, 0.5, 0.5, 1.0) AS r
   ...>   FROM fragments_fts JOIN fragments f ON f.n = fragments_fts.rowid
   ...>  WHERE fragments_fts MATCH '"lanza" OR "astillero"' ORDER BY r, f.n;
q4|-2.04469086337754
```

The same query through any library returns the fragment, its anchor, its anchor URI and
the citation `(Cervantes Saavedra, 1605, fols. 1r-[1v])`.

## Repository map

| Folder | What |
|---|---|
| [`spec/`](spec/) | the specification (English and Spanish), SQL schemas (5.0 and the legacy 4.1/4.0, verbatim), JSON Schemas, examples, RFCs |
| [`conformance/`](conformance/) | the conformance suite: sources, files, legacy and invalid files, expected dumps, cases, generator and checker |
| [`governance/`](governance/) | RFC process, versioning and deprecation policy, governance, drafts for IANA, PRONOM, the Library of Congress, the SQLite magic file and a W3C Community Group |
| [`rust/`](rust/) | reference implementation (crate `spdf`) and the C ABI |
| [`js/`](js/) | TypeScript for Node (`node:sqlite`) and browsers (`@sqlite.org/sqlite-wasm`), npm `spdf-format` |
| [`python/`](python/) | Python, PyPI `spdf-format` (imported as `spdf`), standard `sqlite3` only |
| [`go/`](go/), [`swift/`](swift/), [`kotlin/`](kotlin/), [`dotnet/`](dotnet/) | Go, Swift, Kotlin/JVM and C# implementations |
| [`php/`](php/), [`ruby/`](ruby/), [`r/`](r/), [`julia/`](julia/), [`c/`](c/) | second-tier implementations |
| [`producer/`](producer/) | `spdf build`, the reference producer (reads PDFs, scans, audio and video; local models or your own API key) |
| [`reader/`](reader/) | SPDF Reader, a free reader for desktop, mobile and the web |
| [`models/`](models/) | model recipes for local inference (embeddings, page reading, judging) |
| [`site/`](site/), [`integrations/`](integrations/) | the website and integrations with other tools |

## Implementation status

Every implementation runs the whole conformance suite in its own workflow and uploads its
report as the artifact `conformance-<folder>`. The badges show the last run on `main`.

| Implementation | Package | Tier | CI |
|---|---|---|---|
| Rust (reference, C ABI) | crate `spdf` | 1 | [![rust](https://github.com/joseluissaorin/spdf/actions/workflows/rust.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/rust.yml) |
| TypeScript | npm `spdf-format` | 1 | [![js](https://github.com/joseluissaorin/spdf/actions/workflows/js.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/js.yml) |
| Python | PyPI `spdf-format` | 1 | [![python](https://github.com/joseluissaorin/spdf/actions/workflows/python.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/python.yml) |
| Swift | SwiftPM | 1 | [![swift](https://github.com/joseluissaorin/spdf/actions/workflows/swift.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/swift.yml) |
| Kotlin / JVM | Maven `io.github.joseluissaorin:spdf` | 1 | [![kotlin](https://github.com/joseluissaorin/spdf/actions/workflows/kotlin.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/kotlin.yml) |
| Go | `github.com/joseluissaorin/spdf/go` | 1 | [![go](https://github.com/joseluissaorin/spdf/actions/workflows/go.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/go.yml) |
| C# | NuGet `Spdf.Format` | 1 | [![dotnet](https://github.com/joseluissaorin/spdf/actions/workflows/dotnet.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/dotnet.yml) |
| PHP | Composer `joseluissaorin/spdf` | 2 | [![php](https://github.com/joseluissaorin/spdf/actions/workflows/php.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/php.yml) |
| Ruby | gem `spdf-format` | 2 | [![ruby](https://github.com/joseluissaorin/spdf/actions/workflows/ruby.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/ruby.yml) |
| R | `spdf` | 2 | [![r](https://github.com/joseluissaorin/spdf/actions/workflows/r.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/r.yml) |
| Julia | `SPDF.jl` | 2 | [![julia](https://github.com/joseluissaorin/spdf/actions/workflows/julia.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/julia.yml) |
| C | via the Rust C ABI | 2 | [![c](https://github.com/joseluissaorin/spdf/actions/workflows/c.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/c.yml) |
| Producer `spdf build` | PyPI | | [![producer](https://github.com/joseluissaorin/spdf/actions/workflows/producer.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/producer.yml) |
| Conformance suite | | | [![conformance](https://github.com/joseluissaorin/spdf/actions/workflows/conformance.yml/badge.svg)](https://github.com/joseluissaorin/spdf/actions/workflows/conformance.yml) |

Two independent producers (`spdf build` and Scholaris) writing files that every reader
accepts is a requirement for calling the format 1.0-stable in practice; the specification
version (5.0) and the library versions are numbered independently.

## Legacy

Every conforming reader also reads the Scholaris 4.0 and 4.1 files (gzip-wrapped SQLite
with Spanish identifiers) through a 5.0 view; see [SPEC §20](spec/SPEC.md#legacy).

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md). Changes to the format go through an RFC
([`governance/RFC-PROCESS.md`](governance/RFC-PROCESS.md)); an accepted RFC lands with at
least one conformance case and counts as implemented when two independent implementations
pass it. Security reports: [`SECURITY.md`](SECURITY.md). Code of conduct:
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). To cite the specification, see
[`CITATION.cff`](CITATION.cff).

SPDF was born in Scholaris, written by José Luis Saorín Ferrer, who edits the
specification. *La especificación está también en español:
[`spec/SPEC.es.md`](spec/SPEC.es.md).*
