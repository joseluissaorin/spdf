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

function bib_year(item)
    issued = get(item, "issued", nothing)
    dp = issued isa AbstractDict ? get(issued, "date-parts", nothing) : nothing
    (dp isa AbstractVector && !isempty(dp) && dp[1] isa AbstractVector && !isempty(dp[1])) || return nothing
    y = dp[1][1]
    y isa Bool && return nothing
    y isa Real && isinteger(y) && return string(Int(y))
    y isa AbstractString && occursin(r"^\s*-?\d+\s*$", y) && return string(parse(Int, strip(y)))
    return nothing
end

"""
    bibtex_key(item) -> String

First author's family name (or the first word of the title) folded to ASCII letters and
lowercased, followed by the year (or `nd`): `cervantessaavedra1605`, `lazarillo1554`.
"""
function bibtex_key(item::AbstractDict)
    base = ""
    authors = get(item, "author", nothing)
    if authors isa AbstractVector && !isempty(authors) && authors[1] isa AbstractDict
        a = authors[1]
        v = something(get(a, "family", nothing), get(a, "literal", nothing), get(a, "given", nothing), "")
        base = ascii_letters(v == "" ? "" : v)
    end
    if isempty(base)
        ws = split(string(something(get(item, "title", nothing), "")))
        base = isempty(ws) ? "" : ascii_letters(ws[1])
    end
    return (isempty(base) ? "spdf" : base) * something(bib_year(item), "nd")
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

"CSL-JSON array of one or several documents (Zotero, Pandoc, citeproc)."
function csl_json(docs::Document...; pretty = true)
    items = [csl_base(metadata(d)) for d in docs]
    for (it, k) in zip(items, bibtex_keys(items))
        it["id"] = k
    end
    return json_text(items; pretty)
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
function bibtex(docs::Document...)
    items = [csl_base(metadata(d)) for d in docs]
    return join((bibtex(it, k) for (it, k) in zip(items, bibtex_keys(items))), "\n")
end
