# PRONOM submission: SPDF (Semantic Processed Document Format) 5.0

> **Borrador sin enviar.** Propuesta de ficha nueva para PRONOM, el registro técnico de
> formatos de The National Archives (Reino Unido), que alimenta las herramientas de
> identificación DROID y FIDO. Los campos siguen la plantilla oficial de envío
> («PRONOM Submission template», en Word y en hoja de cálculo) del repositorio
> `digital-preservation/PRONOM_Research`.
>
> La vía actual es GitHub: un *pull request* con la investigación en la carpeta
> `Submissions` de <https://github.com/digital-preservation/PRONOM_Research>, o una
> *issue* en ese repositorio. También aceptan correo a PRONOM@nationalarchives.gov.uk,
> que es la vía para muestras que no deban publicarse. Lo que se sube a ese repositorio
> se publica con licencia CC0 (muestras) y la descripción, con la Open Government
> Licence.
>
> Falta antes de enviarla:
>
> 1. **Tipo de medio.** PRONOM solo admite tipos de medio registrados en IANA o que
>    figuren en la documentación oficial del formato. Lo ideal es enviar esto después
>    de registrar `application/vnd.spdf` (ver `iana-application-vnd.spdf.md`); si no,
>    hay que citar `SPEC.md` publicada como documentación oficial.
> 2. **Muestras.** Preparar ficheros de ejemplo descargables y de dominio público: los de
>    `conformance/files/` sirven (Cervantes, Darwin, Hooke…), pero hay que publicarlos en
>    una URL estable o adjuntarlos al *pull request* (quedan bajo CC0).
> 3. **Probar la firma con DROID** (por ejemplo con la utilidad de desarrollo de firmas
>    de Ross Spencer que enlaza la propia guía de PRONOM) sobre las siete muestras 5.0,
>    sobre los dos ficheros heredados y sobre un SQLite cualquiera, para comprobar que
>    no hay falsos positivos.
> 4. Una versión estable de la especificación: la web ya la sirve en
>    `https://spdf.joseluissaorin.com/spec` (comprobado el 7-10-2026), pero como
>    borrador de trabajo; conviene citar una versión fechada que no cambie.
>
> Por verificar: si PRONOM prefiere una ficha por versión menor (5.0, 5.1…) o una ficha
> «5.x» con la firma genérica; qué clasificación asignan (aquí se propone «Database»,
> con «Text (Structured)» como alternativa); y si quieren fichas aparte para las
> versiones heredadas 4.0 y 4.1, que no se pueden identificar sin descomprimir.
> Comprobado el 7-10-2026: la ficha de SQLite 3 es fmt/729 (tipo MIME
> `application/x-sqlite3`, firma `53514C69746520666F726D6174203300` en el desplazamiento
> 0); GZIP es x-fmt/266; los formatos basados en SQLite con `application_id` propio
> (OGC GeoPackage, fmt/1700; Audacity 3, fmt/1826) declaran «Has priority over» respecto
> de fmt/729 y usan la sintaxis de huecos `{n}` de DROID.

---

## Format

| Field | Value |
|---|---|
| File format name | SPDF (Semantic Processed Document Format) |
| Version | 5.0 |
| Other names | Semantic Processed Document Format; Scholaris Processed Document Format (original name, versions 3.0 to 4.1); SPDF document |
| PUID | to be assigned |
| Format family | none |
| Format type (classification) | Database (alternatively Text (Structured)) |
| Extension(s) | spdf |
| MIME / media type | application/vnd.spdf (registration with IANA pending; defined in the official specification) |
| Byte order | Big-endian (SQLite header integers); the format's own binary vector data is little-endian |
| Disclosure | Open, fully documented; specification under CC BY 4.0 |
| Developer | José Luis Saorín Ferrer, editor of the SPDF specification |
| Support | The SPDF project, <https://spdf.joseluissaorin.com>, contact jl@joseluissaorin.com |
| Released | 5.0 working draft, 2026-10-07 |

## Description

SPDF (Semantic Processed Document Format) is an open file format for documents that have
been read once, by optical character recognition, a text layer, a speech recogniser or
by hand, and stored so that every passage can be cited with its exact location: printed
page or folio, leaf or column, verse, canonical reference, second of a recording, slide
or spreadsheet rows. An SPDF file is a SQLite 3 database holding exactly one document:
its bibliographic record as a CSL-JSON item, its citable units (pages, time spans,
slides, sections, sheets) with their text in Unicode NFC, passages indexed for full-text
search with the SQLite FTS5 module, optional section structure, figures, embedding
vectors for semantic search, provenance records, and optionally the original file and
page images as embedded binary objects. The SQLite header identifies the format: the
`application_id` field at offset 68 holds the ASCII bytes "SPDF" and the `user_version`
field at offset 60 holds the version (500 for version 5.0).

The format was created by José Luis Saorín Ferrer for the Scholaris citation
application, where it was called "Scholaris Processed Document Format". Versions 3.0 to
4.1 were internal to Scholaris and were stored compressed with gzip (version 3.0 as a
gzip-compressed SQLite database with `metadata` and `chunks` tables; 4.0 and 4.1 as a
gzip-compressed SQLite database with Spanish table names); those files also use the
`.spdf` extension. Version 5.0
(October 2026) is the first public version: an uncompressed SQLite database with English
identifiers, readable directly by any SQLite tool. Readers of version 5.0 are required
to read the legacy versions 4.0 and 4.1 as well.

Files may be accompanied by two kinds of JSON sidecar files, which are not SPDF files:
`.spdfa.json` (user annotations in W3C Web Annotation format) and `.spdfl.json`
(collection manifests). The format is used for scholarly reading, citation and search of
books, articles, manuscripts, recordings, slides and web pages.

## Internal signatures

### Signature 1: SPDF 5.0

| Field | Value |
|---|---|
| Signature name | SPDF 5.0 |
| Position type | Absolute from BOF |
| Offset | 0 |
| Max offset | 0 |
| Value | `53514C69746520666F726D6174203300{44}000001F4{4}53504446` |

Description: BOF, offset 0: 'SQLite format 3' followed by 0x00
(`53514C69746520666F726D6174203300`, 16 bytes), then a gap of 44 bytes, then at offset 60
the SQLite `user_version` 500 as a big-endian integer (`000001F4`), then a gap of 4 bytes,
then at offset 68 the SQLite `application_id` 'SPDF' (`53504446`, 0x53504446 =
1397769286).

The same signature as three byte sequences, if preferred:

| Position type | Offset | Max offset | Value |
|---|---|---|---|
| Absolute from BOF | 0 | 0 | `53514C69746520666F726D6174203300` |
| Absolute from BOF | 60 | 60 | `000001F4` |
| Absolute from BOF | 68 | 68 | `53504446` |

Checked against the seven version 5.0 files of the SPDF conformance suite: bytes 60 to 71
are `00 00 01 F4 00 00 00 00 53 50 44 46` in all of them.

### Signature 2 (optional): SPDF, any version from 5.0

If PRONOM prefers one record for all 5.x versions, or as a fallback for future minor
versions, the `application_id` alone identifies the format, in the same way as the
records for OGC GeoPackage (fmt/1700) and Audacity Project File 3.x (fmt/1826):

| Position type | Offset | Max offset | Value |
|---|---|---|---|
| Absolute from BOF | 0 | 0 | `53514C69746520666F726D6174203300{52}53504446` |

Future minor versions change only the `user_version` value: 5.1 is 510 (`000001FE`), 5.2
is 520 (`00000208`), and so on (major × 100 + minor × 10).

### Legacy versions 4.0 and 4.1

Legacy files begin with the gzip header (`1F8B08`) and are identified by DROID as GZIP
Format (x-fmt/266). The SPDF database is only visible after decompression, where it has
`application_id` 0 and `user_version` 410 (4.1), 400 or 0 (4.0), with tables named
`spdf`, `documentos`, `unidades` and `fragmentos`. A `user_version` value on its own is
not a reliable signature (other SQLite applications use values such as 400), so no
signature is proposed for them. If PRONOM records them, version 5.0 would be related to
them as "Is subsequent version of" SPDF 4.1; their signatures cannot collide with
version 5.0, so no priority relationship is needed.

## External signature

| Type | Value |
|---|---|
| File extension | spdf |

## Relationships

| Relationship | Related format |
|---|---|
| Has priority over | SQLite Database File Format, version 3 (fmt/729) |
| Is subtype of | SQLite Database File Format, version 3 (fmt/729) |

## Documentation

- SPDF: Semantic Processed Document Format, version 5.0. José Luis Saorín Ferrer, 2026.
  <https://spdf.joseluissaorin.com/spec>. Licensed under CC BY 4.0.
- SPDF conformance suite, version 0.1.0 (220 cases).
  <https://github.com/joseluissaorin/spdf/tree/main/conformance>
- SQLite Database File Format. <https://www.sqlite.org/fileformat2.html>

## Samples for testing the signature

Sample files built from short excerpts of public-domain works are part of the SPDF
conformance suite in <https://github.com/joseluissaorin/spdf>:

- `conformance/files/*.spdf`: seven version 5.0 files (Cervantes, the *Lazarillo*,
  Bécquer, Hooke, Darwin, the *Analects*, NASA air-to-ground transmissions);
- `conformance/legacy/*.spdf`: two legacy files, versions 4.1 (Garcilaso) and 4.0
  (J. F. Kennedy), gzip-compressed;
- `conformance/invalid/*.spdf`: files that each break one rule of the specification,
  useful as near misses (for example a version 5.0 database wrapped in gzip, or a SQLite
  database with an unknown `application_id`).

## Vendor and support

José Luis Saorín Ferrer, editor of the SPDF specification. Contact: jl@joseluissaorin.com.

## Submitted by

José Luis Saorín Ferrer, SPDF project.
