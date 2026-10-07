# Notas de coordinación con la ABI de C (agente rust)

Estado a 7-10-2026: la ABI existe (`rust/crates/spdf-ffi/include/spdf.h`, biblioteca
`libspdf_ffi`) y cubre todo lo que pidió esta carpeta:

| Necesidad | Función |
|---|---|
| versión | `spdf_version` |
| abrir / cerrar | `spdf_open`, `spdf_open_bytes`, `spdf_close` |
| validar | `spdf_validate`, `spdf_validate_bytes` |
| volcado canónico | `spdf_dump` (JCS) |
| búsqueda léxica, vectorial, híbrida | `spdf_search_lexical`, `spdf_search_vector`, `spdf_search_hybrid` |
| URI de ancla | `spdf_anchor_uri_format`, `spdf_anchor_uri_format_locator`, `spdf_anchor_uri_parse`, `spdf_locate` |
| cita | `spdf_cite`, `spdf_doc_cite` |
| exportar | `spdf_export_csl_json`, `spdf_export_bibtex` |
| escribir | `spdf_write_from_dump` |
| hash del contenido | `spdf_verify` (`computed_sha256`) |
| liberar | `spdf_string_free`, `spdf_bytes_free` |

Pendiente (pedido al agente rust el 7-10-2026): una función de cuantización del lado del
escritor, para que el runner de C cubra el tipo de caso `quantize`:

```c
int spdf_quantize(const double *values, size_t n, const char *dtype,
                  uint8_t **out_data, size_t *out_len);   /* bytes: spdf_bytes_free */
```

Lo que el runner de C no compara: `route` y `match` de la búsqueda léxica (la ABI
devuelve solo los resultados; el README de la batería lo deja como SHOULD).
