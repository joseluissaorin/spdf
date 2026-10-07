# spdf-langchain

A [LangChain.js](https://js.langchain.com) document loader for
[SPDF](https://spdf.joseluissaorin.com) files. Every passage becomes a
`Document` with its **literal text** and, in the metadata, its **citation with
the exact printed folio** (or second, slide, verse) and its **anchor URI**, so a
retrieval-augmented answer can cite the page a reader will find on paper instead
of a chunk number.

It sits on [`spdf-format`](../../js), the official TypeScript implementation:
the citation is computed from the anchor stored in the file, never generated.

## Install

```sh
npm install spdf-langchain @langchain/core
```

## Use

```js
import { SpdfLoader } from 'spdf-langchain';

const docs = await new SpdfLoader('darwin-origin.spdf').load();
docs[0].pageContent;            // the literal passage
docs[0].metadata.citation;      // '(Darwin, 1859, p. 21)'
docs[0].metadata.anchor_uri;    // 'spdf:sha256-…#p=29&f=21&char=118,301'

// A folder (recursive), Spanish citations, one document per page, skipping broken files:
const pages = await new SpdfLoader('library/', { locale: 'es', granularity: 'unit', skipInvalid: true }).load();

// Streaming:
for await (const d of new SpdfLoader('library/').lazyLoad()) console.log(d.metadata.citation);
```

When you answer from retrieved documents, quote `pageContent` and cite with
`metadata.citation`; keep `metadata.anchor_uri` next to the claim.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `granularity` | `'fragment'` | `'fragment'` (passages of 150 to 300 words, the unit SPDF searches and cites) or `'unit'` (whole pages, time spans, slides) |
| `locale` | `'en'` | Language of `citation`: `'en'` or `'es'` |
| `recursive` | `true` | Descend into subfolders |
| `skipInvalid` | `false` | Skip files that cannot be opened safely (with a warning on stderr) instead of failing |
| `embeddingsFrom` | none | A vector space stored in the files (for example `all-MiniLM-L6-v2@384`): its vector goes to `metadata.embedding`, so you can index without re-embedding when your query model is the same |

## Metadata

All values are scalars (string, number or boolean) and keys whose value would be null are left out, so every vector store accepts them (Chroma, for one, rejects nulls). The keys match the Python loaders.

| Key | Example |
| --- | --- |
| `citation` | `(Saorín Ferrer, 2026, p. 1)`; `p. [3]` when the folio was inferred; `n. pag.` (`s. p.`) when the page has none |
| `anchor_uri` | `spdf:sha256-50d9…#p=2&f=1&char=15,307` |
| `printed_folio`, `physical_page`, `folio_inferred` | `'1'`, `2`, `false` (page anchors; no `printed_folio` key when the page has none) |
| `t0`, `t1`, `speaker` | seconds (time anchors) |
| `slide`, `line_from`, `line_to` | slides and verses |
| `title`, `authors`, `year`, `language`, `kind` | from the CSL record |
| `section`, `context` | `'I. Anchors'`, one line situating the passage |
| `fragment_id` or `unit_id`, `ord`, `spdf_doc_id`, `docref`, `source`, `spdf_version`, `anchor_type` | identifiers (`spdf_doc_id`, not `doc_id`: vector stores and parent-document retrievers overwrite `doc_id`) |
| `anchor`, `anchor_end` | the full anchors as JSON strings |

## Tests

```sh
cd js && npm ci && npm run build           # the official library, once
cd integrations/langchain-js && npm ci && npm test
```

They run against [`../fixtures`](../fixtures) and include a LangChain retriever
over an in-memory vector store that returns documents with their citation intact.

## Licence

MIT OR Apache-2.0.
