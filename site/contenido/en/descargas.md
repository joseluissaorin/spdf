---
title: Download SPDF Reader
short: Download
description: SPDF Reader opens, searches and cites SPDF files on macOS, Windows, Linux, iOS, Android and the web, with local models, offline and without an account. Free.
---

**SPDF Reader** is the free reader of the format: open a file, read it page by page or second by second, search it by words or by meaning, and copy a citation with the exact folio. It runs the same interface everywhere, built with Tauri 2 on a Rust core, and the models it uses for semantic search run on your device.

<!-- descargas -->

## In your browser

The [web reader](/reader/) is the same application compiled for the web. It runs **entirely in your browser**: files are read with SQLite in WebAssembly and stored in your browser's private storage, and semantic search runs on your graphics card with WebGPU. Nothing is sent anywhere, except the one-time download of the embedding model from Hugging Face and, only if you ask for it and give your own key, Gemini.

## What it does

- Opens SPDF 5.0 files and the legacy 4.x files from Scholaris.
- Shows each page next to its text, with the printed folio, or plays the recording with its transcript word by word.
- Lexical, semantic and hybrid search across your whole library.
- Copies citations in English or Spanish, CSL-JSON and BibTeX, with the anchor URI.
- Saves your notes outside the file, as W3C Web Annotations (`.spdfa.json`), so the file itself never changes.
