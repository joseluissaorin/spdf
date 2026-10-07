# SPDF (Semantic Processed Document Format), versión 5.0

- **Estado:** borrador de trabajo, 2026-10-07. Lo bastante estable para implementarse; los
  cambios pasan por el proceso de RFC (`spec/rfcs/`) y se registran en `spec/CONTRACT.md`
  hasta que la 5.0 sea definitiva.
- **Editor:** José Luis Saorín Ferrer.
- **Esta versión:** `spec/SPEC.es.md` en <https://github.com/joseluissaorin/spdf>.
- **Original inglés:** [`SPEC.md`](SPEC.md). Este documento es la traducción española fiel
  de `SPEC.md`; en caso de discrepancia prevalece el texto inglés.
- **Licencia:** esta especificación se publica bajo
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). El código del repositorio es
  MIT OR Apache-2.0. Quienes contribuyen se comprometen a no hacer valer patentes contra
  las implementaciones.

## Resumen

SPDF es un formato de fichero abierto y portátil para documentos que se han **leído una
vez y pueden citarse para siempre**. Un fichero `.spdf` contiene el texto de un documento
(un libro impreso, un escaneo, una grabación, una presentación de diapositivas, una hoja de
cálculo, una página web) como un conjunto de unidades citables y de fragmentos buscables,
y cada fragmento lleva un **ancla** exacta: la página o la hoja impresas, el segundo de una
grabación, la diapositiva, el verso, la referencia canónica. Una cita producida a partir de
un fichero SPDF solo puede imprimir lo que dice la fuente. El contenedor es una base de
datos SQLite 3 sin más, los metadatos son un elemento CSL-JSON, el índice de texto
completo usa tokenizadores que vienen con cualquier SQLite, y pueden convivir vectores de
embedding opcionales de varios modelos. Cualquier lenguaje con SQLite puede leer SPDF sin
bibliotecas especiales.

## Estado de este documento

Esta es la primera versión pública del formato (las versiones anteriores, de la 3.0 a la
4.1, eran internas de Scholaris y se tratan como legado en [§20](#legacy)). La batería de
conformidad de `conformance/` forma parte de la especificación: cuando este texto y un caso
de conformidad discrepan, la discrepancia es un error que hay que resolver mediante el
proceso de RFC; mientras no se resuelva, las implementaciones siguen el caso de
conformidad.

## Índice

- [Prefacio](#preface)
- [1. Convenciones y terminología](#terminology)
- [2. Contenedor](#container)
- [3. Esquema](#schema)
- [4. Anclas](#anchors)
- [5. URI de ancla](#anchor-uri)
- [6. Metadatos](#metadata)
- [7. Texto, normalización y desplazamientos](#text-normalization)
- [8. Búsqueda de referencia](#search)
- [9. Espacios vectoriales](#vectors)
- [10. Perfiles](#profiles)
- [11. Extensiones](#extensions)
- [12. Volcado canónico](#dump)
- [13. Integridad y firmas](#integrity)
- [14. Consideraciones de seguridad](#security)
- [15. Consideraciones de privacidad](#privacy)
- [16. Derechos](#rights)
- [17. Anotaciones y colecciones](#annotations)
- [18. Cita breve](#citation)
- [19. Exportaciones](#exports)
- [20. Formatos legados](#legacy)
- [21. Conformidad](#conformance)
- [22. Validación](#validation)
- [23. Versionado y compatibilidad](#versioning)
- [24. Tipo de medio e identificación de ficheros](#media-type)
- [25. Internacionalización](#i18n)
- [Referencias](#references)
- [Apéndice A. Cambios respecto a SPDF 4.1](#changes)

<a id="preface"></a>
## Prefacio

SPDF nació dentro de Scholaris, una aplicación escrita por José Luis Saorín Ferrer para
insertar en la escritura académica citas verificadas y exactas en la página. Scholaris
necesitaba leer una fuente una sola vez (con la capa de texto de un PDF, un modelo de
visión o un reconocedor de voz), conservar lo que había leído y responder, años después,
la única pregunta que una cita tiene que responder con honradez: *¿dónde dice exactamente
esto la fuente?* La respuesta tenía que sobrevivir a que el fichero original se moviera, a
que se sustituyera el modelo de lectura y a que se reescribiera el motor de búsqueda. El
resultado fue un fichero por documento, el *Scholaris Processed Document Format*, que pasó
por una versión de JSON y SQLite comprimida con gzip (3.0) y por un esquema SQLite con
nombres en español (4.0 y 4.1).

La versión 5.0 es la primera pensada para todo el mundo. Conserva lo que la experiencia
demostró acertado y abandona lo que la ataba a un solo programa: los identificadores están
en inglés, el contenedor no va comprimido para que pueda proyectarse en memoria y leerse
por rangos HTTP, los metadatos son CSL-JSON sin más para que Zotero, citeproc y Pandoc los
entiendan, y cada número de un caso de conformidad procede de un oráculo que cualquiera
puede volver a ejecutar. El nombre pasó a ser *Semantic Processed Document Format*; las
siglas no cambiaron.

Cinco principios guían cada decisión de esta especificación:

1. **Las anclas, primero.** Cada fragmento sabe exactamente de dónde procede: página
   física y folio impreso, hoja y cara, segundo, diapositiva, verso, referencia canónica.
   Nada que no pueda anclarse es citable.
2. **Procedencia.** Un fichero dice quién leyó cada unidad y con qué confianza, qué modelo
   produjo cada vector y cómo se obtuvo cada campo de los metadatos. Los datos derivados
   pueden recalcularse a partir del original más las unidades.
3. **Leer una vez, consultar muchas.** Leer un documento es caro (modelos de visión,
   reconocimiento de voz, corrección humana); consultarlo tiene que ser barato, posible
   sin conexión y posible desde cualquier lenguaje con SQLite.
4. **Portabilidad.** Un fichero, un documento, ningún servidor, ninguna dependencia
   propietaria, ninguna capa de compresión que deshacer, ningún código dentro del fichero.
   Lectores escritos en muchos lenguajes superan la misma batería de conformidad.
5. **Cita honrada.** Una cita imprime solo lo que dice un ancla. Un folio que se infirió
   se imprime entre corchetes; una página sin numerar se cita como sin numerar; la grafía
   modernizada que se usa para buscar nunca se cita textualmente.

<a id="terminology"></a>
## 1. Convenciones y terminología

Las palabras clave «DEBE», «NO DEBE», «OBLIGATORIO», «DEBERÁ», «NO DEBERÁ», «DEBERÍA»,
«NO DEBERÍA», «RECOMENDADO», «NO RECOMENDADO», «PUEDE» y «OPCIONAL» de este documento, así
como sus formas de plural y de femenino, se interpretan como sus equivalentes ingleses
descritos en BCP 14 [RFC 2119] [RFC 8174] cuando, y solo cuando, aparecen en mayúsculas,
como aquí. La correspondencia es la siguiente:

| español | inglés (BCP 14) |
|---|---|
| DEBE, DEBEN | MUST |
| NO DEBE, NO DEBEN | MUST NOT |
| OBLIGATORIO, OBLIGATORIA, OBLIGATORIOS, OBLIGATORIAS | REQUIRED |
| DEBERÁ, DEBERÁN | SHALL |
| NO DEBERÁ, NO DEBERÁN | SHALL NOT |
| DEBERÍA, DEBERÍAN | SHOULD |
| NO DEBERÍA, NO DEBERÍAN | SHOULD NOT |
| RECOMENDADO, RECOMENDADA, RECOMENDADOS, RECOMENDADAS | RECOMMENDED |
| NO RECOMENDADO, NO RECOMENDADA, NO RECOMENDADOS, NO RECOMENDADAS | NOT RECOMMENDED |
| PUEDE, PUEDEN | MAY |
| OPCIONAL, OPCIONALES | OPTIONAL |

El ABNF sigue [RFC 5234]. El JSON sigue [RFC 8259]; «objeto JSON», «array», «cadena» y
«número» tienen el significado que les da RFC 8259. El SQL sigue el dialecto de SQLite.

- **Documento**: la obra que describe un fichero SPDF (una por fichero).
- **Original**: los bytes a partir de los cuales se leyó el documento (PDF, conjunto de
  imágenes, audio, EPUB…).
- **Unidad**: una división citable del documento: una página u hoja, un intervalo de
  tiempo, una diapositiva, una sección, un rango de una hoja de cálculo. Las unidades están
  ordenadas y se numeran desde 1.
- **Fragmento**: un pasaje buscable y citable de unas 150 a 300 palabras, con el ancla de
  su inicio y, si atraviesa unidades, la de su fin.
- **Ancla**: un objeto JSON que localiza una unidad, un fragmento o una figura en el
  documento ([§4](#anchors)).
- **URI de ancla**: la forma textual de un ancla, `spdf:<docref>#<params>` ([§5](#anchor-uri)).
- **Espacio**: un espacio vectorial, es decir, el modelo, las dimensiones y la codificación
  que produjeron un conjunto de vectores de embedding ([§9](#vectors)).
- **Lector**: software que abre ficheros SPDF y expone su contenido. **Escritor**:
  software que crea ficheros SPDF. **Validador**: software que comprueba si los ficheros
  se ajustan a esta especificación. **Productor**: un escritor que además lee originales
  (OCR, reconocimiento de voz, vectores).
- **Punto de código**: un valor escalar Unicode. Las longitudes y los desplazamientos de
  esta especificación cuentan puntos de código, nunca bytes ni unidades de código UTF-16.
- **NFC**: la forma de normalización C de Unicode [UAX #15].
- **JCS**: el esquema de canonicalización de JSON (JSON Canonicalization Scheme)
  [RFC 8785].

<a id="container"></a>
## 2. Contenedor

### 2.1 Fichero

Un fichero SPDF 5.0 es un fichero de base de datos SQLite 3 [SQLITE-FORMAT] que contiene
exactamente un documento. NO DEBE ir envuelto en ninguna capa de compresión ni de
archivo: la cabecera de la base de datos DEBE empezar en el byte 0.

Los escritores DEBEN establecer:

- `PRAGMA application_id = 1397769286` (0x53504446 en hexadecimal). SQLite lo guarda en
  orden big-endian en el desplazamiento 68 de la cabecera, de modo que los bytes 68 a 71
  dicen «SPDF» en ASCII.
- `PRAGMA user_version = 500`. El valor codifica la versión de la especificación como
  mayor × 100 + menor × 10 (5.0 → 500, 5.1 → 510).
- La fila `spdf_version` de `spdf_meta` con el valor `"5.0"` ([§3.2](#schema)).

Los escritores DEBERÍAN usar un tamaño de página de 4096 bytes y el diario de reversión
(rollback journal) en modo `DELETE` (nunca dejar un fichero `-wal` o `-journal` junto a
un fichero distribuido), y ejecutar `VACUUM` tras la última escritura para que el fichero
no tenga páginas libres. Los escritores NO DEBERÍAN usar `auto_vacuum`.

Un fichero NO DEBE contener disparadores (triggers) ni vistas, y NO DEBE contener tablas
virtuales distintas de las tablas FTS5 definidas en [§3](#schema). Los escritores mantienen
por sí mismos sincronizado el índice de texto completo (por ejemplo, con
`INSERT INTO fragments_fts(fragments_fts) VALUES('rebuild')` antes de `VACUUM`).

### 2.2 Nombre y tipo

La extensión de fichero es `.spdf`. El tipo de medio es `application/vnd.spdf+sqlite3`
([§24](#media-type)). Un fichero contiene un documento; las bibliotecas de documentos se
describen mediante un manifiesto de colección aparte ([§17](#annotations)).

### 2.3 Entrada comprimida con gzip

Los ficheros legados 4.x son bases de datos SQLite envueltas en gzip [RFC 1952]
([§20](#legacy)). Por ello, los lectores DEBEN aceptar un fichero que empiece por los
bytes mágicos de gzip `1F 8B`, descomprimirlo (en memoria o en un fichero temporal) con un
límite configurable del tamaño descomprimido (valor por defecto RECOMENDADO: 4 GiB) y
continuar con el resultado. Un fichero 5.0 envuelto en gzip es legible pero no conforme:
los validadores lo notifican como `E003` en la lista de avisos ([§22](#validation)).

### 2.4 Apertura segura

Los ficheros SPDF vienen de desconocidos. Todo lector DEBE abrirlos como sigue, y DEBE
rechazar el fichero si su enlace (binding) con SQLite no permite cumplir alguno de los
pasos:

1. Abrir la base de datos en solo lectura (`SQLITE_OPEN_READONLY`, o el parámetro de URI
   `mode=ro`). Nunca abrir un fichero distribuido en lectura y escritura en su ubicación.
2. `PRAGMA query_only = 1` y `PRAGMA trusted_schema = OFF`.
3. Activar `SQLITE_DBCONFIG_DEFENSIVE` donde el enlace lo ofrezca, y mantener desactivada
   la carga de extensiones (`sqlite3_enable_load_extension(db, 0)`; nunca llamar a
   `load_extension`).
4. Leer `sqlite_master` y rechazar el fichero si contiene un disparador, una vista o una
   tabla virtual distinta de `fragments_fts` y `fragments_fts_trigram` declaradas `USING
   fts5`. A los ficheros legados 4.x se les permiten exactamente los tres disparadores
   `fragmentos_ai`, `fragmentos_ad` y `fragmentos_au` ([§20](#legacy)), que nunca se
   activan en una conexión de solo lectura.
5. Imponer un tamaño máximo configurable a cada valor BLOB o TEXT que se lea (valor por
   defecto RECOMENDADO: 512 MiB), por ejemplo con
   `sqlite3_limit(db, SQLITE_LIMIT_LENGTH, …)`.

Los lectores DEBERÍAN además desactivar la E/S proyectada en memoria
(`PRAGMA mmap_size = 0`) y activar `PRAGMA cell_size_check = ON` para ficheros de fuentes
no fiables, y PUEDEN ejecutar `PRAGMA quick_check` antes de usarlos. Las operaciones que
necesitan escribir, como la orden `integrity-check` de FTS5, DEBEN ejecutarse sobre una
copia privada (por ejemplo, una copia en memoria hecha con la API de copia de seguridad),
nunca sobre el fichero. [§14](#security) explica las amenazas.

<a id="schema"></a>
## 3. Esquema

### 3.1 Visión general

El esquema normativo es el script SQL [`schema/spdf-5.0.sql`](schema/spdf-5.0.sql), que se
reproduce íntegro a continuación. Todas sus tablas son OBLIGATORIAS, aunque estén vacías;
solo `fragments_fts_trigram` es OPCIONAL. Los nombres, los tipos y las restricciones de las
columnas DEBEN ser los que figuran en él. Los escritores NO DEBEN añadir columnas a estas
tablas; los datos que no encajan van a tablas de extensión ([§11](#extensions)). Los
lectores DEBEN ignorar las columnas que no conocen (una versión menor posterior puede
añadir columnas OPCIONALES, [§23](#versioning)).

El JSON guardado en columnas TEXT DEBE ser JSON válido [RFC 8259] codificado en UTF-8; los
escritores PUEDEN serializarlo de cualquier forma (el volcado canónico lo vuelve a
serializar, [§12](#dump)). Las marcas de tiempo son cadenas ISO 8601 / RFC 3339 en UTC con
el sufijo `Z`. Los identificadores (columnas `id`) son cadenas no vacías que elige el
escritor; son opacos, distinguen entre mayúsculas y minúsculas y son estables durante toda
la vida del fichero.

```sql
PRAGMA application_id = 1397769286;  -- 0x53504446, "SPDF"
PRAGMA user_version = 500;

CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE documents (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, metadata TEXT NOT NULL,
  source_sha256 TEXT NOT NULL, source_ref TEXT, mime TEXT NOT NULL,
  bytes INTEGER NOT NULL, unit_count INTEGER NOT NULL, duration REAL,
  created TEXT NOT NULL, updated TEXT NOT NULL,
  title TEXT, authors TEXT, year INTEGER, language TEXT, rights TEXT);

CREATE TABLE units (
  id TEXT PRIMARY KEY, document TEXT NOT NULL REFERENCES documents(id),
  ord INTEGER NOT NULL, anchor TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
  notes TEXT, header TEXT, footer TEXT, image TEXT, thumbnail TEXT,
  reader TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, printed TEXT,
  t0 REAL, t1 REAL, words TEXT);
CREATE INDEX units_doc ON units(document, ord);
CREATE INDEX units_printed ON units(document, printed);

CREATE TABLE sections (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL,
  title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT);

CREATE TABLE fragments (
  n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT NOT NULL,
  unit TEXT NOT NULL, ord INTEGER NOT NULL, text TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '', section TEXT, anchor TEXT NOT NULL,
  anchor_end TEXT, search_text TEXT);
CREATE INDEX fragments_doc ON fragments(document, ord);
CREATE INDEX fragments_unit ON fragments(unit);

CREATE VIRTUAL TABLE fragments_fts USING fts5(
  text, context, section, search_text,
  content='fragments', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2');
-- OPTIONAL:
-- CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(
--   text, content='fragments', content_rowid='n', tokenize='trigram');

CREATE TABLE figures (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL,
  image TEXT NOT NULL, caption TEXT, description TEXT, anchor TEXT NOT NULL);

CREATE TABLE spaces (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, version TEXT,
  dims INTEGER NOT NULL, dtype TEXT NOT NULL DEFAULT 'f32',
  normalized INTEGER NOT NULL DEFAULT 1, truncated_from INTEGER,
  modalities TEXT NOT NULL, task_prefixes TEXT, created TEXT);

CREATE TABLE vectors (
  target TEXT NOT NULL, id TEXT NOT NULL, space TEXT NOT NULL REFERENCES spaces(id),
  document TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (target, id, space));

CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL,
  data BLOB NOT NULL);

CREATE TABLE provenance (
  document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT,
  detail TEXT, ms INTEGER, at TEXT NOT NULL);

CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0);
```

### 3.2 `spdf_meta`

Pares clave/valor sobre el fichero. Claves OBLIGATORIAS:

| clave | valor |
|---|---|
| `spdf_version` | `"5.0"` |
| `profile` | nombres de perfil separados por espacios, un subconjunto de `core semantic media full` ([§10](#profiles)); siempre incluye `core` |
| `created` | momento de creación del fichero (UTC) |
| `generator` | `name/version` del escritor, p. ej. `spdf-producer/0.3.1` |
| `document_id` | igual a `documents.id` |

Claves OPCIONALES: `content_sha256`, `signature`, `signer` ([§13](#integrity)) y
`license_note` (texto libre para personas). Versiones posteriores o extensiones (con el
prefijo `x_<vendor>_`) PUEDEN añadir otras claves; los lectores DEBEN ignorar las claves
que no conocen.

### 3.3 `documents`

Exactamente una fila.

- `kind`: uno de `pdf` (PDF con una capa de texto utilizable), `scanned_pdf` (PDF leído
  por visión), `photos` (un conjunto de fotografías de páginas), `image` (una sola
  imagen), `audio`, `video`, `document` (DOCX, ODT, RTF, HTML, Markdown, texto plano),
  `epub`, `slides`, `sheet`, `web`. Los lectores DEBEN aceptar tipos desconocidos y
  tratarlos como `document`.
- `metadata`: el elemento CSL-JSON con la extensión `spdf` ([§6](#metadata)).
- `source_sha256`: SHA-256 en hexadecimal en minúsculas de los bytes del original.
  Identifica el documento a través de sus copias y es la referencia de documento preferida
  en las URI de ancla.
- `source_ref`: dónde está el original: `blob:<key>` cuando va dentro del fichero, una URL
  absoluta, o NULL.
- `mime`, `bytes`: tipo de medio y tamaño en bytes del original.
- `unit_count`: número de filas de `units` (una discrepancia es el aviso W102).
- `duration`: segundos, para audio y vídeo; NULL en los demás casos.
- `created`, `updated`: cuándo se creó el registro del documento y cuándo se modificó por
  última vez.
- `title`, `authors`, `year`, `language`: copias desnormalizadas para filtrar sin analizar
  el JSON: el `title` de CSL; los apellidos (o los nombres literales) de la lista `author`
  de CSL unidos con `"; "`; el primer año de `issued`; el `language` de CSL. Cuando están
  presentes, DEBEN coincidir con `metadata`.
- `rights`: objeto JSON de derechos ([§16](#rights)) o NULL.

### 3.4 `units`

Una fila por unidad citable, `ord` = 1, 2, 3… sin huecos (E090), en orden de lectura.

- `anchor`: el ancla de la unidad ([§4](#anchors)).
- `text`: el texto completo de la unidad tal como se leyó, en NFC y en Markdown ligero
  ([§7](#text-normalization)). Cadena vacía para las unidades sin texto (una página en
  blanco, una fotografía).
- `notes`: array JSON de cadenas (notas al pie separadas del cuerpo) o NULL.
- `header`, `footer`: cabeceras y pies de página recurrentes, que se mantienen fuera de
  `text`, o NULL.
- `image`, `thumbnail`: `blob:<key>` o URL de la imagen de la unidad (página, fotograma,
  diapositiva) y de su miniatura, o NULL.
- `reader`: lo que produjo `text` (`pdf-text-layer`, `tesseract-5`, `gemma-4-e4b`,
  `whisper-large-v3-turbo`, `human`…). `confidence`: de 0 a 1.
- `printed`: el folio impreso de una unidad de tipo página, copiado de su ancla, para que
  los lectores puedan «ir a la página 145» con un índice.
- `t0`, `t1`: inicio y fin en segundos, copiados de un ancla de tiempo; NULL en los demás
  casos.
- `words`: tiempos de las palabras para audio y vídeo ([§7.4](#text-normalization)) o
  NULL.

### 3.5 `sections`

El árbol de encabezados. `level` empieza en 1; `parent` es el id de la sección que la
contiene o NULL; `unit_from` y `unit_to` son los ids de la primera y de la última unidad
(`unit_to` es NULL cuando la sección termina con el documento); `summary` es un texto
OPCIONAL en la lengua del documento.

### 3.6 `fragments`

- `n`: un entero positivo, único y estable: es el rowid que usa el índice FTS5 (un rowid
  implícito puede cambiar con `VACUUM`).
- `unit`: id de la unidad donde empieza el fragmento. `ord`: orden de lectura dentro del
  documento (creciente con la posición del fragmento en el texto).
- `text`: el pasaje literal, en NFC, exactamente como en la fuente (nunca modernizado).
- `context`: una línea que sitúa el fragmento en la obra («Capítulo III: la lucha por la
  existencia»), que usa la búsqueda; cadena vacía si no la hay.
- `section`: array JSON de cadenas, la ruta de encabezados, o NULL.
- `anchor`: ancla del inicio del fragmento. `anchor_end`: ancla de su fin cuando pasa a
  otra unidad; NULL en los demás casos.
- `search_text`: la capa de grafía modernizada ([§25.3](#i18n)): texto que se usa SOLO
  para la búsqueda (`aſsi` → `así`, `V. M.` → `vuestra merced`). Cadena vacía cuando no
  aporta nada; NULL cuando no se ha calculado. NO DEBE mostrarse como el texto de la fuente
  ni citarse textualmente.

### 3.7 `fragments_fts` y `fragments_fts_trigram`

`fragments_fts` es un índice FTS5 de contenido externo sobre `fragments` con las columnas
`text`, `context`, `section` y `search_text`, en este orden, y el tokenizador
`unicode61 remove_diacritics 2`, que ofrece cualquier SQLite con FTS5. DEBE estar
sincronizado con `fragments` (E070). `fragments_fts_trigram` es OPCIONAL, indexa solo
`text` con el tokenizador `trigram` (SQLite 3.34 o posterior) y DEBERÍA estar presente
cuando el documento está mayoritariamente en chino, japonés o coreano.

### 3.8 `figures`

Figuras, láminas, tablas en forma de imagen, fotografías dentro de una página. `image` es
el `blob:<key>` de una imagen recortada, o la imagen de la unidad junto con una `region`
en el ancla. `caption` es el pie de figura impreso, si lo hay; `description` es una
descripción en la lengua del documento (para la accesibilidad y la búsqueda). `anchor`
lleva normalmente una `region`.

### 3.9 `spaces` y `vectors`

Véase [§9](#vectors). `vectors.target` es `fragment`, `unit` o `figure`, y `vectors.id` es
el id de esa fila; `data` es el vector en orden little-endian.

### 3.10 `blobs`

Contenido binario incluido en el fichero: el original, imágenes de página, figuras
recortadas, miniaturas. `key` es una cadena opaca (por convención, con forma de ruta:
`pages/0001.png`), `mime` su tipo de medio, `sha256` el SHA-256 en hexadecimal en
minúsculas de `data` (E080). Las demás tablas se refieren a un blob como `blob:<key>`.

### 3.11 `provenance`

Una fila por paso de producción: `stage` (`reading`, `transcription`, `folios`,
`metadata`, `embedding`, `figures`…), `provider`, `model`, `detail` (objeto JSON o
NULL), `ms` (duración en milisegundos) y `at` (marca de tiempo UTC). Véase
[§15](#privacy) para saber qué no registrar.

### 3.12 `extensions`

Véase [§11](#extensions).

<a id="anchors"></a>
## 4. Anclas

### 4.1 Generalidades

Un ancla es un objeto JSON con un miembro `type` de tipo cadena. Los tipos que define esta
versión y sus miembros son:

| tipo | miembros OBLIGATORIOS | miembros OPCIONALES |
|---|---|---|
| `page` | `physical` (entero ≥ 1), `printed` (cadena o null) | `roman` (booleano), `foliation` (`page`, `leaf`, `column`; por defecto, `page`), `source` (`read`, `inferred`, `epub`, `none`), `confidence` (0–1) |
| `time` | `t0`, `t1` (segundos, 0 ≤ t0 ≤ t1) | `speaker` (cadena) |
| `section` | `path` (array de cadenas) | `paragraph` (entero ≥ 1), `printed` (cadena) |
| `slide` | `n` (entero ≥ 1) | |
| `sheet` | `sheet` (cadena), `row_from`, `row_to` (enteros) | |
| `web` | `url` (cadena) | `path`, `paragraph`, `accessed` (fecha ISO) |
| `image` | | |
| `verse` | `line_from` (entero) | `line_to` (entero), `printed` (cadena) |
| `canonical` | `scheme` (cadena), `ref` (cadena) | |

Toda ancla PUEDE llevar además:

- `region`: `{"x", "y", "w", "h"}`, números entre 0 y 1, fracciones de la anchura y de la
  altura de la imagen de la unidad, con el origen en la esquina superior izquierda;
- `chars`: `[start, end]`, desplazamientos en puntos de código dentro del `text` en NFC de
  la unidad del ancla, `0 ≤ start ≤ end ≤ length`, con el fin excluido (E042);
- `matter`: la clase de materia de la unidad: `body` (el texto de la obra), `front`
  (preliminares: portada, índice, licencias, dedicatoria, prólogo de una edición), `back`
  (índices, colofón, apéndices de una edición), `plate` (una lámina o desplegable fuera de
  las páginas de texto), `cover` (cubierta), `library` (exlibris, sellos, páginas de la
  biblioteca o del digitalizador, licencias de una edición digital) o `blank` (en
  blanco). Si falta, vale `body`; los lectores DEBEN tratar como `body` los valores que no
  conozcan. Los escritores DEBERÍAN indicarla en las unidades de los documentos paginados
  siempre que no sea `body`.

En esta especificación, un «entero» es un número JSON de valor entero: `10` y `10.0` son
el mismo valor JSON y ambos son enteros. Un ancla cuyo JSON no es válido, o a la que le
falta un miembro OBLIGATORIO o lo tiene con un tipo erróneo, no es válida (E040); un
`type` desconocido es E041. Los lectores DEBEN conservar los miembros que no conocen
cuando copian anclas.

### 4.2 Páginas, folios y hojas

`physical` es la posición de la página en el original, contando desde 1 (el índice de
página del PDF, el número de la foto). `printed` es el folio exactamente como está impreso
en la página («23», «xiv», «A-3», «1r»), o null cuando la página no lleva número.

- `roman: true` marca los folios en números romanos (preliminares).
- `foliation` describe qué cuentan los números impresos: `page` (cada página numerada),
  `leaf` (cada hoja numerada, con las caras `r`ecto y `v`erso, impresas como `"1r"`,
  `"1v"`) o `column` (columnas numeradas, como en algunos diccionarios y en los primeros
  libros impresos).
- `source` indica cómo se obtuvo `printed`: `read` (visto en la página), `inferred`
  (deducido de las páginas vecinas, p. ej. un verso sin numerar), `epub` (de una lista de
  páginas EPUB), `none` (sin folio; `printed` es null).
- Un folio inferido se cita entre corchetes, `p. [21]`; una página sin folio se cita como
  sin numerar ([§18](#citation)). Un productor NO DEBE inventar folios: si ninguna prueba
  respalda un número, `printed` es null y `source` es `none`.

### 4.3 Tiempo, secciones, versos y referencias canónicas

Las anclas de tiempo localizan grabaciones en segundos desde el inicio del original;
`speaker` nombra a quien habla. Las anclas de sección localizan texto sin paginar (EPUB,
DOCX, HTML) por ruta de encabezados y número de párrafo, y PUEDEN añadir la página impresa
equivalente cuando la edición ofrece una lista de páginas. Las anclas de verso cuentan
versos (`line_from`, `line_to`), tal como los numeran las ediciones impresas. Las anclas
canónicas usan un sistema de cita independiente de cualquier edición: `stephanus`
(Platón), `bekker` (Aristóteles), `bible` (libro capítulo:versículo), `cts` (un URN de CTS
[CTS]) o cualquier otro esquema documentado; los esquemas se escriben en ASCII en
minúsculas.

### 4.4 Inicio y fin

El `anchor` de un fragmento localiza su inicio; `anchor_end`, cuando está presente,
localiza su fin y tiene el mismo `type`. La cita del fragmento entero imprime entonces un
rango (`pp. 145-146`).

- La **unidad final** de un fragmento es la primera unidad posterior a su unidad inicial
  (en orden de `ord`) cuya ancla es igual a `anchor_end` una vez quitados `chars` y
  `region` de ambas.
- `chars` en `anchor` da la parte del fragmento que está en la unidad inicial, y `chars` en
  `anchor_end`, la parte que está en la unidad final (normalmente `[0, b]`). Los escritores
  DEBERÍAN indicar los dos en los fragmentos que cruzan unidades, para que los lectores
  sepan de qué unidad viene cada parte del pasaje.
- Los escritores NO DEBERÍAN dejar que un fragmento cruce de una unidad de una clase de
  `matter` a otra (del texto de la obra a una lámina, una cubierta, una página de la
  biblioteca o una licencia), ni de una página con folio impreso a otra sin él: la cita de
  un fragmento así mezclaría localizadores de naturaleza distinta. Los validadores
  notifican esos fragmentos con W103.

<a id="anchor-uri"></a>
## 5. URI de ancla

### 5.1 Sintaxis

Una URI de ancla nombra un lugar de un documento con independencia de cualquier fichero:

```
spdf:sha256-3f2a…c9#p=29&f=21&char=118,301
```

La referencia de documento es `sha256-` seguido de los 64 dígitos hexadecimales en
minúsculas de `documents.source_sha256` (RECOMENDADA: es la misma para todas las copias
del documento), o el id del documento con codificación porcentual. El fragmento es una
lista de parámetros. Los parámetros reutilizan la sintaxis de W3C Media Fragments
[MEDIA-FRAGMENTS] para el tiempo (`t=`) y el espacio (`xywh=`) y la sintaxis de RFC 5147
[RFC 5147] para los rangos de caracteres (`char=`), de modo que las herramientas que
conocen esos estándares pueden interpretarlos.

La forma canónica se define mediante este ABNF [RFC 5234]:

```abnf
spdf-uri    = "spdf:" docref [ "#" params ]
docref      = hash-ref / id-ref
hash-ref    = "sha256-" 64lhex
lhex        = DIGIT / %x61-66                     ; 0-9 a-f
id-ref      = 1*vchar                             ; percent-encoded document id
params      = param *( "&" param )
param       = p / pe / f / fe / t / s / para / sl / sh / rows / v / ref / char / xywh
p           = "p=" posint                         ; physical page
pe          = "pe=" posint                        ; physical end page
f           = "f=" value                          ; printed folio
fe          = "fe=" value                         ; printed end folio
t           = "t=" number [ "," number ]          ; seconds, Media Fragments npt
s           = "s=" value *( "/" value )           ; section path
para        = "para=" uint                        ; paragraph
sl          = "sl=" posint                        ; slide
sh          = "sh=" value                         ; sheet name
rows        = "rows=" uint "-" uint               ; sheet rows
v           = "v=" uint [ "-" uint ]              ; verse lines
ref         = "ref=" value ":" value              ; canonical scheme ":" reference
char        = "char=" uint "," uint               ; code points, RFC 5147 style
xywh        = "xywh=percent:" number "," number "," number "," number
value       = *vchar
vchar       = unreserved / pct-encoded
unreserved  = ALPHA / DIGIT / "-" / "." / "_" / "~"
pct-encoded = "%" HEXDIG HEXDIG                   ; uppercase in the canonical form
posint      = %x31-39 *DIGIT
uint        = "0" / posint
number      = uint [ "." 1*DIGIT ]
```

En la forma canónica, los parámetros aparecen como mucho una vez y en el orden de la regla
`param` anterior (`p`, `pe`, `f`, `fe`, `t`, `s`, `para`, `sl`, `sh`, `rows`, `v`, `ref`,
`char`, `xywh`); los valores son cadenas UTF-8 en las que todo byte que no sea un carácter
no reservado se codifica en porcentaje con dígitos hexadecimales en mayúsculas; en `s`,
los separadores entre los elementos de la ruta son barras `/` literales y una `/` dentro
de un elemento es `%2F`; en `ref`, el primer `:` literal separa el esquema de la
referencia, y los dos puntos que haya dentro de ellos son `%3A`. Los números usan la forma
decimal más corta de ECMAScript (`4160`, `4175.5`, `0.125`), nunca un exponente.

### 5.2 De un ancla a una URI

El formateo hace corresponder un ancla (y, opcionalmente, un ancla de fin) con parámetros:

| ancla | parámetros |
|---|---|
| `page` | `p` = `physical`; `f` = `printed` si no es null; con una página de fin: `pe` = su `physical` si es distinto, `fe` = su `printed` si no es null y es distinto de `printed` |
| `time` | `t` = `t0` y después `t1` (o el `t1` del ancla de fin) |
| `section`, `web` | `s` = `path` si no está vacío; `para` = `paragraph`; `f` = `printed`; `fe` como para las páginas |
| `slide` | `sl` = `n` |
| `sheet` | `sh` = `sheet`; `rows` = `row_from`-`row_to` |
| `verse` | `v` = `line_from`, o `line_from`-`line_to` cuando `line_to` está presente y es distinto; `f` = `printed` |
| `canonical` | `ref` = `scheme`:`ref` |
| `image` | ninguno |
| cualquiera | `char` = `chars`; `xywh` = `region` × 100, como `percent:` |

Los valores de `t` se redondean a 6 decimales. Los valores de `xywh` son las fracciones ×
100 redondeadas a 4 decimales (`0.125` → `12.5`, `0.333333` → `33.3333`). Una URI sin
parámetros (`spdf:<docref>`) designa el documento entero.

### 5.3 Análisis sintáctico

El análisis devuelve la referencia de documento y un objeto **localizador** con un miembro
por cada parámetro presente: `p`, `pe`, `para`, `sl` (enteros); `f`, `fe`, `sh`
(cadenas); `t` (array de uno o dos números); `s` (array de cadenas); `rows` (dos enteros);
`v` (uno o dos enteros); `ref` (objeto con `scheme` y `ref`); `char` (dos enteros); `xywh`
(cuatro fracciones: los valores porcentuales divididos entre 100 y redondeados a 6
decimales).

Los analizadores DEBEN aceptar la codificación porcentual con dígitos hexadecimales en
minúsculas, los parámetros en cualquier orden, los caracteres no ASCII sin codificar
(forma IRI [RFC 3987]), el prefijo `npt:` y las formas de reloj `h:mm:ss[.f]` y
`mm:ss[.f]` en `t`. Los analizadores DEBEN ignorar los parámetros cuyo nombre no conocen.
Los analizadores DEBEN rechazar: un esquema distinto de `spdf:`; una referencia de
documento vacía; un parámetro repetido; números mal formados; `p`, `pe` o `sl` iguales a
0; un rango de `char` o de `t` cuyo fin precede a su inicio; `xywh` sin la unidad
`percent:` (las coordenadas en píxeles no pueden resolverse sin la imagen); una
codificación porcentual que no se decodifica como UTF-8 válido.

Formatear un localizador analizado DEBE devolver la URI canónica byte a byte. La batería
de conformidad comprueba el formateo, el análisis y la ida y vuelta para cada tipo de
ancla.

### 5.4 Resolución

`locate(file, reference)` resuelve una URI de ancla, o la URL de un recurso SPDF con
identificador de fragmento ([§24](#media-type)), contra un fichero, y devuelve:

```json
{"document": true, "units": ["p5", "p6"], "fragments": ["q4"], "char": [101, 278], "xywh": null}
```

1. **Referencia.** Una URI `spdf:` se analiza como en el [§5.3](#anchor-uri); `document`
   es verdadero cuando su referencia de documento es `sha256-` seguido del
   `source_sha256` del fichero, o el id de documento del fichero. Cualquier otra
   referencia (una URL `https:`, una ruta de fichero) designa el propio fichero:
   `document` es verdadero y el texto que sigue a su primer `#`, si lo hay, se analiza
   como la lista de parámetros del §5.3. Cuando `document` es falso, `units` y
   `fragments` están vacíos (las implementaciones PUEDEN notificarlo como un error; los
   ejecutores de la batería traducen ese error a `document: false`).
2. **Regla.** El primer parámetro presente en el orden `p`, `f`, `t`, `sl`, `v`, `ref`,
   `s`, `sh` elige el predicado de abajo. Sin ninguno de ellos (sin fragmento, o solo con
   `char` y `xywh`), la referencia designa el documento entero y `units` y `fragments`
   están vacíos.
3. **Predicado** sobre un ancla (los miembros ausentes del ancla nunca coinciden):
   - `p`: un ancla `page` con `p ≤ physical ≤ pe` (`pe` vale `p` por defecto);
   - `f`: `printed` igual a `f` (en las unidades, la columna `units.printed`);
   - `t`: un ancla `time` con `t0 ≤ t < t1`, donde `t` es el primer valor del parámetro;
     la última unidad con ancla de tiempo (en orden de `ord`) también coincide cuando `t`
     es igual a su `t1`;
   - `sl`: un ancla `slide` con `n = sl`;
   - `v`: un ancla `verse` con `line_from ≤ v ≤ line_to` (`line_to` vale `line_from` por
     defecto), donde `v` es el primer valor del parámetro;
   - `ref`: un ancla `canonical` con el mismo `scheme` y el mismo `ref`;
   - `s`: un ancla `section` o `web` cuya `path` empieza por los elementos de `s`; cuando
     está presente `para`, la `path` debe ser igual a `s` y `paragraph` igual a `para`;
   - `sh`: un ancla `sheet` con `sheet = sh` y, cuando está presente `rows`,
     `row_from ≤ a ≤ row_to` para su primer valor `a`.
4. **Coincidencias.** `units` son los id de las unidades cuya ancla coincide, en orden de
   `ord`. `fragments` son los id de los fragmentos cuya `anchor` de inicio o cuya
   `anchor_end` coincide, en orden de `n` (un fragmento que termina en una página se
   encuentra desde esa página). Cuando no coincide ninguna unidad pero sí algunos
   fragmentos, `units` son las unidades iniciales distintas de esos fragmentos, en orden
   de `ord`.
5. **Caracteres.** `char` se refiere al texto de la primera unidad de `units`. Cuando está
   presente `char` = `[c, d]`, un fragmento se conserva en `fragments` solo si su unidad
   inicial es esa unidad y su `anchor` tiene `chars` = `[a, b]` que se solapan con el rango,
   o si su unidad final ([§4.4](#anchors)) es esa unidad y su `anchor_end` tiene `chars`
   que se solapan con él; `[a, b]` se solapa con `[c, d]` cuando `a < d` y `c < b` (si
   `c < d`), o cuando `a ≤ c < b` (si `c = d`).
6. `char` y `xywh` se copian del localizador, o son null.

Pueden coincidir varias unidades (dos páginas con el folio impreso «1», un número de verso
repetido en dos poemas): `locate` las devuelve todas y el lector deja elegir al usuario;
`p` siempre deshace la ambigüedad entre páginas, y por eso las URI formateadas lo llevan.

Se prevé el registro provisional del esquema de URI `spdf` [RFC 7595]; la solicitud está
redactada en `governance/drafts/uri-scheme-spdf.md`.

<a id="metadata"></a>
## 6. Metadatos

### 6.1 Elemento CSL-JSON

`documents.metadata` es un elemento CSL-JSON [CSL-JSON] que describe el documento tal como
ha de citarse: como mínimo, `type` (un tipo CSL como `book`, `article-journal`, `chapter`,
`thesis`, `speech`, `interview`, `broadcast`, `motion_picture`, `webpage`, `dataset`,
`graphic`) y `title` (E051 si falta alguno de los dos). Miembros habituales: `author`,
`editor`, `translator`, `interviewer` (arrays de nombres `{family, given}` o `{literal}`,
con las partículas CSL `non-dropping-particle` y `dropping-particle` cuando hace falta),
`issued` (`{"date-parts": [[year, month, day]]}`), `original-date`, `title-short`,
`original-title`, `container-title`, `collection-title`, `publisher`, `publisher-place`,
`volume`, `issue`, `page`, `edition`, `DOI`, `ISBN`, `ISSN`, `URL`, `accessed`,
`language` (BCP 47), `abstract`, `note`. El miembro `id` es OPCIONAL dentro del fichero;
las exportaciones lo establecen ([§19](#exports)).

Los escritores NO DEBEN inventar metadatos. Un campo que no puede respaldarse con el
original o con una fuente externa citada se omite.

### 6.2 El objeto de extensión `spdf`

El miembro `spdf` del elemento contiene lo que CSL no puede expresar. Todos sus miembros
son OPCIONALES:

```json
"spdf": {
  "provenance": {"title": {"source": "title-page", "confidence": 0.99},
                 "issued": {"source": "colophon", "confidence": 0.95}},
  "undated": {"from": 1600, "to": 1610, "basis": "printer active years"},
  "original_language": "fr",
  "subtitle": "con anotaciones de Fernando de Herrera",
  "orcid": {"Foucault, Michel": "0000-0000-0000-0000"}
}
```

- `provenance`: para cada campo CSL, de dónde procede el valor (`reading`, `title-page`,
  `colophon`, `crossref`, `openalex`, `wikidata`, `user`, `epub`, `pdf`, …) y una
  confianza entre 0 y 1.
- `undated`: para obras sin fecha impresa, un rango verosímil (`from`, `to`, años,
  negativos para los años antes de Cristo) y las pruebas en que se basa (`basis`). NO DEBE
  copiarse en `issued`: una cita imprime «s. f.» / «n.d.» ([§18](#citation)).
- `original_language`: etiqueta BCP 47 de la lengua original de una traducción.
- `subtitle`: el subtítulo cuando el `title` de CSL es «Título: Subtítulo».
- `orcid`: identificadores ORCID por nombre («Apellidos, Nombre»).

Las extensiones PUEDEN añadir otros miembros con el prefijo `x_<vendor>_`.

<a id="text-normalization"></a>
## 7. Texto, normalización y desplazamientos

### 7.1 Codificación y normalización

Todo el texto está en UTF-8 y en NFC. Los escritores DEBEN normalizar a NFC antes de
guardar y antes de calcular desplazamientos. Los escritores NO DEBEN guardar U+0000,
sustitutos (surrogates) desemparejados ni no-caracteres, y NO DEBERÍAN guardar otros
caracteres de control salvo U+0009 (tabulador) y U+000A (salto de línea). Las líneas
terminan solo con U+000A.

### 7.2 Desplazamientos

Los desplazamientos de `chars` ([§4.1](#anchors)) y todas las longitudes de esta
especificación cuentan puntos de código del texto en NFC. Las implementaciones cuyas
cadenas son UTF-16 (JavaScript, Java, C#, `NSString` de Swift) DEBEN convertir: un
carácter fuera del plano multilingüe básico cuenta como un punto de código, pero como dos
unidades UTF-16.

### 7.3 Markdown ligero

`units.text` PUEDE usar este subconjunto de CommonMark [COMMONMARK]: párrafos separados
por una línea en blanco; encabezados de `#` a `######`; `*emphasis*` y `**strong**`;
listas con `-` y con `1.`; citas con `>`; tablas al estilo de GitHub; marcas de nota al
pie `[^1]` cuyo texto va a `notes`. Los lectores NO DEBEN interpretar el HTML en bruto de
`text`; lo muestran como texto. Los desplazamientos cuentan los caracteres guardados,
marcado incluido. Los fragmentos DEBERÍAN conservar el marcado de su unidad de origen para
que `fragments.text` sea una subcadena del `text` de la unidad siempre que el fragmento
no atraviese unidades.

Los turnos de palabra de las transcripciones empiezan con la etiqueta `**Name:**` seguida
de un espacio (`**Neil Armstrong:** Houston, Tranquility Base here.`).

### 7.4 Tiempos de las palabras

`units.words` es el objeto JSON `{"v": 1, "t0": <seconds>, "cs": [start, duration,
start, duration, …]}`: un par de enteros por palabra, en centésimas de segundo desde `t0`
(que es igual al `t0` de la unidad). Las palabras son las secuencias maximales de
caracteres que no son espacio en blanco del `text` de la unidad, una vez eliminadas las
etiquetas de hablante (`**Name:**`); por tanto, `cs` contiene exactamente el doble de
enteros que palabras hay. Los lectores lo usan para resaltar la palabra que se está
pronunciando y para convertir un rango de `char` en un rango de tiempo.

<a id="search"></a>
## 8. Búsqueda de referencia

La búsqueda de referencia define lo que comprueba la conformidad: resultados que toda
implementación devuelve de forma idéntica a partir del mismo fichero. Los productos PUEDEN
ordenar mejor (palabras vacías, expansión de consultas, reordenación, filtros); aun así,
DEBEN ofrecer el comportamiento de referencia para superar la batería, y DEBERÍAN señalar
la diferencia en su documentación.

Un elemento de resultado es `{"fragment_id", "score", "via", "anchor", "anchor_uri"}`,
donde `via` enumera los métodos que han contribuido (`"lexical"`, `"vector"`) en ese
orden, `anchor` es el ancla del fragmento y `anchor_uri` es la URI formateada a partir de
`anchor` y `anchor_end` con la referencia de documento `sha256-`.

### 8.1 Búsqueda léxica

Dadas una cadena de consulta y un límite:

1. **Normalizar**: `q` = NFC(consulta).
2. **Frases**: recorrer `q` de izquierda a derecha. Una comilla de apertura `"` (U+0022),
   `“` (U+201C), `«` (U+00AB) o `„` (U+201E) abre una frase que cierra, respectivamente,
   la siguiente comilla `"`, `”` (U+201D), `»` (U+00BB) o, en el caso de `„`, `“` o `”`.
   El texto entre las comillas es la frase. Una comilla de apertura sin comilla de cierre
   se trata como un separador.
3. **Palabras**: secuencias maximales de caracteres cuya categoría general Unicode es
   letra (L), marca (M) o número (N). Un término de frase son las palabras de la frase
   unidas con un espacio; las frases sin palabras se descartan.
4. **Términos**: si hay al menos un término de frase, los términos son los términos de
   frase (las palabras sueltas fuera de las comillas se descartan) y el operador es `AND`.
   En caso contrario, los términos son las palabras de `q` y el operador es `OR`. Los
   términos duplicados se eliminan, conservando el primero, y se comparan por la clave
   `lower(remove_Mn(NFD(term)))` (minúsculas por defecto de Unicode, tras eliminar las
   marcas que no ocupan espacio); la clave se usa solo para detectar duplicados. No se
   eliminan palabras vacías. Sin términos, el resultado está vacío.
5. **Cadena MATCH**: cada término, **tal como está escrito** (sin plegado de mayúsculas
   ni descomposición), es una cadena FTS5: `"` + el término con cada `"` duplicada + `"`;
   las cadenas se unen con ` AND ` o ` OR `. El tokenizador pliega por sí mismo las
   mayúsculas y los diacríticos; plegar la consulta de antemano rompería coincidencias
   (`Straße`, `ﬁn`).
6. **Consulta**:
   ```sql
   SELECT f.n, f.id, bm25(fragments_fts, 1.0, 0.5, 0.5, 1.0) AS r
     FROM fragments_fts JOIN fragments f ON f.n = fragments_fts.rowid
    WHERE fragments_fts MATCH ?1 ORDER BY r, f.n LIMIT ?2
   ```
   La puntuación es −r. Como `search_text` es la cuarta columna indexada, una consulta en
   grafía moderna encuentra la grafía antigua sin ningún paso especial. Como `n` es el
   rowid del índice, las implementaciones PUEDEN ordenar solo dentro del índice
   (`SELECT rowid, bm25(…) FROM
   fragments_fts WHERE fragments_fts MATCH ?1 ORDER BY 2, 1 LIMIT ?2`) y buscar los ids
   de fragmento únicamente de las filas devueltas; el resultado es idéntico. Los lectores
   que obtienen los ficheros por rangos HTTP DEBERÍAN hacerlo así, ya que evita leer todos
   los fragmentos que coinciden.
7. **Ruta CJK**: si `q` contiene un punto de código de alguno de los rangos
   U+2E80–U+2FDF, U+3040–U+30FF, U+3100–U+312F, U+3130–U+318F, U+31A0–U+31FF,
   U+3400–U+4DBF, U+4E00–U+9FFF, U+A960–U+A97F, U+AC00–U+D7AF, U+F900–U+FAFF,
   U+FF66–U+FF9F o U+20000–U+3FFFF, el paso 6 se sustituye por lo siguiente:
   - si existe `fragments_fts_trigram` y todos los términos tienen al menos 3 puntos de
     código, la misma cadena MATCH se ejecuta contra `fragments_fts_trigram`, ordenada
     por `bm25(fragments_fts_trigram)` y después por `n`; la puntuación es −bm25;
   - en caso contrario (no hay índice de trigramas, o hay un término de menos de 3 puntos
     de código, que un índice de trigramas no puede encontrar), se ejecuta sobre
     `fragments.text` la **alternativa de reserva por subcadena**: para cada fragmento,
     `hits` = el número de términos `t` con `instr(text, t) > 0`; se devuelven los
     fragmentos con `hits` ≥ 1 (con el operador `OR`) o con `hits` = número de términos
     (con `AND`), ordenados por `hits` de forma descendente y después por `n`; la
     puntuación es `hits`.

### 8.2 Búsqueda vectorial

Dados un espacio, un objetivo (`fragment` por defecto, o `unit`, `figure`), un vector de
consulta de `dims` números y un límite: se compara la consulta con todos los vectores de
ese espacio y de ese objetivo por fuerza bruta. Cada componente se convierte en un número
IEEE 754 binary64 (f32 y f16 de forma exacta; i8 como q/127). La consulta se usa tal como
se da, sin normalizar. Cuando el espacio tiene `normalized = 1`, la puntuación es el
producto escalar; en caso contrario, es la similitud del coseno. Los resultados se ordenan
por puntuación descendente y después por el `n` del fragmento, el `ord` de la unidad o el
`id` de la figura. Un elemento de resultado cuyo objetivo es `unit` o `figure` lleva
`unit_id` o `figure_id` en lugar de `fragment_id`, y la URI de ancla del ancla propia de la
unidad o de la figura. Los productos PUEDEN usar índices aproximados; la referencia es
exhaustiva.

### 8.3 Búsqueda híbrida

Se ejecutan la búsqueda léxica y la búsqueda vectorial (objetivo `fragment`), cada una
con profundidad `max(limit, 50)`, y se fusionan mediante la fusión por rango recíproco
(reciprocal rank fusion) [RRF] con k = 10: puntuación = Σ 1/(10 + rango) sobre las listas
que contienen el fragmento, con el rango empezando en 1. Se ordena por puntuación
descendente y después por `n`; se conservan `limit` resultados. La constante 10 se midió
en Scholaris: el clásico 60 aplana las listas cortas y buenas.

### 8.4 Comparación en la conformidad

El orden de los resultados DEBE coincidir exactamente; las puntuaciones DEBEN coincidir
con una tolerancia absoluta de 1e-6. Las puntuaciones léxicas son las del propio `bm25()`
de SQLite, que es el oráculo.

<a id="vectors"></a>
## 9. Espacios vectoriales

### 9.1 Espacios

Una fila de `spaces` describe cómo se produjo un conjunto de vectores:

- `id`: `<model>@<dims>` para vectores `f32` y `<model>@<dims>:<dtype>` en los demás casos
  (`embeddinggemma-2@768`, `embeddinggemma-2@256:i8`). PUEDE seguir un sufijo
  `+<variant>` para separar vectores del mismo modelo calculados a partir de entradas
  distintas (el Scholaris legado usa `+contexto`).
- `provider` (quién ejecutó el modelo: `local`, `google`, `inferbox`…), `model`, `version`.
- `dims`: número de componentes.
- `dtype`: `f32` (IEEE 754 binary32), `f16` (binary16) o `i8` (byte con signo; el valor es
  q/127). Cualquier otro valor no es válido (E032).
- `normalized`: 1 si todos los vectores guardados tienen norma euclídea unitaria (antes de
  la cuantización).
- `truncated_from`: para el truncamiento Matryoshka [MRL], la dimensión original (`768`
  para un vector recortado a 256); NULL en los demás casos. Los vectores truncados
  DEBERÍAN renormalizarse antes de guardarse, con `normalized = 1`.
- `modalities`: array JSON de las modalidades de entrada que acepta el modelo (`text`,
  `image`, `audio`, `video`, `pdf`).
- `task_prefixes`: objeto JSON con los prefijos o las instrucciones que se usaron al
  codificar, `{"document": "…", "query": "…"}`, para que un lector pueda codificar las
  consultas de la misma manera; NULL si no los hay.

Un fichero PUEDE contener varios espacios; un fichero sin espacios es válido (perfil
`core`).

### 9.2 Vectores

`vectors.data` es el vector como `dims` valores little-endian del `dtype` del espacio, de
modo que su longitud es `dims` × 4, 2 o 1 bytes (E030). Todo vector se refiere a un
espacio de `spaces` (E031). Los escritores cuantizan como sigue: f32 → f16 con el
redondeo IEEE al par más cercano; f32 → i8 con
`q = clamp(round_half_away_from_zero(v × 127), −127, 127)`. El valor −128 no se usa. Un
valor que no cabe en el dtype (un f32 finito por encima de 65504 que se redondearía a
infinito en f16, un valor no finito) es un error para el escritor, y nunca se guarda en
silencio.

### 9.3 Compatibilidad entre espacios y cuantizaciones

Dos espacios son **compatibles**, y un mismo vector de consulta sirve para ambos, cuando
`provider`, `model`, `version`, `dims`, `normalized`, `truncated_from` y `task_prefixes`
son iguales; `dtype` puede ser distinto. Por tanto, un lector que dispone de un modelo
PUEDE buscar en un espacio `f32` y en su copia `i8` con la misma consulta. Los espacios
que difieren en cualquier otro campo no son comparables: los lectores NO DEBEN mezclar
puntuaciones de espacios incompatibles, y NO DEBEN comparar vectores de dimensiones
distintas. Un espacio Matryoshka (`truncated_from` = 768, `dims` = 256) es compatible con
una consulta solo si la consulta se truncó a las mismas dimensiones y se renormalizó.

<a id="profiles"></a>
## 10. Perfiles

`spdf_meta.profile` declara qué promesas hace un fichero. Los perfiles son etiquetas
acumulativas; un fichero enumera todos los perfiles que cumple.

| perfil | requisitos |
|---|---|
| `core` | OBLIGATORIO en todo fichero. Todas las tablas de [§3](#schema); al menos una unidad; todas las unidades, los fragmentos y las figuras con ancla; texto en NFC; índice FTS sincronizado. |
| `semantic` | Al menos un espacio, y vectores para todos los fragmentos en al menos un espacio. Un fichero `semantic` sin vectores provoca W100. |
| `media` | `kind` es `audio` o `video`; las unidades llevan anclas `time` y `t0`/`t1`; `duration` tiene valor; `words` DEBERÍA estar presente. Un fichero `media` sin anclas de tiempo provoca W101. |
| `full` | `semantic` y, para audio y vídeo, `media`; para los tipos paginados, imágenes de página (`units.image`) y figuras cuando el original las tiene. |

Los lectores NO DEBEN rechazar un fichero por su perfil; los perfiles dicen a los lectores
qué esperar y a los validadores qué comprobar.

<a id="extensions"></a>
## 11. Extensiones

Los datos que esta especificación no define van a **tablas de extensión** llamadas
`x_<vendor>_<name>` (letras ASCII en minúsculas, dígitos y `_`; `<vendor>` es un nombre
que controla el autor, p. ej. `x_scholaris_claims`). Cada extensión en uso se declara en
la tabla `extensions` con su `name` (`<vendor>_<name>` o el prefijo de la tabla), una
`version` y `required`:

- `required = 0`: los lectores que no conocen la extensión la ignoran.
- `required = 1`: el fichero no puede entenderse sin ella; un lector que no la conoce
  DEBE rechazar el fichero con E060.

Las extensiones NO DEBEN cambiar el significado de las tablas del núcleo, NO DEBEN
añadirles columnas y NO DEBERÍAN ser obligatorias. Las tablas de extensión no forman parte
del volcado canónico. Una extensión que resulta útil a varias implementaciones pasa a
formar parte del núcleo mediante el proceso de RFC ([§23](#versioning)).

<a id="dump"></a>
## 12. Volcado canónico

El volcado canónico es una vista JSON de un fichero que todas las implementaciones
producen de forma idéntica. Es el oráculo de la batería de conformidad y la entrada del
hash de integridad.

```jsonc
{"spdf_version": "5.0",            // legacy files: "4.0"/"4.1" and "legacy": true
 "meta": {"<key>": "<value>", …},  // every spdf_meta row
 "fts": {"tokenizer": "unicode61 remove_diacritics 2", "trigram": false},
 "document": {"id", "kind", "metadata", "source_sha256", "source_ref", "mime", "bytes",
              "unit_count", "duration", "created", "updated", "title", "authors",
              "year", "language", "rights"},
 "units": [{"id", "ord", "anchor", "text", "notes", "header", "footer", "image",
            "thumbnail", "reader", "confidence", "printed", "t0", "t1", "words"}],
 "sections": [{"id", "parent", "level", "title", "unit_from", "unit_to", "summary"}],
 "fragments": [{"n", "id", "unit", "ord", "text", "context", "section", "anchor",
                "anchor_end", "search_text"}],
 "figures": [{"id", "unit", "image", "caption", "description", "anchor"}],
 "spaces": [{"id", "provider", "model", "version", "dims", "dtype", "normalized",
             "truncated_from", "modalities", "task_prefixes", "created"}],
 "vectors": {"<space id>": {"count": 6, "sha256": "<hex>"}},
 "blobs": [{"key", "mime", "bytes", "sha256"}],
 "provenance": [{"stage", "provider", "model", "detail", "ms", "at"}],
 "extensions": [{"name", "version", "required"}]}
```

Reglas:

1. Todos los miembros enumerados están presentes. El NULL de SQL se convierte en `null`;
   INTEGER, en un entero JSON; REAL, en un número JSON; TEXT, en una cadena. Las columnas
   que contienen JSON (`metadata`, `rights`, `anchor`, `anchor_end`, `notes`, `words`,
   `section`, `modalities`, `task_prefixes`, `detail`) se analizan y se incrustan como
   valores JSON. Se omite la columna `document` de las tablas hijas. Los booleanos
   guardados como enteros (`normalized`, `required`) siguen siendo enteros.
2. Todo número que no sea entero, incluidos los que están dentro del JSON analizado, se
   redondea a 6 decimales (redondeo de la mitad al par sobre su valor binario exacto); un
   resultado de −0 se convierte en 0.
3. Orden: `units` por `ord`; `fragments` por `n`; `sections`, `figures` y `spaces` por
   `id`; `blobs` por `key`; `extensions` por `name` (orden de puntos de código, que es la
   intercalación `BINARY` de SQLite sobre UTF-8); `provenance` por los bytes UTF-8 de la
   serialización JCS de cada entrada. `fts.trigram` es verdadero si y solo si existe
   `fragments_fts_trigram`; `fts.tokenizer` es el valor de la opción `tokenize` de
   `fragments_fts` tal como está declarado, sin sus comillas y con cada secuencia de
   espacios en blanco reducida a un solo espacio (`unicode61 remove_diacritics 2`;
   `unicode61`, el valor por defecto de FTS5, si no está presente).
4. `vectors` tiene un miembro por cada `vectors.space` distinto: `count` es el número de
   filas y `sha256` el SHA-256 en hexadecimal de sus blobs `data` concatenados por orden de
   `target` y después de `id`.
5. `blobs[].bytes` y `blobs[].sha256` se calculan a partir de `data`, no se copian de la
   columna `sha256`.
6. La serialización, siempre que importen los bytes (cálculo de hashes), es JCS
   [RFC 8785]: sin espacios en blanco, con los miembros de objeto ordenados por las
   unidades de código UTF-16 de sus nombres, los números en la forma de ECMAScript (`1`,
   no `1.0`; `0.000001`, no `1e-6`) y las cadenas en UTF-8 con solo `"`, `\` y
   U+0000–U+001F escapados.

Para los ficheros legados, el volcado es la vista 5.0 definida en [§20](#legacy), con el
`spdf_version` legado y `"legacy": true`.

<a id="integrity"></a>
## 13. Integridad y firmas

`spdf_meta.content_sha256` (OPCIONAL) es el SHA-256 en hexadecimal en minúsculas de la
serialización JCS del volcado canónico del que se han eliminado los miembros
`meta.content_sha256`, `meta.signature` y `meta.signer`. Cubre todo el contenido salvo las
tablas de extensión y es independiente de la disposición de páginas de SQLite, de modo que
dos escritores que guardan el mismo contenido producen el mismo hash.

`spdf_meta.signature` (OPCIONAL, requiere `content_sha256` y `signer`) es la codificación
base64 estándar, con relleno, de una firma Ed25519 [RFC 8032] sobre los bytes ASCII de la
cadena `spdf-content-sha256:` seguida del `content_sha256` en hexadecimal.
`spdf_meta.signer` es `ed25519:` seguido de la codificación base64 estándar de la clave
pública de 32 bytes.

Los validadores que encuentren `content_sha256` DEBEN recalcularlo (E081 si no coincide)
y, si hay una firma, DEBEN verificarla (E082 si la verificación falla). Una firma válida
prueba que el titular de la clave produjo este contenido; no dice nada sobre si la clave
es de confianza. Los lectores DEBERÍAN mostrar quién firmó (la clave, o un nombre que el
usuario le haya asociado) y NO DEBEN presentar una clave desconocida como de confianza.

<a id="security"></a>
## 14. Consideraciones de seguridad

Un fichero SPDF es una base de datos escrita por otra persona. Abrirlo es analizar una
entrada no fiable con un motor complejo. Las amenazas, y las reglas de esta especificación
que les dan respuesta:

- **Código en el esquema.** Los disparadores, las vistas y las tablas virtuales pueden
  ejecutar SQL o llamar a módulos cuando se usa la base de datos. Los ficheros NO DEBEN
  contenerlos ([§2.1](#container)); los lectores DEBEN rechazarlos, abrir en solo lectura
  con `query_only`, `trusted_schema = OFF` y el indicador defensivo, y no cargar nunca
  extensiones ([§2.4](#container)). Los disparadores FTS legados se toleran solo porque
  nunca se activan en una conexión de solo lectura.
- **Bases de datos mal formadas.** SQLite es robusto frente a ficheros corruptos, pero
  recomienda precauciones adicionales con los que no son fiables [SQLITE-SECURITY]:
  desactivar la E/S proyectada en memoria, activar `cell_size_check`, fijar límites de
  longitud, considerar `quick_check`.
- **Bombas de descompresión.** La entrada gzip (legado) DEBE descomprimirse con un límite
  de tamaño ([§2.3](#container)).
- **Valores desmesurados.** Los blobs, los textos y los valores JSON DEBEN estar acotados;
  los analizadores de JSON DEBERÍAN limitar la profundidad de anidamiento (valor
  RECOMENDADO: 64).
- **Inyección en las consultas.** El texto del usuario nunca llega a FTS5 como sintaxis:
  cada término es una cadena FTS5 entre comillas ([§8.1](#search)). El SQL siempre va
  parametrizado. Las implementaciones PUEDEN limitar el número de términos (valor
  RECOMENDADO: 64) para acotar el coste de la consulta.
- **Rutas.** Las claves de los blobs son cadenas opacas, no nombres de fichero. Un lector
  que extrae blobs a disco DEBE sanearlas (sin rutas absolutas, sin `..`, sin nombres de
  dispositivo).
- **Referencias remotas.** `source_ref`, `image`, `thumbnail`, `URL` y las anclas `web`
  pueden apuntar a la red. Los lectores NO DEBEN descargarlas automáticamente: la descarga
  revela que se abrió el fichero y puede alcanzar servicios internos. Solo hay que
  descargarlas ante una acción del usuario, y mostrando antes la dirección.
- **Contenido activo.** `text` es Markdown ligero; los lectores NO DEBEN representar el
  HTML en bruto que contenga, y DEBEN escapar el texto antes de insertarlo en HTML. Las
  imágenes de los blobs son una entrada no fiable para los decodificadores de imágenes; el
  SVG NO DEBE representarse con los scripts activados.
- **Procedencia falsificada.** La procedencia, la confianza y los metadatos son
  afirmaciones del escritor. Solo una firma con una clave de confianza
  ([§13](#integrity)) los atribuye.
- **Entradas de los modelos.** El texto leído de un fichero puede contener instrucciones
  dirigidas a modelos de lenguaje («ignora las instrucciones anteriores…»). Las
  aplicaciones que pasan texto SPDF a un modelo DEBEN tratarlo como datos, no como
  instrucciones.

<a id="privacy"></a>
## 15. Consideraciones de privacidad

- **Los vectores pueden filtrar el texto.** Los vectores de embedding pueden invertirse:
  hay ataques publicados que reconstruyen la mayor parte de una entrada breve a partir de
  su vector [VEC2TEXT]. Distribuir los vectores de un texto es casi como distribuir el
  texto. Las reglas de derechos y de confidencialidad que se aplican al texto se aplican a
  sus vectores ([§16](#rights)); un escritor al que se pide eliminar el texto de un
  documento restringido DEBE eliminar también sus vectores.
- **La procedencia puede delatar al productor.** Los escritores NO DEBERÍAN registrar en
  `provenance.detail` ni en `generator` rutas de ficheros locales, nombres de usuario,
  nombres de máquina, identificadores de cuenta, claves de API ni instrucciones (prompts)
  que contengan datos personales.
- **Personas en los documentos.** Las entrevistas y las grabaciones nombran a los
  hablantes y pueden contener datos personales. Los productores DEBERÍAN permitir a los
  usuarios eliminar o seudonimizar los nombres de `speaker`, y los lectores NO DEBERÍAN
  indexar nombres de hablantes en servicios compartidos sin consentimiento.
- **Las anotaciones son personales.** Las anotaciones del usuario viven fuera del
  fichero, en ficheros auxiliares `.spdfa.json` ([§17](#annotations)), para que compartir
  un documento nunca comparta las notas de quien lo lee.
- **La apertura es observable** solo si un lector descarga referencias remotas; véase
  [§14](#security).

<a id="rights"></a>
## 16. Derechos

`documents.rights` es NULL o un objeto JSON:

```json
{"license": "CC-BY-4.0", "access": "open", "holder": "Universidad de La Laguna",
 "note": "Text and images under CC BY 4.0; page scans courtesy of the library."}
```

- `license`: un identificador o una expresión de licencia SPDX [SPDX] (`CC-BY-4.0`,
  `CC0-1.0`), o la URL de una licencia o de una declaración de derechos (para el dominio
  público, `https://creativecommons.org/publicdomain/mark/1.0/`; para las declaraciones de
  derechos, `http://rightsstatements.org/vocab/InC/1.0/`).
- `access`: `open` (cualquiera puede recibir el fichero), `restricted` (solo el público
  que permita el titular: una clase, una biblioteca) o `private` (copia personal).
- `holder`: el titular de los derechos, o null. `note`: texto libre.

SPDF no concede derechos. Un fichero hecho a partir de una obra protegida por derechos de
autor es una copia de esa obra, vectores incluidos ([§15](#privacy)). Los productores
DEBERÍAN rellenar `rights` cuando conocen los derechos y DEBERÍAN poner `access` en
`private` por defecto cuando no los conocen, y los lectores DEBERÍAN mostrar `rights`
antes de compartir un fichero. La condición de dominio público depende de la
jurisdicción; `note` es el lugar para indicar de cuál.

<a id="annotations"></a>
## 17. Anotaciones y colecciones

### 17.1 Anotaciones en `.spdfa.json`

Las anotaciones del usuario (subrayados, notas, etiquetas) se guardan fuera del
documento, en un fichero con la extensión `.spdfa.json`, como una `AnnotationCollection`
de W3C Web Annotation [WEB-ANNOTATION] en JSON-LD:

```json
{"@context": "http://www.w3.org/ns/anno.jsonld",
 "type": "AnnotationCollection", "spdf_annotations": "1.0",
 "label": "Notas de lectura",
 "first": {"type": "AnnotationPage", "items": [
   {"id": "urn:uuid:7b0c…", "type": "Annotation", "motivation": "commenting",
    "created": "2026-10-07T09:00:00Z",
    "body": {"type": "TextualBody", "value": "Origen del tópico.", "format": "text/plain", "language": "es"},
    "target": {"source": "spdf:sha256-3f2a…c9",
               "selector": [
                 {"type": "SpdfAnchorSelector", "value": "spdf:sha256-3f2a…c9#p=29&f=21&char=118,301"},
                 {"type": "TextQuoteSelector", "exact": "En un lugar de la Mancha",
                  "prefix": "", "suffix": ", de cuyo nombre"}]}}]}}
```

`target.source` es la URI de ancla sin fragmento. El `SpdfAnchorSelector` lleva la URI de
ancla completa; el `TextQuoteSelector` [WEB-ANNOTATION] permite que la anotación
sobreviva a una relectura que altere los desplazamientos. Los lectores que no pueden
resolver el ancla DEBERÍAN recurrir a la cita textual como alternativa de reserva. El
miembro `spdf_annotations` indica la versión de este perfil. PUEDEN añadirse selectores de
otros tipos (un `FragmentSelector` conforme a Media Fragments para el tiempo y la región)
para las herramientas que no conocen SPDF.

### 17.2 Colecciones en `.spdfl.json`

Una biblioteca es un manifiesto, no un contenedor:

```json
{"spdf_library": "1.0", "name": "Tesis: fuentes", "created": "2026-10-07T00:00:00Z",
 "items": [{"sha256": "3f2a…c9", "title": "El ingenioso hidalgo…", "authors": "Cervantes Saavedra",
            "year": 1605, "url": "https://example.org/quijote.spdf", "file_sha256": "…"}]}
```

`sha256` es el `source_sha256` del documento (la identidad que usan las URI de ancla);
`url` y `file_sha256` (SHA-256 de los bytes del fichero `.spdf`) son OPCIONALES y
permiten a un lector descargar y comprobar una copia. Los elementos están en el orden en
que los ordenó el usuario.

Los esquemas JSON (JSON Schema) de ambos ficheros auxiliares están en
[`json-schema/`](json-schema/).

<a id="citation"></a>
## 18. Cita breve

`cite(anchor, anchor_end, metadata, locale)` produce una cita autor-fecha entre
paréntesis, la forma que comparten la mayoría de los estilos, para que todas las
implementaciones impriman el mismo localizador. Las bibliografías completas y los demás
estilos se producen a partir del elemento CSL-JSON con un procesador CSL
([§19](#exports)).

### 18.1 Cita de un ancla

```
( names ", " year [ ", " locator ] ")"
```

Se definen las configuraciones regionales (locale) `es` y `en`; una configuración
regional se asigna por su subetiqueta de lengua principal (`es-ES` → `es`), y cualquier
otra recurre a `en` como alternativa de reserva.

**Nombres**, tomados del `author` de CSL. El nombre de una persona es `literal` si está
presente; si no, la `non-dropping-particle`, un espacio y `family`; si no, `given`. Con un
autor, ese nombre; con dos, `A y B` (es) o `A and B` (en), donde el español escribe `e`
en lugar de `y` cuando el segundo nombre empieza por el sonido /i/ (`i`, `í`, `hi` o `hí`
no seguidos de vocal: `Gómez e Iglesias`, `Gómez e Hidalgo`, pero `Gómez y Hierro`); con
tres o más, `A et al.` en ambas configuraciones regionales. Sin autores, el `title-short`
o, en su defecto, el `title` hasta sus primeros dos puntos, sin espacios en los extremos.

**Año**: el primer año de `issued`; los años negativos se escriben como `375 a. C.` (es)
o `375 BC` (en). Sin año, `s. f.` (es) o `n.d.` (en). El rango de `spdf.undated` no se
imprime en una cita breve.

**Localizador**:

| ancla | es | en |
|---|---|---|
| página, folio leído | `p. 145` | `p. 145` |
| página, folio romano | `p. xiv` | `p. xiv` |
| página, folio inferido | `p. [21]` | `p. [21]` |
| página sin folio | `s. p.` | `n. pag.` |
| rango de páginas (fin con otro folio) | `pp. 145-146`, `pp. 20-[21]` | igual |
| hoja / rango de hojas | `fol. 1r`, `fol. [2v]`, `fols. 1r-[1v]` | igual |
| columna / rango de columnas | `col. 45`, `cols. 45-46` | igual |
| tiempo (t0, segundos redondeados hacia abajo) | `1:09:20`, `0:42` | igual |
| rango de tiempo (t1 del ancla de fin) | `0:12-0:24` | igual |
| sección o web con `printed` | como una página | como una página |
| sección o web | `§ 3.2 El panóptico, párr. 4` | `§ 3.2 El panóptico, para. 4` |
| diapositiva | `diap. 3` | `slide 3` |
| hoja de cálculo | `Datos, filas 4-9`, `Datos, fila 4` | `Datos, rows 4-9`, `Datos, row 4` |
| verso | `v. 1234`, `vv. 1234-1240` | igual |
| canónica | `514a` | igual |
| imagen | (sin localizador) | (sin localizador) |

Los tiempos se escriben `h:mm:ss` a partir de una hora y `m:ss` por debajo (las horas no
se reinician: tiempo de misión `109:24:48`). Un rango solo se imprime cuando los dos
extremos tienen folio impreso y los folios son distintos; los corchetes marcan por
separado cada extremo inferido. Un extremo sin folio impreso nunca forma parte de un
rango: la cita imprime solo el folio del otro extremo (`p. 211`, nunca `pp. s. p.-211`), y
`s. p.` / `n. pag.` solo cuando ninguno de los dos lo tiene. El localizador se omite cuando
quedaría vacío, lo que da `(Hooke, 1665)`.

### 18.2 Cita de un pasaje

Una cita DEBE localizar el pasaje que reproduce, no el fragmento que da la casualidad de
contenerlo. `cite_passage(fragment, quote, locale)` cita una cita textual tomada de un
fragmento:

1. Se divide el fragmento en sus partes: el texto de la unidad inicial entre los dos
   valores de `anchor.chars` y, en un fragmento que cruza unidades, el texto de la unidad
   final ([§4.4](#anchors)) entre los dos valores de `anchor_end.chars` (el texto entero de
   la unidad cuando falta `chars`).
2. Si la cita textual está en la parte inicial, se cita el ancla de la unidad inicial,
   con `chars` igual a la posición de la cita en esa unidad. Si no, y está en la parte
   final, se cita solo el ancla de la unidad final, con sus `chars`. Si no, y abarca las
   dos partes, se cita el rango que va del ancla de la unidad inicial al de la unidad
   final, sin `chars`, con la regla de rangos de arriba (un extremo sin folio no cuenta).
3. El resultado es la cita corta del §18 y la URI de ancla del ancla o rango citado
   ([§5](#anchor-uri)).

Los lectores y las herramientas de cita NO DEBEN citar un pasaje con la `anchor` de inicio
de su fragmento cuando el pasaje no está en la unidad inicial: una cita de la segunda
página de un fragmento que empieza en una lámina sin numerar cita el folio de la segunda
página.

<a id="exports"></a>
## 19. Exportaciones

Las implementaciones DEBEN exportar CSL-JSON y BibTeX tal como definen los §19.1 a §19.3,
y PUEDEN exportar los demás formatos del §19.4. Las exportaciones nunca inventan datos:
los campos ausentes del fichero están ausentes de la exportación. Una exportación recibe
uno o varios documentos, en orden.

### 19.1 Claves

Cada documento exportado recibe una clave, que se usa como `id` de CSL y como clave de
BibTeX:

1. Se toma el primer nombre de la lista `author` de CSL: su `family`, si no su `literal`,
   si no su `given`. Se pliega: se descompone con NFKD, se conservan solo las letras ASCII
   `A`–`Z` y `a`–`z` y se pasa a minúsculas. (`Cervantes Saavedra` → `cervantessaavedra`.)
2. Si queda vacía (sin autor, o sin ninguna letra ASCII en el nombre), se pliega del
   mismo modo la primera palabra, separada por espacios, de `title-short`, o de `title`
   cuando no hay `title-short`. (`Lazarillo de Tormes` → `lazarillo`.)
3. Si sigue vacía, se usa `anon`.
4. Se añade el primer año de `issued` en decimal (los años negativos conservan el signo),
   o `nd` cuando no lo hay: `cervantessaavedra1605`, `anonnd`.
5. Cuando la misma clave aparece más de una vez en una exportación, cada aparición recibe
   un sufijo en el orden de la exportación: `a`, `b`, … `z`, `aa`, `ab`…

### 19.2 CSL-JSON

La exportación CSL-JSON es una matriz JSON con un elemento por documento: el elemento
`metadata` sin su miembro `spdf`, con `id` igual a la clave. Se compara como JSON.

La cita de un pasaje añade al elemento la `label` y el `locator` de CSL de un ancla y de
un ancla final opcional, para que un procesador de CSL pueda imprimirla en cualquier
estilo:

| ancla | `label` | `locator` |
|---|---|---|
| `page`, foliación `page` / `leaf` / `column` | `page` / `folio` / `column` | el folio como en el [§18](#citation): `145`, `[21]`, `xiv`, `1r`, rangos `145-146`, `1r-[1v]`; sin `label` ni `locator` cuando `printed` es null |
| `section` o `web` con `printed` | `page` | como en las páginas |
| `section` o `web` con `paragraph` | `paragraph` | el número de párrafo |
| otras `section` o `web` con ruta | `section` | el último elemento de la ruta |
| `time` | `timestamp` | `1:09:20`, rangos `0:12-0:24` (como en el §18) |
| `verse` | `verse` | `1234` o `1234-1240` |
| `canonical` | `section` | el `ref` |
| `sheet` | `line` | `4` o `4-9` |
| `slide`, `image` | ninguna | ninguno (CSL no tiene localizador de diapositiva; la cita corta del §18 la imprime) |

### 19.3 BibTeX

La exportación BibTeX es texto con una entrada por documento, en el orden de la
exportación, separadas por una línea vacía:

```bibtex
@book{cervantessaavedra1605,
  author = {Cervantes Saavedra, Miguel de},
  title = {{El} ingenioso hidalgo don {Quijote} de la {Mancha}},
  year = {1605},
  publisher = {Juan de la Cuesta},
  address = {Madrid},
  language = {es}
}
```

- **Tipo de entrada** según el `type` de CSL: `book` → `book`; `article-journal`,
  `article-magazine`, `article-newspaper` → `article`; `chapter` → `incollection`;
  `paper-conference` → `inproceedings`; `thesis` → `phdthesis`; `report` →
  `techreport`; cualquier otro → `misc`.
- **Campos**, en este orden, cada uno solo cuando su origen está presente y no vacío:
  `author` (`author` de CSL), `editor` (`editor`), `title`, `year` (primer año de
  `issued`), `journal` en las entradas `article` o, si no, `booktitle`
  (`container-title`), `publisher`, `address` (`publisher-place`), `series`
  (`collection-title`), `volume`, `number` (`issue`), `pages` (`page`), `edition`, `doi`
  (`DOI`), `isbn` (`ISBN`), `url` (`URL`), `language`, `note`.
- **Valores**: se escriben `{…}` en UTF-8. En todos los valores, `\` pasa a ser
  `\textbackslash{}`, `{` pasa a ser `\{` y `}` pasa a ser `\}`; no se escapa nada más.
- **Nombres**: un nombre `literal` se escribe entre llaves, `{National Aeronautics and
  Space Administration}`; si no, el apellido (precedido de la `non-dropping-particle` y
  un espacio, si la hay) y el nombre de pila (`given`) se escriben `Apellido, Nombre`, o
  entre llaves cuando solo existe uno de los dos. Los nombres se unen con ` and `.
- **Mayúsculas**: en `title` y en `journal`/`booktitle`, toda palabra separada por
  espacios que contiene una letra mayúscula (categoría general Unicode Lu) se encierra
  entre llaves, después de escaparla, para que los estilos no la pasen a minúsculas:
  `{El} ingenioso hidalgo don {Quijote}`.
- **Comparación**: dos exportaciones son iguales cuando, después de quitar los espacios
  iniciales y finales de cada línea y de eliminar las líneas vacías, sus líneas son
  idénticas.

### 19.4 Otros formatos

- **ALTO** [ALTO] (PUEDE): ALTO 4, un `Page` por cada unidad de página, con
  `PHYSICAL_IMG_NR` = `physical` y `PRINTED_IMG_NR` = `printed` solo cuando `printed` no
  es null y su `source` no es `inferred` (ALTO registra números impresos, y un folio
  deducido no está impreso); un `TextBlock` por párrafo y un `TextLine` por línea;
  coordenadas solo cuando el productor las tiene (desde una extensión), nunca inventadas.
- **TEI** [TEI] (PUEDE, mínima): `teiHeader` a partir de los metadatos (`titleStmt`,
  `publicationStmt` con los derechos, `sourceDesc` con los campos de CSL), y un `body`
  con un `<pb/>` antes de cada unidad de página, cuyo `n` es el folio tal como se cita en
  el §18 sin su etiqueta (`n="ii"`, `n="[iv]"`, `n="1r"`; sin `n` en las páginas sin
  numerar) y cuyo `facs` es la imagen de la unidad, si la hay; `<p>` para los párrafos,
  `<lg>`/`<l n>` para el verso, `<u who>` para los turnos de palabra y
  `<note place="foot">` para las notas.
- **IIIF Presentation 3** [IIIF] (PUEDE): un `Manifest` con un `Canvas` por unidad, en
  orden de `ord`; la `label` de un lienzo de página es `{"none": [n]}`, con `n` como el
  `n` de TEI, y los lienzos de las páginas sin numerar no llevan `label`; la imagen de la
  unidad es la anotación de pintado (*painting*) y el texto, una anotación
  `supplementing`; el audio y el vídeo son un único lienzo temporal con `duration` y un
  `Range` por unidad o sección; las secciones pasan a ser `structures`; las anclas con
  región pasan a ser destinos `#xywh=percent:`.
- **Web Annotation** (PUEDE): citas y resultados de búsqueda como anotaciones con los
  selectores del [§17.1](#annotations).

La batería de conformidad comprueba, en los documentos paginados, la secuencia de páginas
de estas exportaciones: los pares `PHYSICAL_IMG_NR`/`PRINTED_IMG_NR` de ALTO, el `n` de
cada `pb` de TEI y la `label` de cada lienzo de página de IIIF, en orden.

<a id="legacy"></a>
## 20. Formatos legados

### 20.1 SPDF 4.0 y 4.1

Los ficheros de Scholaris 4.x DEBEN ser legibles para todos los lectores. Son bases de
datos SQLite, normalmente envueltas en gzip, con identificadores en español. Detección,
tras descomprimir: una tabla `spdf` (`clave`, `valor`) cuya fila `spdf_version` empieza
por `4.`, o un `user_version` 400 o 410 junto con una tabla `documentos`.
`application_id` es 0. El esquema se reproduce literalmente en
[`schema/spdf-4.1.sql`](schema/spdf-4.1.sql) y
[`schema/spdf-4.0.sql`](schema/spdf-4.0.sql) (a la 4.0 le faltan `unidades.palabras` y
`fragmentos.texto_busqueda`). Los ficheros legados contienen los disparadores
`fragmentos_ai`, `fragmentos_ad` y `fragmentos_au`, que [§2.4](#container) tolera.

Los lectores presentan los ficheros legados a través de la **vista 5.0**:

- **Tablas**: `spdf` → `spdf_meta` (`clave` → `key`, `valor` → `value`), `documentos` →
  `documents`, `unidades` → `units`, `secciones` → `sections`, `fragmentos` →
  `fragments`, `figuras` → `figures`, `espacios` → `spaces`, `vectores` → `vectors`,
  `blobs` → `blobs`, `procedencia` → `provenance`; sin extensiones.
- **Columnas**: `tipo` → `kind`, `metadatos` → `metadata`, `huella` → `source_sha256`,
  `original` → `source_ref`, `unidades` → `unit_count`, `duracion` → `duration`, `creado`
  → `created`, `actualizado` → `updated`, `titulo` → `title`, `autores` → `authors`,
  `anio` → `year`, `idioma` → `language`; `orden` → `ord`, `ancla` → `anchor`, `texto` →
  `text`, `notas` → `notes`, `cabecera` → `header`, `pie` → `footer`, `imagen` → `image`,
  `miniatura` → `thumbnail`, `lector` → `reader`, `confianza` → `confidence`, `impresa`
  → `printed`, `palabras` → `words`; `padre` → `parent`, `nivel` → `level`,
  `unidad_desde` → `unit_from`, `unidad_hasta` → `unit_to`, `resumen` → `summary`;
  `unidad` → `unit`, `contexto` → `context`, `seccion` → `section`, `ancla_fin` →
  `anchor_end`, `texto_busqueda` → `search_text`; en las figuras, `pie` → `caption`,
  `descripcion` → `description`; `proveedor` → `provider`, `modelo` → `model`,
  `normalizado` → `normalized`, `modalidades` → `modalities` (`texto` → `text`, `imagen`
  → `image`); `objetivo` → `target` (`fragmento` → `fragment`, `unidad` → `unit`,
  `figura` → `figure`), `espacio` → `space`, `valores` → `data`; `clave` → `key`,
  `datos` → `data`; `fase` → `stage`, `detalle` → `detail`, `cuando` → `at`.
- **Tipos de documento**: `pdf`, `pdf_escaneado` → `scanned_pdf`, `fotos` → `photos`,
  `imagen` → `image`, `audio`, `video`, `documento` → `document`, `epub`, `presentacion`
  → `slides`, `hoja` → `sheet`, `web`.
- **Anclas**: `tipo` → `type` (`pagina` → `page`, `tiempo` → `time`, `seccion` →
  `section`, `diapositiva` → `slide`, `hoja` → `sheet`, `web`, `imagen` → `image`),
  `fisica` → `physical`, `impresa` → `printed`, `romana` → `roman`, `origen` → `source`
  (`leido` → `read`, `deducido` → `inferred`, `epub`, `ninguno` → `none`), `confianza` →
  `confidence`, `hablante` → `speaker`, `ruta` → `path`, `parrafo` → `paragraph`, `n`,
  `hoja` → `sheet`, `filaDesde` → `row_from`, `filaHasta` → `row_to`, `consultada` →
  `accessed`, `region`. Los miembros desconocidos se conservan tal cual.
- **Metadatos** (`MetadatosDocumento` → CSL-JSON): `titulo` → `title`, o `"titulo:
  subtitulo"` con `title-short` = `titulo` y `spdf.subtitle` = `subtitulo`;
  `tituloOriginal` → `original-title`; `autores`, `editores`, `traductores`,
  `entrevistadores` (`{nombre, apellidos, orcid}`) → `author`, `editor`, `translator`,
  `interviewer` (`{family: apellidos, given: nombre}`, omitiendo las partes vacías; el
  ORCID va a `spdf.orcid` con la clave `"apellidos, nombre"`); `fecha` → `issued` con
  todas sus partes de fecha cuando su año es igual a `anio` o no hay `anio`, y, si no,
  `anio` → `issued`; `anioOriginal` → `original-date`; `editorial` → `publisher`; `lugar`
  → `publisher-place`; `revista` o, en su defecto, `contenedor` → `container-title`;
  `coleccion` → `collection-title`; `volumen` → `volume`; `numero` → `issue`; `paginas` →
  `page`; `edicion` → `edition`; `doi` → `DOI`; `isbn` → `ISBN`; `url` → `URL`; `idioma`
  → `language`; `resumen` → `abstract`; `idiomaOriginal` → `spdf.original_language`;
  `sinFecha` `{desde, hasta, fundamento}` → `spdf.undated` `{from, to, basis}`;
  `procedencia` → `spdf.provenance`, con los nombres de campo convertidos como arriba y
  `fuente` → `source` (`lectura` → `reading`, `usuario` → `user`, `colofon` →
  `colophon`, `impresores` → `printers`, los demás sin cambios), `confianza` →
  `confidence`. `tipoCSL` → `type`; sin él, el tipo es `article-journal` cuando está
  presente `revista` y, si no, se decide según el tipo de documento: `audio` y
  `presentacion` → `speech`, `video` → `motion_picture`, `web` → `webpage`, `hoja` →
  `dataset`, `imagen` y `fotos` → `graphic`, cualquier otro → `book`. Se omiten las
  cadenas vacías, los nulos y los arrays vacíos.
- **Otras reglas**: las claves de `spdf_meta` `creado` → `created` y `generador` →
  `generator`, las demás sin cambios; se descartan `documentos.estado` y
  `documentos.bibliotecas`; `rights` es null; los espacios reciben `dtype` `f32`,
  `truncated_from` y `task_prefixes` null y `created` a partir de `creado`;
  `provenance.model` es null; se calculan los hashes de los blobs; las unidades se
  renumeran `ord` = 1, 2, 3… por orden de (`orden`, `id`), porque la 4.x numera las
  unidades desde 0; `fragments.ord` conserva `orden`. Referencias en `original`, `imagen`
  y `miniatura`: una cadena vacía se convierte en null (en las figuras sigue siendo una
  cadena vacía), un valor igual a una clave de `blobs` se convierte en `blob:<key>` y
  cualquier otro valor se conserva como referencia opaca.

El ancla 4.x no tiene `foliation`; los folios por hojas no existían en la 4.x.

### 20.2 SPDF 3.0 y anteriores

Las versiones v1 a v3 de Scholaris escribían bases de datos SQLite envueltas en gzip con
las tablas `metadata` (key, value, incluida `schema_version`) y `chunks`, entre otras.
Los lectores PUEDEN importarlas; importar es una conversión con pérdidas (los enlaces
intermodales, las escenas y algunos vectores no tienen cabida en la 5.0) y el importador
DEBERÍA informar de lo que ha descartado. La versión 3.0 está documentada con carácter
histórico en el repositorio de Scholaris; esta especificación no la define.

<a id="conformance"></a>
## 21. Conformidad

### 21.1 Clases de producto

- Un **lector conforme** abre los ficheros de forma segura ([§2.4](#container)), lee
  ficheros 5.0 y ficheros legados 4.x, produce el volcado canónico ([§12](#dump)), analiza
  y formatea URI de ancla ([§5](#anchor-uri)), produce citas breves ([§18](#citation)),
  ejecuta la búsqueda léxica de referencia ([§8.1](#search)) y exporta CSL-JSON y BibTeX
  ([§19](#exports)). Un **lector semántico** ejecuta además las búsquedas vectorial e
  híbrida de referencia.
- Un **escritor conforme** produce ficheros que validan sin errores ni avisos para los
  perfiles que declaran y cuyo volcado canónico es igual al volcado que se dio al escritor
  (ida y vuelta).
- Un **validador conforme** notifica exactamente los códigos de [§22](#validation) para
  los casos de validación de la batería.

### 21.2 Niveles

Una implementación declara su clase y los perfiles que cubre, por ejemplo «lector y
escritor, perfiles core y semantic». Su declaración se respalda con la batería de
conformidad: supera todos los casos de los tipos que exige su clase (`dump`,
`legacy_dump`, `anchor_uri`, `cite`, `cite_passage`, `search_lexical`, `validate`,
`locate`, `export_csl`, `export_bibtex` para los lectores; además, `search_vector` y `search_hybrid` para los
lectores semánticos; además, `roundtrip` y `quantize` para los escritores; y
`export_structure` para las implementaciones que exportan ALTO, TEI o IIIF), con la
versión de la batería con la que se probó. PUEDEN existir implementaciones parciales, pero NO DEBEN llamarse conformes.

### 21.3 La batería

La batería (`conformance/` en el repositorio) es normativa en cuanto al comportamiento.
Su protocolo está en `conformance/README.md`: formato de los casos, informe del ejecutor
(runner) y convención de integración continua. Cada publicación de la batería tiene una
versión y un manifiesto con el número de casos y su hash.

<a id="validation"></a>
## 22. Validación

### 22.1 Procedimiento

Un validador comprueba un fichero en este orden; un paso marcado con *fin* termina la
validación:

1. Si el fichero empieza por `1F 8B`, descomprimirlo ([§2.3](#container)).
2. Si el resultado no es una base de datos SQLite: E001, *fin*.
3. Determinar la versión: `application_id` 1397769286 con `user_version` 500–599 es 5.x;
   la detección de legado de [§20.1](#legacy) es 4.x; cualquier otra cosa: E002, *fin*.
   Para 4.x, notificar W110 y comprobar solo que existen las tablas `spdf`, `documentos`,
   `unidades`, `fragmentos` y `fragmentos_fts` (E010 por cada una) y que no hay ningún
   disparador ni vista aparte de los tres disparadores tolerados (E020); *fin*.
4. Un fichero 5.x envuelto en gzip: E003 en los avisos. Una versión menor superior a 0:
   W105; en ese fichero, los tipos de ancla desconocidos (E041) y los dtype desconocidos
   (E032) se notifican en los avisos en lugar de en los errores, porque una versión menor
   posterior puede definirlos.
5. Disparadores, vistas y tablas virtuales ajenas: E020 por cada uno.
6. Tablas obligatorias (E010 por cada una) y columnas obligatorias (E011 por cada una).
7. Claves de `spdf_meta` (E012 por cada una).
8. `documents` contiene exactamente una fila (E013); `metadata` y `rights` son JSON
   válido (E050); `metadata` tiene `type` y `title` de tipo cadena (E051).
9. Extensiones obligatorias que el validador no conoce (E060).
10. `units.ord` es 1…N (E090); `unit_count` es igual a N (W102).
11. Anclas de unidades, fragmentos (inicio y fin) y figuras (E040, E041, E042);
    fragmentos que cruzan de una clase de `matter` a otra o una frontera de folio (W103,
    [§4.4](#anchors)).
12. Espacios: `dtype` (E032). Vectores: espacio conocido (E031), longitud (E030).
13. Índice FTS sincronizado: ejecutar `INSERT INTO fragments_fts(fragments_fts, rank)
    VALUES('integrity-check', 1)` (y lo mismo sobre `fragments_fts_trigram`) en una copia
    privada; un error es E070.
14. Blobs: el `sha256` guardado es igual al calculado (E080).
15. Si hasta aquí no ha habido errores y `content_sha256` está presente: recalcularlo
    (E081); si coincide y `signature` está presente, verificarla (E082).
16. Avisos de perfil: W100, W101.

El resultado es un objeto JSON (esquema en [`json-schema/validation-result.schema.json`](json-schema/validation-result.schema.json)):

```json
{"valid": false, "version": "5.0", "profile": ["core"],
 "errors": [{"code": "E090", "message": "units.ord is not 1..N", "where": "units"}],
 "warnings": []}
```

`valid` es verdadero si y solo si `errors` está vacío. `version` es null cuando se
desconoce. Los mensajes son texto libre; la conformidad compara los conjuntos de códigos.

### 22.2 Códigos

| código | significado |
|---|---|
| E001 | no es una base de datos SQLite (o gzip defectuoso) |
| E002 | `application_id` o versión desconocidos |
| E003 | fichero 5.0 envuelto en gzip (se notifica como aviso) |
| E010 | falta una tabla obligatoria |
| E011 | falta una columna obligatoria |
| E012 | falta una clave obligatoria de `spdf_meta` |
| E013 | `documents` no contiene exactamente una fila |
| E020 | hay un disparador, una vista o una tabla virtual ajena |
| E030 | longitud del vector ≠ dims × tamaño del dtype |
| E031 | el vector se refiere a un espacio desconocido |
| E032 | dtype desconocido |
| E040 | ancla no válida (JSON incorrecto, miembro obligatorio ausente o de tipo erróneo) |
| E041 | tipo de ancla desconocido |
| E042 | `chars` fuera de rango |
| E050 | JSON de metadatos o de derechos no válido |
| E051 | metadatos sin `type` y `title` de tipo cadena |
| E060 | extensión obligatoria desconocida |
| E070 | índice FTS desincronizado |
| E080 | el sha256 del blob no coincide |
| E081 | `content_sha256` no coincide |
| E082 | la firma no se verifica |
| E090 | `units.ord` no es contiguo desde 1 |
| W100 | perfil `semantic` sin vectores |
| W101 | perfil `media` sin anclas de tiempo |
| W102 | `unit_count` ≠ número de unidades |
| W103 | un fragmento cruza entre unidades de distinta `matter`, o entre una página con folio impreso y otra sin él |
| W105 | versión menor más reciente que la del validador |
| W110 | fichero legado 4.x |

Los códigos nunca se reutilizan con otro significado. Los códigos nuevos se añaden en
versiones menores.

<a id="versioning"></a>
## 23. Versionado y compatibilidad

La especificación se versiona como MAYOR.MENOR; las correcciones editoriales no cambian
la versión. `user_version` la codifica ([§2.1](#container)).

- Una versión **menor** (5.1, 5.2…) solo añade cosas OPCIONALES: tablas, columnas, claves
  de `spdf_meta`, miembros o tipos de ancla, miembros de metadatos, avisos o errores de
  validación para cosas que ya estaban prohibidas. Un lector 5.0 lee todos los ficheros
  5.x e ignora lo que no conoce; PUEDE emitir un aviso (W105). Los validadores notifican
  los tipos de ancla y los dtype de una versión menor más reciente como avisos, no como
  errores ([§22.1](#validation)). Un escritor 5.x que no usa nada nuevo DEBERÍA escribir
  `user_version` 500.
- Una versión **mayor** (6.0) puede cambiar o eliminar cosas. Los lectores DEBEN
  rechazar las versiones mayores que no conocen (E002) y DEBERÍAN seguir leyendo las
  versiones mayores anteriores (como la 5.0 lee la 4.x).
- **Obsolescencia**: una funcionalidad se declara obsoleta en una versión menor, con el
  motivo y su sustituto, y se elimina no antes de la siguiente versión mayor y al menos
  24 meses después.
- **Promesa**: un fichero conforme con la 5.0 será legible para todo lector conforme de
  cualquier versión 5.x posterior, y sus URI de ancla seguirán resolviéndose.
- La batería de conformidad y cada biblioteca tienen sus propios números de versión; el
  manifiesto de la batería indica qué versión de la especificación prueba.

Los cambios se proponen y se deciden mediante el proceso de RFC de `spec/rfcs/` y
`governance/`.

<a id="media-type"></a>
## 24. Tipo de medio e identificación de ficheros

- Tipo de medio: `application/vnd.spdf+sqlite3` (registro ante la IANA en preparación;
  plantilla en `governance/drafts/iana-media-type.md`). El sufijo estructurado `+sqlite3`
  indica a las herramientas genéricas que el fichero es una base de datos SQLite 3.
  Parámetro OPCIONAL `version` (`"5.0"`). Codificación: binaria. Los ficheros de legado
  4.x son datos gzip y no tienen un tipo registrado propio.
- Identificadores de fragmento: en un recurso de tipo `application/vnd.spdf+sqlite3`, el
  identificador de fragmento es la regla `params` del [§5.1](#anchor-uri), con el
  significado que tiene en una URI de ancla para el documento de ese recurso:
  `https://example.org/quijote.spdf#p=5&f=1r`.
- Extensión: `.spdf`. Ficheros auxiliares: `.spdfa.json` y `.spdfl.json`, servidos como
  `application/json` (o `application/ld+json` para las anotaciones).
- Números mágicos: los bytes 0–15 son `53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33 00`
  («SQLite format 3» y un NUL); los bytes 68–71 son `53 50 44 46` («SPDF»); los bytes
  60–63 contienen `user_version` en big-endian (`00 00 01 F4` para la 5.0). Los ficheros
  legados 4.x empiezan por `1F 8B` y no pueden distinguirse de otros ficheros gzip sin
  descomprimirlos.
- Uniform Type Identifier (plataformas de Apple): `com.joseluissaorin.spdf`, conforme a
  `public.data` y `public.database`, hasta que se acuerde un identificador neutral
  respecto al fabricante.

<a id="i18n"></a>
## 25. Internacionalización

### 25.1 Lenguas y sistemas de escritura

Las etiquetas de lengua son BCP 47 [BCP 47]: `es`, `en-GB`, `la`, `grc` (griego
antiguo), `lzh` (chino literario), `ar`. `documents.language` es la lengua principal; los
fragmentos en otras lenguas no necesitan etiquetarse en esta versión. El texto se guarda
en orden lógico, sea cual sea su dirección.

### 25.2 Texto de derecha a izquierda

El árabe, el hebreo, el siríaco y las demás escrituras de derecha a izquierda se guardan
en orden lógico, sin caracteres de control bidireccional salvo los presentes en la
fuente. Los lectores los muestran con el algoritmo bidireccional de Unicode [UAX #9] y
DEBERÍAN aislar las cadenas que aporta el usuario (`dir="auto"`). Las URI de ancla
codifican ese texto en porcentaje, de modo que son neutras respecto a la dirección;
cuando se muestra una forma IRI, los lectores DEBERÍAN aislarla. Los desplazamientos de
`chars` cuentan puntos de código en orden lógico.

### 25.3 Textos antiguos

El `text` de una unidad o de un fragmento es el texto de la fuente, nunca modernizado: la
s larga (`ſ`), las alternancias `u`/`v` e `i`/`j`, las abreviaturas y las tildes se
mantienen como están impresas. La capa `search_text` lleva una forma modernizada que solo
usa la búsqueda. El tokenizador `unicode61` con `remove_diacritics 2` ya pliega las
mayúsculas, los diacríticos latinos y la `ſ`; no pliega los acentos ni los espíritus del
griego, las ligaduras como `æ` y `œ`, ni la `ß`, de modo que los productores DEBERÍAN
poner en `search_text` las formas plegadas que necesiten (para el griego politónico, el
texto sin diacríticos). Las citas reproducen `text`, nunca `search_text`.

### 25.4 Chino, japonés y coreano

El tokenizador `unicode61` trata una secuencia de caracteres han como un único token. Los
ficheros cuyo texto es mayoritariamente CJK DEBERÍAN incluir `fragments_fts_trigram`; la
búsqueda de referencia encuentra entonces las subcadenas de tres o más caracteres por
trigramas y las más cortas por subcadena ([§8.1](#search)). Los productores PUEDEN añadir
a `search_text` una forma segmentada (palabras separadas por espacios).

### 25.5 Números y folios

Los folios impresos se guardan tal como están impresos, en cualquier escritura (`"xiv"`,
`"٣٤"`, `"三"`). Los lectores NO DEBEN convertirlos para citar; PUEDEN ofrecer
conversiones para la navegación.

<a id="references"></a>
## Referencias

### Normativas

- [BCP 47] Phillips, A., Davis, M., «Tags for Identifying Languages», BCP 47, RFC 5646.
- [COMMONMARK] CommonMark Spec, versión 0.31.2, <https://spec.commonmark.org/0.31.2/>.
- [CSL-JSON] Citation Style Language, esquema CSL-JSON, <https://github.com/citation-style-language/schema>.
- [MEDIA-FRAGMENTS] W3C, «Media Fragments URI 1.0 (basic)», Recomendación, 2012.
- [RFC 1952] Deutsch, P., «GZIP file format specification version 4.3».
- [RFC 2119] Bradner, S., «Key words for use in RFCs to Indicate Requirement Levels».
- [RFC 3986] Berners-Lee, T., et al., «Uniform Resource Identifier (URI): Generic Syntax».
- [RFC 3987] Duerst, M., Suignard, M., «Internationalized Resource Identifiers (IRIs)».
- [RFC 5147] Wilde, E., Duerst, M., «URI Fragment Identifiers for the text/plain Media Type».
- [RFC 5234] Crocker, D., Overell, P., «Augmented BNF for Syntax Specifications: ABNF».
- [RFC 8032] Josefsson, S., Liusvaara, I., «Edwards-Curve Digital Signature Algorithm (EdDSA)».
- [RFC 8174] Leiba, B., «Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words».
- [RFC 8259] Bray, T., «The JavaScript Object Notation (JSON) Data Interchange Format».
- [RFC 8785] Rundgren, A., et al., «JSON Canonicalization Scheme (JCS)».
- [SQLITE-FORMAT] SQLite, «Database File Format», <https://www.sqlite.org/fileformat.html>.
- [SQLITE-FTS5] SQLite, «SQLite FTS5 Extension», <https://www.sqlite.org/fts5.html>.
- [UAX #15] Unicode Standard Annex #15, «Unicode Normalization Forms».
- [WEB-ANNOTATION] W3C, «Web Annotation Data Model», Recomendación, 2017.

### Informativas

- [ALTO] Library of Congress, «ALTO: Technical Metadata for Layout and Text Objects», versión 4.
- [CTS] Protocolo y esquema de URN «Canonical Text Services», <http://cite-architecture.github.io/>.
- [IIIF] IIIF Consortium, «IIIF Presentation API 3.0».
- [MRL] Kusupati, A., et al., «Matryoshka Representation Learning», NeurIPS 2022.
- [RFC 6838] Freed, N., Klensin, J., Hansen, T., «Media Type Specifications and Registration Procedures».
- [RFC 7595] Thaler, D., et al., «Guidelines and Registration Procedures for URI Schemes».
- [RRF] Cormack, G. V., Clarke, C. L. A., Büttcher, S., «Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods», SIGIR 2009.
- [SPDX] SPDX License List, <https://spdx.org/licenses/>.
- [SQLITE-SECURITY] SQLite, «Defense Against The Dark Arts», <https://www.sqlite.org/security.html>.
- [TEI] TEI Consortium, «TEI P5: Guidelines for Electronic Text Encoding and Interchange».
- [UAX #9] Unicode Standard Annex #9, «Unicode Bidirectional Algorithm».
- [VEC2TEXT] Morris, J. X., et al., «Text Embeddings Reveal (Almost) As Much As Text», EMNLP 2023.

<a id="changes"></a>
## Apéndice A. Cambios respecto a SPDF 4.1

- Contenedor sin comprimir con `application_id` y `user_version`; gzip solo para el legado.
- Identificadores en inglés; los ficheros legados se leen a través de la vista 5.0.
- Metadatos como elemento CSL-JSON con el objeto de extensión `spdf`.
- Nuevos tipos de ancla `verse` y `canonical`; `foliation` (hojas y columnas); `chars` y
  `region` en cualquier ancla.
- URI de ancla con ABNF, alineada con W3C Media Fragments y RFC 5147.
- `spaces.dtype` (`f32`, `f16`, `i8`), `truncated_from`, `task_prefixes`; compatibilidad
  entre espacios.
- Perfiles, extensiones, `rights`, hashes de los blobs, `model` en la procedencia.
- Ni disparadores ni vistas en los ficheros distribuidos; procedimiento de apertura segura.
- Volcado canónico, hash de integridad y firmas Ed25519.
- Unidades numeradas desde 1.
- Eliminados: `documentos.estado` y `documentos.bibliotecas` (la pertenencia a bibliotecas
  corresponde a los manifiestos de colección).
