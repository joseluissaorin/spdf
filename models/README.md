# Modelos de SPDF

Inferencia local para leer y producir SPDF, en cada plataforma, con modelos abiertos (todos Apache 2.0) que se descargan bajo demanda y nunca viajan con el código.

| Carpeta | Qué hay |
|---|---|
| `rust/` | `spdf-infer`, la crate que usa el lector nativo (Tauri 2): embeddings de EmbeddingGemma 2 (texto, imagen y audio) y generación con Gemma 4 sobre llama.cpp, el juez tipo Jev y el gestor de modelos. `spdf-llama-sys` compila llama.cpp fijado por commit. |
| `web/` | `spdf-infer-web`, la misma API para el navegador: transformers.js con WebGPU, MediaPipe para Gemma 4 E2B, el juez y almacenamiento en OPFS. |
| `valen/` | Exportación de Valen-0.8B a ONNX (dinámica y estática), su runtime de referencia en Python, la evaluación y un servidor opcional. |
| `bench/` | El banco: corpus de dominio público, un guion por motor, la comparación de espacios, los jueces y la generación. |
| `tools/` | Generador del manifiesto y de los fixtures que comparten Rust y TypeScript. |
| `manifest.json` | Todos los modelos y formatos con URL fijada por revisión, tamaño, SHA-256 y la recomendación por plataforma. |
| `INFORME.md` | Las cifras. |
| `COMPATIBILIDAD.md` | Cuándo dos motores escriben en el mismo espacio. |

## Qué usar en cada plataforma

| Plataforma | Embeddings | Generación | Juez |
|---|---|---|---|
| macOS | `embeddinggemma-2-gguf-q8_0` (Metal) | `gemma-4-e4b-it-gguf-q4_k_m`, o E2B con menos de 13 GB | Valen int8 cuando se publique; hasta entonces, el mismo Gemma 4 |
| Windows, Linux | `embeddinggemma-2-gguf-q8_0` (CPU, o Vulkan/CUDA) | igual | igual |
| iOS | `embeddinggemma-2-gguf-q8_0` (Metal), o `-text` | `gemma-4-e2b-it-gguf-q4_k_m` | Gemma 4 E2B |
| Android | `embeddinggemma-2-gguf-q8_0` (CPU), o `-text` | `gemma-4-e2b-it-gguf-q4_k_m` | Gemma 4 E2B |
| Web | `embeddinggemma-2-onnx-q8` con WebGPU; `-fp16` sin WebGPU | `gemma-4-e2b-it-web` (MediaPipe) | `valen-0.8b-onnx-static1024-q4` cuando se publique; hasta entonces `gemma-4-e2b-it-onnx-q4f16` |

`ModelManager::recommend` (y `recommend` en la web) hace esta elección sola según la memoria del dispositivo, y salta lo que no está publicado o no está compilado. Todos los embebedores de la tabla escriben en el mismo espacio, `embeddinggemma-2@768` con versión `914f7f89`.

## Reglas

- Los pesos no entran nunca en el repositorio: caché en `~/.cache/spdf-models` (fuera de git) o en el directorio de datos de la aplicación.
- El banco no reproduce audio por los altavoces (Chrome va con `--mute-audio`, el audio se lee de ficheros).
- Nada de secretos: la clave de Gemini, si el usuario la da, la guarda la aplicación en el llavero y viaja en una cabecera.

## Regenerar

```sh
python3 -I models/tools/build_manifest.py                       # manifiesto (API de Hugging Face + exportaciones locales de Valen)
python3 -I models/tools/fixtures.py                             # fixtures compartidos (venv del banco)
cd models/rust && cargo test --release -p spdf-infer            # pruebas de la crate
cd models/web && npm ci && npm run build && npx vitest run      # paquete web
cargo run --release -p spdf-infer --example e2e -- --root /tmp/m --media ~/.cache/spdf-models/bench-corpus
python -I models/bench/web_e2e.py                               # punta a punta en Chrome
```

Licencia del código: MIT OR Apache-2.0.
