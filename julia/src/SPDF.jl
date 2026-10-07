"""
    SPDF

Read, validate, search, cite and write SPDF (Semantic Processed Document Format) files:
documents read once and citable forever. Every passage carries its exact anchor
(printed page, folio, second of a recording, slide, verse).

```julia
using SPDF
doc = SPDF.open("quijote.spdf")
for hit in search_lexical(doc, "lugar de la Mancha")
    println(cite(doc, hit.anchor; locale = "es"), "  ", hit.anchor_uri)
end
close(doc)
```
"""
module SPDF

using SQLite
using DBInterface
using JSON
using SHA
using CodecZlib
using Unicode
using Printf
using Base64
using Dates

export SpdfError, Document, metadata, title, docref, units, fragments, sections, figures, spaces,
       blobs, blob, provenance, extensions, meta, vectors, dump, dump_json, content_sha256,
       search_lexical, search_vector, search_hybrid, anchor_uri, locator, format_locator,
       parse_uri, cite, csl_item, csl_json, bibtex, validate, write_source, Writer,
       canonical_json, quantize, conformance, locate, bibtex_key

include("errors.jl")
include("json.jl")
include("text.jl")
include("vectors.jl")
include("ed25519.jl")
include("legacy.jl")
include("container.jl")
include("document.jl")
include("anchoruri.jl")
include("cite.jl")
include("bibliography.jl")
include("search.jl")
include("validate.jl")
include("writer.jl")
include("conformance.jl")

end # module
