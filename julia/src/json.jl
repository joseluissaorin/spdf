# Canonical JSON: RFC 8785 (JCS) after rounding non-integer numbers to 6 decimals.
# JSON values in Julia: `nothing` (null), Bool, Integer, Float64, String,
# Vector (array) and AbstractDict{String} (object).

"Converts the output of JSON.parse into plain Dict{String,Any} / Vector{Any} trees."
plainjson(x::AbstractDict) = Dict{String,Any}(string(k) => plainjson(v) for (k, v) in x)
plainjson(x::AbstractVector) = Any[plainjson(v) for v in x]
plainjson(x) = x

json_parse(s::AbstractString) = plainjson(JSON.parse(String(s)))

"Parses a JSON-in-TEXT column; missing/nothing stay `nothing`, invalid JSON stays the raw string."
function json_column(s)
    (s === missing || s === nothing) && return nothing
    try
        return json_parse(s)
    catch
        return s
    end
end

"Rounds to 6 decimals, half to even on the exact binary value; -0 becomes 0."
function round6(x::Float64)
    isfinite(x) || return x
    abs(x) >= 2.0^52 && return x
    r = parse(Float64, @sprintf("%.6f", x))
    return r == 0 ? 0.0 : r
end
round6(x::Integer) = x

"ECMAScript Number::toString of a finite double."
function ecma(x::Float64)
    x == 0 && return "0"
    repr = string(abs(x))  # shortest round-trip digits (Ryu)
    m = match(r"^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$", repr)
    m === nothing && return repr
    int = m[1]
    frac = something(m[2], "")
    ex = m[3] === nothing ? 0 : parse(Int, m[3])
    digits = int * frac
    n = length(int) + ex
    lead = length(digits) - length(lstrip(digits, '0'))
    digits = digits[lead+1:end]
    n -= lead
    digits = rstrip(digits, '0')
    isempty(digits) && return "0"
    k = length(digits)
    sign = x < 0 ? "-" : ""
    body = if k <= n <= 21
        digits * "0"^(n - k)
    elseif 0 < n <= 21
        digits[1:n] * "." * digits[n+1:end]
    elseif -6 < n <= 0
        "0." * "0"^(-n) * digits
    else
        e = n - 1
        mant = k > 1 ? string(digits[1], ".", digits[2:end]) : String(digits)
        mant * "e" * (e < 0 ? "-" : "+") * string(abs(e))
    end
    return sign * body
end

json_number(x::Integer) = string(x)
function json_number(x::AbstractFloat)
    isfinite(x) || spdf_error("E000", "NaN and infinities are not JSON")
    return ecma(round6(Float64(x)))
end

function json_string(s::AbstractString)
    io = IOBuffer()
    write(io, '"')
    for c in s
        if c == '"'
            write(io, "\\\"")
        elseif c == '\\'
            write(io, "\\\\")
        elseif c == '\b'
            write(io, "\\b")
        elseif c == '\f'
            write(io, "\\f")
        elseif c == '\n'
            write(io, "\\n")
        elseif c == '\r'
            write(io, "\\r")
        elseif c == '\t'
            write(io, "\\t")
        elseif UInt32(c) < 0x20
            write(io, @sprintf("\\u%04x", UInt32(c)))
        else
            write(io, c)
        end
    end
    write(io, '"')
    return String(take!(io))
end

utf16key(k::AbstractString) = transcode(UInt16, String(k))

"""
    canonical_json(x) -> String

RFC 8785 (JCS) serialization with non-integer numbers rounded to 6 decimals, as the
canonical SPDF dump requires.
"""
canonical_json(::Nothing) = "null"
canonical_json(::Missing) = "null"
canonical_json(x::Bool) = x ? "true" : "false"
canonical_json(x::Real) = json_number(x)
canonical_json(x::AbstractString) = json_string(x)
canonical_json(x::Symbol) = json_string(string(x))
canonical_json(x::AbstractVector) = "[" * join((canonical_json(v) for v in x), ",") * "]"
canonical_json(x::Tuple) = canonical_json(collect(x))
function canonical_json(x::AbstractDict)
    keys_ = sort!([string(k) for k in keys(x)]; by = utf16key)
    lookup = Dict(string(k) => v for (k, v) in x)
    return "{" * join((json_string(k) * ":" * canonical_json(lookup[k]) for k in keys_), ",") * "}"
end
canonical_json(x::NamedTuple) = canonical_json(Dict{String,Any}(string(k) => v for (k, v) in pairs(x)))

"Rounds every float of a tree; integral floats stay floats (compared as numbers)."
canon(x::AbstractFloat) = round6(Float64(x))
canon(x::AbstractVector) = Any[canon(v) for v in x]
canon(x::AbstractDict) = Dict{String,Any}(string(k) => canon(v) for (k, v) in x)
canon(x) = x

"Plain JSON text (not canonical) for exports."
json_text(x; pretty = false) = pretty ? JSON.json(x, 2) : JSON.json(x)
