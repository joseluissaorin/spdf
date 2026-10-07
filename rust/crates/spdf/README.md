# spdf

Reference implementation of **SPDF 5.0** (*Semantic Processed Document Format*), an open
format for documents that have been read once and can be cited forever: every passage
carries its exact anchor (printed page, folio, second of a recording, slide, verse), so a
citation can only print what the source says.

An SPDF file is an SQLite 3 database. This crate bundles SQLite (with FTS5) through
`rusqlite`'s `bundled` feature, so every platform searches with the same engine.

- **Safe opening**: read-only, `query_only`, `trusted_schema=OFF`,
  `SQLITE_DBCONFIG_DEFENSIVE`, triggers and views disabled and refused (except the three
  FTS triggers of legacy files), foreign virtual tables refused, no extensions, no
  `ATTACH`, bounded blob size and bounded gzip expansion.
- **Reads 5.0 and legacy 4.0/4.1** (Scholaris, Spanish schema, usually gzip-wrapped)
  through one 5.0 view, including the metadata mapping to CSL-JSON.
- **Validation** with the error codes of the specification (E001 to E090, W100 to W110).
- **Canonical dump**: JSON, RFC 8785 (JCS), byte for byte stable; it is the
  conformance oracle and the basis of `content_sha256`.
- **Reference search**: lexical (FTS5, BM25 with the reference weights, CJK route with
  `trigram` or substring fallback), vector (f32, f16, i8; dot product or cosine, scores in
  f64, in-memory cache for repeated queries) and hybrid (reciprocal rank fusion, k = 10).
- **Anchors**: typed anchors, `spdf:` URIs (parse and format, canonical form), offsets in
  Unicode code points over NFC text with UTF-8/UTF-16 conversions.
- **Citation**: short author-date citations in Spanish and English, citation of a
  quoted passage by the unit it lies in (`cite_passage`); CSL-JSON and BibTeX export, and
  ALTO, TEI and IIIF exports.
- **Resolution** of anchor URIs and `.spdf#p=…` URLs to units and fragments (`locate`).
- **Writing**: a `Writer` that produces valid 5.0 files (FTS rebuilt, no triggers,
  `VACUUM`, `application_id`, `user_version`), conversion of legacy files, and
  `Writer::from_dump` for conformance sources.
- **Integrity**: `content_sha256` and optional Ed25519 signatures.
- **Remote reading** (feature `http`, experimental): a read-only SQLite VFS that reads an
  SPDF over HTTP range requests without downloading it.

It passes the whole conformance suite of the repository (`conformance/`, 341 cases in 0.4.1).

## Example

```rust,no_run
use spdf::{Anchor, Locale, Spdf, Target};

let doc = Spdf::open("vigilar-y-castigar.spdf")?;          // 5.0 or legacy 4.x
let meta = doc.document()?;
println!("{} (SPDF {})", meta.title.clone().unwrap_or_default(), doc.version());

for hit in doc.search_lexical("panóptico", 5)? {
    let a = Anchor::from_value(&hit.anchor)?;
    println!("{:>8.3}  {}  {}", hit.score, spdf::cite(&a, &meta, Locale::Es), hit.anchor_uri);
}

// Vector and hybrid search with a query vector from your embedding model.
let query = vec![0.0f32; 768];
let _ = doc.search_vector("embeddinggemma-2@768", &query, Target::Fragment, 10);
let _ = doc.search_hybrid("panóptico", &query, "embeddinggemma-2@768", 10);

// Validation and canonical dump.
let report = spdf::validate("vigilar-y-castigar.spdf");
assert!(report.valid);
let json = doc.dump_canonical()?;
# let _ = json;
# Ok::<(), spdf::Error>(())
```

Writing:

```rust,no_run
use spdf::{Spdf, Space, Target, Writer};

let doc = Spdf::open("old-4.1.spdf")?;       // legacy files are converted on the way
let mut w = Writer::from_spdf(&doc)?;
w.add_space(&Space::new("local", "embeddinggemma-2", 768))?;
w.add_vector(Target::Fragment, "f1", "embeddinggemma-2@768", &vec![0.0; 768])?;
w.write("new-5.0.spdf")?;
# Ok::<(), spdf::Error>(())
```

## Features

| feature | what |
|---|---|
| (default) | everything except remote reading |
| `http` | `spdf::remote::open_url`: read-only HTTP range VFS (experimental) |

## Command line and C

- `spdf-tools` installs the `spdf` command: `validate`, `dump`, `info`, `search`, `cite`,
  `anchor`, `export`, `convert`, `build-from-dump`, `keygen`, `sign`, `verify` and
  `conformance`.
- `spdf-ffi` is a stable C ABI over this crate (`spdf.h`).

## License

Code: MIT OR Apache-2.0, at your option. The SPDF specification is CC BY 4.0.
Specification, conformance suite and other implementations:
<https://github.com/joseluissaorin/spdf>.
