# Bibliographic exports (specification section 19): CSL-JSON and BibTeX.

const BIBTEX_TYPES = Dict("book" => "book", "article-journal" => "article", "article-magazine" => "article",
    "article-newspaper" => "article", "chapter" => "incollection", "paper-conference" => "inproceedings",
    "thesis" => "phdthesis", "report" => "techreport")
const BIBTEX_FIELDS = [("publisher", "publisher"), ("publisher-place", "address"), ("collection-title", "series"),
    ("volume", "volume"), ("issue", "number"), ("page", "pages"), ("edition", "edition"), ("DOI", "doi"),
    ("ISBN", "isbn"), ("URL", "url"), ("language", "language"), ("note", "note")]

"ASCII letters of a string, lowercased (accents folded)."
function ascii_letters(s)
    d = Unicode.normalize(string(s), :NFKD)
    lowercase(filter(c -> isascii(c) && isletter(c), d))
end

"First year of `issued` in decimal (negative years keep their sign), or `nothing`."
function bib_year(item)
    issued = get(item, "issued", nothing)
    dp = issued isa AbstractDict ? get(issued, "date-parts", nothing) : nothing
    (dp isa AbstractVector && !isempty(dp) && dp[1] isa AbstractVector && !isempty(dp[1])) || return nothing
    y = dp[1][1]
    y isa Bool && return nothing
    y isa Real && return string(trunc(Int, y))
    y isa AbstractString && occursin(r"^\s*-?\d+\s*$", y) && return string(parse(Int, strip(y)))
    return nothing
end

nz(x) = x === nothing || x == "" || x === false ? nothing : x

"""
    bibtex_key(item) -> String

SPEC §19.1: the first author's family, literal or given name, else the first word of
`title-short` or `title`, folded to ASCII letters and lowercased; `anon` if nothing is
left; then the first year of `issued`, or `nd`.
"""
function bibtex_key(item::AbstractDict)
    base = ""
    authors = get(item, "author", nothing)
    if authors isa AbstractVector && !isempty(authors) && authors[1] isa AbstractDict
        a = authors[1]
        base = ascii_letters(something(nz(get(a, "family", nothing)), nz(get(a, "literal", nothing)), nz(get(a, "given", nothing)), ""))
    end
    if isempty(base)
        t = something(nz(get(item, "title-short", nothing)), nz(get(item, "title", nothing)), "")
        ws = split(string(t))
        base = isempty(ws) ? "" : ascii_letters(ws[1])
    end
    return (isempty(base) ? "anon" : base) * something(bib_year(item), "nd")
end

function bib_suffix(n::Int)
    letters = ""
    n += 1
    while n > 0
        n, r = divrem(n - 1, 26)
        letters = string(Char(97 + r)) * letters
    end
    return letters
end

"Keys of several items, disambiguated with a, b, c… when they collide."
function bibtex_keys(items)
    bases = [bibtex_key(it) for it in items]
    counts = Dict{String,Int}()
    for b in bases
        counts[b] = get(counts, b, 0) + 1
    end
    seen = Dict{String,Int}()
    return map(bases) do b
        counts[b] == 1 && return b
        n = get(seen, b, 0)
        seen[b] = n + 1
        b * bib_suffix(n)
    end
end

csl_base(m::AbstractDict) = Dict{String,Any}(k => v for (k, v) in m if k != "spdf")

"""
    csl_item(doc) -> Dict

The CSL-JSON item without the `spdf` member, with `id` set to the BibTeX key.
"""
function csl_item(doc::Document)
    item = csl_base(metadata(doc))
    item["id"] = bibtex_key(item)
    return item
end

"""
    csl_export(metadatas; anchor = nothing, anchor_end = nothing) -> Vector{Dict}

CSL-JSON export (SPEC §19.2); with an anchor and a single record, the item carries the
CSL `label` and `locator` of the citation.
"""
function csl_export(metas::AbstractVector; anchor = nothing, anchor_end = nothing)
    items = [csl_base(m) for m in metas]
    for (it, k) in zip(items, bibtex_keys(items))
        it["id"] = k
    end
    if anchor isa AbstractDict && length(items) == 1
        ll = csl_label_locator(anchor, anchor_end)
        if ll !== nothing
            items[1]["label"], items[1]["locator"] = ll
        end
    end
    return items
end

"CSL-JSON array of one or several documents (Zotero, Pandoc, citeproc)."
csl_json(docs::Document...; pretty = true) = json_text(csl_export([metadata(d) for d in docs]); pretty)

"CSL label and locator of an anchor (SPEC §19.2), or `nothing`."
function csl_label_locator(a::AbstractDict, e = nothing)
    t = get(a, "type", nothing)
    folio(x) = get(x, "printed", nothing) === nothing ? nothing :
               (get(x, "source", nothing) == "inferred" ? "[" * string(x["printed"]) * "]" : string(x["printed"]))
    if t == "page" || (t in ("section", "web") && get(a, "printed", nothing) !== nothing)
        f = folio(a)
        f === nothing && return nothing
        fol = get(a, "foliation", "page")
        label = t == "page" ? (fol == "leaf" ? "folio" : fol == "column" ? "column" : "page") : "page"
        if e isa AbstractDict && get(e, "type", nothing) == t && get(e, "printed", nothing) !== nothing && e["printed"] != a["printed"]
            return (label, f * "-" * folio(e))
        end
        return (label, f)
    elseif t in ("section", "web")
        get(a, "paragraph", nothing) !== nothing && return ("paragraph", string(a["paragraph"]))
        p = get(a, "path", nothing)
        p isa AbstractVector && !isempty(p) && return ("section", string(p[end]))
        return nothing
    elseif t == "time"
        s = hms(a["t0"])
        e isa AbstractDict && get(e, "type", nothing) == "time" && (s *= "-" * hms(e["t1"]))
        return ("timestamp", s)
    elseif t == "verse"
        from, to = a["line_from"], get(a, "line_to", nothing)
        return ("verse", to === nothing || to == from ? string(from) : "$from-$to")
    elseif t == "canonical"
        return ("section", string(a["ref"]))
    elseif t == "sheet"
        from, to = a["row_from"], a["row_to"]
        return ("line", from == to ? string(from) : "$from-$to")
    end
    return nothing
end

bibescape(s) = join(c == '\\' ? "\\textbackslash{}" : c == '{' ? "\\{" : c == '}' ? "\\}" : string(c) for c in string(s))

function protect_title(t)
    join(occursin(r"^\s+$", tok) ? tok : (any(isuppercase, tok) ? "{" * bibescape(tok) * "}" : bibescape(tok))
         for tok in split_keep_spaces(string(t)))
end
split_keep_spaces(s) = [m.match for m in eachmatch(r"\s+|\S+", s)]

function bibnames(people)
    people isa AbstractVector || return nothing
    out = String[]
    for p in people
        p isa AbstractDict || continue
        lit = get(p, "literal", nothing)
        if lit !== nothing && lit != ""
            push!(out, "{" * bibescape(lit) * "}")
            continue
        end
        family = string(something(get(p, "family", nothing), ""))
        particle = string(something(get(p, "non-dropping-particle", nothing), ""))
        !isempty(particle) && !isempty(family) && (family = particle * " " * family)
        given = string(something(get(p, "given", nothing), ""))
        if !isempty(family) && !isempty(given)
            push!(out, bibescape(family) * ", " * bibescape(given))
        elseif !isempty(family) || !isempty(given)
            push!(out, "{" * bibescape(isempty(family) ? given : family) * "}")
        end
    end
    return isempty(out) ? nothing : join(out, " and ")
end

"BibTeX entry of a CSL item (SPEC §19)."
function bibtex(item::AbstractDict, key::AbstractString = bibtex_key(item))
    entry = get(BIBTEX_TYPES, string(something(get(item, "type", nothing), "")), "misc")
    fields = Pair{String,String}[]
    a = bibnames(get(item, "author", nothing))
    a === nothing || push!(fields, "author" => a)
    e = bibnames(get(item, "editor", nothing))
    e === nothing || push!(fields, "editor" => e)
    t = get(item, "title", nothing)
    t === nothing || t == "" || push!(fields, "title" => protect_title(t))
    y = bib_year(item)
    y === nothing || push!(fields, "year" => y)
    ct = get(item, "container-title", nothing)
    ct === nothing || ct == "" || push!(fields, (entry == "article" ? "journal" : "booktitle") => protect_title(ct))
    for (csl, bib) in BIBTEX_FIELDS
        v = get(item, csl, nothing)
        (v === nothing || v == "" || (v isa AbstractVector && isempty(v))) && continue
        push!(fields, bib => bibescape(v isa AbstractString ? v : canonical_json(v) |> s -> v isa Real ? s : string(v)))
    end
    body = join(("  $k = {$v}" for (k, v) in fields), ",\n")
    return "@$entry{$key,\n$body\n}\n"
end

"BibTeX of one or several documents (keys disambiguated with a, b, c…)."
bibtex(docs::Document...) = bibtex_export([metadata(d) for d in docs])

"BibTeX export of several metadata records, separated by one empty line (SPEC §19.3)."
function bibtex_export(metas::AbstractVector)
    items = [csl_base(m) for m in metas]
    return join((bibtex(it, k) for (it, k) in zip(items, bibtex_keys(items))), "\n")
end
