# spdf-infer

Inferencia local para lectores y productores de SPDF, sobre llama.cpp:

- **Embeddings** de texto, imagen y audio con EmbeddingGemma 2 (GGUF más mmproj), con los prefijos de tarea del modelo, recorte Matryoshka a 512, 256 o 128 y la fila de `spaces` que hay que guardar con los vectores.
- **Generación** con Gemma 4 E2B o E4B, en streaming.
- **Juez tipo Jev**: una instrucción, un contenido y unas etiquetas candidatas devuelven una probabilidad por etiqueta. Por defecto puntúa con los logits de Gemma 4; con la feature `valen-onnx` usa Valen-0.8B exportado a ONNX, y también puede hablar con el servidor de `models/valen/server.py`.
- **Gestor de modelos**: catálogo (el `models/manifest.json` va embebido), descargas reanudables verificadas con SHA-256 y recomendación según plataforma y memoria.

Backends: Metal en macOS e iOS (siempre activo), Vulkan o CUDA en Windows y Linux (features `vulkan` y `cuda`) y CPU en todas partes, Android incluido (arm64 con `dotprod`).

## Uso

```rust
use spdf_infer::{ModelManager, Kind, Embedder, EmbedderOptions, Embed, Task, Judge, Generator, GenOptions, GenParams, compat};

let mm = ModelManager::new(app_data_dir.join("models"))?;
let id = mm.recommend(Kind::Embed).unwrap().id;           // "embeddinggemma-2-gguf-q8_0"
mm.download(&id, |p| println!("{}/{} MB", p.overall_done >> 20, p.overall_total >> 20))?;

let e = Embedder::load(&mm, &id, EmbedderOptions::default())?;
let docs = e.embed(&["En un lugar de la Mancha…"], Task::Document { title: None }, Some(256))?;
let q = e.embed(&["¿Quién es Dulcinea?"], Task::Query, Some(256))?;
let img = e.embed_image(&std::fs::read("pagina.jpg")?, Some(256))?;
let space = e.space(Some(256));                           // fila de `spaces`: embeddinggemma-2@256
assert!(compat::is_compatible(&space, &stored_space));    // regla de models/COMPATIBILIDAD.md

let j = Judge::load(&mm, "gemma-4-e2b-it-gguf-q4_k_m")?;
let s = j.support("Cervantes llama Rocinante al caballo.", "…al fin le vino a llamar Rocinante…")?;
println!("{:?} {:.2}", s.label, s.supported);

let g = Generator::load(&mm, "gemma-4-e2b-it-gguf-q4_k_m", GenOptions::default())?;
g.generate("Resume el pasaje.", &GenParams::default(), |t| { print!("{t}"); true })?;
```

Todo es bloqueante: en Tauri, llámalo desde `spawn_blocking`. Para pruebas sin descargas, `FakeEmbedder::new(768)` produce vectores deterministas en el espacio `spdf-fake@768`.

## llama.cpp

`spdf-llama-sys` compila llama.cpp en estático, fijado al commit `36a73916ee0c` (el primero con EmbeddingGemma 2 completo, PR 30054), y genera los bindings con bindgen (hace falta libclang). La fuente sale de:

1. `LLAMA_CPP_DIR`, si apunta a una copia de ese commit (compilaciones sin red o con parches);
2. si no, `git fetch --depth 1` del commit en `$SPDF_LLAMA_CPP_CACHE` (por defecto `~/.cache/spdf-models/src`), que el propio hash del commit verifica.

Compilaciones cruzadas probadas: `aarch64-apple-ios`, `aarch64-apple-ios-sim` y `aarch64-linux-android` (con `ANDROID_NDK_HOME`). Si la aplicación enlaza además otra copia de ggml (whisper.cpp, por ejemplo), habrá símbolos duplicados: hay que compartir una sola.

## Imágenes

Las imágenes se redimensionan aquí, como lo hace el procesador de referencia (tamaño que conserva la proporción para 280 tokens de visión y bicúbica con antialias, exacta bit a bit con Pillow), y no dentro de llama.cpp: con su redimensionado el coseno con la referencia baja a 0,980 de media; con el nuestro queda en 0,9994.

## Features

| Feature | Qué añade |
|---|---|
| `vulkan`, `cuda` | GPU en Windows y Linux |
| `native` | `-march=native` (solo para pruebas locales) |
| `valen-onnx` | juez Valen-0.8B con onnxruntime (`ort`) y el tokenizador de Hugging Face |
| `gemini` | `GeminiEmbedder` y `GeminiGenerator` con la clave del usuario (cabecera `x-goog-api-key`, nunca guardada) |

## CLI

`cargo run --release -p spdf-infer -- <orden>`: `catalog`, `download <id>`, `embed`, `generate`, `judge`, y las órdenes que usa el banco (`bench-embed`, `bench-gen`, `judge-eval`).

Licencia: MIT OR Apache-2.0. Los pesos no van en el crate: se descargan bajo demanda (todos Apache 2.0).
