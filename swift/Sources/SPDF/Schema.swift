import Foundation

/// Library and format constants.
public enum SPDF {
    /// Version of this library.
    public static let version = "0.1.0"
    /// Name of this implementation in conformance reports.
    public static let implementationName = "spdf-swift"
    /// SPDF version written by `SPDFWriter`.
    public static let formatVersion = "5.0"
    /// `PRAGMA application_id` of an SPDF file (0x53504446, "SPDF").
    public static let applicationID: Int64 = 1_397_769_286
    /// `PRAGMA user_version` of an SPDF 5.0 file.
    public static let userVersion: Int64 = 500
    /// Default cap for a single string or blob (512 MiB).
    public static let defaultMaxBlobSize: Int64 = 512 << 20
    /// Default cap for a gunzipped legacy file (4 GiB).
    public static let defaultMaxDecompressedSize: Int64 = 4 << 30
}

/// An SPDF error with its validation code (E001, E020…).
public struct SPDFError: Error, Sendable, CustomStringConvertible, Equatable {
    public let code: String
    public let message: String
    public let location: String

    public init(_ code: String, _ message: String, location: String = "") {
        self.code = code
        self.message = message
        self.location = location
    }

    public var description: String {
        location.isEmpty ? "\(code): \(message)" : "\(code): \(message) (\(location))"
    }
}

enum Schema {
    /// DDL of an SPDF 5.0 file (contract §2), without the PRAGMAs.
    static let ddl50 = """
        CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE documents (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, metadata TEXT NOT NULL, source_sha256 TEXT NOT NULL,
          source_ref TEXT, mime TEXT NOT NULL, bytes INTEGER NOT NULL, unit_count INTEGER NOT NULL,
          duration REAL, created TEXT NOT NULL, updated TEXT NOT NULL, title TEXT, authors TEXT,
          year INTEGER, language TEXT, rights TEXT
        );
        CREATE TABLE units (
          id TEXT PRIMARY KEY, document TEXT NOT NULL REFERENCES documents(id), ord INTEGER NOT NULL,
          anchor TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', notes TEXT, header TEXT, footer TEXT,
          image TEXT, thumbnail TEXT, reader TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1,
          printed TEXT, t0 REAL, t1 REAL, words TEXT
        );
        CREATE INDEX units_doc ON units(document, ord);
        CREATE INDEX units_printed ON units(document, printed);
        CREATE TABLE sections (
          id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL,
          title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT
        );
        CREATE TABLE fragments (
          n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT NOT NULL, unit TEXT NOT NULL,
          ord INTEGER NOT NULL, text TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', section TEXT,
          anchor TEXT NOT NULL, anchor_end TEXT, search_text TEXT
        );
        CREATE INDEX fragments_doc ON fragments(document, ord);
        CREATE INDEX fragments_unit ON fragments(unit);
        CREATE VIRTUAL TABLE fragments_fts USING fts5(
          text, context, section, search_text,
          content='fragments', content_rowid='n',
          tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TABLE figures (
          id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL, image TEXT NOT NULL,
          caption TEXT, description TEXT, anchor TEXT NOT NULL
        );
        CREATE TABLE spaces (
          id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, version TEXT,
          dims INTEGER NOT NULL, dtype TEXT NOT NULL DEFAULT 'f32', normalized INTEGER NOT NULL DEFAULT 1,
          truncated_from INTEGER, modalities TEXT NOT NULL, task_prefixes TEXT, created TEXT
        );
        CREATE TABLE vectors (
          target TEXT NOT NULL, id TEXT NOT NULL, space TEXT NOT NULL REFERENCES spaces(id),
          document TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (target, id, space)
        );
        CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL);
        CREATE TABLE provenance (
          document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT,
          detail TEXT, ms INTEGER, at TEXT NOT NULL
        );
        CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
        """

    static let trigram =
        "CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(text, content='fragments', content_rowid='n', tokenize='trigram')"

    /// Columns of every 5.0 table, in schema order.
    static let columns: [String: [String]] = [
        "spdf_meta": ["key", "value"],
        "documents": ["id", "kind", "metadata", "source_sha256", "source_ref", "mime", "bytes", "unit_count", "duration",
                      "created", "updated", "title", "authors", "year", "language", "rights"],
        "units": ["id", "document", "ord", "anchor", "text", "notes", "header", "footer", "image", "thumbnail", "reader",
                  "confidence", "printed", "t0", "t1", "words"],
        "sections": ["id", "document", "parent", "level", "title", "unit_from", "unit_to", "summary"],
        "fragments": ["n", "id", "document", "unit", "ord", "text", "context", "section", "anchor", "anchor_end", "search_text"],
        "figures": ["id", "document", "unit", "image", "caption", "description", "anchor"],
        "spaces": ["id", "provider", "model", "version", "dims", "dtype", "normalized", "truncated_from", "modalities",
                   "task_prefixes", "created"],
        "vectors": ["target", "id", "space", "document", "data"],
        "blobs": ["key", "mime", "sha256", "data"],
        "provenance": ["document", "stage", "provider", "model", "detail", "ms", "at"],
        "extensions": ["name", "version", "required"],
    ]

    /// Tables every 5.0 file must contain, in validation order.
    static let requiredTables = ["spdf_meta", "documents", "units", "sections", "fragments", "fragments_fts", "figures",
                                 "spaces", "vectors", "blobs", "provenance", "extensions"]

    static let requiredMetaKeys = ["spdf_version", "profile", "created", "generator", "document_id"]

    static let anchorTypes: Set<String> = ["page", "time", "section", "slide", "sheet", "web", "image", "verse", "canonical"]

    /// JSON-in-TEXT columns, parsed in the dump.
    static let jsonColumns: [String: Set<String>] = [
        "documents": ["metadata", "rights"],
        "units": ["anchor", "notes", "words"],
        "fragments": ["section", "anchor", "anchor_end"],
        "figures": ["anchor"],
        "spaces": ["modalities", "task_prefixes"],
        "provenance": ["detail"],
    ]

    // MARK: Legacy 4.x (contract §7)

    static let legacyTable: [String: String] = [
        "spdf_meta": "spdf", "documents": "documentos", "units": "unidades", "sections": "secciones",
        "fragments": "fragmentos", "fragments_fts": "fragmentos_fts", "figures": "figuras", "spaces": "espacios",
        "vectors": "vectores", "blobs": "blobs", "provenance": "procedencia",
    ]

    /// Legacy column per 5.0 column; "" = absent in 4.x.
    static let legacyColumns: [String: [String: String]] = [
        "spdf_meta": ["key": "clave", "value": "valor"],
        "documents": ["id": "id", "kind": "tipo", "metadata": "metadatos", "source_sha256": "huella", "source_ref": "original",
                      "mime": "mime", "bytes": "bytes", "unit_count": "unidades", "duration": "duracion", "created": "creado",
                      "updated": "actualizado", "title": "titulo", "authors": "autores", "year": "anio", "language": "idioma",
                      "rights": ""],
        "units": ["id": "id", "document": "documento", "ord": "orden", "anchor": "ancla", "text": "texto", "notes": "notas",
                  "header": "cabecera", "footer": "pie", "image": "imagen", "thumbnail": "miniatura", "reader": "lector",
                  "confidence": "confianza", "printed": "impresa", "t0": "t0", "t1": "t1", "words": "palabras"],
        "sections": ["id": "id", "document": "documento", "parent": "padre", "level": "nivel", "title": "titulo",
                     "unit_from": "unidad_desde", "unit_to": "unidad_hasta", "summary": "resumen"],
        "fragments": ["n": "n", "id": "id", "document": "documento", "unit": "unidad", "ord": "orden", "text": "texto",
                      "context": "contexto", "section": "seccion", "anchor": "ancla", "anchor_end": "ancla_fin",
                      "search_text": "texto_busqueda"],
        "figures": ["id": "id", "document": "documento", "unit": "unidad", "image": "imagen", "caption": "pie",
                    "description": "descripcion", "anchor": "ancla"],
        "spaces": ["id": "id", "provider": "proveedor", "model": "modelo", "version": "version", "dims": "dims", "dtype": "",
                   "normalized": "normalizado", "truncated_from": "", "modalities": "modalidades", "task_prefixes": "",
                   "created": "creado"],
        "vectors": ["target": "objetivo", "id": "id", "space": "espacio", "document": "documento", "data": "valores"],
        "blobs": ["key": "clave", "mime": "mime", "sha256": "", "data": "datos"],
        "provenance": ["document": "documento", "stage": "fase", "provider": "proveedor", "model": "", "detail": "detalle",
                       "ms": "ms", "at": "cuando"],
    ]

    static let legacyDefaults: [String: String] = ["spaces.dtype": "'f32'"]
    static let legacyTriggers: Set<String> = ["fragmentos_ai", "fragmentos_ad", "fragmentos_au"]
    static let legacyKinds: [String: String] = [
        "pdf": "pdf", "pdf_escaneado": "scanned_pdf", "fotos": "photos", "imagen": "image", "audio": "audio",
        "video": "video", "documento": "document", "epub": "epub", "presentacion": "slides", "hoja": "sheet", "web": "web",
    ]
    static let legacyTargets: [String: String] = ["fragmento": "fragment", "unidad": "unit", "figura": "figure"]
    static let legacyMetaKeys: [String: String] = ["creado": "created", "generador": "generator"]
    static let legacyModalities: [String: String] = ["texto": "text", "imagen": "image", "audio": "audio", "video": "video", "pdf": "pdf"]
}

/// Byte size of a vector component for a dtype, or 0 if unknown.
public func dtypeSize(_ dtype: String) -> Int {
    switch dtype {
    case "f32": return 4
    case "f16": return 2
    case "i8": return 1
    default: return 0
    }
}
