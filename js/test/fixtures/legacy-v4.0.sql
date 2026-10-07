-- SPDF 4.0: un documento leído y citable, de cualquier cosa.
--
-- Un .spdf es una base SQLite comprimida con gzip. Este esquema es también el de
-- la «estantería» (el Durable Object de cada usuario): allí conviven muchos
-- documentos; en un .spdf exportado hay exactamente uno.
--
-- Principios:
--   1. Todo fragmento lleva su ancla (JSON): página impresa, tiempo, sección…
--   2. Un documento puede llevar vectores de VARIOS espacios (modelos).
--   3. Todo es reconstruible desde el original + las unidades leídas: los
--      vectores y los contextos son derivados y se pueden recalcular.
--   4. Procedencia: qué lector leyó cada unidad y con qué confianza.
--
-- Este fichero es una copia legible de «ESQUEMA_V4» (packages/spdf/src/esquema.ts),
-- que es la fuente de verdad; una prueba comprueba que coinciden. «aplicarEsquema»
-- ejecuta las sentencias una a una sobre cualquier puerto SQL (sqlite-wasm,
-- Durable Object, better-sqlite3), y fija «PRAGMA user_version = 400» solo donde
-- la plataforma lo permite: la versión vive además en la tabla «spdf».

-- Clave/valor del fichero: spdf_version, creado, generador, huella_original…
CREATE TABLE IF NOT EXISTS spdf (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documentos (
  id           TEXT PRIMARY KEY,
  tipo         TEXT NOT NULL,          -- TipoEntrada
  metadatos    TEXT NOT NULL,          -- JSON MetadatosDocumento
  estado       TEXT NOT NULL DEFAULT 'pendiente',
  huella       TEXT NOT NULL,          -- SHA-256 del original
  original     TEXT NOT NULL,          -- clave en el almacén ('' si va incrustado en blobs)
  mime         TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  unidades     INTEGER NOT NULL DEFAULT 0,
  duracion     REAL,
  creado       TEXT NOT NULL,
  actualizado  TEXT NOT NULL,
  bibliotecas  TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  -- columnas desnormalizadas para filtrar sin abrir el JSON
  titulo       TEXT,
  autores      TEXT,                   -- «Foucault; Deleuze» para FTS y filtros
  anio         INTEGER,
  idioma       TEXT
);
CREATE INDEX IF NOT EXISTS documentos_anio ON documentos(anio);

-- Unidades citables: páginas, tramos de tiempo, diapositivas, secciones, hojas.
CREATE TABLE IF NOT EXISTS unidades (
  id          TEXT PRIMARY KEY,
  documento   TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  orden       INTEGER NOT NULL,
  ancla       TEXT NOT NULL,           -- JSON Ancla
  texto       TEXT NOT NULL DEFAULT '',
  notas       TEXT,                    -- JSON string[]
  cabecera    TEXT,
  pie         TEXT,
  imagen      TEXT,                    -- clave en el almacén
  miniatura   TEXT,
  lector      TEXT NOT NULL,           -- «gemini-3-flash», «capa-pdf», «whisper-large-v3-turbo»
  confianza   REAL NOT NULL DEFAULT 1,
  -- folio impreso desnormalizado para «ir a la página 145»
  impresa     TEXT,
  t0          REAL,
  t1          REAL
);
CREATE INDEX IF NOT EXISTS unidades_doc ON unidades(documento, orden);
CREATE INDEX IF NOT EXISTS unidades_impresa ON unidades(documento, impresa);

CREATE TABLE IF NOT EXISTS secciones (
  id          TEXT PRIMARY KEY,
  documento   TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  padre       TEXT,
  nivel       INTEGER NOT NULL,
  titulo      TEXT NOT NULL,
  unidad_desde TEXT NOT NULL,
  unidad_hasta TEXT,
  resumen     TEXT
);
CREATE INDEX IF NOT EXISTS secciones_doc ON secciones(documento);

-- «n» es el rowid estable que usa el índice FTS5 (un rowid implícito puede
-- cambiar con VACUUM y desincronizar el índice de contenido externo).
CREATE TABLE IF NOT EXISTS fragmentos (
  n           INTEGER PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE,
  documento   TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  unidad      TEXT NOT NULL,
  orden       INTEGER NOT NULL,
  texto       TEXT NOT NULL,
  contexto    TEXT NOT NULL DEFAULT '',
  seccion     TEXT,                    -- JSON string[]
  ancla       TEXT NOT NULL,           -- JSON Ancla
  ancla_fin   TEXT                     -- JSON Ancla, si el fragmento cruza unidades
);
CREATE INDEX IF NOT EXISTS fragmentos_doc ON fragmentos(documento, orden);
CREATE INDEX IF NOT EXISTS fragmentos_unidad ON fragmentos(unidad);

-- Búsqueda léxica (BM25). Indexa texto + contexto + títulos de sección.
CREATE VIRTUAL TABLE IF NOT EXISTS fragmentos_fts USING fts5(
  texto, contexto, seccion,
  content='fragmentos', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS fragmentos_ai AFTER INSERT ON fragmentos BEGIN
  INSERT INTO fragmentos_fts(rowid, texto, contexto, seccion) VALUES (new.n, new.texto, new.contexto, new.seccion);
END;
CREATE TRIGGER IF NOT EXISTS fragmentos_ad AFTER DELETE ON fragmentos BEGIN
  INSERT INTO fragmentos_fts(fragmentos_fts, rowid, texto, contexto, seccion) VALUES ('delete', old.n, old.texto, old.contexto, old.seccion);
END;
CREATE TRIGGER IF NOT EXISTS fragmentos_au AFTER UPDATE ON fragmentos BEGIN
  INSERT INTO fragmentos_fts(fragmentos_fts, rowid, texto, contexto, seccion) VALUES ('delete', old.n, old.texto, old.contexto, old.seccion);
  INSERT INTO fragmentos_fts(rowid, texto, contexto, seccion) VALUES (new.n, new.texto, new.contexto, new.seccion);
END;

CREATE TABLE IF NOT EXISTS figuras (
  id          TEXT PRIMARY KEY,
  documento   TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  unidad      TEXT NOT NULL,
  imagen      TEXT NOT NULL,
  pie         TEXT,
  descripcion TEXT,
  ancla       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS figuras_doc ON figuras(documento);

-- Espacios vectoriales: quién produjo los vectores.
CREATE TABLE IF NOT EXISTS espacios (
  id          TEXT PRIMARY KEY,        -- «gemini-embedding-2@1536»
  proveedor   TEXT NOT NULL,
  modelo      TEXT NOT NULL,
  version     TEXT,
  dims        INTEGER NOT NULL,
  normalizado INTEGER NOT NULL DEFAULT 1,
  modalidades TEXT NOT NULL,           -- JSON Modalidad[]
  creado      TEXT
);

-- Vectores: float32 little-endian, dims × 4 bytes. Varios espacios por objetivo.
CREATE TABLE IF NOT EXISTS vectores (
  objetivo    TEXT NOT NULL,           -- fragmento | unidad | figura
  id          TEXT NOT NULL,
  espacio     TEXT NOT NULL REFERENCES espacios(id),
  documento   TEXT NOT NULL,
  valores     BLOB NOT NULL,
  PRIMARY KEY (objetivo, id, espacio)
);
CREATE INDEX IF NOT EXISTS vectores_doc ON vectores(documento, espacio);

-- Bloques binarios incrustados (solo en .spdf exportados): original, imágenes.
CREATE TABLE IF NOT EXISTS blobs (
  clave       TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  datos       BLOB NOT NULL
);

-- Procedencia y registro de la ingesta: qué se hizo, con qué, cuánto tardó.
CREATE TABLE IF NOT EXISTS procedencia (
  documento   TEXT NOT NULL,
  fase        TEXT NOT NULL,
  proveedor   TEXT,
  detalle     TEXT,                    -- JSON
  ms          INTEGER,
  cuando      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS procedencia_doc ON procedencia(documento);
