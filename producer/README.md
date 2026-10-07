# spdf-build

The reference producer of **SPDF 5.0** files, independent of Scholaris. It turns almost
any input into a valid SPDF: the document read once, cut into citable units with exact
anchors (printed page, second of a recording, slide, sheet rows), with a bibliographic
record whose every field says where it came from, searchable fragments, a modernized
spelling layer for old texts, figures and vectors.

With Scholaris (TypeScript) there are two independent, interoperable producers: a
requirement for SPDF to be a standard. Both write through the same contract
(`spec/CONTRACT.md`) and their outputs pass the same validator.

Code: MIT OR Apache-2.0. Models are downloaded on demand and never shipped.

## Install

```sh
cd producer
uv sync                      # core: PDF, EPUB, office, web; simulated engines
uv sync --extra local        # + EmbeddingGemma 2, Gemma 4 (mlx-vlm), whisper (mlx-whisper)
```

`spdf-format` (`../python`) is a dependency: it provides the writer and the validator,
and `spdf build` / `spdf revectorize` appear as subcommands of the `spdf` CLI.
Audio and video need `ffmpeg`/`ffprobe` on the PATH.

## Use

```sh
spdf-build build book.pdf -o book.spdf                       # local engines (default)
spdf-build build scan.pdf --engine gemini                    # GEMINI_API_KEY in the environment
spdf-build build talk.mp3 --engine local --offline           # zero requests to the internet
spdf-build build https://example.org/article --engine local  # web page with its dated copy
spdf-build build photos/ -o notebook.spdf                    # a folder of page photos
spdf-build revectorize book.spdf --model embeddinggemma-2@256
spdf-build engines                                           # what can run here
spdf build …                                                 # the same, through spdf-format
```

Inputs: PDF with a text layer; scanned PDF; photos of pages and single images; EPUB
(with its list of printed pages when it has one); DOCX, ODT, HTML, Markdown, TXT; PPTX;
XLSX and CSV; audio and video (word timings, speakers, key frames); an http(s) URL.

Useful options: `--no-labels` (deduce folios only from what is seen, ignoring PDF page
labels), `--language`, `--title/--author/--year/--type/--publisher` (always win over every
other source), `--license` (goes into `documents.rights`), `--page-images none|scans|all`,
`--image-vectors useful|all|none`, `--dtype f32|f16|i8`, `--embed-source`, `--no-context`,
`--max-units N`, `--json`. `--save-reading pages.json` keeps what the page reader saw and
`--reuse-reading pages.json` replays every later step (folios, record, fragments…) without
paying for the vision engine again.

## Engines

Four roles, each interchangeable (`--engine` sets all four, `--embed/--vision/--llm/--asr`
override one):

| role | local | with a key | other |
|---|---|---|---|
| vectors | `embeddinggemma-2@768/512/256/128` (sentence-transformers; CUDA/MPS bfloat16, CPU float32, never float16) | `gemini-embedding-2@768` | `openai:<model>[@dims]`, `fake` |
| page reading | `gemma-4-e4b` / `gemma-4-e2b` (mlx-vlm on Apple silicon, transformers elsewhere), `tesseract` | `gemini[:model]` | `openai:<model>` (any OpenAI-compatible server, e.g. llama.cpp with Gemma 4 GGUF) |
| record, context, descriptions | `gemma-4-e4b` | `gemini[:model]` | `openai:<model>` |
| transcription | `whisper-large-v3-turbo` (mlx-whisper, or whisper.cpp with a ggml model) | `gemini[:model]` | `openai:<model>` |

EmbeddingGemma 2 is used with the task prefixes of its model card (`title: {title} |
text: …` for fragments, `task: search result | query: …` for queries), recorded in
`spaces.task_prefixes`. Fragments are embedded with their context line.

`--offline` refuses remote engines before anything runs, sets `HF_HUB_OFFLINE` and runs
the whole build inside a socket guard that blocks and counts every non-loopback
connection; the build fails if the count is not 0. Catalogue lookups are skipped.

Keys are read from the environment only (`GEMINI_API_KEY`, `OPENAI_API_KEY`,
`OPENALEX_API_KEY`, optional `SPDF_CONTACT_EMAIL` for Crossref); nothing is stored.

## What a build does

1. **Read** each unit: PDF text layer where it is good (quality diagnosis per page,
   header/footer zones, running heads, titles by font size, footnotes, embedded figures);
   page images to the vision engine where it is not (a scan's old OCR layer included).
2. **Folios**: candidates from header, footer, body edges and what the reader saw; the
   longest coherent chain (dynamic programming); piecewise deduction (interpolation,
   plates, missing leaves, roman → arabic, foliation `12r/12v`); PDF page labels when they
   agree with what is seen; covers and endpapers without folio. Inferred folios are
   marked `source: inferred` (cited in brackets). No reading at all → no folio invented.
3. **Record** (CSL-JSON + `spdf.provenance` per field): embedded metadata, identifiers in
   the credits (ISBN with check digit, DOI, arXiv), the LLM reading the first and last
   pages, Crossref, OpenAlex and Open Library when online.
4. **Sections** from the outline/TOC, or from titles; **fragments** of ~250-450 tokens that
   never cross sections, join paragraphs split across pages (`anchor_end`) and carry their
   footnotes.
5. **Modernized layer** (`search_text`) for old Spanish, Latin, French and Italian: a key
   that the modern query also produces («muger» = «mujer», «dixo» = «dijo»).
6. **Context** line per fragment (LLM, or extractive), **figures** with region and a
   description in the language of the document, **vectors** of fragments, page images and
   figures, **provenance** of every step.

Steps and heuristics are ports of Scholaris (`packages/{ingesta,imprenta,folios,
normalizacion}`), so both producers cut, anchor and number the same way.

## Tests and CI

```sh
uv run pytest -q                                   # fast, simulated engines, no models
uv run python bench/conformance_producer.py        # every input kind, validated twice
```

CI (`.github/workflows/producer.yml`) runs both without models and uploads
`conformance-producer` (`conformance.json`: each generated file with the result of
`spdf-format` and of the conformance oracle). Measured quality on real public-domain
works is in [`RESULTADOS.md`](RESULTADOS.md).
