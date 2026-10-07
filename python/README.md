# spdf-format

Read, validate, search, cite and write **SPDF** files from Python.

SPDF (Semantic Processed Document Format) is an open format for documents that have
been read once and can be cited forever: every passage carries its exact anchor (printed
page or folio, second of a recording, slide, verse, canonical reference), so a citation
can only print what the source says. A `.spdf` file is a plain SQLite 3 database with
full-text indexes, optional embedding vectors and CSL-JSON metadata.

This package is a native, independent implementation of SPDF 5.0 and of the legacy 4.0
and 4.1 formats. It is installed as `spdf-format` and imported as `spdf`.

- Python 3.10 or newer, **standard library only** (`sqlite3`).
- Optional extras: `numpy` (fast vector search), `crypto` (Ed25519 through
  `cryptography`; a pure-Python fallback is included), `pandas`, `arrow`.
- Passes the whole SPDF conformance suite (0.4.0, 309 cases): reader, semantic reader, writer and validator,
  profiles `core`, `semantic` and `media`.

```sh
pip install spdf-format            # or: uv add spdf-format
pip install "spdf-format[numpy]"   # faster vector search
```

## Quick start

```python
import spdf

with spdf.open("quijote.spdf") as f:          # 5.0, or legacy 4.x (gzip-wrapped too)
    doc = f.document                          # spdf.Document, metadata is CSL-JSON
    print(doc.display_title, f.cite())        # El ingenioso hidalgo… (Cervantes Saavedra, 1605)

    for hit in f.search("lanza en astillero"):
        print(f.cite(hit.fragment), hit.anchor_uri)
        # (Cervantes Saavedra, 1605, p. 23)  spdf:sha256-3f2a…#p=29&f=23&char=0,159

    unit = f.unit_by_printed("23")            # the page whose printed folio is 23
    print(unit.text)
```

Lexical search follows the reference algorithm of the specification: words are OR-ed,
quoted phrases (`"…"`, `“…”`, `«…»`, `„…“`) are AND-ed, and case and diacritics are folded
by the FTS5 index (`unicode61 remove_diacritics 2`). Queries in Chinese, Japanese or Korean
use the `trigram` index when the file has one, and a substring scan otherwise.

```python
with spdf.open("darwin.spdf") as f:
    space = f.space("embeddinggemma-2@768")   # model, dims, dtype, task prefixes
    qvec = my_model.encode(space.task_prefixes["query"] + "natural selection")
    f.search_vector(qvec, space=space.id, limit=5)
    f.search_hybrid("natural selection", qvec, space=space.id)   # RRF, k = 10
    f.search_vector(qvec, space=space.id, target="unit")          # hits carry unit_id
```

Every hit has `id`, `target` (`fragment`, `unit` or `figure`), `score`, `via`, `anchor`
and `anchor_uri`; `fragment_id`, `unit_id` and `figure_id` give the id for each target.

## Validate

```python
report = spdf.validate("quijote.spdf")
report.valid            # True when there are no errors
report.codes            # {"W102"} …
report.to_dict()        # {"valid", "version", "profile", "errors", "warnings"} as in the spec
```

Validation follows the order of the specification and reports every code it finds:
`E001` not SQLite, `E002` unknown version, `E003` gzip-wrapped 5.0 (warning), `E010`/`E011`
missing table or column, `E012` missing metadata key, `E013` not exactly one document,
`E020` trigger, view or foreign virtual table, `E030`–`E032` vectors and spaces,
`E040`–`E042` anchors, `E050`/`E051` metadata, `E060` unknown required extension, `E070`
FTS index out of sync, `E080` blob hash, `E081`/`E082` content hash and signature, `E090`
unit order, and the warnings `W100`–`W110`.

## Write

```python
with spdf.Writer("out.spdf") as w:
    w.add_document({
        "id": "quijote", "kind": "pdf", "mime": "application/pdf", "bytes": 1203456,
        "source_sha256": "3f2a…", "source_ref": w.add_blob("original.pdf", "application/pdf", pdf_bytes),
        "metadata": {"type": "book", "title": "El ingenioso hidalgo don Quijote de la Mancha",
                     "author": [{"family": "Cervantes Saavedra", "given": "Miguel de"}],
                     "issued": {"date-parts": [[1605]]}, "language": "es"},
    })
    page = {"type": "page", "physical": 29, "printed": "23", "roman": False, "source": "read"}
    w.add_unit({"id": "u29", "ord": 1, "anchor": page, "text": "En un lugar de la Mancha…",
                "reader": "pdf-text-layer"})
    w.add_fragment({"id": "f1", "unit": "u29", "ord": 1, "text": "En un lugar de la Mancha…",
                    "anchor": {**page, "chars": [0, 24]}})
    w.add_space({"id": "embeddinggemma-2@768", "provider": "google", "model": "embeddinggemma-2",
                 "dims": 768, "modalities": ["text"]})
    w.add_vector("fragment", "f1", "embeddinggemma-2@768", data=vector)   # list, ndarray or bytes
```

The writer builds the file next to its destination, rebuilds the FTS index (distributed
files carry no triggers), fills the required metadata keys (`spdf_version`, `profile`,
`created`, `generator`, `document_id`), computes `content_sha256`, can sign it
(`finalize(sign_key=…)`), compacts it with `VACUUM`, validates it and only then moves it
into place. Text is normalized to NFC. `i8` and `f16` vectors are quantized as the
specification says.

`spdf.convert_legacy("old.spdf", "new.spdf")` converts a 4.x file to 5.0, and
`spdf.write_source(full_dump, path)` rebuilds a file from a full dump (`f.full_dump()`).

## Anchors, URIs and citations

```python
uri = spdf.make_uri("sha256-3f2a…", {"type": "page", "physical": 29, "printed": "21", "chars": [118, 301]})
# 'spdf:sha256-3f2a…#p=29&f=21&char=118,301'
spdf.parse_uri(uri)        # {"docref": "sha256-3f2a…", "locator": {"p": 29, "f": "21", "char": [118, 301]}}

spdf.cite({"type": "page", "physical": 9, "printed": "1r", "foliation": "leaf"}, doc, locale="es")
# '(Cervantes Saavedra, 1605, fol. 1r)'
spdf.cite({"type": "time", "t0": 4160.0, "t1": 4175.5}, doc, locale="en")
# '(Cortázar, 1959, 1:09:20)'
```

`f.locate(reference)` resolves an anchor URI, or the URL of a `.spdf` with an anchor
fragment, against the file (SPEC §5.4):

```python
f.locate("https://example.org/quijote.spdf#p=5&pe=6&char=101,278").to_dict()
# {"document": True, "units": ["p5", "p6"], "fragments": ["q4"], "char": [101, 278], "xywh": None}
```

Citations print only what the anchor says: inferred folios in brackets (`p. [21]`),
unnumbered pages as `s. p.` / `n. pag.`, leaves and columns (`fol. 1r`, `col. 45`),
`h:mm:ss` times, slides, sheets, verses and canonical references. Spanish uses `e` instead
of `y` before the sound /i/ (`Gómez e Iglesias`).

## Bibliography and other exports

| Export | API | CLI |
|---|---|---|
| CSL-JSON (Zotero, citeproc, Pandoc) | `f.to_csl_json()`, `spdf.bibliography.csl_citation_item()` | `spdf export -f csl` |
| BibTeX | `f.to_bibtex()` | `spdf export -f bibtex` |
| ALTO 4 XML (page units) | `f.to_alto()` | `spdf export -f alto` |
| TEI P5 (minimal: header, `pb`, `p`, `lg`/`l`, `u`, `note`) | `f.to_tei()` | `spdf export -f tei` |
| IIIF Presentation 3 manifest | `f.to_iiif(base_url)` | `spdf export -f iiif --base-url URL [--images-dir DIR]` |
| JSON Lines of fragments | `spdf.interop.frames.fragment_records(f)` | `spdf export -f jsonl` |
| pandas DataFrame | `f.to_pandas(vectors="space id")` | |
| Arrow table | `f.to_arrow(vectors="space id")` | |
| Canonical dump (JCS) | `f.dump()`, `f.dump_json()` | `spdf dump` |

ALTO has no invented coordinates: SPDF stores text per unit, so blocks and lines carry
none (they are optional in ALTO 4). The IIIF manifest paints each canvas with the page
image, adds the unit text as a `supplementing` annotation, figure descriptions as
`describing` annotations on `#xywh=percent:` regions, and sections as ranges; audio and
video become one time-based canvas with a range per unit.

## Annotations and collections

User annotations and libraries live outside the documents, as the specification's sidecar
files:

```python
from spdf import sidecars

with spdf.open("quijote.spdf") as f:
    hit = f.search("lanza en astillero")[0]
    note = sidecars.annotation(f, hit.fragment, body="Origen del tópico.")   # W3C Web Annotation
sidecars.write_annotations("notas.spdfa.json", [note], label="Notas de lectura")

lib = sidecars.library(["quijote.spdf", "lazarillo.spdf"], "Tesis: fuentes")
sidecars.write_library("fuentes.spdfl.json", lib)
```

Each annotation targets the document by identity (`spdf:sha256-…`) with an
`SpdfAnchorSelector` (the anchor URI) and a `TextQuoteSelector` (exact text with a little
context), so it survives a re-reading that shifts offsets.

## Command line

```text
spdf validate FILE… [--json]          exit status 1 if a file is invalid
spdf dump FILE [--pretty]             canonical dump (RFC 8785)
spdf info FILE | --env                summary; --env shows the SQLite and FTS5 in use
spdf search FILE QUERY [--vector JSON --space ID] [--mode lexical|vector|hybrid] [--json]
spdf cite FILE [--fragment ID | --unit ID | --uri URI] [--locale es|en] [--bibtex]
spdf export FILE -f csl|bibtex|alto|tei|iiif|jsonl
spdf convert OLD.spdf NEW.spdf        legacy 4.x to 5.0
spdf sign FILE --key KEY / spdf verify FILE [--public-key ed25519:…]
spdf conformance [DIR]                run the conformance suite, print the report
```

Other packages can add subcommands through the `spdf.commands` entry point group: the
entry point is a callable `register(subparsers)` that adds an `argparse` parser and sets
`func` (a handler returning the exit status). The SPDF producer adds `spdf build` this way:

```toml
[project.entry-points."spdf.commands"]
build = "spdf_build.cli:register"
```

## Safety

Files are untrusted input. `spdf.open` checks the SQLite header before SQLite sees the
file, decompresses gzip input to a private temporary file with a size limit (4 GiB by
default), opens the database read-only by URI (`mode=ro`) with `query_only`,
`trusted_schema=OFF`, `cell_size_check` and, on Python 3.12 or newer,
`SQLITE_DBCONFIG_DEFENSIVE`; it never loads extensions, refuses triggers, views and
virtual tables other than the format's FTS5 indexes (legacy files may keep their three FTS
triggers), refuses files that require unknown extensions, and enforces a maximum blob size
(512 MiB by default, `max_blob_size=`).

## FTS5 and Python builds

Lexical search, writing and the FTS integrity check need SQLite's FTS5, which depends on
how Python was built. It is present in the python.org installers, Homebrew, `uv python
install` (python-build-standalone), conda and the usual Linux distributions; CI checks
Linux, macOS and Windows with Python 3.10 to 3.13. `spdf info --env` tells you what you
have. Without FTS5, reading, vector search, citations, exports and validation still work,
and the operations that need it raise `spdf.Fts5UnavailableError` explaining what to do;
on Linux, `pip install pysqlite3-binary` is picked up automatically as a fallback driver.

## Conformance

The SPDF conformance suite lives in `conformance/` in the
[repository](https://github.com/joseluissaorin/spdf). Run it with:

```sh
spdf conformance path/to/conformance        # prints {"impl", "version", "passed", "failed", "skipped"}
```

This implementation claims every kind of case: `dump`, `legacy_dump`, `roundtrip`,
`validate`, `search_lexical`, `search_vector`, `search_hybrid`, `anchor_uri`, `cite`,
`quantize`, `locate`, `export_csl`, `export_bibtex` and `export_structure` (checked on
its own ALTO, TEI and IIIF output). CI publishes its report as the `conformance-python` artifact.

## Development

```sh
cd python
uv sync --group dev
uv run pytest
uv run ruff check src tests && uv run ruff format --check src tests
uv run mypy
```

## License

Code: MIT OR Apache-2.0, at your option. The SPDF specification is CC BY 4.0.
