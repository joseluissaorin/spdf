import CSPDF
import Foundation

#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif

#if canImport(SQLite3)
import SQLite3
#endif

/// A validation error or warning.
public struct ValidationIssue: Sendable, Hashable, Codable {
    public var code: String
    public var message: String
    public var location: String

    enum CodingKeys: String, CodingKey {
        case code, message
        case location = "where"
    }
}

/// The result of `SPDFValidator.validate` (contract §12).
public struct ValidationResult: Sendable, Hashable, Codable {
    public var valid: Bool
    public var version: String?
    public var profile: [String]
    public var errors: [ValidationIssue]
    public var warnings: [ValidationIssue]

    /// Error codes, sorted and unique.
    public var errorCodes: [String] { Array(Set(errors.map(\.code))).sorted() }
    /// Warning codes, sorted and unique.
    public var warningCodes: [String] { Array(Set(warnings.map(\.code))).sorted() }

    public var jsonValue: JSONValue {
        let issues: ([ValidationIssue]) -> JSONValue = { l in
            .array(l.map { .object(["code": .string($0.code), "message": .string($0.message), "where": .string($0.location)]) })
        }
        return .object(["valid": .bool(valid), "version": version.map { .string($0) } ?? .null,
                        "profile": .array(profile.map { .string($0) }), "errors": issues(errors), "warnings": issues(warnings)])
    }
}

/// Validation of SPDF files.
public enum SPDFValidator {
    /// Checks a file and reports every problem found, in the order of contract §12.
    public static func validate(_ url: URL, options: SPDFOpenOptions = SPDFOpenOptions()) -> ValidationResult {
        validate(path: url.path, options: options)
    }

    public static func validate(path: String, options: SPDFOpenOptions = SPDFOpenOptions()) -> ValidationResult {
        var v = Run()
        do {
            let f = try SPDFFile.open(path: path, options: options, lenient: true)
            defer { f.close() }
            f.locked { v.run(f) }
        } catch let e as SPDFError {
            v.err(e.code == "E002" ? "E002" : "E001", e.location, e.message)
        } catch {
            v.err("E001", path, "\(error)")
        }
        return ValidationResult(valid: v.errors.isEmpty, version: v.version, profile: v.profile, errors: v.errors, warnings: v.warnings)
    }

    /// Checks one parsed anchor: nil when valid, else (code, message). `text`
    /// is the unit text that "chars" must fit in, if known.
    public static func checkAnchor(_ g: JSONValue, text: String?) -> (code: String, message: String)? {
        guard case .object(let m) = g else { return ("E040", "anchor is not an object") }
        guard let type = m["type"]?.stringValue else { return ("E040", "anchor without type") }
        guard Schema.anchorTypes.contains(type) else { return ("E041", "unknown anchor type \(type)") }
        let isInt: (JSONValue?) -> Bool = { integral($0) != nil }
        let isStr: (JSONValue?) -> Bool = { $0?.stringValue != nil }
        var ok = true
        switch type {
        case "page":
            if let p = integral(m["physical"]), p >= 1, let pr = m["printed"], pr.isNull || pr.stringValue != nil {} else { ok = false }
        case "time":
            if let t0 = m["t0"]?.doubleValue, let t1 = m["t1"]?.doubleValue, 0 <= t0, t0 <= t1 {} else { ok = false }
        case "section":
            if case .array(let a)? = m["path"], a.allSatisfy({ $0.stringValue != nil }) {} else { ok = false }
        case "slide":
            if let n = integral(m["n"]), n >= 1 {} else { ok = false }
        case "sheet":
            ok = isStr(m["sheet"]) && isInt(m["row_from"]) && isInt(m["row_to"])
        case "web":
            ok = isStr(m["url"])
        case "verse":
            ok = isInt(m["line_from"])
        case "canonical":
            ok = isStr(m["scheme"]) && isStr(m["ref"])
        default:
            break
        }
        if !ok { return ("E040", "\(type) anchor misses or mistypes a required member") }
        if let r = m["region"] {
            guard case .object(let ro) = r, ["x", "y", "w", "h"].allSatisfy({ ro[$0]?.isNumber == true }) else {
                return ("E040", "bad region")
            }
        }
        if let c = m["chars"] {
            guard case .array(let a) = c, a.count == 2, let s = integral(a[0]), let e = integral(a[1]) else {
                return ("E040", "bad chars")
            }
            if let text {
                let n = Int64(text.precomposedStringWithCanonicalMapping.unicodeScalars.count)
                if !(0 <= s && s <= e && e <= n) { return ("E042", "chars [\(s), \(e)] out of range (\(n) code points)") }
            }
        }
        return nil
    }

    /// A JSON number with an integral value (10 and 10.0 are the same JSON value).
    static func integral(_ v: JSONValue?) -> Int64? {
        switch v {
        case .int(let i)?: return i
        case .double(let d)? where d.isFinite && d == d.rounded() && Swift.abs(d) < 9.2e18: return Int64(d)
        default: return nil
        }
    }

    static func verifySignature(hash: String, signature: String, signer: String?) -> Bool {
        guard let signer, signer.hasPrefix("ed25519:"),
              let pub = Data(base64Encoded: String(signer.dropFirst(8))), pub.count == 32,
              let sig = Data(base64Encoded: signature), sig.count == 64,
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: pub)
        else { return false }
        return key.isValidSignature(sig, for: Data(("spdf-content-sha256:" + hash).utf8))
    }

    struct Run {
        var errors: [ValidationIssue] = []
        var warnings: [ValidationIssue] = []
        var version: String?
        var profile: [String] = []

        mutating func err(_ code: String, _ location: String, _ message: String) {
            errors.append(ValidationIssue(code: code, message: message, location: location))
        }

        mutating func warn(_ code: String, _ location: String, _ message: String) {
            warnings.append(ValidationIssue(code: code, message: message, location: location))
        }

        mutating func anchor(_ raw: SQLValue, _ location: String, text: String?) -> Anchor? {
            guard let s = raw.string, let g = try? JSONValue.parse(s) else {
                err("E040", location, "anchor is not valid JSON")
                return nil
            }
            if let (code, msg) = SPDFValidator.checkAnchor(g, text: text) {
                err(code, location, msg)
                return nil
            }
            return Anchor(g)
        }

        mutating func run(_ f: SPDFFile) {
            version = f.version
            let objects = ((try? f.db.query("SELECT name, type FROM sqlite_master WHERE type IN ('trigger', 'view') ORDER BY name")) ?? [])
                .map { ($0[0].string ?? "", $0[1].string ?? "") }
            if f.isLegacy {
                warn("W110", "", "legacy SPDF \(f.version) file")
                for t in ["spdf", "documentos", "unidades", "fragmentos", "fragmentos_fts"] where !f.tables.contains(t) {
                    err("E010", t, "missing legacy table \(t)")
                }
                for (name, type) in objects where !(type == "trigger" && Schema.legacyTriggers.contains(name)) {
                    err("E020", name, "\(type) \(name) present")
                }
                return
            }
            if f.isGzipped { warn("E003", f.path, "SPDF 5.x files should not be gzip-wrapped") }
            if f.version != "5.0" { warn("W105", "user_version", "newer minor version \(f.version)") }
            for (name, type) in objects { err("E020", name, "\(type) \(name) present") }
            for name in f.foreignVirtualTables() { err("E020", name, "virtual table \(name) present") }
            var present: [String: Set<String>] = [:]
            for t in Schema.requiredTables {
                guard f.tables.contains(t) else {
                    err("E010", t, "missing table \(t)")
                    continue
                }
                if t == "fragments_fts" {
                    present[t] = []
                    continue
                }
                let have = f.columns[t] ?? []
                present[t] = have
                for c in Schema.columns[t]! where !have.contains(c) { err("E011", "\(t).\(c)", "missing column \(t).\(c)") }
            }
            func has(_ t: String, _ cols: String...) -> Bool {
                guard let p = present[t] else { return false }
                return cols.allSatisfy { p.contains($0) }
            }
            var meta: [String: String] = [:]
            if has("spdf_meta", "key", "value") {
                meta = (try? f.metaUnlocked()) ?? [:]
                for k in Schema.requiredMetaKeys where meta[k] == nil { err("E012", k, "missing spdf_meta key \(k)") }
                profile = (meta["profile"] ?? "").split(whereSeparator: { $0.isWhitespace }).map(String.init)
            }
            var unitCount: SQLValue = .null
            var nDocs = 0
            if has("documents", "id", "metadata") {
                let cols = has("documents", "rights", "unit_count") ? ["id", "metadata", "rights", "unit_count"] : ["id", "metadata"]
                if let rows = try? f.rows("documents", cols) {
                    nDocs = rows.count
                    if nDocs != 1 { err("E013", "documents", "documents has \(nDocs) rows") } else { unitCount = rows[0]["unit_count"] ?? .null }
                    for r in rows {
                        let id = r["id"]?.string ?? ""
                        if let s = r["metadata"]?.string, let g = try? JSONValue.parse(s) {
                            if !(g["type"]?.stringValue != nil && g["title"]?.stringValue != nil) {
                                err("E051", id, "metadata needs a string type and title")
                            }
                        } else {
                            err("E050", id, "metadata is not valid JSON")
                        }
                        if let rs = r["rights"]?.string, (try? JSONValue.parse(rs)) == nil {
                            err("E050", id, "rights is not valid JSON")
                        }
                    }
                }
            }
            if has("extensions", "name", "required") {
                for r in (try? f.db.query("SELECT name, required FROM extensions ORDER BY name")) ?? [] {
                    let name = r[0].string ?? ""
                    if r[1].json.truthy && !SPDFFile.knownExtensions.contains(name) {
                        err("E060", name, "unknown required extension \(name)")
                    }
                }
            }
            var texts: [String: String] = [:]
            var hasTime = false
            if has("units", "id", "ord", "anchor", "text"), let rows = try? f.rows("units", ["id", "ord", "anchor", "text"], "ORDER BY ord, id") {
                for (i, r) in rows.enumerated() {
                    guard let o = r["ord"]?.int, o == Int64(i + 1) else {
                        err("E090", "units", "units.ord is not 1..N")
                        break
                    }
                }
                if nDocs == 1, !unitCount.isNull, unitCount.int != Int64(rows.count) {
                    warn("W102", "documents.unit_count", "unit_count \(unitCount.json.canonicalJSON) but \(rows.count) units")
                }
                for r in rows {
                    let id = r["id"]?.string ?? ""
                    let text = r["text"]?.string ?? ""
                    texts[id] = text
                    if let a = anchor(r["anchor"] ?? .null, "units/\(id)", text: text), a.type == "time" { hasTime = true }
                }
            }
            if has("fragments", "id", "unit", "anchor"), let rows = try? f.rows("fragments", ["id", "unit", "anchor", "anchor_end"], "ORDER BY n") {
                for r in rows {
                    let id = r["id"]?.string ?? ""
                    _ = anchor(r["anchor"] ?? .null, "fragments/\(id)", text: texts[r["unit"]?.string ?? ""])
                    if let e = r["anchor_end"], !e.isNull { _ = anchor(e, "fragments/\(id)/anchor_end", text: nil) }
                }
            }
            if has("figures", "id", "unit", "anchor"), let rows = try? f.rows("figures", ["id", "unit", "anchor"], "ORDER BY id") {
                for r in rows {
                    _ = anchor(r["anchor"] ?? .null, "figures/\(r["id"]?.string ?? "")", text: texts[r["unit"]?.string ?? ""])
                }
            }
            var spaces: [String: (Int64, String)] = [:]
            if has("spaces", "id", "dims", "dtype"), let rows = try? f.rows("spaces", ["id", "dims", "dtype"], "ORDER BY id") {
                for r in rows {
                    let id = r["id"]?.string ?? "", dt = r["dtype"]?.string ?? ""
                    spaces[id] = (r["dims"]?.int ?? 0, dt)
                    if dtypeSize(dt) == 0 { err("E032", id, "unknown dtype \(dt)") }
                }
            }
            var nVectors = 0
            if has("vectors", "target", "id", "space", "data"),
               let rows = try? f.db.query("SELECT target, id, space, typeof(data), length(data) FROM vectors ORDER BY space, target, id")
            {
                for r in rows {
                    nVectors += 1
                    let space = r[2].string ?? ""
                    let location = "vectors/\(space)/\(r[0].string ?? "")/\(r[1].string ?? "")"
                    guard let sp = spaces[space] else {
                        err("E031", location, "unknown space \(space)")
                        continue
                    }
                    let size = dtypeSize(sp.1)
                    if size == 0 { continue }
                    if r[3].string != "blob" || r[4].int != sp.0 * Int64(size) {
                        err("E030", location, "vector length \(r[4].int ?? -1) != \(sp.0) x \(size)")
                    }
                }
            }
            if f.tables.contains("fragments_fts") {
                if let e = SPDFValidator.ftsIntegrity(f) { err("E070", "fragments_fts", "FTS index out of sync: \(e)") }
            }
            if has("blobs", "key", "sha256", "data"), let rows = try? f.db.query("SELECT key, sha256, data FROM blobs ORDER BY key") {
                for r in rows where sha256Hex(r[2].data ?? Data()) != r[1].string {
                    err("E080", r[0].string ?? "", "blob sha256 mismatch")
                }
            }
            if let want = meta["content_sha256"], errors.isEmpty {
                let got = try? f.contentSHA256Unlocked()
                if got != want {
                    err("E081", "spdf_meta.content_sha256", "content_sha256 does not match the canonical dump")
                } else if let sig = meta["signature"], !SPDFValidator.verifySignature(hash: want, signature: sig, signer: meta["signer"]) {
                    err("E082", "spdf_meta.signature", "signature does not verify")
                }
            }
            if profile.contains("semantic") && nVectors == 0 { warn("W100", "", "profile semantic without vectors") }
            if profile.contains("media") && has("units", "anchor") && !hasTime { warn("W101", "", "profile media without time anchors") }
        }
    }

    /// FTS5 'integrity-check' (rank 1: also against the content table) on an
    /// in-memory copy, since the command is a write.
    static func ftsIntegrity(_ f: SPDFFile) -> String? {
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: f.physical))
            let mem = try SQLiteDB(path: ":memory:", flags: SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)
            defer { mem.close() }
            mem.enableDefensive()
            try mem.exec("PRAGMA trusted_schema = OFF")
            try mem.deserialize(data)
            var tables = [f.table("fragments_fts")]
            if f.tables.contains("fragments_fts_trigram") { tables.append("fragments_fts_trigram") }
            for t in tables {
                let q = quoteIdent(t)
                try mem.run("INSERT INTO \(q)(\(q), rank) VALUES ('integrity-check', 1)")
            }
            return nil
        } catch {
            return "\(error)"
        }
    }
}
