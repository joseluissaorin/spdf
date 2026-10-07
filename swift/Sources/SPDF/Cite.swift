import Foundation

/// Short author-date citations (contract §10).
public enum Citation {
    /// `(Family, Year, locator)` for an anchor (and optional end anchor of a
    /// range), the CSL-JSON metadata of the document, and a locale (`es`,
    /// `en`; others fall back to English).
    public static func cite(_ anchor: Anchor, end: Anchor? = nil, metadata: [String: JSONValue], locale: String) -> String {
        let es = locale.split(separator: "-", omittingEmptySubsequences: false).first.map { $0.lowercased() } == "es"
        var parts = [names(metadata, es: es), year(metadata, es: es)]
        if let loc = locator(anchor, end: end, es: es), !loc.isEmpty { parts.append(loc) }
        return "(" + parts.joined(separator: ", ") + ")"
    }

    static func name(_ v: JSONValue) -> String {
        guard case .object(let a) = v else { return "" }
        if let lit = a["literal"]?.stringValue, !lit.isEmpty { return lit }
        if let fam = a["family"]?.stringValue, !fam.isEmpty {
            if let p = a["non-dropping-particle"]?.stringValue, !p.isEmpty { return p + " " + fam }
            return fam
        }
        return a["given"]?.stringValue ?? ""
    }

    static func names(_ md: [String: JSONValue], es: Bool) -> String {
        let list = (md["author"]?.arrayValue ?? []).map(name).filter { !$0.isEmpty }
        switch list.count {
        case 0:
            if let ts = md["title-short"]?.stringValue, !ts.isEmpty { return ts }
            let t = md["title"]?.stringValue ?? ""
            let head = t.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
            return head.trimmingCharacters(in: .whitespacesAndNewlines)
        case 1:
            return list[0]
        case 2:
            if es { return list[0] + (startsWithISound(list[1]) ? " e " : " y ") + list[1] }
            return list[0] + " and " + list[1]
        default:
            return list[0] + " et al."
        }
    }

    /// The name begins with the sound /i/ (i, í, hi, hí) not followed by a vowel.
    static func startsWithISound(_ s: String) -> Bool {
        let low = Array(s.lowercased().unicodeScalars)
        var rest: ArraySlice<Unicode.Scalar>
        if low.count >= 2, low[0] == "h", low[1] == "i" || low[1] == "í" {
            rest = low[2...]
        } else if low.count >= 1, low[0] == "i" || low[0] == "í" {
            rest = low[1...]
        } else {
            return false
        }
        if let c = rest.first, "aeiouáéíóúü".unicodeScalars.contains(c) { return false }
        return true
    }

    static func year(_ md: [String: JSONValue], es: Bool) -> String {
        if case .object(let issued)? = md["issued"], case .array(let dp)? = issued["date-parts"],
           case .array(let first)? = dp.first, let y0 = first.first
        {
            var y: Int64?
            switch y0 {
            case .int(let i): y = i
            case .double(let d): y = Int64(d)
            case .string(let s): y = Int64(s.trimmingCharacters(in: .whitespaces))
            default: y = nil
            }
            if let y {
                if y > 0 { return String(y) }
                return es ? "\(-y) a. C." : "\(-y) BC"
            }
        }
        return es ? "s. f." : "n.d."
    }

    private static func label(_ a: Anchor) -> String? {
        guard let p = a.string("printed") else { return nil }
        return a.string("source") == "inferred" ? "[\(p)]" : p
    }

    static let single = ["page": "p.", "leaf": "fol.", "column": "col."]
    static let plural = ["page": "pp.", "leaf": "fols.", "column": "cols."]

    /// Foliation of an end: page anchors carry it (default page); section and
    /// web anchors count as pages.
    static func foliation(_ a: Anchor) -> String {
        if a.type == "page", let f = a.string("foliation"), single[f] != nil { return f }
        return "page"
    }

    /// SPEC §18.1: ends without a printed folio never take part in a range
    /// ("p. 211", never "pp. s. p.-211"), and every label comes from the
    /// foliation of the end(s) actually printed ("fol. Ir", "p. xiv-fol. 1r").
    private static func pageLocator(_ a: Anchor, end: Anchor?, es: Bool) -> String {
        var ends = [a]
        if let end, end.type == a.type { ends.append(end) }
        let withFolio = ends.filter { $0.string("printed") != nil }
        guard let first = withFolio.first, let last = withFolio.last else { return es ? "s. p." : "n. pag." }
        let (f1, f2) = (foliation(first), foliation(last))
        if withFolio.count == 1 || last.string("printed") == first.string("printed") {
            return "\(single[f1]!) \(label(first)!)"
        }
        if f1 == f2 { return "\(plural[f1]!) \(label(first)!)-\(label(last)!)" }
        return "\(single[f1]!) \(label(first)!)-\(single[f2]!) \(label(last)!)"
    }

    static func clock(_ t: Double) -> String {
        let s = max(0, Int64(t.rounded(.down)))
        let h = s / 3600, m = (s % 3600) / 60, x = s % 60
        return h > 0 ? String(format: "%lld:%02lld:%02lld", h, m, x) : String(format: "%lld:%02lld", m, x)
    }

    static func locator(_ a: Anchor, end: Anchor?, es: Bool) -> String? {
        switch a.type {
        case "page":
            return pageLocator(a, end: end, es: es)
        case "time":
            guard let t0 = a.number("t0") else { return nil }
            var s = clock(t0)
            if let end, end.type == "time", let t1 = end.number("t1") { s += "-" + clock(t1) }
            return s
        case "section", "web":
            if a.string("printed") != nil { return pageLocator(a, end: end, es: es) }
            var parts: [String] = []
            if let path = a.path, let last = path.last { parts.append("§ " + last) }
            if let para = a["paragraph"], !para.isNull { parts.append((es ? "párr. " : "para. ") + para.canonicalJSON) }
            return parts.isEmpty ? nil : parts.joined(separator: ", ")
        case "slide":
            return (es ? "diap. " : "slide ") + (a["n"]?.canonicalJSON ?? "")
        case "sheet":
            let sheet = a.string("sheet") ?? ""
            let from = a.int("row_from") ?? 0, to = a.int("row_to") ?? 0
            if from == to { return "\(sheet), \(es ? "fila" : "row") \(from)" }
            return "\(sheet), \(es ? "filas" : "rows") \(from)-\(to)"
        case "verse":
            let lf = a.int("line_from") ?? 0
            if let lt = a.int("line_to"), lt != lf { return "vv. \(lf)-\(lt)" }
            return "v. \(lf)"
        case "canonical":
            return a.string("ref")
        default:
            return nil
        }
    }
}
