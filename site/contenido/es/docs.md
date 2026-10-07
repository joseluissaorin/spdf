---
title: Documentación
short: Documentación
description: Cómo abrir, validar, buscar y citar ficheros SPDF en Rust, TypeScript, Python, Swift, Kotlin, Go, C#, PHP, Ruby, R, Julia y C.
---

Todas las implementaciones ofrecen las mismas operaciones con los nombres y las costumbres de su lenguaje. Elige el tuyo: cada hoja trae la línea de instalación, un primer ejemplo y el README completo de la biblioteca (en inglés, como el código).

<!-- docs -->

## Las mismas operaciones en todas

| Operación | Qué devuelve |
| --- | --- |
| abrir | Un acceso de solo lectura a un fichero 5.0 o heredado 4.x, abierto con seguridad |
| validar | `{valid, version, profile, errors, warnings}` con los códigos de la especificación |
| volcar | El JSON canónico del fichero (RFC 8785) |
| buscar (léxica, vectorial, híbrida) | Resultados `{fragment_id, score, via, anchor, anchor_uri}` |
| URI de ancla | Escribir y leer URI `spdf:`, byte a byte |
| citar | `(Apellido, Año, localizador)` en castellano o en inglés |
| exportar | CSL-JSON y BibTeX |
| construir | Un SPDF nuevo y válido a partir de tus propios datos |

## Sin ninguna biblioteca

Un fichero SPDF es una base de datos SQLite. Cualquier herramienta que hable SQLite lo lee; solo hay que tener cuidado con las reglas de seguridad y con las anclas.

```sh
sqlite3 -readonly darwin-origin.spdf "SELECT key, value FROM spdf_meta"
sqlite3 -readonly darwin-origin.spdf \
  "SELECT f.id, u.printed, substr(f.text, 1, 80)
     FROM fragments_fts JOIN fragments f ON f.n = fragments_fts.rowid
     JOIN units u ON u.id = f.unit
    WHERE fragments_fts MATCH 'selection' LIMIT 5"
```

Los ficheros heredados 4.x de Scholaris vienen envueltos en gzip: antes, `gzip -dc viejo.spdf > viejo.sqlite`.
