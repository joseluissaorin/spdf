# Unicode helpers and the reference query parser (specification section 6).

nfc <- function(s) stringi::stri_trans_nfc(s)

# Words: maximal runs of Unicode L, M or N.
text_words <- function(s) {
  w <- stringi::stri_extract_all_regex(s, "[\\p{L}\\p{M}\\p{N}]+")[[1]]
  if (length(w) == 1 && is.na(w)) character(0) else w
}

dedup_key <- function(t) {
  d <- stringi::stri_trans_nfd(t)
  tolower_u(stringi::stri_replace_all_regex(d, "\\p{Mn}", ""))
}

tolower_u <- function(s) stringi::stri_trans_tolower(s, locale = "en_US_POSIX")

cjk_pattern <- paste0(
  "[\\u2E80-\\u2FDF\\u3040-\\u30FF\\u3100-\\u312F\\u3130-\\u318F\\u31A0-\\u31FF\\u3400-\\u4DBF",
  "\\u4E00-\\u9FFF\\uA960-\\uA97F\\uAC00-\\uD7AF\\uF900-\\uFAFF\\uFF66-\\uFF9F\\U00020000-\\U0003FFFF]"
)

is_cjk <- function(s) stringi::stri_detect_regex(s, cjk_pattern)

fts_string <- function(t) paste0("\"", gsub("\"", "\"\"", t, fixed = TRUE), "\"")

quote_pairs <- list(
  "\"" = "\"",
  "\u201c" = "\u201d",
  "\u00ab" = "\u00bb",
  "\u201e" = c("\u201c", "\u201d")
)

# list(terms, phrases, cjk) for a user query.
query_terms <- function(query) {
  q <- nfc(as.character(query))
  chars <- strsplit(q, "")[[1]]
  n <- length(chars)
  phrases <- character(0)
  rest <- character(0)
  i <- 1L
  while (i <= n) {
    c <- chars[i]
    if (!is.null(quote_pairs[[c]]) && c %in% names(quote_pairs)) {
      closes <- quote_pairs[[c]]
      j <- if (i < n) which(chars[(i + 1):n] %in% closes) else integer(0)
      rest <- c(rest, " ")
      if (length(j) > 0) {
        j <- i + j[1]
        phrases <- c(phrases, paste(chars[seq_len(j - i - 1) + i], collapse = ""))
        i <- j + 1L
      } else {
        i <- i + 1L
      }
      next
    }
    rest <- c(rest, c)
    i <- i + 1L
  }
  phrase_terms <- character(0)
  for (p in phrases) {
    w <- text_words(p)
    if (length(w) > 0) phrase_terms <- c(phrase_terms, paste(w, collapse = " "))
  }
  is_phrase <- length(phrase_terms) > 0
  candidates <- if (is_phrase) phrase_terms else text_words(paste(rest, collapse = ""))
  keys <- vapply(candidates, dedup_key, character(1), USE.NAMES = FALSE)
  terms <- candidates[!duplicated(keys)]
  list(terms = terms, phrases = is_phrase, cjk = is_cjk(q))
}

fts_match <- function(terms, phrases) {
  if (length(terms) == 0) {
    return(NULL)
  }
  paste(vapply(terms, fts_string, character(1), USE.NAMES = FALSE), collapse = if (phrases) " AND " else " OR ")
}
