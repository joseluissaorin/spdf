# spdf-format

Read, validate, search, cite and write **SPDF** files from JavaScript and TypeScript, in
Node, Bun, Deno, Cloudflare Workers and the browser.

SPDF (Semantic Processed Document Format) is an open format for documents that have been
read once and can be cited forever: every passage carries its exact anchor (printed page
or folio, second of a recording, slide, verse, canonical reference), so a citation can
only print what the source says. A `.spdf` file is a plain SQLite 3 database with
full-text indexes, optional embedding vectors and CSL-JSON metadata.
Specification: [`spec/SPEC.md`](https://github.com/joseluissaorin/spdf/blob/main/spec/SPEC.md).

This package is a native, independent implementation of SPDF 5.0 and of the legacy 4.0
and 4.1 formats (Scholaris).

- **No required dependencies.** Node uses the built-in `node:sqlite`, Bun uses
  `bun:sqlite`; in the browser it uses the official SQLite WebAssembly build
  (`@sqlite.org/sqlite-wasm`, an optional peer dependency). Gzip, SHA-256 and Ed25519 come
  from the platform (`zlib`, `DecompressionStream`, WebCrypto).
- **TypeScript first**: strict types, ESM only, declarations included.
- **Conforming reader, semantic reader, writer and validator**, profiles `core`,
  `semantic` and `media`: it passes the whole SPDF conformance suite (228 cases of suite
  0.2.0) with `node:sqlite` (Node 22, 24 and 26), with `bun:sqlite`, and with
  `sqlite-wasm` in Node and in Chromium.
- **Remote reading**: in the browser, `openRemote(url)` opens a file with HTTP Range
  requests and downloads only the pages a query touches (about 1 % of a 23 MiB book for a
  lexical search; figures below).

```sh
npm install spdf-format
npm install @sqlite.org/sqlite-wasm   # only for the browser, Deno or Workers
```

## Node

Node 22.13 or newer (22.5–22.12 with `--experimental-sqlite`). On Node 24 and later the
library works in memory (`serialize`/`deserialize`) and sets the defensive flag and the
value-size limit; on Node 22 it goes through a temporary file.

```ts
import { openSpdf, validate } from 'spdf-format';

const doc = await openSpdf('quijote.spdf'); // a path, bytes, or a Blob; 5.0 or legacy 4.x (gzip too)
console.log(doc.version, doc.document.metadata.title); // '5.0' 'El ingenioso hidalgo…'

for (const hit of await doc.searchLexical('lanza en astillero', { limit: 5 })) {
  console.log(doc.cite(hit.anchor, 'es', hit.anchor_end), hit.anchor_uri);
  // (Cervantes Saavedra, 1605, p. 23)  spdf:sha256-3f2a…#p=29&f=23&char=0,159
}

const page = await doc.unitByPrinted('23'); // the page whose printed folio is 23
await doc.close();

const report = await validate('quijote.spdf'); // { valid, version, profile, errors, warnings }
```

Lexical search follows the reference algorithm of the specification: words are OR-ed,
quoted phrases (`"…"`, `“…”`, `«…»`, `„…“`) are AND-ed, and case and diacritics are folded
by the FTS5 index (`unicode61 remove_diacritics 2`). Queries in Chinese, Japanese or Korean
use the `trigram` index when the file has one, and a substring scan otherwise.

```ts
const space = await doc.space('embeddinggemma-2@768'); // model, dims, dtype, task prefixes
const q = await myModel.embed(`${space.task_prefixes?.query ?? ''}lanza en astillero`);
await doc.searchVector(space.id, q, { limit: 5 }); // brute force, f32 / f16 / i8
await doc.searchHybrid('lanza en astillero', q, space.id, { limit: 5 }); // RRF, k = 10
```

## Browser

```ts
import { configureBrowserEngine, openSpdf, openRemote, openBlob } from 'spdf-format';
// Only if your bundler moves sqlite3.wasm (esbuild, plain copies): tell the engine where it is.
configureBrowserEngine({ wasmUrl: '/assets/sqlite3.wasm' });

const fromBytes = await openSpdf(await (await fetch('/quijote.spdf')).arrayBuffer());
const fromFile = await openBlob(fileInput.files[0]); // lazy inside a Worker (FileReaderSync)
const remote = await openRemote('https://example.org/quijote.spdf'); // HTTP Range requests
console.log(remote.source.stats()); // { requests, bytesFetched, chunksUsed, chunkSize }
```

- `openRemote` reads synchronously inside SQLite's VFS (synchronous `XMLHttpRequest`), so
  run it in a **Web Worker**; it also works on the main thread, where browsers warn about
  synchronous requests. Cross-origin servers must allow the `Range` request header and
  expose `Content-Range` (`Access-Control-Expose-Headers: Content-Range`). If the server
  ignores ranges, the file is downloaded whole (`fallbackToDownload: false` turns that
  into an error). Legacy gzip files are always downloaded whole.
- `storage: 'opfs'` (or `'auto'`) keeps opened and written databases in the Origin
  Private File System (`opfs-sahpool` VFS, Workers only) instead of the WebAssembly heap:
  `configureBrowserEngine({ storage: 'auto' })`.
- In Cloudflare Workers, where WebAssembly cannot be compiled at run time, initialize
  sqlite-wasm yourself with the precompiled module and pass it:
  `import { wasmEngine } from 'spdf-format/wasm'; openSpdf(bytes, { engine: wasmEngine({ sqlite3 }) })`.

### What a remote search costs

Measured in Chromium 153 (headless) inside a Web Worker, on a 23.11 MiB SPDF of the whole
*Don Quijote* (Project Gutenberg #2000: 1 382 pages, 2 723 fragments, one 768-dimension
f32 space for fragments and pages), each operation on a freshly opened file, so the
figures include opening it (`test/browser/run.mjs`):

| Operation | Downloaded | Requests | Share of the file |
|---|---:|---:|---:|
| Open (header, schema, meta, document) | 32 KiB | 8 | 0.14 % |
| Lexical search `Rocinante` (10 hits) | 180 KiB | 34 | 0.76 % |
| Lexical search `molinos de viento` | 244 KiB | 44 | 1.03 % |
| Lexical search `"Dulcinea del Toboso"` (phrase) | 216 KiB | 43 | 0.91 % |
| Lexical search `hidalgo de la Mancha` | 268 KiB | 52 | 1.13 % |
| The same lexical search again | 0 | 0 | cached |
| `unit(700)` and its fragments | 72 KiB | 18 | 0.30 % |
| Vector search, 768 × f32, brute force | 10.95 MiB | 811 | 47.4 % |
| Hybrid search | 11.27 MiB | 869 | 48.8 % |

Pages are fetched in 4 KiB chunks with an adaptive read-ahead (sequential misses double
the next request up to 256 KiB) and an LRU cache of 64 MiB. Lexical results are ranked
inside the FTS index and only the hits are read from `fragments`, which keeps a search at
about 1 % of the file. Vector search is brute force by definition and reads every vector
of the space: for remote use, ship an `i8` space (a quarter of the bytes) or query a
server.

## Bun

```ts
import { openSpdf } from 'spdf-format'; // resolves to bun:sqlite under Bun
const doc = await openSpdf('quijote.spdf');
```

Bun's binding has no switch for `SQLITE_DBCONFIG_DEFENSIVE` nor for value-size limits;
read-only mode, `query_only` and `trusted_schema = OFF` still apply.

## Writing

```ts
import { SpdfWriter, convertLegacy, generateSigningKey } from 'spdf-format';

const w = await SpdfWriter.create();
await w.setDocument({
  id: 'quijote-1605', kind: 'scanned_pdf', mime: 'application/pdf', bytes: 123456,
  source_sha256: '3f2a…', // SHA-256 of the original
  metadata: { type: 'book', title: 'El ingenioso hidalgo don Quijote de la Mancha',
              author: [{ family: 'Cervantes Saavedra', given: 'Miguel de' }], issued: { 'date-parts': [[1605]] } },
});
await w.addUnits([{ id: 'p29', anchor: { type: 'page', physical: 29, printed: '21' }, text: '…', reader: 'pdf-text-layer' }]);
await w.addFragments([{ id: 'f1', unit: 'p29', text: '…', anchor: { type: 'page', physical: 29, printed: '21', chars: [0, 159] } }]);
const space = await w.addSpace({ provider: 'google', model: 'embeddinggemma-2', dims: 768, dtype: 'i8', modalities: ['text'] });
await w.addVectors(space, [{ target: 'fragment', id: 'f1', vector: embedding }]); // quantized to i8
const { privateKey } = await generateSigningKey();
const bytes = await w.finish({ signWith: privateKey }); // FTS rebuilt, VACUUM, content_sha256 + Ed25519

const v50 = await convertLegacy(legacyBytes); // a Scholaris 4.x file (gzip) as SPDF 5.0
const copy = await SpdfWriter.fromSpdf(doc); // a full 5.0 copy, e.g. to add a vector space
```

## API at a glance

| Area | Functions |
|---|---|
| Open | `openSpdf(input, opts)`, `openRemote(url)`, `openBlob(blob)` (browser), `validate(input)`, `dump(input)` |
| Document | `doc.version`, `doc.legacy`, `doc.meta`, `doc.document`, `units()`, `unit(ord)`, `unitByPrinted()`, `sections()`, `fragments()`, `fragment(id)`, `figures()`, `spaces()`, `vectors()`, `blob(key)`, `blobs()`, `provenance()`, `extensions()`, `dump()`, `validate()` |
| Search | `doc.searchLexical(q)`, `doc.searchVector(space, vec)`, `doc.searchHybrid(q, vec, space)` |
| Anchors | `formatAnchorUri(docref, anchor, end)`, `parseAnchorUri(uri)`, `locatorToAnchor()`, `checkAnchor()` |
| Citation | `cite(anchor, document, locale, end)`, `doc.cite(anchor, locale, end)` (es, en) |
| Export | `toCslJson()`, `toCslJsonArray()`, `cslCitationItem()`, `toBibtex()` |
| Write | `SpdfWriter.create()`, `.fromSpdf()`, `.fromSource()`, `convertLegacy()`, `encodeVector()` |
| Integrity | `doc.contentSha256()`, `doc.verifyIntegrity(publicKey?)`, `verifySignature()`, `generateSigningKey()` |
| Engines | `nodeEngine()`, `bunEngine()`, `wasmEngine()`, `setDefaultEngine()`; the port is `SqlEngine`/`SqlConnection` |

Entry points: `spdf-format` (picks Node, Bun or the browser by export condition),
`spdf-format/node`, `spdf-format/bun`, `spdf-format/browser`, `spdf-format/core` (no
engine; pass `{ engine }`), `spdf-format/wasm` and `spdf-format/cli`.

## Command line

```sh
npx spdf-format validate quijote.spdf          # exit status 1 if invalid
npx spdf-format dump quijote.spdf --pretty     # canonical JSON dump (JCS without --pretty)
npx spdf-format search quijote.spdf molinos de viento --limit 5
npx spdf-format cite quijote.spdf f12 --locale en
npx spdf-format cite quijote.spdf --bibtex
npx spdf-format convert legacy-4.1.spdf out.spdf --hash
npx spdf-format conformance path/to/spdf/conformance
```

## Safety

Files come from strangers. Every file is opened read-only, with `query_only`,
`trusted_schema = OFF`, `mmap_size = 0`, `cell_size_check = ON`, the defensive flag where
the binding has it, no extensions, a 512 MiB limit for any single value
(`SQLITE_LIMIT_LENGTH` with `node:sqlite` on Node 24+ and with sqlite-wasm; checked by the
library for blobs elsewhere) and a 4 GiB limit for gzip input. Files with triggers, views
or virtual tables other than the FTS5 indexes are refused (`E020`), except the three FTS
triggers of legacy 4.x files. Write operations of the validator (the FTS
`integrity-check`) run on a private in-memory copy.

## Conformance

`npm test` runs the unit tests and the whole shared suite with `node:sqlite` and
`sqlite-wasm`; `npm run test:bun` runs it with `bun:sqlite`; `npm run test:browser` runs
it in headless Chromium (Playwright, `--mute-audio`) together with the remote-reading,
OPFS and Blob tests. CI uploads the runner report as the `conformance-js` artifact.

## License

MIT OR Apache-2.0, at your option.
