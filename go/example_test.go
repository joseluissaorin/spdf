package spdf_test

import (
	"fmt"

	spdf "github.com/joseluissaorin/spdf/go"
)

func ExampleAnchorURI() {
	a := spdf.Anchor{"type": "page", "physical": int64(29), "printed": "21", "chars": []any{int64(118), int64(301)}}
	uri := spdf.AnchorURI("sha256-3f2a", a, nil)
	fmt.Println(uri)
	docref, loc, _ := spdf.ParseURI(uri)
	fmt.Println(docref, *loc.P, *loc.F, loc.Char)
	// Output:
	// spdf:sha256-3f2a#p=29&f=21&char=118,301
	// sha256-3f2a 29 21 [118 301]
}

func ExampleCite() {
	md := map[string]any{
		"type":   "book",
		"title":  "Arte nuevo de hacer comedias",
		"author": []any{map[string]any{"family": "Vega", "non-dropping-particle": "de", "given": "Lope"}},
		"issued": map[string]any{"date-parts": []any{[]any{int64(1609)}}},
	}
	a := spdf.Anchor{"type": "page", "physical": int64(29), "printed": "21", "source": "inferred"}
	fmt.Println(spdf.Cite(a, nil, md, "es"))
	fmt.Println(spdf.Cite(spdf.Anchor{"type": "time", "t0": 4160.0, "t1": 4175.5}, nil, md, "en"))
	// Output:
	// (de Vega, 1609, p. [21])
	// (de Vega, 1609, 1:09:20)
}

func ExampleCompileLexical() {
	fmt.Println(spdf.CompileLexical(`«lugar de la Mancha» hidalgo`).Match)
	fmt.Println(spdf.CompileLexical(`canción Cancion caballero`).Match)
	// Output:
	// "lugar de la Mancha"
	// "canción" OR "caballero"
}

func ExampleCanonicalJSON() {
	v, _ := spdf.ParseJSON(`{"b": 1.0, "a": [0.1234567, 1e-7]}`)
	fmt.Println(string(spdf.CanonicalJSON(v)))
	// Output: {"a":[0.123457,0],"b":1}
}
