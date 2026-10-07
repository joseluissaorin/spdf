import Foundation

/// The resolution of an anchor URI, or of the URL of a `.spdf` with a
/// fragment, against a file (SPEC §5.4).
public struct LocateResult: Sendable, Hashable, Codable {
    /// False when the reference designates another document.
    public var document: Bool
    /// Ids of the designated units, in reading order.
    public var units: [String]
    /// Ids of the designated fragments, in rowid order.
    public var fragments: [String]
    /// Code-point range of the reference, if any.
    public var char: [Int64]?
    /// Region of the reference (fractions), if any.
    public var xywh: [Double]?

    public var jsonValue: JSONValue {
        .object([
            "document": .bool(document), "units": .array(units.map { .string($0) }),
            "fragments": .array(fragments.map { .string($0) }),
            "char": char.map { .array($0.map { .int($0) }) } ?? .null,
            "xywh": xywh.map { .array($0.map { .double($0) }) } ?? .null,
        ])
    }
}

extension SPDFFile {
    static let locateRules = ["p", "f", "t", "sl", "v", "ref", "s", "sh"]

    static func has(_ rule: String, _ l: Locator) -> Bool {
        switch rule {
        case "p": return l.p != nil
        case "f": return l.f != nil
        case "t": return !(l.t ?? []).isEmpty
        case "sl": return l.sl != nil
        case "v": return !(l.v ?? []).isEmpty
        case "ref": return l.ref != nil
        case "s": return l.s != nil
        case "sh": return l.sh != nil
        default: return false
        }
    }

    /// The predicate of SPEC §5.4 for one rule; `printed` replaces the
    /// anchor's folio when not nil (units.printed).
    static func matches(_ rule: String, _ l: Locator, _ anchorJSON: JSONValue?, printed: JSONValue? = nil) -> Bool {
        guard case .object(let a)? = anchorJSON else { return false }
        let type = a["type"]?.stringValue
        switch rule {
        case "p":
            guard type == "page", let ph = SPDFValidator.integral(a["physical"]), let p = l.p else { return false }
            return p <= ph && ph <= (l.pe ?? p)
        case "f":
            let p = (printed.flatMap { $0.isNull ? nil : $0 }) ?? a["printed"]
            return p?.stringValue != nil && p?.stringValue == l.f
        case "t":
            guard type == "time", let x = l.t?.first, let t0 = a["t0"]?.doubleValue, let t1 = a["t1"]?.doubleValue else { return false }
            return t0 <= x && x < t1
        case "sl":
            guard type == "slide", let n = a["n"]?.doubleValue, let sl = l.sl else { return false }
            return n == Double(sl)
        case "v":
            guard type == "verse", let x = l.v?.first, SPDFValidator.integral(a["line_from"]) != nil,
                  let lf = a["line_from"]?.doubleValue else { return false }
            var lt = lf
            if let to = a["line_to"], !to.isNull {
                guard let v = to.doubleValue else { return false }
                lt = v
            }
            return lf <= Double(x) && Double(x) <= lt
        case "ref":
            guard type == "canonical", let ref = l.ref else { return false }
            return a["scheme"]?.stringValue == ref.scheme && a["ref"]?.stringValue == ref.ref
        case "s":
            guard type == "section" || type == "web", case .array(let path)? = a["path"], let s = l.s else { return false }
            let want = s.map { JSONValue.string($0) }
            if let para = l.para {
                return JSONValue.array(path).jsonEquals(.array(want)) && a["paragraph"]?.doubleValue == Double(para)
            }
            guard path.count >= want.count else { return false }
            return JSONValue.array(Array(path.prefix(want.count))).jsonEquals(.array(want))
        case "sh":
            guard type == "sheet", let sh = a["sheet"]?.stringValue, sh == l.sh else { return false }
            if let x = l.rows?.first {
                guard SPDFValidator.integral(a["row_from"]) != nil, SPDFValidator.integral(a["row_to"]) != nil,
                      let rf = a["row_from"]?.doubleValue, let rt = a["row_to"]?.doubleValue else { return false }
                return rf <= Double(x) && Double(x) <= rt
            }
            return true
        default:
            return false
        }
    }

    /// Resolves an anchor URI (`spdf:…`) or the URL of a `.spdf` with a
    /// fragment against this file (SPEC §5.4).
    public func locate(_ reference: String) throws -> LocateResult {
        try locked {
            let empty = LocateResult(document: false, units: [], fragments: [], char: nil, xywh: nil)
            guard let doc = try documentRow() else { return empty }
            var l = Locator()
            if reference.hasPrefix("spdf:") {
                let parsed = try AnchorURI.parse(reference)
                let sha = doc["source_sha256"]?.stringValue ?? ""
                if parsed.docref != "sha256-" + sha && parsed.docref != doc["id"]?.stringValue { return empty }
                l = parsed.locator
            } else if let hash = reference.firstIndex(of: "#") {
                let frag = reference[reference.index(after: hash)...]
                if !frag.isEmpty { l = try AnchorURI.parse("spdf:x#" + frag).locator }
            }
            var out = LocateResult(document: true, units: [], fragments: [], char: l.char, xywh: l.xywh)
            guard let rule = SPDFFile.locateRules.first(where: { SPDFFile.has($0, l) }) else { return out }
            let units = try tableView("units")
            let frags = try tableView("fragments")
            var order: [String: Int64] = [:]
            var ids: [String] = []
            var timed: [JSONValue] = []
            for u in units {
                let id = u["id"]?.stringValue ?? ""
                order[id] = u["ord"]?.intValue ?? 0
                if u["anchor"]?["type"]?.stringValue == "time" { timed.append(u) }
                if SPDFFile.matches(rule, l, u["anchor"], printed: rule == "f" ? u["printed"] : nil) { ids.append(id) }
            }
            if rule == "t", ids.isEmpty, let last = timed.last, let t1 = last["anchor"]?["t1"]?.doubleValue, t1 == l.t?.first {
                ids = [last["id"]?.stringValue ?? ""]
            }
            var matched = frags.filter { SPDFFile.matches(rule, l, $0["anchor"]) }
            if ids.isEmpty && !matched.isEmpty {
                var seen = Set<String>()
                for f in matched {
                    let u = f["unit"]?.stringValue ?? ""
                    if seen.insert(u).inserted { ids.append(u) }
                }
                ids = ids.enumerated().sorted { a, b in
                    let (oa, ob) = (order[a.element] ?? 0, order[b.element] ?? 0)
                    return oa != ob ? oa < ob : a.offset < b.offset
                }.map(\.element)
            }
            if let c = l.char, c.count == 2 {
                let (lo, hi) = (c[0], c[1])
                let inUnits = Set(ids)
                matched = matched.filter { f in
                    guard inUnits.contains(f["unit"]?.stringValue ?? ""), let a = f["anchor"].flatMap(Anchor.init), let ch = a.chars else { return false }
                    return lo < hi ? (ch.0 < hi && lo < ch.1) : (ch.0 <= lo && lo < ch.1)
                }
            }
            out.units = ids
            out.fragments = matched.map { $0["id"]?.stringValue ?? "" }
            return out
        }
    }
}
