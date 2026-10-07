# spdf-llamaindex

A [LlamaIndex.TS](https://ts.llamaindex.ai) reader for
[SPDF](https://spdf.joseluissaorin.com) files. Every passage becomes a
`Document` with its **literal text** and, in the metadata, its **citation with
the exact printed folio** (or second, slide, verse) and its **anchor URI**, so a
retrieval-augmented answer can cite the page a reader will find on paper instead
of a chunk number. It can also hand over the **vectors already stored in the
file**, so an index can be built without embedding anything again.

It sits on [`spdf-format`](../../js), the official TypeScript implementation:
the citation is computed from the anchor stored in the file, never generated.

## Install

```sh
npm install spdf-llamaindex @llamaindex/core
```

## Use

```js
import { VectorStoreIndex } from 'llamaindex';
import { SpdfReader } from 'spdf-llamaindex';

const docs = await new SpdfReader({ locale: 'en' }).loadData('library/');
docs[0].metadata.citation;      // '(Darwin, 1859, p. 21)'
docs[0].metadata.anchor_uri;    // 'spdf:sha256-…#p=29&f=21&char=118,301'

const index = await VectorStoreIndex.fromDocuments(docs);
const nodes = await index.asRetriever({ similarityTopK: 5 }).retrieve('natural selection');
nodes.map((n) => n.node.metadata.citation);
```

The `citation` is visible to the LLM (`MetadataMode.LLM`), so a query engine's
answer can quote it; the anchor JSON, hashes and identifiers are excluded from
the text that gets embedded (`EXCLUDED_EMBED_METADATA`, `EXCLUDED_LLM_METADATA`).

With `SimpleDirectoryReader`, register it for the extension:
`fileExtToReader: { spdf: new SpdfReader() }` (it implements `loadDataAsContent`).

### Reusing the stored vectors

```js
const docs = await new SpdfReader({ embeddingsFrom: 'all-MiniLM-L6-v2@384' }).loadData('library/');
// docs[i].embedding is set from the file: index with an embed model of the same space.
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `granularity` | `'fragment'` | `'fragment'` (passages of 150 to 300 words) or `'unit'` (whole pages, time spans, slides) |
| `locale` | `'en'` | Language of `citation`: `'en'` or `'es'` |
| `recursive` | `true` | Descend into subfolders |
| `skipInvalid` | `false` | Skip files that cannot be opened safely instead of failing |
| `embeddingsFrom` | none | A vector space stored in the files: sets `Document.embedding` |

## Metadata

Scalars only (string, number or boolean; keys with a null value are left out): `citation`, `anchor_uri`,
`printed_folio`, `physical_page`, `folio_inferred`, `t0`/`t1`/`speaker`,
`slide`, `line_from`/`line_to`, `title`, `authors`, `year`, `language`, `kind`,
`section`, `context`, `fragment_id` or `unit_id`, `ord`, `spdf_doc_id`, `docref`,
`source`, `spdf_version`, and the full `anchor`/`anchor_end` as JSON strings.
See the table in [`spdf-langchain`](../langchain-js/README.md#metadata).

## Tests

```sh
cd js && npm ci && npm run build           # the official library, once
cd integrations/llamaindex-js && npm ci && npm test
```

They run against [`../fixtures`](../fixtures) and build a `VectorStoreIndex`
with a deterministic toy embedding (no network, no keys) to check that
retrieved nodes keep their citation.

## Licence

MIT OR Apache-2.0.
