# spdf-infer-web

La gemela para el navegador de la crate `spdf-infer`: mismos conceptos, mismos nombres en camelCase y la misma regla de compatibilidad de espacios.

```ts
import { ModelManager, Embedder, Generator, Judge, isCompatible } from "spdf-infer-web";

const mm = new ModelManager();                       // OPFS (o Cache Storage si no hay OPFS)
const id = mm.recommend("embed")!.id;                // "embeddinggemma-2-onnx-q8"
await mm.download(id, (p) => console.log(p.overallDone, p.overallTotal));   // SHA-256 y reanudación

const e = await Embedder.load(id, { manager: mm, device: "auto" });
const [q] = await e.embed(["¿Quién es Dulcinea?"], { task: "query", dims: 256 });
const v = await e.embedImage(blob);                  // redimensiona como la referencia (Pillow)
e.space(256);                                        // fila de `spaces`: embeddinggemma-2@256

await mm.download("gemma-4-e2b-it-web");
const g = await Generator.load("gemma-4-e2b-it-web", { manager: mm, temperature: 0.7 });
await g.generate("Resume el pasaje.", { maxTokens: 200 }, (t) => void out.append(t));

const j = await Judge.load("gemma-4-e2b-it-onnx-q4f16", { manager: mm });
const s = await j.support("afirmación", "pasaje");   // { label, probs, supported }
```

- **WebGPU**: los ONNX cuantizados (q8, q4) lo necesitan, porque usan `GatherBlockQuantized`, que onnxruntime no tiene en WASM. Sin WebGPU, `embeddinggemma-2-onnx-fp16`.
- **Imágenes**: `embedImage` aplica el redimensionado de referencia (bicúbica de Pillow, exacta) y apaga el de transformers.js; sin eso la imagen no cumple la regla de mismo espacio.
- **Generación**: MediaPipe fija la temperatura y el top-k al cargar; `maxTokens`, `stop` y el callback se aplican por llamada.
- **Juez**: Valen estático q4 (onnxruntime-web, WebGPU) es el mejor medido; Gemma 4 E2B ONNX puntúa por los logits de las letras. `Judge.remote(url)` habla con `models/valen/server.py`.
- **Gemini**: `GeminiEmbedder` y `GeminiGenerator` con la clave del usuario, que va en una cabecera y no se guarda.

Probado de punta a punta en Chrome 154 headless con WebGPU (`models/bench/web_e2e.py`). Licencia: MIT OR Apache-2.0.
