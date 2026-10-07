---
title: Implementaciones
short: Implementaciones
description: Doce implementaciones nativas e independientes de SPDF 5.0, todas comprobadas con la misma batería de conformidad en cada commit, y lo que dice hoy el CI de cada una.
---

SPDF no es una biblioteca con envoltorios para otros lenguajes. Es una especificación con varias **implementaciones nativas e independientes**, escrita cada una con las costumbres de su lenguaje y comprobadas todas con los mismos casos de conformidad. La de Rust es la de referencia y además ofrece una ABI de C para quien prefiera no tratar con SQLite directamente.

La tabla se rehace a partir de la integración continua del repositorio cada vez que se publica esta web. Aquí no hay nada escrito a mano: si un run está en rojo, sale en rojo.

<!-- estado -->

## Lo que hace cada implementación

Todas las implementaciones, en todos los lenguajes, hacen las mismas ocho cosas, y la batería de conformidad las comprueba todas:

1. **Abren con seguridad**: en solo lectura, con `query_only`, `trusted_schema=OFF` y el modo defensivo donde el enlace con SQLite lo permite, sin cargar nunca extensiones, rechazando los ficheros con disparadores o vistas y con límites al tamaño de los blobs y de la descompresión.
2. **Validan** un fichero e informan con los códigos de error y de aviso de la especificación ([§ Validación](/es/especificacion#validation)).
3. **Leen** SPDF 5.0 y los ficheros heredados 4.0 y 4.1 de Scholaris, que suelen venir envueltos en gzip y usan identificadores en castellano.
4. **Vuelcan** un fichero a JSON canónico (RFC 8785), el oráculo con el que se compara a todas las demás.
5. **Buscan**: léxica (FTS5), vectorial (fuerza bruta, en f32, f16 o i8) e híbrida (fusión por rango recíproco con k = 10).
6. **Escriben y leen URI de ancla**, byte a byte, en los dos sentidos.
7. **Citan**: citas cortas de autor y año en castellano y en inglés, y bibliografía en CSL-JSON y BibTeX.
8. **Construyen**: crean un SPDF válido desde cero y reconstruyen un fichero a partir de su volcado.

## Cómo se comprueba la conformidad

La batería está en `conformance/`: volcados de origen, ficheros generados, ficheros heredados, ficheros rotos a propósito y un caso en JSON por cada comprobación. Un caso tiene un `id`, un tipo (`dump`, `validate`, `search_lexical`, `search_vector`, `search_hybrid`, `anchor_uri`, `cite`, `legacy_dump`, `roundtrip`), una entrada y el resultado esperado.

Cada implementación trae un ejecutor que pasa todos los casos e imprime una línea de JSON:

```json
{"impl": "rust", "version": "5.0.0", "passed": ["dump-001", "…"], "failed": [], "skipped": []}
```

El CI de cada implementación falla si falla un solo caso y sube ese JSON como el artefacto `conformance-<carpeta>`, que es lo que cuenta la tabla de arriba.

## Niveles

- **Primer nivel**: Rust, TypeScript, Python, Swift, Kotlin/JVM, Go y C#. Se publican a la vez que cada versión de la especificación.
- **Segundo nivel**: PHP, Ruby, R, Julia y C. La misma batería; se publican cuando están listas.

## Productores

Leer un documento es cosa del productor, no de la biblioteca. Hay dos productores independientes, y que se entiendan entre sí es condición para declarar estable el formato:

- `spdf build`, el productor de referencia, en Python, con modelos locales (EmbeddingGemma 2, Gemma 4, Whisper) o con tu propia clave de API.
- [Scholaris](https://scholaris.joseluissaorin.com), en TypeScript, donde nació el formato.
