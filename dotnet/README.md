# Spdf.Format for .NET

Native C# implementation of **SPDF** (Semantic Processed Document Format): documents that
have been read once and can be cited forever, because every passage carries its exact
anchor (printed page, folio, second of a recording, slide, verse).

- NuGet package: `Spdf.Format` · namespace `Spdf` · .NET 8 or newer.
- SQLite through `Microsoft.Data.Sqlite.Core` with the `SQLitePCLRaw.bundle_e_sqlite3`
  native bundle (FTS5 and the `trigram` tokenizer included) on Windows, macOS and Linux.
- An independent implementation: it does not wrap the Rust library or any other one.
  Ed25519 verification, RFC 8785 serialization and the exact rounding rules are written in C#.
- Conformance: passes the whole SPDF conformance suite (`../conformance`), every kind
  (`dump`, `legacy_dump`, `roundtrip`, `quantize`, `validate`, `search_lexical`,
  `search_vector`, `search_hybrid`, `anchor_uri`, `cite`, `locate`, `export_csl`,
  `export_bibtex`, `export_structure`). Nothing is skipped.

```sh
dotnet add package Spdf.Format
```

## What it does

| | |
|---|---|
| Safe opening | read-only, `query_only`, `trusted_schema=OFF`, `SQLITE_DBCONFIG_DEFENSIVE`, extension loading disabled, `mmap_size=0`, `cell_size_check=ON`; triggers, views and foreign virtual tables refused (E020), unknown required extensions refused (E060); max blob size (512 MiB) and max gunzipped size (4 GiB); files left in WAL mode are read from a private copy |
| Versions | SPDF 5.0, and the legacy 4.0 / 4.1 files of Scholaris (Spanish schema, gzip-wrapped) through the 5.0 view, with metadata mapped to CSL-JSON |
| Dump | canonical JSON (RFC 8785) of the whole file and `content_sha256` (§12, §13) |
| Validation | every code of the specification (E001–E090, W100–W110), FTS integrity on an in-memory copy, Ed25519 signatures |
| Search | lexical (FTS5 BM25, CJK route with `trigram` or substring), vector over fragments, units or figures (`f32`, `f16`, `i8`; dot product or cosine), hybrid (reciprocal rank fusion, k = 10) |
| Anchors | anchor ↔ URI (`spdf:sha256-…#p=29&f=21&char=118,301`), strict parser, canonical form; resolution of `spdf:` URIs and `.spdf` URLs to units and fragments (§5.4) |
| Citation | short author-date citation in Spanish and English |
| Export | CSL-JSON (with the CSL `label`/`locator` of a citation) and BibTeX with the keys of §19.1 (`cervantessaavedra1605`, `lazarillo1554`, `anonnd`, collision suffixes `a`, `b`…); ALTO 4, minimal TEI and IIIF Presentation 3 (§19.4) |
| Writer | builds valid SPDF 5.0 files (FTS kept in sync, `VACUUM`, no triggers, atomic replace), with `content_sha256` and an optional Ed25519 signature (§13) |

## Reading and searching

```csharp
using Spdf;

using var file = SpdfFile.Open("quijote.spdf");   // also legacy .spdf (gzip) files

foreach (var hit in file.SearchLexical("«lugar de la Mancha»", limit: 5))
{
    Console.WriteLine($"{hit.FragmentId} {hit.Score:F6} {hit.AnchorUri}");
    Console.WriteLine(file.Cite(hit.Anchor!, hit.AnchorEnd, "es"));
    // (Cervantes Saavedra, 1605, fols. 1r-[1v])
}

// Vector and hybrid search with your own query embedding.
double[] query = new double[8];
var nearest = file.SearchVector(query, space: "toy-embedding@8", target: "fragment", limit: 5);
var pages = file.SearchVector(query, "toy-embedding@8", target: "unit");      // hits carry UnitId
var fused = file.SearchHybrid("hidalgo", query, "toy-embedding@8", limit: 5);

// Typed reading.
Document doc = file.GetDocument();
IReadOnlyList<Unit> pages = file.GetUnits();
IReadOnlyList<Fragment> fragments = file.GetFragments();
Blob? original = file.GetBlob("blob:original.pdf");

Console.Write(file.ExportBibTeX());              // @book{cervantessaavedra1605, …
Console.WriteLine(file.ExportCslJson());         // [{"id":"cervantessaavedra1605", …}]
BibTexEntry entry = file.ExportBibTeXEntry();    // entry type, key and fields

// Several documents at once (keys disambiguated with a, b, c…), and a CSL citation item.
string bib = BibliographyExport.BibTeX([file.GetMetadata(), other.GetMetadata()]);
var cited = BibliographyExport.CslItems([file.GetMetadata()], hit.Anchor, hit.AnchorEnd);  // + label, locator

// Resolving a reference (§5.4): units, fragments, char range and region it designates.
LocateResult where = file.Locate("spdf:sha256-…#p=5&pe=6&char=101,278");
LocateResult byUrl = file.Locate("https://example.org/quijote.spdf#f=1v");

// Structural exports (§19.4): ALTO 4, a minimal TEI and a IIIF Presentation 3 manifest.
// No invented coordinates or dimensions; inferred folios bracketed (TEI, IIIF) or absent (ALTO).
string alto = file.ExportAlto();      // Page per page unit, TextBlock / TextLine / String per word
string tei = file.ExportTei();        // teiHeader, <pb n facs/>, <p>, <lg>/<l n>, <u who>, <note place="foot">
string iiif = file.ExportIiif(new IiifOptions { Base = "https://example.org/quijote" });
var pageSequence = StructureExport.PageSequence(StructureFormat.Tei, tei);   // read back from the XML
```

`SpdfFile.OpenAsync(path)` decompresses or copies asynchronously when the file needs it;
`SpdfFile.Open(stream)` and `SpdfFile.Open(bytes)` read from memory. A `SpdfFile` is not
thread-safe; open one per thread.

## Validating and dumping

```csharp
ValidationResult result = SpdfValidator.Validate("file.spdf");
Console.WriteLine($"{result.Valid} {string.Join(",", result.ErrorCodes)} {string.Join(",", result.WarningCodes)}");

using var file = SpdfFile.Open("file.spdf");
string dump = file.DumpJson();          // RFC 8785 text
string hash = file.ContentSha256();     // integrity hash of §13
```

## Anchors and citations

```csharp
var anchor = Anchor.Page(29, "21", source: "inferred").WithChars(118, 301);
string uri = AnchorUri.Format("sha256-3f2a…", anchor);   // spdf:sha256-3f2a…#p=29&f=21&char=118,301
ParsedAnchorUri parsed = AnchorUri.Parse(uri);           // FormatException if malformed

var metadata = new Dictionary<string, object?>
{
    ["type"] = "book",
    ["title"] = "Arte nuevo de hacer comedias",
    ["author"] = new List<object?> { new Dictionary<string, object?> { ["family"] = "Vega", ["non-dropping-particle"] = "de", ["given"] = "Lope" } },
    ["issued"] = new Dictionary<string, object?> { ["date-parts"] = new List<object?> { new List<object?> { 1609L } } },
};
Console.WriteLine(Citation.Cite(anchor, null, metadata, "es"));   // (de Vega, 1609, p. [21])
```

JSON values (metadata, anchors, word timings) are plain trees: `null`, `bool`, `long`,
`double`, `string`, `List<object?>` and `Dictionary<string, object?>`. `SpdfJson` parses
and serializes them (`Canonical` is RFC 8785 with the six-decimal rounding of the
specification; `Compact` keeps numbers as they are).

## Writing

```csharp
using var w = SpdfWriter.Create("out.spdf", new SpdfWriterOptions { Generator = "my-tool/1.0" });
w.SetDocument(new Document
{
    Id = "rimas", Kind = "pdf", Mime = "application/pdf", SourceSha256 = sha, Bytes = size,
    Metadata = new Dictionary<string, object?> { ["type"] = "book", ["title"] = "Rimas" },
});
w.AddUnit(new Unit { Id = "u1", Reader = "pdf-text-layer", Text = "…", Anchor = Anchor.Page(1, "1") });
w.AddFragment(new Fragment { Id = "f1", Unit = "u1", Text = "…", Anchor = Anchor.Page(1, "1").WithChars(0, 120) });
w.AddSpace(new Space { Id = "embeddinggemma-2@768:i8", Provider = "local", Model = "embeddinggemma-2", Dims = 768, DType = "i8" });
w.AddVector("fragment", "f1", "embeddinggemma-2@768:i8", embedding);   // float[] or double[], quantized per §9.2
w.AddBlob("original.pdf", "application/pdf", bytes);
w.Commit();   // document + spdf_meta, FTS rebuild, VACUUM, atomic move into place
```

Disposing a writer without `Commit()` discards the file. `SpdfSource.Write(source, path)`
builds a file from a full JSON dump (the format of `conformance/sources/`), value for value.

### Integrity and signatures

By default the writer stores `spdf_meta.content_sha256` (§13), computed on the finished file.
Give it a 32-byte Ed25519 secret key (seed) to sign as well; it writes `signer`
(`ed25519:` + base64 public key) and `signature` (base64 of the RFC 8032 signature over
`spdf-content-sha256:` + the hex hash):

```csharp
byte[] seed = LoadSeedFromYourKeyStore();   // 32 bytes; never commit it to a repository
using var w = SpdfWriter.Create("signed.spdf", new SpdfWriterOptions { SigningKey = seed });
// … rows …
w.Commit();
bool ok = SpdfValidator.Validate("signed.spdf").Valid;   // recomputes the hash, verifies the signature
```

**The Ed25519 signer is not constant-time.** It is a portable BigInteger implementation
(.NET 8 has no built-in Ed25519): signing handles the secret key with variable-time
arithmetic, which can leak it through timing to anyone able to measure many signatures on
the same machine. Sign only on a trusted machine, never in a shared or multi-tenant
service. Verification uses public data only and is safe anywhere. `Ed25519.Sign`,
`Ed25519.PublicKey`, `Ed25519.Verify` and `SpdfValidator.SignContentHash` are public for
producers that sign outside the writer.

## Command line

The repository includes a small CLI (`src/Spdf.Cli`, not published as a package):

```sh
dotnet run --project src/Spdf.Cli -- validate file.spdf
dotnet run --project src/Spdf.Cli -- dump file.spdf
dotnet run --project src/Spdf.Cli -- search file.spdf "lugar de la Mancha" -n 5
dotnet run --project src/Spdf.Cli -- vsearch file.spdf toy-embedding@8 0.5,0.25,0.5,0.25,0,0.25,0.25,0.5
dotnet run --project src/Spdf.Cli -- cite file.spdf q4 --locale en
dotnet run --project src/Spdf.Cli -- export file.spdf bibtex        # also csl, alto, tei, iiif
dotnet run --project src/Spdf.Cli -- sample demo.spdf --key-file seed.hex   # small signed demo file
dotnet run --project src/Spdf.Cli -- uri parse 'spdf:sha256-…#p=29&f=21'
dotnet run --project src/Spdf.Cli -- build source.json out.spdf
dotnet run --project src/Spdf.Cli -- conformance ../conformance -o conformance.json
```

## Building and testing

```sh
cd dotnet
dotnet build
dotnet test                       # unit tests and the whole conformance suite
dotnet run --project src/Spdf.Cli -- conformance ../conformance -o conformance.json
dotnet pack src/Spdf.Format -c Release -o artifacts
```

The test project finds the suite at `../conformance` relative to `dotnet/`; set
`SPDF_CONFORMANCE_DIR` to use another copy. The runner discovers the cases by listing
`conformance/cases/*.json` and prints `{"impl","version","passed","failed","skipped"}`.

## License

MIT OR Apache-2.0.
