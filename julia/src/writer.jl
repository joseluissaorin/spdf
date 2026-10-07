# Writing SPDF 5.0 files.

const SCHEMA_50 = [
    "CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE documents (id TEXT PRIMARY KEY, kind TEXT NOT NULL, metadata TEXT NOT NULL, source_sha256 TEXT NOT NULL, " *
    "source_ref TEXT, mime TEXT NOT NULL, bytes INTEGER NOT NULL, unit_count INTEGER NOT NULL, duration REAL, " *
    "created TEXT NOT NULL, updated TEXT NOT NULL, title TEXT, authors TEXT, year INTEGER, language TEXT, rights TEXT)",
    "CREATE TABLE units (id TEXT PRIMARY KEY, document TEXT NOT NULL REFERENCES documents(id), ord INTEGER NOT NULL, " *
    "anchor TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', notes TEXT, header TEXT, footer TEXT, image TEXT, thumbnail TEXT, " *
    "reader TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, printed TEXT, t0 REAL, t1 REAL, words TEXT)",
    "CREATE INDEX units_doc ON units(document, ord)",
    "CREATE INDEX units_printed ON units(document, printed)",
    "CREATE TABLE sections (id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL, " *
    "title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT)",
    "CREATE TABLE fragments (n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT NOT NULL, unit TEXT NOT NULL, " *
    "ord INTEGER NOT NULL, text TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', section TEXT, anchor TEXT NOT NULL, " *
    "anchor_end TEXT, search_text TEXT)",
    "CREATE INDEX fragments_doc ON fragments(document, ord)",
    "CREATE INDEX fragments_unit ON fragments(unit)",
    "CREATE VIRTUAL TABLE fragments_fts USING fts5(text, context, section, search_text, content='fragments', " *
    "content_rowid='n', tokenize='unicode61 remove_diacritics 2')",
    "CREATE TABLE figures (id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL, image TEXT NOT NULL, " *
    "caption TEXT, description TEXT, anchor TEXT NOT NULL)",
    "CREATE TABLE spaces (id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, version TEXT, " *
    "dims INTEGER NOT NULL, dtype TEXT NOT NULL DEFAULT 'f32', normalized INTEGER NOT NULL DEFAULT 1, " *
    "truncated_from INTEGER, modalities TEXT NOT NULL, task_prefixes TEXT, created TEXT)",
    "CREATE TABLE vectors (target TEXT NOT NULL, id TEXT NOT NULL, space TEXT NOT NULL REFERENCES spaces(id), " *
    "document TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (target, id, space))",
    "CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL)",
    "CREATE TABLE provenance (document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT, detail TEXT, " *
    "ms INTEGER, at TEXT NOT NULL)",
    "CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0)",
]

utcnow() = Dates.format(Dates.now(Dates.UTC), "yyyy-mm-ddTHH:MM:SS") * "Z"

function sqlval(v, json::Bool)
    v === nothing && return missing
    v isa Vector{UInt8} && return v
    (json && !(v isa AbstractString)) && return canonical_json(v)
    (v isa AbstractDict || v isa AbstractVector) && return canonical_json(v)
    v isa Bool && return Int(v)
    return v
end

function insert!(db, table, row::Vector{Pair{String,Any}}, json_cols = String[])
    cols = first.(row)
    vals = Any[sqlval(v, c in json_cols) for (c, v) in row]
    sql = "INSERT INTO $(qident(table)) ($(join(qident.(cols), ", "))) VALUES ($(join(fill("?", length(cols)), ", ")))"
    exec!(db, sql, vals)
end

pick(row::AbstractDict, cols, defaults = Dict{String,Any}()) = Pair{String,Any}[c => (haskey(row, c) ? row[c] : get(defaults, c, nothing)) for c in cols]

"""
    Writer(path; generator, profile, meta, trigram)

Builds a SPDF 5.0 file. Add rows with `document!`, `unit!`, `section!`, `fragment!`,
`figure!`, `space!`, `vector!`, `blob!`, `provenance!` and `extension!`, then call
`finish!`: the FTS index is rebuilt, the file has no triggers or views, it is compacted
with VACUUM and moved into place atomically.
"""
mutable struct Writer
    path::String
    tmp::String
    db::Union{SQLite.DB,Nothing}
    meta::Dict{String,Any}
    exact::Bool
    trigram::Bool
    document_id::Union{String,Nothing}
    dtypes::Dict{String,Tuple{Int,String}}
end

function Writer(path::AbstractString; generator = "SPDF.jl/0.1.0", profile = "core", meta = Dict{String,Any}(),
                trigram = false, exact = false)
    m = Dict{String,Any}(string(k) => v for (k, v) in meta)
    if !exact
        get!(m, "spdf_version", "5.0")
        get!(m, "profile", profile)
        get!(m, "created", utcnow())
        get!(m, "generator", generator)
    end
    p = abspath(path)
    tmp = joinpath(dirname(p), "." * basename(p) * "." * string(rand(UInt32); base = 16) * ".tmp")
    db = SQLite.DB(tmp)
    for s in ("PRAGMA page_size = 4096", "PRAGMA journal_mode = DELETE", "PRAGMA application_id = $APPLICATION_ID",
              "PRAGMA user_version = 500", "PRAGMA trusted_schema = OFF", "BEGIN")
        exec!(db, s)
    end
    for s in SCHEMA_50
        exec!(db, s)
    end
    return Writer(p, tmp, db, m, exact, trigram, nothing, Dict{String,Tuple{Int,String}}())
end

function document!(w::Writer, d::AbstractDict)
    d = Dict{String,Any}(string(k) => v for (k, v) in d)
    w.document_id = string(d["id"])
    defaults = Dict{String,Any}()
    if !w.exact
        md = get(d, "metadata", nothing)
        m = md isa AbstractDict ? md : Dict{String,Any}()
        created = get(w.meta, "created", utcnow())
        defaults["created"] = created
        defaults["updated"] = get(d, "created", created)
        defaults["title"] = get(m, "title", nothing)
        issued = get(m, "issued", nothing)
        dp = issued isa AbstractDict ? get(issued, "date-parts", nothing) : nothing
        defaults["year"] = dp isa AbstractVector && !isempty(dp) && dp[1] isa AbstractVector && !isempty(dp[1]) ? dp[1][1] : nothing
        defaults["language"] = get(m, "language", nothing)
        au = get(m, "author", nothing)
        defaults["authors"] = au isa AbstractVector ? join([string(something(get(a, "family", nothing), get(a, "literal", nothing), "")) for a in au if a isa AbstractDict], "; ") : nothing
        haskey(w.meta, "document_id") || (w.meta["document_id"] = w.document_id)
    end
    insert!(w.db, "documents", pick(d, COLUMNS["documents"], defaults), ["metadata", "rights"])
    return w
end

withdoc(w::Writer, r::AbstractDict) = (x = Dict{String,Any}(string(k) => v for (k, v) in r); x["document"] = something(w.document_id, get(x, "document", "")); x)

function unit!(w::Writer, u::AbstractDict)
    u = withdoc(w, u)
    if !w.exact
        haskey(u, "text") && u["text"] isa AbstractString && (u["text"] = nfc(u["text"]))
        !haskey(u, "printed") && u["anchor"] isa AbstractDict && (u["printed"] = get(u["anchor"], "printed", nothing))
    end
    insert!(w.db, "units", pick(u, COLUMNS["units"], Dict{String,Any}("text" => "", "confidence" => 1.0)), ["anchor", "notes", "words"])
    return w
end

section!(w::Writer, s::AbstractDict) = (insert!(w.db, "sections", pick(withdoc(w, s), COLUMNS["sections"])); w)

function fragment!(w::Writer, f::AbstractDict)
    f = withdoc(w, f)
    if !w.exact
        for k in ("text", "context", "search_text")
            get(f, k, nothing) isa AbstractString && (f[k] = nfc(f[k]))
        end
    end
    insert!(w.db, "fragments", pick(f, COLUMNS["fragments"], Dict{String,Any}("context" => "")), ["section", "anchor", "anchor_end"])
    return w
end

figure!(w::Writer, g::AbstractDict) = (insert!(w.db, "figures", pick(withdoc(w, g), COLUMNS["figures"]), ["anchor"]); w)

function space!(w::Writer, s::AbstractDict)
    s = Dict{String,Any}(string(k) => v for (k, v) in s)
    row = pick(s, COLUMNS["spaces"], Dict{String,Any}("dtype" => "f32", "normalized" => 1, "modalities" => Any["text"]))
    d = Dict(row)
    w.dtypes[string(d["id"])] = (Int(d["dims"]), string(d["dtype"]))
    insert!(w.db, "spaces", row, ["modalities", "task_prefixes"])
    return w
end

"""
    vector!(w, target, id, space, values)

Adds a vector given as floats (quantized for f16/i8 spaces) or as raw little-endian bytes.
"""
function vector!(w::Writer, target, id, space_id, values)
    haskey(w.dtypes, space_id) || spdf_error("E031", "declare space $space_id before its vectors")
    dims, dtype = w.dtypes[space_id]
    data = values isa Vector{UInt8} ? values : quantize(values, dtype)
    length(data) == dims * DTYPE_SIZES[dtype] || spdf_error("E030", "vector $target/$id has the wrong length for space $space_id")
    insert!(w.db, "vectors", Pair{String,Any}["target" => target, "id" => id, "space" => space_id,
        "document" => something(w.document_id, ""), "data" => data])
    return w
end

blob!(w::Writer, key, mime, data::Vector{UInt8}; sha = bytes2hex(sha256(data))) =
    (insert!(w.db, "blobs", Pair{String,Any}["key" => key, "mime" => mime, "sha256" => sha, "data" => data]); w)

provenance!(w::Writer, p::AbstractDict) = (insert!(w.db, "provenance", pick(withdoc(w, p), COLUMNS["provenance"]), ["detail"]); w)

extension!(w::Writer, name, version; required::Bool = false) =
    (insert!(w.db, "extensions", Pair{String,Any}["name" => name, "version" => version, "required" => required ? 1 : 0]); w)

"Finalizes the file and returns its path."
function finish!(w::Writer)
    for (k, v) in w.meta
        insert!(w.db, "spdf_meta", Pair{String,Any}["key" => k, "value" => string(v)])
    end
    exec!(w.db, "INSERT INTO fragments_fts(fragments_fts) VALUES ('rebuild')")
    if w.trigram
        exec!(w.db, "CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(text, content='fragments', content_rowid='n', tokenize='trigram')")
        exec!(w.db, "INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES ('rebuild')")
    end
    exec!(w.db, "COMMIT")
    exec!(w.db, "VACUUM")
    close(w.db)
    w.db = nothing
    mv(w.tmp, w.path; force = true)
    return w.path
end

function abort!(w::Writer)
    if w.db !== nothing
        try
            close(w.db)
        catch
        end
        w.db = nothing
    end
    rm(w.tmp; force = true)
    return nothing
end

"""
    write_source(source, path)

Writes a conformance *source* (a canonical dump plus vector values in
`vectors.<space>.items` and blob bytes in `blobs[].data_base64`) exactly as given.
"""
function write_source(src::AbstractDict, path::AbstractString)
    fts_ = get(src, "fts", nothing)
    w = Writer(path; meta = get(src, "meta", Dict{String,Any}()), exact = true,
               trigram = fts_ isa AbstractDict && get(fts_, "trigram", false) == true)
    try
        document!(w, src["document"])
        for u in get(src, "units", Any[])
            unit!(w, u)
        end
        for s in get(src, "sections", Any[])
            section!(w, s)
        end
        for f in get(src, "fragments", Any[])
            fragment!(w, f)
        end
        for g in get(src, "figures", Any[])
            figure!(w, g)
        end
        for s in get(src, "spaces", Any[])
            space!(w, s)
        end
        for (sp, v) in get(src, "vectors", Dict{String,Any}())
            dtype = haskey(w.dtypes, sp) ? w.dtypes[sp][2] : "f32"
            for it in get(v, "items", Any[])
                insert!(w.db, "vectors", Pair{String,Any}["target" => it["target"], "id" => it["id"], "space" => sp,
                    "document" => w.document_id, "data" => pack_values(it["values"], dtype)])
            end
        end
        for b in get(src, "blobs", Any[])
            data = base64decode(string(get(b, "data_base64", "")))
            blob!(w, b["key"], b["mime"], data; sha = something(get(b, "sha256", nothing), bytes2hex(sha256(data))))
        end
        for p in get(src, "provenance", Any[])
            provenance!(w, p)
        end
        for e in get(src, "extensions", Any[])
            extension!(w, e["name"], e["version"]; required = e["required"] != 0)
        end
        return finish!(w)
    catch
        abort!(w)
        rethrow()
    end
end
