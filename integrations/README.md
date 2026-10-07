# Integrations

SPDF in the tools people already use. Every integration sits on an official
implementation of the format (`spdf-format` in TypeScript or Python): none of
them reimplements it, and every citation they produce is computed from the
anchor stored in the file.

| Folder | Package | What it does |
| --- | --- | --- |
| [`spdf-mcp`](spdf-mcp) | `spdf-mcp` (npm) | Model Context Protocol server (stdio and Streamable HTTP): any agent lists, searches, reads and cites a folder of SPDF files with the exact folio, without being able to invent one |
| [`langchain-js`](langchain-js) | `spdf-langchain` (npm) | LangChain.js document loader: passages with citation and anchor URI in the metadata |
| [`llamaindex-js`](llamaindex-js) | `spdf-llamaindex` (npm) | LlamaIndex.TS reader, optionally with the vectors stored in the file |
| [`langchain-python`](langchain-python) | `spdf-langchain` (PyPI) | The LangChain loader in Python |
| [`llamaindex-python`](llamaindex-python) | `spdf-llamaindex` (PyPI) | The LlamaIndex reader in Python |
| [`zotero`](zotero) | `spdf-zotero` (.xpi) | Zotero 7 and 8 plugin: import an SPDF as an item, attach it, copy a citation with the folio |
| [`pandoc`](pandoc) | `spdf.lua` | Pandoc Lua filter: `[@spdf:sha256-…#p=29]` in Markdown becomes a citation with the printed folio, in any CSL style |
| [`fixtures`](fixtures) | | The sample SPDF files every test uses |

The loaders share one metadata vocabulary in both languages: `citation`,
`anchor_uri`, `printed_folio`, `physical_page`, `folio_inferred`, `title`,
`authors`, `year`, `language`, `kind`, `section`, `context`, `spdf_doc_id`,
`docref`, `source`, `spdf_version`, `anchor`, flat scalars only and no nulls.

## Running the tests

```sh
cd js && npm ci && npm run build                      # spdf-format (TypeScript), once
cd integrations/spdf-mcp && npm ci && npm test        # same for langchain-js, llamaindex-js, zotero

cd integrations/llamaindex-python                     # same for langchain-python
uv venv .venv && VIRTUAL_ENV=$PWD/.venv uv pip install -e ../../python -e '.[test]'
.venv/bin/python -m pytest -q

cd integrations/pandoc && test/run.sh                 # needs pandoc and sqlite3
```

CI: `.github/workflows/integrations.yml`. Documentation for people:
<https://spdf.joseluissaorin.com/integrations>.

Code under MIT OR Apache-2.0.
