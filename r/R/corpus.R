# Working with a corpus of SPDF files (digital humanities).

#' A corpus of SPDF files
#'
#' `spdf_corpus()` describes several SPDF files in one tibble (one row per document).
#' `spdf_corpus_search()` runs the reference lexical search in each of them and
#' returns one row per hit, with the passage, its citation and its anchor URI.
#' `spdf_count_terms()` counts, for each document and term, the fragments that match
#' (lexical search, which also reaches the modernized-spelling layer) and the
#' occurrences of the term in those fragments (case and accents folded).
#'
#' @param paths Paths to SPDF files.
#' @param query A query (see [spdf_search()]).
#' @param terms Terms to count.
#' @param limit Maximum hits per document.
#' @param locale Locale of the citations (`"es"` or `"en"`).
#' @return A tibble.
#' @examples
#' files <- list.files(system.file("extdata", package = "spdf"), full.names = TRUE)
#' spdf_corpus(files)[, c("title", "year")]
#' spdf_corpus_search(files, "vida")[, c("title", "citation")]
#' spdf_count_terms(files, c("vida", "dulce"))
#' @export
spdf_corpus <- function(paths) {
  rows <- lapply(paths, function(p) {
    doc <- spdf_open(p)
    on.exit(spdf_close(doc))
    cbind(tibble::tibble(path = p), spdf_info(doc))
  })
  tibble::as_tibble(do.call(rbind, rows))
}

#' @rdname spdf_corpus
#' @export
spdf_corpus_search <- function(paths, query, limit = 1000, locale = "es") {
  rows <- lapply(paths, function(p) {
    doc <- spdf_open(p)
    on.exit(spdf_close(doc))
    items <- lexical_raw(doc, query, limit)$items
    if (length(items) == 0) {
      return(NULL)
    }
    m <- spdf_metadata(doc)
    frags <- spdf_fragments(doc)
    texts <- stats::setNames(frags$text, frags$id)
    ends <- stats::setNames(frags$anchor_end, frags$id)
    tibble::tibble(
      path = p, title = spdf_title(doc), year = doc_year(m),
      fragment_id = vapply(items, function(i) i$fragment_id, character(1)),
      score = vapply(items, function(i) i$score, numeric(1)),
      text = unname(texts[vapply(items, function(i) i$fragment_id, character(1))]),
      citation = vapply(items, function(i) spdf_cite(m, i$anchor, ends[[i$fragment_id]], locale), character(1)),
      anchor_uri = vapply(items, function(i) i$anchor_uri %||% NA_character_, character(1))
    )
  })
  rows <- Filter(Negate(is.null), rows)
  if (length(rows) == 0) {
    return(tibble::tibble(path = character(0), title = character(0), year = integer(0), fragment_id = character(0),
                          score = numeric(0), text = character(0), citation = character(0), anchor_uri = character(0)))
  }
  tibble::as_tibble(do.call(rbind, rows))
}

fold_text <- function(s) {
  s <- stringi::stri_trans_nfkd(s)
  s <- stringi::stri_replace_all_regex(s, "\\p{M}", "")
  stringi::stri_trans_tolower(s)
}

#' @rdname spdf_corpus
#' @export
spdf_count_terms <- function(paths, terms) {
  rows <- list()
  for (p in paths) {
    doc <- spdf_open(p)
    m <- spdf_metadata(doc)
    title <- spdf_title(doc)
    year <- doc_year(m)
    frags <- spdf_fragments(doc)
    layer <- ifelse(is.na(frags$search_text) | frags$search_text == "", frags$text, frags$search_text)
    for (t in terms) {
      hits <- vapply(lexical_raw(doc, t, 100000)$items, function(i) i$fragment_id, character(1))
      pattern <- paste0("(?<![\\p{L}\\p{N}])\\Q", fold_text(t), "\\E(?![\\p{L}\\p{N}])")
      occ <- sum(stringi::stri_count_regex(fold_text(layer[frags$id %in% hits]), pattern))
      rows[[length(rows) + 1]] <- tibble::tibble(path = p, title = title, year = year, term = t,
                                                 fragments = length(hits), occurrences = occ)
    }
    spdf_close(doc)
  }
  if (length(rows) == 0) {
    return(tibble::tibble(path = character(0), title = character(0), year = integer(0), term = character(0),
                          fragments = integer(0), occurrences = integer(0)))
  }
  tibble::as_tibble(do.call(rbind, rows))
}
