# Exports to library formats (SPEC §19.4): ALTO 4, a minimal TEI P5 and a IIIF
# Presentation 3 manifest. No invented coordinates.

const ALTO_NS = "http://www.loc.gov/standards/alto/ns-v4#"
const TEI_NS = "http://www.tei-c.org/ns/1.0"
const IIIF_CONTEXT = "http://iiif.io/api/presentation/3/context.json"
const DEFAULT_SIZE = (1000, 1414)

xesc(s) = replace(string(s), "&" => "&amp;", "<" => "&lt;", ">" => "&gt;", "\"" => "&quot;", "'" => "&#39;")

md_clean(line) = replace(replace(string(line), r"^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(?=\S))" => ""), r"(\*\*|__|`)" => "")

text_paragraphs(text) = [String(strip(p)) for p in split(string(something(text, "")), r"\n\s*\n") if !isempty(strip(p))]

"The folio of a page anchor as TEI `pb/@n` and IIIF labels write it (`[iv]` if inferred)."
function page_folio(a)
    p = get(a, "printed", nothing)
    p === nothing && return nothing
    return get(a, "source", nothing) == "inferred" ? "[" * string(p) * "]" : string(p)
end

export_title(doc::Document) = string(something(title(doc), document(doc)["id"]))

function alto_blocks(id, text, extra = "")
    out = String[]
    for (bi, para) in enumerate(text_paragraphs(text))
        bid = "$(id)_$bi"
        push!(out, "<TextBlock ID=\"$bid\"$extra>")
        li = 0
        for line in split(para, "\n")
            ws = split(md_clean(line))
            isempty(ws) && continue
            li += 1
            parts = [(wi > 1 ? "<SP/>" : "") * "<String ID=\"$(bid)_L$(li)_W$wi\" CONTENT=\"$(xesc(w))\"/>" for (wi, w) in enumerate(ws)]
            push!(out, "<TextLine ID=\"$(bid)_L$li\">" * join(parts) * "</TextLine>")
        end
        push!(out, "</TextBlock>")
    end
    return out
end

"""
    alto(doc) -> String

ALTO 4 XML with one `Page` per page unit (`PHYSICAL_IMG_NR`, and `PRINTED_IMG_NR` only
for printed folios), one `TextBlock` per paragraph and one `TextLine` per line.
"""
function alto(doc::Document)
    pages = [u for u in units(doc) if u["anchor"] isa AbstractDict && get(u["anchor"], "type", nothing) == "page"]
    isempty(pages) && spdf_error("E000", "ALTO export needs page units; this document has none (try TEI or IIIF)")
    out = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<alto xmlns=\"$ALTO_NS\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" " *
        "xsi:schemaLocation=\"$ALTO_NS http://www.loc.gov/standards/alto/v4/alto-4-4.xsd\">",
        "<Description>", "<MeasurementUnit>pixel</MeasurementUnit>", "<sourceImageInformation>",
        "<fileName>$(xesc(export_title(doc)))</fileName>", "<fileIdentifier>$(xesc(docref(doc)))</fileIdentifier>",
        "</sourceImageInformation>", "<Processing ID=\"PROC_SPDF\">",
        "<processingStepDescription>Export from SPDF</processingStepDescription>",
        "<processingSoftware><softwareName>SPDF.jl</softwareName><softwareVersion>0.1.0</softwareVersion></processingSoftware>",
        "</Processing>", "</Description>", "<Tags><StructureTag ID=\"TAG_NOTE\" LABEL=\"footnote\"/></Tags>", "<Layout>"]
    for u in pages
        a = u["anchor"]
        physical = Int(something(get(a, "physical", nothing), u["ord"]))
        pid = "P$physical"
        attrs = "ID=\"$pid\" PHYSICAL_IMG_NR=\"$physical\""
        if get(a, "printed", nothing) !== nothing && get(a, "source", nothing) != "inferred"
            attrs *= " PRINTED_IMG_NR=\"$(xesc(a["printed"]))\""
        end
        if get(u, "confidence", nothing) !== nothing
            pc = replace(replace(@sprintf("%.4f", clamp(Float64(u["confidence"]), 0.0, 1.0)), r"0+$" => ""), r"\.$" => "")
            attrs *= " PC=\"$pc\""
        end
        push!(out, "<Page $attrs>")
        h = get(u, "header", nothing)
        h isa AbstractString && !isempty(h) && append!(out, ["<TopMargin ID=\"$(pid)_TM\">"; alto_blocks("$(pid)_TM_B", h); "</TopMargin>"])
        f = get(u, "footer", nothing)
        f isa AbstractString && !isempty(f) && append!(out, ["<BottomMargin ID=\"$(pid)_BM\">"; alto_blocks("$(pid)_BM_B", f); "</BottomMargin>"])
        push!(out, "<PrintSpace ID=\"$(pid)_PS\">")
        append!(out, alto_blocks("$(pid)_B", u["text"]))
        notes = get(u, "notes", nothing)
        notes isa AbstractVector && !isempty(notes) && append!(out, alto_blocks("$(pid)_N", join(string.(notes), "\n\n"), " TAGREFS=\"TAG_NOTE\""))
        push!(out, "</PrintSpace>", "</Page>")
    end
    push!(out, "</Layout>", "</alto>")
    return join(out, "\n") * "\n"
end

function tei_person(p)
    p isa AbstractDict || return ""
    lit = get(p, "literal", nothing)
    lit isa AbstractString && !isempty(lit) && return lit
    family = strip(join(filter(!isnothing, [get(p, "non-dropping-particle", nothing), get(p, "family", nothing)]), " "))
    given = string(something(get(p, "given", nothing), ""))
    !isempty(family) && !isempty(given) ? "$family, $given" : (isempty(family) ? given : String(family))
end

function tei_unit(u)
    a = u["anchor"] isa AbstractDict ? u["anchor"] : Dict{String,Any}()
    t = get(a, "type", nothing)
    out = String[]
    if t == "page"
        attrs = ""
        n = page_folio(a)
        n === nothing || (attrs *= " n=\"$(xesc(n))\"")
        img = get(u, "image", nothing)
        img isa AbstractString && !isempty(img) && (attrs *= " facs=\"$(xesc(img))\"")
        push!(out, "<pb$attrs/>")
    end
    text = string(something(get(u, "text", nothing), ""))
    notes = ["<note place=\"foot\">$(xesc(md_clean(n)))</note>" for n in something(get(u, "notes", nothing), Any[])]
    if t == "verse" && get(a, "line_from", nothing) !== nothing
        push!(out, "<lg>")
        lines = [l for l in split(text, "\n") if !isempty(strip(l))]
        for (i, line) in enumerate(lines)
            push!(out, "<l n=\"$(Int(a["line_from"]) + i - 1)\">$(xesc(strip(md_clean(line))))</l>")
        end
        push!(out, "</lg>")
    elseif t == "time"
        for para in text_paragraphs(text)
            who = get(a, "speaker", nothing)
            m = match(r"^\*\*([^*]{1,80}):\*\*\s*", para)
            if m !== nothing
                who = strip(m[1])
                para = para[ncodeunits(m.match)+1:end]
            end
            who_attr = who === nothing ? "" : " who=\"#$(xesc(replace(string(who), r"[^A-Za-z0-9_.-]+" => "_")))\""
            push!(out, "<u$who_attr>$(xesc(md_clean(para)))</u>")
        end
    elseif t in ("section", "web") && get(a, "path", nothing) isa AbstractVector && !isempty(a["path"])
        push!(out, "<div>", "<head>$(xesc(a["path"][end]))</head>")
        append!(out, ["<p>$(xesc(md_clean(p)))</p>" for p in text_paragraphs(text)])
        append!(out, notes)
        push!(out, "</div>")
        return out
    else
        append!(out, ["<p>$(xesc(md_clean(p)))</p>" for p in text_paragraphs(text)])
    end
    append!(out, notes)
    return out
end

"""
    tei(doc) -> String

A minimal TEI P5 document: header from the metadata, `pb`, `p`, `lg`/`l`, `u` and
`note` in the body (`pb/@n` is the folio as cited, `[iv]` for inferred folios).
"""
function tei(doc::Document)
    d = document(doc)
    m = metadata(doc)
    lang = get(d, "language", nothing)
    out = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<TEI xmlns=\"$TEI_NS\"" * (lang === nothing ? "" : " xml:lang=\"$(xesc(lang))\"") * ">",
        "<teiHeader>", "<fileDesc>", "<titleStmt>", "<title>$(xesc(export_title(doc)))</title>"]
    for role in ("author", "editor"), p in something(get(m, role, nothing), Any[])
        name = tei_person(p)
        isempty(name) || push!(out, "<$role>$(xesc(name))</$role>")
    end
    push!(out, "</titleStmt>", "<publicationStmt>", "<distributor>Exported from SPDF with SPDF.jl</distributor>",
        "<idno type=\"SPDF\">spdf:$(xesc(docref(doc)))</idno>")
    rights = get(d, "rights", nothing)
    if rights isa AbstractDict && !isempty(rights)
        lic = get(rights, "license", nothing)
        target = lic isa AbstractString && startswith(lic, "http") ? " target=\"$(xesc(lic))\"" : ""
        text = strip(join(filter(!isnothing, [lic isa AbstractString ? lic : nothing, get(rights, "holder", nothing), get(rights, "note", nothing)]), " "))
        push!(out, "<availability><licence$target>$(xesc(text))</licence></availability>")
    end
    push!(out, "</publicationStmt>", "<sourceDesc>", "<bibl>", "<title>$(xesc(something(get(m, "title", nothing), export_title(doc))))</title>")
    for p in something(get(m, "author", nothing), Any[])
        name = tei_person(p)
        isempty(name) || push!(out, "<author>$(xesc(name))</author>")
    end
    for (csl, open_, close_) in (("container-title", "title level=\"m\"", "title"), ("publisher-place", "pubPlace", "pubPlace"),
                                 ("publisher", "publisher", "publisher"), ("edition", "edition", "edition"), ("collection-title", "series", "series"))
        v = get(m, csl, nothing)
        (v === nothing || v isa AbstractDict || v isa AbstractVector || string(v) == "") || push!(out, "<$open_>$(xesc(v))</$close_>")
    end
    issued = get(m, "issued", nothing)
    dp = issued isa AbstractDict ? get(issued, "date-parts", nothing) : nothing
    if dp isa AbstractVector && !isempty(dp) && dp[1] isa AbstractVector && !isempty(dp[1])
        w = join([i == 1 ? @sprintf("%04d", parse_int_like(x)) : @sprintf("%02d", parse_int_like(x)) for (i, x) in enumerate(dp[1])], "-")
        push!(out, "<date when=\"$w\">$w</date>")
    end
    for (csl, typ) in (("DOI", "DOI"), ("ISBN", "ISBN"), ("URL", "URI"))
        v = get(m, csl, nothing)
        (v === nothing || string(v) == "") || push!(out, "<idno type=\"$typ\">$(xesc(v))</idno>")
    end
    push!(out, "</bibl>", "</sourceDesc>", "</fileDesc>")
    lang === nothing || push!(out, "<profileDesc><langUsage><language ident=\"$(xesc(lang))\"/></langUsage></profileDesc>")
    push!(out, "</teiHeader>", "<text>", "<body>")
    for u in units(doc)
        append!(out, tei_unit(u))
    end
    push!(out, "</body>", "</text>", "</TEI>")
    return join(out, "\n") * "\n"
end

parse_int_like(x) = x isa Real ? trunc(Int, x) : parse(Int, strip(string(x)))

"""
    iiif(doc, base_url) -> Dict

A IIIF Presentation 3 manifest (ready for JSON): one canvas per unit (or one time-based
canvas for audio and video), the text as `supplementing` annotations, figures as
`describing` annotations on their region and sections as ranges.
"""
function iiif(doc::Document, base_url::AbstractString)
    base = rstrip(base_url, '/')
    d = document(doc)
    m = metadata(doc)
    lang = get(d, "language", nothing) isa AbstractString && !isempty(d["language"]) ? d["language"] : "none"
    ttl = export_title(doc)
    urlof(ref) = ref isa AbstractString && !isempty(ref) ?
        (startswith(ref, "blob:") ? "$base/blobs/$(enc(ref[6:end]))" : (occursin(r"^https?://", ref) ? ref : nothing)) : nothing
    manifest = Dict{String,Any}("@context" => IIIF_CONTEXT, "id" => "$base/manifest.json", "type" => "Manifest",
        "label" => Dict(lang => [ttl]))
    md = [("Author", get(d, "authors", nothing)), ("Date", get(d, "year", nothing)), ("Publisher", get(m, "publisher", nothing)),
          ("Place", get(m, "publisher-place", nothing)), ("Language", get(d, "language", nothing)), ("SPDF", "spdf:" * docref(doc))]
    manifest["metadata"] = [Dict("label" => Dict("en" => [k]), "value" => Dict("none" => [string(v)])) for (k, v) in md if v !== nothing && v != ""]
    get(m, "abstract", nothing) isa AbstractString && (manifest["summary"] = Dict(lang => [m["abstract"]]))
    us = units(doc)
    figs = figures(doc)
    textanno(u, aid, target) = Dict{String,Any}("id" => aid, "type" => "Annotation", "motivation" => "supplementing",
        "body" => Dict("type" => "TextualBody", "value" => string(something(get(u, "text", nothing), "")), "format" => "text/markdown", "language" => lang),
        "target" => target, "seeAlso" => [Dict("id" => anchor_uri(doc, u["anchor"]), "type" => "Text", "format" => "text/plain")])
    canvas_of = Dict{String,String}()
    canvases = Any[]
    if d["kind"] in ("audio", "video")
        cid = "$base/canvas/1"
        duration = Float64(something(get(d, "duration", nothing), 0.0))
        duration > 0 || (duration = maximum([1.0; [Float64(something(get(u, "t1", nothing), 0.0)) for u in us]]))
        canvas = Dict{String,Any}("id" => cid, "type" => "Canvas", "label" => Dict(lang => [ttl]), "duration" => duration, "items" => Any[])
        media = urlof(get(d, "source_ref", nothing))
        if media !== nothing
            canvas["items"] = [Dict("id" => "$cid/page/1", "type" => "AnnotationPage", "items" => [Dict(
                "id" => "$cid/page/1/a1", "type" => "Annotation", "motivation" => "painting",
                "body" => Dict("id" => media, "type" => d["kind"] == "audio" ? "Sound" : "Video", "format" => d["mime"], "duration" => duration),
                "target" => cid)])]
        end
        annos = Any[]
        for u in us
            canvas_of[string(u["id"])] = cid
            isempty(strip(string(something(get(u, "text", nothing), "")))) && continue
            t0 = something(get(u, "t0", nothing), get(u["anchor"], "t0", nothing), Some(nothing))
            t1 = something(get(u, "t1", nothing), get(u["anchor"], "t1", nothing), t0, Some(nothing))
            target = t0 === nothing ? cid : "$cid#t=$(json_number(Float64(t0))),$(json_number(Float64(t1)))"
            push!(annos, textanno(u, "$cid/annotations/$(u["ord"])", target))
        end
        isempty(annos) || (canvas["annotations"] = [Dict("id" => "$cid/annotations", "type" => "AnnotationPage", "items" => annos)])
        push!(canvases, canvas)
    else
        for u in us
            cid = "$base/canvas/$(u["ord"])"
            canvas_of[string(u["id"])] = cid
            a = u["anchor"] isa AbstractDict ? u["anchor"] : Dict{String,Any}()
            w, h = DEFAULT_SIZE
            canvas = Dict{String,Any}("id" => cid, "type" => "Canvas")
            lab = get(a, "type", nothing) == "page" ? page_folio(a) : something(cite_locator(a, nothing, lang == "es"), string(u["ord"]))
            lab === nothing || (canvas["label"] = Dict("none" => [lab]))
            canvas["width"] = w
            canvas["height"] = h
            img = urlof(get(u, "image", nothing))
            pageitems = img === nothing ? Any[] : Any[Dict("id" => "$cid/page/1/a1", "type" => "Annotation", "motivation" => "painting",
                "body" => Dict("id" => img, "type" => "Image", "width" => w, "height" => h), "target" => cid)]
            canvas["items"] = [Dict("id" => "$cid/page/1", "type" => "AnnotationPage", "items" => pageitems)]
            annos = Any[]
            isempty(strip(string(something(get(u, "text", nothing), "")))) || push!(annos, textanno(u, "$cid/annotations/text", cid))
            for (i, g) in enumerate(filter(g -> g["unit"] == u["id"], figs))
                r = g["anchor"] isa AbstractDict ? get(g["anchor"], "region", nothing) : nothing
                target = r isa AbstractDict ? "$cid#xywh=percent:" * join([json_number(parse(Float64, @sprintf("%.4f", Float64(get(r, k, 0)) * 100))) for k in ("x", "y", "w", "h")], ",") : cid
                desc = strip(join(filter(!isnothing, [get(g, "caption", nothing), get(g, "description", nothing)]), " "))
                isempty(desc) && continue
                push!(annos, Dict("id" => "$cid/annotations/figure/$i", "type" => "Annotation", "motivation" => "describing",
                    "body" => Dict("type" => "TextualBody", "value" => desc, "format" => "text/plain", "language" => lang), "target" => target))
            end
            isempty(annos) || (canvas["annotations"] = [Dict("id" => "$cid/annotations", "type" => "AnnotationPage", "items" => annos)])
            push!(canvases, canvas)
        end
    end
    manifest["items"] = canvases
    ranges = iiif_ranges(doc, base, canvas_of, us, lang)
    isempty(ranges) || (manifest["structures"] = ranges)
    return manifest
end

function iiif_ranges(doc, base, canvas_of, us, lang)
    secs = sections(doc)
    isempty(secs) && return Any[]
    ord = Dict(string(u["id"]) => Int(u["ord"]) for u in us)
    ids = Set(string(s["id"]) for s in secs)
    parentof(s) = get(s, "parent", nothing) !== nothing && string(s["parent"]) in ids ? string(s["parent"]) : ""
    sorted(list) = sort(list; by = s -> (get(ord, string(s["unit_from"]), 0), string(s["id"])))
    function build(s)
        items = Any[build(c) for c in sorted([c for c in secs if parentof(c) == string(s["id"])])]
        start = get(ord, string(s["unit_from"]), nothing)
        fin = get(s, "unit_to", nothing) === nothing ? start : get(ord, string(s["unit_to"]), start)
        if isempty(items) && start !== nothing
            seen = Set{String}()
            for u in us
                cid = get(canvas_of, string(u["id"]), nothing)
                if start <= u["ord"] <= fin && cid !== nothing && !(cid in seen)
                    push!(seen, cid)
                    push!(items, Dict("id" => cid, "type" => "Canvas"))
                end
            end
        end
        return Dict{String,Any}("id" => "$base/range/$(enc(string(s["id"])))", "type" => "Range", "label" => Dict(lang => [string(s["title"])]), "items" => items)
    end
    return Any[build(s) for s in sorted([s for s in secs if parentof(s) == ""])]
end
