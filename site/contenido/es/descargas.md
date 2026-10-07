---
title: Descargar el Lector SPDF
short: Descargas
description: El Lector SPDF abre, busca y cita ficheros SPDF en macOS, Windows, Linux, iOS, Android y la web, con modelos locales, sin conexión y sin cuenta. Gratis.
---

El **Lector SPDF** es el lector gratuito del formato: abre un fichero, léelo página a página o segundo a segundo, búscalo por palabras o por sentido y copia una cita con el folio exacto. Tiene la misma interfaz en todas partes, hecha con Tauri 2 sobre un núcleo de Rust, y los modelos que usa para la búsqueda semántica funcionan en tu propio dispositivo (en Android, en esta primera versión, la búsqueda semántica pasa por Gemini con tu propia clave).

<!-- descargas -->

La instalación paso a paso en cada plataforma, con lo que hay que hacer con las versiones sin firmar, está en el [README del lector](https://github.com/joseluissaorin/spdf/blob/main/reader/README.md#instalar).

## En el navegador

El [lector web](/reader/) es la misma aplicación compilada para la web. Funciona **entera en tu navegador**: los ficheros se leen con SQLite en WebAssembly y se guardan en el almacenamiento privado de tu navegador, y la búsqueda semántica corre en tu tarjeta gráfica con WebGPU. No se envía nada a ningún sitio, salvo la descarga, una sola vez, del modelo de vectores desde Hugging Face y, solo si lo pides y pones tu propia clave, Gemini.

## Qué hace

- Abre ficheros SPDF 5.0 y los ficheros heredados 4.x de Scholaris.
- Enseña cada página junto a su texto, con el folio impreso, o reproduce la grabación con su transcripción palabra a palabra.
- Búsqueda léxica, semántica e híbrida en toda tu biblioteca.
- Copia citas en castellano o en inglés, CSL-JSON y BibTeX, con la URI de ancla.
- Guarda tus notas fuera del fichero, como anotaciones W3C (`.spdfa.json`), así que el fichero no cambia nunca.
