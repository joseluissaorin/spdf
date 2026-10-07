# Media type registration: application/vnd.spdf+sqlite3

> **Borrador sin enviar.** Solicitud de registro del tipo de medio
> `application/vnd.spdf+sqlite3` en el árbol de fabricante (`vnd.`) del registro de tipos
> de medio de IANA, según la plantilla de la sección 5.6 de la RFC 6838, con el sufijo
> estructurado `+sqlite3` (registrado en IANA). Va a IANA por su formulario web
> (<https://www.iana.org/form/media-types>), donde la revisa un experto designado. La
> RFC 6838 recomienda, sin exigirlo, enviarla antes a la lista media-types@iana.org
> para que la comente la comunidad; conviene hacerlo.
>
> Decidido el 7-10-2026 por el orquestador del proyecto: el tipo es
> `application/vnd.spdf+sqlite3` y no `application/vnd.spdf`. El sufijo permite que las
> herramientas genéricas de SQLite reconozcan el fichero, y SPDF ya cumple lo que pide el
> registro del sufijo (un `application_id` propio en el desplazamiento 68 y su entrada en
> `magic.txt`, véase `sqlite-magic-entry.md`). `SPEC.md` §24 ya define los
> identificadores de fragmento que se describen abajo.
>
> Falta antes de enviarla:
>
> 1. Una versión estable de la especificación. `https://spdf.joseluissaorin.com/spec`
>    ya sirve `SPEC.md` (comprobado el 7-10-2026), pero es un borrador de trabajo que
>    cambia; conviene enlazar una versión fechada que no cambie (la de la etiqueta
>    `spec-v5.0.0`) y, a ser posible, enviarla cuando la 5.0 sea final.
> 2. Confirmar quién figura como responsable del cambio (José Luis o, si se crea, la
>    organización `spdf-format` o el comité técnico).
> 3. Por verificar: el texto exacto de las consideraciones de identificadores de
>    fragmento del registro del sufijo `+sqlite3`, para citarlo en el apartado
>    correspondiente.
>
> Comprobado el 7-10-2026: el nombre `vnd.spdf` no figura en el registro de IANA; la
> plantilla sigue la RFC 6838; el registro de `application/vnd.sqlite3` sirvió de
> referencia para las consideraciones de seguridad, que resumen las §2.4, §14 y §15 de
> `SPEC.md`.

---

**Type name:** application

**Subtype name:** vnd.spdf+sqlite3

**Required parameters:** N/A

**Optional parameters:**

`version`: the version of the SPDF specification the file declares, as `MAJOR.MINOR`
(syntax: `1*DIGIT "." 1*DIGIT`), for example `version=5.0`. The parameter is
informative only. The authoritative version is stored in the file itself (the SQLite
`user_version` header field and the `spdf_meta.spdf_version` row), and receivers MUST NOT
rely on the parameter instead of the file.

**Encoding considerations:** binary

**Structured syntax suffix:** `+sqlite3`. The considerations of the `+sqlite3` suffix
registration apply; an SPDF file is a SQLite 3 database that any SQLite tool can open
read-only. The SPDF-specific rules below add to them.

**Security considerations:**

An SPDF file is a SQLite 3 database. The security considerations of
`application/vnd.sqlite3` apply in full; in addition:

1. *Active content.* SQLite schemas can contain triggers and views, which are SQL code
   executed by the library on behalf of whoever uses the database, and virtual tables,
   which call module code. SPDF files MUST NOT contain triggers, views, or virtual
   tables other than the two FTS5 full-text tables the specification defines. Readers
   open files read-only (`SQLITE_OPEN_READONLY`, `PRAGMA query_only=1`), with
   `PRAGMA trusted_schema=OFF` and, where the SQLite binding exposes it,
   `SQLITE_DBCONFIG_DEFENSIVE`; they never load SQLite extensions, and they refuse files
   whose schema contains any of those objects. Files
   of the legacy versions 4.0 and 4.1 contain exactly three full-text synchronization
   triggers, which readers tolerate because a read-only connection never fires them.
2. *Malformed and hostile files.* The SQLite file format is complex, and crafted files
   can exercise bugs in the library. Following SQLite's own advice for untrusted
   databases, readers use a current SQLite release, disable memory-mapped I/O, enable
   `cell_size_check`, may run `quick_check` first, and bound the size of every value
   they read (the specification recommends 512 MiB) and the nesting depth of the JSON
   they parse (it recommends 64). An index that disagrees with its table can make queries
   return data that is not stored; validators check the full-text index on a private
   in-memory copy. Search terms reach the full-text engine only as quoted strings and
   SQL is always parameterized, so user input cannot inject query syntax.
3. *Compression.* The SPDF 5.x container is not compressed. Embedded objects (page
   images, the original document, audio or video) are stored in their own formats and
   carry those formats' considerations, including their own compression. Legacy 4.x
   files are SQLite databases wrapped in gzip; readers decompress them only up to a
   configurable limit (the specification's default is 4 GiB) to defeat decompression
   bombs.
4. *Embedded documents and images.* A file may embed the original it was read from (for
   example PDF, EPUB, HTML or SVG) and page images. They are untrusted input to their
   own decoders and may contain scripts or other active content. Readers MUST NOT
   execute embedded content, MUST NOT render SVG with scripts enabled, and SHOULD render
   embedded documents only in a sandbox. Blob keys are opaque strings: a reader that
   writes blobs to disk sanitizes them (no absolute paths, no `..`, no device names).
5. *Text and links.* Unit text is light Markdown; readers render it without raw HTML and
   escape it before inserting it into HTML. URLs may appear in the source reference, in
   image references, in the metadata and in web anchors. Readers MUST NOT fetch them
   automatically, because fetching discloses that the file was opened and can reach
   internal services; they fetch only on a user action, showing the address first.
6. *Language models.* Text read from a file may contain instructions aimed at language
   models. Applications that pass SPDF text to a model treat it as data, not as
   instructions.
7. *Privacy.* Besides the visible text, a file may hold the original document, page
   images, word-level timings and speaker names of recordings, and provenance records
   naming the tools and models that processed it and when. The content itself may be
   personal data (for example a recorded interview). Embedding vectors can be inverted
   to reconstruct much of the text they were computed from, so distributing the vectors
   of a text is close to distributing the text, and a writer that strips the text of a
   restricted document strips its vectors too. User annotations are kept outside the
   file, so sharing a document does not share its reader's notes. Writers compact files
   with `VACUUM` before distribution so that deleted data does not remain in free pages.
8. *Integrity and authenticity.* The format provides no confidentiality. It provides
   optional integrity: `content_sha256` is a SHA-256 of a canonical serialization of the
   content (RFC 8785), which covers embedded objects and vectors through their hashes
   but not the SQLite page layout, and `signature` is an Ed25519 signature (RFC 8032) of
   that hash. Verifiers recompute the hash rather than trust the stored value.
   Provenance, confidence values and metadata are claims made by the writer; a valid
   signature shows that the holder of the key vouched for them, and says nothing about
   whether the key should be trusted (key distribution is outside the specification).
   Unsigned files can be altered without detection.
9. *Anchor URIs.* SPDF anchor URIs name a document by the SHA-256 of its source. Sending
   such a URI to a resolver reveals which document and which passage a user is reading.

**Interoperability considerations:**

- SPDF files are ordinary SQLite 3 databases and can be opened by any SQLite tool. Full
  conformance requires FTS5 (part of the SQLite amalgamation since 3.9.0) with the
  `unicode61 remove_diacritics 2` tokenizer (SQLite 3.27.0 or later); safe opening
  requires `trusted_schema` (3.31.0 or later); the optional `trigram` index for Chinese,
  Japanese and Korean requires 3.34.0 or later.
- Distributed files use the DELETE journal mode, so they are self-contained (no `-wal`
  or `-journal` companion file).
- The version is stored as `PRAGMA user_version` = major × 100 + minor × 10. A reader of
  a major version reads every minor version of it; it refuses unknown major versions.
- Files of the legacy versions 4.0 and 4.1, written by the Scholaris application before
  this registration, share the `.spdf` extension but are gzip-compressed SQLite
  databases (magic number `1F 8B`) without the SPDF `application_id`. Conforming SPDF
  readers read them.
- Metadata is a CSL-JSON item; user annotations are kept outside the file as W3C Web
  Annotation documents (`*.spdfa.json`, served as `application/json` or
  `application/ld+json`); collections are JSON manifests (`*.spdfl.json`,
  `application/json`). Neither sidecar uses this media type.
- A public conformance suite defines the expected results of reading, validating,
  searching, building anchor URIs and citing, and several independent implementations
  are tested against it.

**Published specification:**

SPDF: Semantic Processed Document Format, version 5.0.
<https://spdf.joseluissaorin.com/spec> (Spanish translation:
<https://spdf.joseluissaorin.com/es/especificacion>). Source:
<https://github.com/joseluissaorin/spdf>. Licensed under CC BY 4.0.

**Applications that use this media type:**

SPDF Reader (desktop, mobile and web); the Scholaris citation application; the reference
producer `spdf build`; the SPDF libraries for Rust, TypeScript, Python, Swift,
Kotlin/JVM, Go, C#, PHP, Ruby, R and Julia, and their integrations with reference
managers and document tools.

**Fragment identifier considerations:**

As RFC 6838 section 4.11 allows, this registration defines fragment identifier
semantics specific to the type, in addition to those of the `+sqlite3` suffix.
A fragment identifier on a URI that resolves to an `application/vnd.spdf+sqlite3` resource
addresses a location in the single document the file holds. Its syntax is the parameter
list of the SPDF anchor URI: `key=value` pairs joined by `&`, in the canonical order the
specification defines, values percent-encoded as UTF-8. For example:

```text
https://example.org/darwin.spdf#p=29&f=21&char=118,301
```

`p` and `pe` are physical pages; `f` and `fe` printed folios; `t` a time range in
seconds; `s` a section path; `para` a paragraph; `sl` a slide; `sh` and `rows` a sheet
and its rows; `v` a verse or range of verses; `ref` a canonical reference
(`scheme:ref`); `char` a character range; `xywh` a region. Where they overlap with
existing standards the parameters use their syntax: `t=<start>,<end>` and
`xywh=percent:<x>,<y>,<w>,<h>` as in W3C Media Fragments URI 1.0, and
`char=<start>,<end>` as in RFC 5147, with positions counted in Unicode code points of
the NFC-normalized text of the unit. Unknown keys are ignored. The same parameter list
follows `#` in SPDF anchor URIs of the form `spdf:sha256-<hex>#…`, which name the
document by the SHA-256 of its source instead of by location.

**Additional information:**

- Deprecated alias names for this type: N/A
- Magic number(s):
  - offset 0, 16 bytes: `53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33 00`
    (ASCII "SQLite format 3" followed by a NUL byte);
  - offset 68, 4 bytes: `53 50 44 46` (ASCII "SPDF"; the SQLite `application_id`
    1397769286 = 0x53504446, stored big-endian);
  - offset 60, 4 bytes: the version as a big-endian integer, `00 00 01 F4` (500) for
    version 5.0, and in general from 500 to 599 for the 5.x versions.
- File extension(s): `.spdf`
- Macintosh file type code(s): none
- Uniform Type Identifier (Apple platforms): `com.joseluissaorin.spdf`, conforming to
  `public.data` and `public.database`.

**Person & email address to contact for further information:**

José Luis Saorín Ferrer <jl@joseluissaorin.com>

**Intended usage:** COMMON

**Restrictions on usage:** N/A

**Author:** José Luis Saorín Ferrer

**Change controller:** José Luis Saorín Ferrer <jl@joseluissaorin.com>, editor of the SPDF
specification.

**Provisional registration? (standards tree only):** N/A
