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

/// How a file is opened. The defaults are safe.
public struct SPDFOpenOptions: Sendable {
    /// Cap for any single string or blob (SQLITE_LIMIT_LENGTH).
    public var maxBlobSize: Int64 = SPDF.defaultMaxBlobSize
    /// Cap for a gunzipped file.
    public var maxDecompressedSize: Int64 = SPDF.defaultMaxDecompressedSize

    public init(maxBlobSize: Int64 = SPDF.defaultMaxBlobSize, maxDecompressedSize: Int64 = SPDF.defaultMaxDecompressedSize) {
        self.maxBlobSize = maxBlobSize
        self.maxDecompressedSize = maxDecompressedSize
    }
}

func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private let sqliteMagic = Array("SQLite format 3\u{0}".utf8)

/// An open SPDF file (5.0 or legacy 4.x), read-only. Opening is defensive:
/// read-only, `query_only`, `trusted_schema=OFF`, SQLITE_DBCONFIG_DEFENSIVE,
/// no extensions, and triggers or views (other than the three legacy FTS
/// triggers) are refused. Thread-safe: calls are serialized.
public final class SPDFFile: @unchecked Sendable {
    let db: SQLiteDB
    let lock = NSLock()
    /// Path the file was opened from.
    public let path: String
    /// SPDF version ("5.0", "4.1", "4.0").
    public let version: String
    /// The file uses the legacy 4.x (Spanish) schema.
    public let isLegacy: Bool
    /// The file was gzip-wrapped.
    public let isGzipped: Bool
    let physical: String
    let temporary: String?
    let userVersion: Int64
    let tables: Set<String>
    let columns: [String: Set<String>]
    private var blobKeysCache: Set<String>?

    /// Opens an SPDF file safely.
    public static func open(_ url: URL, options: SPDFOpenOptions = SPDFOpenOptions()) throws -> SPDFFile {
        try open(path: url.path, options: options, lenient: false)
    }

    /// Opens an SPDF file safely.
    public static func open(path: String, options: SPDFOpenOptions = SPDFOpenOptions()) throws -> SPDFFile {
        try open(path: path, options: options, lenient: false)
    }

    /// Opens an SPDF held in memory (gzip-wrapped or not). The bytes go to a
    /// temporary file removed when the file is closed.
    public static func open(data: Data, options: SPDFOpenOptions = SPDFOpenOptions()) throws -> SPDFFile {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("spdf-\(UUID().uuidString).spdf").path
        try data.write(to: URL(fileURLWithPath: tmp))
        defer { try? FileManager.default.removeItem(atPath: tmp) }
        return try open(path: tmp, options: options, lenient: false, display: "")
    }

    static func open(path: String, options: SPDFOpenOptions, lenient: Bool, display: String? = nil) throws -> SPDFFile {
        guard let fh = FileHandle(forReadingAtPath: path) else {
            throw SPDFError("E001", "cannot read file", location: path)
        }
        let head = [UInt8](fh.readData(ofLength: 100))
        try? fh.close()
        let gz = head.count >= 2 && head[0] == 0x1F && head[1] == 0x8B
        var tmp: String?
        if gz {
            tmp = try gunzipToTemp(path, limit: options.maxDecompressedSize)
        } else if head.count < 100 || Array(head[0..<16]) != sqliteMagic {
            throw SPDFError("E001", "not an SQLite database", location: path)
        } else if head[18] == 2 || head[19] == 2 {
            tmp = try copyToTemp(path, limit: options.maxDecompressedSize)
        }
        do {
            let f = try SPDFFile(physical: tmp ?? path, display: display ?? path, temporary: tmp, gzipped: gz, options: options, lenient: lenient)
            return f
        } catch {
            if let t = tmp { try? FileManager.default.removeItem(atPath: t) }
            throw error
        }
    }

    private static func tempPath() -> String {
        FileManager.default.temporaryDirectory.appendingPathComponent("spdf-\(UUID().uuidString).sqlite").path
    }

    private static func gunzipToTemp(_ path: String, limit: Int64) throws -> String {
        let tmp = tempPath()
        let rc = cspdf_gunzip_file(path, tmp, limit)
        if rc != 0 {
            try? FileManager.default.removeItem(atPath: tmp)
            throw SPDFError("E001", rc == -2 ? "decompressed size exceeds \(limit) bytes" : "invalid gzip stream", location: path)
        }
        try fixHeader(tmp)
        return tmp
    }

    private static func copyToTemp(_ path: String, limit: Int64) throws -> String {
        let tmp = tempPath()
        try FileManager.default.copyItem(atPath: path, toPath: tmp)
        try fixHeader(tmp)
        return tmp
    }

    /// Checks the SQLite magic of a temp copy and switches a WAL header back
    /// to rollback-journal mode.
    private static func fixHeader(_ tmp: String) throws {
        guard let fh = FileHandle(forUpdatingAtPath: tmp) else { throw SPDFError("E001", "cannot open temporary copy") }
        defer { try? fh.close() }
        let head = [UInt8](fh.readData(ofLength: 100))
        guard head.count >= 100, Array(head[0..<16]) == sqliteMagic else {
            try? FileManager.default.removeItem(atPath: tmp)
            throw SPDFError("E001", "not an SQLite database")
        }
        if head[18] == 2 || head[19] == 2 {
            fh.seek(toFileOffset: 18)
            fh.write(Data([1, 1]))
        }
    }

    private init(physical: String, display: String, temporary: String?, gzipped: Bool, options: SPDFOpenOptions, lenient: Bool) throws {
        let uri = "file:" + (physical.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? physical) + "?mode=ro"
        let db = try SQLiteDB(path: uri, flags: SQLITE_OPEN_READONLY | SQLITE_OPEN_URI | SQLITE_OPEN_FULLMUTEX)
        self.db = db
        self.path = display
        self.physical = physical
        self.temporary = temporary
        self.isGzipped = gzipped
        db.enableDefensive()
        db.setLengthLimit(options.maxBlobSize)
        do {
            try db.exec("PRAGMA query_only = 1; PRAGMA trusted_schema = OFF;")
        } catch {
            throw SPDFError("E001", "not an SQLite database: \(error)", location: display)
        }
        let entries: [[SQLValue]]
        do {
            entries = try db.query("SELECT type, name FROM sqlite_master")
        } catch {
            throw SPDFError("E001", "not an SQLite database: \(error)", location: display)
        }
        var tables = Set<String>()
        for e in entries where e[0].string == "table" { tables.insert(e[1].string ?? "") }
        self.tables = tables
        let appID: Int64 = (try? db.query("PRAGMA application_id").first?.first?.int) ?? 0
        let uv: Int64 = (try? db.query("PRAGMA user_version").first?.first?.int) ?? 0
        self.userVersion = uv
        var legacy = false
        var version = ""
        if appID == SPDF.applicationID {
            guard uv >= 500, uv <= 599 else { throw SPDFError("E002", "unknown user_version \(uv)", location: display) }
            version = "\(uv / 100).\((uv % 100) / 10)"
        } else if tables.contains("spdf") && tables.contains("documentos") {
            legacy = true
            let v: String? = (try? db.query("SELECT valor FROM spdf WHERE clave = 'spdf_version'").first?.first?.string) ?? nil
            if let v, v.hasPrefix("4.") {
                version = v
            } else if uv == 400 || uv == 410 {
                version = "\(uv / 100).\((uv % 100) / 10)"
            } else {
                throw SPDFError("E002", "unknown legacy version", location: display)
            }
        } else {
            throw SPDFError("E002", "unknown application_id \(appID) / user_version \(uv)", location: display)
        }
        self.isLegacy = legacy
        self.version = version
        if !lenient {
            for e in entries {
                let type = e[0].string ?? "", name = e[1].string ?? ""
                if type == "view" || (type == "trigger" && !(legacy && Schema.legacyTriggers.contains(name))) {
                    throw SPDFError("E020", "\(type)s are not allowed in an SPDF file", location: name)
                }
            }
        }
        if !lenient && !legacy {
            if let bad = SPDFFile.foreignVirtualTables(db).first {
                throw SPDFError("E020", "virtual table \(bad) is not allowed in an SPDF file", location: bad)
            }
        }
        var cols: [String: Set<String>] = [:]
        for t in tables where !t.hasPrefix("sqlite_") && !t.contains("_fts") {
            let rows = (try? db.query("SELECT name FROM pragma_table_info(?)", [.text(t)])) ?? []
            cols[t] = Set(rows.compactMap { $0.first?.string })
        }
        self.columns = cols
        if !lenient, !legacy, tables.contains("extensions"), cols["extensions"]?.contains("required") == true {
            let rows = (try? db.query("SELECT name FROM extensions WHERE required <> 0 ORDER BY name")) ?? []
            for r in rows {
                let name = r[0].string ?? ""
                if !SPDFFile.knownExtensions.contains(name) {
                    throw SPDFError("E060", "unknown required extension", location: name)
                }
            }
        }
    }

    /// Virtual tables other than fragments_fts / fragments_fts_trigram, or not using fts5 (E020).
    static func foreignVirtualTables(_ db: SQLiteDB) -> [String] {
        let rows = (try? db.query("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%' ORDER BY name")) ?? []
        return rows.compactMap { r in
            let name = r[0].string ?? "", sql = r[1].string ?? ""
            let fts5 = sql.range(of: #"USING\s+fts5\s*\("#, options: [.regularExpression, .caseInsensitive]) != nil
            return (name == "fragments_fts" || name == "fragments_fts_trigram") && fts5 ? nil : name
        }
    }

    func foreignVirtualTables() -> [String] { SPDFFile.foreignVirtualTables(db) }

    /// Extensions this implementation understands.
    static let knownExtensions: Set<String> = []

    deinit { close() }

    /// Releases the file (and removes the temporary copy, if any).
    public func close() {
        lock.lock()
        defer { lock.unlock() }
        db.close()
        if let t = temporary { try? FileManager.default.removeItem(atPath: t) }
    }

    func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    // MARK: Mapped queries

    func table(_ t5: String) -> String { isLegacy ? (Schema.legacyTable[t5] ?? t5) : t5 }
    func hasTable(_ t5: String) -> Bool { tables.contains(table(t5)) }

    func col(_ t5: String, _ c: String) -> String {
        if isLegacy, let l = Schema.legacyColumns[t5]?[c], !l.isEmpty { return quoteIdent(l) }
        return quoteIdent(c)
    }

    func selectList(_ t5: String, _ cols: [String]) -> String {
        let present = columns[table(t5)] ?? []
        return cols.map { c -> String in
            var src = c
            if isLegacy, let l = Schema.legacyColumns[t5]?[c] { src = l }
            if src.isEmpty || !present.contains(src) {
                if isLegacy, let lit = Schema.legacyDefaults["\(t5).\(c)"] { return "\(lit) AS \(quoteIdent(c))" }
                return "NULL AS \(quoteIdent(c))"
            }
            return "\(quoteIdent(src)) AS \(quoteIdent(c))"
        }.joined(separator: ", ")
    }

    /// Rows of a 5.0 table (mapped for legacy files) as column → value.
    func rows(_ t5: String, _ cols: [String], _ tail: String = "", _ args: [SQLValue] = []) throws -> [[String: SQLValue]] {
        guard hasTable(t5) else { return [] }
        var sql = "SELECT \(selectList(t5, cols)) FROM \(quoteIdent(table(t5)))"
        if !tail.isEmpty { sql += " " + tail }
        return try db.query(sql, args).map { r in
            var m: [String: SQLValue] = [:]
            for (i, c) in cols.enumerated() { m[c] = r[i] }
            return m
        }
    }

    func blobKeys() throws -> Set<String> {
        if let k = blobKeysCache { return k }
        var keys = Set<String>()
        if hasTable("blobs") {
            for r in try db.query("SELECT \(col("blobs", "key")) FROM blobs") { if let s = r[0].string { keys.insert(s) } }
        }
        blobKeysCache = keys
        return keys
    }

    // MARK: Dump

    static func parseJSONColumn(_ v: SQLValue) -> JSONValue {
        guard let s = v.string else { return v.json }
        return (try? JSONValue.parse(s)) ?? .string(s)
    }

    func dumpRows(_ t5: String, _ order: String) throws -> [JSONValue] {
        let cols = Schema.columns[t5]!
        let jsonCols = Schema.jsonColumns[t5] ?? []
        return try rows(t5, cols, order).map { r in
            var o: [String: JSONValue] = [:]
            for c in cols where c != "document" {
                let v = r[c] ?? .null
                if jsonCols.contains(c) {
                    var j = SPDFFile.parseJSONColumn(v)
                    if isLegacy && (c == "anchor" || c == "anchor_end") { j = Legacy.anchor(j) }
                    o[c] = j
                } else {
                    o[c] = v.json
                }
            }
            return .object(o)
        }
    }

    /// The spdf_meta pairs (legacy keys mapped).
    public func meta() throws -> [String: String] {
        try locked { try metaUnlocked() }
    }

    func metaUnlocked() throws -> [String: String] {
        var m: [String: String] = [:]
        for r in try rows("spdf_meta", ["key", "value"]) {
            var k = r["key"]?.string ?? ""
            if isLegacy, let mk = Schema.legacyMetaKeys[k] { k = mk }
            m[k] = r["value"]?.string ?? ""
        }
        return m
    }

    func documentRow() throws -> [String: JSONValue]? {
        let docs = try dumpRows("documents", "ORDER BY \(col("documents", "id")) LIMIT 1")
        guard case .object(var doc)? = docs.first else { return nil }
        if isLegacy {
            let kind = doc["kind"]?.stringValue ?? ""
            if let k = Schema.legacyKinds[kind] { doc["kind"] = .string(k) }
            doc["metadata"] = Legacy.metadata(doc["metadata"] ?? .null, kind: kind)
            doc["source_ref"] = Legacy.ref(doc["source_ref"] ?? .null, keys: try blobKeys(), keepEmpty: false)
        }
        return doc
    }

    /// The canonical 5.0 view of the file (contract §5).
    public func dump() throws -> JSONValue {
        try locked { try dumpUnlocked() }
    }

    /// The canonical dump serialized with RFC 8785 (JCS).
    public func dumpJSON() throws -> String { try dump().canonicalJSON }

    func dumpUnlocked() throws -> JSONValue {
        let meta = try metaUnlocked()
        var out: [String: JSONValue] = [:]
        out["spdf_version"] = .string(meta["spdf_version"].flatMap { $0.isEmpty ? nil : $0 } ?? version)
        if isLegacy { out["legacy"] = .bool(true) }
        out["meta"] = .object(meta.mapValues { .string($0) })
        out["document"] = try documentRow().map { .object($0) } ?? .null
        for t in ["units", "sections", "fragments", "figures", "spaces"] { out[t] = .array(try tableView(t)) }
        out["vectors"] = try vectorDigests()
        out["blobs"] = try blobList()
        // Provenance is sorted by the UTF-8 bytes of each entry's JCS form (§5).
        let prov = try dumpRows("provenance", "").map { ($0, Array($0.canonicalJSON.utf8)) }
        out["provenance"] = .array(prov.sorted { $0.1.lexicographicallyPrecedes($1.1) }.map(\.0))
        out["fts"] = ftsInfo()
        out["extensions"] = .array(!isLegacy && hasTable("extensions") ? try dumpRows("extensions", "ORDER BY name") : [])
        return .object(out)
    }

    /// One array of the dump (units, sections, fragments, figures, spaces) in
    /// the 5.0 view, without computing the rest.
    func tableView(_ t: String) throws -> [JSONValue] {
        switch t {
        case "units":
            let units = try dumpRows("units", "ORDER BY \(col("units", "ord")), \(col("units", "id"))")
            guard isLegacy else { return units }
            let keys = try blobKeys()
            return units.enumerated().map { i, u in
                guard case .object(var o) = u else { return u }
                o["ord"] = .int(Int64(i + 1))
                o["image"] = Legacy.ref(o["image"] ?? .null, keys: keys, keepEmpty: false)
                o["thumbnail"] = Legacy.ref(o["thumbnail"] ?? .null, keys: keys, keepEmpty: false)
                return .object(o)
            }
        case "sections":
            return try dumpRows("sections", "ORDER BY \(col("sections", "id"))")
        case "fragments":
            return try dumpRows("fragments", "ORDER BY \(col("fragments", "n"))")
        case "figures":
            let figures = try dumpRows("figures", "ORDER BY \(col("figures", "id"))")
            guard isLegacy else { return figures }
            let keys = try blobKeys()
            return figures.map { g in
                guard case .object(var o) = g else { return g }
                o["image"] = Legacy.ref(o["image"] ?? .null, keys: keys, keepEmpty: true)
                return .object(o)
            }
        case "spaces":
            let spaces = try dumpRows("spaces", "ORDER BY \(col("spaces", "id"))")
            guard isLegacy else { return spaces }
            return spaces.map { s in
                guard case .object(var o) = s, case .array(let mods)? = o["modalities"] else { return s }
                o["modalities"] = .array(mods.map { m in
                    if let str = m.stringValue, let mm = Schema.legacyModalities[str] { return .string(mm) }
                    return m
                })
                return .object(o)
            }
        default:
            throw SPDFError("W", "no table view \(t)")
        }
    }

    func vectorDigests() throws -> JSONValue {
        guard hasTable("vectors") else { return .object([:]) }
        var counts: [String: Int64] = [:]
        var hashers: [String: SHA256] = [:]
        try db.forEach("SELECT \(selectList("vectors", ["space", "data"])) FROM \(quoteIdent(table("vectors"))) ORDER BY \(col("vectors", "space")), \(col("vectors", "target")), \(col("vectors", "id"))") { r in
            let space = r[0].string ?? ""
            var h = hashers[space] ?? SHA256()
            h.update(data: r[1].data ?? Data())
            hashers[space] = h
            counts[space, default: 0] += 1
        }
        var out: [String: JSONValue] = [:]
        for (space, h) in hashers {
            let hex = h.finalize().map { String(format: "%02x", $0) }.joined()
            out[space] = .object(["count": .int(counts[space] ?? 0), "sha256": .string(hex)])
        }
        return .object(out)
    }

    func blobList() throws -> JSONValue {
        guard hasTable("blobs") else { return .array([]) }
        var out: [JSONValue] = []
        try db.forEach("SELECT \(selectList("blobs", ["key", "mime", "data"])) FROM blobs ORDER BY \(col("blobs", "key"))") { r in
            let data = r[2].data ?? Data()
            out.append(.object(["key": r[0].json, "mime": r[1].json, "bytes": .int(Int64(data.count)), "sha256": .string(sha256Hex(data))]))
        }
        return .array(out)
    }

    func ftsInfo() -> JSONValue {
        var tokenizer: JSONValue = .null
        if let sql = (try? db.query("SELECT sql FROM sqlite_master WHERE name = ?", [.text(table("fragments_fts"))]).first?.first?.string) ?? nil {
            if let r = sql.range(of: #"tokenize\s*=\s*'([^']*)'"#, options: [.regularExpression, .caseInsensitive]) {
                let m = String(sql[r])
                if let a = m.firstIndex(of: "'"), let b = m.lastIndex(of: "'"), a < b {
                    tokenizer = .string(String(m[m.index(after: a)..<b]))
                }
            } else {
                tokenizer = .string("unicode61")
            }
        }
        return .object(["tokenizer": tokenizer, "trigram": .bool(tables.contains("fragments_fts_trigram"))])
    }

    /// SHA-256 of §8: the JCS dump without meta.content_sha256/signature/signer.
    public func contentSHA256() throws -> String {
        try locked { try contentSHA256Unlocked() }
    }

    func contentSHA256Unlocked() throws -> String {
        guard case .object(var d) = try dumpUnlocked() else { return "" }
        if case .object(var m)? = d["meta"] {
            m["content_sha256"] = nil
            m["signature"] = nil
            m["signer"] = nil
            d["meta"] = .object(m)
        }
        return sha256Hex(Data(JSONValue.object(d).canonicalJSON.utf8))
    }

    /// The document row (5.0 view).
    public func documentInfo() throws -> [String: JSONValue] {
        try locked {
            guard let d = try documentRow() else { throw SPDFError("E013", "no document") }
            return d
        }
    }

    /// The CSL-JSON metadata of the document (legacy files mapped to CSL).
    public func metadata() throws -> [String: JSONValue] {
        try documentInfo()["metadata"]?.objectValue ?? [:]
    }

    /// The docref of the document: "sha256-<hex>" (or the id).
    func docRef() -> String {
        let q = "SELECT \(col("documents", "source_sha256")), id FROM \(quoteIdent(table("documents"))) ORDER BY id LIMIT 1"
        if let r = (try? db.query(q))?.first {
            if let s = r[0].string, !s.isEmpty { return "sha256-" + s.lowercased() }
            if let s = r[1].string { return s }
        }
        return ""
    }
}
