# Legacy SPDF 4.x (Scholaris, Spanish identifiers) seen through the 5.0 view (section 7).

const LEGACY_TABLES = Dict(
    "spdf_meta" => ("spdf", Dict("key" => "clave", "value" => "valor")),
    "documents" => ("documentos", Dict("id" => "id", "kind" => "tipo", "metadata" => "metadatos",
        "source_sha256" => "huella", "source_ref" => "original", "mime" => "mime", "bytes" => "bytes",
        "unit_count" => "unidades", "duration" => "duracion", "created" => "creado", "updated" => "actualizado",
        "title" => "titulo", "authors" => "autores", "year" => "anio", "language" => "idioma")),
    "units" => ("unidades", Dict("id" => "id", "document" => "documento", "ord" => "orden", "anchor" => "ancla",
        "text" => "texto", "notes" => "notas", "header" => "cabecera", "footer" => "pie", "image" => "imagen",
        "thumbnail" => "miniatura", "reader" => "lector", "confidence" => "confianza", "printed" => "impresa",
        "t0" => "t0", "t1" => "t1", "words" => "palabras")),
    "sections" => ("secciones", Dict("id" => "id", "document" => "documento", "parent" => "padre", "level" => "nivel",
        "title" => "titulo", "unit_from" => "unidad_desde", "unit_to" => "unidad_hasta", "summary" => "resumen")),
    "fragments" => ("fragmentos", Dict("n" => "n", "id" => "id", "document" => "documento", "unit" => "unidad",
        "ord" => "orden", "text" => "texto", "context" => "contexto", "section" => "seccion", "anchor" => "ancla",
        "anchor_end" => "ancla_fin", "search_text" => "texto_busqueda")),
    "figures" => ("figuras", Dict("id" => "id", "document" => "documento", "unit" => "unidad", "image" => "imagen",
        "caption" => "pie", "description" => "descripcion", "anchor" => "ancla")),
    "spaces" => ("espacios", Dict("id" => "id", "provider" => "proveedor", "model" => "modelo", "version" => "version",
        "dims" => "dims", "normalized" => "normalizado", "modalities" => "modalidades", "created" => "creado")),
    "vectors" => ("vectores", Dict("target" => "objetivo", "id" => "id", "space" => "espacio", "document" => "documento",
        "data" => "valores")),
    "blobs" => ("blobs", Dict("key" => "clave", "mime" => "mime", "data" => "datos")),
    "provenance" => ("procedencia", Dict("document" => "documento", "stage" => "fase", "provider" => "proveedor",
        "detail" => "detalle", "ms" => "ms", "at" => "cuando")),
)
const LEGACY_DEFAULTS = Dict("spaces.dtype" => "'f32'")
const LEGACY_KINDS = Dict("pdf_escaneado" => "scanned_pdf", "fotos" => "photos", "imagen" => "image",
    "documento" => "document", "presentacion" => "slides", "hoja" => "sheet")
const LEGACY_TARGETS = Dict("fragmento" => "fragment", "unidad" => "unit", "figura" => "figure")
const LEGACY_ANCHOR_TYPES = Dict("pagina" => "page", "tiempo" => "time", "seccion" => "section",
    "diapositiva" => "slide", "hoja" => "sheet", "web" => "web", "imagen" => "image")
const LEGACY_ANCHOR_KEYS = Dict("tipo" => "type", "fisica" => "physical", "impresa" => "printed", "romana" => "roman",
    "origen" => "source", "confianza" => "confidence", "hablante" => "speaker", "ruta" => "path",
    "parrafo" => "paragraph", "hoja" => "sheet", "filaDesde" => "row_from", "filaHasta" => "row_to",
    "consultada" => "accessed")
const LEGACY_SOURCES = Dict("leido" => "read", "deducido" => "inferred", "ninguno" => "none")
const LEGACY_MODALITIES = Dict("texto" => "text", "imagen" => "image")
const LEGACY_META_KEYS = Dict("creado" => "created", "generador" => "generator")
const LEGACY_FIELDS = Dict("titulo" => "title", "subtitulo" => "spdf.subtitle", "tituloOriginal" => "original-title",
    "autores" => "author", "editores" => "editor", "traductores" => "translator", "entrevistadores" => "interviewer",
    "anio" => "issued", "anioOriginal" => "original-date", "editorial" => "publisher", "lugar" => "publisher-place",
    "revista" => "container-title", "contenedor" => "container-title", "coleccion" => "collection-title",
    "volumen" => "volume", "numero" => "issue", "paginas" => "page", "edicion" => "edition", "doi" => "DOI",
    "isbn" => "ISBN", "url" => "URL", "idioma" => "language", "tipoCSL" => "type", "resumen" => "abstract",
    "idiomaOriginal" => "spdf.original_language", "fecha" => "issued", "sinFecha" => "spdf.undated")
const LEGACY_PROVENANCE_SOURCES = Dict("lectura" => "reading", "usuario" => "user", "colofon" => "colophon",
    "impresores" => "printers")
const LEGACY_SIMPLE = [("editorial", "publisher"), ("lugar", "publisher-place"), ("coleccion", "collection-title"),
    ("volumen", "volume"), ("numero", "issue"), ("paginas", "page"), ("edicion", "edition"), ("doi", "DOI"),
    ("isbn", "ISBN"), ("url", "URL"), ("idioma", "language"), ("resumen", "abstract")]
const LEGACY_PEOPLE = [("autores", "author"), ("editores", "editor"), ("traductores", "translator"),
    ("entrevistadores", "interviewer")]
const LEGACY_TYPE_BY_KIND = Dict("audio" => "speech", "video" => "motion_picture", "web" => "webpage",
    "presentacion" => "speech", "hoja" => "dataset", "imagen" => "graphic", "fotos" => "graphic")

legacy_column(table, col) = get(LEGACY_TABLES[table][2], col, nothing)
mapval(d, v) = v isa AbstractString ? get(d, v, v) : v

function legacy_reference(v, blob_keys; keep_empty = false)
    v === nothing && return nothing
    v == "" && return keep_empty ? "" : nothing
    v in blob_keys && return "blob:" * v
    return v
end

function legacy_anchor(a)
    a isa AbstractDict || return a
    out = Dict{String,Any}()
    for (k, v) in a
        k == "tipo" && (v = mapval(LEGACY_ANCHOR_TYPES, v))
        k == "origen" && (v = mapval(LEGACY_SOURCES, v))
        out[get(LEGACY_ANCHOR_KEYS, k, k)] = v
    end
    return out
end

"Python-like truthiness (the reference oracle is written in Python)."
truthy(v) = !(v === nothing || v === false || v == "" || (v isa Number && !(v isa Bool) && v == 0) ||
              (v isa AbstractVector && isempty(v)) || (v isa AbstractDict && isempty(v)))
has(m, k) = haskey(m, k) && m[k] !== nothing && m[k] != "" && !(m[k] isa AbstractVector && isempty(m[k]))

function legacy_people(list)
    out = Any[]
    list isa AbstractVector || return out
    for p in list
        p isa AbstractDict || continue
        n = Dict{String,Any}()
        truthy(get(p, "apellidos", nothing)) && (n["family"] = p["apellidos"])
        truthy(get(p, "nombre", nothing)) && (n["given"] = p["nombre"])
        isempty(n) || push!(out, n)
    end
    return out
end

function legacy_default_type(tipo, m)
    truthy(get(m, "tipoCSL", nothing)) && return m["tipoCSL"]
    truthy(get(m, "revista", nothing)) && return "article-journal"
    return get(LEGACY_TYPE_BY_KIND, something(tipo, ""), "book")
end

function legacy_date_parts(iso::AbstractString)
    m = match(r"^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?", strip(iso))
    m === nothing && return nothing
    return Any[parse(Int, c) for c in m.captures if c !== nothing]
end

"MetadatosDocumento (Scholaris 4.x) => CSL-JSON item + `spdf` extension object."
function legacy_metadata(m, tipo)
    m isa AbstractDict || return m
    item = Dict{String,Any}("type" => legacy_default_type(tipo, m))
    ext = Dict{String,Any}()
    title = truthy(get(m, "titulo", nothing)) ? string(m["titulo"]) : ""
    if has(m, "subtitulo")
        item["title"] = title * ": " * string(m["subtitulo"])
        item["title-short"] = title
        ext["subtitle"] = m["subtitulo"]
    else
        item["title"] = title
    end
    has(m, "tituloOriginal") && (item["original-title"] = m["tituloOriginal"])
    orcid = Dict{String,Any}()
    for (src, dst) in LEGACY_PEOPLE
        names = legacy_people(get(m, src, nothing))
        isempty(names) || (item[dst] = names)
        list = get(m, src, nothing)
        list isa AbstractVector || continue
        for a in list
            if a isa AbstractDict && truthy(get(a, "orcid", nothing))
                key = string(get(a, "apellidos", "")) * (truthy(get(a, "nombre", nothing)) ? ", " * string(a["nombre"]) : "")
                orcid[key] = a["orcid"]
            end
        end
    end
    fecha = has(m, "fecha") && m["fecha"] isa AbstractString ? legacy_date_parts(m["fecha"]) : nothing
    if fecha !== nothing && (!has(m, "anio") || fecha[1] == m["anio"])
        item["issued"] = Dict{String,Any}("date-parts" => Any[fecha])
    elseif has(m, "anio")
        item["issued"] = Dict{String,Any}("date-parts" => Any[Any[m["anio"]]])
    end
    has(m, "anioOriginal") && (item["original-date"] = Dict{String,Any}("date-parts" => Any[Any[m["anioOriginal"]]]))
    for (src, dst) in LEGACY_SIMPLE
        has(m, src) && (item[dst] = m[src])
    end
    if has(m, "revista")
        item["container-title"] = m["revista"]
    elseif has(m, "contenedor")
        item["container-title"] = m["contenedor"]
    end
    has(m, "idiomaOriginal") && (ext["original_language"] = m["idiomaOriginal"])
    if has(m, "sinFecha") && m["sinFecha"] isa AbstractDict
        sf = m["sinFecha"]
        u = Dict{String,Any}()
        get(sf, "desde", nothing) !== nothing && (u["from"] = sf["desde"])
        get(sf, "hasta", nothing) !== nothing && (u["to"] = sf["hasta"])
        truthy(get(sf, "fundamento", nothing)) && (u["basis"] = sf["fundamento"])
        ext["undated"] = u
    end
    if has(m, "procedencia") && m["procedencia"] isa AbstractDict
        prov = Dict{String,Any}()
        for (campo, v) in m["procedencia"]
            key = get(LEGACY_FIELDS, campo, campo)
            startswith(key, "spdf.") && (key = key[6:end])
            v = v isa AbstractDict ? v : Dict{String,Any}()
            prov[key] = Dict{String,Any}("source" => mapval(LEGACY_PROVENANCE_SOURCES, get(v, "fuente", nothing)),
                "confidence" => get(v, "confianza", nothing))
        end
        ext["provenance"] = prov
    end
    isempty(orcid) || (ext["orcid"] = orcid)
    isempty(ext) || (item["spdf"] = ext)
    return item
end
