# Runner of the shared conformance suite (conformance/cases/*.json, section 21).

function conf_compare(want, got, path = "\$")
    if want === nothing || got === nothing
        return want === got ? nothing : "$path: expected $(want === nothing ? "null" : "a value"), got $(got === nothing ? "null" : "a value")"
    end
    if want isa Real && !(want isa Bool) && got isa Real && !(got isa Bool)
        return abs(want - got) <= 1e-6 ? nothing : "$path: expected $want, got $got"
    end
    if want isa AbstractDict && got isa AbstractDict
        for k in keys(want)
            haskey(got, k) || return "$path.$k: missing"
        end
        for k in keys(got)
            haskey(want, k) || return "$path.$k: unexpected key"
        end
        for (k, v) in want
            r = conf_compare(v, got[k], "$path.$k")
            r === nothing || return r
        end
        return nothing
    end
    if want isa AbstractVector && got isa AbstractVector
        length(want) == length(got) || return "$path: expected $(length(want)) items, got $(length(got))"
        for i in eachindex(want)
            r = conf_compare(want[i], got[i], "$path[$(i-1)]")
            r === nothing || return r
        end
        return nothing
    end
    return isequal(want, got) ? nothing : "$path: expected $(repr(want)), got $(repr(got))"
end

function conf_results(want, got::Vector{Hit}, via::Bool)
    length(want) == length(got) || return "results: expected $(length(want)), got $(length(got))"
    for (i, w) in enumerate(want)
        g = got[i]
        wid = something(get(w, "fragment_id", nothing), get(w, "unit_id", nothing), get(w, "figure_id", nothing))
        wid == g.fragment_id || return "results[$(i-1)]: expected $wid, got $(g.fragment_id)"
        abs(w["score"] - g.score) <= 1e-6 || return "results[$(i-1)].score: expected $(w["score"]), got $(g.score)"
        w["anchor_uri"] == g.anchor_uri || return "results[$(i-1)].anchor_uri: expected $(w["anchor_uri"]), got $(g.anchor_uri)"
        via && haskey(w, "via") && w["via"] != g.via && return "results[$(i-1)].via: expected $(w["via"]), got $(g.via)"
    end
    return nothing
end

function conf_case(dir, c)
    p(rel) = joinpath(dir, rel)
    js(rel) = json_parse(read(p(rel), String))
    input = get(c, "input", Dict{String,Any}())
    ex = get(c, "expect", Dict{String,Any}())
    kind = get(c, "kind", "")
    if kind in ("dump", "legacy_dump")
        return open(p(input["file"])) do doc
            r = conf_compare(js(ex["dump"]), dump(doc), "dump")
            r !== nothing && return r
            sha = content_sha256(doc)
            haskey(ex, "content_sha256") && sha != ex["content_sha256"] && return "content_sha256: expected $(ex["content_sha256"]), got $sha"
            nothing
        end
    elseif kind == "roundtrip"
        out = tempname() * ".spdf"
        try
            write_source(js(input["source"]), out)
            return open(d -> conf_compare(js(ex["dump"]), dump(d), "dump"), out)
        finally
            rm(out; force = true)
        end
    elseif kind == "validate"
        r = validate(p(input["file"]))
        haskey(ex, "version") && !isequal(ex["version"], r["version"]) && return "version: expected $(ex["version"]), got $(r["version"])"
        haskey(ex, "valid") && ex["valid"] != r["valid"] && return "valid: expected $(ex["valid"]), got $(r["valid"]) ($(join([e["code"] for e in r["errors"]], ",")))"
        for k in ("errors", "warnings")
            haskey(ex, k) || continue
            want = sort(unique([e isa AbstractDict ? e["code"] : e for e in ex[k]]))
            got = sort(unique([e["code"] for e in r[k]]))
            want == got || return "$k: expected $want, got $got"
        end
        return nothing
    elseif kind == "search_lexical"
        return open(p(input["file"])) do doc
            route, match, hits = lexical_trace(doc, input["query"], get(input, "limit", 10))
            haskey(ex, "route") && ex["route"] != route && return "route: expected $(ex["route"]), got $route"
            haskey(ex, "match") && !isequal(ex["match"], match) && return "match: expected $(ex["match"]), got $match"
            conf_results(ex["results"], hits, true)
        end
    elseif kind == "search_vector"
        return open(p(input["file"])) do doc
            conf_results(ex["results"], search_vector(doc, input["query_vector"], input["space"]; limit = get(input, "limit", 10),
                target = get(input, "target", "fragment")), false)
        end
    elseif kind == "search_hybrid"
        return open(p(input["file"])) do doc
            conf_results(ex["results"], search_hybrid(doc, input["query"], input["query_vector"], input["space"]; limit = get(input, "limit", 10)), true)
        end
    elseif kind == "anchor_uri"
        if haskey(input, "uri")
            if get(ex, "error", false) == true
                try
                    parse_uri(input["uri"])
                    return "expected a parse error"
                catch e
                    return e isa SpdfError ? nothing : "unexpected $(typeof(e))"
                end
            end
            pr = parse_uri(input["uri"])
            pr["docref"] == ex["docref"] || return "docref: expected $(ex["docref"]), got $(pr["docref"])"
            r = conf_compare(ex["locator"], pr["locator"], "locator")
            r === nothing || return r
            f = format_locator(pr["docref"], pr["locator"])
            return f == ex["canonical"] ? nothing : "format(parse(uri)): expected $(ex["canonical"]), got $f"
        end
        uri = anchor_uri(input["docref"], input["anchor"], get(input, "anchor_end", nothing))
        uri == ex["uri"] || return "uri: expected $(ex["uri"]), got $uri"
        pr = parse_uri(uri)
        pr["docref"] == input["docref"] || return "parse(uri).docref: expected $(input["docref"]), got $(pr["docref"])"
        r = conf_compare(ex["locator"], pr["locator"], "locator")
        r === nothing || return r
        f = format_locator(pr["docref"], pr["locator"])
        return f == uri ? nothing : "format(parse(uri)): expected $uri, got $f"
    elseif kind == "cite"
        text = cite(something(get(input, "metadata", nothing), Dict{String,Any}()), input["anchor"], get(input, "anchor_end", nothing);
            locale = get(input, "locale", "en"))
        return text == ex["text"] ? nothing : "expected $(ex["text"]), got $text"
    elseif kind == "locate"
        got = open(p(input["file"])) do doc
            try
                locate(doc, input["reference"])
            catch e
                e isa SpdfError || rethrow()
                Dict{String,Any}("document" => false, "units" => Any[], "fragments" => Any[], "char" => nothing, "xywh" => nothing)
            end
        end
        return conf_compare(ex, got, "locate")
    elseif kind in ("export_csl", "export_bibtex")
        metas = [open(metadata, p(f)) for f in input["files"]]
        if kind == "export_csl"
            return conf_compare(ex["items"], csl_export(metas; anchor = get(input, "anchor", nothing), anchor_end = get(input, "anchor_end", nothing)), "items")
        end
        lines(t) = [strip(x) for x in split(replace(t, "\r\n" => "\n"), "\n") if !isempty(strip(x))]
        want, got = lines(ex["text"]), lines(bibtex_export(metas))
        for i in eachindex(want)
            (i <= length(got) && want[i] == got[i]) || return "line $i: expected $(want[i]), got $(i <= length(got) ? got[i] : "(nothing)")"
        end
        return length(want) == length(got) ? nothing : "expected $(length(want)) lines, got $(length(got))"
    elseif kind == "export_structure"
        return open(d -> conf_compare(ex["pages"], export_pages(d, input["format"]), "pages"), p(input["file"]))
    elseif kind == "quantize"
        hex = try
            bytes2hex(quantize(input["values"], input["dtype"]))
        catch e
            e isa SpdfError || rethrow()
            nothing
        end
        get(ex, "error", false) == true && return hex === nothing ? nothing : "expected an error, got $hex"
        hex === nothing && return "unexpected error"
        return hex == ex["hex"] ? nothing : "expected $(ex["hex"]), got $hex"
    end
    return "unknown case kind $kind"
end

function xml_attr(tag, name)
    m = match(Regex("\\s" * name * "=\"([^\"]*)\""), tag)
    m === nothing && return nothing
    return replace(m[1], "&lt;" => "<", "&gt;" => ">", "&quot;" => "\"", "&#39;" => "'", "&amp;" => "&")
end

"Page sequence of an ALTO, TEI or IIIF export, read back from the exported document."
function export_pages(doc, format)
    if format == "alto"
        return Any[Dict{String,Any}("physical" => parse(Int, xml_attr(t.match, "PHYSICAL_IMG_NR")), "printed" => xml_attr(t.match, "PRINTED_IMG_NR"))
                   for t in eachmatch(r"<Page\s[^>]*>", alto(doc))]
    elseif format == "tei"
        xml = tei(doc)
        body = xml[findfirst("<body>", xml)[1]:end]
        return Any[Dict{String,Any}("n" => xml_attr(t.match, "n")) for t in eachmatch(r"<pb(\s[^>]*)?/>", body)]
    elseif format == "iiif"
        base = "https://example.org/iiif"
        manifest = json_parse(JSON.json(iiif(doc, base)))
        pagecanvases = Set("$base/canvas/$(u["ord"])" for u in units(doc) if u["anchor"] isa AbstractDict && get(u["anchor"], "type", nothing) == "page")
        return Any[Dict{String,Any}("label" => haskey(c, "label") ? first(values(c["label"]))[1] : nothing) for c in manifest["items"] if c["id"] in pagecanvases]
    end
    spdf_error("E000", "unknown format $format")
end

"""
    conformance(dir) -> Dict

Runs every case of `conformance/cases/*.json` and returns the report of the
specification: `impl`, `version`, `passed`, `failed` (`id`, `reason`) and `skipped`.
"""
function conformance(dir::AbstractString)
    passed = String[]
    failed = Any[]
    skipped = Any[]
    files = sort(filter(f -> endswith(f, ".json"), readdir(joinpath(dir, "cases"); join = true)))
    for f in files
        c = json_parse(read(f, String))
        id = get(c, "id", splitext(basename(f))[1])
        reason = try
            conf_case(dir, c)
        catch e
            sprint(showerror, e)
        end
        if reason === nothing
            push!(passed, id)
        elseif reason === :skip
            push!(skipped, Dict{String,Any}("id" => id, "reason" => "ALTO, TEI and IIIF exports (SPEC §19.4, optional) are not implemented"))
        else
            push!(failed, Dict{String,Any}("id" => id, "reason" => reason))
        end
    end
    return Dict{String,Any}("impl" => "SPDF.jl", "version" => "0.1.0", "passed" => passed, "failed" => failed, "skipped" => skipped)
end

hitdict(h::Hit) = Dict{String,Any}("fragment_id" => h.fragment_id, "score" => h.score, "via" => h.via, "anchor" => h.anchor,
    "anchor_uri" => h.anchor_uri)

"One request of the `eval` test protocol (bin/eval.jl)."
function evaluate(q::AbstractDict)
    op = q["op"]
    lim = get(q, "limit", 10)
    op == "dump" && return open(dump, q["file"])
    op == "validate" && return validate(q["file"])
    op == "lexical" && return open(d -> hitdict.(search_lexical(d, q["query"]; limit = lim)), q["file"])
    op == "vector" && return open(d -> hitdict.(search_vector(d, q["vector"], q["space"]; limit = lim, target = get(q, "target", "fragment"))), q["file"])
    op == "hybrid" && return open(d -> hitdict.(search_hybrid(d, q["query"], q["vector"], q["space"]; limit = lim)), q["file"])
    op == "uri" && return anchor_uri(q["docref"], q["anchor"], get(q, "end", nothing))
    op == "format_locator" && return format_locator(q["docref"], q["locator"])
    op == "parse_uri" && return parse_uri(q["uri"])
    op == "cite" && return cite(q["metadata"], q["anchor"], get(q, "end", nothing); locale = get(q, "locale", "es"))
    if op == "write"
        write_source(q["source"], q["path"])
        return open(dump, q["path"])
    end
    spdf_error("E000", "unknown op $op")
end
