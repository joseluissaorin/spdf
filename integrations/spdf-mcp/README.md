# spdf-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for
[SPDF](https://spdf.joseluissaorin.com) files. Point it at a folder of `.spdf`
documents and any agent (Claude, ChatGPT, Cursor, Zed, your own) can list them,
search them, read a passage, look at the figures and **cite with the exact
printed folio, without being able to invent one**.

It is a thin layer over [`spdf-format`](../../js), the official TypeScript
implementation: the text comes from the file, the citation comes from the
stored anchor, and a page that does not exist is an error, never an
approximation.

## Run it

```sh
npx spdf-mcp ~/Library/SPDF                    # stdio (what desktop clients use)
npx spdf-mcp ~/Library/SPDF --locale es        # citations in Spanish by default
npx spdf-mcp ~/Library/SPDF --http 8765        # Streamable HTTP on http://127.0.0.1:8765/mcp
```

Options: `--http <port>`, `--host <interface>` (default `127.0.0.1`),
`--locale en|es`, `--no-recursive`. Several folders or files can be given.
Unreadable or unsafe files (for example one with a view or a trigger) are
skipped and reported by `list_documents`.

### Claude Code

```sh
claude mcp add spdf -- npx spdf-mcp ~/Library/SPDF
```

### Any client with a JSON configuration (Claude Desktop, Cursor, Zed…)

```json
{
  "mcpServers": {
    "spdf": { "command": "npx", "args": ["spdf-mcp", "/path/to/library"] }
  }
}
```

## Tools

All tools are read-only. Each returns readable JSON as text and the same data
as structured content.

| Tool | Arguments | Returns |
| --- | --- | --- |
| `list_documents` | `filter?`, `refresh?` | Every document: `doc` reference (`sha256-…` of the original), title, authors, year, kind, language, units, fragments, figures, vector spaces; and the files that were skipped |
| `search` | `query`, `docs?`, `limit?` (1–50), `vector?` + `space?`, `locale?` | Passages with their literal `text`, `citation`, `anchor_uri`, section, context and score. Lexical search uses the SPDF reference algorithm (accent-insensitive, `"phrases"`); with a query vector in a space the files carry it is hybrid (reciprocal rank fusion, k = 10). Results from several files are merged by rank |
| `read_passage` | `doc` + one of `fragment_id`, `folio`, `page`, `time`; or `uri`; `around?`; `locale?` | The literal text, citation, anchor URI, who read it and with what confidence, warnings, and optionally the neighbouring fragments |
| `cite` | same as `read_passage`, plus `reference?` | `citation`, `anchor_uri` and `quote` together; with `reference` also CSL-JSON and BibTeX |
| `list_figures` | `doc?`, `figure_id?`, `include_image?`, `locale?` | Figures, plates and frames with caption, description, citation, anchor URI and region; the image itself when asked for one figure |
| `get_metadata` | `doc` | CSL-JSON, BibTeX, rights, SHA-256 of the original and provenance |

`doc` accepts the full reference from `list_documents`, a unique prefix of its
hash, the document id or the file name.

### What the citations look like

| Passage | `cite` returns |
| --- | --- |
| Physical page 2, printed folio 1 | `(Saorín Ferrer, 2026, p. 1)` |
| A plate whose folio was inferred | `(Saorín Ferrer, 2026, p. [3])` plus a warning to keep the brackets |
| A cover with no printed folio | `(Saorín Ferrer, 2026, n. pag.)` (`s. p.` in Spanish) plus a warning |
| A folio that does not exist | an error: *"… has no page with printed folio 21. Printed folios: 1, 2, 3, 4, 5. Do not cite it."* |

The server also sends the model a short set of instructions (the MCP
`instructions` field) with the rules for citing without inventing; they are the
same as on [SPDF for agents](https://spdf.joseluissaorin.com/agents).

## As a library

```js
import { Library, createServer } from 'spdf-mcp';
const lib = await Library.open(['./library'], { locale: 'en' });
const server = createServer(lib);          // an McpServer from @modelcontextprotocol/sdk
await server.connect(myTransport);
```

## Tests

```sh
cd js && npm ci && npm run build            # the official library, once
cd integrations/spdf-mcp && npm ci && npm test
```

The tests use the MCP SDK itself as the client, three ways: in memory (every
tool and every error path), over **stdio** against the compiled binary, and over
**Streamable HTTP** (including the DNS-rebinding guard). They run against the
sample files in [`../fixtures`](../fixtures).

## Security

- Files are opened read-only, with `trusted_schema=OFF`, defensive mode and no
  extensions, and files with triggers or views are refused (`spdf-format` does
  this; the server never writes).
- The HTTP transport listens on `127.0.0.1` by default, is stateless, accepts
  only `POST /mcp` and rejects requests whose `Host` is not the one it listens
  on. There is no authentication: do not expose it to a network you do not
  trust.

## Licence

MIT OR Apache-2.0.
