# SPDF for Swift

Native Swift implementation of **SPDF** (Semantic Processed Document Format): documents
that have been read once and can be cited forever, because every passage carries its
exact anchor (printed page, folio, second of a recording, slide, verse).

- SwiftPM package `SPDF` for iOS 16+, macOS 13+, tvOS 16+, watchOS 9+, visionOS 1+ and
  Linux.
- Uses the **system SQLite** (FTS5, `unicode61 remove_diacritics 2` and `trigram` are
  present on iOS and macOS; verified on the iOS simulator and on macOS). On Linux it
  links the distribution's `libsqlite3` (install `libsqlite3-dev` and `zlib1g-dev`).
- No third-party code on Apple platforms (CryptoKit for SHA-256 and Ed25519, zlib for
  gzip). On Linux, [`swift-crypto`](https://github.com/apple/swift-crypto) provides the
  same CryptoKit API.
- API with `async` variants, `Sendable` and `Codable` types; `SPDFFile` is thread-safe.
- Conformance: passes the whole SPDF conformance suite (`../conformance`), every kind,
  on macOS and on the iOS simulator.

## Installation

```swift
.package(url: "https://github.com/joseluissaorin/spdf", from: "0.1.0")
// target dependency:
.product(name: "SPDF", package: "spdf")
```

The repository root carries a thin `Package.swift` pointing into `swift/`, so the URL
above is all SwiftPM needs; versions follow the monorepo-wide tags (`0.1.0`, …).

## Reading and searching

```swift
import SPDF

let file = try await SPDFFile.open(url)          // 5.0, or a legacy 4.x .spdf (gzip)
defer { file.close() }

for hit in try await file.searchLexical("«lugar de la Mancha»", limit: 5) {
    let cite = try file.cite(hit.anchor!, end: hit.anchorEnd, locale: "es")
    print(hit.id, hit.score, hit.anchorURI, cite)
    // q4 1.889394 spdf:sha256-fa38…#p=5&pe=6&f=1r&fe=1v&char=101,278 (Cervantes Saavedra, 1605, fols. 1r-[1v])
}

// Vector and hybrid search with your own query embedding (dot product when the
// space is normalized, cosine otherwise).
let vector: [Double] = embed(query)
let semantic = try await file.searchVector(vector, space: "embeddinggemma-2@768", limit: 10)
let hybrid = try await file.searchHybrid(query, vector: vector, space: "embeddinggemma-2@768", limit: 10)

let units = try await file.units()                // pages, time spans, slides…
let bib = try file.exportBibTeX()                 // keys of SPEC §19: cervantessaavedra1605…
let csl = try file.exportCSL()
let alto = try file.exportALTO()                  // also exportTEI(), exportIIIF()

// Resolve a reference (SPEC §5.4): an spdf: URI or a .spdf URL with a fragment.
let where = try file.locate("https://example.org/quijote.spdf#p=7")   // units ["p7"], fragments ["q5"]
```

Every method also has a synchronous form (`try file.searchLexical(…)`), handy in
command-line tools and tests.

## Validation and canonical dump

```swift
let report = SPDFValidator.validate(url)          // ValidationResult: Codable
print(report.valid, report.errorCodes, report.warningCodes)

let json = try file.dumpJSON()                     // RFC 8785 canonical JSON
let hash = try file.contentSHA256()                // integrity hash (§8)
```

Opening is defensive: read-only, `query_only`, `trusted_schema=OFF`,
`SQLITE_DBCONFIG_DEFENSIVE`, no extensions; files with triggers, views or foreign virtual
tables (E020) or unknown required extensions (E060) are refused; strings and blobs are
capped (512 MiB) and so is gunzipped input (4 GiB).

## Anchors and citations

```swift
let anchor = Anchor(["type": "page", "physical": 29, "printed": "21", "source": "inferred"])
let uri = AnchorURI.format(docref: "sha256-3f2a…", anchor: anchor)   // spdf:sha256-3f2a…#p=29&f=21
let parsed = try AnchorURI.parse(uri)                                  // strict parser
let text = Citation.cite(anchor, metadata: [
    "type": "book", "title": "Arte nuevo de hacer comedias",
    "author": [["family": "Vega", "non-dropping-particle": "de", "given": "Lope"]],
    "issued": ["date-parts": [[1609]]],
], locale: "es")                                                       // (de Vega, 1609, p. [21])
```

## Writing

```swift
let writer = try SPDFWriter(url: out, options: .init(generator: "my-app/1.0"))
try writer.setDocument(SPDFDocumentInfo(id: "doc", kind: "pdf", metadata: ["type": "book", "title": "…"],
                                        sourceSHA256: sha, mime: "application/pdf", bytes: size))
let page = Anchor(["type": "page", "physical": 1, "printed": "1"])
try writer.add(SPDFUnit(id: "u1", anchor: page, text: "…", reader: "pdf-text-layer"))
try writer.add(SPDFFragment(id: "f1", unit: "u1", text: "…", anchor: page))
try writer.add(VectorSpace(id: "embeddinggemma-2@768", provider: "local", model: "embeddinggemma-2", dims: 768))
try writer.addVector(target: .fragment, id: "f1", space: "embeddinggemma-2@768", values: embedding) // [Float]
try writer.addBlob(key: "pages/0001.png", mime: "image/png", data: png)
try writer.finish()   // FTS rebuilt, content_sha256 written, VACUUM, atomic replace; no triggers
```

Every file the writer produces carries `spdf_meta.content_sha256`; pass
`.init(signingKey: seed)` (a 32-byte Ed25519 seed) to sign it too (`signer`,
`signature`, SPEC §8). Files signed this way verify with the Go, Rust, Python, C# and
JavaScript implementations. `SPDFSeal.seal(url, signingKey:)` hashes and signs an
existing file in place.

`SPDFSource.write(_:to:)` builds a file from a full JSON dump (the format of
`conformance/sources/`).

## Command line

```sh
swift run spdf-swift validate file.spdf
swift run spdf-swift dump file.spdf
swift run spdf-swift search file.spdf "lugar de la Mancha" -n 5
swift run spdf-swift cite file.spdf q4 -locale en
swift run spdf-swift export file.spdf bibtex
swift run spdf-swift uri parse 'spdf:sha256-…#p=29&f=21'
swift run spdf-swift build source.json out.spdf
swift run spdf-swift seal out.spdf -key seed.hex
swift run spdf-swift export file.spdf tei            # also alto, iiif
swift run spdf-swift conformance ../conformance -o conformance.json
```

## Tests and conformance

```sh
swift test                                   # unit tests + the whole suite
xcodebuild test -scheme SPDF-Package -destination 'platform=iOS Simulator,name=iPhone 17'
```

The runner (`SPDFConformance`) discovers the cases by listing `conformance/cases/*.json`
and prints `{"impl","version","passed","failed","skipped"}`. Nothing is skipped: this is
a full (reader and writer) implementation.

## License

MIT OR Apache-2.0.
