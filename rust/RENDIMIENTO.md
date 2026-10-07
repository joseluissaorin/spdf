# Rendimiento de la implementación en Rust

Medido el 7 de octubre de 2026 con `cargo bench -p spdf --features http` (un arnés
sencillo en `crates/spdf/benches/spdf.rs`: mediana y percentil 90 de ejecuciones
repetidas tras un calentamiento).

- Máquina: Apple M4 Max, macOS 26.5. Rust 1.95.0, perfil `release`.
- SQLite 3.53.2 empaquetado por `rusqlite` 0.40 (`bundled`, FTS5).

## Libro real de 245 páginas

*The Discarded Image* (C. S. Lewis), un SPDF 4.1 producido por Scholaris: 245 unidades,
298 fragmentos, vectores `gemini-embedding-2@1536`, imágenes de página. Es una obra con
derechos, así que **no está en el repositorio**; se mide apuntando a la copia local:

```sh
SPDF_BENCH_BOOK=/ruta/a/discarded.spdf cargo bench -p spdf --features http
```

Fichero legado de 7,9 MB en gzip; su conversión a 5.0 ocupa 9,9 MB sin comprimir.

| operación | mediana | p90 |
|---|---:|---:|
| abrir el 4.1 (gzip, descompresión en memoria) | 27,80 ms | 30,71 ms |
| abrir el 5.0 (fichero, con todas las comprobaciones de seguridad) | 205 µs | 249 µs |
| abrir el 5.0 + `document()` + `units()` | 1,42 ms | 1,60 ms |
| léxica `the` (límite 10) | 216 µs | 229 µs |
| léxica `medieval model` | 177 µs | 189 µs |
| léxica `"the discarded image"` (frase) | 232 µs | 243 µs |
| léxica `hidalgo lanza` (sin resultados) | 35 µs | 36 µs |
| volcado canónico (cadena JCS) | 24,66 ms | 26,61 ms |
| validación completa (con `integrity-check` de FTS en una copia en memoria) | 18,07 ms | 18,56 ms |

## Búsqueda vectorial sobre 10 000 vectores

Fichero sintético: 10 000 fragmentos con vectores unitarios de 768 dimensiones en tres
espacios compatibles (`f32`, `f16`, `i8`); 84,7 MB, escrito en 0,7 s.

| operación | mediana | p90 |
|---|---:|---:|
| vectorial f32, en frío (lee los 30 MB de SQLite) | 25,03 ms | 27,06 ms |
| vectorial i8, en frío | 23,24 ms | 26,22 ms |
| vectorial f32, en caliente (caché en memoria) | 5,62 ms | 5,85 ms |
| vectorial f16, en caliente | 6,22 ms | 6,80 ms |
| vectorial i8, en caliente | 5,99 ms | 6,52 ms |
| híbrida (léxica + vectorial f32, RRF k = 10) | 9,19 ms | 9,66 ms |
| volcado canónico del fichero de 10 000 vectores | 169,77 ms | 179,18 ms |

El producto escalar se acumula en f64, componente a componente y en orden, para dar
exactamente las puntuaciones de la referencia; por eso no se vectoriza con SIMD. La
caché (`OpenOptions::vector_cache_bytes`, 256 MiB por omisión) guarda los bytes de un
espacio tras la primera búsqueda.

## Lectura remota por rangos HTTP (experimental)

Con un servidor HTTP local que admite `Range`, bloques de 16 KiB:

| fichero | abrir | 4 búsquedas léxicas | tamaño |
|---|---|---|---:|
| libro real (5.0) | 1,68 ms, 4 peticiones, 40 KiB | 4,04 ms, 29 peticiones, 464 KiB | 9,9 MB |
| libro sintético | 1,65 ms, 4 peticiones, 48 KiB | 4,74 ms, 27 peticiones, 432 KiB | 4,1 MB |

Es decir, se abre y se busca en el libro descargando entre el 5 % y el 12 % del fichero. Falta medirlo
contra un servidor real con latencia de red: cada petición cuesta un viaje de ida y
vuelta, y la búsqueda vectorial sigue necesitando todos los vectores del espacio.

## Libro sintético (reproducible en cualquier máquina)

Sin `SPDF_BENCH_BOOK`, el arnés construye un libro de 245 páginas (unas 380 palabras por
página, dos fragmentos por página) con palabras de los textos de dominio público de la
batería de conformidad. 4,1 MB.

| operación | mediana | p90 |
|---|---:|---:|
| abrir el 5.0 | 208 µs | 231 µs |
| abrir + `document()` + `units()` | 1,97 ms | 2,19 ms |
| léxica `the` | 262 µs | 292 µs |
| léxica `hidalgo lanza` | 241 µs | 353 µs |
| volcado canónico | 11,90 ms | 14,21 ms |
| validación completa | 9,42 ms | 9,91 ms |
