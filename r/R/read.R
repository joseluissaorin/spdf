# Reading API: metadata, units, fragments... as lists and tibbles; canonical dump.

# A list of row lists -> tibble. JSON columns become list-columns; scalar columns
# become atomic vectors with NA for null.
rows_to_tibble <- function(rows, cols, json_cols = character(0)) {
  out <- lapply(cols, function(c) {
    vals <- lapply(rows, function(r) r[[c]])
    is_scalar <- vapply(vals, function(v) is.null(v) || (is.atomic(v) && length(v) == 1), logical(1))
    if (c %in% json_cols || !all(is_scalar)) {
      return(vals)
    }
    nonnull <- Filter(Negate(is.null), vals)
    if (length(nonnull) == 0) {
      return(rep(NA, length(vals)))
    }
    proto <- nonnull[[1]]
    na <- if (is.character(proto)) NA_character_ else if (is.logical(proto)) NA else NA_real_
    unlist(lapply(vals, function(v) if (is.null(v)) na else v))
  })
  names(out) <- cols
  tibble::as_tibble(out)
}

#' Read the parts of a SPDF document
#'
#' Accessors for an open [spdf_document][spdf_open]. Tables come back as tibbles with
#' the 5.0 column names (legacy files are mapped); JSON columns (`anchor`, `notes`,
#' `section`...) are list-columns of parsed values.
#'
#' @param doc A `spdf_document` from [spdf_open()].
#' @return `spdf_meta()`: a named list; `spdf_metadata()`: the CSL-JSON item (a list);
#'   `spdf_title()`: a string; `spdf_info()`: a one-row tibble; the others: tibbles.
#' @examples
#' doc <- spdf_open(system.file("extdata", "quijote.spdf", package = "spdf"))
#' spdf_info(doc)
#' spdf_units(doc)
#' spdf_fragments(doc)[, c("id", "text")]
#' spdf_close(doc)
#' @name spdf_read
NULL

#' @rdname spdf_read
#' @export
spdf_meta <- function(doc) {
  check_open(doc)
  rows <- doc_rows(doc, "spdf_meta", "ORDER BY {key}")
  out <- lapply(rows, function(r) r$value)
  names(out) <- vapply(rows, function(r) r$key, character(1))
  json_object(out)
}

doc_document <- function(doc) {
  if (is.null(doc$cache$document)) {
    rows <- doc_rows(doc, "documents", "ORDER BY {id} LIMIT 2")
    if (length(rows) != 1) spdf_abort("E013", "documents must hold exactly one row")
    doc$cache$document <- rows[[1]]
  }
  doc$cache$document
}

#' @rdname spdf_read
#' @export
spdf_metadata <- function(doc) {
  check_open(doc)
  m <- doc_document(doc)$metadata
  if (json_is_object(m)) m else list()
}

#' @rdname spdf_read
#' @export
spdf_title <- function(doc) {
  m <- spdf_metadata(doc)
  if (is.character(m$title)) m$title else doc_document(doc)$title
}

doc_year <- function(m) {
  y <- tryCatch(m$issued[["date-parts"]][[1]][[1]], error = function(e) NULL)
  if (is.null(y)) NA_integer_ else suppressWarnings(as.integer(y))
}

#' @rdname spdf_read
#' @export
spdf_info <- function(doc) {
  check_open(doc)
  d <- doc_document(doc)
  m <- spdf_metadata(doc)
  authors <- vapply(m$author %||% list(), function(a) a$family %||% a$literal %||% a$given %||% "", character(1))
  tibble::tibble(
    id = d$id, version = doc$version, legacy = doc$legacy, kind = d$kind,
    title = spdf_title(doc), authors = paste(authors, collapse = "; "), year = doc_year(m),
    language = d$language %||% NA_character_, units = length(doc_rows(doc, "units", only = "id")),
    fragments = length(doc_rows(doc, "fragments", only = "n")), docref = spdf_docref(doc)
  )
}

#' @rdname spdf_read
#' @export
spdf_docref <- function(doc) {
  d <- doc_document(doc)
  h <- tolower(d$source_sha256 %||% "")
  if (grepl("^[0-9a-f]{64}$", h)) paste0("sha256-", h) else as.character(d$id)
}

doc_units <- function(doc) {
  rows <- doc_rows(doc, "units", "ORDER BY {ord}, {id}")
  if (doc$legacy) {
    for (i in seq_along(rows)) rows[[i]]$ord <- i
  }
  rows
}

strip_document <- function(rows) lapply(rows, function(r) r[names(r) != "document"])

#' @rdname spdf_read
#' @export
spdf_units <- function(doc) {
  check_open(doc)
  rows_to_tibble(strip_document(doc_units(doc)), setdiff(spdf_columns$units, "document"), c("anchor", "notes", "words"))
}

#' @rdname spdf_read
#' @export
spdf_fragments <- function(doc) {
  check_open(doc)
  rows_to_tibble(strip_document(doc_rows(doc, "fragments", "ORDER BY {n}")), setdiff(spdf_columns$fragments, "document"),
                 c("section", "anchor", "anchor_end"))
}

#' @rdname spdf_read
#' @export
spdf_sections <- function(doc) {
  check_open(doc)
  rows_to_tibble(strip_document(doc_rows(doc, "sections", "ORDER BY {id}")), setdiff(spdf_columns$sections, "document"))
}

#' @rdname spdf_read
#' @export
spdf_figures <- function(doc) {
  check_open(doc)
  rows_to_tibble(strip_document(doc_rows(doc, "figures", "ORDER BY {id}")), setdiff(spdf_columns$figures, "document"), "anchor")
}

#' @rdname spdf_read
#' @export
spdf_spaces <- function(doc) {
  check_open(doc)
  rows_to_tibble(doc_rows(doc, "spaces", "ORDER BY {id}"), spdf_columns$spaces, c("modalities", "task_prefixes"))
}

#' @rdname spdf_read
#' @export
spdf_blobs <- function(doc) {
  check_open(doc)
  rows_to_tibble(doc_blobs(doc), c("key", "mime", "bytes", "sha256"))
}

doc_blobs <- function(doc) {
  lapply(doc_rows(doc, "blobs", "ORDER BY {key}", only = c("key", "mime", "data")), function(r) {
    data <- r$data %||% raw(0)
    list(key = r$key, mime = r$mime, bytes = length(data), sha256 = sha256_hex(data))
  })
}

sha256_hex <- function(x) {
  if (is.character(x)) x <- charToRaw(enc2utf8(x))
  paste(as.character(unclass(openssl::sha256(x))), collapse = "")
}

#' @rdname spdf_read
#' @param key Blob key, with or without the `blob:` prefix.
#' @export
spdf_blob <- function(doc, key) {
  check_open(doc)
  key <- sub("^blob:", "", key)
  r <- doc_rows(doc, "blobs", "WHERE {key} = ?", params = list(key), only = "data")
  if (length(r) == 0) NULL else r[[1]]$data
}

doc_provenance <- function(doc) {
  rows <- strip_document(doc_rows(doc, "provenance"))
  if (length(rows) == 0) {
    return(rows)
  }
  keys <- vapply(rows, function(r) {
    paste(as.character(charToRaw(enc2utf8(spdf_canonical_json(r)))), collapse = "")
  }, character(1))
  rows[order(keys, method = "radix")]
}

#' @rdname spdf_read
#' @export
spdf_provenance <- function(doc) {
  check_open(doc)
  rows_to_tibble(doc_provenance(doc), c("stage", "provider", "model", "detail", "ms", "at"), "detail")
}

#' @rdname spdf_read
#' @param space Vector space id, for example `"embeddinggemma-2@768"`.
#' @param target `"fragment"` (default), `"unit"` or `"figure"`.
#' @return `spdf_vectors()`: a numeric matrix with one row per vector (row names are ids).
#' @export
spdf_vectors <- function(doc, space, target = "fragment") {
  check_open(doc)
  sp <- doc_space(doc, space)
  t <- if (doc$legacy) names(legacy_targets)[legacy_targets == target] %|na|% target else target
  rows <- doc_rows(doc, "vectors", "WHERE {space} = ? AND {target} = ? ORDER BY {id}", params = list(space, t), only = c("id", "data"))
  if (length(rows) == 0) {
    return(matrix(numeric(0), nrow = 0, ncol = sp$dims))
  }
  m <- do.call(rbind, lapply(rows, function(r) spdf_vector_decode(r$data, sp$dtype)))
  rownames(m) <- vapply(rows, function(r) r$id, character(1))
  m
}

doc_space <- function(doc, space) {
  r <- doc_rows(doc, "spaces", "WHERE {id} = ?", params = list(space))
  if (length(r) == 0) spdf_abort("E031", paste("unknown vector space", space))
  r[[1]]
}

doc_fts <- function(doc) {
  name <- if (doc$legacy) "fragmentos_fts" else "fragments_fts"
  sql <- DBI::dbGetQuery(doc$con, "SELECT sql FROM sqlite_master WHERE name = ?", params = list(name))$sql
  tok <- if (length(sql) == 0 || is.na(sql)) NULL else {
    m <- regmatches(sql, regexec("(?i)tokenize\\s*=\\s*(?:'((?:[^']|'')*)'|\"((?:[^\"]|\"\")*)\"|([A-Za-z0-9_]+))", sql, perl = TRUE))[[1]]
    if (length(m) == 0) "unicode61" else {
      raw <- if (nzchar(m[4])) m[4] else if (nzchar(m[3])) gsub("\"\"", "\"", m[3], fixed = TRUE) else gsub("''", "'", m[2], fixed = TRUE)
      paste(strsplit(trimws(raw), "\\s+")[[1]], collapse = " ")
    }
  }
  list(tokenizer = tok, trigram = "fragments_fts_trigram" %in% doc$tables)
}

doc_vector_digests <- function(doc) {
  name <- doc_table_name(doc, "vectors")
  if (is.null(name)) {
    return(json_object())
  }
  sql <- paste("SELECT", doc_select_list(doc, "vectors", c("target", "id", "space", "data")), "FROM", quote_ident(name),
               "ORDER BY", doc_physical(doc, "vectors", "{space}, {target}, {id}"))
  df <- DBI::dbGetQuery(doc$con, sql)
  if (nrow(df) == 0) {
    return(json_object())
  }
  out <- list()
  for (s in unique(df$space)) {
    idx <- which(df$space == s)
    data <- unlist(lapply(idx, function(i) df$data[[i]]), use.names = FALSE)
    if (is.null(data)) data <- raw(0)
    out[[s]] <- list(count = length(idx), sha256 = sha256_hex(as.raw(data)))
  }
  out
}

#' Canonical dump of a SPDF document
#'
#' The conformance oracle of the specification (section 5): one JSON value with every
#' table, JSON columns parsed, floats rounded to 6 decimals, vectors summarized by count
#' and SHA-256, blobs by size and SHA-256. Legacy files are dumped through the 5.0 view
#' with `"legacy": true`.
#'
#' @param doc A `spdf_document`.
#' @return `spdf_dump()`: a list; `spdf_dump_json()`: its RFC 8785 serialization;
#'   `spdf_content_sha256()`: the hash used by `spdf_meta.content_sha256`.
#' @examples
#' doc <- spdf_open(system.file("extdata", "minimo.spdf", package = "spdf"))
#' substr(spdf_dump_json(doc), 1, 120)
#' spdf_content_sha256(doc)
#' spdf_close(doc)
#' @export
spdf_dump <- function(doc) {
  check_open(doc)
  d <- doc_document(doc)
  meta <- spdf_meta(doc)
  document <- lapply(spdf_columns$documents, function(c) d[[c]])
  names(document) <- spdf_columns$documents
  out <- list(
    spdf_version = if (doc$legacy) meta$spdf_version %||% doc$version else meta$spdf_version,
    meta = meta,
    fts = doc_fts(doc),
    document = document,
    units = strip_document(doc_units(doc)),
    sections = strip_document(doc_rows(doc, "sections", "ORDER BY {id}")),
    fragments = strip_document(doc_rows(doc, "fragments", "ORDER BY {n}")),
    figures = strip_document(doc_rows(doc, "figures", "ORDER BY {id}")),
    spaces = doc_rows(doc, "spaces", "ORDER BY {id}"),
    vectors = doc_vector_digests(doc),
    blobs = doc_blobs(doc),
    provenance = doc_provenance(doc),
    extensions = doc_rows(doc, "extensions", "ORDER BY {name}")
  )
  if (is.null(out$spdf_version)) out["spdf_version"] <- list(NULL)
  if (doc$legacy) out$legacy <- TRUE
  json_canon(out)
}

#' @rdname spdf_dump
#' @export
spdf_dump_json <- function(doc) spdf_canonical_json(spdf_dump(doc))

#' @rdname spdf_dump
#' @export
spdf_content_sha256 <- function(doc) {
  d <- spdf_dump(doc)
  d$meta <- json_object(d$meta[!(names(d$meta) %in% c("content_sha256", "signature", "signer"))])
  sha256_hex(spdf_canonical_json(d))
}
