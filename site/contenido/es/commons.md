---
title: SPDF Commons
short: Commons
description: Una colección pequeña y cuidada de obras de dominio público ya leídas en SPDF, en varias lenguas y de varios tipos (libros escaneados, EPUB, grabaciones de LibriVox), para descargar, probar y citar libremente.
---

**SPDF Commons** es una pequeña colección de obras de dominio público ya leídas en SPDF: libros escaneados con sus folios impresos, EPUB con sus listas de páginas y grabaciones de LibriVox con su transcripción sincronizada palabra a palabra. Están aquí para descargarlas, abrirlas, buscar en ellas y citarlas, para probar las implementaciones con documentos reales y para enseñar lo que guarda el formato.

<!-- commons -->

## Cómo se hicieron

Todos los ficheros salieron de `spdf build`, el productor de referencia, solo con modelos locales. La tabla `provenance` de cada fichero registra qué modelo leyó cada página o cada segundo, con qué confianza y cuándo; abre cualquiera en el [validador](/es/validador) para verlo.

Las fuentes son obras de dominio público verificables (Proyecto Gutenberg, Internet Archive, LibriVox, Wikisource). Cada fichero nombra los bytes del original por su SHA-256, así que cualquiera puede comprobar que se leyó de la fuente que dice.

## El manifiesto

La colección entera se describe en un manifiesto `.spdfl.json`: una entrada por fichero, con su SHA-256, título, autores, año y dirección de descarga. Cualquier herramienta de SPDF puede usarlo para descargar o verificar el conjunto.

## Licencia

Las obras son de dominio público. Los ficheros SPDF (la lectura: transcripción, anclas, secciones, vectores) se ceden al dominio público con CC0 1.0.
