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

    /// The BibTeX key of SPEC §19 (RFC 0002): the first author's family (or
    /// literal), else the first word of the title, folded to ASCII letters and
    /// lowercased ("anon" if nothing is left), plus the first year of issued
    /// (or "nd"): cervantessaavedra1605, hookend.
    public static func citationKey(_ md: [String: JSONValue]) -> String {
        var base = ""
        if case .object(let a)? = md["author"]?.arrayValue?.first {
            let fam = a["family"]?.stringValue ?? ""
            base = asciiLetters(fam.isEmpty ? (a["literal"]?.stringValue ?? "") : fam)
        }
        if base.isEmpty, let t = md["title"]?.stringValue,
           let first = t.split(whereSeparator: { $0.isWhitespace }).first {
            base = asciiLetters(String(first))
        }
        if base.isEmpty { base = "anon" }
        return base + (year(md) ?? "nd")
    }

    /// NFKD, keep only ASCII letters, lowercase.
    static func asciiLetters(_ s: String) -> String {
        var out = ""
        for u in s.decomposedStringWithCompatibilityMapping.unicodeScalars where ("A"..."Z").contains(u) || ("a"..."z").contains(u) {
            out.unicodeScalars.append(contentsOf: String(u).lowercased().unicodeScalars)
        }
        return out
    }

    static func year(_ md: [String: JSONValue]) -> String? {
        guard let y = md["issued"]?["date-parts"]?[0]?[0] else { return nil }
        if let i = SPDFValidator.integral(y) { return String(i) }
        if let s = y.stringValue, let i = Int64(s.trimmingCharacters(in: .whitespaces)) { return String(i) }
        return nil
    }

    static let types: [String: String] = [
        "book": "book", "article-journal": "article", "article-magazine": "article", "article-newspaper": "article",
        "chapter": "incollection", "paper-conference": "inproceedings", "thesis": "phdthesis", "report": "techreport",
    ]

    /// Escapes `\`, `{` and `}` (the rest of UTF-8 stays as it is).
    static func escape(_ s: String) -> String {
        var out = ""
        for c in s {
            switch c {
            case "\\": out += "\\textbackslash{}"
            case "{", "}": out += "\\" + String(c)
            default: out.append(c)
            }
        }
        return out
    }

    /// Braces every word the source capitalizes, so styles cannot lowercase it.
    static func protectTitle(_ t: String) -> String {
        var out = ""
        var word = ""
        func flush() {
            guard !word.isEmpty else { return }
            out += word.unicodeScalars.contains { $0.properties.isUppercase } ? "{" + escape(word) + "}" : escape(word)
            word = ""
        }
        for c in t {
            if c.isWhitespace {
                flush()
                out.append(c)
            } else {
                word.append(c)
            }
        }
        flush()
        return out
    }

    static func names(_ v: JSONValue?) -> String {
        (v?.arrayValue ?? []).compactMap { n -> String? in
            if let lit = n["literal"]?.stringValue, !lit.isEmpty { return "{" + escape(lit) + "}" }
            var fam = n["family"]?.stringValue ?? ""
            if let p = n["non-dropping-particle"]?.stringValue, !p.isEmpty, !fam.isEmpty { fam = p + " " + fam }
            let given = n["given"]?.stringValue ?? ""
            switch (fam.isEmpty, given.isEmpty) {
            case (false, false): return escape(fam) + ", " + escape(given)
            case (false, true): return "{" + escape(fam) + "}"
            case (true, false): return "{" + escape(given) + "}"
            default: return nil
            }
        }.joined(separator: " and ")
    }

    /// The entry type and the fields of a CSL-JSON item (SPEC §19), before layout.
    public static func bibtexFields(_ md: [String: JSONValue]) -> (type: String, fields: [(String, String)]) {
        let type = types[md["type"]?.stringValue ?? ""] ?? "misc"
        var fields: [(String, String)] = []
        for (csl, bib) in [("author", "author"), ("editor", "editor")] {
            let n = names(md[csl])
            if !n.isEmpty { fields.append((bib, n)) }
        }
        if let t = md["title"]?.stringValue, !t.isEmpty { fields.append(("title", protectTitle(t))) }
        if let y = year(md) { fields.append(("year", y)) }
        if let ct = md["container-title"]?.stringValue, !ct.isEmpty {
            fields.append((type == "article" ? "journal" : "booktitle", protectTitle(ct)))
        }
        let simple: [(String, String)] = [
            ("publisher", "publisher"), ("publisher-place", "address"), ("collection-title", "series"), ("volume", "volume"),
            ("issue", "number"), ("page", "pages"), ("edition", "edition"), ("DOI", "doi"), ("ISBN", "isbn"), ("URL", "url"),
            ("language", "language"), ("note", "note"),
        ]
        for (csl, bib) in simple {
            let s: String
            switch md[csl] {
            case .string(let x)?: s = x
            case .int(let i)?: s = String(i)
            case .double(let d)?: s = SPDFNumber.format(d)
            default: continue
            }
            if !s.isEmpty { fields.append((bib, escape(s))) }
        }
        return (type, fields)
    }

    /// Renders a CSL-JSON item as a BibTeX entry (SPEC §19).
    public static func bibtex(_ md: [String: JSONValue], key: String? = nil) -> String {
        let (type, fields) = bibtexFields(md)
        let body = fields.map { "  \($0.0) = {\($0.1)}" }.joined(separator: ",\n")
        return "@\(type){\(key ?? citationKey(md)),\n" + body + "\n}\n"
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
