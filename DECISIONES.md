# Decisiones del proyecto SPDF (7-10-2026)

Tomadas por el orquestador con plena delegación de José Luis Saorín. Todo agente que
trabaje en este repositorio las sigue; si una no se sostiene, se discute en
`spec/rfcs/` y se cambia aquí, no en silencio.

## Identidad
- **SPDF** = *Semantic Processed Document Format* (nombre público). Nació como
  *Scholaris Processed Document Format*; la especificación lo cuenta en su prefacio.
- Repositorio: `github.com/joseluissaorin/spdf` (privado hasta que la especificación,
  la conformidad y las bibliotecas de primer nivel pasen; luego público). Si José
  Luis crea la organización `spdf-format` en GitHub, se transfiere allí.
- Web: `https://spdf.joseluissaorin.com` (documentación, validador en el navegador,
  lector web). Dominio propio (spdf.dev / spdf.org) cuando él lo compre.
- Paquetes: crate `spdf` (Rust), `spdf-format` (npm), `spdf-format` (PyPI, se importa
  `spdf`), módulo Go `github.com/joseluissaorin/spdf/go`, SwiftPM desde el repo,
  Maven `io.github.joseluissaorin:spdf`, NuGet `Spdf.Format`, Composer
  `joseluissaorin/spdf`, gema `spdf-format`, R `spdf`, Julia `SPDF.jl`.
  (`spdf` ya está ocupado en npm y PyPI por proyectos ajenos.)

## Formato
- La primera versión pública es **SPDF 5.0**. Las 4.0 y 4.1 (las de Scholaris, con
  identificadores en español) quedan como **legado**: todo lector conforme DEBE leerlas.
  La 3.0 (JSON comprimido de Scholaris v1) es opcional (importador).
- **Identificadores en inglés** en el esquema 5.0. Documentación normativa en inglés
  (`spec/SPEC.md`) y traducción española fiel (`spec/SPEC.es.md`).
- Contenedor: **SQLite 3 sin comprimir** (permite leer por rangos HTTP y mmap). Los
  lectores DEBEN aceptar también un SQLite envuelto en gzip (legado 4.x).
  `PRAGMA application_id = 1397769286` (0x53504446, «SPDF»), `PRAGMA user_version = 500`.
- Metadatos del documento = **un ítem CSL-JSON** más un objeto de extensión `spdf`
  (procedencia por campo, horquilla sin fecha, lengua original). Interoperabilidad directa
  con Zotero, citeproc y Pandoc.
- Desplazamientos de texto en **puntos de código Unicode sobre texto NFC**.
- Búsqueda léxica con tokenizadores que trae cualquier SQLite: `unicode61
  remove_diacritics 2` y, opcional, `trigram` (chino, japonés, coreano).
- Vectores: little-endian, `f32` | `f16` | `i8`; espacio = `modelo@dims` (+ dtype);
  varios espacios conviven; un SPDF sin vectores es válido.
- Los ficheros 5.0 distribuidos NO llevan disparadores ni vistas. Los lectores abren en
  solo lectura, modo defensivo, `trusted_schema=OFF`, sin extensiones.
- Anotaciones del usuario fuera del fichero: `.spdfa.json` (W3C Web Annotation con
  selectores SPDF). Colecciones: `.spdfl.json` (manifiesto por hash).
- Perfiles: `core` (texto + anclas), `semantic` (+ vectores), `media` (+ audio/vídeo con
  tiempos por palabra), `full`.

## Licencias
- Especificación y documentación: **CC BY 4.0**.
- Código: **MIT OR Apache-2.0** (doble licencia). Compromiso público de no reclamar patentes.
- Modelos: se descargan bajo demanda, nunca dentro de los paquetes. EmbeddingGemma 2,
  Gemma 4 y Valen son Apache 2.0.

## Implementaciones
- **Varias implementaciones nativas e independientes**, todas contra la misma batería de
  conformidad (`conformance/`). La de Rust es la de referencia y además da la ABI de C
  (para C/C++ y para quien no tenga SQLite cómodo).
- Primer nivel: Rust, TypeScript (Node con `node:sqlite`, navegador con
  `@sqlite.org/sqlite-wasm`), Python (`sqlite3` de la biblioteca estándar), Swift, Kotlin/JVM,
  Go, C#. Segundo nivel: PHP, Ruby, R, Julia, C.
- Cada implementación: abrir con seguridad, validar, leer (5.0 y legado 4.x), volcado JSON
  canónico, búsqueda léxica / vectorial / híbrida (RRF k=10, medido en Scholaris), anclas ↔ URI, cita corta,
  exportar CSL-JSON y BibTeX, y escribir (constructor).

## Productor y lector
- Productor de referencia independiente de Scholaris: `spdf build` (Python, `producer/`).
  Local: EmbeddingGemma 2, Gemma 4 (E4B para leer páginas y fichas), whisper. Con clave
  propia: Gemini (o cualquier API compatible con OpenAI).
- Scholaris es el otro productor (TypeScript) y pasa a usar `spdf-format` para exportar e
  importar SPDF 5.0. Dos productores independientes interoperables = requisito para la 1.0.
- Lector gratuito «SPDF Reader» / «Lector SPDF»: **Tauri 2** (macOS, Windows, Linux, iOS,
  Android) con núcleo Rust, y la misma interfaz compilada como web 100 % en el cliente.
- Inferencia local por plataforma:
  - Nativo (escritorio y móvil): **llama.cpp** con GGUF (`ggml-org/embeddinggemma-2-GGUF`
    + mmproj para imagen/audio; Gemma 4 E2B/E4B en GGUF), aceleración Metal / Vulkan / CUDA.
    En Android, LiteRT-LM con NPU como optimización si da tiempo.
  - Web: **transformers.js con WebGPU** (`onnx-community/embeddinggemma-2-ONNX`, q4/q4f16) y
    Gemma 4 E2B con LiteRT/MediaPipe web (`gemma-4-E2B-it-web.task`).
  - Recorte Matryoshka (768→256/128) en móvil, declarado en el espacio.
- Juez tipo Jev: por defecto **Gemma 4 con puntuación por logits** sobre las etiquetas
  candidatas (funciona en todas las plataformas); **Valen** (Valen-Team, Apache 2.0) como motor
  de mayor calidad donde haya Python/GPU, e intento de exportarlo a ONNX para el dispositivo.
- Clave de Gemini opcional (bring your own key), guardada en el llavero del sistema.

## Reglas de trabajo
- Cada agente trabaja SOLO en su carpeta y en su propio workflow de CI
  (`.github/workflows/<carpeta>.yml`); `git pull --rebase` antes de cada push.
- Textos para personas en español con tildes, o en inglés correcto; sin emojis.
- Commits con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Nada de secretos en el repositorio. Nunca reproducir audio por los altavoces del Mac.
- Corpus de ejemplo y pruebas: solo obras de dominio público verificables.
