# spdf-llamaindex

A [LlamaIndex](https://www.llamaindex.ai/) reader for **SPDF** files (Semantic Processed
Document Format), so that retrieval-augmented answers cite the printed page instead of a
chunk number.

An SPDF file is a SQLite database holding one document that has already been read: every
passage (fragment) carries its exact anchor (physical page and printed folio, second of a
recording, slide, verse…). `SpdfReader` turns each passage into a LlamaIndex `Document`
whose metadata holds a ready-made short citation such as `(Saorín Ferrer, 2026, p. 1)` and
a portable anchor URI such as `spdf:sha256-…#p=2&f=1&char=15,307`, both computed by the
official library [`spdf-format`](../../python).

## Install

```bash
pip install spdf-llamaindex
```

Requires Python 3.10 or later, `llama-index-core>=0.12` and `spdf-format` (standard
library only). From a checkout of the repository:

```bash
pip install -e python/ -e "integrations/llamaindex-python[test]"
```

## Usage

```python
from spdf_llamaindex import SpdfReader

reader = SpdfReader(locale="en")
docs = reader.load_data("spdf-in-five-pages.spdf")   # a file, a folder or a list of both

docs[0].text                     # the literal passage, exactly as in the source
docs[0].metadata["citation"]     # '(Saorín Ferrer, 2026, p. 1)'
docs[0].metadata["anchor_uri"]   # 'spdf:sha256-5428…d23f#p=2&f=1&char=15,307'
docs[0].id_                      # 'sha256-5428…d23f:f2-1' (stable across runs)
```

- A **folder** is searched recursively for `*.spdf` files (hidden files and folders are
  skipped); a **list** may mix files and folders. `lazy_load_data()` yields the documents
  one by one, one file open at a time.
- With `SimpleDirectoryReader`, register the reader for the extension:
  `SimpleDirectoryReader("library/", file_extractor={".spdf": SpdfReader()})`.
  An `fsspec` filesystem passed as `fs=` is honoured.
- `extra_info={...}` adds metadata to every document (and wins over the reader's keys).
- Unsafe or invalid files are refused by `spdf-format`: loading one raises its error
  (`spdf.UnsafeFileError`, `spdf.NotSpdfError`…, all subclasses of `spdf.SpdfError`) with
  the validation code (`E020`…) and the file path in the message. A missing path raises
  `FileNotFoundError`.
- Legacy SPDF 4.0 and 4.1 files (also gzip-wrapped) read like 5.0 ones.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `granularity` | `"fragment"` | `"fragment"`: one document per passage (about 150 to 300 words). `"unit"`: one per page, time span, slide… |
| `locale` | `"en"` | Locale of `citation`: `"en"` or `"es"` (`"es-ES"` works; others fall back to English). |
| `include_embeddings` | `None` | Id of a vector space stored in the files (`"all-MiniLM-L6-v2@384"`). Sets `Document.embedding` from the stored vectors, so that an index whose embedding model matches that space does not embed the passages again. A file without that space raises `spdf.SpdfError`; a passage without a stored vector keeps `embedding=None` and is embedded by the index. |
| `excluded_embed_metadata_keys` | all but `title`, `section` | Keys kept out of the text that is embedded. |
| `excluded_llm_metadata_keys` | all but `title`, `authors`, `year`, `section`, `citation` | Keys hidden from the LLM. By default the LLM sees the `citation` line next to each passage and can copy it into its answer. |

## Metadata

Values are flat scalars (`str`, `int`, `float`, `bool`), so every vector store accepts
them. **A key whose value would be null is left out** (Chroma and others reject `None`):
the cover of a book has no `printed_folio` key, a page has no `t0`.

| Key | Type | Example (first passage of the English fixture) | Notes |
| --- | --- | --- | --- |
| `source` | str | `fixtures/spdf-in-five-pages.spdf` | Path the file was read from. |
| `spdf_version` | str | `5.0` | `4.0` or `4.1` for legacy files. |
| `spdf_doc_id` | str | `spdf-in-five-pages` | The document id inside the file. Not called `doc_id`: LlamaIndex vector stores overwrite `doc_id`, `document_id` and `ref_doc_id` with the node's reference document id. |
| `docref` | str | `sha256-54284912…d23f` | Document reference used by anchor URIs (SHA-256 of the original). |
| `title` | str | `SPDF in five pages` | |
| `authors` | str | `Saorín Ferrer` | |
| `year` | int | `2026` | |
| `language` | str | `en` | BCP 47. |
| `kind` | str | `pdf` | `pdf`, `epub`, `audio`, `video`… |
| `fragment_id` | str | `f2-1` | Fragment granularity only. |
| `unit_id` | str | `u2` | The unit (page…) where the passage starts. |
| `anchor_type` | str | `page` | `page`, `time`, `section`, `slide`, `sheet`, `web`, `image`, `verse`, `canonical`. |
| `physical_page` | int | `2` | Page anchors: position of the page in the file. |
| `printed_folio` | str | `1` | The folio as printed (`"xiv"`, `"1r"`). |
| `folio_inferred` | bool | `false` | True when the folio was deduced, not read; the citation prints it in brackets, `p. [3]`. |
| `section` | str | `I. Anchors` | Heading path joined with `" / "`. In unit granularity, the sections that share the unit are joined with `" \| "`. |
| `context` | str | `SPDF in five pages, I. Anchors` | One line that situates the passage (fragment granularity). |
| `anchor` | str | `{"chars":[15,307],"confidence":1,"physical":2,"printed":"1","source":"read","type":"page"}` | The start anchor as canonical JSON; `json.loads` it for the full object. |
| `anchor_end` | str | | End anchor (JSON) when the passage crosses into another unit. |
| `t0`, `t1` | float | | Seconds, for time anchors (recordings). |
| `anchor_uri` | str | `spdf:sha256-54284912…d23f#p=2&f=1&char=15,307` | Resolve it with `spdf.open(path).locate(uri)`; parse it with `spdf.parse_uri`. |
| `citation` | str | `(Saorín Ferrer, 2026, p. 1)` | Short author-date citation in the chosen locale. |
| `vector_space` | str | `all-MiniLM-L6-v2@384` | Only when `include_embeddings` attached a vector. |

The document text is always the literal passage (`fragments.text` or `units.text`), never
the modernised-spelling search layer, which SPDF forbids quoting.

## End-to-end example (no API key)

A complete retrieval-augmented query with a toy embedding and LlamaIndex's `MockLLM`;
swap them for your models. The sources of the answer carry their citations.

```python
import hashlib
import math
import re

from llama_index.core import VectorStoreIndex
from llama_index.core.embeddings import BaseEmbedding
from llama_index.core.llms import MockLLM

from spdf_llamaindex import SpdfReader


class HashingEmbedding(BaseEmbedding):
    """A toy bag-of-words embedding: no model to download, no API key."""

    dim: int = 512

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * self.dim
        for word in re.findall(r"\w+", text.lower()):
            v[int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dim] += 1.0
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def _get_text_embedding(self, text: str) -> list[float]:
        return self._vec(text)

    def _get_query_embedding(self, query: str) -> list[float]:
        return self._vec(query)

    async def _aget_query_embedding(self, query: str) -> list[float]:
        return self._vec(query)


docs = SpdfReader(locale="en").load_data("integrations/fixtures/spdf-in-five-pages.spdf")
index = VectorStoreIndex(docs, embed_model=HashingEmbedding())

engine = index.as_query_engine(llm=MockLLM(), similarity_top_k=2)
response = engine.query("How is a plate without a printed folio cited?")
for source in response.source_nodes:
    print(source.node.metadata["citation"], source.node.metadata["anchor_uri"])
```

Output:

```text
(Saorín Ferrer, 2026, p. [3]) spdf:sha256-54284912…d23f#p=4&f=3&char=0,133
(Saorín Ferrer, 2026, p. 2) spdf:sha256-54284912…d23f#p=3&f=2&char=19,258
```

The plate carries no printed number; its folio is inferred, so the citation prints it in
brackets. What the LLM receives for each passage is:

```text
title: SPDF in five pages
authors: Saorín Ferrer
year: 2026
section: III. Read once, query many
citation: (Saorín Ferrer, 2026, p. [3])

Plate I. A page with its folio and a manicule pointing at a passage. …
```

Fragments are already passage-sized, so the example passes the documents straight to
`VectorStoreIndex(docs, …)`. `VectorStoreIndex.from_documents(docs, …)` also works (the
splitter copies the metadata to every node), but it creates new nodes without the stored
embeddings.

## Reusing the vectors stored in the file

SPDF files may ship vectors (`f.spaces()` in `spdf-format` lists them, with model, size and
any task prefixes). When your embedding model is the one that produced a space, load the
vectors instead of embedding every passage again:

```python
from llama_index.core import VectorStoreIndex
from llama_index.embeddings.huggingface import HuggingFaceEmbedding  # pip install llama-index-embeddings-huggingface

from spdf_llamaindex import SpdfReader

docs = SpdfReader(include_embeddings="all-MiniLM-L6-v2@384").load_data("library/")
embed = HuggingFaceEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")  # local, embeds queries only
index = VectorStoreIndex(docs, embed_model=embed)   # not from_documents: keep the stored vectors
print(index.as_retriever().retrieve("inferred folio")[0].node.metadata["citation"])
```

## Development

```bash
cd integrations/llamaindex-python
uv venv && uv pip install -e ../../python -e ".[test]"
.venv/bin/python -m pytest
```

The tests use the shared fixtures in `integrations/fixtures/`.

## License

MIT OR Apache-2.0, at your option.
