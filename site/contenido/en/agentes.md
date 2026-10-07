---
title: SPDF for agents
short: Agents
description: How language models and agents read this site and use SPDF files: Markdown twins, llms.txt, the MCP server, and the rules for citing without inventing.
---

This site is written to be read by people and by machines alike. Everything a person can read here, an agent can fetch as plain text.

## Reading this site

- Every page has a **Markdown twin**: the same address ending in `.md` (the home page is `/index.md`). Pages also answer in Markdown when asked with `Accept: text/markdown`, and to `curl` and `wget` by default.
- [`/llms.txt`](/llms.txt) lists every page with a one-line description, in English and Spanish.
- [`/llms-full.txt`](/llms-full.txt) carries the **whole specification** and every page of the site in one file.
- [`/status.json`](/status.json) has the CI status and conformance counts of every implementation, as JSON.
- [`/sitemap.xml`](/sitemap.xml) lists every page with its language alternates. `robots.txt` welcomes search engines and AI crawlers, including for training.
- Pages carry schema.org JSON-LD: the specification as `TechArticle`, the implementations as `SoftwareSourceCode`, SPDF Commons as `Dataset`.

## Using SPDF files from an agent

The [MCP server](/integrations#mcp) `spdf-mcp` points at a folder of `.spdf` files and gives any MCP client (Claude, ChatGPT, Cursor, Zed, your own agent) these tools:

| Tool | What it does |
| --- | --- |
| `list_documents` | The documents in the folder, with title, authors, year, kind and number of units |
| `search` | Lexical search (or hybrid, when the files carry vectors and a query vector is given) over every document, with anchors |
| `read_passage` | The literal text of a fragment, a unit (page, time span, slide) or a range, by id, printed folio or anchor URI |
| `cite` | The short citation with the exact folio or second, the anchor URI and the quoted text, in English or Spanish |
| `list_figures` | Figures, plates and frames with caption, description and anchor; optionally the image itself |
| `get_metadata` | The CSL-JSON record and BibTeX of a document |

```sh
npx spdf-mcp ~/Library/SPDF          # stdio
npx spdf-mcp ~/Library/SPDF --http 8765   # Streamable HTTP, optional
```

## Rules for citing without inventing

1. **Quote from the file, cite from the anchor.** Take the text of a passage from `read_passage` or the search result, and its citation from `cite`. Never type a page number yourself.
2. **Printed folio, not position.** A page has a physical position in the file and, usually, a printed folio. Cite the printed folio; `cite` already does. If a page has no printed folio, the citation says `n. pag.` (`s. p.` in Spanish): do not replace it with the position.
3. **Brackets mean inferred.** `p. [21]` means the folio was deduced from the neighbouring pages, not read on the page. Keep the brackets.
4. **Keep the anchor URI.** Put it next to the claim (in a footnote, a link or a comment) so a human can open the exact passage with any SPDF reader.
5. **Literal text is literal.** Fragments keep the spelling of the source. The modernised layer (`search_text`) exists only to find them; never quote from it.
6. **If the file does not say it, do not cite it.** A search result is a candidate, not evidence: read the passage before attributing a claim to it.
