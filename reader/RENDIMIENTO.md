# Rendimiento del Lector SPDF

Mediciones del 7 de octubre de 2026 en un MacBook Pro con M4 Max (Mac16,5) y macOS 26.5,
con las builds de producción. El libro de 245 páginas es *The Discarded Image* de C. S.
Lewis (1964), leído por Scholaris: un SPDF 4.1 de legado, comprimido con gzip (7,9 MB),
y su conversión a 5.0 con `convertLegacy` de `spdf-format` (9,9 MB, 245 miniaturas). La
obra está protegida por derechos de autor, así que el fichero no está en el repositorio:
las pruebas lo reciben por una variable de entorno. Con el Quijote de prueba (9 páginas,
dominio público) las cifras salen con `RENDIMIENTO=1`.

Todas las cifras son milisegundos y, salvo que se diga otra cosa, medianas de varias
ejecuciones. «Núcleo» es el trabajo del motor (Worker en la web, Rust en Tauri); «de punta
a punta» incluye la interfaz hasta que lo nuevo está pintado.

## En la web (Chromium sin cabeza, Playwright)

`LIBRO_245=/ruta/discarded-4.1.spdf,/ruta/discarded-5.0.spdf npx playwright test e2e/rendimiento.spec.ts`
(resultados completos en `e2e/rendimiento-web.json`). Se mide dentro de la página, esperando
por fotograma (`requestAnimationFrame`), para que el sondeo de Playwright no infle nada.

| Qué | 4.1 de legado (gzip) | 5.0 | Quijote de prueba (5.0, 9 pp.) |
|---|---:|---:|---:|
| Arranque en frío hasta la interfaz (sin caché ni OPFS) | 39 | 36 | 38 |
| Arranque en caliente | 22 | 24 | 20 |
| Importar (SHA-256, copia a OPFS, apertura) hasta ver la página 1 | 507 | 411 | 387 |
| Abrir desde la biblioteca hasta ver el texto | 416 | 78 | 60 |
| Pasar de página (mediana de 20, con el viaje de Playwright) | 28 | 27 | 29 |
| Ir a la página impresa «145» | 40 | 36 | 35 |
| Buscar en el documento, núcleo (5 consultas) | 1-5 | 0-4 | 0-3 |
| Buscar en el documento, de punta a punta | 35-46 | 33-45 | 31-34 |
| Buscar en la biblioteca (10 documentos), núcleo | 2-57 | 2-28 | 0-18 |

Notas:

- Las consultas fueron `astronomy`, `Ptolemy`, `medieval model`, `"the discarded image"`
  (frase exacta) y `angels heaven`; en el Quijote, `hidalgo`, `Mancha`, `lantejas` (capa
  modernizada), `caballero andante` y `Rocinante`.
- Abrir el legado cuesta más porque hay que descomprimirlo (7,9 MB de gzip) y montar la
  vista 5.0 sobre el esquema en español; el 5.0 se abre en menos de 80 ms.
- La primera búsqueda en la biblioteca abre los documentos que aún no estaban en la caché
  del Worker (seis como máximo); las siguientes bajan a unos pocos milisegundos.
- La build web pesa 2,9 MB en total; la primera pantalla descarga 266 KB de JavaScript (84 KB
  comprimidos). citeproc (373 KB) y los estilos CSL solo se cargan al pedir una referencia
  en APA o Chicago, y cada dibujo a mano llega en su propio trozo.

## En macOS (app de Tauri, release)

La app apunta sus tiempos en `medidas.jsonl` (carpeta de datos de la app) cuando se lanza con
`SPDF_MEDIR=1`; con `SPDF_MEDIR_CONSULTAS="astronomy|Ptolemy|…"` lanza esas búsquedas por el
mismo camino que el panel (`invoke('buscar')`) al abrir el documento.

```bash
SPDF_MEDIR=1 SPDF_MEDIR_CONSULTAS='astronomy|Ptolemy|medieval model|angels heaven|"the discarded image"' \
  "Lector SPDF.app/Contents/MacOS/lector-spdf" /ruta/discarded-5.0.spdf
```

| Qué | 4.1 de legado (gzip) | 5.0 |
|---|---:|---:|
| Del proceso al núcleo listo (primer arranque tras compilar) | 1441 | |
| Del proceso al núcleo listo (arranques siguientes) | 694 | 345-370 |
| De la vista web a la interfaz pintada | 115 | 83-95 |
| Importar (SHA-256 del fichero, apertura segura, ficha) | 50 | 19 |
| Abrir el documento en el núcleo (apertura y las 245 unidades) | 30 | 2-3 |
| Abrir hasta ver el texto (interfaz) | | 15-18 |
| Buscar en el documento, núcleo Rust | 0,2-1,9 | 0,2-1,6 |
| Buscar en el documento, con la ida y vuelta por IPC | 3-5 | 2-4 |
| Buscar en la biblioteca (4 documentos), primera consulta | 57 | 30-45 |
| Buscar en la biblioteca, siguientes | 2-11 | 0,4-2,7 |

El primer arranque tras instalar o compilar paga la creación del proceso de WebKit y la
verificación de la firma; a partir del segundo, la ventana aparece en menos de medio segundo.

## Con modelos locales

Con *The Yellow Wall Paper* de SPDF Commons (80 unidades, 25 fragmentos), el mismo M4 Max,
modelos descargados desde Hugging Face en una conexión doméstica.

| Qué | macOS (llama.cpp, Metal) | Web (Chromium, WebGPU) |
|---|---:|---:|
| Descargar EmbeddingGemma 2 de solo texto | 310 MB en 7,8 s | 346 MB en 10 s |
| Revectorizar (25 fragmentos, recorte 256, con la carga del modelo) | 5,7 s | 5 s |
| Primera búsqueda semántica (con la carga del modelo) | 173 ms | 85-99 ms |
| Búsqueda híbrida, ya cargado | 25 ms | 36 ms |
| Descargar Gemma 4 E2B | 3,1 GB en 117 s | 2 GB en 45 s |
| Preguntar (recuperar, redactar, comprobar cada cita y juzgar) | 3,9-5,4 s | 7-13 s |

`MODELOS_REALES=1 npx playwright test e2e/modelos-reales.spec.ts` repite la medición web (con
un perfil persistente: los modelos se bajan una sola vez); en macOS, `SPDF_GUION` con los
pasos de descargar, abrir, revectorizar, buscar y preguntar.

## Lo que no se ha medido todavía

- iOS y Android: la app funciona en el simulador de iOS 26.4 y en el emulador de Android
  (API 36), pero un simulador no dice nada útil del rendimiento en un teléfono real. Queda
  medirlo en dispositivo.
- Windows y Linux: se compilan en la CI (GitHub Actions); no se han medido.
- Revectorizar un libro grande (el de 245 páginas tiene 298 fragmentos) con el modelo real:
  por lo medido con 25 fragmentos, en torno a un minuto en los dos.
