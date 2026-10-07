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

# First year of "issued" in decimal (negative years keep their sign), or NULL.
bib_year <- function(item) {
  y <- tryCatch(item$issued[["date-parts"]][[1]][[1]], error = function(e) NULL)
  if (is.null(y) || is.logical(y) || is.list(y)) {
    return(NULL)
  }
  if (is.numeric(y)) {
    return(format(trunc(y), scientific = FALSE))
  }
  if (is.character(y) && grepl("^\\s*-?[0-9]+\\s*$", y)) {
    return(as.character(as.integer(trimws(y))))
  }
  NULL
}

nz <- function(x) if (is.null(x) || identical(x, "") || identical(x, FALSE)) NULL else x

# Key (SPEC 19.1): first author's family, literal or given name, else the first word of
# title-short or title, folded to ASCII letters; "anon" if empty; then the year or "nd".
bib_key <- function(item) {
  base <- ""
  a <- if (is.list(item$author) && length(item$author) > 0) item$author[[1]] else NULL
  if (is.list(a)) base <- ascii_letters(nz(a$family) %||% nz(a$literal) %||% nz(a$given) %||% "")
  if (base == "") {
    title <- nz(item[["title-short"]]) %||% nz(item$title) %||% ""
    w <- strsplit(trimws(as.character(title)), "\\s+")[[1]]
    base <- if (length(w) > 0 && nzchar(w[1])) ascii_letters(w[1]) else ""
  }
  paste0(if (base == "") "anon" else base, bib_year(item) %||% "nd")
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
#' @param anchor,anchor_end Optional anchor (and end anchor) of a cited passage: the single
#'   exported item then carries the CSL `label` and `locator`.
#' @return A list (`spdf_csl()`) or a string.
#' @examples
#' doc <- spdf_open(system.file("extdata", "quijote.spdf", package = "spdf"))
#' cat(spdf_bibtex(doc))
#' spdf_csl(doc)$id
#' spdf_close(doc)
#' @export
spdf_csl <- function(..., anchor = NULL, anchor_end = NULL) {
  out <- csl_export(as_metadata_list(list(...)), anchor, anchor_end)
  if (length(out) == 1) out[[1]] else out
}

csl_export <- function(metas, anchor = NULL, anchor_end = NULL) {
  items <- lapply(metas, csl_base)
  keys <- bib_keys(items)
  out <- lapply(seq_along(items), function(i) c(list(id = keys[i]), items[[i]][names(items[[i]]) != "id"]))
  if (!is.null(anchor) && length(out) == 1) {
    ll <- csl_label_locator(anchor, anchor_end)
    if (!is.null(ll)) {
      out[[1]]$label <- ll[1]
      out[[1]]$locator <- ll[2]
    }
  }
  out
}

# CSL label and locator of an anchor (SPEC 19.2), or NULL.
csl_label_locator <- function(a, e = NULL) {
  t <- a$type %||% ""
  folio <- function(x) if (is.null(x$printed)) NULL else if (identical(x$source, "inferred")) paste0("[", x$printed, "]") else as.character(x$printed)
  if (t == "page" || (t %in% c("section", "web") && !is.null(a$printed))) {
    f <- folio(a)
    if (is.null(f)) return(NULL)
    label <- if (t == "page") switch(a$foliation %||% "page", leaf = "folio", column = "column", "page") else "page"
    if (!is.null(e) && identical(e$type, t) && !is.null(e$printed) && !identical(e$printed, a$printed)) {
      return(c(label, paste0(f, "-", folio(e))))
    }
    return(c(label, f))
  }
  if (t %in% c("section", "web")) {
    if (!is.null(a$paragraph)) return(c("paragraph", ntext(a$paragraph)))
    if (is.list(a$path) && length(a$path) > 0) return(c("section", as.character(a$path[[length(a$path)]])))
    return(NULL)
  }
  if (t == "time") {
    s <- cite_hms(a$t0)
    if (!is.null(e) && identical(e$type, "time")) s <- paste0(s, "-", cite_hms(e$t1))
    return(c("timestamp", s))
  }
  if (t == "verse") {
    to <- a$line_to
    return(c("verse", if (is.null(to) || isTRUE(to == a$line_from)) ntext(a$line_from) else paste0(ntext(a$line_from), "-", ntext(to))))
  }
  if (t == "canonical") return(c("section", as.character(a$ref)))
  if (t == "sheet") {
    return(c("line", if (isTRUE(a$row_from == a$row_to)) ntext(a$row_from) else paste0(ntext(a$row_from), "-", ntext(a$row_to))))
  }
  NULL
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
