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
  `spdf:sha256-27ea…cb60#p=29&pe=30&f=Ir&fe=Iv&char=729,745`.
- **Plain SQLite.** One uncompressed SQLite 3 file, `application_id` "SPDF". Any language
  with SQLite opens it; readers can memory-map it or fetch it by HTTP ranges. No code in
  the file: no triggers, no views, read-only, defensive opening.
- **CSL-JSON metadata.** The document is described as a CSL-JSON item, so Zotero,
  citeproc and Pandoc understand it, with provenance and confidence per field.
- **Search built in.** An FTS5 index with tokenizers that every SQLite ships
  (`unicode61 remove_diacritics 2`, and `trigram` for Chinese, Japanese and Korean), a
  modernized-spelling layer that finds `así` in `aſsi` without ever quoting it, and
  optional embedding vectors from several models side by side (f32, f16, i8).
- **Honest citations.** Reference rules for a short citation, `(Cervantes Saavedra, 1608,
  fols. Ir-[Iv])`, that every implementation prints identically; a quotation is cited by
  the page it is on, never by where its passage happens to start, and exports to CSL-JSON,
  BibTeX, IIIF, TEI, ALTO and W3C Web Annotation.

## A look inside

```sh
$ sqlite3 -readonly conformance/files/quijote.spdf
sqlite> SELECT value FROM spdf_meta WHERE key = 'profile';
core
sqlite> SELECT ord, printed, json_extract(anchor, '$.source'), json_extract(anchor, '$.matter') FROM units;
1||none|front
2||none|front
3|Ir|read|body
4|Iv|inferred|body
5|2r|read|body
sqlite> SELECT f.id, bm25(fragments_fts, 1.0, 0.5, 0.5, 1.0) AS r
   ...>   FROM fragments_fts JOIN fragments f ON f.n = fragments_fts.rowid
   ...>  WHERE fragments_fts MATCH '"lanza" OR "astillero"' ORDER BY r, f.n;
q4|-3.73895696145584
```

The fragment found is the 1608 text as printed, «EN Vn lugar de la Mãcha, de cuyo nombre
no quiero acordarme, no ha mucho tiempo que viuia vn hidalgo de los de lança en
aſtillero…»: the modern words of the query match through its modernized search layer.
The same query through any library returns the fragment, its anchor URI
(`spdf:sha256-27ea…cb60#p=29&f=Ir&char=168,345`) and the citation
`(Cervantes Saavedra, 1608, fol. Ir)`.

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

## Product classes and status

Conformance classes are defined in [SPEC §21](spec/SPEC.md#conformance): a **reader**
passes `dump`, `legacy_dump`, `anchor_uri`, `cite`, `search_lexical`, `validate`,
`locate`, `export_csl` and `export_bibtex`; a **semantic reader** also passes
`search_vector` and `search_hybrid`; a **writer** passes `roundtrip` and `quantize`; a
**validator** passes `validate`; `export_structure` covers the ALTO, TEI and IIIF exports.
The table is built from the CI artifacts `conformance-<folder>` (state on 2026-10-07, 12:15).
The class columns give the result against suite 0.3.0, whose reader class did not yet
include `locate` and the exports; suite 0.4.0, which adds them, is pending everywhere
until each folder's CI runs it.

<!-- product-status:start -->
| Implementation | Folder | Reader | Semantic reader | Writer | Validator | ALTO / TEI / IIIF | Suite 0.3.0 | Suite 0.4.0 |
|---|---|---|---|---|---|---|---|---|
| Rust (reference) | `rust` | yes | yes | yes | yes | untested | 229/229 | pending |
| TypeScript | `js` | yes | yes | yes | yes | untested | 229/229 | 309/309 |
| Python | `python` | yes | yes | yes | yes | untested | 229/229 | pending |
| Swift | `swift` | yes | yes | yes | yes | untested | 229/229 | pending |
| Kotlin / JVM | `kotlin` | yes | yes | yes | yes | untested | 229/229 | pending |
| Go | `go` | yes | yes | yes | yes | untested | 229/229 | pending |
| C# | `dotnet` | yes | yes | yes | yes | untested | 229/229 | pending |
| PHP | `php` | yes | yes | yes | yes | untested | 229/229 | 309/309 |
| Ruby | `ruby` | yes | yes | yes | yes | untested | 229/229 | 309/309 |
| R | `r` | yes | yes | yes | yes | untested | 229/229 | 309/309 |
| Julia | `julia` | yes | yes | yes | yes | untested | 229/229 | 309/309 |
| C (Rust C ABI) | `c` | yes | yes | yes | yes | untested | 229/229 | 309/309 |
| Producer `spdf build` | `producer` | n/a | n/a | outputs validate | n/a | n/a | own checks 16/16 | pending |
<!-- product-status:end -->

TypeScript also passes suite 0.4.1 (341/341, artifact `conformance-js`); the other
implementations have been told to run it.

Values: `yes` (every case of the class passes), `untested` (no case yet), `pending`
(the suite version has not run yet), `no`, `n/a`. A cell changes only when the CI artifact of that folder says so.

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
