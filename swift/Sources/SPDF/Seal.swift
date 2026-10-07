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

/// Integrity of SPEC §8: `content_sha256` and the Ed25519 signature.
public enum SPDFSeal {
    /// Domain separator of the signed message.
    public static let signaturePrefix = "spdf-content-sha256:"

    /// content_sha256 (and signer/signature with a 32-byte Ed25519 seed) of
    /// the file at `path`.
    static func integrityMeta(path: String, signingKey: Data?) throws -> [(String, String)] {
        let f = try SPDFFile.open(path: path)
        let sum = try f.contentSHA256()
        f.close()
        var out = [("content_sha256", sum)]
        if let seed = signingKey {
            guard seed.count == 32 else { throw SPDFError("E082", "an Ed25519 seed has 32 bytes") }
            let key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
            let sig = try key.signature(for: Data((signaturePrefix + sum).utf8))
            out.append(("signer", "ed25519:" + key.publicKey.rawRepresentation.base64EncodedString()))
            out.append(("signature", sig.base64EncodedString()))
        }
        return out
    }

    /// Writes content_sha256 of an existing SPDF 5.x file and, with a key,
    /// its Ed25519 signature, in place. Without a key, a previous signature
    /// is removed, since it would no longer match.
    public static func seal(_ url: URL, signingKey: Data? = nil) throws {
        let f = try SPDFFile.open(url)
        let plain = !f.isLegacy && !f.isGzipped
        f.close()
        guard plain else { throw SPDFError("W", "only uncompressed SPDF 5.x files can be sealed") }
        let meta = try integrityMeta(path: url.path, signingKey: signingKey)
        let db = try SQLiteDB(path: url.path, flags: SQLITE_OPEN_READWRITE)
        defer { db.close() }
        db.enableDefensive()
        try db.exec("PRAGMA trusted_schema = OFF; BEGIN")
        do {
            if signingKey == nil { try db.exec("DELETE FROM spdf_meta WHERE key IN ('signer', 'signature')") }
            for (k, v) in meta {
                try db.run("INSERT INTO spdf_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                           [.text(k), .text(v)])
            }
            try db.exec("COMMIT")
        } catch {
            try? db.exec("ROLLBACK")
            throw error
        }
    }
}
