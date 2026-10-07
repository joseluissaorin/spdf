# Short author-date citation "(Names, Year, locator)" (specification section 18).

const VOWELS = ('a', 'e', 'i', 'o', 'u', 'á', 'é', 'í', 'ó', 'ú', 'ü')

function cite_name(a)
    a isa AbstractDict || return ""
    lit = get(a, "literal", nothing)
    lit isa AbstractString && !isempty(lit) && return lit
    fam = get(a, "family", nothing)
    if fam isa AbstractString && !isempty(fam)
        ndp = get(a, "non-dropping-particle", nothing)
        return (ndp isa AbstractString && !isempty(ndp) ? ndp * " " : "") * fam
    end
    g = get(a, "given", nothing)
    return g === nothing ? "" : string(g)
end

function i_sound(s)
    low = collect(lowercase(s))
    rest = if length(low) >= 2 && low[1] == 'h' && low[2] in ('i', 'í')
        low[3:end]
    elseif !isempty(low) && low[1] in ('i', 'í')
        low[2:end]
    else
        return false
    end
    return !(!isempty(rest) && rest[1] in VOWELS)
end

function hms(t)
    s = floor(Int, Float64(t))
    h, m, x = s ÷ 3600, (s % 3600) ÷ 60, s % 60
    return h > 0 ? @sprintf("%d:%02d:%02d", h, m, x) : @sprintf("%d:%02d", m, x)
end

ntext(x) = x isa AbstractFloat && isint(x) ? string(x) : string(x)

function label(a)
    p = get(a, "printed", nothing)
    p === nothing && return nothing
    return get(a, "source", nothing) == "inferred" ? "[" * string(p) * "]" : string(p)
end

"An end without a printed folio never takes part in a range (SPEC §18.1)."
function page_locator(a, e, es, one, many)
    ends = Any[a]
    e isa AbstractDict && get(e, "type", nothing) == get(a, "type", nothing) && push!(ends, e)
    withfolio = [x for x in ends if get(x, "printed", nothing) !== nothing]
    isempty(withfolio) && return es ? "s. p." : "n. pag."
    first_, last_ = withfolio[1], withfolio[end]
    if length(withfolio) > 1 && last_["printed"] != first_["printed"]
        return "$many $(label(first_))-$(label(last_))"
    end
    return "$one $(label(first_))"
end

function cite_locator(a, e, es)
    t = get(a, "type", nothing)
    if t == "page"
        fol = get(a, "foliation", "page")
        one, many = fol == "leaf" ? ("fol.", "fols.") : fol == "column" ? ("col.", "cols.") : ("p.", "pp.")
        return page_locator(a, e, es, one, many)
    elseif t == "time"
        s = hms(a["t0"])
        e isa AbstractDict && get(e, "type", nothing) == "time" && (s *= "-" * hms(e["t1"]))
        return s
    elseif t in ("section", "web")
        get(a, "printed", nothing) !== nothing && return page_locator(a, e, es, "p.", "pp.")
        parts = String[]
        path = get(a, "path", nothing)
        path isa AbstractVector && !isempty(path) && push!(parts, "§ " * string(path[end]))
        get(a, "paragraph", nothing) !== nothing && push!(parts, (es ? "párr. " : "para. ") * ntext(a["paragraph"]))
        return isempty(parts) ? nothing : join(parts, ", ")
    elseif t == "slide"
        return (es ? "diap. " : "slide ") * ntext(a["n"])
    elseif t == "sheet"
        from, to = a["row_from"], a["row_to"]
        from == to && return "$(a["sheet"]), $(es ? "fila" : "row") $(ntext(from))"
        return "$(a["sheet"]), $(es ? "filas" : "rows") $(ntext(from))-$(ntext(to))"
    elseif t == "verse"
        from, to = a["line_from"], get(a, "line_to", nothing)
        return to === nothing || to == from ? "v. " * ntext(from) : "vv. $(ntext(from))-$(ntext(to))"
    elseif t == "canonical"
        return string(a["ref"])
    end
    return nothing
end

function cite_year(m, es)
    issued = get(m, "issued", nothing)
    dp = issued isa AbstractDict ? get(issued, "date-parts", nothing) : nothing
    y = dp isa AbstractVector && !isempty(dp) && dp[1] isa AbstractVector && !isempty(dp[1]) ? dp[1][1] : nothing
    y isa AbstractString && occursin(r"^-?\d+$", y) && (y = parse(Int, y))
    y isa Real || return es ? "s. f." : "n.d."
    y = trunc(Int, y)
    return y > 0 ? string(y) : string(-y) * (es ? " a. C." : " BC")
end

"""
    cite(metadata, anchor, anchor_end = nothing; locale = "es") -> String
    cite(doc, anchor, anchor_end = nothing; locale = "es") -> String

Short author-date citation `(Names, Year, locator)`: one or two authors (`y`/`e` in
Spanish, `and` in English), `et al.` from three, `s. f.`/`n.d.` without a year, and a
locator for every anchor type (`p. 145`, `p. [21]`, `fol. 1r`, `1:09:20`...).
"""
function cite(m::AbstractDict, anchor, anchor_end = nothing; locale::AbstractString = "es")
    es = lowercase(first(split(replace(locale, "_" => "-"), "-"))) == "es"
    names = filter(!isempty, [cite_name(a) for a in something(get(m, "author", nothing), Any[])])
    who = if isempty(names)
        ts = get(m, "title-short", nothing)
        ts isa AbstractString && !isempty(ts) ? ts : String(strip(first(split(string(something(get(m, "title", nothing), "")), ":"))))
    elseif length(names) == 1
        names[1]
    elseif length(names) == 2
        names[1] * (es ? (i_sound(names[2]) ? " e " : " y ") : " and ") * names[2]
    else
        names[1] * " et al."
    end
    parts = [who, cite_year(m, es)]
    loc = anchor isa AbstractDict ? cite_locator(anchor, anchor_end, es) : nothing
    loc !== nothing && !isempty(loc) && push!(parts, loc)
    return "(" * join(parts, ", ") * ")"
end
cite(doc::Document, anchor, anchor_end = nothing; locale::AbstractString = "es") = cite(metadata(doc), anchor, anchor_end; locale)
