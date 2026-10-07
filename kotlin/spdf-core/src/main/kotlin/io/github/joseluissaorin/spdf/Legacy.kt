package io.github.joseluissaorin.spdf

/** The legacy 4.0 / 4.1 (Scholaris, Spanish schema) → 5.0 view (SPEC §20, CONTRACT §7). */
internal object Legacy {
    val TABLES: Map<String, String> = mapOf(
        "spdf_meta" to "spdf", "documents" to "documentos", "units" to "unidades", "sections" to "secciones",
        "fragments" to "fragmentos", "fragments_fts" to "fragmentos_fts", "figures" to "figuras", "spaces" to "espacios",
        "vectors" to "vectores", "blobs" to "blobs", "provenance" to "procedencia",
    )

    /** Legacy column per 5.0 column; "" = absent in 4.x (NULL or a default from [DEFAULTS]). */
    val COLUMNS: Map<String, Map<String, String>> = mapOf(
        "spdf_meta" to mapOf("key" to "clave", "value" to "valor"),
        "documents" to mapOf(
            "id" to "id", "kind" to "tipo", "metadata" to "metadatos", "source_sha256" to "huella", "source_ref" to "original",
            "mime" to "mime", "bytes" to "bytes", "unit_count" to "unidades", "duration" to "duracion", "created" to "creado",
            "updated" to "actualizado", "title" to "titulo", "authors" to "autores", "year" to "anio", "language" to "idioma",
            "rights" to "",
        ),
        "units" to mapOf(
            "id" to "id", "document" to "documento", "ord" to "orden", "anchor" to "ancla", "text" to "texto", "notes" to "notas",
            "header" to "cabecera", "footer" to "pie", "image" to "imagen", "thumbnail" to "miniatura", "reader" to "lector",
            "confidence" to "confianza", "printed" to "impresa", "t0" to "t0", "t1" to "t1", "words" to "palabras",
        ),
        "sections" to mapOf(
            "id" to "id", "document" to "documento", "parent" to "padre", "level" to "nivel", "title" to "titulo",
            "unit_from" to "unidad_desde", "unit_to" to "unidad_hasta", "summary" to "resumen",
        ),
        "fragments" to mapOf(
            "n" to "n", "id" to "id", "document" to "documento", "unit" to "unidad", "ord" to "orden", "text" to "texto",
            "context" to "contexto", "section" to "seccion", "anchor" to "ancla", "anchor_end" to "ancla_fin",
            "search_text" to "texto_busqueda",
        ),
        "figures" to mapOf(
            "id" to "id", "document" to "documento", "unit" to "unidad", "image" to "imagen", "caption" to "pie",
            "description" to "descripcion", "anchor" to "ancla",
        ),
        "spaces" to mapOf(
            "id" to "id", "provider" to "proveedor", "model" to "modelo", "version" to "version", "dims" to "dims",
            "dtype" to "", "normalized" to "normalizado", "truncated_from" to "", "modalities" to "modalidades",
            "task_prefixes" to "", "created" to "creado",
        ),
        "vectors" to mapOf("target" to "objetivo", "id" to "id", "space" to "espacio", "document" to "documento", "data" to "valores"),
        "blobs" to mapOf("key" to "clave", "mime" to "mime", "sha256" to "", "data" to "datos"),
        "provenance" to mapOf(
            "document" to "documento", "stage" to "fase", "provider" to "proveedor", "model" to "", "detail" to "detalle",
            "ms" to "ms", "at" to "cuando",
        ),
    )

    /** SQL literals for 5.0 columns absent from 4.x that have a defined value. */
    val DEFAULTS: Map<String, String> = mapOf("spaces.dtype" to "'f32'")

    val TRIGGERS: Set<String> = setOf("fragmentos_ai", "fragmentos_ad", "fragmentos_au")

    val KINDS: Map<String, String> = mapOf(
        "pdf" to "pdf", "pdf_escaneado" to "scanned_pdf", "fotos" to "photos", "imagen" to "image", "audio" to "audio",
        "video" to "video", "documento" to "document", "epub" to "epub", "presentacion" to "slides", "hoja" to "sheet", "web" to "web",
    )
    private val ANCHOR_TYPES = mapOf(
        "pagina" to "page", "tiempo" to "time", "seccion" to "section", "diapositiva" to "slide", "hoja" to "sheet",
        "web" to "web", "imagen" to "image",
    )
    private val ANCHOR_KEYS = mapOf(
        "tipo" to "type", "fisica" to "physical", "impresa" to "printed", "romana" to "roman", "origen" to "source",
        "confianza" to "confidence", "hablante" to "speaker", "ruta" to "path", "parrafo" to "paragraph", "n" to "n",
        "hoja" to "sheet", "filaDesde" to "row_from", "filaHasta" to "row_to", "consultada" to "accessed", "region" to "region",
    )
    private val SOURCES = mapOf("leido" to "read", "deducido" to "inferred", "epub" to "epub", "ninguno" to "none")
    val TARGETS: Map<String, String> = mapOf("fragmento" to "fragment", "unidad" to "unit", "figura" to "figure")
    val MODALITIES: Map<String, String> = mapOf("texto" to "text", "imagen" to "image", "audio" to "audio", "video" to "video", "pdf" to "pdf")
    val META_KEYS: Map<String, String> = mapOf("creado" to "created", "generador" to "generator")
    private val FIELDS = mapOf(
        "titulo" to "title", "subtitulo" to "spdf.subtitle", "tituloOriginal" to "original-title", "autores" to "author",
        "editores" to "editor", "traductores" to "translator", "entrevistadores" to "interviewer", "anio" to "issued",
        "anioOriginal" to "original-date", "editorial" to "publisher", "lugar" to "publisher-place",
        "revista" to "container-title", "contenedor" to "container-title", "coleccion" to "collection-title",
        "volumen" to "volume", "numero" to "issue", "paginas" to "page", "edicion" to "edition", "doi" to "DOI",
        "isbn" to "ISBN", "url" to "URL", "idioma" to "language", "tipoCSL" to "type", "resumen" to "abstract",
        "idiomaOriginal" to "spdf.original_language", "fecha" to "issued", "sinFecha" to "spdf.undated",
    )
    private val PROVENANCE_SOURCES = mapOf("lectura" to "reading", "usuario" to "user", "colofon" to "colophon", "impresores" to "printers")
    private val DEFAULT_TYPES = mapOf(
        "audio" to "speech", "video" to "motion_picture", "web" to "webpage", "presentacion" to "speech",
        "hoja" to "dataset", "imagen" to "graphic", "fotos" to "graphic",
    )
    private val DATE = Regex("^(-?\\d{1,4})(?:-(\\d{1,2})(?:-(\\d{1,2}))?)?")

    /** A legacy (Spanish) anchor object in 5.0 terms; unknown members are kept verbatim. */
    fun anchor(v: Any?): Any? {
        val a = asMap(v) ?: return v
        val out = LinkedHashMap<String, Any?>()
        for ((k, value) in a) {
            val key = ANCHOR_KEYS[k] ?: k
            val mapped = when (k) {
                "tipo" -> (value as? String)?.let { ANCHOR_TYPES[it] } ?: value
                "origen" -> (value as? String)?.let { SOURCES[it] } ?: value
                else -> value
            }
            out[key] = mapped
        }
        return out
    }

    /** A legacy storage reference: '' → null ('' kept for figures), a blob key → `blob:<key>`. */
    fun ref(v: Any?, blobKeys: Set<String>, keepEmpty: Boolean = false): Any? {
        if (v == null) return null
        if (v == "") return if (keepEmpty) "" else null
        if (v is String && v in blobKeys) return "blob:$v"
        return v
    }

    private fun has(m: Map<String, Any?>, k: String): Boolean {
        val v = m[k] ?: return false
        return !(v == "" || (v is List<*> && v.isEmpty()))
    }

    private fun names(people: Any?): List<Map<String, Any?>> {
        val out = ArrayList<Map<String, Any?>>()
        for (p in asList(people)?.takeIf { truthy(it) } ?: emptyList()) {
            val a = asMap(p) ?: continue
            val n = LinkedHashMap<String, Any?>()
            if (truthy(a["apellidos"])) n["family"] = a["apellidos"]
            if (truthy(a["nombre"])) n["given"] = a["nombre"]
            if (n.isNotEmpty()) out += n
        }
        return out
    }

    private fun dateParts(iso: String): List<Any?>? {
        val m = DATE.find(iso.trim()) ?: return null
        return m.groupValues.drop(1).filter { it.isNotEmpty() }.map { it.toLong() }
    }

    /** MetadatosDocumento (Scholaris 4.x) → CSL-JSON item + `spdf` extension (CONTRACT §7). */
    fun metadata(v: Any?, legacyKind: String?): Any? {
        val m = asMap(v) ?: return v
        val item = LinkedHashMap<String, Any?>()
        val spdf = LinkedHashMap<String, Any?>()
        item["type"] = when {
            truthy(m["tipoCSL"]) -> m["tipoCSL"]
            truthy(m["revista"]) -> "article-journal"
            else -> DEFAULT_TYPES[legacyKind] ?: "book"
        }
        val title: Any? = m["titulo"].takeIf { truthy(it) } ?: ""
        if (has(m, "subtitulo")) {
            item["title"] = pyStr(title) + ": " + pyStr(m["subtitulo"])
            item["title-short"] = title
            spdf["subtitle"] = m["subtitulo"]
        } else {
            item["title"] = title
        }
        if (has(m, "tituloOriginal")) item["original-title"] = m["tituloOriginal"]
        val orcid = LinkedHashMap<String, Any?>()
        for ((src, dst) in listOf("autores" to "author", "editores" to "editor", "traductores" to "translator", "entrevistadores" to "interviewer")) {
            val list = names(m[src])
            if (list.isNotEmpty()) item[dst] = list
            for (p in asList(m[src])?.takeIf { truthy(it) } ?: emptyList()) {
                val a = asMap(p) ?: continue
                if (truthy(a["orcid"])) {
                    val family = if (a.containsKey("apellidos")) pyStr(a["apellidos"]) else ""
                    val key = family + if (truthy(a["nombre"])) ", " + pyStr(a["nombre"]) else ""
                    orcid[key] = a["orcid"]
                }
            }
        }
        val fecha = if (has(m, "fecha")) (m["fecha"] as? String)?.let { dateParts(it) } else null
        if (!fecha.isNullOrEmpty() && (!has(m, "anio") || pyEquals(fecha[0], m["anio"]))) {
            item["issued"] = mapOf("date-parts" to listOf(fecha))
        } else if (has(m, "anio")) {
            item["issued"] = mapOf("date-parts" to listOf(listOf(m["anio"])))
        }
        if (has(m, "anioOriginal")) item["original-date"] = mapOf("date-parts" to listOf(listOf(m["anioOriginal"])))
        for ((src, dst) in listOf(
            "editorial" to "publisher", "lugar" to "publisher-place", "coleccion" to "collection-title", "volumen" to "volume",
            "numero" to "issue", "paginas" to "page", "edicion" to "edition", "doi" to "DOI", "isbn" to "ISBN", "url" to "URL",
            "idioma" to "language", "resumen" to "abstract",
        )) {
            if (has(m, src)) item[dst] = m[src]
        }
        if (has(m, "revista")) item["container-title"] = m["revista"] else if (has(m, "contenedor")) item["container-title"] = m["contenedor"]
        if (has(m, "idiomaOriginal")) spdf["original_language"] = m["idiomaOriginal"]
        if (has(m, "sinFecha")) {
            val sf = asMap(m["sinFecha"]) ?: emptyMap()
            val u = LinkedHashMap<String, Any?>()
            if (sf["desde"] != null) u["from"] = sf["desde"]
            if (sf["hasta"] != null) u["to"] = sf["hasta"]
            if (truthy(sf["fundamento"])) u["basis"] = sf["fundamento"]
            spdf["undated"] = u
        }
        if (has(m, "procedencia")) {
            val prov = LinkedHashMap<String, Any?>()
            for ((campo, value) in asMap(m["procedencia"]) ?: emptyMap()) {
                var key = FIELDS[campo] ?: campo
                if (key.startsWith("spdf.")) key = key.substring(5)
                val e = asMap(value) ?: emptyMap()
                val fuente = e["fuente"]
                prov[key] = linkedMapOf("source" to ((fuente as? String)?.let { PROVENANCE_SOURCES[it] } ?: fuente), "confidence" to e["confianza"])
            }
            spdf["provenance"] = prov
        }
        if (orcid.isNotEmpty()) spdf["orcid"] = orcid
        if (spdf.isNotEmpty()) item["spdf"] = spdf
        return item
    }
}
