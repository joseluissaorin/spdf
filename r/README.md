# spdf (R)

Read, validate, search, cite and write **SPDF** files (Semantic Processed Document
Format) from R. A SPDF file holds a document that has been read once and can be cited
forever: every passage carries its exact anchor (printed page, folio, second of a
recording, slide, verse), so a citation can only print what the source says.

The package is a native implementation of SPDF 5.0 on RSQLite. It also reads the legacy
4.0/4.1 files produced by Scholaris (gzip-wrapped, Spanish schema) through the 5.0 view.
Tables come back as tibbles.

## Install

```r
# from CRAN, once published
install.packages("spdf")
# from the repository
remotes::install_github("joseluissaorin/spdf", subdir = "r")
```

## Read, search, cite

```r
library(spdf)
doc <- spdf_open(system.file("extdata", "quijote.spdf", package = "spdf"))

spdf_info(doc)                     # title, authors, year, version, counts
spdf_units(doc)                    # one row per citable unit (page, folio, time span...)
fr <- spdf_fragments(doc)          # searchable passages, anchors as list-columns

hits <- spdf_search(doc, "\"lugar de la Mancha\"")
hits$anchor_uri                    # spdf:sha256-fa38...#p=5&pe=6&f=1r&fe=1v&char=101,278
f <- fr[fr$id == hits$fragment_id[1], ]
spdf_cite(spdf_metadata(doc), f$anchor[[1]], f$anchor_end[[1]], locale = "es")
#> "(Cervantes Saavedra, 1605, fols. 1r-[1v])"

spdf_locate(doc, hits$anchor_uri[1])   # list(document, units, fragments, char, xywh)
cat(spdf_bibtex(doc))              # @book{cervantessaavedra1605, ... (also spdf_csl())
spdf_close(doc)
```

Vector and hybrid search take a query vector computed with the same model as the space:
`spdf_search_vector(doc, v, "embeddinggemma-2@768")`,
`spdf_search_hybrid(doc, "ciego jarro", v, "embeddinggemma-2@768")`.

## ALTO, TEI and IIIF

```r
writeLines(spdf_alto(doc), "quijote.alto.xml")    # ALTO 4, one Page per page unit
writeLines(spdf_tei(doc), "quijote.tei.xml")      # TEI P5: pb, p, lg/l, u, note
writeLines(spdf_iiif_json(doc, "https://example.org/iiif/quijote"), "manifest.json")
```

## Corpora

```r
files <- list.files("corpus", pattern = "\\.spdf$", full.names = TRUE)
spdf_corpus(files)                          # one row per document
spdf_corpus_search(files, "\"molinos de viento\"")   # one row per passage, with citation
spdf_count_terms(files, c("honra", "fortuna"))       # fragments and occurrences per work
```

The vignette `vignette("corpus", package = "spdf")` (in Spanish) walks through a
digital-humanities workflow: searching a corpus and counting occurrences by work and
year, with every number traceable to its page.

## Validate and write

```r
spdf_validate("file.spdf")         # list(valid, version, profile, errors, warnings)
spdf_write("out.spdf", document = ..., units = ..., fragments = ...)
```

## Security

Files are untrusted input: `spdf_open()` connects read-only with `query_only` and
`trusted_schema=OFF`, never loads extensions, refuses triggers, views and foreign
virtual tables (except the three FTS triggers of legacy files), bounds blob sizes and
gzip inflation, and copies WAL-mode files before opening them.

## Conformance

`spdf_conformance("path/to/spdf/conformance")` runs the shared suite of the
specification; `Rscript inst/scripts/conformance.R ../conformance` prints the JSON
report. CI publishes it as the `conformance-r` artifact. All kinds are claimed,
`export_structure` included.

## License

MIT OR Apache-2.0, at your option. The SPDF specification is CC BY 4.0. The sample
files in `inst/extdata` are short excerpts of public-domain works.
