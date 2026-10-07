import Foundation

/// Legacy 4.x → 5.0 mapping of the JSON stored in TEXT columns (contract §7).
public enum Legacy {
    static let anchorKeys: [String: String] = [
        "tipo": "type", "fisica": "physical", "impresa": "printed", "romana": "roman", "origen": "source",
        "confianza": "confidence", "hablante": "speaker", "ruta": "path", "parrafo": "paragraph", "hoja": "sheet",
        "filaDesde": "row_from", "filaHasta": "row_to", "consultada": "accessed", "region": "region",
    ]
    static let anchorTypes: [String: String] = [
        "pagina": "page", "tiempo": "time", "seccion": "section", "diapositiva": "slide", "hoja": "sheet",
        "web": "web", "imagen": "image",
    ]
    static let anchorSources: [String: String] = ["leido": "read", "deducido": "inferred", "epub": "epub", "ninguno": "none"]
    static let simple: [(String, String)] = [
        ("editorial", "publisher"), ("lugar", "publisher-place"), ("coleccion", "collection-title"), ("volumen", "volume"),
        ("numero", "issue"), ("paginas", "page"), ("edicion", "edition"), ("doi", "DOI"), ("isbn", "ISBN"), ("url", "URL"),
        ("idioma", "language"), ("resumen", "abstract"),
    ]
    static let nameLists: [(String, String)] = [
        ("autores", "author"), ("editores", "editor"), ("traductores", "translator"), ("entrevistadores", "interviewer"),
    ]
    static let fieldNames: [String: String] = [
        "titulo": "title", "subtitulo": "subtitle", "tituloOriginal": "original-title", "autores": "author",
        "editores": "editor", "traductores": "translator", "entrevistadores": "interviewer", "anio": "issued",
        "anioOriginal": "original-date", "editorial": "publisher", "lugar": "publisher-place", "revista": "container-title",
        "contenedor": "container-title", "coleccion": "collection-title", "volumen": "volume", "numero": "issue",
        "paginas": "page", "edicion": "edition", "doi": "DOI", "isbn": "ISBN", "url": "URL", "idioma": "language",
        "tipoCSL": "type", "resumen": "abstract", "idiomaOriginal": "original_language", "fecha": "issued",
        "sinFecha": "undated",
    ]
    static let provenanceSources: [String: String] = ["lectura": "reading", "usuario": "user", "colofon": "colophon", "impresores": "printers"]
    static let defaultType: [String: String] = [
        "audio": "speech", "video": "motion_picture", "web": "webpage", "presentacion": "speech", "hoja": "dataset",
        "imagen": "graphic", "fotos": "graphic",
    ]

    /// Converts a legacy (Spanish) anchor object to 5.0; unknown members are kept.
    public static func anchor(_ v: JSONValue) -> JSONValue {
        guard case .object(let m) = v else { return v }
        var out: [String: JSONValue] = [:]
        for (k, val) in m {
            let nk = anchorKeys[k] ?? k
            var nv = val
            if k == "tipo", let s = val.stringValue, let t = anchorTypes[s] { nv = .string(t) }
            if k == "origen", let s = val.stringValue, let t = anchorSources[s] { nv = .string(t) }
            out[nk] = nv
        }
        return .object(out)
    }

    /// Storage references: '' → null (or '' for figures), a blob key → 'blob:<key>'.
    static func ref(_ v: JSONValue, keys: Set<String>, keepEmpty: Bool) -> JSONValue {
        guard let s = v.stringValue else { return v }
        if s.isEmpty { return keepEmpty ? .string("") : .null }
        if keys.contains(s) { return .string("blob:" + s) }
        return v
    }

    private static func has(_ m: [String: JSONValue], _ k: String) -> Bool {
        guard let v = m[k] else { return false }
        switch v {
        case .null: return false
        case .string(let s): return !s.isEmpty
        case .array(let a): return !a.isEmpty
        default: return true
        }
    }

    /// Converts legacy MetadatosDocumento to a CSL-JSON item with the "spdf"
    /// extension. `kind` is documentos.tipo.
    public static func metadata(_ v: JSONValue, kind: String) -> JSONValue {
        guard case .object(let m) = v else { return v }
        var item: [String: JSONValue] = [:]
        var ext: [String: JSONValue] = [:]
        if m["tipoCSL"]?.truthy == true {
            item["type"] = m["tipoCSL"]
        } else if m["revista"]?.truthy == true {
            item["type"] = "article-journal"
        } else {
            item["type"] = .string(defaultType[kind] ?? "book")
        }
        let title = m["titulo"]?.stringValue ?? ""
        if has(m, "subtitulo") {
            let sub = m["subtitulo"]?.stringValue ?? (m["subtitulo"]?.canonicalJSON ?? "")
            item["title"] = .string(title + ": " + sub)
            item["title-short"] = .string(title)
            ext["subtitle"] = m["subtitulo"]
        } else {
            item["title"] = .string(title)
        }
        if has(m, "tituloOriginal") { item["original-title"] = m["tituloOriginal"] }
        var orcid: [String: JSONValue] = [:]
        for (src, dst) in nameLists {
            var names: [JSONValue] = []
            for e in m[src]?.arrayValue ?? [] {
                guard case .object(let p) = e else { continue }
                var n: [String: JSONValue] = [:]
                if p["apellidos"]?.truthy == true { n["family"] = p["apellidos"] }
                if p["nombre"]?.truthy == true { n["given"] = p["nombre"] }
                if !n.isEmpty { names.append(.object(n)) }
                if p["orcid"]?.truthy == true {
                    var key = p["apellidos"]?.stringValue ?? ""
                    if let g = p["nombre"]?.stringValue, !g.isEmpty { key += ", " + g }
                    orcid[key] = p["orcid"]
                }
            }
            if !names.isEmpty { item[dst] = .array(names) }
        }
        var fecha: [JSONValue]?
        if has(m, "fecha"), let s = m["fecha"]?.stringValue { fecha = isoDateParts(s) }
        if let f = fecha, !has(m, "anio") || f[0].jsonEquals(m["anio"]!) {
            item["issued"] = .object(["date-parts": .array([.array(f)])])
        } else if has(m, "anio") {
            item["issued"] = .object(["date-parts": .array([.array([m["anio"]!])])])
        }
        if has(m, "anioOriginal") { item["original-date"] = .object(["date-parts": .array([.array([m["anioOriginal"]!])])]) }
        for (src, dst) in simple where has(m, src) { item[dst] = m[src] }
        if has(m, "revista") {
            item["container-title"] = m["revista"]
        } else if has(m, "contenedor") {
            item["container-title"] = m["contenedor"]
        }
        if has(m, "idiomaOriginal") { ext["original_language"] = m["idiomaOriginal"] }
        if has(m, "sinFecha") {
            var u: [String: JSONValue] = [:]
            if case .object(let sf)? = m["sinFecha"] {
                if let d = sf["desde"], !d.isNull { u["from"] = d }
                if let h = sf["hasta"], !h.isNull { u["to"] = h }
                if sf["fundamento"]?.truthy == true { u["basis"] = sf["fundamento"] }
            }
            ext["undated"] = .object(u)
        }
        if has(m, "procedencia") {
            var prov: [String: JSONValue] = [:]
            for (field, val) in m["procedencia"]?.objectValue ?? [:] {
                let key = fieldNames[field] ?? field
                let e = val.objectValue ?? [:]
                var src = e["fuente"] ?? .null
                if let s = src.stringValue, let ms = provenanceSources[s] { src = .string(ms) }
                prov[key] = .object(["source": src, "confidence": e["confianza"] ?? .null])
            }
            ext["provenance"] = .object(prov)
        }
        if !orcid.isEmpty { ext["orcid"] = .object(orcid) }
        if !ext.isEmpty { item["spdf"] = .object(ext) }
        return .object(item)
    }

    /// "1977-03-20" (or a prefix of it, or "-0350") → CSL date-parts.
    static func isoDateParts(_ s: String) -> [JSONValue]? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let r = t.range(of: #"^(-?\d{1,4})(-(\d{1,2})(-(\d{1,2}))?)?"#, options: .regularExpression) else { return nil }
        let matched = String(t[r])
        var parts: [JSONValue] = []
        var rest = Substring(matched)
        var first = true
        while !rest.isEmpty {
            var token = ""
            if first, rest.first == "-" {
                token = "-"
                rest = rest.dropFirst()
            } else if rest.first == "-" {
                rest = rest.dropFirst()
            }
            while let c = rest.first, c.isASCII, c.isNumber {
                token.append(c)
                rest = rest.dropFirst()
            }
            guard let n = Int64(token) else { return nil }
            parts.append(.int(n))
            first = false
        }
        return parts.isEmpty ? nil : parts
    }
}
