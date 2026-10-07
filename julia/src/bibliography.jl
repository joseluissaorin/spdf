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

"""
    bibtex_key(item) -> String

First author's family name (or the first word of the title) folded to ASCII letters and
lowercased, followed by the year (or `nd`).
"""
function bibtex_key(item::AbstractDict)
    who = ""
    authors = get(item, "author", nothing)
    if authors isa AbstractVector && !isempty(authors) && authors[1] isa AbstractDict
        a = authors[1]
        who = string(something(get(a, "family", nothing), get(a, "literal", nothing), get(a, "given", nothing), ""))
    end
    if isempty(ascii_letters(who))
        ws = words(string(something(get(item, "title", nothing), "")))
        who = isempty(ws) ? "" : ws[1]
    end
    issued = get(item, "issued", nothing)
    dp = issued isa AbstractDict ? get(issued, "date-parts", nothing) : nothing
    year = dp isa AbstractVector && !isempty(dp) && dp[1] isa AbstractVector && !isempty(dp[1]) ? string(dp[1][1]) : "nd"
    return ascii_letters(who) * year
end

"""
    csl_item(doc) -> Dict

The CSL-JSON item without the `spdf` member, with `id` set to the BibTeX key.
"""
function csl_item(doc::Document)
    m = metadata(doc)
    item = Dict{String,Any}(k => v for (k, v) in m if k != "spdf")
    item["id"] = bibtex_key(m)
    return item
end

"CSL-JSON array (Zotero, Pandoc, citeproc)."
csl_json(doc::Document; pretty = true) = json_text(Any[csl_item(doc)]; pretty)

bibescape(s) = replace(string(s), "\\" => "\\\\", "{" => "\\{", "}" => "\\}")

function bibname(p)
    p isa AbstractDict || return nothing
    haskey(p, "literal") && return "{" * bibescape(p["literal"]) * "}"
    family = strip(string(something(get(p, "non-dropping-particle", nothing), "")) * " " * string(something(get(p, "family", nothing), "")))
    given = strip(string(something(get(p, "given", nothing), "")) * " " * string(something(get(p, "dropping-particle", nothing), "")))
    isempty(family) && isempty(given) && return nothing
    isempty(family) && return bibescape(given)
    return isempty(given) ? bibescape(family) : bibescape(family) * ", " * bibescape(given)
end

"BibTeX entry of a CSL item (one entry, UTF-8, `{`, `}` and `\\` escaped)."
function bibtex(item::AbstractDict)
    type = get(BIBTEX_TYPES, string(something(get(item, "type", nothing), "")), "misc")
    fields = Pair{String,String}[]
    for role in ("author", "editor")
        ps = get(item, role, nothing)
        ps isa AbstractVector || continue
        names = filter(!isnothing, [bibname(p) for p in ps])
        isempty(names) || push!(fields, role => join(names, " and "))
    end
    get(item, "title", nothing) !== nothing && push!(fields, "title" => bibescape(item["title"]))
    issued = get(item, "issued", nothing)
    dp = issued isa AbstractDict ? get(issued, "date-parts", nothing) : nothing
    if dp isa AbstractVector && !isempty(dp) && dp[1] isa AbstractVector && !isempty(dp[1])
        push!(fields, "year" => string(dp[1][1]))
    end
    ct = get(item, "container-title", nothing)
    ct isa AbstractString && !isempty(ct) && push!(fields, (type == "article" ? "journal" : "booktitle") => bibescape(ct))
    for (csl, bib) in BIBTEX_FIELDS
        v = get(item, csl, nothing)
        (v === nothing || v isa AbstractDict || v isa AbstractVector || string(v) == "") && continue
        push!(fields, bib => bibescape(v))
    end
    lines = ["@" * type * "{" * bibtex_key(item) * ","]
    for (k, v) in fields
        push!(lines, "  " * k * " = {" * v * "},")
    end
    push!(lines, "}")
    return join(lines, "\n") * "\n"
end
bibtex(doc::Document) = bibtex(metadata(doc))
