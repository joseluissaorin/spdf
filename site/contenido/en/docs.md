---
title: Documentation
short: Docs
description: How to open, validate, search and cite SPDF files in Rust, TypeScript, Python, Swift, Kotlin, Go, C#, PHP, Ruby, R, Julia and C.
---

Every implementation offers the same operations with the names and habits of its language. Pick yours; each page has the install line, a first example and the full README of the library.

<!-- docs -->

## The same operations everywhere

| Operation | What it returns |
| --- | --- |
| open | A read-only handle on a 5.0 or legacy 4.x file, opened safely |
| validate | `{valid, version, profile, errors, warnings}` with the codes of the specification |
| dump | The canonical JSON of the file (RFC 8785) |
| search (lexical, vector, hybrid) | `{fragment_id, score, via, anchor, anchor_uri}` items |
| anchor URI | Format and parse `spdf:` URIs, byte for byte |
| cite | `(Family, Year, locator)` in English or Spanish |
| export | CSL-JSON and BibTeX |
| write | A new, valid SPDF built from your own data |

## Without any library

An SPDF file is a SQLite database. Any tool that speaks SQLite reads it; only the safety rules and the anchors need care.

```sh
sqlite3 -readonly darwin-origin.spdf "SELECT key, value FROM spdf_meta"
sqlite3 -readonly darwin-origin.spdf \
  "SELECT f.id, u.printed, substr(f.text, 1, 80)
     FROM fragments_fts JOIN fragments f ON f.n = fragments_fts.rowid
     JOIN units u ON u.id = f.unit
    WHERE fragments_fts MATCH 'selection' LIMIT 5"
```

Legacy 4.x files from Scholaris are gzip-wrapped: `gzip -dc old.spdf > old.sqlite` first.
