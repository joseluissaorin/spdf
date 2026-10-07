import Foundation

/// A JSON value that keeps the distinction between integers and other numbers,
/// as the canonical dump of SPDF needs (contract §5).
public enum JSONValue: Sendable, Hashable {
    case null
    case bool(Bool)
    case int(Int64)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    // MARK: Accessors

    public var isNull: Bool { if case .null = self { return true } else { return false } }
    public var stringValue: String? { if case .string(let s) = self { return s } else { return nil } }
    public var boolValue: Bool? { if case .bool(let b) = self { return b } else { return nil } }
    public var arrayValue: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
    public var objectValue: [String: JSONValue]? { if case .object(let o) = self { return o } else { return nil } }

    /// The value as an integer, if it is a JSON integer.
    public var intValue: Int64? { if case .int(let i) = self { return i } else { return nil } }

    /// The value as a number (integer or not).
    public var doubleValue: Double? {
        switch self {
        case .int(let i): return Double(i)
        case .double(let d): return d
        default: return nil
        }
    }

    public var isNumber: Bool { doubleValue != nil }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public subscript(index: Int) -> JSONValue? {
        if case .array(let a) = self, index >= 0, index < a.count { return a[index] }
        return nil
    }

    /// Truthiness in the sense of a dynamic language (used by the legacy mapping).
    var truthy: Bool {
        switch self {
        case .null: return false
        case .bool(let b): return b
        case .int(let i): return i != 0
        case .double(let d): return d != 0
        case .string(let s): return !s.isEmpty
        case .array(let a): return !a.isEmpty
        case .object(let o): return !o.isEmpty
        }
    }

    // MARK: Parsing

    /// Parses JSON text. Integers without fraction or exponent that fit in
    /// Int64 become `.int`, every other number `.double`.
    public static func parse(_ text: String) throws -> JSONValue {
        var p = JSONParser(Array(text.utf8))
        p.skipWS()
        let v = try p.value(depth: 0)
        p.skipWS()
        guard p.i == p.b.count else { throw JSONParseError("trailing data after JSON value") }
        return v
    }

    public static func parse(data: Data) throws -> JSONValue {
        try parse(String(decoding: data, as: UTF8.self))
    }

    // MARK: Serialization

    /// RFC 8785 (JCS) serialization after rounding every non-integer number
    /// to six decimals: the canonical form of contract §5.
    public var canonicalJSON: String {
        var out = ""
        write(&out, round: true)
        return out
    }

    /// Compact serialization with sorted keys and the shortest round-trip
    /// number form, without rounding (how writers store JSON columns).
    public var compactJSON: String {
        var out = ""
        write(&out, round: false)
        return out
    }

    /// Indented serialization (for people), keys sorted, numbers canonical.
    public func prettyJSON(indent: Int = 2) -> String {
        var out = ""
        writePretty(&out, indent: indent, level: 0)
        return out
    }

    func write(_ out: inout String, round: Bool) {
        switch self {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .int(let i): out += String(i)
        case .double(let d): out += SPDFNumber.format(round ? SPDFNumber.round6(d) : d)
        case .string(let s): JSONValue.writeString(&out, s)
        case .array(let a):
            out += "["
            for (i, e) in a.enumerated() {
                if i > 0 { out += "," }
                e.write(&out, round: round)
            }
            out += "]"
        case .object(let o):
            out += "{"
            for (i, k) in JSONValue.sortedKeys(o).enumerated() {
                if i > 0 { out += "," }
                JSONValue.writeString(&out, k)
                out += ":"
                o[k]!.write(&out, round: round)
            }
            out += "}"
        }
    }

    private func writePretty(_ out: inout String, indent: Int, level: Int) {
        let pad = String(repeating: " ", count: indent * (level + 1))
        let end = String(repeating: " ", count: indent * level)
        switch self {
        case .array(let a) where !a.isEmpty:
            out += "[\n"
            for (i, e) in a.enumerated() {
                if i > 0 { out += ",\n" }
                out += pad
                e.writePretty(&out, indent: indent, level: level + 1)
            }
            out += "\n" + end + "]"
        case .object(let o) where !o.isEmpty:
            out += "{\n"
            for (i, k) in JSONValue.sortedKeys(o).enumerated() {
                if i > 0 { out += ",\n" }
                out += pad
                JSONValue.writeString(&out, k)
                out += ": "
                o[k]!.writePretty(&out, indent: indent, level: level + 1)
            }
            out += "\n" + end + "}"
        default:
            write(&out, round: true)
        }
    }

    /// Object keys sorted by UTF-16 code units (RFC 8785).
    static func sortedKeys(_ o: [String: JSONValue]) -> [String] {
        o.keys.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
    }

    static func writeString(_ out: inout String, _ s: String) {
        out += "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if u.value < 0x20 {
                    out += String(format: "\\u%04x", u.value)
                } else {
                    out.unicodeScalars.append(u)
                }
            }
        }
        out += "\""
    }

    // MARK: Comparison

    /// Structural comparison: numbers compare as Double after six-decimal
    /// rounding (1 equals 1.0); strings by code points.
    public func jsonEquals(_ other: JSONValue) -> Bool { JSONValue.diff(self, other) == nil }

    /// The first difference between two values, or nil when they are equal.
    public static func diff(_ a: JSONValue, _ b: JSONValue, path: String = "") -> String? {
        let here = path.isEmpty ? "/" : path
        if let x = a.doubleValue {
            guard let y = b.doubleValue, SPDFNumber.round6(x) == SPDFNumber.round6(y) else {
                return "\(here): \(a.canonicalJSON) != \(b.canonicalJSON.prefix(200))"
            }
            return nil
        }
        switch (a, b) {
        case (.null, .null): return nil
        case (.bool(let x), .bool(let y)) where x == y: return nil
        case (.string(let x), .string(let y)):
            return x.unicodeScalars.elementsEqual(y.unicodeScalars) ? nil : "\(here): \(a.canonicalJSON) != \(b.canonicalJSON.prefix(200))"
        case (.array(let x), .array(let y)):
            guard x.count == y.count else { return "\(here): length \(x.count) != \(y.count)" }
            for i in 0..<x.count {
                if let d = diff(x[i], y[i], path: "\(path)/\(i)") { return d }
            }
            return nil
        case (.object(let x), .object(let y)):
            let keys = Set(x.keys).union(y.keys).sorted()
            for k in keys {
                switch (x[k], y[k]) {
                case (nil, let v?): return "\(path)/\(k): missing != \(v.canonicalJSON.prefix(200))"
                case (let v?, nil): return "\(path)/\(k): \(v.canonicalJSON.prefix(200)) != missing"
                case (let v?, let w?):
                    if let d = diff(v, w, path: "\(path)/\(k)") { return d }
                default: break
                }
            }
            return nil
        default:
            return "\(here): \(a.canonicalJSON.prefix(200)) != \(b.canonicalJSON.prefix(200))"
        }
    }
}

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let i = try? c.decode(Int64.self) { self = .int(i); return }
        if let d = try? c.decode(Double.self) { self = .double(d); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "not a JSON value")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .int(let i): try c.encode(i)
        case .double(let d): try c.encode(d)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

extension JSONValue: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByStringLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral
{
    public init(nilLiteral: ()) { self = .null }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(integerLiteral value: Int64) { self = .int(value) }
    public init(floatLiteral value: Double) { self = .double(value) }
    public init(stringLiteral value: String) { self = .string(value) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        var o: [String: JSONValue] = [:]
        for (k, v) in elements { o[k] = v }
        self = .object(o)
    }
}

/// A JSON syntax error.
public struct JSONParseError: Error, Sendable, CustomStringConvertible {
    public let description: String
    init(_ d: String) { description = d }
}

struct JSONParser {
    let b: [UInt8]
    var i = 0
    init(_ b: [UInt8]) { self.b = b }

    mutating func skipWS() {
        while i < b.count, b[i] == 0x20 || b[i] == 0x0A || b[i] == 0x0D || b[i] == 0x09 { i += 1 }
    }

    mutating func value(depth: Int) throws -> JSONValue {
        guard depth < 512 else { throw JSONParseError("JSON nested too deeply") }
        guard i < b.count else { throw JSONParseError("unexpected end of JSON") }
        switch b[i] {
        case UInt8(ascii: "{"):
            i += 1
            var o: [String: JSONValue] = [:]
            skipWS()
            if i < b.count, b[i] == UInt8(ascii: "}") { i += 1; return .object(o) }
            while true {
                skipWS()
                guard i < b.count, b[i] == UInt8(ascii: "\"") else { throw JSONParseError("expected object key") }
                let k = try string()
                skipWS()
                guard i < b.count, b[i] == UInt8(ascii: ":") else { throw JSONParseError("expected ':'") }
                i += 1
                skipWS()
                o[k] = try value(depth: depth + 1)
                skipWS()
                guard i < b.count else { throw JSONParseError("unexpected end of JSON") }
                if b[i] == UInt8(ascii: ",") { i += 1; continue }
                if b[i] == UInt8(ascii: "}") { i += 1; return .object(o) }
                throw JSONParseError("expected ',' or '}'")
            }
        case UInt8(ascii: "["):
            i += 1
            var a: [JSONValue] = []
            skipWS()
            if i < b.count, b[i] == UInt8(ascii: "]") { i += 1; return .array(a) }
            while true {
                skipWS()
                a.append(try value(depth: depth + 1))
                skipWS()
                guard i < b.count else { throw JSONParseError("unexpected end of JSON") }
                if b[i] == UInt8(ascii: ",") { i += 1; continue }
                if b[i] == UInt8(ascii: "]") { i += 1; return .array(a) }
                throw JSONParseError("expected ',' or ']'")
            }
        case UInt8(ascii: "\""):
            return .string(try string())
        case UInt8(ascii: "t"):
            try literal("true"); return .bool(true)
        case UInt8(ascii: "f"):
            try literal("false"); return .bool(false)
        case UInt8(ascii: "n"):
            try literal("null"); return .null
        default:
            return try number()
        }
    }

    mutating func literal(_ s: String) throws {
        let u = Array(s.utf8)
        guard i + u.count <= b.count, Array(b[i..<i + u.count]) == u else { throw JSONParseError("invalid literal") }
        i += u.count
    }

    mutating func number() throws -> JSONValue {
        let start = i
        if i < b.count, b[i] == UInt8(ascii: "-") { i += 1 }
        guard i < b.count, b[i] >= 0x30, b[i] <= 0x39 else { throw JSONParseError("invalid number") }
        if b[i] == 0x30 {
            i += 1
        } else {
            while i < b.count, b[i] >= 0x30, b[i] <= 0x39 { i += 1 }
        }
        var isInt = true
        if i < b.count, b[i] == UInt8(ascii: ".") {
            isInt = false
            i += 1
            guard i < b.count, b[i] >= 0x30, b[i] <= 0x39 else { throw JSONParseError("invalid number") }
            while i < b.count, b[i] >= 0x30, b[i] <= 0x39 { i += 1 }
        }
        if i < b.count, b[i] == UInt8(ascii: "e") || b[i] == UInt8(ascii: "E") {
            isInt = false
            i += 1
            if i < b.count, b[i] == UInt8(ascii: "+") || b[i] == UInt8(ascii: "-") { i += 1 }
            guard i < b.count, b[i] >= 0x30, b[i] <= 0x39 else { throw JSONParseError("invalid number") }
            while i < b.count, b[i] >= 0x30, b[i] <= 0x39 { i += 1 }
        }
        let text = String(decoding: b[start..<i], as: UTF8.self)
        if isInt, let v = Int64(text) { return .int(v) }
        guard let d = Double(text) else { throw JSONParseError("invalid number") }
        return .double(d)
    }

    mutating func hex4() throws -> UInt32 {
        guard i + 4 <= b.count else { throw JSONParseError("bad \\u escape") }
        var v: UInt32 = 0
        for _ in 0..<4 {
            let c = b[i]
            v <<= 4
            switch c {
            case 0x30...0x39: v |= UInt32(c - 0x30)
            case 0x41...0x46: v |= UInt32(c - 0x41 + 10)
            case 0x61...0x66: v |= UInt32(c - 0x61 + 10)
            default: throw JSONParseError("bad \\u escape")
            }
            i += 1
        }
        return v
    }

    mutating func string() throws -> String {
        i += 1  // opening quote
        var bytes: [UInt8] = []
        while true {
            guard i < b.count else { throw JSONParseError("unterminated string") }
            let c = b[i]
            if c == UInt8(ascii: "\"") { i += 1; break }
            if c < 0x20 { throw JSONParseError("control character in string") }
            if c != UInt8(ascii: "\\") { bytes.append(c); i += 1; continue }
            i += 1
            guard i < b.count else { throw JSONParseError("unterminated escape") }
            let e = b[i]
            i += 1
            switch e {
            case UInt8(ascii: "\""): bytes.append(0x22)
            case UInt8(ascii: "\\"): bytes.append(0x5C)
            case UInt8(ascii: "/"): bytes.append(0x2F)
            case UInt8(ascii: "b"): bytes.append(0x08)
            case UInt8(ascii: "f"): bytes.append(0x0C)
            case UInt8(ascii: "n"): bytes.append(0x0A)
            case UInt8(ascii: "r"): bytes.append(0x0D)
            case UInt8(ascii: "t"): bytes.append(0x09)
            case UInt8(ascii: "u"):
                var cp = try hex4()
                if cp >= 0xD800, cp < 0xDC00 {
                    if i + 6 <= b.count, b[i] == UInt8(ascii: "\\"), b[i + 1] == UInt8(ascii: "u") {
                        let save = i
                        i += 2
                        let lo = try hex4()
                        if lo >= 0xDC00, lo < 0xE000 {
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)
                        } else {
                            i = save
                            cp = 0xFFFD
                        }
                    } else {
                        cp = 0xFFFD
                    }
                } else if cp >= 0xDC00, cp < 0xE000 {
                    cp = 0xFFFD
                }
                let scalar = Unicode.Scalar(cp) ?? "\u{FFFD}"
                bytes.append(contentsOf: Array(String(Character(scalar)).utf8))
            default:
                throw JSONParseError("invalid escape")
            }
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
