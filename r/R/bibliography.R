# Bibliographic exports (specification section 19): CSL-JSON and BibTeX.

bibtex_types <- c(
  book = "book", "article-journal" = "article", "article-magazine" = "article", "article-newspaper" = "article",
  chapter = "incollection", "paper-conference" = "inproceedings", thesis = "phdthesis", report = "techreport"
)
bibtex_fields <- c(
  publisher = "publisher", "publisher-place" = "address", "collection-title" = "series", volume = "volume",
  issue = "number", page = "pages", edition = "edition", DOI = "doi", ISBN = "isbn", URL = "url",
  language = "language", note = "note"
)

csl_base <- function(m) m[names(m) != "spdf"]

ascii_letters <- function(s) {
  d <- stringi::stri_trans_nfkd(as.character(s))
  d <- stringi::stri_replace_all_regex(d, "\\p{Mn}", "")
  tolower(gsub("[^A-Za-z]", "", d))
}

bib_year <- function(item) {
  y <- tryCatch(item$issued[["date-parts"]][[1]][[1]], error = function(e) NULL)
  if (is.null(y) || is.logical(y)) {
    return(NULL)
  }
  if (is.numeric(y) && y == floor(y)) {
    return(format(y, scientific = FALSE))
  }
  if (is.character(y) && grepl("^\\s*-?[0-9]+\\s*$", y)) {
    return(as.character(as.integer(trimws(y))))
  }
  NULL
}

bib_key <- function(item) {
  base <- ""
  a <- if (is.list(item$author) && length(item$author) > 0) item$author[[1]] else NULL
  if (is.list(a)) {
    who <- Filter(function(x) !is.null(x) && !identical(x, ""), list(a$family, a$literal, a$given))
    base <- ascii_letters(if (length(who) > 0) who[[1]] else "")
  }
  if (base == "") {
    w <- strsplit(trimws(as.character(item$title %||% "")), "\\s+")[[1]]
    base <- if (length(w) > 0 && nzchar(w[1])) ascii_letters(w[1]) else ""
  }
  paste0(if (base == "") "spdf" else base, bib_year(item) %||% "nd")
}

bib_suffix <- function(n) {
  letters_ <- ""
  n <- n + 1
  while (n > 0) {
    r <- (n - 1) %% 26
    n <- (n - 1) %/% 26
    letters_ <- paste0(letters[r + 1], letters_)
  }
  letters_
}

bib_keys <- function(items) {
  bases <- vapply(items, bib_key, character(1))
  counts <- table(bases)
  seen <- list()
  vapply(bases, function(b) {
    if (counts[[b]] == 1) {
      return(b)
    }
    n <- seen[[b]] %||% 0
    seen[[b]] <<- n + 1
    paste0(b, bib_suffix(n))
  }, character(1), USE.NAMES = FALSE)
}

bib_escape <- function(s) {
  s <- gsub("\\", "\001", as.character(s), fixed = TRUE)
  s <- gsub("{", "\\{", s, fixed = TRUE)
  s <- gsub("}", "\\}", s, fixed = TRUE)
  gsub("\001", "\\textbackslash{}", s, fixed = TRUE)
}

protect_title <- function(t) {
  toks <- regmatches(t, gregexpr("\\s+|\\S+", t, perl = TRUE))[[1]]
  paste(vapply(toks, function(tok) {
    if (grepl("\\p{Lu}", tok, perl = TRUE)) paste0("{", bib_escape(tok), "}") else bib_escape(tok)
  }, character(1)), collapse = "")
}

bib_names <- function(people) {
  if (!is.list(people) || !is.null(names(people))) {
    return(NULL)
  }
  out <- character(0)
  for (p in people) {
    if (!is.list(p)) next
    if (!is.null(p$literal) && nzchar(p$literal)) {
      out <- c(out, paste0("{", bib_escape(p$literal), "}"))
      next
    }
    family <- as.character(p$family %||% "")
    particle <- as.character(p[["non-dropping-particle"]] %||% "")
    if (nzchar(particle) && nzchar(family)) family <- paste(particle, family)
    given <- as.character(p$given %||% "")
    if (nzchar(family) && nzchar(given)) {
      out <- c(out, paste0(bib_escape(family), ", ", bib_escape(given)))
    } else if (nzchar(family) || nzchar(given)) {
      out <- c(out, paste0("{", bib_escape(if (nzchar(family)) family else given), "}"))
    }
  }
  if (length(out) == 0) NULL else paste(out, collapse = " and ")
}

scalar_text <- function(v) {
  if (is.logical(v)) {
    return(if (v) "True" else "False")
  }
  if (is.double(v)) {
    return(if (v == floor(v)) sprintf("%.1f", v) else format(v, digits = 15))
  }
  as.character(v)
}

bibtex_entry <- function(item, key = bib_key(item)) {
  type <- bibtex_types[item$type %||% ""]
  if (is.na(type)) type <- "misc"
  fields <- list()
  add <- function(k, v) fields[[length(fields) + 1]] <<- c(k, v)
  a <- bib_names(item$author)
  if (!is.null(a)) add("author", a)
  e <- bib_names(item$editor)
  if (!is.null(e)) add("editor", e)
  if (!is.null(item$title) && nzchar(item$title)) add("title", protect_title(item$title))
  y <- bib_year(item)
  if (!is.null(y)) add("year", y)
  ct <- item[["container-title"]]
  if (!is.null(ct) && nzchar(ct)) add(if (type == "article") "journal" else "booktitle", protect_title(ct))
  for (k in names(bibtex_fields)) {
    v <- item[[k]]
    if (is.null(v) || identical(v, "") || (is.list(v) && length(v) == 0)) next
    add(bibtex_fields[[k]], bib_escape(if (is.list(v)) spdf_canonical_json(v) else scalar_text(v)))
  }
  body <- paste(vapply(fields, function(f) paste0("  ", f[1], " = {", f[2], "}"), character(1)), collapse = ",\n")
  paste0("@", type, "{", key, ",\n", body, "\n}\n")
}

#' Bibliographic exports
#'
#' `spdf_csl()` returns the CSL-JSON item of a document without the `spdf` member and
#' with `id` set to its BibTeX key (specification section 19); `spdf_csl_json()` the
#' CSL-JSON array that Zotero, Pandoc and citeproc import; `spdf_bibtex()` the BibTeX
#' entry. Both accept several documents or paths, and then disambiguate colliding keys
#' with `a`, `b`, `c`...
#'
#' @param ... `spdf_document` objects or paths to SPDF files.
#' @return A list (`spdf_csl()`) or a string.
#' @examples
#' doc <- spdf_open(system.file("extdata", "quijote.spdf", package = "spdf"))
#' cat(spdf_bibtex(doc))
#' spdf_csl(doc)$id
#' spdf_close(doc)
#' @export
spdf_csl <- function(...) {
  items <- lapply(as_metadata_list(list(...)), csl_base)
  keys <- bib_keys(items)
  out <- lapply(seq_along(items), function(i) c(list(id = keys[i]), items[[i]][names(items[[i]]) != "id"]))
  if (length(out) == 1) out[[1]] else out
}

#' @rdname spdf_csl
#' @export
spdf_csl_json <- function(...) {
  items <- lapply(as_metadata_list(list(...)), csl_base)
  keys <- bib_keys(items)
  json_text(lapply(seq_along(items), function(i) c(list(id = keys[i]), items[[i]][names(items[[i]]) != "id"])), pretty = TRUE)
}

#' @rdname spdf_csl
#' @export
spdf_bibtex <- function(...) {
  items <- lapply(as_metadata_list(list(...)), csl_base)
  keys <- bib_keys(items)
  paste(vapply(seq_along(items), function(i) bibtex_entry(items[[i]], keys[i]), character(1)), collapse = "\n")
}

as_metadata_list <- function(xs) {
  if (length(xs) == 1 && is.character(xs[[1]]) && length(xs[[1]]) > 1) xs <- as.list(xs[[1]])
  lapply(xs, function(x) {
    if (inherits(x, "spdf_document")) {
      return(spdf_metadata(x))
    }
    doc <- spdf_open(x)
    on.exit(spdf_close(doc))
    spdf_metadata(doc)
  })
}
