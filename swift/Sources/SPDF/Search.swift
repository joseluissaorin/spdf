import Foundation

/// What a vector search runs over.
public enum VectorTarget: String, Sendable, Codable {
    case fragment, unit, figure
}

/// A search result (contract §6).
public struct SearchHit: Sendable, Hashable, Codable {
    /// Fragment id (or unit/figure id for those targets).
    public var id: String
    public var target: VectorTarget
    public var score: Double
    /// "lexical" and/or "vector".
    public var via: [String]
    public var anchor: Anchor?
    public var anchorEnd: Anchor?
    public var anchorURI: String
    /// Tie-break key: fragment `n` (unit `ord`).
    public var order: Int64

    public var fragmentID: String? { target == .fragment ? id : nil }

    /// The result item of the contract.
    public var jsonValue: JSONValue {
        var o: [String: JSONValue] = ["score": .double(score), "via": .array(via.map { .string($0) }),
                                      "anchor": anchor?.jsonValue ?? .null, "anchor_uri": .string(anchorURI)]
        if target == .fragment {
            o["fragment_id"] = .string(id)
        } else {
            o["target"] = .string(target.rawValue)
            o["id"] = .string(id)
        }
        return .object(o)
    }
}

/// The compiled form of a lexical query (contract §6, steps 1-5).
public struct LexicalQuery: Sendable, Hashable {
    /// Terms as written (NFC).
    public var terms: [String]
    /// The terms are phrases (joined with AND).
    public var phrases: Bool
    /// FTS5 MATCH expression, nil without terms.
    public var match: String?

    private static let closers: [Unicode.Scalar: [Unicode.Scalar]] = ["\"": ["\""], "“": ["”"], "«": ["»"], "„": ["“", "”"]]

    static func isWord(_ u: Unicode.Scalar) -> Bool {
        switch u.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .nonspacingMark, .spacingMark, .enclosingMark, .decimalNumber, .letterNumber, .otherNumber:
            return true
        default:
            return false
        }
    }

    static func words(_ s: [Unicode.Scalar]) -> [String] {
        var out: [String] = []
        var cur = String.UnicodeScalarView()
        for u in s {
            if isWord(u) {
                cur.append(u)
            } else if !cur.isEmpty {
                out.append(String(cur))
                cur = String.UnicodeScalarView()
            }
        }
        if !cur.isEmpty { out.append(String(cur)) }
        return out
    }

    static func dedupKey(_ t: String) -> [Unicode.Scalar] {
        var v = String.UnicodeScalarView()
        for u in t.decomposedStringWithCanonicalMapping.unicodeScalars where u.properties.generalCategory != .nonspacingMark {
            v.append(u)
        }
        return Array(String(v).lowercased().unicodeScalars)
    }

    /// Compiles a user query.
    public init(_ query: String) {
        let q = Array(query.precomposedStringWithCanonicalMapping.unicodeScalars)
        var phraseList: [[Unicode.Scalar]] = []
        var rest: [Unicode.Scalar] = []
        var i = 0
        while i < q.count {
            let c = q[i]
            if let closes = LexicalQuery.closers[c] {
                var j = i + 1
                while j < q.count, !closes.contains(q[j]) { j += 1 }
                if j < q.count {
                    phraseList.append(Array(q[(i + 1)..<j]))
                    rest.append(" ")
                    i = j + 1
                    continue
                }
                rest.append(" ")
                i += 1
                continue
            }
            rest.append(c)
            i += 1
        }
        let phraseTerms = phraseList.map { LexicalQuery.words($0) }.filter { !$0.isEmpty }.map { $0.joined(separator: " ") }
        let raw: [String]
        if !phraseTerms.isEmpty {
            raw = phraseTerms
            phrases = true
        } else {
            raw = LexicalQuery.words(rest)
            phrases = false
        }
        var seen: [[Unicode.Scalar]] = []
        var out: [String] = []
        for t in raw {
            let k = LexicalQuery.dedupKey(t)
            if seen.contains(where: { $0.elementsEqual(k) }) { continue }
            seen.append(k)
            out.append(t)
        }
        terms = out
        if out.isEmpty {
            match = nil
        } else {
            match = out.map { "\"" + $0.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }.joined(separator: phrases ? " AND " : " OR ")
        }
    }

    static let cjkRanges: [ClosedRange<UInt32>] = [
        0x2E80...0x2FDF, 0x3040...0x30FF, 0x3100...0x312F, 0x3130...0x318F, 0x31A0...0x31FF, 0x3400...0x4DBF,
        0x4E00...0x9FFF, 0xA960...0xA97F, 0xAC00...0xD7AF, 0xF900...0xFAFF, 0xFF66...0xFF9F, 0x20000...0x3FFFF,
    ]

    static func hasCJK(_ s: String) -> Bool {
        s.unicodeScalars.contains { u in cjkRanges.contains { $0.contains(u.value) } }
    }
}

/// A vector space (spaces row).
public struct VectorSpace: Sendable, Hashable, Codable {
    public var id: String
    public var provider: String
    public var model: String
    public var version: String?
    public var dims: Int64
    public var dtype: String
    public var normalized: Bool
    public var truncatedFrom: Int64?
    public var modalities: [String]
    public var taskPrefixes: [String: JSONValue]?
    public var created: String?

    public init(id: String, provider: String, model: String, version: String? = nil, dims: Int64, dtype: String = "f32",
                normalized: Bool = true, truncatedFrom: Int64? = nil, modalities: [String] = ["text"],
                taskPrefixes: [String: JSONValue]? = nil, created: String? = nil)
    {
        self.id = id
        self.provider = provider
        self.model = model
        self.version = version
        self.dims = dims
        self.dtype = dtype
        self.normalized = normalized
        self.truncatedFrom = truncatedFrom
        self.modalities = modalities
        self.taskPrefixes = taskPrefixes
        self.created = created
    }
}

/// Vector encodings (contract §2).
public enum VectorCodec {
    /// Decodes a stored vector to Double components (f32/f16 exactly, i8 as q/127).
    public static func decode(_ data: Data, dtype: String) throws -> [Double] {
        let b = [UInt8](data)
        switch dtype {
        case "f32", "":
            guard b.count % 4 == 0 else { throw SPDFError("E030", "f32 vector length \(b.count)") }
            return stride(from: 0, to: b.count, by: 4).map { i in
                let bits = UInt32(b[i]) | UInt32(b[i + 1]) << 8 | UInt32(b[i + 2]) << 16 | UInt32(b[i + 3]) << 24
                return Double(Float(bitPattern: bits))
            }
        case "f16":
            guard b.count % 2 == 0 else { throw SPDFError("E030", "f16 vector length \(b.count)") }
            return stride(from: 0, to: b.count, by: 2).map { i in halfToDouble(UInt16(b[i]) | UInt16(b[i + 1]) << 8) }
        case "i8":
            return b.map { Double(Int8(bitPattern: $0)) / 127 }
        default:
            throw SPDFError("E032", "unknown dtype \(dtype)")
        }
    }

    /// IEEE 754 binary16 → Double (exact).
    public static func halfToDouble(_ h: UInt16) -> Double {
        let sign: Double = h & 0x8000 != 0 ? -1 : 1
        let exp = Int((h >> 10) & 0x1F)
        let frac = Double(h & 0x3FF)
        switch exp {
        case 0: return sign * frac * pow(2, -24)
        case 31: return frac == 0 ? sign * .infinity : .nan
        default: return sign * (1 + frac / 1024) * pow(2, Double(exp - 15))
        }
    }

    /// Double → IEEE 754 binary16, directly, round-to-nearest-even; a finite
    /// value that overflows is an error.
    public static func toHalf(_ v: Double) throws -> UInt16 {
        let bits = v.bitPattern
        let sign = UInt16(truncatingIfNeeded: bits >> 48) & 0x8000
        let exp = Int((bits >> 52) & 0x7FF)
        let frac = bits & ((1 << 52) - 1)
        if exp == 0x7FF { return sign | (frac != 0 ? 0x7E00 : 0x7C00) }
        if exp == 0 { return sign }
        let m = frac | (1 << 52)
        let unbiased = exp - 1023
        var e = unbiased + 15
        if e >= 1 {
            if e >= 31 { throw SPDFError("E030", "value \(v) out of range for f16") }
            var half = m >> 42
            let rem = m & ((1 << 42) - 1)
            let mid: UInt64 = 1 << 41
            if rem > mid || (rem == mid && half & 1 == 1) { half += 1 }
            if half == 1 << 11 {
                half >>= 1
                e += 1
                if e >= 31 { throw SPDFError("E030", "value \(v) out of range for f16") }
            }
            return sign | UInt16(e) << 10 | UInt16(half & 0x3FF)
        }
        let shift = UInt64(28 - unbiased)
        if shift >= 64 { return sign }
        var half = m >> shift
        let rem = m & ((1 << shift) - 1)
        let mid: UInt64 = 1 << (shift - 1)
        if rem > mid || (rem == mid && half & 1 == 1) { half += 1 }
        return sign | UInt16(half)
    }

    /// Double → Float (round-to-nearest-even); a finite value that overflows is an error.
    public static func toFloat(_ v: Double) throws -> Float {
        let f = Float(v)
        if f.isInfinite && v.isFinite { throw SPDFError("E030", "value \(v) out of range for f32") }
        return f
    }

    /// q = floor(|v×127| + 0.5) · sign, clamped to ±127.
    public static func quantizeI8(_ v: Double) -> Int8 {
        let x = v * 127
        var q = (Swift.abs(x) + 0.5).rounded(.down)
        if x < 0 { q = -q }
        return Int8(max(-127, min(127, q)))
    }

    /// Encodes values as a writer would (little-endian), contract §2.
    public static func encode(_ v: [Double], dtype: String) throws -> Data {
        var out = Data()
        switch dtype {
        case "f32", "":
            out.reserveCapacity(v.count * 4)
            for x in v {
                let bits = try toFloat(x).bitPattern
                out.append(contentsOf: [UInt8(bits & 0xFF), UInt8(bits >> 8 & 0xFF), UInt8(bits >> 16 & 0xFF), UInt8(bits >> 24)])
            }
        case "f16":
            for x in v {
                let h = try toHalf(x)
                out.append(contentsOf: [UInt8(h & 0xFF), UInt8(h >> 8)])
            }
        case "i8":
            for x in v { out.append(UInt8(bitPattern: quantizeI8(x))) }
        default:
            throw SPDFError("E032", "unknown dtype \(dtype)")
        }
        return out
    }

    /// Encodes Float components (embeddings) in a dtype.
    public static func encode(_ v: [Float], dtype: String) throws -> Data {
        try encode(v.map { Double($0) }, dtype: dtype)
    }
}

extension SPDFFile {
    /// How a compiled query runs on this file: route ("fts", "trigram",
    /// "substring") and MATCH string (nil for substring or without terms).
    public func lexicalRoute(_ q: LexicalQuery, query: String) -> (route: String, match: String?) {
        guard let match = q.match else { return ("fts", nil) }
        if LexicalQuery.hasCJK(query.precomposedStringWithCanonicalMapping) {
            if tables.contains(table("fragments_fts") + "_trigram") && q.terms.allSatisfy({ $0.unicodeScalars.count >= 3 }) {
                return ("trigram", match)
            }
            return ("substring", nil)
        }
        return ("fts", match)
    }

    /// Reference lexical search (contract §6).
    public func searchLexical(_ query: String, limit: Int = 10) throws -> [SearchHit] {
        try locked { try searchLexicalUnlocked(query, limit: limit) }
    }

    func searchLexicalUnlocked(_ query: String, limit: Int) throws -> [SearchHit] {
        let q = LexicalQuery(query)
        guard q.match != nil else { return [] }
        let (route, match) = lexicalRoute(q, query: query)
        var results: [(Int64, Double)] = []
        switch route {
        case "trigram":
            let t = quoteIdent(table("fragments_fts") + "_trigram")
            results = try db.query("SELECT rowid, bm25(\(t)) AS r FROM \(t) WHERE \(t) MATCH ? ORDER BY r, rowid LIMIT ?",
                                   [.text(match!), .int(Int64(limit))]).map { ($0[0].int ?? 0, -($0[1].double ?? 0)) }
        case "substring":
            let textCol = col("fragments", "text")
            let hits = Array(repeating: "(instr(\(textCol), ?) > 0)", count: q.terms.count).joined(separator: " + ")
            let need = q.phrases ? q.terms.count : 1
            let args: [SQLValue] = q.terms.map { .text($0) } + q.terms.map { .text($0) } + [.int(Int64(need)), .int(Int64(limit))]
            results = try db.query("SELECT \(col("fragments", "n")), (\(hits)) AS h FROM \(quoteIdent(table("fragments"))) WHERE (\(hits)) >= ? ORDER BY h DESC, \(col("fragments", "n")) LIMIT ?",
                                   args).map { ($0[0].int ?? 0, $0[1].double ?? 0) }
        default:
            let t = quoteIdent(table("fragments_fts"))
            let sql = (try? db.query("SELECT sql FROM sqlite_master WHERE name = ?", [.text(table("fragments_fts"))]).first?.first?.string) ?? nil
            let fourCols = sql.map { $0.contains("search_text") || $0.contains("texto_busqueda") } ?? true
            let weights = fourCols ? "1.0, 0.5, 0.5, 1.0" : "1.0, 0.5, 0.5"
            results = try db.query("SELECT rowid, bm25(\(t), \(weights)) AS r FROM \(t) WHERE \(t) MATCH ? ORDER BY r, rowid LIMIT ?",
                                   [.text(match!), .int(Int64(limit))]).map { ($0[0].int ?? 0, -($0[1].double ?? 0)) }
        }
        return try fragmentHits(results, via: "lexical")
    }

    func anchorValue(_ v: SQLValue) -> Anchor? {
        var j = SPDFFile.parseJSONColumn(v)
        if isLegacy { j = Legacy.anchor(j) }
        return Anchor(j)
    }

    func fragmentHits(_ results: [(Int64, Double)], via: String) throws -> [SearchHit] {
        guard !results.isEmpty else { return [] }
        let ph = Array(repeating: "?", count: results.count).joined(separator: ",")
        let rows = try rows("fragments", ["n", "id", "anchor", "anchor_end"], "WHERE \(col("fragments", "n")) IN (\(ph))",
                            results.map { .int($0.0) })
        var byN: [Int64: [String: SQLValue]] = [:]
        for r in rows { byN[r["n"]?.int ?? 0] = r }
        let ref = docRef()
        return results.map { n, score in
            let r = byN[n] ?? [:]
            let a = anchorValue(r["anchor"] ?? .null)
            let end = (r["anchor_end"] ?? .null).isNull ? nil : anchorValue(r["anchor_end"]!)
            let uri = a.map { AnchorURI.format(docref: ref, anchor: $0, end: end) } ?? "spdf:" + ref
            return SearchHit(id: r["id"]?.string ?? "", target: .fragment, score: score, via: [via], anchor: a, anchorEnd: end,
                             anchorURI: uri, order: n)
        }
    }

    /// The vector spaces of the file.
    public func spaces() throws -> [VectorSpace] {
        try locked { try spacesUnlocked() }
    }

    func spacesUnlocked() throws -> [VectorSpace] {
        try rows("spaces", Schema.columns["spaces"]!, "ORDER BY \(col("spaces", "id"))").map { r in
            let mods = SPDFFile.parseJSONColumn(r["modalities"] ?? .null).arrayValue?.compactMap(\.stringValue) ?? []
            let tp = SPDFFile.parseJSONColumn(r["task_prefixes"] ?? .null).objectValue
            let dt = r["dtype"]?.string ?? "f32"
            return VectorSpace(id: r["id"]?.string ?? "", provider: r["provider"]?.string ?? "", model: r["model"]?.string ?? "",
                               version: r["version"]?.string, dims: r["dims"]?.int ?? 0, dtype: dt.isEmpty ? "f32" : dt,
                               normalized: (r["normalized"]?.int ?? 1) != 0, truncatedFrom: r["truncated_from"]?.int,
                               modalities: mods, taskPrefixes: tp, created: r["created"]?.string)
        }
    }

    /// Brute-force similarity over the vectors of a space and target.
    /// `normalized=1` → dot product, else cosine; ties by fragment n / unit ord / figure id.
    public func searchVector(_ query: [Double], space: String, target: VectorTarget = .fragment, limit: Int = 10) throws -> [SearchHit] {
        try locked { try searchVectorUnlocked(query, space: space, target: target, limit: limit) }
    }

    func searchVectorUnlocked(_ query: [Double], space: String, target: VectorTarget, limit: Int) throws -> [SearchHit] {
        guard let sp = try spacesUnlocked().first(where: { $0.id == space }) else {
            throw SPDFError("E031", "unknown vector space", location: space)
        }
        guard Int64(query.count) == sp.dims else {
            throw SPDFError("E030", "query vector has \(query.count) dimensions, space \(space) has \(sp.dims)")
        }
        var stored = target.rawValue
        if isLegacy, let k = Schema.legacyTargets.first(where: { $0.value == target.rawValue })?.key { stored = k }
        let rows = try rows("vectors", ["id", "data"], "WHERE \(col("vectors", "space")) = ? AND \(col("vectors", "target")) = ?",
                            [.text(space), .text(stored)])
        let qn = query.reduce(0) { $0 + $1 * $1 }.squareRoot()
        var scored: [(String, Double)] = []
        for r in rows {
            let v = try VectorCodec.decode(r["data"]?.data ?? Data(), dtype: sp.dtype)
            var dot = 0.0
            for i in 0..<min(v.count, query.count) { dot += query[i] * v[i] }
            var score = dot
            if !sp.normalized {
                let vn = v.reduce(0) { $0 + $1 * $1 }.squareRoot()
                score = (vn == 0 || qn == 0) ? 0 : dot / (qn * vn)
            }
            scored.append((r["id"]?.string ?? "", score))
        }
        var keys: [String: Int64] = [:]
        switch target {
        case .fragment:
            for r in try self.rows("fragments", ["n", "id"]) { keys[r["id"]?.string ?? ""] = r["n"]?.int ?? 0 }
        case .unit:
            for (i, r) in try self.rows("units", ["id", "ord"], "ORDER BY \(col("units", "ord")), \(col("units", "id"))").enumerated() {
                keys[r["id"]?.string ?? ""] = isLegacy ? Int64(i + 1) : (r["ord"]?.int ?? 0)
            }
        case .figure:
            break
        }
        scored.sort { a, b in
            if a.1 != b.1 { return a.1 > b.1 }
            if target != .figure, let ka = keys[a.0], let kb = keys[b.0], ka != kb { return ka < kb }
            return Array(a.0.utf8).lexicographicallyPrecedes(Array(b.0.utf8))
        }
        let top = scored.prefix(limit)
        if target == .fragment {
            return try fragmentHits(top.map { (keys[$0.0] ?? 0, $0.1) }, via: "vector")
        }
        let ref = docRef()
        let t5 = target == .unit ? "units" : "figures"
        return try top.map { id, score in
            let a = try self.rows(t5, ["anchor"], "WHERE id = ?", [.text(id)]).first.flatMap { anchorValue($0["anchor"] ?? .null) }
            return SearchHit(id: id, target: target, score: score, via: ["vector"], anchor: a, anchorEnd: nil,
                             anchorURI: a.map { AnchorURI.format(docref: ref, anchor: $0) } ?? "spdf:" + ref, order: keys[id] ?? 0)
        }
    }

    /// Hybrid search: reciprocal rank fusion (k = 10) of the lexical and the
    /// vector lists, each to depth max(limit, 50).
    public func searchHybrid(_ query: String, vector: [Double]?, space: String?, limit: Int = 10) throws -> [SearchHit] {
        try locked {
            let depth = max(limit, 50)
            let lex = try searchLexicalUnlocked(query, limit: depth)
            var vec: [SearchHit] = []
            if let vector, let space { vec = try searchVectorUnlocked(vector, space: space, target: .fragment, limit: depth) }
            return SPDFFile.fuse(lex, vec, k: 10, limit: limit)
        }
    }

    /// Reciprocal rank fusion: score = Σ 1/(k + rank), ties by fragment n.
    public static func fuse(_ lexical: [SearchHit], _ vector: [SearchHit], k: Double = 10, limit: Int) -> [SearchHit] {
        var order: [String] = []
        var acc: [String: SearchHit] = [:]
        for (list, via) in [(lexical, "lexical"), (vector, "vector")] {
            for (i, h) in list.enumerated() {
                let inc = 1 / (k + Double(i + 1))
                if var e = acc[h.id] {
                    e.score += inc
                    e.via.append(via)
                    acc[h.id] = e
                } else {
                    var e = h
                    e.score = inc
                    e.via = [via]
                    acc[h.id] = e
                    order.append(h.id)
                }
            }
        }
        var out = order.map { acc[$0]! }
        out.sort { a, b in a.score != b.score ? a.score > b.score : a.order < b.order }
        return Array(out.prefix(limit))
    }
}
