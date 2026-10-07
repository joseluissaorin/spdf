# Opening and reading SPDF files (5.0 and legacy 4.x through the 5.0 view).

spdf_application_id <- 1397769286
spdf_columns <- list(
  spdf_meta = c("key", "value"),
  documents = c("id", "kind", "metadata", "source_sha256", "source_ref", "mime", "bytes", "unit_count", "duration",
                "created", "updated", "title", "authors", "year", "language", "rights"),
  units = c("id", "document", "ord", "anchor", "text", "notes", "header", "footer", "image", "thumbnail", "reader",
            "confidence", "printed", "t0", "t1", "words"),
  sections = c("id", "document", "parent", "level", "title", "unit_from", "unit_to", "summary"),
  fragments = c("n", "id", "document", "unit", "ord", "text", "context", "section", "anchor", "anchor_end", "search_text"),
  figures = c("id", "document", "unit", "image", "caption", "description", "anchor"),
  spaces = c("id", "provider", "model", "version", "dims", "dtype", "normalized", "truncated_from", "modalities",
             "task_prefixes", "created"),
  vectors = c("target", "id", "space", "document", "data"),
  blobs = c("key", "mime", "sha256", "data"),
  provenance = c("document", "stage", "provider", "model", "detail", "ms", "at"),
  extensions = c("name", "version", "required")
)
spdf_json_columns <- list(
  documents = c("metadata", "rights"), units = c("anchor", "notes", "words"),
  fragments = c("section", "anchor", "anchor_end"), figures = "anchor",
  spaces = c("modalities", "task_prefixes"), provenance = "detail"
)
legacy_triggers <- c("fragmentos_ai", "fragmentos_ad", "fragmentos_au")
known_extensions <- character(0)

quote_ident <- function(x) paste0("\"", gsub("\"", "\"\"", x, fixed = TRUE), "\"")

#' Open a SPDF file
#'
#' Opens a SPDF 5.0 file, or a legacy 4.0/4.1 file (usually gzip-wrapped) seen through
#' the 5.0 view. Files are untrusted input: the connection is read-only with
#' `query_only` and `trusted_schema=OFF`, triggers, views and foreign virtual tables
#' are refused (except the three FTS triggers of legacy files), blob sizes and gzip
#' inflation are bounded, and WAL-mode files are copied before opening.
#'
#' @param path Path to the file.
#' @param max_blob_bytes Largest blob accepted (default 512 MiB).
#' @param max_inflated_bytes Largest size a gzip-wrapped file may expand to (default 4 GiB).
#' @return An object of class `spdf_document`; close it with [spdf_close()].
#' @examples
#' doc <- spdf_open(system.file("extdata", "quijote.spdf", package = "spdf"))
#' doc
#' spdf_close(doc)
#' @export
spdf_open <- function(path, max_blob_bytes = 512 * 1024^2, max_inflated_bytes = 4 * 1024^3) {
  doc <- container_open(path, max_blob_bytes, max_inflated_bytes, strict = TRUE)
  tryCatch(
    {
      for (e in doc_rows(doc, "extensions", "ORDER BY {name}")) {
        if (!is.null(e$required) && e$required != 0 && !(e$name %in% known_extensions)) {
          spdf_abort("E060", paste("the file requires the unknown extension", e$name))
        }
      }
    },
    error = function(err) {
      spdf_close(doc)
      stop(err)
    }
  )
  doc
}

#' Close a SPDF document
#'
#' @param doc A `spdf_document`.
#' @return `doc`, invisibly.
#' @export
spdf_close <- function(doc) {
  if (!is.null(doc$con)) {
    con <- doc$con
    doc$con <- NULL
    if (isTRUE(tryCatch(DBI::dbIsValid(con), error = function(e) FALSE))) {
      suppressWarnings(try(DBI::dbDisconnect(con), silent = TRUE))
    }
  }
  if (!is.null(doc$temp)) {
    unlink(doc$temp)
    doc$temp <- NULL
  }
  invisible(doc)
}

#' @export
print.spdf_document <- function(x, ...) {
  if (is.null(x$con)) {
    cat("<spdf_document (closed)>\n")
    return(invisible(x))
  }
  cat("<spdf_document ", x$version, if (x$legacy) " legacy" else "", ">\n", sep = "")
  cat("  ", spdf_title(x), "\n", sep = "")
  cat("  ", spdf_cite(spdf_metadata(x), list(type = "image")), "\n", sep = "")
  invisible(x)
}

container_open <- function(path, max_blob_bytes, max_inflated_bytes, strict) {
  doc <- new.env(parent = emptyenv())
  class(doc) <- "spdf_document"
  doc$legacy <- FALSE
  doc$gzipped <- FALSE
  doc$forbidden <- list()
  doc$cache <- new.env(parent = emptyenv())
  reg.finalizer(doc, function(e) spdf_close(e), onexit = TRUE)
  if (!file.exists(path) || dir.exists(path)) {
    spdf_abort("E001", paste("cannot read file:", path))
  }
  real <- normalizePath(path)
  head <- readBin(real, "raw", 100)
  if (length(head) >= 2 && head[1] == as.raw(0x1f) && head[2] == as.raw(0x8b)) {
    doc$gzipped <- TRUE
    real <- inflate_to_temp(doc, real, max_inflated_bytes)
    head <- readBin(real, "raw", 100)
  }
  magic <- c(charToRaw("SQLite format 3"), as.raw(0))
  if (length(head) < 100 || !identical(head[1:16], magic)) {
    spdf_close(doc)
    spdf_abort("E001", "not a SQLite database (nor gzip-wrapped SQLite)")
  }
  if (head[19] == as.raw(2) || head[20] == as.raw(2)) {
    if (is.null(doc$temp)) {
      tmp <- tempfile(fileext = ".sqlite")
      file.copy(real, tmp)
      doc$temp <- tmp
      real <- tmp
    }
    con <- file(real, "r+b")
    seek(con, 18, rw = "write")
    writeBin(as.raw(c(1, 1)), con)
    close(con)
  }
  master <- tryCatch(
    {
      doc$con <- DBI::dbConnect(RSQLite::SQLite(), real, flags = RSQLite::SQLITE_RO, bigint = "numeric")
      DBI::dbExecute(doc$con, "PRAGMA query_only = 1")
      DBI::dbExecute(doc$con, "PRAGMA trusted_schema = OFF")
      DBI::dbExecute(doc$con, "PRAGMA cell_size_check = ON")
      DBI::dbGetQuery(doc$con, "SELECT type, name, sql FROM sqlite_master")
    },
    error = function(e) {
      spdf_close(doc)
      spdf_abort("E001", paste("SQLite cannot read this file:", conditionMessage(e)))
    }
  )
  doc$application_id <- as.numeric(DBI::dbGetQuery(doc$con, "PRAGMA application_id")[[1]])
  doc$user_version <- as.numeric(DBI::dbGetQuery(doc$con, "PRAGMA user_version")[[1]])
  doc$tables <- master$name[master$type == "table"]
  tryCatch(detect_version(doc), error = function(e) {
    spdf_close(doc)
    stop(e)
  })
  allowed <- if (doc$legacy) "fragmentos_fts" else c("fragments_fts", "fragments_fts_trigram")
  for (i in seq_len(nrow(master))) {
    type <- master$type[i]
    name <- master$name[i]
    sql <- master$sql[i]
    if (is.na(sql)) sql <- ""
    if (type == "table" && grepl("^\\s*CREATE\\s+VIRTUAL\\s+TABLE", sql, ignore.case = TRUE) &&
      (!(name %in% allowed) || !grepl("USING\\s+fts5\\s*\\(", sql, ignore.case = TRUE))) {
      doc$forbidden[[length(doc$forbidden) + 1]] <- list(type = "virtual table", name = name)
      next
    }
    if (type %in% c("trigger", "view") && !(doc$legacy && type == "trigger" && name %in% legacy_triggers)) {
      doc$forbidden[[length(doc$forbidden) + 1]] <- list(type = type, name = name)
    }
  }
  if (strict && length(doc$forbidden) > 0) {
    f <- doc$forbidden[[1]]
    spdf_close(doc)
    spdf_abort("E020", sprintf("the file contains a %s (%s); refusing to open it", f$type, f$name))
  }
  if (strict) {
    checks <- if (doc$legacy) c(blobs = "datos", vectores = "valores") else c(blobs = "data", vectors = "data")
    for (t in names(checks)) {
      if (!(t %in% doc$tables)) next
      mx <- DBI::dbGetQuery(doc$con, sprintf("SELECT coalesce(max(length(%s)), 0) AS m FROM %s", checks[[t]], t))$m
      if (mx > max_blob_bytes) {
        spdf_close(doc)
        spdf_abort("E001", sprintf("a blob in %s is %.0f bytes, above the limit of %.0f", t, mx, max_blob_bytes))
      }
    }
  }
  doc
}

detect_version <- function(doc) {
  uv <- doc$user_version
  if (doc$application_id == spdf_application_id) {
    if (uv >= 500 && uv <= 599) {
      doc$version <- sprintf("%d.%d", uv %/% 100, (uv %% 100) %/% 10)
      return(invisible())
    }
  } else if (all(c("spdf", "documentos") %in% doc$tables)) {
    v <- tryCatch(DBI::dbGetQuery(doc$con, "SELECT valor FROM spdf WHERE clave = 'spdf_version'")$valor, error = function(e) NULL)
    if (length(v) == 1 && !is.na(v) && startsWith(as.character(v), "4.")) {
      doc$legacy <- TRUE
      doc$version <- as.character(v)
      return(invisible())
    }
    if (uv %in% c(400, 410)) {
      doc$legacy <- TRUE
      doc$version <- sprintf("%d.%d", uv %/% 100, (uv %% 100) %/% 10)
      return(invisible())
    }
  }
  spdf_abort("E002", sprintf("unknown application_id or user_version (%.0f, %.0f)", doc$application_id, uv))
}

inflate_to_temp <- function(doc, path, limit) {
  tmp <- tempfile(fileext = ".sqlite")
  doc$temp <- tmp
  inp <- gzfile(path, "rb")
  out <- file(tmp, "wb")
  on.exit({
    close(inp)
    close(out)
  })
  total <- 0
  repeat {
    chunk <- tryCatch(readBin(inp, "raw", 1048576), error = function(e) spdf_abort("E001", paste("bad gzip:", conditionMessage(e))))
    if (length(chunk) == 0) break
    total <- total + length(chunk)
    if (total > limit) spdf_abort("E001", sprintf("inflated size exceeds the limit of %.0f bytes", limit))
    writeBin(chunk, out)
  }
  tmp
}

doc_table_name <- function(doc, table) {
  name <- if (doc$legacy) legacy_tables[[table]][[1]] else table
  if (!is.na(name) && name %in% doc$tables) name else NULL
}

doc_columns <- function(doc, table) {
  if (!(table %in% doc$tables)) {
    return(character(0))
  }
  DBI::dbGetQuery(doc$con, paste0("PRAGMA table_info(", quote_ident(table), ")"))$name
}

doc_select_list <- function(doc, table, only = NULL) {
  name <- doc_table_name(doc, table)
  existing <- if (is.null(name)) character(0) else doc_columns(doc, name)
  cols <- spdf_columns[[table]]
  if (!is.null(only)) cols <- cols[cols %in% only]
  parts <- vapply(cols, function(col) {
    expr <- if (doc$legacy) {
      old <- legacy_column(table, col)
      if (!is.null(old) && old %in% existing) quote_ident(old) else (legacy_defaults[paste0(table, ".", col)] %|na|% "NULL")
    } else if (col %in% existing) quote_ident(col) else "NULL"
    paste(expr, "AS", quote_ident(col))
  }, character(1))
  paste(parts, collapse = ", ")
}

`%|na|%` <- function(a, b) if (is.null(a) || is.na(a)) b else unname(a)

doc_physical <- function(doc, table, sql) {
  m <- gregexpr("\\{[a-z_0-9]+\\}", sql)[[1]]
  if (m[1] == -1) {
    return(sql)
  }
  keys <- regmatches(sql, list(m))[[1]]
  for (k in unique(keys)) {
    col <- substr(k, 2, nchar(k) - 1)
    rep <- if (doc$legacy) {
      old <- legacy_column(table, col)
      if (is.null(old)) "NULL" else quote_ident(old)
    } else quote_ident(col)
    sql <- gsub(k, rep, sql, fixed = TRUE)
  }
  sql
}

# Rows of a 5.0 table through the view, as a list of named lists (NULL for SQL NULL).
doc_rows <- function(doc, table, tail = "", params = NULL, only = NULL) {
  name <- doc_table_name(doc, table)
  if (is.null(name)) {
    return(list())
  }
  sql <- paste("SELECT", doc_select_list(doc, table, only), "FROM", quote_ident(name))
  if (nzchar(tail)) sql <- paste(sql, doc_physical(doc, table, tail))
  df <- if (is.null(params)) DBI::dbGetQuery(doc$con, sql) else DBI::dbGetQuery(doc$con, sql, params = params)
  if (nrow(df) == 0) {
    return(list())
  }
  cols <- names(df)
  lapply(seq_len(nrow(df)), function(i) {
    row <- lapply(cols, function(c) {
      v <- df[[c]][[i]]
      if (is.raw(v)) {
        return(v)
      }
      if (length(v) == 0 || is.na(v)) NULL else v
    })
    names(row) <- cols
    map_row(doc, table, row)
  })
}

map_row <- function(doc, table, r) {
  for (c in spdf_json_columns[[table]]) {
    if (c %in% names(r) && !is.null(r[[c]])) r[c] <- list(json_column(r[[c]]))
  }
  if (!doc$legacy) {
    return(r)
  }
  set <- function(r, k, v) {
    r[k] <- list(v)
    r
  }
  switch(table,
    spdf_meta = {
      r$key <- map_value(legacy_meta_keys, r$key)
    },
    documents = {
      tipo <- r$kind
      r <- set(r, "kind", map_value(legacy_kinds, tipo))
      if ("metadata" %in% names(r)) r <- set(r, "metadata", legacy_metadata(r$metadata, tipo))
      if ("source_ref" %in% names(r)) r <- set(r, "source_ref", legacy_reference(r$source_ref, blob_keys(doc)))
    },
    units = {
      for (k in c("image", "thumbnail")) if (k %in% names(r)) r <- set(r, k, legacy_reference(r[[k]], blob_keys(doc)))
      if ("anchor" %in% names(r)) r <- set(r, "anchor", legacy_anchor(r$anchor))
    },
    fragments = {
      for (k in c("anchor", "anchor_end")) if (k %in% names(r)) r <- set(r, k, legacy_anchor(r[[k]]))
    },
    figures = {
      if ("image" %in% names(r)) r <- set(r, "image", legacy_reference(r$image, blob_keys(doc), keep_empty = TRUE))
      if ("anchor" %in% names(r)) r <- set(r, "anchor", legacy_anchor(r$anchor))
    },
    spaces = {
      if (is.list(r$modalities)) r$modalities <- lapply(r$modalities, function(x) map_value(legacy_modalities, x))
    },
    vectors = {
      if (!is.null(r$target)) r$target <- map_value(legacy_targets, r$target)
    }
  )
  r
}

blob_keys <- function(doc) {
  if (is.null(doc$cache$blob_keys)) {
    name <- doc_table_name(doc, "blobs")
    col <- if (doc$legacy) "clave" else "key"
    doc$cache$blob_keys <- if (is.null(name)) character(0) else
      DBI::dbGetQuery(doc$con, paste("SELECT", quote_ident(col), "AS k FROM", quote_ident(name)))$k
  }
  doc$cache$blob_keys
}

check_open <- function(doc) {
  if (!inherits(doc, "spdf_document")) stop("not a spdf_document")
  if (is.null(doc$con)) stop("the spdf_document is closed")
}
