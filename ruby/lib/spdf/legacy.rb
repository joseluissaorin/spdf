# frozen_string_literal: true

module Spdf
  # Legacy SPDF 4.x (Scholaris, Spanish identifiers) seen through the 5.0 view (§7).
  module Legacy
    # 5.0 table => [legacy table, {5.0 column => legacy column or nil}]
    TABLES = {
      "spdf_meta" => ["spdf", { "key" => "clave", "value" => "valor" }],
      "documents" => ["documentos", {
        "id" => "id", "kind" => "tipo", "metadata" => "metadatos", "source_sha256" => "huella",
        "source_ref" => "original", "mime" => "mime", "bytes" => "bytes", "unit_count" => "unidades",
        "duration" => "duracion", "created" => "creado", "updated" => "actualizado", "title" => "titulo",
        "authors" => "autores", "year" => "anio", "language" => "idioma", "rights" => nil
      }],
      "units" => ["unidades", {
        "id" => "id", "document" => "documento", "ord" => "orden", "anchor" => "ancla", "text" => "texto",
        "notes" => "notas", "header" => "cabecera", "footer" => "pie", "image" => "imagen",
        "thumbnail" => "miniatura", "reader" => "lector", "confidence" => "confianza", "printed" => "impresa",
        "t0" => "t0", "t1" => "t1", "words" => "palabras"
      }],
      "sections" => ["secciones", {
        "id" => "id", "document" => "documento", "parent" => "padre", "level" => "nivel", "title" => "titulo",
        "unit_from" => "unidad_desde", "unit_to" => "unidad_hasta", "summary" => "resumen"
      }],
      "fragments" => ["fragmentos", {
        "n" => "n", "id" => "id", "document" => "documento", "unit" => "unidad", "ord" => "orden",
        "text" => "texto", "context" => "contexto", "section" => "seccion", "anchor" => "ancla",
        "anchor_end" => "ancla_fin", "search_text" => "texto_busqueda"
      }],
      "figures" => ["figuras", {
        "id" => "id", "document" => "documento", "unit" => "unidad", "image" => "imagen", "caption" => "pie",
        "description" => "descripcion", "anchor" => "ancla"
      }],
      "spaces" => ["espacios", {
        "id" => "id", "provider" => "proveedor", "model" => "modelo", "version" => "version", "dims" => "dims",
        "dtype" => nil, "normalized" => "normalizado", "truncated_from" => nil, "modalities" => "modalidades",
        "task_prefixes" => nil, "created" => "creado"
      }],
      "vectors" => ["vectores", {
        "target" => "objetivo", "id" => "id", "space" => "espacio", "document" => "documento", "data" => "valores"
      }],
      "blobs" => ["blobs", { "key" => "clave", "mime" => "mime", "sha256" => nil, "data" => "datos" }],
      "provenance" => ["procedencia", {
        "document" => "documento", "stage" => "fase", "provider" => "proveedor", "model" => nil,
        "detail" => "detalle", "ms" => "ms", "at" => "cuando"
      }],
      "extensions" => [nil, { "name" => nil, "version" => nil, "required" => nil }]
    }.freeze

    DEFAULTS = { "spaces.dtype" => "'f32'" }.freeze
    KINDS = { "pdf_escaneado" => "scanned_pdf", "fotos" => "photos", "imagen" => "image", "documento" => "document",
              "presentacion" => "slides", "hoja" => "sheet" }.freeze
    TARGETS = { "fragmento" => "fragment", "unidad" => "unit", "figura" => "figure" }.freeze
    ANCHOR_TYPES = { "pagina" => "page", "tiempo" => "time", "seccion" => "section", "diapositiva" => "slide",
                     "hoja" => "sheet", "web" => "web", "imagen" => "image" }.freeze
    ANCHOR_KEYS = { "tipo" => "type", "fisica" => "physical", "impresa" => "printed", "romana" => "roman",
                    "origen" => "source", "confianza" => "confidence", "hablante" => "speaker", "ruta" => "path",
                    "parrafo" => "paragraph", "hoja" => "sheet", "filaDesde" => "row_from", "filaHasta" => "row_to",
                    "consultada" => "accessed" }.freeze
    ANCHOR_SOURCES = { "leido" => "read", "deducido" => "inferred", "ninguno" => "none" }.freeze
    MODALITIES = { "texto" => "text", "imagen" => "image" }.freeze
    META_KEYS = { "creado" => "created", "generador" => "generator" }.freeze
    FIELDS = {
      "titulo" => "title", "subtitulo" => "spdf.subtitle", "tituloOriginal" => "original-title", "autores" => "author",
      "editores" => "editor", "traductores" => "translator", "entrevistadores" => "interviewer", "anio" => "issued",
      "anioOriginal" => "original-date", "editorial" => "publisher", "lugar" => "publisher-place",
      "revista" => "container-title", "contenedor" => "container-title", "coleccion" => "collection-title",
      "volumen" => "volume", "numero" => "issue", "paginas" => "page", "edicion" => "edition", "doi" => "DOI",
      "isbn" => "ISBN", "url" => "URL", "idioma" => "language", "tipoCSL" => "type", "resumen" => "abstract",
      "idiomaOriginal" => "spdf.original_language", "fecha" => "issued", "sinFecha" => "spdf.undated"
    }.freeze
    PROVENANCE_SOURCES = { "lectura" => "reading", "usuario" => "user", "colofon" => "colophon", "impresores" => "printers" }.freeze
    SIMPLE = [%w[editorial publisher], %w[lugar publisher-place], %w[coleccion collection-title], %w[volumen volume],
              %w[numero issue], %w[paginas page], %w[edicion edition], %w[doi DOI], %w[isbn ISBN], %w[url URL],
              %w[idioma language], %w[resumen abstract]].freeze
    PEOPLE = [%w[autores author], %w[editores editor], %w[traductores translator], %w[entrevistadores interviewer]].freeze
    TYPE_BY_KIND = { "audio" => "speech", "video" => "motion_picture", "web" => "webpage", "presentacion" => "speech",
                     "hoja" => "dataset", "imagen" => "graphic", "fotos" => "graphic" }.freeze

    module_function

    def column(table, col) = TABLES.dig(table, 1, col)

    def kind(tipo) = tipo.nil? ? nil : KINDS.fetch(tipo, tipo)

    def target(objetivo) = TARGETS.fetch(objetivo, objetivo)

    def legacy_target(target) = TARGETS.key(target) || target

    def meta_key(clave) = META_KEYS.fetch(clave, clave)

    def modalities(list)
      list.is_a?(Array) ? list.map { |x| x.is_a?(String) ? MODALITIES.fetch(x, x) : x } : list
    end

    def reference(value, blob_keys, keep_empty: false)
      return nil if value.nil?
      return(keep_empty ? "" : nil) if value == ""
      return "blob:#{value}" if blob_keys.include?(value)

      value
    end

    def anchor(a)
      return a unless a.is_a?(Hash)

      a.to_h do |k, v|
        key = ANCHOR_KEYS.fetch(k, k)
        v = ANCHOR_TYPES.fetch(v, v) if k == "tipo"
        v = ANCHOR_SOURCES.fetch(v, v) if k == "origen"
        [key, v]
      end
    end

    # Python-like truthiness (the oracle is written in Python).
    def truthy?(v)
      !(v.nil? || v == false || v == "" || v == 0 || v == [] || v == {})
    end

    def has?(m, k)
      m.key?(k) && !m[k].nil? && m[k] != "" && m[k] != []
    end

    def people(list)
      return [] unless list.is_a?(Array)

      list.filter_map do |p|
        next unless p.is_a?(Hash)

        n = {}
        n["family"] = p["apellidos"] if truthy?(p["apellidos"])
        n["given"] = p["nombre"] if truthy?(p["nombre"])
        n unless n.empty?
      end
    end

    def default_type(tipo, m)
      return m["tipoCSL"] if truthy?(m["tipoCSL"])
      return "article-journal" if truthy?(m["revista"])

      TYPE_BY_KIND.fetch(tipo.to_s, "book")
    end

    def date_parts(iso)
      md = iso.strip.match(/\A(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/)
      md && md.captures.compact.map(&:to_i)
    end

    # MetadatosDocumento (Scholaris 4.x) => CSL-JSON item + "spdf" extension object.
    def metadata(m, tipo = nil)
      return m unless m.is_a?(Hash)

      item = { "type" => default_type(tipo, m) }
      ext = {}
      title = truthy?(m["titulo"]) ? m["titulo"].to_s : ""
      if has?(m, "subtitulo")
        item["title"] = "#{title}: #{m["subtitulo"]}"
        item["title-short"] = title
        ext["subtitle"] = m["subtitulo"]
      else
        item["title"] = title
      end
      item["original-title"] = m["tituloOriginal"] if has?(m, "tituloOriginal")
      orcid = {}
      PEOPLE.each do |src, dst|
        names = people(m[src])
        item[dst] = names unless names.empty?
        (m[src].is_a?(Array) ? m[src] : []).each do |a|
          next unless a.is_a?(Hash) && truthy?(a["orcid"])

          orcid["#{a["apellidos"]}#{truthy?(a["nombre"]) ? ", #{a["nombre"]}" : ""}"] = a["orcid"]
        end
      end
      fecha = has?(m, "fecha") && m["fecha"].is_a?(String) ? date_parts(m["fecha"]) : nil
      if fecha && (!has?(m, "anio") || fecha[0] == m["anio"])
        item["issued"] = { "date-parts" => [fecha] }
      elsif has?(m, "anio")
        item["issued"] = { "date-parts" => [[m["anio"]]] }
      end
      item["original-date"] = { "date-parts" => [[m["anioOriginal"]]] } if has?(m, "anioOriginal")
      SIMPLE.each { |src, dst| item[dst] = m[src] if has?(m, src) }
      if has?(m, "revista")
        item["container-title"] = m["revista"]
      elsif has?(m, "contenedor")
        item["container-title"] = m["contenedor"]
      end
      ext["original_language"] = m["idiomaOriginal"] if has?(m, "idiomaOriginal")
      if has?(m, "sinFecha") && m["sinFecha"].is_a?(Hash)
        sf = m["sinFecha"]
        u = {}
        u["from"] = sf["desde"] unless sf["desde"].nil?
        u["to"] = sf["hasta"] unless sf["hasta"].nil?
        u["basis"] = sf["fundamento"] if truthy?(sf["fundamento"])
        ext["undated"] = u
      end
      if has?(m, "procedencia") && m["procedencia"].is_a?(Hash)
        ext["provenance"] = m["procedencia"].to_h do |campo, v|
          key = FIELDS.fetch(campo, campo)
          key = key.delete_prefix("spdf.")
          v = v.is_a?(Hash) ? v : {}
          fuente = v["fuente"]
          [key, { "source" => fuente.is_a?(String) ? PROVENANCE_SOURCES.fetch(fuente, fuente) : fuente,
                  "confidence" => v["confianza"] }]
        end
      end
      ext["orcid"] = orcid unless orcid.empty?
      item["spdf"] = ext unless ext.empty?
      item
    end
  end
end
