# Legacy SPDF 4.x (Scholaris, Spanish identifiers) seen through the 5.0 view (section 7).

legacy_tables <- list(
  spdf_meta = list("spdf", c(key = "clave", value = "valor")),
  documents = list("documentos", c(
    id = "id", kind = "tipo", metadata = "metadatos", source_sha256 = "huella", source_ref = "original",
    mime = "mime", bytes = "bytes", unit_count = "unidades", duration = "duracion", created = "creado",
    updated = "actualizado", title = "titulo", authors = "autores", year = "anio", language = "idioma", rights = NA
  )),
  units = list("unidades", c(
    id = "id", document = "documento", ord = "orden", anchor = "ancla", text = "texto", notes = "notas",
    header = "cabecera", footer = "pie", image = "imagen", thumbnail = "miniatura", reader = "lector",
    confidence = "confianza", printed = "impresa", t0 = "t0", t1 = "t1", words = "palabras"
  )),
  sections = list("secciones", c(
    id = "id", document = "documento", parent = "padre", level = "nivel", title = "titulo",
    unit_from = "unidad_desde", unit_to = "unidad_hasta", summary = "resumen"
  )),
  fragments = list("fragmentos", c(
    n = "n", id = "id", document = "documento", unit = "unidad", ord = "orden", text = "texto",
    context = "contexto", section = "seccion", anchor = "ancla", anchor_end = "ancla_fin",
    search_text = "texto_busqueda"
  )),
  figures = list("figuras", c(
    id = "id", document = "documento", unit = "unidad", image = "imagen", caption = "pie",
    description = "descripcion", anchor = "ancla"
  )),
  spaces = list("espacios", c(
    id = "id", provider = "proveedor", model = "modelo", version = "version", dims = "dims", dtype = NA,
    normalized = "normalizado", truncated_from = NA, modalities = "modalidades", task_prefixes = NA,
    created = "creado"
  )),
  vectors = list("vectores", c(target = "objetivo", id = "id", space = "espacio", document = "documento", data = "valores")),
  blobs = list("blobs", c(key = "clave", mime = "mime", sha256 = NA, data = "datos")),
  provenance = list("procedencia", c(
    document = "documento", stage = "fase", provider = "proveedor", model = NA, detail = "detalle",
    ms = "ms", at = "cuando"
  )),
  extensions = list(NA, c(name = NA, version = NA, required = NA))
)

legacy_defaults <- c(spaces.dtype = "'f32'")
legacy_kinds <- c(
  pdf_escaneado = "scanned_pdf", fotos = "photos", imagen = "image", documento = "document",
  presentacion = "slides", hoja = "sheet"
)
legacy_targets <- c(fragmento = "fragment", unidad = "unit", figura = "figure")
legacy_anchor_types <- c(
  pagina = "page", tiempo = "time", seccion = "section", diapositiva = "slide", hoja = "sheet",
  web = "web", imagen = "image"
)
legacy_anchor_keys <- c(
  tipo = "type", fisica = "physical", impresa = "printed", romana = "roman", origen = "source",
  confianza = "confidence", hablante = "speaker", ruta = "path", parrafo = "paragraph", hoja = "sheet",
  filaDesde = "row_from", filaHasta = "row_to", consultada = "accessed"
)
legacy_sources <- c(leido = "read", deducido = "inferred", ninguno = "none")
legacy_modalities <- c(texto = "text", imagen = "image")
legacy_meta_keys <- c(creado = "created", generador = "generator")
legacy_fields <- c(
  titulo = "title", subtitulo = "spdf.subtitle", tituloOriginal = "original-title", autores = "author",
  editores = "editor", traductores = "translator", entrevistadores = "interviewer", anio = "issued",
  anioOriginal = "original-date", editorial = "publisher", lugar = "publisher-place",
  revista = "container-title", contenedor = "container-title", coleccion = "collection-title",
  volumen = "volume", numero = "issue", paginas = "page", edicion = "edition", doi = "DOI", isbn = "ISBN",
  url = "URL", idioma = "language", tipoCSL = "type", resumen = "abstract",
  idiomaOriginal = "spdf.original_language", fecha = "issued", sinFecha = "spdf.undated"
)
legacy_provenance_sources <- c(lectura = "reading", usuario = "user", colofon = "colophon", impresores = "printers")
legacy_simple <- c(
  editorial = "publisher", lugar = "publisher-place", coleccion = "collection-title", volumen = "volume",
  numero = "issue", paginas = "page", edicion = "edition", doi = "DOI", isbn = "ISBN", url = "URL",
  idioma = "language", resumen = "abstract"
)
legacy_people <- c(autores = "author", editores = "editor", traductores = "translator", entrevistadores = "interviewer")
legacy_type_by_kind <- c(
  audio = "speech", video = "motion_picture", web = "webpage", presentacion = "speech", hoja = "dataset",
  imagen = "graphic", fotos = "graphic"
)

map_value <- function(table, x) {
  if (is.null(x) || !is.character(x) || length(x) != 1) {
    return(x)
  }
  if (!is.na(table[x])) unname(table[x]) else x
}

legacy_column <- function(table, col) {
  v <- legacy_tables[[table]][[2]][col]
  if (is.na(v)) NULL else unname(v)
}

legacy_reference <- function(value, blob_keys, keep_empty = FALSE) {
  if (is.null(value)) {
    return(NULL)
  }
  if (identical(value, "")) {
    return(if (keep_empty) "" else NULL)
  }
  if (value %in% blob_keys) {
    return(paste0("blob:", value))
  }
  value
}

legacy_anchor <- function(a) {
  if (!json_is_object(a)) {
    return(a)
  }
  keys <- names(a)
  out <- list()
  for (i in seq_along(a)) {
    k <- keys[i]
    v <- a[[i]]
    if (k == "tipo") v <- map_value(legacy_anchor_types, v)
    if (k == "origen") v <- map_value(legacy_sources, v)
    out[i] <- list(v)
    names(out)[i] <- map_value(legacy_anchor_keys, k)
  }
  json_object(out)
}

# Python-like truthiness (the reference oracle is written in Python).
truthy <- function(v) {
  !(is.null(v) || identical(v, FALSE) || identical(v, "") || (is.numeric(v) && length(v) == 1 && v == 0) ||
    (is.list(v) && length(v) == 0))
}

has_field <- function(m, k) {
  k %in% names(m) && !is.null(m[[k]]) && !identical(m[[k]], "") && !(is.list(m[[k]]) && length(m[[k]]) == 0)
}

legacy_names <- function(people) {
  out <- list()
  if (!is.list(people) || !is.null(names(people))) {
    return(out)
  }
  for (p in people) {
    if (!json_is_object(p)) next
    n <- list()
    if (truthy(p[["apellidos"]])) n$family <- p[["apellidos"]]
    if (truthy(p[["nombre"]])) n$given <- p[["nombre"]]
    if (length(n) > 0) out[[length(out) + 1]] <- n
  }
  out
}

legacy_default_type <- function(tipo, m) {
  if (truthy(m[["tipoCSL"]])) {
    return(m[["tipoCSL"]])
  }
  if (truthy(m[["revista"]])) {
    return("article-journal")
  }
  t <- if (is.null(tipo)) NA else legacy_type_by_kind[tipo]
  if (is.na(t)) "book" else unname(t)
}

legacy_date_parts <- function(iso) {
  m <- regmatches(trimws(iso), regexec("^(-?[0-9]{1,4})(?:-([0-9]{1,2})(?:-([0-9]{1,2}))?)?", trimws(iso), perl = TRUE))[[1]]
  if (length(m) == 0) {
    return(NULL)
  }
  parts <- m[-1]
  as.list(as.integer(parts[parts != ""]))
}

# MetadatosDocumento (Scholaris 4.x) => CSL-JSON item + "spdf" extension object.
legacy_metadata <- function(m, tipo = NULL) {
  if (!json_is_object(m)) {
    return(m)
  }
  item <- list(type = legacy_default_type(tipo, m))
  ext <- list()
  title <- if (truthy(m[["titulo"]])) as.character(m[["titulo"]]) else ""
  if (has_field(m, "subtitulo")) {
    item$title <- paste0(title, ": ", m[["subtitulo"]])
    item[["title-short"]] <- title
    ext$subtitle <- m[["subtitulo"]]
  } else {
    item$title <- title
  }
  if (has_field(m, "tituloOriginal")) item[["original-title"]] <- m[["tituloOriginal"]]
  orcid <- list()
  for (src in names(legacy_people)) {
    names_ <- legacy_names(m[[src]])
    if (length(names_) > 0) item[[legacy_people[[src]]]] <- names_
    if (is.list(m[[src]])) {
      for (a in m[[src]]) {
        if (json_is_object(a) && truthy(a[["orcid"]])) {
          key <- paste0(a[["apellidos"]] %||% "", if (truthy(a[["nombre"]])) paste0(", ", a[["nombre"]]) else "")
          orcid[[key]] <- a[["orcid"]]
        }
      }
    }
  }
  fecha <- if (has_field(m, "fecha") && is.character(m[["fecha"]])) legacy_date_parts(m[["fecha"]]) else NULL
  if (!is.null(fecha) && (!has_field(m, "anio") || isTRUE(fecha[[1]] == m[["anio"]]))) {
    item$issued <- list("date-parts" = list(fecha))
  } else if (has_field(m, "anio")) {
    item$issued <- list("date-parts" = list(list(m[["anio"]])))
  }
  if (has_field(m, "anioOriginal")) item[["original-date"]] <- list("date-parts" = list(list(m[["anioOriginal"]])))
  for (src in names(legacy_simple)) {
    if (has_field(m, src)) item[[legacy_simple[[src]]]] <- m[[src]]
  }
  if (has_field(m, "revista")) {
    item[["container-title"]] <- m[["revista"]]
  } else if (has_field(m, "contenedor")) {
    item[["container-title"]] <- m[["contenedor"]]
  }
  if (has_field(m, "idiomaOriginal")) ext$original_language <- m[["idiomaOriginal"]]
  if (has_field(m, "sinFecha") && json_is_object(m[["sinFecha"]])) {
    sf <- m[["sinFecha"]]
    u <- list()
    if (!is.null(sf[["desde"]])) u$from <- sf[["desde"]]
    if (!is.null(sf[["hasta"]])) u$to <- sf[["hasta"]]
    if (truthy(sf[["fundamento"]])) u$basis <- sf[["fundamento"]]
    ext$undated <- json_object(u)
  }
  if (has_field(m, "procedencia") && json_is_object(m[["procedencia"]])) {
    prov <- list()
    for (campo in names(m[["procedencia"]])) {
      v <- m[["procedencia"]][[campo]]
      if (!json_is_object(v)) v <- list()
      key <- sub("^spdf\\.", "", map_value(legacy_fields, campo))
      fuente <- v[["fuente"]]
      prov[[key]] <- list(source = map_value(legacy_provenance_sources, fuente), confidence = v[["confianza"]])
      if (is.null(fuente)) prov[[key]]["source"] <- list(NULL)
      if (is.null(v[["confianza"]])) prov[[key]]["confidence"] <- list(NULL)
    }
    ext$provenance <- json_object(prov)
  }
  if (length(orcid) > 0) ext$orcid <- orcid
  if (length(ext) > 0) item$spdf <- ext
  item
}
