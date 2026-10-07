# SPDF for Zotero

A Zotero 7 and Zotero 8 plugin for [SPDF](https://spdf.joseluissaorin.com) (Semantic
Processed Document Format) files: documents that were read once and keep, for every
passage, its exact anchor (printed folio, physical page, second of a recording, slide…).

With the plugin, Zotero can:

- **Import SPDF as Item…** (Tools menu and item context menu): pick an `.spdf` file and
  get a Zotero item built from the file's own CSL-JSON metadata, in the selected
  library and collection, with the `.spdf` file attached.
- **Attach SPDF…** (item context menu, one regular item selected): attach an `.spdf`
  file to an item you already have.
- **Copy Citation with Folio…** (item context menu, an item with an SPDF attachment, or
  the attachment itself, or a sibling attachment such as the PDF): type a printed
  folio, a physical page or an anchor URI, and the clipboard receives the short
  citation and, on the next line, the anchor URI:

  ```
  (Saorín Ferrer, 2026, p. [3])
  spdf:sha256-50d942445564fe24effe743701f0c9a16fde414e6eb1f0ce2095b866d0555f4c#p=4&f=3
  ```

The citation is always computed from the anchor stored in the file, never from what
was typed, so it can only print what the source says: an inferred folio is printed in
brackets (`p. [3]`), a page without folio is `s. p.` in Spanish and `n. pag.` in
English, and a folio or page that the document does not have is reported as missing
and nothing is copied.

The menus and dialogs are in English and Spanish (Fluent, `locale/en-US` and
`locale/es-ES`). Citations follow Zotero's interface language: Spanish when it is
Spanish, English otherwise (SPEC §18).

## Install

1. Download `spdf-zotero-<version>.xpi` (or build it, see below).
2. In Zotero: **Tools → Plugins**, then the gear menu → **Install Plugin From File…**,
   and choose the `.xpi`.

The plugin needs Zotero 7 or Zotero 8 (`strict_min_version` 6.999, `strict_max_version`
8.*). It installs nothing else and downloads nothing.

## Use

**Import SPDF as Item…** creates the item with
`Zotero.Utilities.Item.itemFromCSLJSON` from `documents.metadata` without its `spdf`
extension (exactly what `spdf-format`'s `toCslJson` exports). Legacy Scholaris files
(SPDF 4.0 and 4.1, usually gzip-wrapped, with Spanish table names) are read too; their
metadata is mapped to CSL-JSON by `spdf-format` (`mapLegacyMetadata`). The file is then
copied into Zotero's storage with `Zotero.Attachments.importFromFile` (media type
`application/vnd.spdf`), and the new item is selected.

Both Import and Attach add one line to the item's **Extra** field:

```
SPDF: sha256-<64 hex digits>
```

That is the document reference of the file (its `source_sha256`), the same one anchor
URIs carry, so a URI found in a manuscript can be matched to the item later. Other
lines of Extra are kept; the line is not repeated.

**Copy Citation with Folio…** accepts:

| You type | Meaning |
| --- | --- |
| `145`, `xiv`, `1r`, `p. 145`, `pág. 12` | a printed folio, as printed (`XIV` also finds `xiv`) |
| `[21]` | the same, with the brackets of an inferred folio |
| `145-146`, `pp. 2-[3]` | a range of folios |
| `p=12`, `#12`, `p=12-13` | a physical page (position in the original), or a range |
| `f=A-3` | a printed folio, explicitly (for folios that contain a dash) |
| `spdf:sha256-…#p=29&f=21` | a full anchor URI; `char=` and `xywh=` are kept |
| `spdf:sha256-…` | the whole document: `(Saorín Ferrer, 2026)` |

An anchor URI is resolved as SPEC §5.4 says: `p` first, then `f`, then `t` (time), then
slides, sheets, verses, canonical references and sections. If the item has several
SPDF attachments, a URI picks the one whose document it names, and a folio asks which
attachment to use. If two pages carry the same folio, the plugin asks which one.

What the plugin refuses: files that are not SQLite, of an unknown version, with views
or triggers, or with an unknown required extension (SPEC §2.4). It does not run the
full validator when importing (see Design); use the web validator or
`npx spdf-format validate file.spdf` to audit a file.

## Design

- **The format is not reimplemented.** Everything SPDF-specific (opening safely,
  legacy 4.x mapping, anchors and anchor URIs, the short citation, CSL-JSON export)
  comes from the official TypeScript library, `spdf-format`, whose engine-less core
  (`spdf-format/core`) is bundled into the plugin by esbuild.
- **SQLite is Zotero's own.** `src/engine.ts` is a `spdf-format` `SqlEngine` over
  `Sqlite.sys.mjs` (`resource://gre/modules/Sqlite.sys.mjs`), the asynchronous
  mozStorage wrapper Zotero 7 (Firefox 115) and Zotero 8 (Firefox 140) ship. The whole
  `SpdfDocument` API (units, fragments, `cite`, `anchorUri`, search, `validate`, `dump`)
  therefore works inside Zotero with no second SQLite in the package.
- **Read only.** Files are opened with `Sqlite.openConnection({ path, readOnly: true })`
  (`SQLITE_OPEN_READONLY`); mozStorage keeps extension loading off; the core then sets
  `PRAGMA query_only = 1` and `PRAGMA trusted_schema = OFF`, and refuses views and
  triggers. Only temporary copies (a decompressed legacy file, the private copy used
  by the FTS5 integrity check) are written, in Zotero's temp directory, and they are
  deleted when the connection closes.
- **Column names.** A `mozIStorageRow` can be read by index or by a known name but
  cannot list its columns, while the core expects rows keyed by column name.
  `src/sql.ts` infers the names the way SQLite assigns them (the `AS` alias, the column
  of a bare reference, the expression text otherwise, fixed names for PRAGMAs), and the
  engine checks every inferred name against the first row with `getResultByName`, so a
  wrong guess is an error, never mislabelled data. The tests check the inference
  against SQLite's own names and run every statement the core issues through it.
- **Gzip.** Legacy files are gunzipped with `DecompressionStream`, taken from Zotero's
  main window because the plugin sandbox does not have the Compression Streams API,
  with the 4 GiB output limit of SPEC §2.3.
- **Compartments.** Bytes from `IOUtils`, mozStorage or the main window are copied into
  typed arrays of the plugin's own realm, because the core tests `instanceof
  Uint8Array`. The sandbox also lacks `structuredClone`, which the core uses to copy
  metadata; the bundle gets a JSON-based fallback (`src/shims/structured-clone.ts`).
- **One file.** `bootstrap.js` is the whole plugin: the bundle followed by the
  bootstrap hooks. The plugin never loads a second script from its own `jar:` URL, and
  the file is pure ASCII so its decoding never depends on the script loader.
- **Menus.** On Zotero 8 the entries are registered with `Zotero.MenuManager`
  (targets `main/menubar/tools` and `main/library/item`); on Zotero 7, which has no menu
  API, they are added to `menu_ToolsPopup` and `zotero-itemmenu` in each main window,
  as Zotero's sample plugin does. Labels come from Fluent in both cases.
- **No full validation on import.** The validator's content-hash step re-reads every
  blob (page images, the original PDF), and mozStorage returns BLOBs as JavaScript
  arrays of numbers, which is slow and memory-hungry for a large book. Firefox's SQLite
  may also lack FTS5, which the integrity check needs. A reference manager only needs
  the metadata and the anchors, and the safety checks a reader must make are made.

## Build and test

```sh
cd integrations/zotero
npm install          # spdf-format comes from ../../js (file: dependency)
npm run build        # dist/addon/ and dist/spdf-zotero-<version>.xpi
npm test             # typecheck, build, then all tests
```

`spdf-format` must be built first (`cd js && npm run build`), since the plugin bundles
`js/dist`. The build is reproducible: same sources, same `.xpi` bytes.

For development, Zotero can load the unpacked plugin: in a **test profile**, create a
text file named `spdf@joseluissaorin.com` in the profile's `extensions` directory whose
only line is the absolute path of `dist/addon/`, then start Zotero with `-purgecaches`.

### How it is tested

There is no Zotero in the test run. Everything that does not need Zotero runs in Node
with `node:sqlite`, against the shared fixtures (`integrations/fixtures`) and the legacy
conformance files (`conformance/legacy`):

- `test/engine.test.ts`: the adapter runs over a stand-in for `Sqlite.sys.mjs` built on
  `node:sqlite` whose rows behave like `mozIStorageRow` (values by index, no column
  names, BLOBs as arrays of octets, one statement per call, the same parameter binding
  rules). Through it, every fixture and legacy file gives the same canonical dump, units,
  fragments, citations, search results and validation report as the official Node
  engine of `spdf-format`. Read-only opening, temp-file cleanup, gzip limits and
  refusals (E001, E020) are checked too.
- `test/sql.test.ts`: column-name inference compared with SQLite's own names, statement
  splitting, placeholder renaming.
- `test/locate.test.ts`: folio, page, range and URI lookup and the citations, for
  example `(Saorín Ferrer, 2026, p. 1)` for physical page 2, `p. [3]` for the inferred
  plate, `s. p.` / `n. pag.` for the cover, roman folios and time anchors in legacy files,
  and "not found" for folios and pages that do not exist.
- `test/commands.test.ts`: the three commands against a fake `Zotero` that records items,
  CSL-JSON, attachments, Extra and the clipboard.
- `test/plugin.test.ts`: startup, both menu paths (DOM for Zotero 7, `MenuManager` for
  Zotero 8), windows opening and closing, shutdown, and the real host code
  (`Services.prompt`, `FilePicker`, `IOUtils`, `PathUtils`, `Localization`) over fakes.
- `test/l10n.test.ts`: English and Spanish have the same messages, every id used in the
  code exists, Spanish has its accents and « » quotes.
- `test/xpi.test.ts`: the `.xpi` unzips, the manifest declares
  `spdf@joseluissaorin.com`, 6.999 to 8.*, and `bootstrap.js` itself runs startup,
  import, citation and shutdown in a `vm` context holding only the globals of Zotero's
  plugin sandbox (no `window`, `console`, `DecompressionStream` or `structuredClone`).

### What still has to be checked by hand

None of this has run inside a real Zotero yet. Before a release, in a test profile of
**Zotero 7** and of **Zotero 8**:

1. The plugin installs from the `.xpi`, shows in Tools → Plugins, and can be disabled,
   enabled and removed without errors in the Error Console.
2. The three entries appear with their labels (English and Spanish UI); in Zotero 7 in
   the Tools menu and the item context menu (DOM path); in Zotero 8 through
   `Zotero.MenuManager`, and Attach / Copy citation appear only when they apply.
3. Import: the file picker filters `.spdf`; the item gets the right type, creators, date
   and Extra line; the file is copied into storage; it lands in the selected
   collection; a read-only group library is refused.
4. `Sqlite.openConnection({ readOnly: true })` opens files in Zotero's storage and in
   arbitrary folders, and the column-name check passes on real `mozIStorageRow`s (the
   fake models them from the IDL and Zotero's own use of them).
5. A legacy gzip-wrapped 4.x file imports (`DecompressionStream` from the main window,
   temp file in Zotero's `tmp` directory, removed afterwards).
6. Copy Citation: `Services.prompt` dialogs, the clipboard content, the progress notice;
   the "not found" warnings.
7. Large files (hundreds of MB, thousands of pages) open and cite in reasonable time.
8. The `update_url` in the manifest
   (`https://spdf.joseluissaorin.com/zotero/updates.json`) is served by the website, or
   is removed; until then Zotero simply finds no updates.

## License

MIT OR Apache-2.0, like the rest of the SPDF code. The specification is CC BY 4.0.
