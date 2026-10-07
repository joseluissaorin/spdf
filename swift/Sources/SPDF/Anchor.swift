import Foundation

/// A JSON anchor (contract §3), kept as an object so members this version
/// does not know survive a round trip.
public struct Anchor: Sendable, Hashable, Codable {
    public var json: [String: JSONValue]

    public init(_ json: [String: JSONValue]) { self.json = json }

    public init?(_ value: JSONValue) {
        guard case .object(let o) = value else { return nil }
        json = o
    }

    /// Parses anchor JSON.
    public init(parsing text: String) throws {
        guard case .object(let o) = try JSONValue.parse(text) else { throw SPDFError("E040", "anchor is not a JSON object") }
        json = o
    }

    public init(from decoder: Decoder) throws {
        guard case .object(let o) = try JSONValue(from: decoder) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "anchor is not an object"))
        }
        json = o
    }

    public func encode(to encoder: Encoder) throws { try JSONValue.object(json).encode(to: encoder) }

    public subscript(key: String) -> JSONValue? {
        get { json[key] }
        set { json[key] = newValue }
    }

    /// "page", "time", "section", "slide", "sheet", "web", "image", "verse", "canonical".
    public var type: String { json["type"]?.stringValue ?? "" }

    public func string(_ k: String) -> String? { json[k]?.stringValue }

    public func int(_ k: String) -> Int64? { SPDFValidator.integral(json[k]) }

    public func number(_ k: String) -> Double? { json[k]?.doubleValue }

    /// The "path" member, if it is an array of strings.
    public var path: [String]? {
        guard case .array(let a)? = json["path"] else { return nil }
        var out: [String] = []
        for e in a {
            guard let s = e.stringValue else { return nil }
            out.append(s)
        }
        return out
    }

    /// The "chars" member [start, end) in code points.
    public var chars: (Int64, Int64)? {
        guard case .array(let a)? = json["chars"], a.count == 2, let s = SPDFValidator.integral(a[0]),
              let e = SPDFValidator.integral(a[1]) else { return nil }
        return (s, e)
    }

    /// The "region" member as fractions (x, y, w, h).
    public var region: (x: Double, y: Double, w: Double, h: Double)? {
        guard case .object(let r)? = json["region"], let x = r["x"]?.doubleValue, let y = r["y"]?.doubleValue,
              let w = r["w"]?.doubleValue, let h = r["h"]?.doubleValue else { return nil }
        return (x, y, w, h)
    }

    public var jsonValue: JSONValue { .object(json) }
}

/// A canonical reference such as `stephanus:514a`.
public struct CanonicalRef: Sendable, Hashable, Codable {
    public var scheme: String
    public var ref: String
    public init(scheme: String, ref: String) {
        self.scheme = scheme
        self.ref = ref
    }
}

/// The fragment of an anchor URI (contract §3). Only the present members are set.
public struct Locator: Sendable, Hashable, Codable {
    public var p: Int64?
    public var pe: Int64?
    public var f: String?
    public var fe: String?
    public var t: [Double]?
    public var s: [String]?
    public var para: Int64?
    public var sl: Int64?
    public var sh: String?
    public var rows: [Int64]?
    public var v: [Int64]?
    public var ref: CanonicalRef?
    public var char: [Int64]?
    public var xywh: [Double]?

    public init() {}

    /// The locator as JSON (present members only).
    public var jsonValue: JSONValue {
        var o: [String: JSONValue] = [:]
        if let p { o["p"] = .int(p) }
        if let pe { o["pe"] = .int(pe) }
        if let f { o["f"] = .string(f) }
        if let fe { o["fe"] = .string(fe) }
        if let t { o["t"] = .array(t.map { .double($0) }) }
        if let s { o["s"] = .array(s.map { .string($0) }) }
        if let para { o["para"] = .int(para) }
        if let sl { o["sl"] = .int(sl) }
        if let sh { o["sh"] = .string(sh) }
        if let rows { o["rows"] = .array(rows.map { .int($0) }) }
        if let v { o["v"] = .array(v.map { .int($0) }) }
        if let ref { o["ref"] = .object(["scheme": .string(ref.scheme), "ref": .string(ref.ref)]) }
        if let char { o["char"] = .array(char.map { .int($0) }) }
        if let xywh { o["xywh"] = .array(xywh.map { .double($0) }) }
        return .object(o)
    }

    /// Derives the locator of an anchor and an optional end anchor (ranges).
    public init(anchor a: Anchor, end: Anchor? = nil) {
        switch a.type {
        case "page":
            p = a.int("physical")
            f = a.string("printed")
            if let end, end.type == "page" {
                if let e = end.int("physical"), e != p { pe = e }
                if let e = end.string("printed"), e != f { fe = e }
            }
        case "time":
            let t0 = a.number("t0") ?? 0
            var t1 = a.number("t1")
            if let end, end.type == "time" { t1 = end.number("t1") }
            t = t1.map { [t0, $0] } ?? [t0]
        case "section", "web":
            if let path = a.path, !path.isEmpty { s = path }
            para = a.int("paragraph")
            if let pr = a.string("printed") {
                f = pr
                if let e = end?.string("printed"), e != pr { fe = e }
            }
        case "slide":
            sl = a.int("n") ?? 0
        case "sheet":
            sh = a.string("sheet") ?? ""
            rows = [a.int("row_from") ?? 0, a.int("row_to") ?? 0]
        case "verse":
            let lf = a.int("line_from") ?? 0
            if let lt = a.int("line_to"), lt != lf { v = [lf, lt] } else { v = [lf] }
            f = a.string("printed")
        case "canonical":
            ref = CanonicalRef(scheme: a.string("scheme") ?? "", ref: a.string("ref") ?? "")
        default:
            break
        }
        if let c = a.chars { char = [c.0, c.1] }
        if let r = a.region { xywh = [r.x, r.y, r.w, r.h] }
    }

    /// Builds a locator from its JSON form.
    public init(json: JSONValue) {
        p = json["p"]?.intValue
        pe = json["pe"]?.intValue
        f = json["f"]?.stringValue
        fe = json["fe"]?.stringValue
        t = json["t"]?.arrayValue?.compactMap(\.doubleValue)
        s = json["s"]?.arrayValue?.compactMap(\.stringValue)
        para = json["para"]?.intValue
        sl = json["sl"]?.intValue
        sh = json["sh"]?.stringValue
        rows = json["rows"]?.arrayValue?.compactMap(\.intValue)
        v = json["v"]?.arrayValue?.compactMap(\.intValue)
        if case .object(let r)? = json["ref"] {
            ref = CanonicalRef(scheme: r["scheme"]?.stringValue ?? "", ref: r["ref"]?.stringValue ?? "")
        }
        char = json["char"]?.arrayValue?.compactMap(\.intValue)
        xywh = json["xywh"]?.arrayValue?.compactMap(\.doubleValue)
    }
}

/// A parsed anchor URI.
public struct AnchorURI: Sendable, Hashable {
    public var docref: String
    public var locator: Locator

    public init(docref: String, locator: Locator) {
        self.docref = docref
        self.locator = locator
    }

    /// The preferred docref of a document: `sha256-<hex of source_sha256>`.
    public static func docref(sourceSHA256: String) -> String { "sha256-" + sourceSHA256.lowercased() }

    /// The canonical URI of an anchor (and optional end anchor).
    public static func format(docref: String, anchor: Anchor, end: Anchor? = nil) -> String {
        AnchorURI(docref: docref, locator: Locator(anchor: anchor, end: end)).description
    }

    /// Percent-encodes every UTF-8 byte except RFC 3986 unreserved characters.
    public static func encode(_ s: String) -> String {
        var out = ""
        for b in s.utf8 {
            switch b {
            case 0x41...0x5A, 0x61...0x7A, 0x30...0x39, 0x2D, 0x2E, 0x5F, 0x7E:
                out.unicodeScalars.append(Unicode.Scalar(b))
            default:
                out += String(format: "%%%02X", b)
            }
        }
        return out
    }

    static func decode(_ s: String) throws -> String {
        var bytes: [UInt8] = []
        let u = Array(s.utf8)
        var i = 0
        while i < u.count {
            if u[i] == 0x25 {
                guard i + 2 < u.count, let h = hexValue(u[i + 1]), let l = hexValue(u[i + 2]) else {
                    throw SPDFError("URI", "bad percent-encoding")
                }
                bytes.append(h << 4 | l)
                i += 3
            } else {
                bytes.append(u[i])
                i += 1
            }
        }
        guard let out = String(bytes: bytes, encoding: .utf8) else { throw SPDFError("URI", "percent-encoding is not UTF-8") }
        return out
    }

    private static func hexValue(_ c: UInt8) -> UInt8? {
        switch c {
        case 0x30...0x39: return c - 0x30
        case 0x41...0x46: return c - 0x41 + 10
        case 0x61...0x66: return c - 0x61 + 10
        default: return nil
        }
    }

    private static func isSHARef(_ s: String) -> Bool {
        guard s.hasPrefix("sha256-") else { return false }
        let hex = s.dropFirst(7)
        return hex.count == 64 && hex.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
    }

    private static func isInt(_ s: Substring) -> Bool {
        guard let f = s.first, s.allSatisfy({ $0.isASCII && $0.isNumber }) else { return false }
        return !(f == "0" && s.count > 1)
    }

    private static func isDec(_ s: Substring) -> Bool {
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2 else { return false }
        return parts.allSatisfy { !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber } }
    }

    private static func parseInt(_ s: Substring) throws -> Int64 {
        guard isInt(s), let v = Int64(s) else { throw SPDFError("URI", "not an integer: \(s)") }
        return v
    }

    private static func parseNPT(_ s: Substring) throws -> Double {
        if isDec(s) { return Double(s) ?? 0 }
        // [h:]mm:ss[.fff]
        let parts = s.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2 || parts.count == 3 else { throw SPDFError("URI", "bad time: \(s)") }
        var h: Int64 = 0
        if parts.count == 3 {
            guard !parts[0].isEmpty, parts[0].allSatisfy({ $0.isASCII && $0.isNumber }) else { throw SPDFError("URI", "bad time") }
            h = Int64(parts[0]) ?? 0
        }
        let mm = parts[parts.count - 2], ss = parts[parts.count - 1]
        guard (1...2).contains(mm.count), mm.allSatisfy({ $0.isASCII && $0.isNumber }), mm.count == 1 || mm.first! <= "5" else {
            throw SPDFError("URI", "bad time")
        }
        let secParts = ss.split(separator: ".", omittingEmptySubsequences: false)
        guard secParts[0].count == 2, secParts[0].allSatisfy({ $0.isASCII && $0.isNumber }), secParts[0].first! <= "5",
              secParts.count == 1 || (secParts.count == 2 && !secParts[1].isEmpty && secParts[1].allSatisfy({ $0.isASCII && $0.isNumber }))
        else { throw SPDFError("URI", "bad time") }
        return SPDFNumber.round6(Double(h * 3600 + (Int64(mm) ?? 0) * 60) + (Double(ss) ?? 0))
    }

    /// Parses an anchor URI (strict: malformed values are errors; unknown
    /// parameters are ignored).
    public static func parse(_ uri: String) throws -> AnchorURI {
        guard uri.hasPrefix("spdf:") else { throw SPDFError("URI", "not an spdf: URI") }
        let rest = uri.dropFirst(5)
        let rawRef: Substring
        let frag: Substring
        if let hash = rest.firstIndex(of: "#") {
            rawRef = rest[..<hash]
            frag = rest[rest.index(after: hash)...]
        } else {
            rawRef = rest
            frag = ""
        }
        guard !rawRef.isEmpty else { throw SPDFError("URI", "empty document reference") }
        let docref = try decode(String(rawRef))
        var l = Locator()
        var seen = Set<String>()
        for part in frag.split(separator: "&", omittingEmptySubsequences: true) {
            guard let eq = part.firstIndex(of: "=") else { throw SPDFError("URI", "parameter without value: \(part)") }
            let k = String(part[..<eq])
            let v = part[part.index(after: eq)...]
            guard !seen.contains(k) else { throw SPDFError("URI", "duplicate parameter \(k)") }
            seen.insert(k)
            switch k {
            case "p", "pe", "para", "sl":
                let n = try parseInt(v)
                if k != "para" && n < 1 { throw SPDFError("URI", "\(k) starts at 1") }
                switch k {
                case "p": l.p = n
                case "pe": l.pe = n
                case "para": l.para = n
                default: l.sl = n
                }
            case "f": l.f = try decode(String(v))
            case "fe": l.fe = try decode(String(v))
            case "sh": l.sh = try decode(String(v))
            case "t":
                let body = v.hasPrefix("npt:") ? v.dropFirst(4) : v
                let xs = try body.split(separator: ",", omittingEmptySubsequences: false).map { try parseNPT($0) }
                if xs.count > 2 || (xs.count == 2 && xs[1] < xs[0]) { throw SPDFError("URI", "bad t") }
                l.t = xs
            case "s":
                l.s = try v.split(separator: "/", omittingEmptySubsequences: false).map { try decode(String($0)) }
            case "rows":
                guard let dash = v.firstIndex(of: "-") else { throw SPDFError("URI", "rows needs a-b") }
                l.rows = [try parseInt(v[..<dash]), try parseInt(v[v.index(after: dash)...])]
            case "v":
                let xs = v.split(separator: "-", omittingEmptySubsequences: false)
                if xs.count > 2 { throw SPDFError("URI", "bad v") }
                l.v = try xs.map { try parseInt($0) }
            case "ref":
                guard let colon = v.firstIndex(of: ":"), colon != v.startIndex else { throw SPDFError("URI", "ref needs scheme:ref") }
                l.ref = CanonicalRef(scheme: try decode(String(v[..<colon])), ref: try decode(String(v[v.index(after: colon)...])))
            case "char":
                let xs = v.split(separator: ",", omittingEmptySubsequences: false)
                guard xs.count == 2 else { throw SPDFError("URI", "char needs start,end") }
                let a = try parseInt(xs[0]), b = try parseInt(xs[1])
                if b < a { throw SPDFError("URI", "char end before start") }
                l.char = [a, b]
            case "xywh":
                guard v.hasPrefix("percent:") else { throw SPDFError("URI", "xywh must use percent:") }
                let xs = v.dropFirst(8).split(separator: ",", omittingEmptySubsequences: false)
                guard xs.count == 4, xs.allSatisfy({ isDec($0) }) else { throw SPDFError("URI", "bad xywh") }
                l.xywh = xs.map { SPDFNumber.round6((Double($0) ?? 0) / 100) }
            default:
                break
            }
        }
        return AnchorURI(docref: docref, locator: l)
    }
}

extension AnchorURI: CustomStringConvertible {
    /// The canonical URI (contract §3).
    public var description: String {
        let l = locator
        var parts: [String] = []
        if let p = l.p { parts.append("p=\(p)") }
        if let pe = l.pe { parts.append("pe=\(pe)") }
        if let f = l.f { parts.append("f=" + AnchorURI.encode(f)) }
        if let fe = l.fe { parts.append("fe=" + AnchorURI.encode(fe)) }
        if let t = l.t, !t.isEmpty { parts.append("t=" + t.map { SPDFNumber.format(SPDFNumber.round6($0)) }.joined(separator: ",")) }
        if let s = l.s, !s.isEmpty { parts.append("s=" + s.map(AnchorURI.encode).joined(separator: "/")) }
        if let para = l.para { parts.append("para=\(para)") }
        if let sl = l.sl { parts.append("sl=\(sl)") }
        if let sh = l.sh { parts.append("sh=" + AnchorURI.encode(sh)) }
        if let r = l.rows, r.count == 2 { parts.append("rows=\(r[0])-\(r[1])") }
        if let v = l.v, !v.isEmpty { parts.append("v=" + v.map(String.init).joined(separator: "-")) }
        if let ref = l.ref { parts.append("ref=" + AnchorURI.encode(ref.scheme) + ":" + AnchorURI.encode(ref.ref)) }
        if let c = l.char, c.count == 2 { parts.append("char=\(c[0]),\(c[1])") }
        if let x = l.xywh, x.count == 4 {
            parts.append("xywh=percent:" + x.map { SPDFNumber.format(SPDFNumber.round6(SPDFNumber.round($0 * 100, decimals: 4))) }.joined(separator: ","))
        }
        let ref = AnchorURI.isSHARef(docref) ? docref : AnchorURI.encode(docref)
        return parts.isEmpty ? "spdf:" + ref : "spdf:" + ref + "#" + parts.joined(separator: "&")
    }
}
