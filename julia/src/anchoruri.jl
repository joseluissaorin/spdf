# Anchor URIs: spdf:<docref>#<params> (specification section 5).

const URI_ORDER = ("p", "pe", "f", "fe", "t", "s", "para", "sl", "sh", "rows", "v", "ref", "char", "xywh")

isunreserved(b::UInt8) = (0x41 <= b <= 0x5a) || (0x61 <= b <= 0x7a) || (0x30 <= b <= 0x39) || b in (0x2d, 0x2e, 0x5f, 0x7e)
enc(s) = join(isunreserved(b) ? string(Char(b)) : @sprintf("%%%02X", b) for b in codeunits(string(s)))

uribad(why) = spdf_error("E040", "bad anchor URI: $why")

function dec(s::AbstractString)
    occursin(r"%(?![0-9A-Fa-f]{2})", s) && uribad("bad percent-encoding")
    io = IOBuffer()
    cu = codeunits(s)
    i = 1
    while i <= length(cu)
        if cu[i] == UInt8('%')
            write(io, parse(UInt8, String(cu[i+1:i+2]); base = 16))
            i += 3
        else
            write(io, cu[i])
            i += 1
        end
    end
    out = String(take!(io))
    isvalid(out) || uribad("percent-encoding is not UTF-8")
    return out
end

isint(x) = x isa Integer || (x isa AbstractFloat && isfinite(x) && x == floor(x))
inttext(x) = x isa AbstractFloat && isint(x) ? string(Int(x)) : string(x)

"""
    locator(anchor, anchor_end = nothing) -> Dict

Parameters of the anchor URI of an anchor (and optional end anchor).
"""
function locator(a::AbstractDict, e = nothing)
    l = Dict{String,Any}()
    t = get(a, "type", nothing)
    et = e isa AbstractDict ? get(e, "type", nothing) : nothing
    pr = get(a, "printed", nothing)
    if t == "page"
        l["p"] = get(a, "physical", nothing)
        pr !== nothing && (l["f"] = pr)
        if et == "page"
            ep = get(e, "physical", nothing)
            ep !== nothing && ep != get(a, "physical", nothing) && (l["pe"] = ep)
            ef = get(e, "printed", nothing)
            ef !== nothing && ef != pr && (l["fe"] = ef)
        end
    elseif t == "time"
        t1 = et == "time" ? get(e, "t1", nothing) : get(a, "t1", nothing)
        l["t"] = t1 === nothing ? Any[a["t0"]] : Any[a["t0"], t1]
    elseif t in ("section", "web")
        path = get(a, "path", nothing)
        path isa AbstractVector && !isempty(path) && (l["s"] = Any[string(x) for x in path])
        get(a, "paragraph", nothing) !== nothing && (l["para"] = a["paragraph"])
        if pr !== nothing
            l["f"] = pr
            ef = e isa AbstractDict ? get(e, "printed", nothing) : nothing
            ef !== nothing && ef != pr && (l["fe"] = ef)
        end
    elseif t == "slide"
        l["sl"] = get(a, "n", nothing)
    elseif t == "sheet"
        l["sh"] = get(a, "sheet", "")
        l["rows"] = Any[get(a, "row_from", nothing), get(a, "row_to", nothing)]
    elseif t == "verse"
        from = get(a, "line_from", nothing)
        to = get(a, "line_to", nothing)
        l["v"] = to === nothing || to == from ? Any[from] : Any[from, to]
        pr !== nothing && (l["f"] = pr)
    elseif t == "canonical"
        l["ref"] = Dict{String,Any}("scheme" => get(a, "scheme", ""), "ref" => get(a, "ref", ""))
    end
    get(a, "chars", nothing) !== nothing && (l["char"] = collect(Any, a["chars"]))
    if get(a, "region", nothing) isa AbstractDict
        r = a["region"]
        l["xywh"] = Any[get(r, "x", 0), get(r, "y", 0), get(r, "w", 0), get(r, "h", 0)]
    end
    return l
end

"""
    format_locator(docref, locator) -> String

Writes a locator as the canonical anchor URI.
"""
function format_locator(docref::AbstractString, l::AbstractDict)
    parts = String[]
    for k in URI_ORDER
        haskey(l, k) || continue
        v = l[k]
        s = if k in ("p", "pe", "para", "sl")
            inttext(v)
        elseif k in ("f", "fe", "sh")
            enc(v)
        elseif k == "t"
            join((json_number(Float64(x)) for x in v), ",")
        elseif k == "s"
            join((enc(x) for x in v), "/")
        elseif k == "rows"
            inttext(v[1]) * "-" * inttext(v[2])
        elseif k == "v"
            join((inttext(x) for x in v), "-")
        elseif k == "ref"
            enc(v["scheme"]) * ":" * enc(v["ref"])
        elseif k == "char"
            inttext(v[1]) * "," * inttext(v[2])
        else
            "percent:" * join((json_number(parse(Float64, @sprintf("%.4f", Float64(x) * 100))) for x in v), ",")
        end
        push!(parts, k * "=" * s)
    end
    ref = occursin(r"^sha256-[0-9a-f]{64}$", docref) ? docref : enc(docref)
    return "spdf:" * ref * (isempty(parts) ? "" : "#" * join(parts, "&"))
end

"""
    anchor_uri(docref, anchor, anchor_end = nothing) -> String
    anchor_uri(doc, anchor, anchor_end = nothing) -> String
"""
anchor_uri(docref::AbstractString, a::AbstractDict, e = nothing) = format_locator(docref, locator(a, e))
anchor_uri(doc::Document, a::AbstractDict, e = nothing) = anchor_uri(docref(doc), a, e)

function uriint(s)
    occursin(r"^(0|[1-9][0-9]*)$", s) || uribad("not an integer: $s")
    return parse(Int, s)
end

canonnum(x::Float64) = (r = round6(x); r == floor(r) && abs(r) < 2.0^53 ? Int(r) : r)

function npt(s)
    occursin(r"^[0-9]+(\.[0-9]+)?$", s) && return canonnum(parse(Float64, s))
    m = match(r"^(?:([0-9]+):)?([0-5]?[0-9]):([0-5][0-9](?:\.[0-9]+)?)$", s)
    m === nothing && uribad("bad time: $s")
    h = m[1] === nothing ? 0 : parse(Int, m[1])
    return canonnum(h * 3600 + parse(Int, m[2]) * 60 + parse(Float64, m[3]))
end

"""
    parse_uri(uri) -> Dict("docref" => ..., "locator" => Dict(...))

Parses an anchor URI; throws `SpdfError` (E040) on malformed input.
"""
function parse_uri(uri::AbstractString)
    startswith(uri, "spdf:") || uribad("not an spdf: URI")
    rest = uri[6:end]
    i = findfirst('#', rest)
    docref_raw = i === nothing ? rest : rest[1:prevind(rest, i)]
    frag = i === nothing ? "" : rest[nextind(rest, i):end]
    isempty(docref_raw) && uribad("empty document reference")
    l = Dict{String,Any}()
    for part in (isempty(frag) ? String[] : split(frag, "&"))
        isempty(part) && continue
        eq = findfirst('=', part)
        eq === nothing && uribad("parameter without value: $part")
        k = String(part[1:prevind(part, eq)])
        v = String(part[nextind(part, eq):end])
        haskey(l, k) && uribad("duplicate parameter $k")
        if k in ("p", "pe", "para", "sl")
            l[k] = uriint(v)
            k != "para" && l[k] < 1 && uribad("$k starts at 1")
        elseif k in ("f", "fe", "sh")
            l[k] = dec(v)
        elseif k == "t"
            startswith(v, "npt:") && (v = v[5:end])
            xs = Any[npt(String(x)) for x in split(v, ",")]
            (length(xs) > 2 || (length(xs) == 2 && xs[2] < xs[1])) && uribad("bad t")
            l[k] = xs
        elseif k == "s"
            l[k] = Any[dec(String(x)) for x in split(v, "/")]
        elseif k == "rows"
            d = findfirst('-', v)
            d === nothing && uribad("rows needs a-b")
            l[k] = Any[uriint(v[1:prevind(v, d)]), uriint(v[nextind(v, d):end])]
        elseif k == "v"
            xs = Any[uriint(String(x)) for x in split(v, "-")]
            length(xs) > 2 && uribad("bad v")
            l[k] = xs
        elseif k == "ref"
            c = findfirst(':', v)
            (c === nothing || c == 1) && uribad("ref needs scheme:ref")
            l[k] = Dict{String,Any}("scheme" => dec(v[1:prevind(v, c)]), "ref" => dec(v[nextind(v, c):end]))
        elseif k == "char"
            xs = split(v, ",")
            length(xs) == 2 || uribad("char needs start,end")
            a, b = uriint(String(xs[1])), uriint(String(xs[2]))
            b < a && uribad("char end before start")
            l[k] = Any[a, b]
        elseif k == "xywh"
            startswith(v, "percent:") || uribad("xywh must use percent:")
            xs = split(v[9:end], ",")
            (length(xs) == 4 && all(x -> occursin(r"^[0-9]+(\.[0-9]+)?$", x), xs)) || uribad("bad xywh")
            l[k] = Any[canonnum(round6(parse(Float64, x) / 100)) for x in xs]
        end
    end
    return Dict{String,Any}("docref" => dec(docref_raw), "locator" => l)
end
