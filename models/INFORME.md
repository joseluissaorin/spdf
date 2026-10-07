# Informe del banco de modelos de SPDF

Medido el 7 de octubre de 2026 en un Mac con M4 Max (36 GB), macOS 26, Chrome 154. Los guiones están en `models/bench` y los resultados en bruto, en `models/bench/results`. La regla de compatibilidad que sale de aquí está en `COMPATIBILIDAD.md`, y su propuesta para la especificación, en `spec/rfcs/0003-espacios-y-cuantizacion.md`.

## Corpus

Todo de dominio público o con licencia libre, en `models/bench/corpus`:

- 290 pasajes y 40 consultas en 16 lenguas (español, inglés, francés, alemán, italiano, portugués, latín, chino, japonés, neerlandés, finés, esperanto, ruso, árabe, griego y catalán), de Project Gutenberg y Wikisource, en tres tamaños (frase, párrafo y fragmento de 180 a 320 palabras); las consultas están escritas para el banco (CC0).
- 54 imágenes: 40 obras del Art Institute of Chicago (CC0; pinturas, grabados, fotografías, dibujos, textiles, esculturas, libros y planos) y 14 documentos de Wikimedia Commons en dominio público (portada del Quijote de 1605, Principia, Biblia de Gutenberg…).
- 24 clips de 10 s de LibriVox (dominio público) en seis lenguas.

La referencia es sentence-transformers 6.1 sobre `google/embeddinggemma-2` (revisión `914f7f89`) en f32 y CPU.

## EmbeddingGemma 2 en cada motor

### Velocidad y memoria

Mediana por elemento, de uno en uno (el caso del lector), en milisegundos; memoria física máxima del proceso (en Chrome, de todo su árbol de procesos).

| Motor | Frase | Párrafo | Fragmento largo | Imagen | Audio 10 s | Memoria |
|---|---|---|---|---|---|---|
| **spdf-infer** (llama.cpp en proceso), Q8_0, Metal | 9 | 12 | 25 | 179 | 58 | 2,2 GB |
| spdf-infer, BF16, Metal | 9 | 13 | 24 | 174 | 50 | 2,6 GB |
| spdf-infer, Q8_0, CPU | 21 | 60 | 209 | 2348 | 377 | 2,5 GB |
| llama-server, Q8_0, Metal (por HTTP) | 18 | 22 | 35 | 244 | 95 | 2,3 GB |
| MLX bf16 (mlx-vlm) | 9 | 13 | 32 | 209 | 75 | ver nota |
| MLX 8 bits | 14 | 20 | 35 | 187 | 71 | ver nota |
| onnxruntime Rust (`ort`), fp32, CPU | 20 | 42 | 94 | 1317 | 162 | 3,2 GB |
| onnxruntime Rust, q8, CPU | 52 | 74 | 125 | 1416 | 293 | 1,0 GB |
| onnxruntime Python, fp32, CPU | 23 | 46 | 128 | 1965 | 228 | 4,2 GB |
| transformers.js en Chrome, q8, WebGPU | 15 | 23 | 50 | 453 | 126 | 4,1 GB |
| transformers.js en Chrome, fp32, WebGPU | 20 | 26 | 46 | 463 | 130 | 8,1 GB |
| transformers.js en Chrome, fp32, WASM | 53 | 220 | 691 | 6485 | 1140 | 6,9 GB |
| transformers.js en Node, fp32, CPU | 19 | 43 | 112 | 1657 | 164 | 5,4 GB |
| sentence-transformers bf16, MPS | 45 | 51 | 77 | 310 | 68 | 3,9 GB |
| sentence-transformers f32, CPU (referencia) | 44 | 108 | 162 | 761 | 758 | 4,3 GB |

Notas. En llama.cpp los pesos van por `mmap` y no cuentan como memoria propia del proceso; la cifra es sobre todo búferes de cómputo (contexto de 2048 tokens). MLX conserva una caché de búferes de Metal que hace crecer su huella hasta 12-15 GB en una pasada larga; no es memoria que necesite. Los ONNX cuantizados (q8 y q4) no cargan en WASM: usan `GatherBlockQuantized`, que la versión de WASM de onnxruntime no tiene, así que sin WebGPU hay que usar fp16 o fp32.

### Compatibilidad de espacios

Coseno con el vector de referencia del mismo elemento (media / percentil 5), y solape de los diez primeros resultados cuando las consultas salen del motor y el corpus de la referencia.

| Motor | Texto | Imagen | Audio | Top-10 mezclando |
|---|---|---|---|---|
| spdf-infer Q8_0, Metal | 0,9999 / 0,9998 | 0,9994 / 0,9987 | 0,9991 / 0,9967 | 0,998 |
| spdf-infer BF16, Metal | 1,0000 / 1,0000 | 0,9994 / 0,9989 | 0,9993 / 0,9961 | 1,000 |
| onnxruntime fp32 o fp16 | 1,0000 / 1,0000 | 1,0000 / 1,0000 | 1,0000 / 1,0000 | 1,000 |
| onnxruntime q8 | 0,9999 / 0,9999 | 0,9987 / 0,9967 | 0,9999 / 0,9999 | 0,995 |
| transformers.js fp32, WebGPU, con el preprocesado de spdf-infer-web | 1,0000 / 1,0000 | 1,0000 / 0,9998 | 1,0000 / 1,0000 | 1,000 |
| transformers.js q8, WebGPU, ídem | 0,9999 / 0,9999 | 0,9987 / 0,9968 | 0,9999 / 0,9999 | 0,995 |
| MLX bf16 / 8 bits | 0,9999 / 0,9996 o más | 0,9998 / 0,9997 o más | 0,9999 / 0,9998 o más | 0,995 |
| sentence-transformers bf16 | 1,0000 / 0,9999 | 0,9999 / 0,9998 | 0,9999 / 0,9999 | 0,995 |
| onnxruntime o transformers.js q4 / q4f16 | 0,9796 / 0,9676 | 0,9822 / 0,9748 | 0,9810 / 0,9718 | 0,945 |
| MLX 4 bits | 0,9748 / 0,9615 | 0,9855 / 0,9810 | 0,9788 / 0,9698 | 0,925 |
| llama.cpp redimensionando él | igual que Q8_0 | **0,9804 / 0,9600** | igual | |
| transformers.js redimensionando él | igual | **0,9964 / 0,9876** | igual | |

Los recortes Matryoshka (512, 256, 128) conservan la compatibilidad de cada motor. Guardar en f16 es exacto a efectos prácticos; guardar en i8 tal como lo define el contrato baja el coseno a 0,998 y el solape top-10 a 0,97 (0,94 a 128 dimensiones).

### La regla que sale de aquí

Mismo espacio = coseno medio ≥ 0,999 y percentil 5 ≥ 0,995 con la referencia, en cada modalidad y en cada recorte: escribe `version = "914f7f89"`. Entre 0,97 / 0,95 y eso, variante aproximada (`914f7f89+q4`, `+mlx4`): otro espacio para el contrato, comparable con aviso. Hay un hueco limpio entre lo de 8 bits o más (≥ 0,9987 / 0,9961) y lo de 4 bits (≤ 0,9822 / 0,9748); los fallos de preprocesado de imagen caen en medio y la regla los detecta. Detalle en `COMPATIBILIDAD.md`.

Dos hallazgos de preprocesado, corregidos en las bibliotecas:

- llama.cpp elige otro tamaño de imagen y redimensiona sin antialias: spdf-infer redimensiona él con un port de la bicúbica de Pillow exacto bit a bit, y la imagen pasa de 0,980 a 0,9994.
- La fórmula del tamaño de la referencia no es idempotente (843×422 va a 1104×528, y 1104×528 iría a 1152×528), así que transformers.js volvía a redimensionar la imagen ya preparada: spdf-infer-web le apaga ese segundo paso (de 0,9993 / 0,9947 a 1,0000 / 0,9998).

## Gemma 4 E2B y E4B

Prompt de unos 510 tokens y 256 tokens generados, voraz; mediana de tres ejecuciones con la máquina en reposo.

| Motor | E2B prompt | E2B generación | E4B prompt | E4B generación |
|---|---|---|---|---|
| **spdf-infer** (llama.cpp), GGUF Q4_K_M, Metal | 2392 tok/s | 127 tok/s | 1151 tok/s | 77 tok/s |
| llama-bench (llama.cpp), misma build | 2423 | 105 | 1150 | 71 |
| MLX 4 bits (mlx-lm 0.32) | 4915 | 53 | 1603 | 37 |
| MediaPipe GenAI web (`.task`), Chrome, WebGPU | 3751 | 27 | 2042 | 16 |

Memoria: con llama.cpp los pesos se mapean (3,1 y 5,0 GB de fichero) y la huella propia se queda en 0,4-0,6 GB; MLX llega a 4,6 y 7,1 GB; Chrome con MediaPipe, a 4,2 y 5,2 GB. En la web, el prompt de MediaPipe se mide como tiempo hasta el primer fragmento.

## El juez

Banco: el público de Scholaris (`~/Developer/scholaris-nube/bench/calidad`), sin ninguna etiqueta de Jev. 105 pares afirmación–pasaje (19 afirmaciones, 26 pasajes que las respaldan y 79 que no) y una muestra estratificada de 400 de sus 2387 juicios de relevancia 0-3 (Gemini Flash y DeepSeek, con Gemini Pro para los desacuerdos). Textos: Lope de Vega y Bécquer (dominio público) y un artículo de arXiv con CC BY 4.0. Las preguntas y las definiciones de las relaciones son las que Scholaris le da a Jev.

Calibración: temperatura ajustada dejando fuera cada vez la afirmación evaluada.

| Juez | AUC respaldo (sí/no) | AUC respaldo (relación) | Spearman relevancia | AUC relevancia ≥ 2 | ms por par |
|---|---|---|---|---|---|
| Valen-0.8B, PyTorch (MPS) | 0,799 | 0,841 | 0,547 | 0,783 | 650 |
| Valen, ONNX fp32 (onnxruntime) | 0,799 | 0,842 | 0,536* | 0,773* | 1335 (CPU) |
| Valen, ONNX int8, CPU | 0,785 | 0,836 | 0,533* | 0,765* | 1197 |
| Valen, ONNX q4 estático, Chrome WebGPU | 0,764 | 0,838 | 0,560* | 0,771* | 818 |
| Gemma 4 E4B Q4_K_M (logits de las letras) | 0,771 | 0,787 | 0,584 | 0,806 | 496 |
| Gemma 4 E2B Q4_K_M | 0,711 | 0,786 | 0,553 | 0,772 | 249 |
| Gemma 4 E2B ONNX q4f16, Chrome WebGPU | 0,702 | 0,733 | 0,244* | 0,634* | 516 |

\* sobre la submuestra de 100 pares de relevancia (los 105 de respaldo, completos).

Lectura: Valen es el mejor juez de respaldo y ya viene calibrado (temperatura ≈ 1); Gemma 4 necesita temperaturas de 3,7 a 4,1 porque los logits de las letras están sobreconfiados (las guarda el manifiesto). En relevancia, Gemma 4 E4B queda algo por delante. La corrección por prior sin contenido no mejora nada. Con Gemma 4 E2B, el juez marca APOYO_DIRECTO en 35 de los 79 pasajes negativos; con E4B, en uno.

## Valen en el dispositivo

Conseguido, con dos exportaciones a ONNX, ambas con la cabeza de decisión (Mixer) aparte:

- **Dinámica** (`export_onnx.py`): reutiliza el grafo de onnx-community/Qwen3.5-0.8B-ONNX (la atención lineal Gated DeltaNet va con un `Scan`) y le pone los pesos de Valen, que es un ajuste fino completo de la misma arquitectura; las transformaciones (transpuestas, normas como `1 + w`, `-exp(A_log)`) se sacaron comparando cada tensor. fp32 3,0 GB, int8 756 MB, q4 474 MB. Con onnxruntime nativo, fp32 reproduce a PyTorch (0,99968 frente a 0,99968 en el ejemplo de la ficha; mismas AUC en el banco).
- **Estática** (`export_static.py`): longitud fija de 1024 tokens rellenando por la derecha (todas las capas son causales), sin `Scan`, con la regla delta por bloques y la sustitución hacia delante que transformers trae para exportar (una inversa por serie de Neumann era exacta en teoría pero numéricamente inestable con bloques reales). Estado oculto con coseno ≥ 0,9999998 frente a PyTorch. En WebGPU pasa de 4 s (dinámica, 110 tokens) a 0,5 s, y en el banco a 818 ms por par.

El compilador de peticiones de Valen está portado a Python, Rust y TypeScript y coincide token a token con el original en todos los pares (pruebas con fixtures en las dos bibliotecas). Valen es un motor de juez seleccionable en spdf-infer (feature `valen-onnx`, onnxruntime con `ort`) y en spdf-infer-web (onnxruntime-web). Queda también `models/valen/server.py`, un servidor pequeño con el mismo contrato para quien tenga Python y GPU.

Límites: la cuantización a 4 bits aplana algo las probabilidades de la pregunta sí/no (AUC 0,764 frente a 0,799); int8 en el navegador va por WASM (5,6 s por par y probabilidades desviadas por los núcleos de WASM), y la versión q4 estática necesita WebGPU.

## Pruebas de punta a punta

| Plataforma | Qué se ejecutó | Resultado |
|---|---|---|
| macOS (M4 Max, Metal) | descarga real de Hugging Face cortada a mitad y reanudada, verificación SHA-256, texto, imagen, audio, MRL, Gemma 4 E2B en streaming, juez Gemma y Valen | todo correcto; 65 tok/s en la respuesta corta |
| iOS (simulador, iPhone 17 Pro) | lo mismo sobre los modelos descargados | correcto en CPU (el Metal emulado del simulador da vectores erróneos, así que el crate usa CPU allí; en dispositivo, Metal): consulta a 256 en 23 ms, pasaje en 0,6 s, imagen 2,6 s, audio 0,6 s, E2B a 65 tok/s (prompt 123 tok/s), juez 0,8-3,3 s, 4,4 GB de pico |
| iOS (dispositivo) | compilación y enlace para `aarch64-apple-ios` | compila; sin dispositivo para ejecutarlo |
| Android (emulador arm64, API 36, HVF, 4 núcleos) | texto, imagen, audio, generación y juez, compilado para API 24 | correcto (puntuaciones iguales a la referencia): consulta a 256 en 61 ms, pasaje 0,6 s, imagen 4,6 s, audio 1,5 s, E2B a 48 tok/s (prompt 112 tok/s), juez 0,9-3,7 s, 1,5 GB con el embebedor y 4,4 GB con el generador |
| Windows y Linux | CI: compilación y pruebas | en verde (CPU) |
| Web (Chrome 154 headless, WebGPU, `--mute-audio`) | descargas a OPFS con SHA-256, texto, imagen, audio, MRL, Gemma 4 E2B con MediaPipe, juez Valen | todo correcto en 90 s (con las descargas desde un espejo local) |

## Lo que queda abierto

- **Publicar las exportaciones de Valen** en Hugging Face (`spdf-format/valen-0.8b-onnx`, o donde decida José Luis): hace falta su cuenta. Mientras, el manifiesto las marca `published: false` con sus SHA-256 y `ModelManager::import_local` las registra tras construirlas.
- **LiteRT-LM con NPU en Android**: los modelos existen (variantes para Tensor, Qualcomm y MediaTek, en el manifiesto), pero enlazar LiteRT-LM desde Rust no es razonable todavía; Android va por CPU con llama.cpp. Es la mejora natural.
- **Rendimiento real en móvil**: verificado en simulador y emulador; falta medirlo en un iPhone y un Android de verdad.
- Vulkan y CUDA compilan como features, pero la CI solo prueba CPU en Windows y Linux.
- Gemini: implementado con la clave del usuario, sin probar contra la API (no hay clave en el entorno, a propósito).
- `spaces.i8`: el RFC propone recomendar f16 y deja abierta una escala por espacio.
