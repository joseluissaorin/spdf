# SPDF.jl

Read, validate, search, cite and write **SPDF** files (Semantic Processed Document
Format) from Julia. A SPDF file holds a document that has been read once and can be
cited forever: every passage carries its exact anchor (printed page, folio, second of a
recording, slide, verse), so a citation can only print what the source says.

Native implementation of SPDF 5.0 on SQLite.jl. It also reads the legacy 4.0/4.1 files
produced by Scholaris (gzip-wrapped, Spanish schema) through the 5.0 view.

## Install

```julia
using Pkg
Pkg.add("SPDF")   # once registered; until then:
Pkg.add(url = "https://github.com/joseluissaorin/spdf", subdir = "julia")
```

## Read, search, cite

```julia
using SPDF

SPDF.open("quijote.spdf") do doc
    println(title(doc), " (", doc.version, ")")
    for hit in search_lexical(doc, "\"lugar de la Mancha\""; limit = 5)
        f = SPDF.fragment(doc, hit.fragment_id)
        println(cite(doc, hit.anchor, f["anchor_end"]; locale = "es"))   # (Cervantes Saavedra, 1605, fols. 1r-[1v])
        println(hit.anchor_uri)                                          # spdf:sha256-…#p=5&pe=6&f=1r&fe=1v&char=101,278
    end
    println(bibtex(doc))
end
```

`units(doc)`, `fragments(doc)`, `sections(doc)`, `figures(doc)`, `spaces(doc)`,
`blobs(doc)` and `provenance(doc)` return vectors of `Dict`s with the 5.0 column names;
`metadata(doc)` is the CSL-JSON item. `vectors(doc, space)` gives the decoded vectors
(f32, f16 or i8) as `Dict(id => Vector{Float64})`.

```julia
search_vector(doc, qvec, "embeddinggemma-2@768"; limit = 10)
search_hybrid(doc, "ciego jarro", qvec, "embeddinggemma-2@768")   # RRF, k = 10
parse_uri("spdf:sha256-3f2a…#p=29&f=21&char=118,301")
locate(doc, "spdf:sha256-3f2a…#p=29")    # Dict("document", "units", "fragments", "char", "xywh")
csl_item(doc)["id"]                       # "cervantessaavedra1605", the BibTeX key (SPEC §19)
validate("file.spdf")       # Dict("valid" => true, "errors" => [], "warnings" => [], …)
```

## Write

```julia
w = SPDF.Writer("out.spdf"; generator = "my-app/1.0", profile = "core")
SPDF.document!(w, Dict("id" => "d1", "kind" => "pdf", "source_sha256" => bytes2hex(sha256(read("d1.pdf"))),
    "mime" => "application/pdf", "bytes" => filesize("d1.pdf"), "unit_count" => 1,
    "metadata" => Dict("type" => "book", "title" => "Lazarillo de Tormes", "issued" => Dict("date-parts" => [[1554]]))))
SPDF.unit!(w, Dict("id" => "p1", "ord" => 1, "anchor" => Dict("type" => "page", "physical" => 1, "printed" => "3"),
    "text" => "Pues sepa Vuestra Merced…", "reader" => "pdf-text-layer"))
SPDF.fragment!(w, Dict("n" => 1, "id" => "f1", "unit" => "p1", "ord" => 1, "text" => "Pues sepa Vuestra Merced…",
    "anchor" => Dict("type" => "page", "physical" => 1, "printed" => "3")))
SPDF.finish!(w)    # FTS rebuilt, no triggers or views, VACUUM, atomic rename
```

## Security

Files are untrusted input: `SPDF.open` connects read-only (`mode=ro`), sets
`query_only`, `trusted_schema=OFF` and `SQLITE_DBCONFIG_DEFENSIVE`, never loads
extensions, refuses triggers, views and foreign virtual tables (except the three FTS
triggers of legacy files), bounds blob sizes and gzip inflation, and copies WAL-mode
files before opening them. Signatures are verified with a small pure-Julia Ed25519.

## Conformance

`SPDF.conformance("path/to/spdf/conformance")` runs the shared suite; `Pkg.test()`
runs it too when the package lives in the SPDF repository, and
`julia --project=. bin/conformance.jl ../conformance` prints the JSON report. CI
publishes it as the `conformance-julia` artifact. All kinds are claimed except
`export_structure` (ALTO, TEI and IIIF exports are optional and not implemented).

## License

MIT OR Apache-2.0, at your option. The SPDF specification is CC BY 4.0.
