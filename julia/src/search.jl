# Reference search algorithms (specification section 8).

"A search result."
struct Hit
    fragment_id::String
    score::Float64
    via::Vector{String}
    anchor::Any
    anchor_uri::Union{String,Nothing}
    n::Int
end

function fragment_index(doc::Document)
    get!(doc.cache, :fragments_by_n) do
        Dict{Int,Dict{String,Any}}(Int(r["n"]) => r for r in rows(doc, "fragments", "ORDER BY {n}"; only = ["n", "id", "anchor", "anchor_end"]))
    end
end

function fragment_hit(doc::Document, n::Integer, score, via)
    f = get(fragment_index(doc), Int(n), nothing)
    f === nothing && return nothing
    a = f["anchor"]
    e = f["anchor_end"] isa AbstractDict ? f["anchor_end"] : nothing
    return Hit(string(f["id"]), Float64(score), via, a, a isa AbstractDict ? anchor_uri(doc, a, e) : nothing, Int(n))
end

function lexical_trace(doc::Document, qtext::AbstractString, limit::Integer)
    terms, phrases, cjk = query_terms(qtext)
    (isempty(terms) || limit <= 0) && return ("fts", nothing, Hit[])
    match = fts_match(terms, phrases)
    route = "fts"
    if cjk
        if !doc.legacy && "fragments_fts_trigram" in doc.tables && all(t -> length(t) >= 3, terms)
            route = "trigram"
            rs = query(doc.db, "SELECT rowid AS n, bm25(fragments_fts_trigram) AS r FROM fragments_fts_trigram " *
                               "WHERE fragments_fts_trigram MATCH ? ORDER BY r, rowid LIMIT ?", (match, limit))
            hits = [(r["n"], -r["r"]) for r in rs]
        else
            route = "substring"
            match = nothing
            tbl = qident(something(table_name(doc, "fragments"), "fragments"))
            col = doc.legacy ? "\"texto\"" : "\"text\""
            sm = join(fill("(instr($col, ?) > 0)", length(terms)), " + ")
            need = phrases ? length(terms) : 1
            rs = query(doc.db, "SELECT n, ($sm) AS hits FROM $tbl WHERE ($sm) >= ? ORDER BY hits DESC, n LIMIT ?",
                       (terms..., terms..., need, limit))
            hits = [(r["n"], Float64(r["hits"])) for r in rs]
        end
    else
        fts = doc.legacy ? "fragmentos_fts" : "fragments_fts"
        rs = query(doc.db, "SELECT rowid AS n, bm25($fts, 1.0, 0.5, 0.5, 1.0) AS r FROM $fts WHERE $fts MATCH ? " *
                           "ORDER BY r, rowid LIMIT ?", (match, limit))
        hits = [(r["n"], -r["r"]) for r in rs]
    end
    out = Hit[]
    for (n, s) in hits
        h = fragment_hit(doc, n, s, ["lexical"])
        h === nothing || push!(out, h)
    end
    return (route, match, out)
end

"""
    search_lexical(doc, query; limit = 10) -> Vector{Hit}

Reference lexical search: quoted phrases are required, loose words are alternatives,
FTS5 folds case and diacritics, the modernized spelling layer matches too, and CJK
queries use the trigram index or a substring fallback.
"""
search_lexical(doc::Document, qtext::AbstractString; limit::Integer = 10) = (checkopen(doc); lexical_trace(doc, qtext, limit)[3])

function vector_hits(doc::Document, q::AbstractVector, space_id::AbstractString, limit::Integer, target::AbstractString)
    sp = space(doc, space_id)
    length(q) == sp["dims"] || spdf_error("E030", "the query vector has $(length(q)) components; space $space_id has $(sp["dims"])")
    qv = Float64.(q)
    normalized = sp["normalized"] == 1
    vs = vectors(doc, space_id; target)
    scored = Tuple{String,Float64}[]
    for (id, v) in vs
        d = sum(qv .* v)
        if !normalized
            nq, nv = sqrt(sum(qv .^ 2)), sqrt(sum(v .^ 2))
            d = nq > 0 && nv > 0 ? d / (nq * nv) : 0.0
        end
        push!(scored, (id, d))
    end
    tie = if target == "fragment"
        Dict(string(r["id"]) => Int(r["n"]) for r in rows(doc, "fragments"; only = ["n", "id"]))
    elseif target == "unit"
        Dict(string(u["id"]) => Int(u["ord"]) for u in units(doc))
    else
        nothing
    end
    key = tie === nothing ? (x -> (-x[2], x[1])) : (x -> (-x[2], get(tie, x[1], typemax(Int))))
    sort!(scored; by = key)
    out = Hit[]
    for (id, s) in scored[1:min(limit, length(scored))]
        if target == "fragment"
            haskey(tie, id) || continue
            h = fragment_hit(doc, tie[id], s, ["vector"])
            h === nothing || push!(out, h)
        else
            push!(out, Hit(id, s, ["vector"], nothing, nothing, 0))
        end
    end
    return out
end

"""
    search_vector(doc, vector, space; limit = 10, target = "fragment") -> Vector{Hit}

Brute-force dot product (cosine when the space is not normalized), ties by fragment `n`.
"""
search_vector(doc::Document, vector::AbstractVector, space_id::AbstractString; limit::Integer = 10, target::AbstractString = "fragment") =
    (checkopen(doc); vector_hits(doc, vector, space_id, limit, target))

"""
    search_hybrid(doc, query, vector, space; limit = 10) -> Vector{Hit}

Reciprocal rank fusion (k = 10) of the lexical and vector lists, each to depth `max(limit, 50)`.
"""
function search_hybrid(doc::Document, qtext::AbstractString, vector::AbstractVector, space_id::AbstractString; limit::Integer = 10)
    checkopen(doc)
    depth = max(limit, 50)
    fused = Dict{String,Tuple{Hit,Float64,Vector{String}}}()
    for (via, list) in (("lexical", lexical_trace(doc, qtext, depth)[3]), ("vector", vector_hits(doc, vector, space_id, depth, "fragment")))
        for (rank, h) in enumerate(list)
            hit, s, v = get(fused, h.fragment_id, (h, 0.0, String[]))
            fused[h.fragment_id] = (hit, s + 1 / (10 + rank), push!(v, via))
        end
    end
    items = sort!(collect(values(fused)); by = x -> (-x[2], x[1].n))
    return [Hit(h.fragment_id, s, v, h.anchor, h.anchor_uri, h.n) for (h, s, v) in items[1:min(limit, length(items))]]
end
