# Safe opening (specification section 1).

const APPLICATION_ID = 1397769286
const LEGACY_TRIGGERS = ("fragmentos_ai", "fragmentos_ad", "fragmentos_au")
const SQLITE_MAGIC = Vector{UInt8}("SQLite format 3\0")

"""
A SPDF file opened for reading (SPDF 5.0, or legacy 4.x through the 5.0 view).
Create it with [`SPDF.open`](@ref) and release it with `close`.
"""
mutable struct Document
    db::Union{SQLite.DB,Nothing}
    path::String
    version::String
    legacy::Bool
    gzipped::Bool
    application_id::Int
    user_version::Int
    tables::Vector{String}
    forbidden::Vector{Tuple{String,String}}
    temp::Union{String,Nothing}
    cache::Dict{Symbol,Any}
end

function Base.close(doc::Document)
    if doc.db !== nothing
        try
            close(doc.db)
        catch
        end
        doc.db = nothing
    end
    if doc.temp !== nothing
        rm(doc.temp; force = true)
        doc.temp = nothing
    end
    return nothing
end

Base.isopen(doc::Document) = doc.db !== nothing

function Base.show(io::IO, doc::Document)
    if isopen(doc)
        print(io, "SPDF.Document(", doc.version, doc.legacy ? " legacy" : "", ", \"", title(doc), "\")")
    else
        print(io, "SPDF.Document(closed)")
    end
end

"Executes a statement and releases it at once (no statement left in progress)."
function exec!(db::SQLite.DB, sql::AbstractString, params = ())
    q = DBInterface.execute(db, sql, collect(Any, params))
    q isa SQLite.Query && DBInterface.close!(q)
    return nothing
end

"Rows of a query as Dicts (SQL NULL becomes `nothing`, blobs Vector{UInt8})."
function query(db::SQLite.DB, sql::AbstractString, params = ())
    out = Dict{String,Any}[]
    q = DBInterface.execute(db, sql, collect(Any, params))
    try
        for row in q
            push!(out, Dict{String,Any}(String(n) => _sqlval(getproperty(row, n)) for n in propertynames(row)))
        end
    finally
        DBInterface.close!(q)
    end
    return out
end
_sqlval(::Missing) = nothing
_sqlval(v) = v

"Column values of the first column of a query."
column(db, sql, params = ()) = [first(values(r)) for r in query(db, sql, params)]
scalar(db, sql, params = ()) = (rs = query(db, sql, params); isempty(rs) ? nothing : first(values(rs[1])))

uri_path(p::AbstractString) = replace(p, "%" => "%25", "?" => "%3F", "#" => "%23")

"""
    SPDF.open(path; max_blob_bytes = 512 MiB, max_inflated_bytes = 4 GiB) -> Document
    SPDF.open(f, path; kwargs...)

Opens a SPDF file safely: read-only (`mode=ro`, `query_only`), `trusted_schema=OFF`,
defensive mode, no extensions, triggers/views/foreign virtual tables refused (except
the three FTS triggers of legacy files), bounded blob sizes and gzip inflation, and
WAL-mode files copied before opening. With a function as first argument the document
is closed when the function returns.
"""
function open(path::AbstractString; max_blob_bytes::Integer = 512 * 1024^2, max_inflated_bytes::Integer = 4 * 1024^3)
    doc = open_container(path; max_blob_bytes, max_inflated_bytes, strict = true)
    try
        for e in rows(doc, "extensions", "ORDER BY {name}")
            req = get(e, "required", 0)
            if req !== nothing && req != 0
                spdf_error("E060", "the file requires the unknown extension $(e["name"])")
            end
        end
    catch
        close(doc)
        rethrow()
    end
    return doc
end

function open(f::Function, path::AbstractString; kwargs...)
    doc = open(path; kwargs...)
    try
        return f(doc)
    finally
        close(doc)
    end
end

function open_container(path::AbstractString; max_blob_bytes = 512 * 1024^2, max_inflated_bytes = 4 * 1024^3, strict = true)
    doc = Document(nothing, String(path), "", false, false, 0, 0, String[], Tuple{String,String}[], nothing, Dict{Symbol,Any}())
    try
        _open!(doc, path, max_blob_bytes, max_inflated_bytes, strict)
    catch
        close(doc)
        rethrow()
    end
    return doc
end

function _readhead(path, n)
    Base.open(path, "r") do io
        read(io, n)
    end
end

function _open!(doc, path, max_blob_bytes, max_inflated_bytes, strict)
    (isfile(path) && !isdir(path)) || spdf_error("E001", "cannot read file: $path")
    real = abspath(path)
    head = _readhead(real, 100)
    if length(head) >= 2 && head[1] == 0x1f && head[2] == 0x8b
        doc.gzipped = true
        real = _inflate!(doc, real, max_inflated_bytes)
        head = _readhead(real, 100)
    end
    (length(head) >= 100 && head[1:16] == SQLITE_MAGIC) || spdf_error("E001", "not a SQLite database (nor gzip-wrapped SQLite)")
    if head[19] == 0x02 || head[20] == 0x02
        if doc.temp === nothing
            tmp = tempname() * ".sqlite"
            cp(real, tmp)
            doc.temp = tmp
            real = tmp
        end
        Base.open(real, "r+") do io
            seek(io, 18)
            write(io, UInt8[0x01, 0x01])
        end
    end
    local master
    try
        doc.db = SQLite.DB("file:" * uri_path(real) * "?mode=ro")
        @ccall SQLite.C.libsqlite.sqlite3_db_config(doc.db.handle::Ptr{Cvoid}, 1010::Cint; 1::Cint, C_NULL::Ptr{Cint})::Cint
        # Largest BLOB or TEXT value SQLite will hand back (SPEC §2.4, step 5).
        @ccall SQLite.C.libsqlite.sqlite3_limit(doc.db.handle::Ptr{Cvoid}, 0::Cint, Cint(min(max_blob_bytes, typemax(Int32)))::Cint)::Cint
        for p in ("PRAGMA query_only = 1", "PRAGMA trusted_schema = OFF", "PRAGMA cell_size_check = ON")
            exec!(doc.db, p)
        end
        master = query(doc.db, "SELECT type, name, sql FROM sqlite_master")
    catch e
        e isa SpdfError && rethrow()
        spdf_error("E001", "SQLite cannot read this file: " * sprint(showerror, e))
    end
    doc.application_id = Int(scalar(doc.db, "PRAGMA application_id"))
    doc.user_version = Int(scalar(doc.db, "PRAGMA user_version"))
    doc.tables = [r["name"] for r in master if r["type"] == "table"]
    _detect_version!(doc)
    allowed = doc.legacy ? ("fragmentos_fts",) : ("fragments_fts", "fragments_fts_trigram")
    for r in master
        sql = something(r["sql"], "")
        if r["type"] == "table" && occursin(r"^\s*CREATE\s+VIRTUAL\s+TABLE"i, sql) &&
           (!(r["name"] in allowed) || !occursin(r"USING\s+fts5\s*\("i, sql))
            push!(doc.forbidden, ("virtual table", r["name"]))
        elseif r["type"] in ("trigger", "view") && !(doc.legacy && r["type"] == "trigger" && r["name"] in LEGACY_TRIGGERS)
            push!(doc.forbidden, (r["type"], r["name"]))
        end
    end
    if strict && !isempty(doc.forbidden)
        t, n = doc.forbidden[1]
        spdf_error("E020", "the file contains a $t ($n); refusing to open it")
    end
    if strict
        checks = doc.legacy ? ("blobs" => "datos", "vectores" => "valores") : ("blobs" => "data", "vectors" => "data")
        for (t, c) in checks
            t in doc.tables || continue
            mx = scalar(doc.db, "SELECT coalesce(max(length($c)), 0) FROM $t")
            mx > max_blob_bytes && spdf_error("E001", "a blob in $t is $mx bytes, above the limit of $max_blob_bytes")
        end
    end
    return doc
end

function _detect_version!(doc)
    uv = doc.user_version
    if doc.application_id == APPLICATION_ID
        if 500 <= uv <= 599
            doc.version = "$(uv ÷ 100).$((uv % 100) ÷ 10)"
            return
        end
    elseif "spdf" in doc.tables && "documentos" in doc.tables
        v = try
            scalar(doc.db, "SELECT valor FROM spdf WHERE clave = 'spdf_version'")
        catch
            nothing
        end
        if v !== nothing && startswith(string(v), "4.")
            doc.legacy = true
            doc.version = string(v)
            return
        end
        if uv in (400, 410)
            doc.legacy = true
            doc.version = "$(uv ÷ 100).$((uv % 100) ÷ 10)"
            return
        end
    end
    spdf_error("E002", "unknown application_id or user_version ($(doc.application_id), $uv)")
end

function _inflate!(doc, path, limit)
    tmp = tempname() * ".sqlite"
    doc.temp = tmp
    total = 0
    try
        Base.open(path, "r") do io
            gz = GzipDecompressorStream(io)
            Base.open(tmp, "w") do out
                buf = Vector{UInt8}(undef, 1 << 20)
                while !eof(gz)
                    n = readbytes!(gz, buf)
                    total += n
                    total > limit && spdf_error("E001", "inflated size exceeds the limit of $limit bytes")
                    write(out, view(buf, 1:n))
                end
            end
            close(gz)
        end
    catch e
        e isa SpdfError && rethrow()
        spdf_error("E001", "bad gzip: " * sprint(showerror, e))
    end
    return tmp
end
