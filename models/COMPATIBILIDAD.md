# Cuándo dos motores escriben en el mismo espacio

Un SPDF guarda vectores calculados por el productor, con un motor concreto (PyTorch, llama.cpp, onnxruntime, transformers.js, MLX) y una cuantización concreta. El lector calcula el vector de la consulta con el motor que tenga a mano. La búsqueda solo es fiable si los dos vectores viven en el mismo espacio. Este documento fija cuándo ocurre eso para EmbeddingGemma 2, a partir de lo medido en `models/bench` (informe completo en `INFORME.md`), y es la base del RFC `spec/rfcs/0002-espacios-y-cuantizacion.md`.

## La regla

Un motor, con sus pesos y su preprocesado, escribe en el espacio de un modelo de referencia si, sobre el corpus de compatibilidad de SPDF y en todas las modalidades que declara:

1. el coseno medio con el vector de referencia del mismo elemento es **≥ 0,999**, y
2. el percentil 5 de ese coseno es **≥ 0,995**,

tanto a la dimensión nativa como en cada recorte Matryoshka que escriba. La referencia de EmbeddingGemma 2 es sentence-transformers 6.1 sobre `google/embeddinggemma-2` en la revisión `914f7f89`, en f32 (bf16 da lo mismo: 0,99995 de media).

Ese motor escribe `spaces.version = "914f7f89"`. Con la regla del contrato (§2: mismos `provider`, `model`, `version`, `dims`, `normalized`, `truncated_from` y `task_prefixes`), sus vectores y los de cualquier otro motor que la cumpla son intercambiables.

Un motor que no la cumple pero queda en coseno medio ≥ 0,97 y percentil 5 ≥ 0,95 es una **variante aproximada** del mismo punto de control: escribe `spaces.version = "914f7f89+<variante>"` (por ejemplo `+q4`). Para el contrato es otro espacio; un lector PUEDE buscar con él avisando al usuario (`compat::check` devuelve `Approximate`), pero DEBE preferir recalcular la consulta con un motor del espacio exacto. Por debajo de esos umbrales, es otro modelo.

El `dtype` de almacenamiento no cambia el espacio, como dice el contrato, pero no es inocuo: ver «Almacenamiento» más abajo.

Los umbrales no son arbitrarios: entre los motores medidos hay un hueco limpio. Todo lo que conserva 8 bits o más queda por encima de 0,9987 de media y 0,9961 en el percentil 5; todo lo que baja a 4 bits queda por debajo de 0,9822 y 0,9748. Los fallos de preprocesado caen en medio y la regla los detecta.

## Qué cumple cada motor

Corpus: 290 pasajes y 40 consultas en 16 lenguas, 54 imágenes y 24 clips de 10 s de audio, todo de dominio público (`models/bench/corpus`). Coseno con la referencia; «p5» es el percentil 5.

| Motor y pesos | Texto media / p5 | Imagen media / p5 | Audio media / p5 | Espacio |
|---|---|---|---|---|
| sentence-transformers bf16 (MPS) | 1,0000 / 0,9999 | 0,9999 / 0,9998 | 0,9999 / 0,9999 | `914f7f89` |
| **spdf-infer** (llama.cpp) GGUF Q8_0 + mmproj Q8_0, Metal | 0,9999 / 0,9998 | 0,9994 / 0,9987 | 0,9991 / 0,9967 | `914f7f89` |
| spdf-infer GGUF Q8_0, CPU | 0,9998 / 0,9996 | 0,9993 / 0,9984 | 0,9990 / 0,9968 | `914f7f89` |
| spdf-infer GGUF BF16 + mmproj BF16 | 1,0000 / 1,0000 | 0,9994 / 0,9989 | 0,9993 / 0,9961 | `914f7f89` |
| onnxruntime (Python o Rust) fp32 | 1,0000 / 1,0000 | 1,0000 / 1,0000 | 1,0000 / 1,0000 | `914f7f89` |
| onnxruntime fp16 | 1,0000 / 1,0000 | 1,0000 / 1,0000 | 1,0000 / 1,0000 | `914f7f89` |
| onnxruntime q8 (`_quantized`) | 0,9999 / 0,9999 | 0,9987 / 0,9967 | 0,9999 / 0,9999 | `914f7f89` |
| transformers.js en Chrome (WebGPU) fp32, con el preprocesado de spdf-infer-web | 1,0000 / 1,0000 | 1,0000 / 0,9998 | 1,0000 / 1,0000 | `914f7f89` |
| transformers.js en Chrome (WebGPU) q8, ídem | 0,9999 / 0,9999 | 0,9987 / 0,9968 | 0,9999 / 0,9999 | `914f7f89` |
| MLX bf16 | 0,9999 / 0,9999 | 0,9999 / 0,9998 | 1,0000 / 1,0000 | `914f7f89` |
| MLX 8 bits | 0,9998 / 0,9996 | 0,9998 / 0,9997 | 0,9999 / 0,9998 | `914f7f89` |
| onnxruntime y transformers.js q4 / q4f16 | 0,9796 / 0,9676 | 0,9822 / 0,9748 | 0,9810 / 0,9718 | `914f7f89+q4` |
| MLX 4 bits | 0,9748 / 0,9615 | 0,9855 / 0,9810 | 0,9788 / 0,9698 | `914f7f89+mlx4` |
| llama.cpp redimensionando él las imágenes | 0,9999 / 0,9998 | **0,9804 / 0,9600** | 0,9991 / 0,9967 | no (preprocesado) |
| transformers.js redimensionando él las imágenes | 1,0000 / 1,0000 | **0,9964 / 0,9876** | 1,0000 / 1,0000 | no (preprocesado) |

Nota sobre la imagen en el navegador: la fórmula del tamaño no es idempotente (843×422 pasa a 1104×528, y 1104×528 pasaría a 1152×528), así que transformers.js volvía a redimensionar la imagen ya preparada y cuatro imágenes del corpus bajaban hasta 0,982. spdf-infer-web desactiva ese segundo paso; las cifras de la tabla son con la corrección.

Los recortes Matryoshka conservan la compatibilidad: con Q8_0, a 512, 256 y 128 dimensiones el coseno con la referencia recortada igual sigue en 0,9999 / 0,9998 o más. En q4 mejora algo al recortar (0,9874 a 128), sin llegar al umbral.

## Imágenes, el preprocesado es parte del espacio

La mayor diferencia medida entre motores no viene de los pesos, sino de cómo se redimensiona la imagen. La referencia la lleva al mayor tamaño que cabe en 280 tokens de visión conservando la proporción (lados múltiplos de 48 píxeles: parches de 16 y agrupación de 3×3) y la redimensiona con bicúbica con antialias, la de Pillow. llama.cpp usa otra fórmula y una bicúbica sin antialias; transformers.js usa otra bicúbica. Por eso:

- spdf-infer y spdf-infer-web redimensionan ellos, con un port exacto bit a bit de Pillow (comprobado con hashes en las pruebas de Rust y de TypeScript), y luego entregan la imagen al motor sin que este vuelva a tocarla;
- un productor o un lector que use otro motor para imágenes DEBE aplicar ese mismo preprocesado si quiere escribir `914f7f89`.

El presupuesto de 280 tokens forma parte del espacio. Otro presupuesto (70, 140, 560 o 1120) da otros vectores de imagen; si un productor lo cambia, debe declararlo como variante (`914f7f89+img560`, por ejemplo).

## Prefijos de tarea

EmbeddingGemma 2 se entrenó con prefijos. Para que `task_prefixes` compare igual entre productores, el valor canónico de un espacio de recuperación es:

```json
{"document": "title: {title} | text: ", "query": "task: search result | query: "}
```

donde `{title}` es el título del documento o `none`. Un productor que use otros prefijos (de pregunta y respuesta, de verificación de hechos) declara los suyos y, con ello, otro espacio.

## Almacenamiento

Guardar en `f16` es, a efectos prácticos, exacto: coseno 1,000000 con el f32 y el mismo orden de resultados. Guardar en `i8` tal como lo define el contrato (`q = round(v × 127)`, valor `q/127`) es aproximado: con vectores unitarios de 768 dimensiones las componentes rondan ±0,04 y solo se usan unos pocos niveles de los 255. El coseno con el f32 baja a 0,998 y el solape de los diez primeros resultados, a 0,97 (0,94 a 128 dimensiones). La recomendación para productores es `f16` cuando se quiera ahorrar espacio. El RFC propone documentarlo así y deja abierta una escala por espacio para `i8`, que subiría el coseno a 0,9996.

## Cómo comprobar un motor nuevo

1. Calcula los vectores del corpus con el motor (los guiones de `models/bench` muestran el formato) y guárdalos en `~/.cache/spdf-models/bench-out/vectors/<motor>.npz`.
2. `python -I models/bench/compare.py`: la tabla dice si cumple la regla en cada modalidad y en cada recorte.
3. Si cumple, escribe `version = "914f7f89"`; si queda en la franja aproximada, `914f7f89+<variante>`.

Para no depender de PyTorch, los vectores de referencia del corpus pueden publicarse junto a la batería de conformidad (pendiente de decidir con el agente de la especificación; ver el RFC).
