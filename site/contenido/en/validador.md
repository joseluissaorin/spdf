---
title: Validator and inspector
short: Validator
description: Drop a .spdf file to check it against the SPDF specification and see what is inside: record, units, fragments with anchors, figures, vector spaces. Everything runs in your browser; nothing is uploaded.
---

<!-- validador -->

## What it checks

The validator runs the same checks, in the same order, as every conforming implementation, and reports the same codes. It uses `spdf-format`, the TypeScript implementation, with SQLite compiled to WebAssembly: **the file never leaves your computer**.

| Code | Meaning |
| --- | --- |
| E001 | Not a SQLite database |
| E002 | Unknown `application_id` or version |
| E003 | A 5.0 file wrapped in gzip (warning: 5.0 files are distributed uncompressed) |
| E010 · E011 | A required table or column is missing |
| E012 | A required `spdf_meta` key is missing |
| E013 | `documents` must hold exactly one row |
| E020 | A trigger or a view is present |
| E030 · E031 · E032 | A vector of the wrong length, an unknown space or an unknown dtype |
| E040 · E041 · E042 | An invalid anchor, an unknown anchor type or characters out of range |
| E050 · E051 | Invalid metadata JSON, or metadata that is not a CSL item |
| E060 | A required extension this reader does not know |
| E070 | The full-text index is out of sync with the fragments |
| E080 · E081 · E082 | A blob, the content hash or the signature does not match |
| E090 | Units are not numbered contiguously from 1 |
| W100–W110 | Warnings: a semantic profile without vectors, a media profile without times, a newer minor version, a legacy file… |

## From the command line

Every implementation validates too. With the TypeScript one:

```sh
npx spdf-format validate darwin-origin.spdf
```
