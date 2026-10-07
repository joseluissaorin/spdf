namespace Spdf;

/// <summary>Schema of SPDF 5.0 and the legacy 4.x mapping (specification §3 and §20).</summary>
public static class SpdfSchema
{
    /// <summary>The DDL of an SPDF 5.0 file (<c>spec/schema/spdf-5.0.sql</c> without the PRAGMAs).</summary>
    public const string Ddl = """
        CREATE TABLE spdf_meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE documents (
          id            TEXT PRIMARY KEY,
          kind          TEXT NOT NULL,
          metadata      TEXT NOT NULL,
          source_sha256 TEXT NOT NULL,
          source_ref    TEXT,
          mime          TEXT NOT NULL,
          bytes         INTEGER NOT NULL,
          unit_count    INTEGER NOT NULL,
          duration      REAL,
          created       TEXT NOT NULL,
          updated       TEXT NOT NULL,
          title         TEXT,
          authors       TEXT,
          year          INTEGER,
          language      TEXT,
          rights        TEXT
        );

        CREATE TABLE units (
          id          TEXT PRIMARY KEY,
          document    TEXT NOT NULL REFERENCES documents(id),
          ord         INTEGER NOT NULL,
          anchor      TEXT NOT NULL,
          text        TEXT NOT NULL DEFAULT '',
          notes       TEXT,
          header      TEXT,
          footer      TEXT,
          image       TEXT,
          thumbnail   TEXT,
          reader      TEXT NOT NULL,
          confidence  REAL NOT NULL DEFAULT 1,
          printed     TEXT,
          t0          REAL,
          t1          REAL,
          words       TEXT
        );
        CREATE INDEX units_doc ON units(document, ord);
        CREATE INDEX units_printed ON units(document, printed);

        CREATE TABLE sections (
          id        TEXT PRIMARY KEY,
          document  TEXT NOT NULL,
          parent    TEXT,
          level     INTEGER NOT NULL,
          title     TEXT NOT NULL,
          unit_from TEXT NOT NULL,
          unit_to   TEXT,
          summary   TEXT
        );

        CREATE TABLE fragments (
          n           INTEGER PRIMARY KEY,
          id          TEXT NOT NULL UNIQUE,
          document    TEXT NOT NULL,
          unit        TEXT NOT NULL,
          ord         INTEGER NOT NULL,
          text        TEXT NOT NULL,
          context     TEXT NOT NULL DEFAULT '',
          section     TEXT,
          anchor      TEXT NOT NULL,
          anchor_end  TEXT,
          search_text TEXT
        );
        CREATE INDEX fragments_doc ON fragments(document, ord);
        CREATE INDEX fragments_unit ON fragments(unit);

        CREATE VIRTUAL TABLE fragments_fts USING fts5(
          text, context, section, search_text,
          content='fragments', content_rowid='n',
          tokenize='unicode61 remove_diacritics 2'
        );

        CREATE TABLE figures (
          id          TEXT PRIMARY KEY,
          document    TEXT NOT NULL,
          unit        TEXT NOT NULL,
          image       TEXT NOT NULL,
          caption     TEXT,
          description TEXT,
          anchor      TEXT NOT NULL
        );

        CREATE TABLE spaces (
          id             TEXT PRIMARY KEY,
          provider       TEXT NOT NULL,
          model          TEXT NOT NULL,
          version        TEXT,
          dims           INTEGER NOT NULL,
          dtype          TEXT NOT NULL DEFAULT 'f32',
          normalized     INTEGER NOT NULL DEFAULT 1,
          truncated_from INTEGER,
          modalities     TEXT NOT NULL,
          task_prefixes  TEXT,
          created        TEXT
        );

        CREATE TABLE vectors (
          target   TEXT NOT NULL,
          id       TEXT NOT NULL,
          space    TEXT NOT NULL REFERENCES spaces(id),
          document TEXT NOT NULL,
          data     BLOB NOT NULL,
          PRIMARY KEY (target, id, space)
        );

        CREATE TABLE blobs (
          key    TEXT PRIMARY KEY,
          mime   TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          data   BLOB NOT NULL
        );

        CREATE TABLE provenance (
          document TEXT NOT NULL,
          stage    TEXT NOT NULL,
          provider TEXT,
          model    TEXT,
          detail   TEXT,
          ms       INTEGER,
          at       TEXT NOT NULL
        );

        CREATE TABLE extensions (
          name     TEXT PRIMARY KEY,
          version  TEXT NOT NULL,
          required INTEGER NOT NULL DEFAULT 0
        );
        """;

    /// <summary>The optional CJK index.</summary>
    public const string TrigramDdl = "CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(text, content='fragments', content_rowid='n', tokenize='trigram')";

    /// <summary>Columns of every 5.0 table, in schema order.</summary>
    public static IReadOnlyDictionary<string, string[]> Columns { get; } = new Dictionary<string, string[]>(StringComparer.Ordinal)
    {
        ["spdf_meta"] = ["key", "value"],
        ["documents"] = ["id", "kind", "metadata", "source_sha256", "source_ref", "mime", "bytes", "unit_count", "duration", "created", "updated", "title", "authors", "year", "language", "rights"],
        ["units"] = ["id", "document", "ord", "anchor", "text", "notes", "header", "footer", "image", "thumbnail", "reader", "confidence", "printed", "t0", "t1", "words"],
        ["sections"] = ["id", "document", "parent", "level", "title", "unit_from", "unit_to", "summary"],
        ["fragments"] = ["n", "id", "document", "unit", "ord", "text", "context", "section", "anchor", "anchor_end", "search_text"],
        ["fragments_fts"] = [],
        ["figures"] = ["id", "document", "unit", "image", "caption", "description", "anchor"],
        ["spaces"] = ["id", "provider", "model", "version", "dims", "dtype", "normalized", "truncated_from", "modalities", "task_prefixes", "created"],
        ["vectors"] = ["target", "id", "space", "document", "data"],
        ["blobs"] = ["key", "mime", "sha256", "data"],
        ["provenance"] = ["document", "stage", "provider", "model", "detail", "ms", "at"],
        ["extensions"] = ["name", "version", "required"],
    };

    /// <summary>Tables every 5.0 file must contain, in the order validation checks them.</summary>
    public static IReadOnlyList<string> RequiredTables { get; } =
        ["spdf_meta", "documents", "units", "sections", "fragments", "fragments_fts", "figures", "spaces", "vectors", "blobs", "provenance", "extensions"];

    /// <summary>Required <c>spdf_meta</c> keys.</summary>
    public static IReadOnlyList<string> RequiredMetaKeys { get; } = ["spdf_version", "profile", "created", "generator", "document_id"];

    internal static readonly Dictionary<string, HashSet<string>> JsonColumns = new(StringComparer.Ordinal)
    {
        ["documents"] = new(StringComparer.Ordinal) { "metadata", "rights" },
        ["units"] = new(StringComparer.Ordinal) { "anchor", "notes", "words" },
        ["fragments"] = new(StringComparer.Ordinal) { "section", "anchor", "anchor_end" },
        ["figures"] = new(StringComparer.Ordinal) { "anchor" },
        ["spaces"] = new(StringComparer.Ordinal) { "modalities", "task_prefixes" },
        ["provenance"] = new(StringComparer.Ordinal) { "detail" },
    };

    /// <summary>Legacy 4.x table names.</summary>
    internal static readonly Dictionary<string, string> LegacyTables = new(StringComparer.Ordinal)
    {
        ["spdf_meta"] = "spdf",
        ["documents"] = "documentos",
        ["units"] = "unidades",
        ["sections"] = "secciones",
        ["fragments"] = "fragmentos",
        ["fragments_fts"] = "fragmentos_fts",
        ["figures"] = "figuras",
        ["spaces"] = "espacios",
        ["vectors"] = "vectores",
        ["blobs"] = "blobs",
        ["provenance"] = "procedencia",
    };

    /// <summary>Legacy 4.x column names per 5.0 table; "" means absent in 4.x.</summary>
    internal static readonly Dictionary<string, Dictionary<string, string>> LegacyColumns = new(StringComparer.Ordinal)
    {
        ["spdf_meta"] = new(StringComparer.Ordinal) { ["key"] = "clave", ["value"] = "valor" },
        ["documents"] = new(StringComparer.Ordinal)
        {
            ["id"] = "id", ["kind"] = "tipo", ["metadata"] = "metadatos", ["source_sha256"] = "huella",
            ["source_ref"] = "original", ["mime"] = "mime", ["bytes"] = "bytes", ["unit_count"] = "unidades",
            ["duration"] = "duracion", ["created"] = "creado", ["updated"] = "actualizado", ["title"] = "titulo",
            ["authors"] = "autores", ["year"] = "anio", ["language"] = "idioma", ["rights"] = "",
        },
        ["units"] = new(StringComparer.Ordinal)
        {
            ["id"] = "id", ["document"] = "documento", ["ord"] = "orden", ["anchor"] = "ancla", ["text"] = "texto",
            ["notes"] = "notas", ["header"] = "cabecera", ["footer"] = "pie", ["image"] = "imagen",
            ["thumbnail"] = "miniatura", ["reader"] = "lector", ["confidence"] = "confianza",
            ["printed"] = "impresa", ["t0"] = "t0", ["t1"] = "t1", ["words"] = "palabras",
        },
        ["sections"] = new(StringComparer.Ordinal)
        {
            ["id"] = "id", ["document"] = "documento", ["parent"] = "padre", ["level"] = "nivel", ["title"] = "titulo",
            ["unit_from"] = "unidad_desde", ["unit_to"] = "unidad_hasta", ["summary"] = "resumen",
        },
        ["fragments"] = new(StringComparer.Ordinal)
        {
            ["n"] = "n", ["id"] = "id", ["document"] = "documento", ["unit"] = "unidad", ["ord"] = "orden",
            ["text"] = "texto", ["context"] = "contexto", ["section"] = "seccion", ["anchor"] = "ancla",
            ["anchor_end"] = "ancla_fin", ["search_text"] = "texto_busqueda",
        },
        ["figures"] = new(StringComparer.Ordinal)
        {
            ["id"] = "id", ["document"] = "documento", ["unit"] = "unidad", ["image"] = "imagen",
            ["caption"] = "pie", ["description"] = "descripcion", ["anchor"] = "ancla",
        },
        ["spaces"] = new(StringComparer.Ordinal)
        {
            ["id"] = "id", ["provider"] = "proveedor", ["model"] = "modelo", ["version"] = "version", ["dims"] = "dims",
            ["dtype"] = "", ["normalized"] = "normalizado", ["truncated_from"] = "", ["modalities"] = "modalidades",
            ["task_prefixes"] = "", ["created"] = "creado",
        },
        ["vectors"] = new(StringComparer.Ordinal) { ["target"] = "objetivo", ["id"] = "id", ["space"] = "espacio", ["document"] = "documento", ["data"] = "valores" },
        ["blobs"] = new(StringComparer.Ordinal) { ["key"] = "clave", ["mime"] = "mime", ["sha256"] = "", ["data"] = "datos" },
        ["provenance"] = new(StringComparer.Ordinal)
        {
            ["document"] = "documento", ["stage"] = "fase", ["provider"] = "proveedor", ["model"] = "",
            ["detail"] = "detalle", ["ms"] = "ms", ["at"] = "cuando",
        },
    };

    /// <summary>SQL literals for 5.0 columns absent from 4.x that have a defined value.</summary>
    internal static readonly Dictionary<string, string> LegacyDefaults = new(StringComparer.Ordinal)
    {
        ["spaces.dtype"] = "'f32'",
    };
}
