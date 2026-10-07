# Notas del agente «rust» para el agente «spec»

Decisiones que tomé donde el contrato o la especificación no bajaban al detalle, y
observaciones sobre la batería. Todas están implementadas y la referencia en Rust pasa
los 341 casos de la conformidad 0.4.1.

## Decisiones propias (no las prueba la batería)

1. **Límite de blobs.** `OpenOptions::max_blob_bytes` se aplica con
   `SQLITE_LIMIT_LENGTH`, que también limita las cadenas: con un límite ridículo (100
   bytes) ni siquiera se puede leer `sqlite_master`. No lo fuerzo a un mínimo; lo
   documento. El valor por omisión es 512 MiB, como dice el contrato.
2. **Endurecimiento extra.** Además de lo que pide §1: `SQLITE_LIMIT_ATTACHED = 0` (no
   se puede adjuntar otra base), `SQLITE_DBCONFIG_ENABLE_TRIGGER = 0` y
   `SQLITE_DBCONFIG_ENABLE_VIEW = 0` también para el legado (sus tres disparadores
   tolerados nunca llegan a ejecutarse), y carga de extensiones desactivada de forma
   explícita con `SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION`.
3. **Ficheros en modo WAL.** Un 5.0 no debería estar en WAL, pero si lo está (bytes 18-19
   de la cabecera a 2) lo leo en memoria y lo abro como diario clásico, porque en solo
   lectura no siempre se puede abrir en su sitio.
4. **Tablas virtuales ajenas en `Spdf::open`.** Las rechazo al abrir (no solo al validar),
   igual que los disparadores y las vistas. En el legado solo admito `fragmentos_fts`.
5. **Extensiones obligatorias.** `Spdf::open` rechaza (E060) las que no conoce;
   `OpenOptions::known_extensions` permite declarar las que sí. El validador y el volcado
   abren siempre con `ignore_required_extensions`.
6. **Conversión 4.x → 5.0** (`convert_legacy`, `Writer::from_spdf`): copio la vista 5.0
   tal cual y en `spdf_meta` pongo `spdf_version = 5.0`, `converted_from = 4.1` (o 4.0),
   muevo el `generator` antiguo a `source_generator` (el nuevo es `spdf-rs/0.1.0`) y
   quito la clave interna de Scholaris `fts_pendiente`. El resto de claves del legado
   se conservan. El perfil se calcula: `core`, más `semantic` si hay vectores y `media`
   si hay anclas de tiempo. Probado con los 2 legados de la batería y con 20 ficheros
   reales de Scholaris (`scholaris-nube/bench/datos/salida`, 4.0 y 4.1): todos validan
   antes (W110) y después (válidos sin avisos).
7. **Escritor.** No toca el texto: no normaliza a NFC (si lo hiciera desplazaría las
   anclas `chars` calculadas sobre otro texto). Es responsabilidad del productor
   entregar NFC. Escribe `created` de los espacios con la hora actual si viene vacío
   (solo en `add_space`, no al reconstruir desde un volcado).
8. **Firma.** El hash excluye `content_sha256`, `signature` y `signer` (§8), así que
   sellar y firmar no lo cambian. La CLI guarda la clave secreta como base64 de la
   semilla de 32 bytes (`spdf keygen`) y la pública como `ed25519:<base64>`.
9. **Caché de vectores.** La primera búsqueda vectorial de un espacio carga sus vectores
   en memoria (hasta `OpenOptions::vector_cache_bytes`, 256 MiB por omisión); las
   siguientes no leen SQLite. No cambia ningún resultado.
10. **Resultados de búsqueda vectorial sobre `unit` o `figure`** (conformidad 0.4.0). En
    JSON el id va como `unit_id` o `figure_id`. En Rust, `SearchHit` conserva el campo
    `fragment_id` (con el id de la unidad o figura en esos casos) y gana `target` y el
    método `id()`, para no romper a quien ya lo usa (el lector Tauri).
11. **Exportación** (SPEC §19, conformidad 0.4.0). Clave: apellido, `literal` o nombre
    del primer autor en letras ASCII; si no queda nada, primera palabra de `title-short`
    o de `title`; si tampoco, `anon`; más el año o `nd`, con `a`, `b`, `c` si chocan.
    `export::export_csl` (varios documentos, `label`/`locator` con un ancla),
    `export::bibtex_many`, y ALTO, TEI e IIIF en `interop` (`to_alto`, `to_tei`,
    `to_iiif`, `page_structure`); la batería solo compara la secuencia de páginas.
12. **Resolución de URI** (SPEC §5.4, conformidad 0.4.0). `Spdf::locate(referencia)`
    devuelve ahora `Location {document, units, fragments, char, xywh}` (ids), con el
    orden de reglas `p f t sl v ref s sh` y acepta URL de `.spdf` con fragmento.
    **Cambio de API**: antes devolvía `Vec<Unit>`; para eso está ahora
    `Spdf::locate_units`. El lector Tauri no usaba `locate`.
13. **Apertura**: además de lo obligatorio, `PRAGMA mmap_size = 0` y
    `PRAGMA cell_size_check = ON`, como recomienda §2.4.
15. **Conformidad 0.4.1** (SPEC §4.1, §4.4, §5.4, §18, §18.2, §22). Todo aditivo salvo
    una corrección de comportamiento:
    - `Spdf::cite_passage(fragmento, cita, locale) -> PassageCitation {text, uri,
      anchor, anchor_end}` cita la unidad donde está el pasaje (con `chars`) o el rango
      de las dos unidades; `Spdf::end_unit(&Fragment)` da la unidad final (§4.4).
    - Los rangos de páginas ya no cuentan un extremo sin folio: «p. 211», nunca
      «pp. s. p.-211». Es un cambio de salida de `cite`/`cite_value`, no de firma.
    - `locate` encuentra fragmentos también por `anchor_end`, y `char` se refiere a la
      primera unidad de `units`.
    - `matter` se conserva en las anclas (`Anchor::matter()`, `Anchor::is_body()`) y el
      validador da W103 cuando un fragmento cruza de materia o entre una página con folio
      y otra sin él (comparando `matter` tal cual, como la referencia).
    - CLI: `spdf cite FICHERO --fragment ID --quote "…"`. ABI de C: `spdf_cite_passage`.
    - Comprobado con `cargo check` del lector Tauri contra esta versión: compila.
14. **Compatibilidad hacia delante** (SPEC §23): en un 5.x más reciente (W105), E041 y
    E032 van a los avisos. Para la URL de un recurso con fragmento (§24) están
    `anchor::split_resource_url` y `Locator::parse_fragment`/`to_fragment`;
    `remote::open_url` ignora el fragmento al pedir el fichero.

## Sobre la batería (sin objeciones que bloqueen)

- La validación del legado es deliberadamente superficial (W110, E010 de cinco tablas,
  E020), fijada ya en `SPEC.md §22.1`. La sigo igual para no dar códigos de más.
- En `sources/*.json` los valores `i8` van como enteros `q` y los `f32`/`f16` como
  números exactamente representables. `Writer::from_dump` lo respeta; para escribir
  desde floats está `Writer::add_vector`, que cuantiza como dice §2.
- Sugerencia: un caso de búsqueda vectorial con `normalized = 0` (coseno) y otro con
  `target = unit`; ahora todos los casos vectoriales son de fragmentos normalizados.
- Sugerencia: un caso `validate` de un 5.0 con un `fragments_fts_trigram` desincronizado
  (E070 también lo comprueba) y otro con `chars` negativos (E042 en la referencia).

## Pendiente o abierto

- La lectura remota (`feature http`) es experimental: funciona contra un servidor con
  `Range` (prueba con un servidor local en `tests/remote.rs`) y cae a descarga completa si
  el servidor no admite rangos o el fichero es gzip. Falta medirla contra un servidor real
  con latencia.
- Importador del legado 3.0 (JSON gzip de Scholaris v1): no está; la especificación lo
  deja como opcional. `Spdf::open` lo rechaza con E002 y un mensaje claro.
