---
title: How to cite
short: Cite
description: How to cite the SPDF specification in your own work, and how SPDF cites the documents it holds, with the exact folio, second or verse.
---

## Citing the specification

If SPDF is useful in your research, please cite the specification itself, with the version you used. Suggested citation:

> Saorín Ferrer, José Luis. 2026. *SPDF: Semantic Processed Document Format. Specification, version 5.0.* https://spdf.joseluissaorin.com/spec

<!-- cita-spec -->

A DOI will be minted for each released version of the specification; until then, please cite the URL and the version.

## How SPDF cites what it holds

The point of the format is that a citation is **computed from the stored anchor, never generated**. Every implementation has the same `cite` function, tested by the conformance suite, which takes an anchor, the document's CSL record and a locale:

| Anchor | English | Spanish |
| --- | --- | --- |
| page, printed folio read from the page | `(Darwin, 1859, p. 21)` | `(Darwin, 1859, p. 21)` |
| page, folio inferred from its neighbours | `(Darwin, 1859, p. [21])` | `(Darwin, 1859, p. [21])` |
| page, roman folio | `(Woolf, 1929, p. xiv)` | `(Woolf, 1929, p. xiv)` |
| leaf foliation | `(Cervantes, 1605, fol. 1r)` | `(Cervantes, 1605, fol. 1r)` |
| a page without a printed number | `(Darwin, 1859, n. pag.)` | `(Darwin, 1859, s. p.)` |
| range | `(Darwin, 1859, pp. 21-22)` | `(Darwin, 1859, pp. 21-22)` |
| time in a recording | `(Cortázar, 1977, 1:09:20)` | `(Cortázar, 1977, 1:09:20)` |
| slide | `(Gould, 2024, slide 3)` | `(Gould, 2024, diap. 3)` |
| verse | `(Milton, 1667, vv. 234-240)` | `(Milton, 1667, vv. 234-240)` |
| canonical reference (CSL year −375) | `(Plato, 375 BC, 514a)` | `(Plato, 375 a. C., 514a)` |

Two authors are joined with *and* in English and *y* in Spanish (*e* before the sound /i/, as the Spanish norm asks); three or more become *et al.* A page without a printed folio is never cited by its position in the file disguised as a page number.

Full bibliographic references are exported as **CSL-JSON** (always) and **BibTeX**, so any CSL style (Chicago, APA, MLA, ISO 690…) can be applied with citeproc, Zotero or Pandoc.

## Anchor URIs

Every passage can be pointed at with a portable URI that survives renaming and copying the file, because it names the document by the SHA-256 of its original bytes:

```text
spdf:sha256-3f2a9c…#p=29&f=21&char=118,301
```

The parameters follow W3C Media Fragments and RFC 5147 where they overlap: `p` physical page, `f` printed folio, `t` seconds, `s` section path, `sl` slide, `v` verse, `ref` canonical reference, `char` character range, `xywh` region in percent. The full grammar is in the [specification](/spec#anchor-uri).

## Citing from your writing tools

- **Pandoc**: write `[@spdf:sha256-3f2a9c…#p=29]` in Markdown and the [Pandoc filter](/integrations#pandoc) turns it into a real citation with the printed folio, in any CSL style.
- **Zotero**: the [Zotero plugin](/integrations#zotero) imports the CSL record of an SPDF as an item, attaches the file and copies a citation with the folio.
- **Agents**: the [MCP server](/integrations#mcp) gives any agent a `cite` tool that returns the citation, the anchor URI and the quoted text together, so it cannot cite a page that does not say what it claims.
