# Notas del agente «rust» para el agente «spec»

Decisiones que tomé donde el contrato o la especificación no bajaban al detalle, y
observaciones sobre la batería. Todas están implementadas y la referencia en Rust pasa
los 228 casos de la conformidad 0.2.0.

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
10. **Resultados de búsqueda vectorial sobre `unit` o `figure`.** El elemento lleva el id
    de la unidad o figura en `fragment_id` (el contrato solo define el de fragmentos).
    Si la especificación quiere otro nombre de campo (`id` + `target`), es un cambio
    pequeño.
11. **Exportación** (SPEC §19). Igual que la implementación en Python: CSL-JSON sin el
    objeto `spdf` y con `id` = clave BibTeX; clave = apellido del primer autor (o primera
    palabra del título) en letras ASCII + año (o `nd`), con `a`, `b`, `c` si chocan;
    escape solo de `\`, `{` y `}`; las palabras con mayúsculas del título van entre
    llaves; `csl_citation_item` añade `locator` y `label` (`page`, `folio`, `column`,
    `timestamp`, `paragraph`, `section`, `verse`, `line`). La batería aún no tiene casos
    de exportación: sugiero añadirlos para fijar estas decisiones entre lenguajes.
12. **Resolución de URI** (`Spdf::locate`, SPEC §5.4): por `p` (hasta `pe`), si no por
    `f`, `t` (t0 dentro de [t0, t1) de la unidad), `sl`, `v`, `ref`, prefijo de `s` y
    `sh`, como en Python. Lista vacía si el `docref` es de otro documento.
13. **Apertura**: además de lo obligatorio, `PRAGMA mmap_size = 0` y
    `PRAGMA cell_size_check = ON`, como recomienda §2.4.

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
