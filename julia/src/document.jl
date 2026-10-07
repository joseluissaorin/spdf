# Reading through the 5.0 view, and the canonical dump (specification section 12).

const COLUMNS = Dict(
    "spdf_meta" => ["key", "value"],
    "documents" => ["id", "kind", "metadata", "source_sha256", "source_ref", "mime", "bytes", "unit_count", "duration",
        "created", "updated", "title", "authors", "year", "language", "rights"],
    "units" => ["id", "document", "ord", "anchor", "text", "notes", "header", "footer", "image", "thumbnail", "reader",
        "confidence", "printed", "t0", "t1", "words"],
    "sections" => ["id", "document", "parent", "level", "title", "unit_from", "unit_to", "summary"],
    "fragments" => ["n", "id", "document", "unit", "ord", "text", "context", "section", "anchor", "anchor_end", "search_text"],
    "figures" => ["id", "document", "unit", "image", "caption", "description", "anchor"],
    "spaces" => ["id", "provider", "model", "version", "dims", "dtype", "normalized", "truncated_from", "modalities",
        "task_prefixes", "created"],
    "vectors" => ["target", "id", "space", "document", "data"],
    "blobs" => ["key", "mime", "sha256", "data"],
    "provenance" => ["document", "stage", "provider", "model", "detail", "ms", "at"],
    "extensions" => ["name", "version", "required"],
)
const JSON_COLUMNS = Dict("documents" => ["metadata", "rights"], "units" => ["anchor", "notes", "words"],
    "fragments" => ["section", "anchor", "anchor_end"], "figures" => ["anchor"],
    "spaces" => ["modalities", "task_prefixes"], "provenance" => ["detail"])

qident(s) = "\"" * replace(String(s), "\"" => "\"\"") * "\""

checkopen(doc::Document) = isopen(doc) || error("the SPDF document is closed")

function table_name(doc::Document, table::AbstractString)
    name = doc.legacy ? (haskey(LEGACY_TABLES, table) ? LEGACY_TABLES[table][1] : nothing) : table
    return name !== nothing && name in doc.tables ? name : nothing
end

table_columns(doc::Document, t) = t in doc.tables ? [r["name"] for r in query(doc.db, "PRAGMA table_info($(qident(t)))")] : String[]

function select_list(doc::Document, table, only = nothing)
    name = table_name(doc, table)
    existing = name === nothing ? String[] : table_columns(doc, name)
    parts = String[]
    for col in COLUMNS[table]
        only !== nothing && !(col in only) && continue
        expr = if doc.legacy
            old = legacy_column(table, col)
            old !== nothing && old in existing ? qident(old) : get(LEGACY_DEFAULTS, "$table.$col", "NULL")
        else
            col in existing ? qident(col) : "NULL"
        end
        push!(parts, "$expr AS $(qident(col))")
    end
    return join(parts, ", ")
end

function physical(doc::Document, table, sql)
    replace(sql, r"\{([a-z_0-9]+)\}" => s -> begin
        col = s[2:end-1]
        if doc.legacy
            old = legacy_column(table, col)
            old === nothing ? "NULL" : qident(old)
        else
            qident(col)
        end
    end)
end

"Rows of a 5.0 table through the view (Dicts with 5.0 column names)."
function rows(doc::Document, table, tail = "", params = (); only = nothing)
    name = table_name(doc, table)
    name === nothing && return Dict{String,Any}[]
    sql = "SELECT " * select_list(doc, table, only) * " FROM " * qident(name)
    isempty(tail) || (sql *= " " * physical(doc, table, tail))
    return [map_row(doc, table, r) for r in query(doc.db, sql, params)]
end

function blob_keys(doc::Document)
    get!(doc.cache, :blob_keys) do
        name = table_name(doc, "blobs")
        name === nothing ? Set{String}() : Set{String}(string.(column(doc.db, "SELECT $(qident(doc.legacy ? "clave" : "key")) FROM $(qident(name))")))
    end
end

function map_row(doc::Document, table, r::Dict{String,Any})
    for c in get(JSON_COLUMNS, table, String[])
        haskey(r, c) && r[c] !== nothing && (r[c] = json_column(r[c]))
    end
    doc.legacy || return r
    if table == "spdf_meta"
        r["key"] = get(LEGACY_META_KEYS, r["key"], r["key"])
    elseif table == "documents"
        tipo = get(r, "kind", nothing)
        r["kind"] = mapval(LEGACY_KINDS, tipo)
        haskey(r, "metadata") && (r["metadata"] = legacy_metadata(r["metadata"], tipo))
        haskey(r, "source_ref") && (r["source_ref"] = legacy_reference(r["source_ref"], blob_keys(doc)))
    elseif table == "units"
        for k in ("image", "thumbnail")
            haskey(r, k) && (r[k] = legacy_reference(r[k], blob_keys(doc)))
        end
        haskey(r, "anchor") && (r["anchor"] = legacy_anchor(r["anchor"]))
    elseif table == "fragments"
        for k in ("anchor", "anchor_end")
            haskey(r, k) && (r[k] = legacy_anchor(r[k]))
        end
    elseif table == "figures"
        haskey(r, "image") && (r["image"] = legacy_reference(r["image"], blob_keys(doc); keep_empty = true))
        haskey(r, "anchor") && (r["anchor"] = legacy_anchor(r["anchor"]))
    elseif table == "spaces"
        if get(r, "modalities", nothing) isa AbstractVector
            r["modalities"] = Any[mapval(LEGACY_MODALITIES, x) for x in r["modalities"]]
        end
    elseif table == "vectors"
        get(r, "target", nothing) !== nothing && (r["target"] = mapval(LEGACY_TARGETS, r["target"]))
    end
    return r
end

"spdf_meta as a Dict."
function meta(doc::Document)
    checkopen(doc)
    Dict{String,Any}(r["key"] => r["value"] for r in rows(doc, "spdf_meta", "ORDER BY {key}"))
end

function document(doc::Document)
    get!(doc.cache, :document) do
        rs = rows(doc, "documents", "ORDER BY {id} LIMIT 2")
        length(rs) == 1 || spdf_error("E013", "documents must hold exactly one row")
        rs[1]
    end
end

"The CSL-JSON item (with the `spdf` extension object)."
function metadata(doc::Document)
    checkopen(doc)
    m = document(doc)["metadata"]
    return m isa AbstractDict ? m : Dict{String,Any}()
end

function title(doc::Document)
    t = get(metadata(doc), "title", nothing)
    return t isa AbstractString ? t : document(doc)["title"]
end

"`sha256-<hex>` (portable reference for anchor URIs), or the document id."
function docref(doc::Document)
    h = lowercase(string(something(document(doc)["source_sha256"], "")))
    return occursin(r"^[0-9a-f]{64}$", h) ? "sha256-" * h : string(document(doc)["id"])
end

"Units in reading order (legacy units renumbered from 1)."
function units(doc::Document)
    checkopen(doc)
    rs = rows(doc, "units", "ORDER BY {ord}, {id}")
    if doc.legacy
        for (i, r) in enumerate(rs)
            r["ord"] = i
        end
    end
    return rs
end

strip_doc(rs) = [filter(p -> p.first != "document", r) for r in rs]

sections(doc::Document) = (checkopen(doc); rows(doc, "sections", "ORDER BY {id}"))
fragments(doc::Document) = (checkopen(doc); rows(doc, "fragments", "ORDER BY {n}"))
fragment(doc::Document, id) = (rs = rows(doc, "fragments", "WHERE {id} = ?", (id,)); isempty(rs) ? nothing : rs[1])
figures(doc::Document) = (checkopen(doc); rows(doc, "figures", "ORDER BY {id}"))
spaces(doc::Document) = (checkopen(doc); rows(doc, "spaces", "ORDER BY {id}"))
extensions(doc::Document) = (checkopen(doc); rows(doc, "extensions", "ORDER BY {name}"))

function space(doc::Document, id)
    rs = rows(doc, "spaces", "WHERE {id} = ?", (id,))
    isempty(rs) && spdf_error("E031", "unknown vector space $id")
    return rs[1]
end

"Decoded vectors of a space and target: Dict(id => Vector{Float64})."
function vectors(doc::Document, space_id::AbstractString; target::AbstractString = "fragment")
    sp = space(doc, space_id)
    t = doc.legacy ? something(findfirst(==(target), LEGACY_TARGETS), target) : target
    rs = rows(doc, "vectors", "WHERE {space} = ? AND {target} = ? ORDER BY {id}", (space_id, t); only = ["id", "data"])
    return Dict{String,Vector{Float64}}(string(r["id"]) => decode_vector(r["data"], sp["dtype"]) for r in rs)
end

"Blob descriptors (sha256 computed from the data)."
function blobs(doc::Document)
    checkopen(doc)
    map(rows(doc, "blobs", "ORDER BY {key}"; only = ["key", "mime", "data"])) do r
        data = something(r["data"], UInt8[])
        Dict{String,Any}("key" => r["key"], "mime" => r["mime"], "bytes" => length(data), "sha256" => bytes2hex(sha256(data)))
    end
end

"Bytes of a blob (`key` or `blob:key`), or `nothing`."
function blob(doc::Document, key::AbstractString)
    k = startswith(key, "blob:") ? key[6:end] : key
    rs = rows(doc, "blobs", "WHERE {key} = ?", (k,); only = ["data"])
    return isempty(rs) ? nothing : rs[1]["data"]
end

"Provenance entries sorted by the UTF-8 bytes of their JCS form."
function provenance(doc::Document)
    rs = strip_doc(rows(doc, "provenance"))
    return sort(rs; by = r -> Vector{UInt8}(canonical_json(r)))
end

function fts(doc::Document)
    name = doc.legacy ? "fragmentos_fts" : "fragments_fts"
    sql = scalar(doc.db, "SELECT sql FROM sqlite_master WHERE name = ?", (name,))
    tok = if sql === nothing
        nothing
    else
        m = match(r"tokenize\s*=\s*(?:'((?:[^']|'')*)'|\"((?:[^\"]|\"\")*)\"|([A-Za-z0-9_]+))"i, sql)
        if m === nothing
            "unicode61"
        else
            raw = m[1] !== nothing ? replace(m[1], "''" => "'") : m[2] !== nothing ? replace(m[2], "\"\"" => "\"") : m[3]
            join(split(raw), " ")
        end
    end
    return Dict{String,Any}("tokenizer" => tok, "trigram" => "fragments_fts_trigram" in doc.tables)
end

function vector_digests(doc::Document)
    name = table_name(doc, "vectors")
    out = Dict{String,Any}()
    name === nothing && return out
    sql = "SELECT " * select_list(doc, "vectors", ["target", "id", "space", "data"]) * " FROM " * qident(name) *
          " ORDER BY " * physical(doc, "vectors", "{space}, {target}, {id}")
    acc = Dict{String,Tuple{Int,SHA.SHA256_CTX}}()
    order = String[]
    for r in query(doc.db, sql)
        s = string(r["space"])
        if !haskey(acc, s)
            acc[s] = (0, SHA.SHA256_CTX())
            push!(order, s)
        end
        n, ctx = acc[s]
        SHA.update!(ctx, something(r["data"], UInt8[]))
        acc[s] = (n + 1, ctx)
    end
    for s in order
        n, ctx = acc[s]
        out[s] = Dict{String,Any}("count" => n, "sha256" => bytes2hex(SHA.digest!(ctx)))
    end
    return out
end

"""
    dump(doc) -> Dict

The canonical dump: every table through the 5.0 view, JSON columns parsed, floats
rounded to 6 decimals, vectors summarized by count and SHA-256, blobs by size and
SHA-256 (`"legacy" => true` for 4.x files).
"""
function dump(doc::Document)
    checkopen(doc)
    d = document(doc)
    m = meta(doc)
    out = Dict{String,Any}(
        "spdf_version" => doc.legacy ? get(m, "spdf_version", doc.version) : get(m, "spdf_version", nothing),
        "meta" => m,
        "fts" => fts(doc),
        "document" => Dict{String,Any}(c => get(d, c, nothing) for c in COLUMNS["documents"]),
        "units" => strip_doc(units(doc)),
        "sections" => strip_doc(sections(doc)),
        "fragments" => strip_doc(fragments(doc)),
        "figures" => strip_doc(figures(doc)),
        "spaces" => spaces(doc),
        "vectors" => vector_digests(doc),
        "blobs" => blobs(doc),
        "provenance" => provenance(doc),
        "extensions" => extensions(doc),
    )
    doc.legacy && (out["legacy"] = true)
    return canon(out)
end

"The canonical dump serialized as RFC 8785 JSON."
dump_json(doc::Document) = canonical_json(dump(doc))

"SHA-256 of the JCS dump without `content_sha256`, `signature` and `signer`."
function content_sha256(doc::Document)
    d = dump(doc)
    d["meta"] = filter(p -> !(p.first in ("content_sha256", "signature", "signer")), d["meta"])
    return bytes2hex(sha256(canonical_json(d)))
end

"""
    locate(doc, uri) -> Vector{Dict}

Units an anchor URI points at (SPEC §5.4): by physical page (and end page), else printed
folio, time, slide, verse, canonical reference or section path. Returns an empty vector
when the URI designates another document.
"""
function locate(doc::Document, uri::AbstractString)
    parsed = parse_uri(uri)
    ref = parsed["docref"]
    d = document(doc)
    if startswith(ref, "sha256-")
        ref[8:end] == lowercase(string(something(d["source_sha256"], ""))) || return Dict{String,Any}[]
    elseif ref != string(d["id"])
        return Dict{String,Any}[]
    end
    l = parsed["locator"]
    return filter(units(doc)) do u
        a = u["anchor"] isa AbstractDict ? u["anchor"] : Dict{String,Any}()
        g(k) = get(a, k, nothing)
        if haskey(l, "p")
            g("physical") !== nothing && l["p"] <= g("physical") <= get(l, "pe", l["p"])
        elseif haskey(l, "f")
            get(u, "printed", nothing) == l["f"] || g("printed") == l["f"]
        elseif haskey(l, "t")
            t = l["t"][1]
            g("t0") !== nothing && g("t1") !== nothing && g("t0") <= t < g("t1")
        elseif haskey(l, "sl")
            g("n") == l["sl"]
        elseif haskey(l, "v")
            g("line_from") !== nothing && g("line_from") <= l["v"][1] <= something(g("line_to"), g("line_from"))
        elseif haskey(l, "ref")
            g("scheme") == l["ref"]["scheme"] && g("ref") == l["ref"]["ref"]
        elseif haskey(l, "s")
            g("path") isa AbstractVector && length(g("path")) >= length(l["s"]) && g("path")[1:length(l["s"])] == l["s"]
        else
            false
        end
    end
end
