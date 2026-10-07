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
| Anchors | anchor ↔ URI (`spdf:sha256-…#p=29&f=21&char=118,301`), strict parser |
| Citation | short author-date citation in Spanish and English |
| Export | CSL-JSON and BibTeX |
| Writer | builds valid SPDF 5.0 files (FTS kept in sync, `VACUUM`, no triggers) |

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
