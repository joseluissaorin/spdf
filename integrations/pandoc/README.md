# SPDF for Pandoc

`spdf.lua` is a [Pandoc](https://pandoc.org) Lua filter that lets you cite a place in
an [SPDF](../../spec/SPEC.md) file from Markdown and get a real citation, formatted by
citeproc in any CSL style, with the folio **printed in the source**.

An SPDF file is a document that has already been read: every unit knows its physical
position in the file and the folio printed on the page (or its second, slide, verse…).
You write the anchor; the filter looks it up in your SPDF files, adds the work to the
bibliography and hands citeproc the locator a reader will find on paper:

```markdown
---
spdf-library: ~/Library/SPDF
---

Physical page 2 carries the printed folio 1 [@spdf:sha256-50d942445564fe24effe743701f0c9a16fde414e6eb1f0ce2095b866d0555f4c#p=2].

An inferred folio goes in brackets [@spdf:sha256-50d942445564fe24effe743701f0c9a16fde414e6eb1f0ce2095b866d0555f4c#p=4].

The cover has no folio [@spdf:sha256-50d942445564fe24effe743701f0c9a16fde414e6eb1f0ce2095b866d0555f4c#p=1].

# References
```

```console
$ pandoc paper.md --lua-filter spdf.lua --citeproc -t plain --wrap=none
[WARNING] Scripting warning at spdf.lua line 46 column 1: spdf: [@spdf:sha256-50d942445564fe24effe743701f0c9a16fde414e6eb1f0ce2095b866d0555f4c#p=1]: physical page 1 of spdf-in-five-pages.spdf has no printed folio; cited as unnumbered (n. pag.)
Physical page 2 carries the printed folio 1 (Saorín Ferrer 2026, 1).

An inferred folio goes in brackets (Saorín Ferrer 2026, [3]).

The cover has no folio (Saorín Ferrer 2026, n. pag.).

References

Saorín Ferrer, José Luis. 2026. SPDF in Five Pages. Spdf.joseluissaorin.com. https://spdf.joseluissaorin.com/validator.
```

Every output in this file is real, produced with Pandoc 3.9 and its default style,
Chicago author-date, mostly from the sample booklet
[`integrations/fixtures/spdf-in-five-pages.spdf`](../fixtures/) (six page units: a cover
without folio, then printed folios 1, 2, an inferred [3], 4 and 5); the same cases are
checked by the tests in [`test/`](test/).

## Why Pandoc, and not Calibre

Academic writing in Markdown already goes through Pandoc and citeproc: that is the step
where an author's sources become citations in the style a journal or a university asks
for. Turning a position in a file (the 29th page of a PDF) into the folio a reader finds
on paper (p. 21, or p. [21] when the folio was inferred, or *n. pag.* when there is none)
belongs exactly there, just before the style formats it. Calibre is a reading library,
and reading SPDF files is what the SPDF Reader is for; a Calibre plugin would be one more
place to read, and would not help anyone cite.

## Requirements and installation

- **Pandoc 3.1.1 or later** (the filter uses `pandoc.json`; tested with 3.9).
- **The `sqlite3` command-line tool**, 3.33 or later (JSON output); 3.37 or later is
  recommended, because the filter then runs it in safe mode. macOS ships it; on
  Debian or Ubuntu `apt install sqlite3`, on Fedora `dnf install sqlite`. No compiled Lua
  module is needed.
- For legacy SPDF 4.x files, which are gzip-compressed: `gzip`, `head` and a POSIX `sh`
  (all standard on macOS and Linux).

Copy [`spdf.lua`](spdf.lua) next to your document, or into the `filters` folder of your
Pandoc user data directory (`~/.local/share/pandoc/filters/` on macOS and Linux), where
`--lua-filter spdf.lua` finds it from anywhere. Run it **before** citeproc:

```sh
pandoc paper.md --lua-filter spdf.lua --citeproc -o paper.pdf
```

or with a defaults file (`pandoc -d spdf.yaml paper.md -o paper.pdf`):

```yaml
# spdf.yaml
filters:
  - spdf.lua
  - citeproc
metadata:
  spdf-library: ~/Library/SPDF
```

## Writing citations

The key of the citation is an SPDF anchor URI ([SPEC §5](../../spec/SPEC.md#anchor-uri)):
`spdf:` followed by the document reference and, after `#`, the anchor parameters.

- The document reference is `sha256-` and the 64 hexadecimal digits of the document's
  `source_sha256` (recommended: it is the same in every copy of the file), or the
  document id, percent-encoded. To read both from a file:
  `sqlite3 -readonly book.spdf "SELECT source_sha256, id FROM documents"`.
- The parameters say where: `p=` the physical page (the position in the file), `f=` the
  printed folio, `pe=` / `fe=` the end of a range, `t=` seconds (`t=4160`, `t=12,24.5`,
  `t=1:09:20`), `s=` and `para=` a section path and paragraph, `sl=` a slide, `sh=` and
  `rows=` a sheet, `v=` verse lines, `ref=` a canonical reference (`ref=stephanus:514a`).
  `char=` and `xywh=` narrow a unit and do not change the citation.

Everything Pandoc offers around a citation keeps working: prefixes, suffixes, several
citations in one bracket, suppressing the author, in-text citations. To keep them short,
the examples from here on cite the booklet by its document id, `spdf-in-five-pages`;
`sha256-50d942445564fe24effe743701f0c9a16fde414e6eb1f0ce2095b866d0555f4c` gives the same
output.

```markdown
Prefix and suffix are kept [see @spdf:spdf-in-five-pages#p=5, emphasis added].

Two citations in one bracket [@spdf:spdf-in-five-pages#p=2; compare @spdf:spdf-in-five-pages#p=6, for the summary].

The author can be suppressed [-@spdf:spdf-in-five-pages#p=3].

A range [@spdf:spdf-in-five-pages#p=2&pe=3], or by folios [@spdf:spdf-in-five-pages#f=4&fe=5].

@spdf:spdf-in-five-pages#p=2 says so.

As @spdf:spdf-in-five-pages#p=4, argues, inferred folios are bracketed.
```

```text
Prefix and suffix are kept (see Saorín Ferrer 2026, 4, emphasis added).

Two citations in one bracket (Saorín Ferrer 2026, 1; compare Saorín Ferrer 2026, 5, for the summary).

The author can be suppressed (2026, 2).

A range (Saorín Ferrer 2026, 1–2), or by folios (Saorín Ferrer 2026, 4–5).

Saorín Ferrer (2026, 1) says so.

As Saorín Ferrer (2026, [3]), argues, inferred folios are bracketed.
```

### How Pandoc reads these keys

In Pandoc's Markdown a citation key starts with a letter, a digit or `_` and may contain
letters, digits, `_` and the internal punctuation `: . # $ % & - + ? < > ~ /`. The equals
sign is not among them, so **the key stops at the first parameter name** and the rest of
the anchor lands in the citation's suffix, or, for an in-text citation, in the text that
follows. These are the Pandoc 3.9 ASTs (`pandoc -t native`) the filter is built on:

| You write | `citationId` | Where the rest goes |
|---|---|---|
| `[@spdf:sha256-…#p=29]` | `spdf:sha256-…#p` | suffix `=29` |
| `[see @spdf:sha256-…#f=21, emphasis added]` | `spdf:sha256-…#f` | suffix `=21, emphasis added`, prefix `see` |
| `[@spdf:sha256-…#p=2&f=1]` | `spdf:sha256-…#p` | suffix `=2&f=1` |
| `@spdf:my-doc#p=3 says` | `spdf:my-doc#p` (in-text) | the next text element, `=3` |
| `[@{spdf:sha256-…#p=2&pe=3}]` | the whole URI | nothing (braced form) |
| `@{spdf:sha256-…#p=2} [emphasis added]` | the whole URI (in-text) | suffix `emphasis added` |
| `[@spdf:sha256-…]` | `spdf:sha256-…` | the whole document, no locator |

The filter puts the pieces back together, so all of these work as written. A few forms do
not reach the filter as citations, and need another spelling:

| Instead of | Write | Why |
|---|---|---|
| `@spdf:…#p=2 [emphasis added]` | `@{spdf:…#p=2} [emphasis added]` | Pandoc attaches a bracketed suffix only directly after the key, and here `=2` comes between them. |
| `[@{spdf:my doc#p=2}]` | `[@{spdf:my%20doc#p=2}]` | A space ends the key even inside braces. Percent-encode it, as the URI grammar asks anyway; the filter warns when it meets such text. |
| `@spdf:…#f=xiv.` meaning folio `xiv.` | `[@{spdf:…#f=xiv.}]` or `f=xiv%2E` | Prose punctuation stuck to the end (`. , : ; ! ?`, closing quotes, an ellipsis) is taken as punctuation of your sentence; in the braced form every character counts. |

**CommonMark and GFM.** `commonmark`, `commonmark_x` and `gfm` have no citation syntax in
Pandoc 3.9: `[@spdf:…#p=2]` arrives as plain text. The filter finds those pieces and reads
them again with Pandoc's own Markdown reader, so the same syntax works with
`--from=commonmark_x`; the prefix and suffix of such a citation must be plain text.

## What the citation prints

The filter resolves the anchor against the file and writes the locator into the suffix
in a form citeproc recognises as a CSL locator (`, {p. [3]}`), so the **style** decides how
to print it: Chicago author-date writes `[3]`, a style that shows labels writes `p. [3]`.
The rules are those of the specification ([SPEC §18](../../spec/SPEC.md#citation)):

| Anchor | Example | Chicago author-date |
|---|---|---|
| page, folio read | `#p=2` | `(Saorín Ferrer 2026, 1)` |
| page, folio inferred | `#p=4` | `(Saorín Ferrer 2026, [3])` |
| page without folio | `#p=1` | `(Saorín Ferrer 2026, n. pag.)` and a warning; `s. p.` in Spanish |
| folio given directly | `#f=3` | `(Saorín Ferrer 2026, [3])`: checked against the units, bracketed if inferred |
| range | `#p=3&pe=4`, `#f=4&fe=5` | `(Saorín Ferrer 2026, 2–[3])`, `(Saorín Ferrer 2026, 4–5)` |
| range from an unnumbered page | `#p=14&pe=29` in the 1608 *Quixote* | `fol. Ir` and a warning: the unnumbered end is left out |
| leaf (`foliation: leaf`), roman | `#p=29`, `#p=30`, `#p=29&pe=30` | `(Cervantes Saavedra [1605] 1608, fol. Ir)`, `fol. [Iv]`, `fols. Ir–[Iv]` |
| time (ground elapsed time) | `#t=369959`, `#t=369966,369976` | `102:45:59`, `102:46:06-102:46:16` |
| section | `#s=學而第一&para=1` | `(孔子, n.d., § 學而第一, para. 1)` |
| section with a printed page | `#s=XXI&para=1&f=159` | `(Bécquer [1871] 1885, 159)` |
| verse | `#v=2`, `#v=1-3` | `v. 2`, `vv. 1–3` |
| slide | `#sl=2` | `slide 2` (`diap. 2` in Spanish) |
| sheet | `#sh=Data&rows=4-9` | `Data, rows 4-9` |
| canonical | `#ref=stephanus:514a`, `#ref=analects:1.2` | `514a`, `(孔子, n.d., 1.2)` |
| whole document | no parameters | `(Saorín Ferrer 2026)` |

When both `p` and `f` are given, `p` decides and a disagreeing `f` is reported. A folio
printed on several pages (`f=1` in front matter and body) takes the first and warns; add
`p=` to choose. A page without a printed folio is **never** cited by its position in the
file: that number does not exist on paper. An end without a printed folio never takes part
in a range ([SPEC §18.1](../../spec/SPEC.md#citation)): the folio of the other end is cited
alone, and the page is unnumbered only when neither end has a folio. Verses, sections,
paragraphs, slides, sheets and canonical references are looked up in the anchors of the
units and of the fragments ([SPEC §5.4](../../spec/SPEC.md#anchor-uri)), so a reference
kept on a fragment (`analects:1.2`, a line of a poem) is found, and one the file does not
anchor is reported.

Pandoc only reads a locator label in the terms of the locale citeproc is using, with no
English fallback: a German document needs `S.` for a page, a Spanish one `f.` for a folio.
The filter asks citeproc for those terms itself, once per run, so labels work in every
CSL locale. With the test style [`test/styles/labels.csl`](test/styles/labels.csl), which
prints the label citeproc recognised, a document with `lang: de-DE` gives
`(Saorín Ferrer, 2026, [page] S. 1)` and `(Cervantes Saavedra, 1608, [folio] Fol. [Iv])`,
and one with `lang: es-ES` gives `[page] p. 1` and `[folio] f. [Iv]`. Locators that CSL
has no label for (an unnumbered page, a time, a slide, a sheet, a canonical reference, a
section) are written after an empty locator, `{}, 1:09:20`, so that citeproc does not
mistake `1:09:20` or `514a` for a page number.

In Spanish:

```markdown
---
lang: es
---
La portada no lleva folio [@spdf:sha256-6abda0640aaed500ee9673212fab17b83ef4326f5ade42d6c6cabec3f8996df7#p=1].

Según @spdf:spdf-en-cinco-paginas#p=3, el formato guarda el folio impreso.
```

```text
La portada no lleva folio (Saorín Ferrer 2026, s. p.).

Según Saorín Ferrer (2026, 2), el formato guarda el folio impreso.
```

## Options

Set them in the document's YAML metadata, in a defaults file, or with `-M`.

| Field | Default | Meaning |
|---|---|---|
| `spdf-library` | `.` and the folder of the input file | A folder, or a list of folders and files. Folders are searched for `*.spdf` (not recursively). Relative paths are taken from the working directory, then from the input file's folder; `~/` is your home folder. |
| `spdf-locale` | from `lang` | `en` or `es`: the language of the few words the filter writes itself (`n. pag.` / `s. p.`, `slide` / `diap.`, `para.` / `párr.`, `rows` / `filas`). Any `lang` other than Spanish gives English. |
| `spdf-links` | `false` | `true` adds the canonical anchor URI of each resolved citation as a link in a footnote (inside a footnote, in parentheses after the citation). |
| `spdf-sqlite3` | `sqlite3` | The `sqlite3` program to run. |

With `spdf-links: true`:

```text
A citation gets a note with its anchor (Saorín Ferrer 2026, [3])[1].

A range links to its canonical anchor (Saorín Ferrer 2026, 2–[3])[2].

Two citations get one note (Saorín Ferrer 2026, 1; 2026, 5)[3].

Inside a footnote the anchor goes in parentheses.[4]

[1] spdf:sha256-50d942445564fe24effe743701f0c9a16fde414e6eb1f0ce2095b866d0555f4c#p=4&f=3

[2] spdf:sha256-50d942445564fe24effe743701f0c9a16fde414e6eb1f0ce2095b866d0555f4c#p=3&pe=4&f=2&fe=3

[3] spdf:sha256-50d942445564fe24effe743701f0c9a16fde414e6eb1f0ce2095b866d0555f4c#p=2&f=1; spdf:sha256-50d942445564fe24effe743701f0c9a16fde414e6eb1f0ce2095b866d0555f4c#p=6&f=5

[4] As shown in Saorín Ferrer (2026, 2) (spdf:sha256-50d942445564fe24effe743701f0c9a16fde414e6eb1f0ce2095b866d0555f4c#p=3&f=2).
```

The link is the canonical URI of what was found ([SPEC §5.2](../../spec/SPEC.md#anchor-uri)),
whatever form you wrote: a citation by folio links to its physical page as well.

## References

For each cited document the filter takes the CSL-JSON item stored in the file (without
its `spdf` extension object), reads it with Pandoc's own CSL JSON reader, and adds it to
the document's `references` metadata under the key `spdf-` followed by the first 12 hex
digits of the document's `source_sha256` (`spdf-50d942445564`). The citation's key is
rewritten to it, so citeproc, `link-citations`, `nocite` and every CSL style see an
ordinary reference.

Nothing is duplicated. If a reference with that key already exists, it is kept. If your
`references` or `bibliography` files already hold the same work (same DOI, same ISBN, or
same title, year and first author), the citation uses **your** key and your entry:

```text
The English booklet is already in the references as saorin2026, so the citation uses that key (Saorín Ferrer 2026b, 1) and the bibliography lists it once, next to a citation written by hand (Saorín Ferrer 2026b, 4).

The Spanish booklet is in the bibliography file as cinco (Saorín Ferrer 2026a, 2).
```

Without `--citeproc`, Pandoc's Markdown writer shows what the filter did, which is also a
way to hand a resolved manuscript to someone without SPDF files (`-t markdown -s` also
writes the references). For

```markdown
A [see @spdf:spdf-in-five-pages#p=4, emphasis added]. B @spdf:spdf-in-five-pages#p=1 says. C [@spdf:spdf-in-five-pages#p=2]
```

`pandoc --lua-filter spdf.lua -t markdown` writes:

```markdown
A [see @spdf-50d942445564, {p. \[3\]}, emphasis added]. B
@spdf-50d942445564 [{}, n. pag.] says. C [@spdf-50d942445564, {p. 1}]
```

## Warnings and unresolved citations

An anchor that cannot be resolved is never dropped or guessed. The filter warns on
stderr and leaves the citation visibly marked: its key becomes the anchor URI you wrote,
which citeproc prints in bold with a question mark and reports again:

```text
[WARNING] Scripting warning at spdf.lua line 46 column 1: spdf: [@spdf:spdf-in-five-pages#p=99]: page p=99 is not in spdf-in-five-pages.spdf; the citation is left unresolved
[WARNING] Citeproc: citation spdf:spdf-in-five-pages#p=99 not found
A page the file does not have (spdf:spdf-in-five-pages#p=99?).
```

This happens for an unknown document, a page, folio, time, verse, slide, sheet, section or
canonical reference the file does not have, a malformed parameter (`p=0`), a truncated
hash, or a time cited in a paged document. A citation next to it in the same bracket is
still resolved. An unknown parameter name (`pg=9`) is reported and ignored, as the
specification asks. Files that cannot be used are skipped with the reason:

```text
spdf: skipping roto.spdf: it contains view x_rotura; SPDF files must not carry triggers, views or foreign virtual tables (E020)
spdf: skipping E001-not-sqlite.spdf: it is not a SQLite database (E001)
spdf: skipping E002-application-id.spdf: it is not an SPDF file (unknown application_id, E002)
spdf: skipping E013-two-documents.spdf: its documents table does not hold exactly one row (E013)
spdf: library path not found: no-such-folder
```

The warnings go through Pandoc's own log (Pandoc prefixes them with the line of the filter
that emitted them; the message is what follows `spdf:`). So `--quiet` silences them, and
`--fail-if-warnings` makes Pandoc exit with status 3: use it in a build that must not
publish an unresolved citation. If `sqlite3` is missing and the document cites SPDF
anchors, Pandoc stops with:

```text
spdf.lua: the sqlite3 command-line tool was not found (looked for 'sqlite3'). Install it (macOS ships it; Debian/Ubuntu: apt install sqlite3; Fedora: dnf install sqlite) or point the metadata field spdf-sqlite3 at it.
```

A document without SPDF citations never calls `sqlite3`.

## Legacy SPDF 4.0 and 4.1 files

Files written by Scholaris before SPDF 5.0 are SQLite databases wrapped in gzip, with
Spanish table and column names. The filter recognises the gzip magic bytes, decompresses
the file into a temporary folder (refusing more than 4 GiB), and reads it through the 5.0
view of [SPEC §20](../../spec/SPEC.md#legacy): `documentos`, `unidades`, `huella`, the
anchor members (`fisica`, `impresa`, `origen: deducido`…) and the `MetadatosDocumento`
object, mapped to CSL (title and subtitle, authors, editors, dates, publisher, place…).

```text
Garcilaso, a folio inferred from its neighbours (Garcilaso de la Vega [1543] 1919, [7]), a folio read on the page (Garcilaso de la Vega [1543] 1919, 159), by document id and folio (Garcilaso de la Vega [1543] 1919, 159), a range (Garcilaso de la Vega [1543] 1919, [7]–159), and a page the file does not have (spdf:garcilaso#p=10?).

Kennedy, by paragraph (Kennedy 1962, para. 15) (Kennedy 1962, para. 16), and a paragraph the excerpt does not have (spdf:kennedy-rice#para=40?).

Apollo 11, a recording in ground elapsed time: a moment (National Aeronautics and Space Administration 1969, 102:46:16), a span (National Aeronautics and Space Administration 1969, 102:46:18-102:46:23), and a time outside the excerpt (spdf:apolo11-tierra#t=99?).
```

## Security

SPDF files come from strangers, so the filter follows the safe opening of
[SPEC §2.4](../../spec/SPEC.md#container) as far as the `sqlite3` tool allows. Each query
runs in a separate `sqlite3` process opened with `-readonly`, `-safe` (3.37 or later: no
`load_extension`, no file or shell commands), `-batch`, `-bail` and `-init /dev/null`
(your `~/.sqliterc` is not read), with `.dbconfig defensive on`, `PRAGMA trusted_schema =
OFF`, `query_only = 1`, `mmap_size = 0`, `cell_size_check = ON` and a 512 MiB limit on any
value. A file with a trigger, a view or a virtual table other than the FTS5 index is
refused before any of its tables is read (legacy files may keep their three FTS
triggers, which cannot fire on a read-only connection). The SQL is fixed text in the
filter; nothing from a file or from your document is ever put into a query, executed, or
fetched from the network.

## Tests

```sh
make test          # or: test/run.sh [case ...]
```

The runner needs `pandoc`, `sqlite3` and `gzip`. Each case in `test/cases/` is run with
`--lua-filter spdf.lua --citeproc -t plain` and compared with `test/expected/` three ways:
the text, the warnings, and the citations and references the filter produced
(`-t native` through [`test/inspect.lua`](test/inspect.lua)). The cases cover printed
folios from `p=`, checks of `f=`, inferred folios, the cover without folio, ranges,
leaves, times, sections, verses, slides, sheets, canonical references, unknown documents,
pages and parameters, prefixes and suffixes, several citations in one bracket, in-text
citations and their punctuation, the braced form, CommonMark input, a Spanish document,
locator labels in German and Spanish, merging with existing references and bibliography
files, anchor links, invalid files (`roto.spdf` and the `conformance/invalid` files: none
may crash the filter), legacy gzip files, and a missing `sqlite3`.

They read the shared fixtures in [`integrations/fixtures/`](../fixtures/) and some files of
the conformance suite (`conformance/files`, `conformance/legacy`, `conformance/invalid`),
and build `test/build/mixed.spdf` from [`test/fixtures/mixed.sql`](test/fixtures/mixed.sql)
for the anchor types those lack. Those files are rebuilt by other parts of the repository,
so the cases name them by placeholders (`HASH_EN`, `HASH_QUIJOTE`, `HASH_EN_12` for the
citekey…) that the runner fills with each file's current `source_sha256` and puts back in
the outputs; the table is `HASHED` in `test/run.sh`. `test/run.sh --update` rewrites the
expected outputs; read the diff before keeping it.

## Limitations

- The filter's own words exist in English and Spanish only. Locator labels follow any
  CSL locale, but the probe uses the locale's terms: a style whose own `<locale>` section
  redefines the `page`, `folio`, `column` or `verse` terms may not see the label.
- Times have no CSL label (Pandoc's locator parser does not know CSL 1.0.2 `timestamp`),
  so they are plain text in the suffix, `m:ss` below one hour and `h:mm:ss` above, as in
  SPEC §18; a `t=a,b` pair prints as a range.
- `char=` and `xywh=` are kept in links but not printed: a citation locates a unit.
- Citations in metadata fields (title, abstract) are not resolved.
- Library folders are not searched recursively, `.spdfl.json` collection manifests are
  not read, and remote files are never fetched.
- On Windows, `sqlite3.exe` must be on `PATH`; without a POSIX `sh`, legacy gzip files are
  decompressed in memory and without the 4 GiB cap.
- Opening costs two short `sqlite3` runs per library file and one more per cited
  document; with a library of thousands of files, list the ones you cite.

## License

MIT OR Apache-2.0, like the rest of the code in this repository. The test fixtures in
`test/fixtures/` and the test style in `test/styles/` are dedicated to the public domain
(CC0 1.0).
