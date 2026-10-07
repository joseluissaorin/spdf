import Foundation

/// Async variants for apps: the SQLite work runs on a background queue, so
/// calling them from the main actor never blocks the UI.
private let spdfQueue = DispatchQueue(label: "spdf.io", qos: .userInitiated, attributes: .concurrent)

func background<T: Sendable>(_ body: @escaping @Sendable () throws -> T) async throws -> T {
    try await withCheckedThrowingContinuation { (c: CheckedContinuation<T, Error>) in
        spdfQueue.async {
            do { c.resume(returning: try body()) } catch { c.resume(throwing: error) }
        }
    }
}

extension SPDFFile {
    /// Opens a file without blocking the caller.
    public static func open(_ url: URL, options: SPDFOpenOptions = SPDFOpenOptions()) async throws -> SPDFFile {
        try await background { try SPDFFile.open(url, options: options) }
    }

    public func dump() async throws -> JSONValue { try await background { try self.dump() } }

    public func searchLexical(_ query: String, limit: Int = 10) async throws -> [SearchHit] {
        try await background { try self.searchLexical(query, limit: limit) }
    }

    public func searchVector(_ query: [Double], space: String, target: VectorTarget = .fragment, limit: Int = 10) async throws -> [SearchHit] {
        try await background { try self.searchVector(query, space: space, target: target, limit: limit) }
    }

    public func searchHybrid(_ query: String, vector: [Double]?, space: String?, limit: Int = 10) async throws -> [SearchHit] {
        try await background { try self.searchHybrid(query, vector: vector, space: space, limit: limit) }
    }

    public func units() async throws -> [SPDFUnit] { try await background { try self.units() } }
    public func fragments() async throws -> [SPDFFragment] { try await background { try self.fragments() } }
    public func metadata() async throws -> [String: JSONValue] { try await background { try self.metadata() } }
}

extension SPDFValidator {
    public static func validate(_ url: URL, options: SPDFOpenOptions = SPDFOpenOptions()) async -> ValidationResult {
        (try? await background { SPDFValidator.validate(url, options: options) }) ?? ValidationResult(
            valid: false, version: nil, profile: [], errors: [], warnings: [])
    }
}
