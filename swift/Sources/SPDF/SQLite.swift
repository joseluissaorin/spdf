import CSPDF
import Foundation

#if canImport(SQLite3)
import SQLite3
#endif

/// A value read from or bound to SQLite.
enum SQLValue: Sendable {
    case null
    case int(Int64)
    case double(Double)
    case text(String)
    case blob(Data)

    var string: String? {
        switch self {
        case .text(let s): return s
        case .blob(let d): return String(decoding: d, as: UTF8.self)
        default: return nil
        }
    }

    var int: Int64? {
        switch self {
        case .int(let i): return i
        case .double(let d) where d == d.rounded(): return Int64(d)
        default: return nil
        }
    }

    var double: Double? {
        switch self {
        case .int(let i): return Double(i)
        case .double(let d): return d
        default: return nil
        }
    }

    var data: Data? {
        switch self {
        case .blob(let d): return d
        case .text(let s): return Data(s.utf8)
        default: return nil
        }
    }

    var isNull: Bool { if case .null = self { return true } else { return false } }

    /// The JSON value of a column (TEXT → string, INTEGER → int, REAL → number).
    var json: JSONValue {
        switch self {
        case .null: return .null
        case .int(let i): return .int(i)
        case .double(let d): return .double(d)
        case .text(let s): return .string(s)
        case .blob(let d): return .string(String(decoding: d, as: UTF8.self))
        }
    }
}

private let SQLITE_TRANSIENT_PTR = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// A minimal SQLite connection wrapper. Not thread-safe by itself; owners
/// serialize access.
final class SQLiteDB {
    private(set) var handle: OpaquePointer?

    init(path: String, flags: Int32) throws {
        var db: OpaquePointer?
        let rc = sqlite3_open_v2(path, &db, flags, nil)
        if rc != SQLITE_OK {
            let msg = db.map { String(cString: sqlite3_errmsg($0)) } ?? "cannot open"
            sqlite3_close_v2(db)
            throw SPDFError("E001", "cannot open: \(msg)")
        }
        handle = db
        sqlite3_extended_result_codes(db, 1)
    }

    deinit { close() }

    func close() {
        if let h = handle {
            sqlite3_close_v2(h)
            handle = nil
        }
    }

    var errorMessage: String {
        guard let h = handle else { return "closed" }
        return String(cString: sqlite3_errmsg(h))
    }

    func enableDefensive() { if let h = handle { _ = cspdf_enable_defensive(h) } }

    func setLengthLimit(_ n: Int64) {
        if let h = handle { sqlite3_limit(h, SQLITE_LIMIT_LENGTH, Int32(clamping: n)) }
    }

    func exec(_ sql: String) throws {
        guard let h = handle else { throw SPDFError("E001", "database is closed") }
        var err: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(h, sql, nil, nil, &err)
        if rc != SQLITE_OK {
            let msg = err.map { String(cString: $0) } ?? errorMessage
            sqlite3_free(err)
            throw SQLiteError(code: rc, message: msg)
        }
    }

    private func prepare(_ sql: String, _ args: [SQLValue]) throws -> OpaquePointer {
        guard let h = handle else { throw SPDFError("E001", "database is closed") }
        var stmt: OpaquePointer?
        let rc = sqlite3_prepare_v2(h, sql, -1, &stmt, nil)
        guard rc == SQLITE_OK, let st = stmt else {
            throw SQLiteError(code: rc, message: errorMessage + " in: " + sql)
        }
        for (i, a) in args.enumerated() {
            let idx = Int32(i + 1)
            let r: Int32
            switch a {
            case .null: r = sqlite3_bind_null(st, idx)
            case .int(let v): r = sqlite3_bind_int64(st, idx, v)
            case .double(let v): r = sqlite3_bind_double(st, idx, v)
            case .text(let s): r = sqlite3_bind_text(st, idx, s, -1, SQLITE_TRANSIENT_PTR)
            case .blob(let d):
                r = d.withUnsafeBytes { p in
                    sqlite3_bind_blob64(st, idx, p.baseAddress ?? UnsafeRawPointer(bitPattern: 1), sqlite3_uint64(d.count), SQLITE_TRANSIENT_PTR)
                }
            }
            if r != SQLITE_OK {
                sqlite3_finalize(st)
                throw SQLiteError(code: r, message: errorMessage)
            }
        }
        return st
    }

    private static func column(_ st: OpaquePointer, _ i: Int32) -> SQLValue {
        switch sqlite3_column_type(st, i) {
        case SQLITE_NULL: return .null
        case SQLITE_INTEGER: return .int(sqlite3_column_int64(st, i))
        case SQLITE_FLOAT: return .double(sqlite3_column_double(st, i))
        case SQLITE_TEXT:
            let n = Int(sqlite3_column_bytes(st, i))
            guard let p = sqlite3_column_text(st, i) else { return .text("") }
            return .text(String(decoding: UnsafeBufferPointer(start: p, count: n), as: UTF8.self))
        default:
            let n = Int(sqlite3_column_bytes(st, i))
            guard n > 0, let p = sqlite3_column_blob(st, i) else { return .blob(Data()) }
            return .blob(Data(bytes: p, count: n))
        }
    }

    /// Runs a query and returns every row.
    func query(_ sql: String, _ args: [SQLValue] = []) throws -> [[SQLValue]] {
        let st = try prepare(sql, args)
        defer { sqlite3_finalize(st) }
        var out: [[SQLValue]] = []
        let n = sqlite3_column_count(st)
        while true {
            let rc = sqlite3_step(st)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw SQLiteError(code: rc, message: errorMessage) }
            var row: [SQLValue] = []
            row.reserveCapacity(Int(n))
            for i in 0..<n { row.append(SQLiteDB.column(st, i)) }
            out.append(row)
        }
        return out
    }

    /// Runs a query row by row (for large scans).
    func forEach(_ sql: String, _ args: [SQLValue] = [], _ body: ([SQLValue]) throws -> Void) throws {
        let st = try prepare(sql, args)
        defer { sqlite3_finalize(st) }
        let n = sqlite3_column_count(st)
        while true {
            let rc = sqlite3_step(st)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw SQLiteError(code: rc, message: errorMessage) }
            var row: [SQLValue] = []
            for i in 0..<n { row.append(SQLiteDB.column(st, i)) }
            try body(row)
        }
    }

    /// Runs a statement that returns no rows.
    func run(_ sql: String, _ args: [SQLValue] = []) throws {
        let st = try prepare(sql, args)
        defer { sqlite3_finalize(st) }
        var rc = sqlite3_step(st)
        while rc == SQLITE_ROW { rc = sqlite3_step(st) }
        guard rc == SQLITE_DONE else { throw SQLiteError(code: rc, message: errorMessage) }
    }

    /// Loads a database image into this (in-memory) connection.
    func deserialize(_ data: Data) throws {
        guard let h = handle else { throw SPDFError("E001", "database is closed") }
        let n = data.count
        guard let p = sqlite3_malloc64(sqlite3_uint64(max(n, 1))) else { throw SPDFError("E001", "out of memory") }
        data.withUnsafeBytes { src in
            if let b = src.baseAddress { memcpy(p, b, n) }
        }
        let flags = UInt32(SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE)
        let rc = sqlite3_deserialize(h, "main", p.assumingMemoryBound(to: UInt8.self), sqlite3_int64(n), sqlite3_int64(n), flags)
        if rc != SQLITE_OK { throw SQLiteError(code: rc, message: errorMessage) }
    }
}

/// A raw SQLite error.
struct SQLiteError: Error, CustomStringConvertible {
    let code: Int32
    let message: String
    var description: String { "SQLite error \(code): \(message)" }
}

func quoteIdent(_ s: String) -> String { "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
