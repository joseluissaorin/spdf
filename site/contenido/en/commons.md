---
title: SPDF Commons
short: Commons
description: A small, careful collection of public-domain works already read into SPDF, in several languages and of several kinds (scanned books, EPUB, LibriVox recordings), free to download, test and cite.
---

**SPDF Commons** is a small collection of public-domain works already read into SPDF: scanned books with their printed folios, EPUBs with their page lists, and LibriVox recordings with their transcripts timed word by word. They are here to be downloaded, opened, searched and cited, to test implementations against real documents, and to show what the format holds.

<!-- commons -->

## How they were made and checked

Every file was produced with `spdf build`, the reference producer. The `provenance` table of each file records which model read each page or each second, with what confidence and when; open any of them in the [validator](/validator) to see it.

**Validating a file is not enough**: a folio put on the wrong page passes the validator. So, before a work is published here, its printed folios (or, in a recording, its times) are checked by eye against the page images or the transcript, on several pages from the beginning, the middle and the end, and the table above says, for each work, which pages were checked and what was found. A work whose check fails is rebuilt, not published.

The sources are verifiable public-domain works (Project Gutenberg, Internet Archive, LibriVox, Wikisource). The original bytes are named by their SHA-256 in every file, so anyone can check that a file was read from the source it claims.

## The manifest

The whole collection is described by an `.spdfl.json` manifest: one entry per file, with its SHA-256, title, authors, year and download address. Point any SPDF tool at it to fetch or verify the whole set.

## Licence

The works are in the public domain. The SPDF files (the reading: transcription, anchors, sections, vectors) are dedicated to the public domain under CC0 1.0.
