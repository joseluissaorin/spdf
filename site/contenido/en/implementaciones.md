---
title: Implementations
short: Implementations
description: Twelve native, independent implementations of SPDF 5.0, all checked by the same conformance suite on every commit, and what each one's CI says today.
---

SPDF is not one library with bindings. It is a specification with several **native, independent implementations**, each written in the idiom of its language and each checked against the same conformance cases. The Rust implementation is the reference and also exposes a C ABI for anyone who would rather not deal with SQLite directly.

The table is rebuilt from the continuous integration of the repository every time this site is published. Nothing here is typed by hand: if a run is red, it says red.

<!-- estado -->

## What every implementation does

Every implementation, in every language, does the same eight things, and the conformance suite checks all of them:

1. **Opens safely**: read-only, `query_only`, `trusted_schema=OFF`, defensive mode where the binding allows it, never loading extensions, rejecting files with triggers or views, and with bounded blob and decompression sizes.
2. **Validates** a file and reports the error and warning codes of the specification ([§ Validation](/spec#validation)).
3. **Reads** SPDF 5.0 and the legacy 4.0 and 4.1 files from Scholaris, which are usually gzip-wrapped and use Spanish identifiers.
4. **Dumps** a file to canonical JSON (RFC 8785), the oracle every other implementation is compared against.
5. **Searches**: lexical (FTS5), vector (brute force, f32, f16 or i8) and hybrid (reciprocal rank fusion with k = 10).
6. **Formats and parses anchor URIs**, byte for byte, in both directions.
7. **Cites**: short author-date citations in English and Spanish, and bibliography as CSL-JSON and BibTeX.
8. **Writes**: builds a valid SPDF from scratch, and round-trips a dump.

## How conformance is checked

The suite lives in `conformance/`: source dumps, generated files, legacy files, deliberately broken files and one JSON case per check. A case has an `id`, a `kind` (`dump`, `validate`, `search_lexical`, `search_vector`, `search_hybrid`, `anchor_uri`, `cite`, `legacy_dump`, `roundtrip`), an input and the expected result.

Each implementation ships a runner that executes every case and prints one line of JSON:

```json
{"impl": "rust", "version": "5.0.0", "passed": ["dump-001", "…"], "failed": [], "skipped": []}
```

The CI of each implementation fails on any failed case and uploads that JSON as the artifact `conformance-<folder>`, which is what the table above counts.

## Tiers

- **First tier**: Rust, TypeScript, Python, Swift, Kotlin/JVM, Go and C#. Released together with every version of the specification.
- **Second tier**: PHP, Ruby, R, Julia and C. The same suite, released when they are ready.

## Producers

Reading a document is the producer's job, not the library's. There are two independent producers, and their interoperability is a condition for declaring the format stable:

- `spdf build`, the reference producer, in Python, with local models (EmbeddingGemma 2, Gemma 4, Whisper) or your own API key.
- [Scholaris](https://scholaris.joseluissaorin.com), in TypeScript, where the format was born.
