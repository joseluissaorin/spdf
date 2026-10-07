# Validation (specification section 22).

const REQUIRED_TABLES = ["spdf_meta", "documents", "units", "sections", "fragments", "fragments_fts", "figures",
    "spaces", "vectors", "blobs", "provenance", "extensions"]
const REQUIRED_META = ["spdf_version", "profile", "created", "generator", "document_id"]
const ANCHOR_TYPES = ["page", "time", "section", "slide", "sheet", "web", "image", "verse", "canonical"]

isjint(v) = (v isa Integer && !(v isa Bool)) || (v isa AbstractFloat && isfinite(v) && v == floor(v))
isjnum(v) = v isa Real && !(v isa Bool)

"nothing if the decoded anchor is fine, else (code, message)."
function check_anchor(a, text)
    a isa AbstractDict || return ("E040", "anchor is not an object")
    t = get(a, "type", nothing)
    t isa AbstractString || return ("E040", "anchor without type")
    t in ANCHOR_TYPES || return ("E041", "unknown anchor type $t")
    g(k) = get(a, k, nothing)
    ok = if t == "page"
        isjint(g("physical")) && g("physical") >= 1 && haskey(a, "printed") && (g("printed") === nothing || g("printed") isa AbstractString)
    elseif t == "time"
        isjnum(g("t0")) && isjnum(g("t1")) && 0 <= g("t0") <= g("t1")
    elseif t == "section"
        g("path") isa AbstractVector && all(x -> x isa AbstractString, g("path"))
    elseif t == "slide"
        isjint(g("n")) && g("n") >= 1
    elseif t == "sheet"
        g("sheet") isa AbstractString && isjint(g("row_from")) && isjint(g("row_to"))
    elseif t == "web"
        g("url") isa AbstractString
    elseif t == "image"
        true
    elseif t == "verse"
        isjint(g("line_from"))
    else
        g("scheme") isa AbstractString && g("ref") isa AbstractString
    end
    ok || return ("E040", "$t anchor misses or mistypes a required member")
    haskey(a, "matter") && !(a["matter"] isa AbstractString) && return ("E040", "matter must be a string")
    if haskey(a, "region")
        r = a["region"]
        (r isa AbstractDict && all(k -> isjnum(get(r, k, nothing)), ("x", "y", "w", "h"))) || return ("E040", "bad region")
    end
    if haskey(a, "chars")
        c = a["chars"]
        (c isa AbstractVector && length(c) == 2 && all(isjint, c)) || return ("E040", "bad chars")
        if text !== nothing && !(0 <= c[1] <= c[2] <= length(nfc(text)))
            return ("E042", "chars $(c) out of range")
        end
    end
    return nothing
end

"""
    validate(path) -> Dict

Runs the checks of the specification in order and returns `valid`, `version`, `profile`,
`errors` and `warnings` (each a Dict with `code`, `message` and `where`).
"""
function validate(path::AbstractString)
    errors = Dict{String,Any}[]
    warnings = Dict{String,Any}[]
    forward = Ref(false)   # a newer minor version may define new anchor types and dtypes (SPEC §22.1, §23)
    warn(code, msg, where = "") = push!(warnings, Dict{String,Any}("code" => code, "message" => msg, "where" => where))
    err(code, msg, where = "") = forward[] && code in ("E041", "E032") ? warn(code, msg, where) :
                                 push!(errors, Dict{String,Any}("code" => code, "message" => msg, "where" => where))
    result(version, profile) = Dict{String,Any}("valid" => isempty(errors), "version" => version, "profile" => profile,
        "errors" => errors, "warnings" => warnings)
    doc = try
        open_container(path; strict = false)
    catch e
        err(e isa SpdfError && e.code == "E002" ? "E002" : "E001", e isa SpdfError ? e.message : sprint(showerror, e))
        return result(nothing, Any[])
    end
    try
        return _validate(doc, err, warn, result, errors, forward)
    finally
        close(doc)
    end
end

function _validate(doc::Document, err, warn, result, errors, forward)
    db = doc.db
    version = doc.version
    profile = Any[]
    if doc.legacy
        warn("W110", "legacy SPDF $version file")
        for t in ("spdf", "documentos", "unidades", "fragmentos", "fragmentos_fts")
            t in doc.tables || err("E010", "missing legacy table $t", t)
        end
        for (t, n) in doc.forbidden
            err("E020", "$t $n present", n)
        end
        return result(version, profile)
    end
    doc.gzipped && warn("E003", "SPDF 5.0 should not be gzip-wrapped")
    if version != "5.0"
        warn("W105", "newer minor version $version")
        forward[] = true
    end
    for (t, n) in doc.forbidden
        err("E020", "$t $n present", n)
    end
    present = Dict{String,Vector{String}}()
    for t in REQUIRED_TABLES
        if !(t in doc.tables)
            err("E010", "missing table $t", t)
            continue
        end
        have = table_columns(doc, t)
        present[t] = have
        for c in get(COLUMNS, t, String[])
            c in have || err("E011", "missing column $t.$c", "$t.$c")
        end
    end
    ok(t, cols...) = haskey(present, t) && all(c -> c in present[t], cols)

    m = Dict{String,Any}()
    if ok("spdf_meta", "key", "value")
        m = Dict{String,Any}(r["key"] => r["value"] for r in query(db, "SELECT key, value FROM spdf_meta"))
        for k in REQUIRED_META
            haskey(m, k) || err("E012", "missing spdf_meta key $k", k)
        end
        profile = Any[String(x) for x in split(string(something(get(m, "profile", nothing), "")))]
    end
    docs = Dict{String,Any}[]
    if ok("documents", "id", "metadata")
        docs = ok("documents", "rights", "unit_count") ? query(db, "SELECT id, metadata, rights, unit_count FROM documents") :
               query(db, "SELECT id, metadata, NULL AS rights, NULL AS unit_count FROM documents")
        length(docs) == 1 || err("E013", "documents has $(length(docs)) rows", "documents")
        for d in docs
            md = try
                d["metadata"] isa AbstractString ? json_parse(d["metadata"]) : error()
            catch
                err("E050", "metadata is not valid JSON", string(d["id"]))
                nothing
            end
            if md !== nothing && !(md isa AbstractDict && get(md, "type", nothing) isa AbstractString && get(md, "title", nothing) isa AbstractString)
                err("E051", "metadata needs a string type and title", string(d["id"]))
            end
            if d["rights"] !== nothing
                try
                    json_parse(d["rights"])
                catch
                    err("E050", "rights is not valid JSON", string(d["id"]))
                end
            end
        end
    end
    if ok("extensions", "name", "required")
        for e in query(db, "SELECT name, required FROM extensions ORDER BY name")
            e["required"] !== nothing && e["required"] != 0 && err("E060", "unknown required extension $(e["name"])", e["name"])
        end
    end
    anchor_error(raw, text, where) = begin
        a = try
            raw isa AbstractString ? json_parse(raw) : error()
        catch
            err("E040", "anchor is not valid JSON", where)
            return
        end
        r = check_anchor(a, text)
        r === nothing || err(r[1], r[2], where)
    end
    texts = Dict{String,Any}()
    if ok("units", "id", "ord", "anchor", "text")
        us = query(db, "SELECT id, ord, anchor, text FROM units ORDER BY ord, id")
        [u["ord"] for u in us] == collect(1:length(us)) || err("E090", "units.ord is not 1..N", "units")
        if length(docs) == 1 && docs[1]["unit_count"] !== nothing && docs[1]["unit_count"] != length(us)
            warn("W102", "unit_count $(docs[1]["unit_count"]) but $(length(us)) units", "documents.unit_count")
        end
        for u in us
            texts[string(u["id"])] = u["text"]
            anchor_error(u["anchor"], u["text"], "units/$(u["id"])")
        end
    end
    if ok("fragments", "id", "unit", "anchor")
        endcol = ok("fragments", "anchor_end") ? "anchor_end" : "NULL AS anchor_end"
        for f in query(db, "SELECT id, unit, anchor, $endcol FROM fragments ORDER BY n")
            anchor_error(f["anchor"], get(texts, string(f["unit"]), nothing), "fragments/$(f["id"])")
            f["anchor_end"] === nothing || anchor_error(f["anchor_end"], nothing, "fragments/$(f["id"])/anchor_end")
        end
    end
    if ok("figures", "id", "unit", "anchor")
        for g in query(db, "SELECT id, unit, anchor FROM figures ORDER BY id")
            anchor_error(g["anchor"], get(texts, string(g["unit"]), nothing), "figures/$(g["id"])")
        end
    end
    spaces_ = Dict{String,Tuple{Int,String}}()
    if ok("spaces", "id", "dims", "dtype")
        for s in query(db, "SELECT id, dims, dtype FROM spaces ORDER BY id")
            spaces_[string(s["id"])] = (Int(s["dims"]), string(s["dtype"]))
            haskey(DTYPE_SIZES, string(s["dtype"])) || err("E032", "unknown dtype $(s["dtype"])", s["id"])
        end
    end
    nvec = 0
    if ok("vectors", "target", "id", "space", "data")
        for v in query(db, "SELECT target, id, space, typeof(data) AS t, length(data) AS len FROM vectors ORDER BY space, target, id")
            nvec += 1
            where = "vectors/$(v["space"])/$(v["target"])/$(v["id"])"
            if !haskey(spaces_, string(v["space"]))
                err("E031", "unknown space $(v["space"])", where)
                continue
            end
            dims, dtype = spaces_[string(v["space"])]
            haskey(DTYPE_SIZES, dtype) || continue
            (v["t"] == "blob" && v["len"] == dims * DTYPE_SIZES[dtype]) || err("E030", "vector length $(v["len"]) != $dims x $(DTYPE_SIZES[dtype])", where)
        end
    end
    if "fragments_fts" in doc.tables
        mem = SQLite.DB()
        try
            bk = SQLite.C.sqlite3_backup_init(mem.handle, "main", db.handle, "main")
            SQLite.C.sqlite3_backup_step(bk, -1)
            SQLite.C.sqlite3_backup_finish(bk)
            exec!(mem, "PRAGMA trusted_schema = OFF")
            exec!(mem, "INSERT INTO fragments_fts(fragments_fts, rank) VALUES ('integrity-check', 1)")
            if "fragments_fts_trigram" in doc.tables
                exec!(mem, "INSERT INTO fragments_fts_trigram(fragments_fts_trigram, rank) VALUES ('integrity-check', 1)")
            end
        catch e
            err("E070", "FTS index out of sync: " * sprint(showerror, e), "fragments_fts")
        finally
            close(mem)
        end
    end
    if ok("blobs", "key", "sha256", "data")
        for b in query(db, "SELECT key, sha256, data FROM blobs ORDER BY key")
            bytes2hex(sha256(something(b["data"], UInt8[]))) == b["sha256"] || err("E080", "blob sha256 mismatch", b["key"])
        end
    end
    if haskey(m, "content_sha256") && isempty(errors)
        actual = try
            content_sha256(doc)
        catch
            "unavailable"
        end
        if actual != m["content_sha256"]
            err("E081", "content_sha256 does not match the canonical dump", "spdf_meta.content_sha256")
        elseif haskey(m, "signature")
            good = try
                signer = string(get(m, "signer", ""))
                startswith(signer, "ed25519:") || error()
                pk = base64decode(signer[9:end])
                sig = base64decode(string(m["signature"]))
                Ed25519.verify(pk, Vector{UInt8}("spdf-content-sha256:" * m["content_sha256"]), sig)
            catch
                false
            end
            good || err("E082", "signature does not verify", "spdf_meta.signature")
        end
    end
    # W103: fragments that cross matter, or between a page with a folio and one without (§4.4).
    if ok("units", "id", "ord", "anchor") && ok("fragments", "id", "unit", "anchor", "anchor_end")
        jp(x) = try
            x isa AbstractString ? json_parse(x) : nothing
        catch
            nothing
        end
        us = [Dict{String,Any}("id" => r["id"], "anchor" => jp(r["anchor"])) for r in query(db, "SELECT id, anchor FROM units ORDER BY ord, id")]
        byid = Dict(string(u["id"]) => u for u in us)
        for f in query(db, "SELECT id, unit, anchor_end FROM fragments WHERE anchor_end IS NOT NULL ORDER BY n")
            u1 = get(byid, string(f["unit"]), nothing)
            u2 = u1 === nothing ? nothing : end_unit(us, string(f["unit"]), jp(f["anchor_end"]))
            (u1 === nothing || u2 === nothing || !(u1["anchor"] isa AbstractDict) || !(u2["anchor"] isa AbstractDict)) && continue
            a1, a2 = u1["anchor"], u2["anchor"]
            foliochange = get(a1, "type", nothing) == "page" && get(a2, "type", nothing) == "page" &&
                          (get(a1, "printed", nothing) === nothing) != (get(a2, "printed", nothing) === nothing)
            if matter_of(a1) != matter_of(a2) || foliochange
                warn("W103", "fragment crosses matter, or between a page with a folio and one without", "fragments/$(f["id"])")
            end
        end
    end
    "semantic" in profile && nvec == 0 && warn("W100", "profile semantic without vectors")
    if "media" in profile && ok("units", "anchor")
        has_time = any(column(db, "SELECT anchor FROM units")) do a
            x = try
                json_parse(a)
            catch
                nothing
            end
            x isa AbstractDict && get(x, "type", nothing) == "time"
        end
        has_time || warn("W101", "profile media without time anchors")
    end
    return result(version, profile)
end
