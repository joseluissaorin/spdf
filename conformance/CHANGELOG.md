# Conformance suite changelog

Newest first. Implementers: read this before updating your runner.

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
