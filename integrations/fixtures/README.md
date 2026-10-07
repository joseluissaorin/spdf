# Fixtures

Sample SPDF 5.0 files shared by the tests of every integration. They are the
booklets that the website builds for its validator (`site/muestras/generar.ts`):
a six-page pamphlet about SPDF, typeset in HTML, printed to PDF with headless
Chrome and read into SPDF with `spdf-format`.

| File | Language | What it holds |
| --- | --- | --- |
| `spdf-in-five-pages.spdf` | English | 6 page units (cover without folio, printed folios 1, 2, an inferred [3] on a plate, 4, 5), 8 fragments with `chars` ranges, 6 sections, 1 figure, the original PDF and page images as blobs, 384-dim `all-MiniLM-L6-v2` vectors for every fragment, provenance |
| `spdf-en-cinco-paginas.spdf` | Spanish | The same booklet in Spanish |
| `roto.spdf` | English | A deliberately broken copy: a view (E020) and units not numbered contiguously (E090) |

Dedicated to the public domain (CC0 1.0). Regenerate with `cd site/muestras && npm run generar`.
