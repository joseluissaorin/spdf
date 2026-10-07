#' spdf: Read, Search and Cite SPDF Documents
#'
#' SPDF (Semantic Processed Document Format) stores a document that has been read once
#' so that it can be cited forever: every passage carries its exact anchor (printed
#' page, folio, second of a recording, slide, verse). This package opens SPDF 5.0 and
#' legacy 4.x files safely ([spdf_open()]), returns their parts as tibbles
#' ([spdf_units()], [spdf_fragments()]...), validates them ([spdf_validate()]), runs
#' the reference lexical, vector and hybrid searches ([spdf_search()]), builds anchor
#' URIs and short citations ([spdf_anchor_uri()], [spdf_cite()]), exports CSL-JSON and
#' BibTeX ([spdf_csl()], [spdf_bibtex()]), writes new files ([spdf_write()]) and works
#' over corpora ([spdf_corpus_search()], [spdf_count_terms()]).
#'
#' @keywords internal
"_PACKAGE"
