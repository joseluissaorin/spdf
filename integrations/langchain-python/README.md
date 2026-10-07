# spdf-langchain

A [LangChain](https://www.langchain.com/) document loader for **SPDF** files (Semantic
Processed Document Format), so that retrieval-augmented answers cite the printed page
instead of a chunk number.

An SPDF file is a SQLite database holding one document that has already been read: every
passage (fragment) carries its exact anchor (physical page and printed folio, second of a
recording, slide, verse…). `SpdfLoader` turns each passage into a LangChain `Document`
whose metadata holds a ready-made short citation such as `(Saorín Ferrer, 2026, p. 1)` and
a portable anchor URI such as `spdf:sha256-…#p=2&f=1&char=15,307`, both computed by the
official library [`spdf-format`](../../python).

## Install

```bash
pip install spdf-langchain
```

Requires Python 3.10 or later, `langchain-core>=0.3` and `spdf-format` (standard library
only). From a checkout of the repository:

```bash
pip install -e python/ -e "integrations/langchain-python[test]"
```

## Usage

```python
from spdf_langchain import SpdfLoader

loader = SpdfLoader("spdf-in-five-pages.spdf", locale="en")   # a file, a folder or a list of both
docs = loader.load()                  # or: for doc in loader.lazy_load(): ...

docs[0].page_content                  # the literal passage, exactly as in the source
docs[0].metadata["citation"]          # '(Saorín Ferrer, 2026, p. 1)'
docs[0].metadata["anchor_uri"]        # 'spdf:sha256-50d9…5f4c#p=2&f=1&char=15,307'
docs[0].id                            # 'sha256-50d9…5f4c:f2-1' (stable across runs)
```

- A **folder** is searched recursively for `*.spdf` files (hidden files and folders are
  skipped); a **list** may mix files and folders. `lazy_load()` yields the documents one by
  one, one file open at a time; `load()`, `aload()` and `alazy_load()` come from
  `BaseLoader`.
- Unsafe or invalid files are refused by `spdf-format`: loading one raises its error
  (`spdf.UnsafeFileError`, `spdf.NotSpdfError`…, all subclasses of `spdf.SpdfError`) with
  the validation code (`E020`…) and the file path in the message. A missing path raises
  `FileNotFoundError`.
- Legacy SPDF 4.0 and 4.1 files (also gzip-wrapped) read like 5.0 ones.
- Vector stores in recent `langchain-core` versions take the ids from `Document.id`; with
  older ones, pass them yourself: `store.add_documents(docs, ids=[d.id for d in docs])`.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `granularity` | `"fragment"` | `"fragment"`: one document per passage (about 150 to 300 words). `"unit"`: one per page, time span, slide… |
| `locale` | `"en"` | Locale of `citation`: `"en"` or `"es"` (`"es-ES"` works; others fall back to English). |
| `with_vectors` | `None` | Id of a vector space stored in the files (`"all-MiniLM-L6-v2@384"`). Puts the stored vector in `metadata["vector"]` (a list of floats) and the space id in `metadata["vector_space"]`. Off by default, because most vector stores expect flat metadata. A file without that space raises `spdf.SpdfError`. |

## Metadata

Values are flat scalars (`str`, `int`, `float`, `bool`), so every vector store accepts
them (the only exception is `vector`, and only if you ask for it). **A key whose value
would be null is left out** (Chroma and others reject `None`): the cover of a book has no
`printed_folio` key, a page has no `t0`.

| Key | Type | Example (first passage of the English fixture) | Notes |
| --- | --- | --- | --- |
| `source` | str | `fixtures/spdf-in-five-pages.spdf` | Path the file was read from. |
| `spdf_version` | str | `5.0` | `4.0` or `4.1` for legacy files. |
| `spdf_doc_id` | str | `spdf-in-five-pages` | The document id inside the file. Not called `doc_id`, which LangChain's multi-vector and parent-document retrievers (and LlamaIndex vector stores) use for their own ids. |
| `docref` | str | `sha256-50d94244…5f4c` | Document reference used by anchor URIs (SHA-256 of the original). |
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
| `anchor_uri` | str | `spdf:sha256-50d94244…5f4c#p=2&f=1&char=15,307` | Resolve it with `spdf.open(path).locate(uri)`; parse it with `spdf.parse_uri`. |
| `citation` | str | `(Saorín Ferrer, 2026, p. 1)` | Short author-date citation in the chosen locale. |
| `vector`, `vector_space` | list, str | | Only with `with_vectors`. |

`page_content` is always the literal passage (`fragments.text` or `units.text`), never the
modernised-spelling search layer, which SPDF forbids quoting.

## End-to-end example (no API key)

Retrieval with a toy embedding and an in-memory vector store, then a prompt in which every
passage carries its citation; pipe the prompt into any chat model.

```python
import hashlib
import math
import re

from langchain_core.embeddings import Embeddings
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.vectorstores import InMemoryVectorStore

from spdf_langchain import SpdfLoader


class HashingEmbeddings(Embeddings):
    """A toy bag-of-words embedding: no model to download, no API key."""

    def __init__(self, dim: int = 512) -> None:
        self.dim = dim

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * self.dim
        for word in re.findall(r"\w+", text.lower()):
            v[int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dim] += 1.0
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text)


docs = SpdfLoader("integrations/fixtures/spdf-in-five-pages.spdf", locale="en").load()
store = InMemoryVectorStore.from_documents(docs, embedding=HashingEmbeddings())  # needs numpy

question = "How is a plate without a printed folio cited?"
hits = store.similarity_search(question, k=2)
for d in hits:
    print(d.metadata["citation"], d.metadata["anchor_uri"])

prompt = ChatPromptTemplate.from_messages([
    ("system", "Answer from the passages only. After each claim, copy the citation of its passage."),
    ("human", "{context}\n\nQuestion: {question}"),
])
context = "\n\n".join(f"{d.page_content} {d.metadata['citation']}" for d in hits)
messages = prompt.invoke({"context": context, "question": question})
# answer = chat_model.invoke(messages)
```

Output:

```text
(Saorín Ferrer, 2026, p. [3]) spdf:sha256-50d94244…5f4c#p=4&f=3&char=0,133
(Saorín Ferrer, 2026, p. 2) spdf:sha256-50d94244…5f4c#p=3&f=2&char=19,258
```

The plate carries no printed number; its folio is inferred, so the citation prints it in
brackets. The context the model receives reads:

```text
Plate I. A page with its folio and a manicule pointing at a passage. This plate carries no printed number; its folio, 3, is inferred. (Saorín Ferrer, 2026, p. [3])

Every unit records who read it: … the citation puts it in brackets. (Saorín Ferrer, 2026, p. 2)
```

## Reusing the vectors stored in the file

SPDF files may ship vectors (`f.spaces()` in `spdf-format` lists them, with model, size and
any task prefixes). When your embedding model is the one that produced a space, load the
vectors instead of embedding every passage again, for example with FAISS:

```python
from langchain_community.vectorstores import FAISS          # pip install langchain-community faiss-cpu
from langchain_huggingface import HuggingFaceEmbeddings      # pip install langchain-huggingface

from spdf_langchain import SpdfLoader

docs = SpdfLoader("library/", with_vectors="all-MiniLM-L6-v2@384").load()
pairs = [(d.page_content, d.metadata.pop("vector")) for d in docs]   # keep the metadata flat
store = FAISS.from_embeddings(
    pairs,
    HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2"),  # embeds queries only
    metadatas=[d.metadata for d in docs],
    ids=[d.id for d in docs],
)
print(store.similarity_search("inferred folio", k=1)[0].metadata["citation"])
```

## Development

```bash
cd integrations/langchain-python
uv venv && uv pip install -e ../../python -e ".[test]"
.venv/bin/python -m pytest
```

The tests use the shared fixtures in `integrations/fixtures/`.

## License

MIT OR Apache-2.0, at your option.
