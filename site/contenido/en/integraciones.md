---
title: Integrations
short: Integrations
description: SPDF in the tools people already use: an MCP server for agents, loaders for LlamaIndex and LangChain in Python and JavaScript, a Zotero plugin and a Pandoc filter that turns SPDF anchors into citations with the printed folio.
---

The format is only as useful as the places it reaches. These integrations live in the `integrations/` folder of the repository, each with its tests and its README, and all of them sit on the official libraries: none reimplements the format.

## MCP server {#mcp}

`spdf-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server in TypeScript over `spdf-format`. Point it at a folder of `.spdf` files and any agent can list the documents, search them, read a passage, look at the figures and cite with the exact folio, without being able to invent one.

```sh
npx spdf-mcp ~/Library/SPDF                # stdio
npx spdf-mcp ~/Library/SPDF --http 8765    # Streamable HTTP
```

In Claude Code: `claude mcp add spdf -- npx spdf-mcp ~/Library/SPDF`. In any client that reads a JSON configuration:

```json
{ "mcpServers": { "spdf": { "command": "npx", "args": ["spdf-mcp", "/path/to/library"] } } }
```

Tools: `list_documents`, `search`, `read_passage`, `cite`, `list_figures`, `get_metadata`. See [SPDF for agents](/agents) for the rules they follow.

## LlamaIndex and LangChain {#loaders}

Loaders that turn every fragment of an SPDF into a document of the framework, **with its anchor and its citation in the metadata**, so retrieval-augmented answers can cite the printed page instead of a chunk number.

```py
from spdf_llamaindex import SpdfReader          # pip install spdf-llamaindex
docs = SpdfReader(locale="en").load_data("darwin-origin.spdf")
docs[0].metadata["citation"]     # '(Darwin, 1859, p. 21)'
docs[0].metadata["anchor_uri"]   # 'spdf:sha256-…#p=29&f=21'
```

```py
from spdf_langchain import SpdfLoader            # pip install spdf-langchain
for doc in SpdfLoader("library/", locale="es").lazy_load():
    print(doc.metadata["citation"], doc.page_content[:60])
```

```js
import { SpdfLoader } from 'spdf-langchain';      // npm install spdf-langchain
const docs = await new SpdfLoader('darwin-origin.spdf').load();
```

```js
import { SpdfReader } from 'spdf-llamaindex';     // npm install spdf-llamaindex
const docs = await new SpdfReader().loadData('darwin-origin.spdf');
```

## Zotero {#zotero}

A plugin for Zotero 7 and 8 that brings SPDF into a reference library:

- **Import an SPDF as an item**: the CSL-JSON record inside the file becomes a Zotero item, with the file attached.
- **Attach an SPDF** to an existing item.
- **Copy a citation with the folio**: pick a page or paste an anchor URI and get `(Darwin, 1859, p. 21)` on the clipboard, with the anchor URI alongside.

Install it from the `.xpi` file (Tools → Plugins → Install Plugin From File).

## Pandoc {#pandoc}

A Lua filter for Pandoc that turns SPDF anchors in your Markdown into real citations, in any CSL style:

```markdown
Darwin calls it a struggle for life [@spdf:sha256-3f2a9c…#p=29].
```

```sh
pandoc essay.md --lua-filter spdf.lua -M spdf-library=library/ --citeproc -o essay.docx
```

The filter reads the SPDF files in the library folder, adds their CSL records to the bibliography, **replaces the physical page with the printed folio** (`p=29` becomes page 21) and warns if the page you cite does not exist. Citeproc then formats it in Chicago, APA, MLA or whatever style you choose.

Why Pandoc rather than Calibre: academic writing in Markdown already goes through Pandoc and citeproc, and the step that matters most for the honesty of a citation (turning a position in a file into the folio a reader will find on paper) belongs exactly there. Calibre is a library for reading; the [reader](/download) already covers that.
