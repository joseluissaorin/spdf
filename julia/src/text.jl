# Unicode helpers and the reference query parser (specification section 6).

nfc(s::AbstractString) = Unicode.normalize(String(s), :NFC)

"Words: maximal runs of Unicode L, M or N."
words(s::AbstractString) = String[m.match for m in eachmatch(r"[\p{L}\p{M}\p{N}]+", s)]

function dedup_key(t::AbstractString)
    d = Unicode.normalize(String(t), :NFD)
    lowercase(filter(c -> Base.Unicode.category_code(c) != Base.Unicode.UTF8PROC_CATEGORY_MN, d))
end

const CJK_RANGES = ((0x2E80, 0x2FDF), (0x3040, 0x30FF), (0x3100, 0x312F), (0x3130, 0x318F), (0x31A0, 0x31FF),
    (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xA960, 0xA97F), (0xAC00, 0xD7AF), (0xF900, 0xFAFF), (0xFF66, 0xFF9F),
    (0x20000, 0x3FFFF))
is_cjk(s::AbstractString) = any(c -> any(r -> r[1] <= UInt32(c) <= r[2], CJK_RANGES), s)

fts_string(t::AbstractString) = "\"" * replace(t, "\"" => "\"\"") * "\""

const QUOTES = Dict('"' => ('"',), '“' => ('”',), '«' => ('»',), '„' => ('“', '”'))

"""(terms, phrases, cjk) of a user query (reference algorithm)."""
function query_terms(query::AbstractString)
    q = nfc(query)
    chars = collect(q)
    n = length(chars)
    phrases = String[]
    rest = IOBuffer()
    i = 1
    while i <= n
        c = chars[i]
        if haskey(QUOTES, c)
            closes = QUOTES[c]
            j = findfirst(k -> chars[k] in closes, (i+1):n)
            write(rest, ' ')
            if j !== nothing
                jj = i + j
                push!(phrases, String(chars[i+1:jj-1]))
                i = jj + 1
            else
                i += 1
            end
            continue
        end
        write(rest, c)
        i += 1
    end
    phrase_terms = [join(w, " ") for w in (words(p) for p in phrases) if !isempty(w)]
    candidates = isempty(phrase_terms) ? words(String(take!(rest))) : phrase_terms
    seen = Set{String}()
    terms = String[]
    for t in candidates
        k = dedup_key(t)
        k in seen && continue
        push!(seen, k)
        push!(terms, t)
    end
    return terms, !isempty(phrase_terms), is_cjk(q)
end

fts_match(terms, phrases::Bool) = isempty(terms) ? nothing : join(fts_string.(terms), phrases ? " AND " : " OR ")
