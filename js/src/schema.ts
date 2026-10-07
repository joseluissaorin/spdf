/** The SPDF 5.0 schema (contract §2) and the legacy 4.x names (contract §7). */

export const SPDF_VERSION = '5.0';
export const APPLICATION_ID = 1397769286; // 0x53504446, "SPDF"
export const USER_VERSION = 500;
export const MEDIA_TYPE = 'application/vnd.spdf';

export const SCHEMA_50 = `
CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

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
  id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL,
  title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT
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
  id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL,
  image TEXT NOT NULL,
  caption TEXT, description TEXT,
  anchor TEXT NOT NULL
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

CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL);

CREATE TABLE provenance (
  document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT,
  detail TEXT, ms INTEGER, at TEXT NOT NULL
);

CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
`;

/** Optional CJK index (contract §2). */
export const SCHEMA_50_TRIGRAM = `CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(text, content='fragments', content_rowid='n', tokenize='trigram');`;

/** Columns of each 5.0 table, in schema order. */
export const COLUMNS = {
  spdf_meta: ['key', 'value'],
  documents: [
    'id', 'kind', 'metadata', 'source_sha256', 'source_ref', 'mime', 'bytes', 'unit_count', 'duration',
    'created', 'updated', 'title', 'authors', 'year', 'language', 'rights',
  ],
  units: [
    'id', 'document', 'ord', 'anchor', 'text', 'notes', 'header', 'footer', 'image', 'thumbnail', 'reader',
    'confidence', 'printed', 't0', 't1', 'words',
  ],
  sections: ['id', 'document', 'parent', 'level', 'title', 'unit_from', 'unit_to', 'summary'],
  fragments: ['n', 'id', 'document', 'unit', 'ord', 'text', 'context', 'section', 'anchor', 'anchor_end', 'search_text'],
  figures: ['id', 'document', 'unit', 'image', 'caption', 'description', 'anchor'],
  spaces: [
    'id', 'provider', 'model', 'version', 'dims', 'dtype', 'normalized', 'truncated_from', 'modalities',
    'task_prefixes', 'created',
  ],
  vectors: ['target', 'id', 'space', 'document', 'data'],
  blobs: ['key', 'mime', 'sha256', 'data'],
  provenance: ['document', 'stage', 'provider', 'model', 'detail', 'ms', 'at'],
  extensions: ['name', 'version', 'required'],
} as const;

export type TableName = keyof typeof COLUMNS;
export const TABLES = Object.keys(COLUMNS) as TableName[];

/** spdf_meta keys a 5.0 file MUST have. */
export const REQUIRED_META = ['spdf_version', 'profile', 'created', 'generator', 'document_id'] as const;

export const PROFILES = ['core', 'semantic', 'media', 'full'] as const;
export type Profile = (typeof PROFILES)[number];

export const KINDS = [
  'pdf', 'scanned_pdf', 'photos', 'image', 'audio', 'video', 'document', 'epub', 'slides', 'sheet', 'web',
] as const;

// ---------------------------------------------------------------------------
// Legacy 4.x names (contract §7)
// ---------------------------------------------------------------------------

export const LEGACY_TABLES: Record<TableName, string | null> = {
  spdf_meta: 'spdf',
  documents: 'documentos',
  units: 'unidades',
  sections: 'secciones',
  fragments: 'fragmentos',
  figures: 'figuras',
  spaces: 'espacios',
  vectors: 'vectores',
  blobs: 'blobs',
  provenance: 'procedencia',
  extensions: null,
};

/** 5.0 column → legacy column (same name when absent). `null` = no legacy column. */
export const LEGACY_COLUMNS: Record<TableName, Record<string, string | null>> = {
  spdf_meta: { key: 'clave', value: 'valor' },
  documents: {
    kind: 'tipo', metadata: 'metadatos', source_sha256: 'huella', source_ref: 'original', unit_count: 'unidades',
    duration: 'duracion', created: 'creado', updated: 'actualizado', title: 'titulo', authors: 'autores',
    year: 'anio', language: 'idioma', rights: null,
  },
  units: {
    document: 'documento', ord: 'orden', anchor: 'ancla', text: 'texto', notes: 'notas', header: 'cabecera',
    footer: 'pie', image: 'imagen', thumbnail: 'miniatura', reader: 'lector', confidence: 'confianza',
    printed: 'impresa', words: 'palabras',
  },
  sections: {
    document: 'documento', parent: 'padre', level: 'nivel', title: 'titulo', unit_from: 'unidad_desde',
    unit_to: 'unidad_hasta', summary: 'resumen',
  },
  fragments: {
    document: 'documento', unit: 'unidad', ord: 'orden', text: 'texto', context: 'contexto', section: 'seccion',
    anchor: 'ancla', anchor_end: 'ancla_fin', search_text: 'texto_busqueda',
  },
  figures: {
    document: 'documento', unit: 'unidad', image: 'imagen', caption: 'pie', description: 'descripcion', anchor: 'ancla',
  },
  spaces: {
    provider: 'proveedor', model: 'modelo', normalized: 'normalizado', modalities: 'modalidades', created: 'creado',
    dtype: null, truncated_from: null, task_prefixes: null,
  },
  vectors: { target: 'objetivo', space: 'espacio', document: 'documento', data: 'valores' },
  blobs: { data: 'datos', sha256: null },
  provenance: { stage: 'fase', provider: 'proveedor', model: null, detail: 'detalle', at: 'cuando', document: 'documento' },
  extensions: {},
};

export const LEGACY_FTS = 'fragmentos_fts';
export const LEGACY_TRIGGERS = ['fragmentos_ai', 'fragmentos_ad', 'fragmentos_au'] as const;

export const LEGACY_KIND: Record<string, string> = {
  pdf: 'pdf',
  pdf_escaneado: 'scanned_pdf',
  fotos: 'photos',
  imagen: 'image',
  audio: 'audio',
  video: 'video',
  documento: 'document',
  epub: 'epub',
  presentacion: 'slides',
  hoja: 'sheet',
  web: 'web',
};

export const LEGACY_TARGET: Record<string, string> = { fragmento: 'fragment', unidad: 'unit', figura: 'figure' };
export const LEGACY_MODALITY: Record<string, string> = {
  texto: 'text', imagen: 'image', audio: 'audio', video: 'video', pdf: 'pdf',
};

/** Byte size of one component per dtype. */
export const DTYPE_SIZE: Record<string, number> = { f32: 4, f16: 2, i8: 1 };
