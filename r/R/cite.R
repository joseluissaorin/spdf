# Short author-date citation "(Names, Year, locator)" (specification section 10).

cite_vowels <- c("a", "e", "i", "o", "u", "\u00e1", "\u00e9", "\u00ed", "\u00f3", "\u00fa", "\u00fc")

cite_name <- function(a) {
  if (!is.list(a)) {
    return("")
  }
  if (is.character(a$literal) && nzchar(a$literal)) {
    return(a$literal)
  }
  if (is.character(a$family) && nzchar(a$family)) {
    ndp <- a[["non-dropping-particle"]]
    return(paste0(if (is.character(ndp) && nzchar(ndp)) paste0(ndp, " ") else "", a$family))
  }
  if (is.null(a$given)) "" else as.character(a$given)
}

i_sound <- function(s) {
  low <- tolower_u(s)
  chars <- strsplit(low, "")[[1]]
  two <- paste(chars[seq_len(min(2, length(chars)))], collapse = "")
  rest <- if (two %in% c("hi", "h\u00ed")) chars[-(1:2)] else if (length(chars) > 0 && chars[1] %in% c("i", "\u00ed")) chars[-1] else NULL
  if (is.null(rest)) {
    return(FALSE)
  }
  !(length(rest) > 0 && rest[1] %in% cite_vowels)
}

cite_hms <- function(t) {
  s <- floor(as.numeric(t))
  h <- s %/% 3600
  m <- (s %% 3600) %/% 60
  x <- s %% 60
  if (h > 0) sprintf("%d:%02d:%02d", as.integer(h), as.integer(m), as.integer(x)) else sprintf("%d:%02d", as.integer(m), as.integer(x))
}

ntext <- function(x) {
  if (is.numeric(x)) format(x, scientific = FALSE, trim = TRUE, digits = 15) else as.character(x)
}

cite_label <- function(a) {
  p <- a$printed
  if (is.null(p)) {
    return(NULL)
  }
  if (identical(a$source, "inferred")) paste0("[", p, "]") else as.character(p)
}

# An end without a printed folio never takes part in a range (SPEC 18.1).
cite_page <- function(a, e, es, one, many) {
  ends <- list(a)
  if (!is.null(e) && identical(e$type, a$type)) ends[[2]] <- e
  with_folio <- Filter(function(x) !is.null(x$printed), ends)
  if (length(with_folio) == 0) {
    return(if (es) "s. p." else "n. pag.")
  }
  first <- with_folio[[1]]
  last <- with_folio[[length(with_folio)]]
  if (length(with_folio) > 1 && !identical(last$printed, first$printed)) {
    return(paste0(many, " ", cite_label(first), "-", cite_label(last)))
  }
  paste0(one, " ", cite_label(first))
}

cite_locator <- function(a, e, es) {
  t <- a$type %||% ""
  if (t == "page") {
    fol <- a$foliation %||% "page"
    lab <- switch(fol, leaf = c("fol.", "fols."), column = c("col.", "cols."), c("p.", "pp."))
    return(cite_page(a, e, es, lab[1], lab[2]))
  }
  if (t == "time") {
    s <- cite_hms(a$t0)
    if (!is.null(e) && identical(e$type, "time")) s <- paste0(s, "-", cite_hms(e$t1))
    return(s)
  }
  if (t %in% c("section", "web")) {
    if (!is.null(a$printed)) {
      return(cite_page(a, e, es, "p.", "pp."))
    }
    parts <- character(0)
    if (is.list(a$path) && length(a$path) > 0) parts <- c(parts, paste0("\u00a7 ", a$path[[length(a$path)]]))
    if (!is.null(a$paragraph)) parts <- c(parts, paste0(if (es) "p\u00e1rr. " else "para. ", ntext(a$paragraph)))
    return(if (length(parts) == 0) NULL else paste(parts, collapse = ", "))
  }
  if (t == "slide") {
    return(paste0(if (es) "diap. " else "slide ", ntext(a$n)))
  }
  if (t == "sheet") {
    if (isTRUE(a$row_from == a$row_to)) {
      return(paste0(a$sheet, ", ", if (es) "fila " else "row ", ntext(a$row_from)))
    }
    return(paste0(a$sheet, ", ", if (es) "filas " else "rows ", ntext(a$row_from), "-", ntext(a$row_to)))
  }
  if (t == "verse") {
    to <- a$line_to
    return(if (is.null(to) || isTRUE(to == a$line_from)) paste0("v. ", ntext(a$line_from)) else paste0("vv. ", ntext(a$line_from), "-", ntext(to)))
  }
  if (t == "canonical") {
    return(a$ref)
  }
  NULL
}

cite_year <- function(m, es) {
  y <- tryCatch(m$issued[["date-parts"]][[1]][[1]], error = function(e) NULL)
  if (is.character(y) && grepl("^-?[0-9]+$", y)) y <- as.numeric(y)
  if (!is.numeric(y) || length(y) != 1) {
    return(if (es) "s. f." else "n.d.")
  }
  y <- trunc(y)
  if (y > 0) format(y, scientific = FALSE) else paste0(format(-y, scientific = FALSE), if (es) " a. C." else " BC")
}

#' Short citation of an anchor
#'
#' Author-date citation `(Names, Year, locator)` as the specification defines it
#' (section 10): one, two (`y`/`e` in Spanish, `and` in English) or more authors
#' (`et al.`), `s. f.`/`n.d.` without a year, and a locator for every anchor type
#' (`p. 145`, `p. [21]` for inferred folios, `fol. 1r`, `1:09:20`, `diap. 3`...).
#'
#' @param metadata A CSL-JSON item (a list), e.g. `spdf_metadata(doc)`.
#' @param anchor An anchor (a named list).
#' @param anchor_end Optional end anchor.
#' @param locale `"es"` or `"en"`; other locales fall back to English.
#' @return A string.
#' @examples
#' m <- list(type = "book", title = "El ingenioso hidalgo", author = list(list(family = "Cervantes")),
#'           issued = list("date-parts" = list(list(1605))))
#' spdf_cite(m, list(type = "page", physical = 10, printed = "4", source = "inferred"))
#' spdf_cite(m, list(type = "time", t0 = 4160, t1 = 4175.5), locale = "en")
#' @export
spdf_cite <- function(metadata, anchor, anchor_end = NULL, locale = "es") {
  es <- tolower(strsplit(gsub("_", "-", locale), "-", fixed = TRUE)[[1]][1]) == "es"
  names_ <- vapply(metadata$author %||% list(), cite_name, character(1))
  names_ <- names_[nzchar(names_)]
  who <- if (length(names_) == 0) {
    ts <- metadata[["title-short"]]
    if (is.character(ts) && nzchar(ts)) ts else trimws(strsplit(paste0(metadata$title %||% "", ":"), ":", fixed = TRUE)[[1]][1])
  } else if (length(names_) == 1) {
    names_[1]
  } else if (length(names_) == 2) {
    paste0(names_[1], if (es) (if (i_sound(names_[2])) " e " else " y ") else " and ", names_[2])
  } else {
    paste0(names_[1], " et al.")
  }
  parts <- c(who, cite_year(metadata, es))
  loc <- if (is.null(anchor)) NULL else cite_locator(anchor, anchor_end, es)
  if (!is.null(loc) && nzchar(loc)) parts <- c(parts, loc)
  paste0("(", paste(parts, collapse = ", "), ")")
}
