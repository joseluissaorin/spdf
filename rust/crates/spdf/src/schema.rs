//! The SPDF 5.0 schema and the legacy 4.x name mapping (contract §2, §7).

/// `PRAGMA application_id` of SPDF files ("SPDF").
pub const APPLICATION_ID: i64 = 1_397_769_286;
/// `PRAGMA user_version` written by this library (5.0).
pub const USER_VERSION: i64 = 500;
/// The format version written by this library.
pub const SPDF_VERSION: &str = "5.0";
/// FTS5 tokenizer of `fragments_fts`.
pub const FTS_TOKENIZER: &str = "unicode61 remove_diacritics 2";

/// The 5.0 schema (no triggers, no views).
pub const SCHEMA_SQL: &str = r#"
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
"#;

/// Optional trigram index for CJK search.
pub const TRIGRAM_SQL: &str = "CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(text, content='fragments', content_rowid='n', tokenize='trigram')";

/// A logical table: 5.0 name, legacy name and its columns `(5.0, legacy)`.
/// A legacy name of `""` means the column does not exist in 4.x.
#[derive(Debug)]
pub struct TableDef {
    /// 5.0 table name.
    pub name: &'static str,
    /// 4.x table name.
    pub legacy: &'static str,
    /// Columns: (5.0 name, 4.x name).
    pub columns: &'static [(&'static str, &'static str)],
}

/// spdf_meta / spdf.
pub const META: TableDef = TableDef {
    name: "spdf_meta",
    legacy: "spdf",
    columns: &[("key", "clave"), ("value", "valor")],
};

/// documents / documentos.
pub const DOCUMENTS: TableDef = TableDef {
    name: "documents",
    legacy: "documentos",
    columns: &[
        ("id", "id"),
        ("kind", "tipo"),
        ("metadata", "metadatos"),
        ("source_sha256", "huella"),
        ("source_ref", "original"),
        ("mime", "mime"),
        ("bytes", "bytes"),
        ("unit_count", "unidades"),
        ("duration", "duracion"),
        ("created", "creado"),
        ("updated", "actualizado"),
        ("title", "titulo"),
        ("authors", "autores"),
        ("year", "anio"),
        ("language", "idioma"),
        ("rights", ""),
    ],
};

/// units / unidades.
pub const UNITS: TableDef = TableDef {
    name: "units",
    legacy: "unidades",
    columns: &[
        ("id", "id"),
        ("document", "documento"),
        ("ord", "orden"),
        ("anchor", "ancla"),
        ("text", "texto"),
        ("notes", "notas"),
        ("header", "cabecera"),
        ("footer", "pie"),
        ("image", "imagen"),
        ("thumbnail", "miniatura"),
        ("reader", "lector"),
        ("confidence", "confianza"),
        ("printed", "impresa"),
        ("t0", "t0"),
        ("t1", "t1"),
        ("words", "palabras"),
    ],
};

/// sections / secciones.
pub const SECTIONS: TableDef = TableDef {
    name: "sections",
    legacy: "secciones",
    columns: &[
        ("id", "id"),
        ("document", "documento"),
        ("parent", "padre"),
        ("level", "nivel"),
        ("title", "titulo"),
        ("unit_from", "unidad_desde"),
        ("unit_to", "unidad_hasta"),
        ("summary", "resumen"),
    ],
};

/// fragments / fragmentos.
pub const FRAGMENTS: TableDef = TableDef {
    name: "fragments",
    legacy: "fragmentos",
    columns: &[
        ("n", "n"),
        ("id", "id"),
        ("document", "documento"),
        ("unit", "unidad"),
        ("ord", "orden"),
        ("text", "texto"),
        ("context", "contexto"),
        ("section", "seccion"),
        ("anchor", "ancla"),
        ("anchor_end", "ancla_fin"),
        ("search_text", "texto_busqueda"),
    ],
};

/// figures / figuras.
pub const FIGURES: TableDef = TableDef {
    name: "figures",
    legacy: "figuras",
    columns: &[
        ("id", "id"),
        ("document", "documento"),
        ("unit", "unidad"),
        ("image", "imagen"),
        ("caption", "pie"),
        ("description", "descripcion"),
        ("anchor", "ancla"),
    ],
};

/// spaces / espacios.
pub const SPACES: TableDef = TableDef {
    name: "spaces",
    legacy: "espacios",
    columns: &[
        ("id", "id"),
        ("provider", "proveedor"),
        ("model", "modelo"),
        ("version", "version"),
        ("dims", "dims"),
        ("dtype", ""),
        ("normalized", "normalizado"),
        ("truncated_from", ""),
        ("modalities", "modalidades"),
        ("task_prefixes", ""),
        ("created", "creado"),
    ],
};

/// vectors / vectores.
pub const VECTORS: TableDef = TableDef {
    name: "vectors",
    legacy: "vectores",
    columns: &[
        ("target", "objetivo"),
        ("id", "id"),
        ("space", "espacio"),
        ("document", "documento"),
        ("data", "valores"),
    ],
};

/// blobs (same name in 4.x).
pub const BLOBS: TableDef = TableDef {
    name: "blobs",
    legacy: "blobs",
    columns: &[
        ("key", "clave"),
        ("mime", "mime"),
        ("sha256", ""),
        ("data", "datos"),
    ],
};

/// provenance / procedencia.
pub const PROVENANCE: TableDef = TableDef {
    name: "provenance",
    legacy: "procedencia",
    columns: &[
        ("document", "documento"),
        ("stage", "fase"),
        ("provider", "proveedor"),
        ("model", ""),
        ("detail", "detalle"),
        ("ms", "ms"),
        ("at", "cuando"),
    ],
};

/// extensions (5.0 only).
pub const EXTENSIONS: TableDef = TableDef {
    name: "extensions",
    legacy: "",
    columns: &[("name", ""), ("version", ""), ("required", "")],
};

/// Every table of the 5.0 schema, in validation order.
pub const TABLES: &[&TableDef] = &[
    &META,
    &DOCUMENTS,
    &UNITS,
    &SECTIONS,
    &FRAGMENTS,
    &FIGURES,
    &SPACES,
    &VECTORS,
    &BLOBS,
    &PROVENANCE,
    &EXTENSIONS,
];

/// Required `spdf_meta` keys of 5.0.
pub const REQUIRED_META: &[&str] = &[
    "spdf_version",
    "profile",
    "created",
    "generator",
    "document_id",
];

/// Legacy `tipo` → 5.0 `kind`.
pub fn legacy_kind(k: &str) -> &str {
    match k {
        "pdf_escaneado" => "scanned_pdf",
        "fotos" => "photos",
        "imagen" => "image",
        "documento" => "document",
        "presentacion" => "slides",
        "hoja" => "sheet",
        other => other,
    }
}

/// Legacy vector `objetivo` → 5.0 `target`.
pub fn legacy_target(t: &str) -> &str {
    match t {
        "fragmento" => "fragment",
        "unidad" => "unit",
        "figura" => "figure",
        other => other,
    }
}

/// 5.0 target → legacy `objetivo`.
pub fn target_to_legacy(t: &str) -> &str {
    match t {
        "fragment" => "fragmento",
        "unit" => "unidad",
        "figure" => "figura",
        other => other,
    }
}

/// Legacy `spdf` key → 5.0 `spdf_meta` key.
pub fn legacy_meta_key(k: &str) -> &str {
    match k {
        "creado" => "created",
        "generador" => "generator",
        other => other,
    }
}
