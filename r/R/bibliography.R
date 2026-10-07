# Bibliographic exports: CSL-JSON and BibTeX.

bibtex_types <- c(
  book = "book", "article-journal" = "article", "article-magazine" = "article", "article-newspaper" = "article",
  article = "article", chapter = "incollection", "paper-conference" = "inproceedings", thesis = "phdthesis",
  report = "techreport", manuscript = "unpublished", "entry-encyclopedia" = "incollection",
  "entry-dictionary" = "incollection"
)
bibtex_fields <- c(
  publisher = "publisher", "publisher-place" = "address", "collection-title" = "series", volume = "volume",
  issue = "number", page = "pages", edition = "edition", DOI = "doi", ISBN = "isbn", URL = "url",
  language = "language", abstract = "abstract", "original-title" = "origtitle"
)

#' Bibliographic exports
#'
#' `spdf_csl()` returns the CSL-JSON item of the document (with its `id`; the `spdf`
#' extension object is dropped unless `extension = TRUE`); `spdf_csl_json()` the CSL-JSON
#' array that Zotero, Pandoc and citeproc import; `spdf_bibtex()` one BibTeX entry.
#'
#' @param doc A `spdf_document`.
#' @param extension Keep the `spdf` extension object.
#' @return A list (`spdf_csl()`) or a string.
#' @examples
#' doc <- spdf_open(system.file("extdata", "quijote.spdf", package = "spdf"))
#' cat(spdf_bibtex(doc))
#' spdf_close(doc)
#' @export
spdf_csl <- function(doc, extension = FALSE) {
  m <- spdf_metadata(doc)
  item <- c(list(id = doc_document(doc)$id), m[names(m) != "id"])
  if (!extension) item <- item[names(item) != "spdf"]
  item
}

#' @rdname spdf_csl
#' @export
spdf_csl_json <- function(doc) json_text(list(spdf_csl(doc)), pretty = TRUE)

bib_escape <- function(s) {
  map <- c("\\" = "\\textbackslash{}", "{" = "\\{", "}" = "\\}", "&" = "\\&", "%" = "\\%", "$" = "\\$",
           "#" = "\\#", "_" = "\\_", "~" = "\\textasciitilde{}", "^" = "\\textasciicircum{}")
  chars <- strsplit(s, "")[[1]]
  hit <- chars %in% names(map)
  chars[hit] <- map[chars[hit]]
  paste(chars, collapse = "")
}

bib_name <- function(p) {
  if (!is.list(p)) {
    return(NULL)
  }
  if (!is.null(p$literal)) {
    return(paste0("{", p$literal, "}"))
  }
  family <- trimws(paste(p[["non-dropping-particle"]] %||% "", p$family %||% ""))
  given <- trimws(paste(p$given %||% "", p[["dropping-particle"]] %||% ""))
  if (family == "" && given == "") {
    return(NULL)
  }
  if (family == "") given else if (given == "") family else paste0(family, ", ", given)
}

bib_ascii <- function(s) {
  s <- stringi::stri_trans_general(as.character(s), "Latin-ASCII")
  gsub("[^A-Za-z0-9]", "", s)
}

bib_key <- function(item) {
  first <- NULL
  for (k in c("author", "editor")) if (is.null(first) && is.list(item[[k]]) && length(item[[k]]) > 0) first <- item[[k]][[1]]
  who <- if (is.list(first)) first$family %||% first$literal %||% first$given %||% "" else ""
  year <- tryCatch(as.character(item$issued[["date-parts"]][[1]][[1]]), error = function(e) "")
  if (length(year) == 0) year <- ""
  words <- text_words(item$title %||% "")
  word <- words[nchar(words) > 3][1]
  key <- paste0(bib_ascii(who), year, if (is.na(word)) "" else bib_ascii(word))
  if (key == "") key <- bib_ascii(item$id %||% "spdf")
  if (key == "") "spdf" else key
}

#' @rdname spdf_csl
#' @export
spdf_bibtex <- function(doc) bibtex_entry(spdf_csl(doc))

bibtex_entry <- function(item) {
  type <- bibtex_types[item$type %||% ""]
  if (is.na(type)) type <- "misc"
  fields <- list()
  for (k in c("author", "editor", "translator")) {
    names_ <- unlist(lapply(item[[k]] %||% list(), bib_name))
    if (length(names_) > 0) fields[[k]] <- paste(names_, collapse = " and ")
  }
  if (!is.null(item$title)) fields$title <- item$title
  ct <- item[["container-title"]]
  if (is.character(ct) && nzchar(ct)) fields[[if (type == "article") "journal" else "booktitle"]] <- ct
  parts <- tryCatch(item$issued[["date-parts"]][[1]], error = function(e) NULL)
  if (length(parts) >= 1) fields$year <- as.character(parts[[1]])
  if (length(parts) >= 2) fields$month <- as.character(parts[[2]])
  for (k in names(bibtex_fields)) {
    v <- item[[k]]
    if (!is.null(v) && !is.list(v) && nzchar(as.character(v))) fields[[bibtex_fields[[k]]]] <- as.character(v)
  }
  if (type == "phdthesis" && !is.null(fields$publisher)) {
    fields$school <- fields$publisher
    fields$publisher <- NULL
  }
  if (type == "techreport" && !is.null(fields$publisher)) {
    fields$institution <- fields$publisher
    fields$publisher <- NULL
  }
  if (!is.null(fields$pages)) fields$pages <- gsub("(?<=[0-9])\\s*[-\u2013]\\s*(?=[0-9])", "--", fields$pages, perl = TRUE)
  lines <- paste0("@", type, "{", bib_key(item), ",")
  for (k in names(fields)) {
    v <- if (k %in% c("url", "doi")) fields[[k]] else bib_escape(fields[[k]])
    lines <- c(lines, paste0("  ", k, " = {", v, "},"))
  }
  paste0(paste(c(lines, "}"), collapse = "\n"), "\n")
}
