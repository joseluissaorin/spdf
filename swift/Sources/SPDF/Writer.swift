import CSPDF
import Foundation

#if canImport(SQLite3)
import SQLite3
#endif

/// The documents row of a file.
public struct SPDFDocumentInfo: Sendable, Hashable {
    public var id: String
    public var kind: String
    public var metadata: [String: JSONValue]
    public var sourceSHA256: String
    public var sourceRef: String?
    public var mime: String
    public var bytes: Int64
    /// nil: computed from the units written.
    public var unitCount: Int64?
    public var duration: Double?
    /// ISO 8601; nil = now.
    public var created: String?
    /// nil = created.
    public var updated: String?
    public var title: String?
    public var authors: String?
    public var year: Int64?
    public var language: String?
    public var rights: [String: JSONValue]?

    public init(id: String, kind: String, metadata: [String: JSONValue], sourceSHA256: String, sourceRef: String? = nil,
                mime: String, bytes: Int64, unitCount: Int64? = nil, duration: Double? = nil, created: String? = nil,
                updated: String? = nil, title: String? = nil, authors: String? = nil, year: Int64? = nil,
                language: String? = nil, rights: [String: JSONValue]? = nil)
    {
        self.id = id
        self.kind = kind
        self.metadata = metadata
        self.sourceSHA256 = sourceSHA256
        self.sourceRef = sourceRef
        self.mime = mime
        self.bytes = bytes
        self.unitCount = unitCount
        self.duration = duration
        self.created = created
        self.updated = updated
        self.title = title
        self.authors = authors
        self.year = year
        self.language = language
        self.rights = rights
    }
}

/// A citable unit (page, time span, slide…).
public struct SPDFUnit: Sendable, Hashable {
    public var id: String
    /// nil: next ordinal.
    public var ord: Int64?
    public var anchor: Anchor
    public var text: String
    public var notes: [String]?
    public var header: String?
    public var footer: String?
    public var image: String?
    public var thumbnail: String?
    public var reader: String
    public var confidence: Double
    public var printed: String?
    public var t0: Double?
    public var t1: Double?
    /// Word timings (JSON value).
    public var words: JSONValue?

    public init(id: String, ord: Int64? = nil, anchor: Anchor, text: String, notes: [String]? = nil, header: String? = nil,
                footer: String? = nil, image: String? = nil, thumbnail: String? = nil, reader: String, confidence: Double = 1,
                printed: String? = nil, t0: Double? = nil, t1: Double? = nil, words: JSONValue? = nil)
    {
        self.id = id
        self.ord = ord
        self.anchor = anchor
        self.text = text
        self.notes = notes
        self.header = header
        self.footer = footer
        self.image = image
        self.thumbnail = thumbnail
        self.reader = reader
        self.confidence = confidence
        self.printed = printed
        self.t0 = t0
        self.t1 = t1
        self.words = words
    }
}

/// An entry of the table of contents.
public struct SPDFSection: Sendable, Hashable {
    public var id: String
    public var parent: String?
    public var level: Int64
    public var title: String
    public var unitFrom: String
    public var unitTo: String?
    public var summary: String?

    public init(id: String, parent: String? = nil, level: Int64, title: String, unitFrom: String, unitTo: String? = nil, summary: String? = nil) {
        self.id = id
        self.parent = parent
        self.level = level
        self.title = title
        self.unitFrom = unitFrom
        self.unitTo = unitTo
        self.summary = summary
    }
}

/// A searchable, citable passage.
public struct SPDFFragment: Sendable, Hashable {
    /// nil: next rowid.
    public var n: Int64?
    public var id: String
    public var unit: String
    /// nil: next ordinal.
    public var ord: Int64?
    public var text: String
    public var context: String
    public var section: [String]?
    public var anchor: Anchor
    public var anchorEnd: Anchor?
    public var searchText: String?

    public init(n: Int64? = nil, id: String, unit: String, ord: Int64? = nil, text: String, context: String = "",
                section: [String]? = nil, anchor: Anchor, anchorEnd: Anchor? = nil, searchText: String? = nil)
    {
        self.n = n
        self.id = id
        self.unit = unit
        self.ord = ord
        self.text = text
        self.context = context
        self.section = section
        self.anchor = anchor
        self.anchorEnd = anchorEnd
        self.searchText = searchText
    }
}

/// A figure of a unit.
public struct SPDFFigure: Sendable, Hashable {
    public var id: String
    public var unit: String
    public var image: String
    public var caption: String?
    public var description: String?
    public var anchor: Anchor

    public init(id: String, unit: String, image: String, caption: String? = nil, description: String? = nil, anchor: Anchor) {
        self.id = id
        self.unit = unit
        self.image = image
        self.caption = caption
        self.description = description
        self.anchor = anchor
    }
}

/// A processing stage, for audit and reproducibility.
public struct SPDFProvenance: Sendable, Hashable {
    public var stage: String
    public var provider: String?
    public var model: String?
    public var detail: JSONValue?
    public var ms: Int64?
    public var at: String

    public init(stage: String, provider: String? = nil, model: String? = nil, detail: JSONValue? = nil, ms: Int64? = nil, at: String) {
        self.stage = stage
        self.provider = provider
        self.model = model
        self.detail = detail
        self.ms = ms
        self.at = at
    }
}

/// Builds an SPDF 5.0 file. Rows go to a temporary file that replaces the
/// destination on `finish()`. Not thread-safe: use it from one task.
public final class SPDFWriter {
    public struct Options: Sendable {
        /// spdf_meta.generator; default "spdf-swift/<version>".
        public var generator: String
        /// Adds the optional CJK trigram index.
        public var trigram: Bool
        /// Writes every value verbatim (no default meta keys, no computed
        /// unit_count, no automatic ordinals, no NFC normalization, no
        /// generated content_sha256).
        public var exact: Bool
        /// Writes spdf_meta.content_sha256 (§8). On by default.
        public var contentHash: Bool
        /// 32-byte Ed25519 seed: signs the content hash (signer, signature).
        public var signingKey: Data?

        public init(generator: String = "\(SPDF.implementationName)/\(SPDF.version)", trigram: Bool = false, exact: Bool = false,
                    contentHash: Bool = true, signingKey: Data? = nil)
        {
            self.generator = generator
            self.trigram = trigram
            self.exact = exact
            self.contentHash = contentHash
            self.signingKey = signingKey
        }
    }

    private let db: SQLiteDB
    private let destination: URL
    private let tmp: URL
    private let options: Options
    private var meta: [String: String] = [:]
    private var document: SPDFDocumentInfo?
    private var nextUnit: Int64 = 0
    private var nextFragment: Int64 = 0
    private var nextN: Int64 = 0
    private var unitsWritten: Int64 = 0
    private var vectorsWritten: Int64 = 0
    private var hasTime = false
    private var spaces: [String: VectorSpace] = [:]
    private var open = true

    /// Starts a new SPDF 5.0 file at `url`.
    public init(url: URL, options: Options = Options()) throws {
        destination = url
        self.options = options
        tmp = url.deletingLastPathComponent().appendingPathComponent(".spdf-writer-\(UUID().uuidString).tmp")
        db = try SQLiteDB(path: tmp.path, flags: SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)
        db.enableDefensive()
        do {
            try db.exec("PRAGMA page_size = 4096; PRAGMA journal_mode = DELETE; PRAGMA trusted_schema = OFF;")
            try db.exec("PRAGMA application_id = \(SPDF.applicationID); PRAGMA user_version = \(SPDF.userVersion);")
            try db.exec(Schema.ddl50)
            if options.trigram { try db.exec(Schema.trigram) }
            try db.exec("BEGIN")
        } catch {
            abort()
            throw error
        }
    }

    private func check() throws {
        guard open else { throw SPDFError("W", "writer is closed") }
    }

    private func docID() throws -> String {
        guard let d = document else { throw SPDFError("W", "setDocument must be called first") }
        return d.id
    }

    private func nfc(_ s: String) -> String { options.exact ? s : s.precomposedStringWithCanonicalMapping }

    private static func text(_ s: String?) -> SQLValue { s.map { .text($0) } ?? .null }
    private static func int(_ i: Int64?) -> SQLValue { i.map { .int($0) } ?? .null }
    private static func real(_ d: Double?) -> SQLValue { d.map { .double($0) } ?? .null }
    private static func json(_ v: JSONValue?) -> SQLValue { v.map { .text($0.compactJSON) } ?? .null }

    /// Sets a spdf_meta key (overrides the defaults written by `finish()`).
    public func setMeta(_ key: String, _ value: String) { meta[key] = value }

    /// Sets the documents row (once).
    public func setDocument(_ d: SPDFDocumentInfo) throws {
        try check()
        guard document == nil else { throw SPDFError("W", "document already set") }
        guard !d.id.isEmpty, !d.kind.isEmpty, !d.mime.isEmpty, !d.sourceSHA256.isEmpty else {
            throw SPDFError("W", "document needs id, kind, mime and source_sha256")
        }
        var doc = d
        if doc.created == nil {
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime]
            doc.created = f.string(from: Date())
        }
        if doc.updated == nil { doc.updated = doc.created }
        document = doc
    }

    public func add(_ u: SPDFUnit) throws {
        try check()
        let did = try docID()
        var ord = u.ord
        if ord == nil && !options.exact { ord = nextUnit + 1 }
        nextUnit = max(nextUnit, ord ?? 0)
        if u.anchor.type == "time" { hasTime = true }
        unitsWritten += 1
        try db.run("""
            INSERT INTO units (id, document, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [.text(u.id), .text(did), .int(ord ?? 0), .text(u.anchor.jsonValue.compactJSON), .text(nfc(u.text)),
                  SPDFWriter.json(u.notes.map { .array($0.map { .string($0) }) }), SPDFWriter.text(u.header), SPDFWriter.text(u.footer),
                  SPDFWriter.text(u.image), SPDFWriter.text(u.thumbnail), .text(u.reader), .double(u.confidence),
                  SPDFWriter.text(u.printed), SPDFWriter.real(u.t0), SPDFWriter.real(u.t1), SPDFWriter.json(u.words)])
    }

    public func add(_ s: SPDFSection) throws {
        try check()
        let did = try docID()
        try db.run("INSERT INTO sections (id, document, parent, level, title, unit_from, unit_to, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                   [.text(s.id), .text(did), SPDFWriter.text(s.parent), .int(s.level), .text(s.title), .text(s.unitFrom),
                    SPDFWriter.text(s.unitTo), SPDFWriter.text(s.summary)])
    }

    public func add(_ f: SPDFFragment) throws {
        try check()
        let did = try docID()
        var n = f.n
        if n == nil && !options.exact { n = nextN + 1 }
        nextN = max(nextN, n ?? 0)
        var ord = f.ord
        if ord == nil && !options.exact { ord = nextFragment + 1 }
        nextFragment = max(nextFragment, ord ?? 0)
        try db.run("""
            INSERT INTO fragments (n, id, document, unit, ord, text, context, section, anchor, anchor_end, search_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [.int(n ?? 0), .text(f.id), .text(did), .text(f.unit), .int(ord ?? 0), .text(nfc(f.text)), .text(f.context),
                  SPDFWriter.json(f.section.map { .array($0.map { .string($0) }) }), .text(f.anchor.jsonValue.compactJSON),
                  SPDFWriter.json(f.anchorEnd?.jsonValue), SPDFWriter.text(f.searchText)])
    }

    public func add(_ g: SPDFFigure) throws {
        try check()
        let did = try docID()
        try db.run("INSERT INTO figures (id, document, unit, image, caption, description, anchor) VALUES (?, ?, ?, ?, ?, ?, ?)",
                   [.text(g.id), .text(did), .text(g.unit), .text(g.image), SPDFWriter.text(g.caption), SPDFWriter.text(g.description),
                    .text(g.anchor.jsonValue.compactJSON)])
    }

    /// Declares a vector space. `modalitiesJSON`, if given, is stored verbatim.
    public func add(_ s: VectorSpace, modalitiesJSON: JSONValue? = nil) throws {
        try check()
        guard dtypeSize(s.dtype) > 0 else { throw SPDFError("E032", "unknown dtype \(s.dtype)") }
        spaces[s.id] = s
        let mods = modalitiesJSON ?? .array(s.modalities.map { .string($0) })
        try db.run("""
            INSERT INTO spaces (id, provider, model, version, dims, dtype, normalized, truncated_from, modalities, task_prefixes, created)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [.text(s.id), .text(s.provider), .text(s.model), SPDFWriter.text(s.version), .int(s.dims), .text(s.dtype),
                  .int(s.normalized ? 1 : 0), SPDFWriter.int(s.truncatedFrom), .text(mods.compactJSON),
                  SPDFWriter.json(s.taskPrefixes.map { .object($0) }), SPDFWriter.text(s.created)])
    }

    /// Stores an already encoded vector.
    public func addVector(target: VectorTarget, id: String, space: String, data: Data) throws {
        try check()
        let did = try docID()
        guard let s = spaces[space] else { throw SPDFError("E031", "unknown space \(space) (add the space first)") }
        guard Int64(data.count) == s.dims * Int64(dtypeSize(s.dtype)) else {
            throw SPDFError("E030", "vector \(target.rawValue)/\(id) has \(data.count) bytes, space \(space) needs \(s.dims * Int64(dtypeSize(s.dtype)))")
        }
        vectorsWritten += 1
        try db.run("INSERT INTO vectors (target, id, space, document, data) VALUES (?, ?, ?, ?, ?)",
                   [.text(target.rawValue), .text(id), .text(space), .text(did), .blob(data)])
    }

    /// Encodes Float components in the space dtype (quantizing) and stores them.
    public func addVector(target: VectorTarget, id: String, space: String, values: [Float]) throws {
        guard let s = spaces[space] else { throw SPDFError("E031", "unknown space \(space) (add the space first)") }
        try addVector(target: target, id: id, space: space, data: try VectorCodec.encode(values, dtype: s.dtype))
    }

    /// Stores a binary object; reference it as "blob:<key>".
    public func addBlob(key: String, mime: String, data: Data) throws {
        try check()
        try db.run("INSERT INTO blobs (key, mime, sha256, data) VALUES (?, ?, ?, ?)",
                   [.text(key), .text(mime), .text(sha256Hex(data)), .blob(data)])
    }

    public func add(_ p: SPDFProvenance) throws {
        try check()
        let did = try docID()
        try db.run("INSERT INTO provenance (document, stage, provider, model, detail, ms, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                   [.text(did), .text(p.stage), SPDFWriter.text(p.provider), SPDFWriter.text(p.model), SPDFWriter.json(p.detail),
                    SPDFWriter.int(p.ms), .text(p.at)])
    }

    /// Declares an extension (its x_<vendor>_<name> tables go through `execute`).
    public func addExtension(name: String, version: String, required: Bool) throws {
        try check()
        try db.run("INSERT INTO extensions (name, version, required) VALUES (?, ?, ?)", [.text(name), .text(version), .int(required ? 1 : 0)])
    }

    /// Runs arbitrary SQL in the writer transaction (extension tables).
    public func execute(_ sql: String) throws {
        try check()
        try db.exec(sql)
    }

    /// Discards the file being written.
    public func abort() {
        open = false
        db.close()
        try? FileManager.default.removeItem(at: tmp)
        try? FileManager.default.removeItem(atPath: tmp.path + "-journal")
    }

    private var defaultProfile: String {
        var p = ["core"]
        if vectorsWritten > 0 { p.append("semantic") }
        if hasTime { p.append("media") }
        return p.joined(separator: " ")
    }

    /// Writes the document and spdf_meta, rebuilds the FTS index, VACUUMs and
    /// moves the file into place.
    public func finish() throws {
        try check()
        do {
            guard let d = document else { throw SPDFError("W", "no document") }
            try db.run("""
                INSERT INTO documents (id, kind, metadata, source_sha256, source_ref, mime, bytes, unit_count, duration, created, updated, title, authors, year, language, rights)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [.text(d.id), .text(d.kind), .text(JSONValue.object(d.metadata).compactJSON),
                      .text(options.exact ? d.sourceSHA256 : d.sourceSHA256.lowercased()), SPDFWriter.text(d.sourceRef), .text(d.mime),
                      .int(d.bytes), .int(d.unitCount ?? (options.exact ? 0 : unitsWritten)), SPDFWriter.real(d.duration),
                      .text(d.created ?? ""), .text(d.updated ?? ""), SPDFWriter.text(d.title), SPDFWriter.text(d.authors),
                      SPDFWriter.int(d.year), SPDFWriter.text(d.language), SPDFWriter.json(d.rights.map { .object($0) })])
            var m: [String: String] = options.exact ? [:] : [
                "spdf_version": SPDF.formatVersion, "profile": defaultProfile, "created": d.created ?? "",
                "generator": options.generator, "document_id": d.id,
            ]
            for (k, v) in meta { m[k] = v }
            for k in m.keys.sorted() { try db.run("INSERT INTO spdf_meta (key, value) VALUES (?, ?)", [.text(k), .text(m[k]!)]) }
            try db.exec("INSERT INTO fragments_fts(fragments_fts) VALUES ('rebuild')")
            if options.trigram { try db.exec("INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES ('rebuild')") }
            try db.exec("COMMIT")
            if !options.exact && (options.contentHash || options.signingKey != nil) {
                for (k, v) in try SPDFSeal.integrityMeta(path: tmp.path, signingKey: options.signingKey) {
                    try db.run("INSERT INTO spdf_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                               [.text(k), .text(v)])
                }
            }
            try db.exec("INSERT INTO fragments_fts(fragments_fts) VALUES ('optimize')")
            try db.exec("VACUUM")
            db.close()
            open = false
            let fm = FileManager.default
            if fm.fileExists(atPath: destination.path) {
                _ = try fm.replaceItemAt(destination, withItemAt: tmp)
            } else {
                try fm.moveItem(at: tmp, to: destination)
            }
        } catch {
            abort()
            throw error
        }
    }

    deinit {
        if open { abort() }
    }
}
