# spdf for Go

Pure-Go implementation of **SPDF** (Semantic Processed Document Format): documents
that have been read once and can be cited forever, because every passage carries its
exact anchor (printed page, folio, second of a recording, slide, verse).

- Module: `github.com/joseluissaorin/spdf/go` (package `spdf`)
- SQLite without cgo ([`modernc.org/sqlite`](https://pkg.go.dev/modernc.org/sqlite), FTS5
  and the `trigram` tokenizer included), so it cross-compiles to every Go target.
- Go 1.25 or newer.
- Conformance: passes the whole SPDF conformance suite (`../conformance`), every kind
  (`dump`, `legacy_dump`, `roundtrip`, `validate`, `search_*`, `anchor_uri`, `cite`).

```sh
go get github.com/joseluissaorin/spdf/go
```

## What it does

| | |
|---|---|
| Safe opening | read-only, `query_only`, `trusted_schema=OFF`, `SQLITE_DBCONFIG_DEFENSIVE`, no extensions, files with triggers or views refused (E020), unknown required extensions refused (E060), max blob size (512 MiB) and max gunzipped size (4 GiB) |
| Versions | SPDF 5.0, and the legacy 4.0 / 4.1 files of Scholaris (Spanish schema, gzip-wrapped) through the 5.0 view, metadata mapped to CSL-JSON |
| Dump | canonical JSON (RFC 8785) of the whole file, `content_sha256` (§8) |
| Validation | every code of the specification (E001–E090, W100–W110), Ed25519 signatures |
| Search | lexical (FTS5 BM25, CJK route with `trigram` or substring), vector (`f32`, `f16`, `i8`), hybrid (reciprocal rank fusion, k = 10) |
| Anchors | anchor ↔ URI (`spdf:sha256-…#p=29&f=21&char=118,301`), strict parser; resolution of a URI or of a `.spdf` URL with a fragment to units and fragments (`Locate`, SPEC §5.4) |
| Citation | short author-date citation in Spanish and English; citation of a quotation by the unit it lies in (`CitePassage`, SPEC §18.2) |
| Export | CSL-JSON (also citations with `label`/`locator`) and BibTeX, one or several documents with the keys of SPEC §19 (`cervantessaavedra1605`, `lazarillo1554`, collision suffixes); ALTO 4, minimal TEI and IIIF Presentation 3 (`ExportALTO`, `ExportTEI`, `ExportIIIF`; no invented coordinates or dimensions) |
| Writer | builds valid SPDF 5.0 files (FTS kept in sync, `VACUUM`, no triggers) with `content_sha256` and, given a key, an Ed25519 signature (§8); `Seal` hashes and signs an existing file in place |

## Reading and searching

```go
package main

import (
	"fmt"
	"log"

	spdf "github.com/joseluissaorin/spdf/go"
)

func main() {
	f, err := spdf.Open("quijote.spdf", nil) // also legacy .spdf (gzip) files
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()

	hits, err := f.SearchLexical("«lugar de la Mancha»", 5)
	if err != nil {
		log.Fatal(err)
	}
	for _, h := range hits {
		cite, _ := f.Cite(h.Anchor, h.AnchorEnd, "es")
		fmt.Println(h.FragmentID, h.Score, h.AnchorURI, cite)
		// q4 1.889394 spdf:sha256-fa38…#p=5&pe=6&f=1r&fe=1v&char=101,278 (Cervantes Saavedra, 1605, fols. 1r-[1v])
	}

	// Vector and hybrid search with your own query embedding.
	vec := make([]float64, 8)
	vhits, _ := f.SearchVector(vec, "toy-embedding@8", "fragment", 5)
	_ = vhits
	hy, _ := f.SearchHybrid("hidalgo", vec, "toy-embedding@8", 5)
	_ = hy

	bib, _ := f.ExportBibTeX()
	fmt.Print(bib)
}
```

## Validating and dumping

```go
res := spdf.Validate("file.spdf", nil)
fmt.Println(res.Valid, res.ErrorCodes(), res.WarningCodes())

f, _ := spdf.Open("file.spdf", nil)
dump, _ := f.DumpJSON()          // RFC 8785 bytes
sum, _ := f.ContentSHA256()      // integrity hash of §8
```

## Anchors and citations

```go
a := spdf.Anchor{"type": "page", "physical": int64(29), "printed": "21", "source": "inferred"}
uri := spdf.AnchorURI("sha256-3f2a…", a, nil)      // spdf:sha256-3f2a…#p=29&f=21
docref, loc, err := spdf.ParseURI(uri)              // strict: malformed URIs are errors
text := spdf.Cite(a, nil, map[string]any{
	"type": "book", "title": "Arte nuevo de hacer comedias",
	"author": []any{map[string]any{"family": "Vega", "non-dropping-particle": "de", "given": "Lope"}},
	"issued": map[string]any{"date-parts": []any{[]any{int64(1609)}}},
}, "es")                                            // (de Vega, 1609, p. [21])
```

## Citing a quotation

```go
p, _ := f.CitePassage("m4", "Schem. XXXIV.", "en")   // the unit the quotation is in, not the fragment start
fmt.Println(p.Text, p.URI)
```

## Resolving references

```go
r, _ := f.Locate("spdf:sha256-…#f=1v")                   // or "https://example.org/quijote.spdf#p=7"
fmt.Println(r.Document, r.Units, r.Fragments, r.Char)   // true [p6] [q4 q5] []
```

## Writing

```go
w, err := spdf.Create("out.spdf", &spdf.WriterOptions{Generator: "my-tool/1.0"})
if err != nil {
	log.Fatal(err)
}
w.SetDocument(spdf.Document{ID: "doc", Kind: "pdf", Mime: "application/pdf",
	SourceSHA256: sha, Bytes: n, Metadata: map[string]any{"type": "book", "title": "…"}})
w.AddUnit(spdf.Unit{ID: "u1", Reader: "pdf-text-layer", Text: "…",
	Anchor: spdf.Anchor{"type": "page", "physical": int64(1), "printed": "1"}})
w.AddFragment(spdf.Fragment{ID: "f1", Unit: "u1", Text: "…",
	Anchor: spdf.Anchor{"type": "page", "physical": int64(1), "printed": "1"}})
w.AddSpace(spdf.SpaceDef{ID: "embeddinggemma-2@768", Provider: "local", Model: "embeddinggemma-2", Dims: 768})
w.AddVector("fragment", "f1", "embeddinggemma-2@768", embedding) // []float32, quantized for f16/i8
w.AddBlob("pages/0001.png", "image/png", png)
if err := w.Close(); err != nil { // rebuilds FTS, VACUUM, atomic rename
	log.Fatal(err)
}
```

Every file the Writer produces carries `spdf_meta.content_sha256`; pass
`WriterOptions{SigningKey: ed25519.NewKeyFromSeed(seed)}` to sign it too (`signer`,
`signature`). Files signed this way verify with the Rust, Python and JavaScript
implementations (and tampering gives E081 or E082 in all of them).
`spdf.Seal(path, key)` does the same for an existing file.

`spdf.WriteSource(source, path)` builds a file from a full JSON dump (the format of
`conformance/sources/`).

## Command line

```sh
go install github.com/joseluissaorin/spdf/go/cmd/spdf@latest
spdf validate file.spdf
spdf dump file.spdf
spdf search file.spdf "lugar de la Mancha" -n 5
spdf cite file.spdf q4 -locale en
spdf export file.spdf bibtex
spdf uri parse 'spdf:sha256-…#p=29&f=21'
spdf build source.json out.spdf
spdf seal out.spdf -key seed.hex             # content_sha256 + Ed25519 signature
spdf export file.spdf alto                   # also tei, iiif
spdf conformance ../conformance -o conformance.json
```

## Conformance

```sh
go test ./...                                    # unit tests and the whole suite
go run ./cmd/spdf conformance ../conformance     # the report of contract §11
```

The runner discovers the cases by listing `conformance/cases/*.json` and prints
`{"impl","version","passed","failed","skipped"}`. Nothing is skipped: this is a full
(reader and writer) implementation.

## License

MIT OR Apache-2.0.
