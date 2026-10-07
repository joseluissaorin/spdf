# Format description: SPDF (Semantic Processed Document Format), version 5.0

> **Borrador sin enviar.** Propuesta de ficha de formato (Format Description Document)
> para *Sustainability of Digital Formats: Planning for Library of Congress
> Collections*, de la Library of Congress. Sigue la estructura de las fichas
> publicadas (comprobada el 7-10-2026 sobre la de SQLite 3, fdd000461, y las
> explicaciones de términos del sitio). Las fichas las redacta y publica el equipo de
> formatos de la Library of Congress; esto es una sugerencia para que la valoren, no un
> texto que vayan a copiar tal cual.
>
> Vía: la página de contacto del sitio de formatos
> (<https://www.loc.gov/preservation/digital/formats/contact_format.shtml>), que enlaza
> la propia ficha de SQLite; el canal concreto (formulario o correo) está por verificar
> al enviarla.
>
> Falta antes de enviarla:
>
> 1. Una versión final, o al menos fechada, de la especificación. Hoy la web la sirve
>    en `https://spdf.joseluissaorin.com/spec` como borrador de trabajo (comprobado el
>    7-10-2026).
> 2. Registro en IANA (`application/vnd.spdf+sqlite3`) y ficha en PRONOM, para poder citarlos
>    aquí; hoy figuran como pendientes.
> 3. Más adopción. La ficha es honesta: hoy el formato lo usa sobre todo el proyecto de
>    su autor, y la Library of Congress puede decidir esperar. Conviene enviarla cuando
>    haya al menos un productor o un usuario institucional ajeno al proyecto.
>
> Por verificar: el nombre corto que asignarían (aquí `SPDF_5_0`), las facetas y los
> identificadores de ficha de los formatos relacionados que no son SQLite, JSON ni
> GeoPackage (TEI, ALTO, IIIF y W3C Web Annotation no aparecen en la lista de fichas
> consultada).

---

## Format description properties

| Property | Value |
|---|---|
| ID | to be assigned |
| Short name | SPDF_5_0 (proposed) |
| Content categories | text, dataset |
| Format category | file-format |
| Other facets | unitary, binary, structured |
| Draft status | Preliminary (proposed) |

## Identification and description

| | |
|---|---|
| Full name | SPDF (Semantic Processed Document Format), version 5.0 |
| Description | SPDF is an open file format for documents that have been read once, by a PDF text layer, optical character recognition, a vision model, a speech recognizer or by hand, and stored so that every passage can be cited with its exact location in the source. A file is a SQLite 3 database (see SQLite_3) holding exactly one document: a bibliographic record as a CSL-JSON item; citable units in reading order (pages or leaves, time spans, slides, sections, spreadsheet rows) with their text in Unicode NFC and a JSON "anchor" giving the physical page and printed folio, leaf or column, verse, canonical reference, time range or slide; passages of about 150 to 300 words indexed for full-text search with the SQLite FTS5 module; and, optionally, section structure, figures with regions, embedding vectors from one or more models, provenance records, rights information, and the original file and page images as embedded binary objects. The SQLite header identifies the format: `application_id` "SPDF" at byte offset 68 and the version (500 for 5.0) at offset 60. A portable URI syntax (`spdf:sha256-…#p=29&f=21`) addresses any passage independently of the file's location. |
| Production phase | Generally a middle- or final-state derivative: produced from an original (a printed book, a scan, a born-digital PDF, an EPUB, a recording, a slide deck, a web page) to make it searchable and citable. It does not replace the original, which it may embed or reference by its SHA-256 hash. |
| Relationship to other formats | |
| Subtype of | SQLite_3, SQLite, Version 3 (fdd000461) |
| Has earlier version | SPDF 4.0 and 4.1 (no FDD): gzip-compressed SQLite databases with Spanish identifiers, internal to the Scholaris application; readers of 5.0 must read them |
| May contain | JSON (fdd000381), in text columns (anchors, metadata, rights, provenance); embedded objects in their own formats (for example PNG or JPEG page images, the original PDF, EPUB, audio or video) |
| Affinity to | GeoPackage_1_0 (fdd000419), another application format built on SQLite and identified by its `application_id`; TEI P5, ALTO and IIIF Presentation API 3.0, to which SPDF content can be exported; W3C Web Annotation, used by SPDF's annotation sidecar files (`.spdfa.json`); CSL-JSON, used for its metadata |

## Local use

| | |
|---|---|
| LC experience or existing holdings | None known (for the Library of Congress to complete). |
| LC preference | None (for the Library of Congress to complete). |

## Sustainability factors

| Factor | Assessment |
|---|---|
| Disclosure | Fully documented, open specification, edited by José Luis Saorín Ferrer and published under the Creative Commons Attribution 4.0 licence, with a faithful Spanish translation. Version 5.0 is a working draft (first published 2026-10-07); changes go through a public request-for-comments process. |
| Documentation | *SPDF: Semantic Processed Document Format, version 5.0* (specification, SQL schemas, JSON Schemas); a public conformance suite with expected results for reading, validating, searching, building anchor URIs and citing. |
| Adoption | Very low as of October 2026. The format was created for the Scholaris citation application of the same author, whose earlier versions (4.0, 4.1) are internal to it. Libraries for version 5.0 in Rust, TypeScript, Python, Go, Swift, PHP and Ruby report passing the whole conformance suite; Kotlin, C#, R and Julia libraries, a reference producer and a free reader application are in development in the same project. No use by memory institutions or by unrelated producers is known yet. |
| Licensing and patents | Specification under CC BY 4.0. Reference code under MIT or Apache License 2.0. The author and every contributor to the specification commit not to assert patents against implementations. The underlying SQLite format and library are in the public domain. No patents are known to apply. |
| Transparency | High for the structure and text: any SQLite tool (for example the `sqlite3` command-line shell) can list the tables and read the text, which is UTF-8 in NFC, with JSON in text columns and light Markdown in unit text. Embedding vectors are little-endian binary arrays whose meaning depends on the model named in the file; they are derived data and can be recomputed. Embedded images and originals keep their own formats. Legacy 4.x files must be decompressed (gzip) before inspection. |
| Self-documentation | Strong. The file records its format version and generator, a CSL-JSON bibliographic record with the source and confidence of each field, the SHA-256, media type and size of the original, rights (SPDX licence identifier, access level, holder), which reader produced the text of each unit and with what confidence, how each folio was obtained (read from the page or inferred), which model produced each set of vectors, and a provenance log of the processing stages. An optional content hash and Ed25519 signature allow checking the content and who vouched for it. |
| Accessibility features | The format provides a text layer for scanned and image-only sources, reading order, section headings, footnotes separated from the main text, figure captions and descriptions, and time-aligned transcripts of recordings with speaker names and word timings, which support screen readers, search and captions. Tables can be written as Markdown tables in the unit text; there is no layout tagging comparable to tagged PDF. |
| External dependencies | A SQLite library (widely available on all platforms) with the FTS5 module for search; no other software is required to read the text and metadata. Semantic search requires the embedding model named in the file to encode queries; the file remains fully readable without it. When the original is not embedded, it is referenced by URL or hash and must be preserved separately. |
| Technical protection considerations | None. The format defines no encryption or access control; an encrypted SQLite database is not a valid SPDF file. The optional Ed25519 signature provides integrity and attribution, not protection. A `rights` object states the licence and the intended access level for information only. |

## Quality and functionality factors

| Category | Factor | Assessment |
|---|---|---|
| Text | Normal rendering | Unit text in reading order, as light Markdown (CommonMark subset), suitable for linear reading, quotation, search and indexing. The literal spelling of the source is kept; a separate modernized-spelling layer is used only for search. |
| Text | Integrity of document structure | Units (pages, leaves, time spans, slides, sections), a section hierarchy, paragraphs, verse lines, footnotes, running heads and footers kept apart from the text. |
| Text | Integrity of layout and display | Not preserved by the text layer. Layout survives only in the optional page images or the embedded original. Regions of figures and passages can be recorded as fractions of the page image. |
| Text | Support for mathematics, formulae, etc. | Not specified in version 5.0 beyond plain text and light Markdown. |
| Text | Functionality beyond normal rendering | Exact citation: every passage carries its physical page and printed folio (roman, inferred, leaf or column), verse or canonical reference, with character offsets; a reference function produces short citations; anchor URIs; lexical, semantic and hybrid search; export to CSL-JSON, BibTeX, TEI, ALTO, IIIF and W3C Web Annotation. |
| Still image | Normal rendering, clarity, color maintenance | Determined by the embedded page images or figures, which are stored in their own formats (for example PNG or JPEG) at whatever resolution the producer chose; SPDF adds regions and descriptions but no image encoding of its own. |
| Sound | Normal rendering, fidelity, multiple channels | SPDF does not encode audio. It stores time-aligned transcripts (time spans with speakers and word timings in centiseconds) and may embed or reference the original recording, which keeps its own format and quality. |
| Moving image | Normal rendering, clarity | As for sound: transcripts and time anchors, with the original video embedded or referenced. |
| Dataset (metadata) | Normal functionality | Typed SQLite tables with a fixed schema; one document per file; JSON columns validated by JSON Schemas published with the specification. |
| Dataset (metadata) | Support for software interfaces | Any SQLite interface; libraries in many programming languages tested against a common conformance suite; command-line tools and a validator. |
| Dataset (metadata) | Data documentation (quality, provenance, etc.) | Per-unit reader and confidence, per-field metadata provenance, folio source (read or inferred), model and version of each vector space, processing log, and an optional signed content hash. |

## File type signifiers and format identifiers

| Tag | Value | Note |
|---|---|---|
| Filename extension | spdf | Also used by the legacy versions 4.0 and 4.1, which are gzip-compressed. |
| Internet Media Type | application/vnd.spdf+sqlite3 | Registration with IANA in preparation. |
| Magic numbers | Hex: `53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33 00` at offset 0 (ASCII "SQLite format 3" and NUL); `53 50 44 46` at offset 68 (ASCII "SPDF", the SQLite `application_id` 0x53504446); `00 00 01 F4` at offset 60 (`user_version` 500, version 5.0) | Legacy 4.x files begin with `1F 8B` (gzip) and cannot be told from other gzip files without decompressing. |
| Other | Uniform Type Identifier `com.joseluissaorin.spdf`, conforming to `public.data` and `public.database` | Proposed in the specification. |
| Pronom PUID | none yet | Submission in preparation. |
| Wikidata Title ID | none yet | |

## Notes

**General.** An SPDF file is meant to accompany its original, not to replace it: it
records what was read from the original and where, so that citations stay exact even
when the original is not at hand. The original's SHA-256 is always recorded, and anchor
URIs use it, so the same passage can be addressed in every copy of the document. User
annotations and collection lists are kept in separate JSON files (`.spdfa.json`,
`.spdfl.json`), so the document file can stay unchanged. Distributed files must not
contain triggers, views or foreign virtual tables, and readers open them read-only.

**History.** SPDF was created by José Luis Saorín Ferrer for Scholaris, an application
that inserts verified, page-exact citations into academic writing, under the name
*Scholaris Processed Document Format*. Version 3.0 was a gzip-compressed SQLite
database with `metadata` and `chunks` tables; versions 4.0 and 4.1 a gzip-compressed
SQLite database with Spanish identifiers. All of them were internal to Scholaris. Version 5.0, published as a working draft on
7 October 2026 under the name *Semantic Processed Document Format*, is the first public
version: uncompressed, with English identifiers, CSL-JSON metadata, defined text offsets,
new anchor types, an anchor URI aligned with W3C Media Fragments and RFC 5147, optional
signatures and a conformance suite.

## Format specifications

- *SPDF: Semantic Processed Document Format, version 5.0*. José Luis Saorín Ferrer, 2026.
  <https://spdf.joseluissaorin.com/spec>. Source: <https://github.com/joseluissaorin/spdf>.
- SPDF conformance suite, version 0.2.0 (228 cases), in the same repository.

## Useful references

- SQLite, *Database File Format*. <https://www.sqlite.org/fileformat2.html>
- SQLite, *FTS5 Extension*. <https://www.sqlite.org/fts5.html>
- Citation Style Language, CSL-JSON schema. <https://github.com/citation-style-language/schema>
- W3C, *Media Fragments URI 1.0 (basic)*, Recommendation, 2012.
- W3C, *Web Annotation Data Model*, Recommendation, 2017.
- RFC 5147, *URI Fragment Identifiers for the text/plain Media Type*.
- RFC 8032, *Edwards-Curve Digital Signature Algorithm (EdDSA)*.
- RFC 8785, *JSON Canonicalization Scheme (JCS)*.
