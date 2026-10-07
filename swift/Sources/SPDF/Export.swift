import Foundation

/// CSL-JSON and BibTeX export.
public enum Bibliography {
    /// The metadata as a CSL-JSON item for citeproc: without the "spdf"
    /// extension, with "id" set to `id` unless present.
    public static func cslItem(_ metadata: [String: JSONValue], id: String) -> [String: JSONValue] {
        var out = metadata
        out["spdf"] = nil
        if out["id"] == nil, !id.isEmpty { out["id"] = .string(id) }
        return out
    }

    /// First author family (ASCII, lowercase) + year, or the first title word.
    public static func citationKey(_ md: [String: JSONValue]) -> String {
        var base = ""
        if let first = md["author"]?.arrayValue?.first {
            base = first["family"]?.stringValue ?? first["literal"]?.stringValue ?? ""
        }
        if base.isEmpty { base = md["title"]?.stringValue ?? "" }
        var key = ""
        for u in base.decomposedStringWithCanonicalMapping.unicodeScalars {
            if u == "ß" { key += "ss"; continue }
            if u == "æ" || u == "Æ" { key += "ae"; continue }
            if u == "ø" || u == "Ø" { key += "o"; continue }
            if u == " " && !key.isEmpty { break }
            if u.isASCII, u.properties.isAlphabetic || ("0"..."9").contains(u) { key.unicodeScalars.append(contentsOf: String(u).lowercased().unicodeScalars) }
        }
        if key.count > 24 { key = String(key.prefix(24)) }
        if key.isEmpty { key = "spdf" }
        if let y = year(md) { key += y }
        return key
    }

    static func year(_ md: [String: JSONValue]) -> String? {
        guard let y = md["issued"]?["date-parts"]?[0]?[0] else { return nil }
        if let i = SPDFValidator.integral(y) { return String(i) }
        return nil
    }

    static let types: [String: String] = [
        "book": "book", "article-journal": "article", "article-magazine": "article", "article-newspaper": "article",
        "article": "article", "chapter": "incollection", "paper-conference": "inproceedings", "thesis": "phdthesis",
        "report": "techreport", "manuscript": "unpublished", "entry-encyclopedia": "inbook", "entry-dictionary": "inbook",
    ]

    static func escape(_ s: String) -> String {
        var out = ""
        for c in s {
            switch c {
            case "\\": out += "\\textbackslash{}"
            case "{", "}", "&", "%", "$", "#", "_": out += "\\" + String(c)
            default: out.append(c)
            }
        }
        return out
    }

    static func names(_ v: JSONValue?) -> String {
        (v?.arrayValue ?? []).compactMap { n -> String? in
            if let lit = n["literal"]?.stringValue, !lit.isEmpty { return "{" + escape(lit) + "}" }
            var fam = n["family"]?.stringValue ?? ""
            if let p = n["non-dropping-particle"]?.stringValue, !p.isEmpty { fam = p + " " + fam }
            let given = n["given"]?.stringValue ?? ""
            switch (fam.isEmpty, given.isEmpty) {
            case (false, false): return escape(fam) + ", " + escape(given)
            case (false, true): return escape(fam)
            case (true, false): return escape(given)
            default: return nil
            }
        }.joined(separator: " and ")
    }

    /// Renders a CSL-JSON item as a BibTeX entry.
    public static func bibtex(_ md: [String: JSONValue], key: String? = nil) -> String {
        let type = types[md["type"]?.stringValue ?? ""] ?? "misc"
        var fields: [String: String] = [:]
        if let t = md["title"]?.stringValue, !t.isEmpty { fields["title"] = "{" + escape(t) + "}" }
        for (csl, bib) in [("author", "author"), ("editor", "editor"), ("translator", "translator")] {
            let n = names(md[csl])
            if !n.isEmpty { fields[bib] = n }
        }
        if let y = year(md) { fields["year"] = y }
        if let ct = md["container-title"]?.stringValue, !ct.isEmpty {
            switch type {
            case "article": fields["journal"] = escape(ct)
            case "incollection", "inproceedings", "inbook": fields["booktitle"] = escape(ct)
            default: fields["howpublished"] = escape(ct)
            }
        }
        let simple: [(String, String)] = [
            ("publisher", "publisher"), ("publisher-place", "address"), ("volume", "volume"), ("issue", "number"),
            ("page", "pages"), ("edition", "edition"), ("DOI", "doi"), ("ISBN", "isbn"), ("URL", "url"),
            ("language", "language"), ("abstract", "abstract"), ("collection-title", "series"), ("note", "note"),
        ]
        for (csl, bib) in simple {
            guard let v = md[csl] else { continue }
            var s: String
            switch v {
            case .string(let x): s = x
            case .int(let i): s = String(i)
            case .double(let d): s = SPDFNumber.format(d)
            default: continue
            }
            if s.isEmpty { continue }
            if bib == "pages" { s = s.replacingOccurrences(of: "-", with: "--").replacingOccurrences(of: "----", with: "--") }
            fields[bib] = (bib == "url" || bib == "doi") ? s : escape(s)
        }
        if type == "phdthesis", let p = fields.removeValue(forKey: "publisher") { fields["school"] = p }
        if type == "techreport", let p = fields.removeValue(forKey: "publisher") { fields["institution"] = p }
        let order = ["author", "editor", "translator", "title", "journal", "booktitle", "howpublished", "series", "edition", "volume",
                     "number", "pages", "publisher", "school", "institution", "address", "year", "doi", "isbn", "url", "language",
                     "abstract", "note"]
        var lines = order.compactMap { k in fields[k].map { "  \(k) = {\($0)}" } }
        lines += fields.keys.filter { !order.contains($0) }.sorted().map { "  \($0) = {\(fields[$0]!)}" }
        return "@\(type){\(key ?? citationKey(md)),\n" + lines.joined(separator: ",\n") + "\n}\n"
    }
}

extension SPDFFile {
    /// The document as a CSL-JSON array (one item), serialized.
    public func exportCSL() throws -> String {
        let md = try metadata()
        return JSONValue.array([.object(Bibliography.cslItem(md, id: Bibliography.citationKey(md)))]).compactJSON
    }

    /// The document as a BibTeX entry.
    public func exportBibTeX() throws -> String {
        let md = try metadata()
        return Bibliography.bibtex(md)
    }

    /// Cites an anchor of this file (contract §10).
    public func cite(_ anchor: Anchor, end: Anchor? = nil, locale: String) throws -> String {
        Citation.cite(anchor, end: end, metadata: try metadata(), locale: locale)
    }

    /// The canonical URI of an anchor of this file.
    public func anchorURI(_ anchor: Anchor, end: Anchor? = nil) -> String {
        locked { AnchorURI.format(docref: docRef(), anchor: anchor, end: end) }
    }

    private func dumpArray(_ key: String) throws -> [JSONValue] { try locked { try tableView(key) } }

    /// The citable units, in order (legacy files mapped).
    public func units() throws -> [SPDFUnit] {
        try dumpArray("units").compactMap { u in
            guard let a = u["anchor"].flatMap(Anchor.init) else { return nil }
            return SPDFUnit(id: u["id"]?.stringValue ?? "", ord: u["ord"]?.intValue, anchor: a, text: u["text"]?.stringValue ?? "",
                            notes: u["notes"]?.arrayValue?.compactMap(\.stringValue), header: u["header"]?.stringValue,
                            footer: u["footer"]?.stringValue, image: u["image"]?.stringValue, thumbnail: u["thumbnail"]?.stringValue,
                            reader: u["reader"]?.stringValue ?? "", confidence: u["confidence"]?.doubleValue ?? 1,
                            printed: u["printed"]?.stringValue, t0: u["t0"]?.doubleValue, t1: u["t1"]?.doubleValue,
                            words: u["words"].flatMap { $0.isNull ? nil : $0 })
        }
    }

    /// The fragments, in rowid order.
    public func fragments() throws -> [SPDFFragment] {
        try dumpArray("fragments").compactMap { f in
            guard let a = f["anchor"].flatMap(Anchor.init) else { return nil }
            return SPDFFragment(n: f["n"]?.intValue, id: f["id"]?.stringValue ?? "", unit: f["unit"]?.stringValue ?? "",
                                ord: f["ord"]?.intValue, text: f["text"]?.stringValue ?? "", context: f["context"]?.stringValue ?? "",
                                section: f["section"]?.arrayValue?.compactMap(\.stringValue), anchor: a,
                                anchorEnd: f["anchor_end"].flatMap(Anchor.init), searchText: f["search_text"]?.stringValue)
        }
    }

    /// The table of contents.
    public func sections() throws -> [SPDFSection] {
        try dumpArray("sections").map { s in
            SPDFSection(id: s["id"]?.stringValue ?? "", parent: s["parent"]?.stringValue, level: s["level"]?.intValue ?? 0,
                        title: s["title"]?.stringValue ?? "", unitFrom: s["unit_from"]?.stringValue ?? "",
                        unitTo: s["unit_to"]?.stringValue, summary: s["summary"]?.stringValue)
        }
    }

    /// The figures.
    public func figures() throws -> [SPDFFigure] {
        try dumpArray("figures").compactMap { g in
            guard let a = g["anchor"].flatMap(Anchor.init) else { return nil }
            return SPDFFigure(id: g["id"]?.stringValue ?? "", unit: g["unit"]?.stringValue ?? "", image: g["image"]?.stringValue ?? "",
                              caption: g["caption"]?.stringValue, description: g["description"]?.stringValue, anchor: a)
        }
    }

    /// The anchor and end anchor of a fragment.
    public func fragmentAnchors(_ id: String) throws -> (Anchor, Anchor?) {
        try locked {
            guard let r = try rows("fragments", ["anchor", "anchor_end"], "WHERE id = ?", [.text(id)]).first,
                  let a = anchorValue(r["anchor"] ?? .null)
            else { throw SPDFError("W", "no fragment \(id)") }
            let e = r["anchor_end"].flatMap { $0.isNull ? nil : anchorValue($0) }
            return (a, e)
        }
    }

    /// The MIME type and bytes of a blob ("blob:" prefix optional).
    public func blob(_ key: String) throws -> (mime: String, data: Data) {
        let k = key.hasPrefix("blob:") ? String(key.dropFirst(5)) : key
        return try locked {
            guard let r = try db.query("SELECT \(selectList("blobs", ["mime", "data"])) FROM blobs WHERE \(col("blobs", "key")) = ?", [.text(k)]).first
            else { throw SPDFError("W", "no blob \(k)") }
            return (r[0].string ?? "", r[1].data ?? Data())
        }
    }
}
