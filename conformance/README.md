# SPDF conformance suite

The suite every SPDF implementation runs, whatever its language. A case is a small
JSON file with an input and the exact expected output; an implementation is
conformant for a kind of case when it passes every case of that kind.

Normative text: [`spec/SPEC.md`](../spec/SPEC.md) (while it is written,
[`spec/CONTRACT.md`](../spec/CONTRACT.md)). Suite version and case count:
[`manifest.json`](manifest.json). Changes: [`CHANGELOG.md`](CHANGELOG.md).

## Layout

| Path | What | Made by |
|---|---|---|
| `sources/*.json` | SPDF 5.0 documents in the canonical dump format, plus vector values (`vectors.<space>.items`) and blob bytes (`blobs[].data_base64`) | hand, then `generar.py --sellar` fills hashes and signatures |
| `legacy-sources/*.json` | native rows of legacy 4.0 / 4.1 files (Spanish schema) | hand |
| `files/*.spdf` | SPDF 5.0 files built from `sources/` | `tools/generar.py` |
| `legacy/*.spdf` | authentic 4.0 / 4.1 files: Scholaris schema verbatim, FTS triggers, gzip-wrapped | `tools/generar.py` |
| `invalid/*.spdf` | one broken rule per file (named after its code); also valid files that must raise a warning | `tools/generar.py` |
| `expected/*.dump.json` | canonical dumps | `tools/generar.py` |
| `cases/*.json` | one case per file | `tools/generar.py` |
| `manifest.json` | suite version, case count per kind, hash of all cases, public test key | `tools/generar.py` |
| `tools/spdfref.py` | the reference oracle (Python standard library only) | hand |
| `tools/manual/*.json` | hand-written anchor URI and citation cases, search queries | hand |

All documents are short excerpts of public-domain works (Cervantes, the anonymous
*Lazarillo*, Bécquer, Hooke, Darwin, the *Analects*, NASA air-to-ground transmissions,
Garcilaso, J. F. Kennedy). Their layout, folios, timings and source hashes are synthetic
and say so in each document's CSL `note`. The Ed25519 key that signs `files/quijote.spdf`
is a public test key derived in `generar.py`; never trust it for anything else.

## Regenerating and checking

```sh
python3 conformance/tools/generar.py            # rebuild everything (deterministic)
python3 conformance/tools/generar.py --sellar   # after editing sources/*.json by hand
python3 conformance/tools/verificar.py          # what CI runs
```

Python 3.13, standard library only (`sqlite3` with FTS5, as shipped by python.org and
every major distribution). `verificar.py` checks that every case is well formed, that two
runs of the generator give the same bytes for every JSON output and the same dumps for
every `.spdf`, that the committed outputs are current, and that the reference passes all
cases. SQLite writes its own version into file headers, so `.spdf` bytes may differ
between machines; dumps may not.

How expectations are made, so nobody has to trust a single implementation:

- **Dumps**: the expected dump of a 5.0 file *is* its source minus vector values and blob
  bytes. The generator writes the file, dumps it back and stops if they differ.
- **Lexical search**: computed by SQLite itself running the reference SQL of the
  specification. SQLite is the oracle.
- **Vector and hybrid search**: dyadic vectors (exact in f32 and f16), checked with exact
  rational arithmetic; consecutive scores are at least 1e-4 apart, so there are no ties.
- **Anchor URIs and citations**: written and reviewed by hand in `tools/manual/`; the
  generator refuses to emit them if the reference disagrees.
- **Validation**: each invalid file breaks one rule on purpose; the expected codes are
  declared next to the mutation that breaks it.

## Case format

```json
{"id": "cite-page-inferred-es", "kind": "cite", "input": {…}, "expect": {…}}
```

`id` equals the file name. Paths inside `input` and `expect` are relative to
`conformance/`. Shapes per `kind`:

| kind | input | expect | pass when |
|---|---|---|---|
| `dump` | `file` | `dump` (path), `content_sha256` | `dump(file)` equals the expected dump as JSON values, **and** SHA-256 of its RFC 8785 (JCS) serialization, without `meta.content_sha256`/`signature`/`signer`, equals `content_sha256` |
| `legacy_dump` | `file` | `dump`, `content_sha256` | same, for a legacy 4.x file (5.0 view, `"legacy": true`) |
| `roundtrip` | `source` | `dump` | building a file from the source with your writer, then dumping it, gives the expected dump |
| `validate` | `file` | `valid`, `version`, `errors`, `warnings` | same `valid` and `version`; the **sets** of codes are equal (messages are free) |
| `search_lexical` | `file`, `query`, `limit` | `route`, `match`, `results` | same result ids in the same order, scores within 1e-6, same `anchor_uri` and `via`; `route` (`fts`, `trigram`, `substring`) and `match` (the FTS5 MATCH string, or null) SHOULD be compared too |
| `search_vector` | `file`, `space`, `target`, `query_vector`, `limit` | `results` | same ids, order, scores (1e-6) and `anchor_uri` |
| `search_hybrid` | `file`, `query`, `space`, `query_vector`, `limit` | `results` | same ids, order, scores (1e-6), `via` and `anchor_uri` |
| `anchor_uri` (format) | `docref`, `anchor`, `anchor_end` | `uri`, `locator` | `format(docref, anchor, anchor_end) == uri`; `parse(uri) == {docref, locator}`; `format(parse(uri)) == uri` |
| `anchor_uri` (parse) | `uri` | `docref`, `locator`, `canonical` | `parse(uri) == {docref, locator}` and `format(parse(uri)) == canonical` |
| `anchor_uri` (error) | `uri` | `{"error": true}` | `parse(uri)` fails |
| `cite` | `anchor`, `anchor_end`, `metadata` (CSL-JSON item), `locale` | `text` | `cite(...) == text`, byte for byte |
| `quantize` | `dtype` (`f32`, `f16`, `i8`), `values` | `hex` or `{"error": true}` | encoding the values as a writer would gives these little-endian bytes (lowercase hex), or fails for out-of-range values |

A search result item is `{"fragment_id", "score", "anchor_uri"}` plus `"via"` for lexical
and hybrid searches. JSON values compare structurally: numbers as IEEE doubles (`1` and
`1.0` are equal), object key order irrelevant, arrays in order.

## The runner

Every implementation ships a runner (a CLI command or a test target) that executes all
cases and prints one JSON object on standard output, also saved as `conformance.json`:

```json
{"impl": "spdf-format (TypeScript)", "version": "0.1.0",
 "passed": ["cite-page-es", "…"],
 "failed": [{"id": "dump-darwin", "reason": "vectors.toy-embedding@8.sha256 differs"}],
 "skipped": [{"id": "roundtrip-darwin", "reason": "reader-only build"}]}
```

- A case that throws is a failure, never a pass.
- `skipped` is allowed only for a whole kind the implementation does not claim (a
  reader-only library skips `roundtrip` and `quantize`); say which kinds in the
  implementation README.
- The process exits non-zero if `failed` is not empty. CI fails on any failure.
- New cases appear over time: a runner MUST discover them by listing `cases/*.json`,
  never from a hard-coded list.

`python3 conformance/tools/verificar.py --runner` is the reference runner and shows the
expected report format.

## CI convention

- Each implementation folder has its own workflow `.github/workflows/<folder>.yml` that
  runs its runner against this directory and uploads an artifact named
  `conformance-<folder>` (for example `conformance-rust`) containing its
  `conformance.json`.
- The suite's own workflow (`.github/workflows/conformance.yml`) runs `verificar.py` and
  uploads `conformance-suite` with `manifest.json` (case count and `cases_sha256`) and the
  reference runner report. Comparing an implementation's `passed` list with the
  manifest's case count gives its coverage; the status table in the root README is built
  from these artifacts.

## Adding cases

1. Edit or add a source in `sources/` (canonical dump format) or a hand-written case in
   `tools/manual/`. Only public-domain texts whose status anyone can verify.
2. `python3 conformance/tools/generar.py --sellar`, then `verificar.py`.
3. Add a line to `CHANGELOG.md`. Cases are never renamed or reused for something else:
   a wrong case is fixed in place and the change is logged; a removed case keeps its id
   retired.
