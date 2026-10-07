# Conformance suite changelog

Newest first. Implementers: read this before updating your runner.

## 0.4.0 (2026-10-07)

RFC 0002 made normative (SPEC §5.4 and §19). 309 cases.

- New kind `locate` (25 cases): resolution of `spdf:` URIs and of `.spdf` URLs with a
  fragment against a file: units, fragments, `char` and `xywh`, by page, page range,
  folio, time (with the end of the recording), slide, verse, canonical reference,
  section path and paragraph, sheet rows; references to another document.
- New kinds `export_csl` (18) and `export_bibtex` (16): keys (`cervantessaavedra1605`,
  `lazarillo1554` from `title-short`, `anonnd`), collision suffixes, literal names,
  protected capitals, CSL `label`/`locator` of citations. Hand-written expectations for
  the representative cases; the rest computed by the oracle from the explicit metadata.
- New kind `export_structure` (15): the page sequence of ALTO (`PHYSICAL_IMG_NR`,
  `PRINTED_IMG_NR`, absent for inferred and unnumbered folios), TEI (`pb/@n`, `[iv]` for
  inferred) and IIIF (canvas `label`).
- `search_vector` over units (`darwin`, new unit vectors in `toy-embedding@8`) and over
  units, figures and fragments in a non-normalized space with cosine scores
  (`micrographia`, new space `toy-clip@4`, profile `core semantic`). Result items carry
  `unit_id` / `figure_id`.
- Changed sources: `darwin` (unit vectors) and `micrographia` (space, vectors, profile,
  provenance); their dumps changed accordingly.
- Oracle fixes reported by langs-a (C# port): i8 quantization of values whose product by
  127 overflows now clamps to ±127 (new case `quantize-i8-overflow-clamps`); the reference
  validator no longer crashes when `documents` is missing (new case
  `validate-E010-missing-documents`).

## 0.3.0 (2026-10-07)

- `invalid/W105-newer-minor-new-anchor-type.spdf`: in a file of a newer minor version
  (5.1), an anchor type the validator does not know is reported as a warning (E041 in
  `warnings`), not as an error; the same holds for unknown dtypes (E032). SPEC §22.1
  step 4 and §23.
- 229 cases.

## 0.2.0 (2026-10-07)

- New kind `quantize` (6 cases): writer-side encoding of f32, f16 and i8 values, with
  i8 rounding half away from zero and clamping to ±127, and f16/f32 overflow as an error.
  Reader-only implementations may skip it.
- `invalid/E020-virtual-table.spdf`: a virtual table other than `fragments_fts` and
  `fragments_fts_trigram` is E020 (SPEC §2.4, §22).
- `invalid/OK-integral-number.spdf`: anchors whose integer members are written as `1.0`
  are valid; an integer is a JSON number with an integral value.
- 228 cases.

## 0.1.0 (2026-10-07), first batch

- 220 cases: `anchor_uri` 40, `cite` 79 (es and en), `dump` 7, `legacy_dump` 2,
  `roundtrip` 7, `search_lexical` 39, `search_vector` 5, `search_hybrid` 2, `validate` 39.
- Seven SPDF 5.0 files in `files/`:
  - `minimo` (Bécquer; minimal `core`, original embedded as a blob, verse anchors);
  - `quijote` (Cervantes; roman, inferred and leaf folios, unnumbered title page,
    fragments that cross pages; signed with the public test key);
  - `apolo11` (NASA; time anchors, speakers, word timings, profile `core media`);
  - `lazarillo` (anonymous, 1554; old spelling with a modernized `search_text` layer,
    no author);
  - `micrographia` (Hooke; figures with regions, page images, thumbnails);
  - `darwin` (three compatible vector spaces f32 / f16 / i8 of 8 dimensions, profile
    `core semantic`);
  - `lunyu` (the *Analects* in Chinese; canonical anchors, optional `trigram` index).
- Two authentic legacy files in `legacy/`: Garcilaso (4.1, gzip, FTS triggers, blobs,
  vectors, Spanish metadata) and Kennedy (4.0, `user_version` 0, detected by the `spdf`
  table).
- 31 files in `invalid/`, one per code: E001 (×2), E002 (×2), E003, E010, E011, E012,
  E013, E020 (trigger and view), E030, E031, E032, E040 (×2), E041, E042, E050, E051,
  E060, E070, E080, E081, E082, E090, and warnings W100, W101, W102, W105.
- Follows `spec/CONTRACT.md` draft 1 (2026-10-07), including: provenance ordered by the
  UTF-8 bytes of each entry's JCS form; lexical terms sent to FTS5 without case folding.
