# Writing SPDF 5.0 files.

schema_50 <- c(
  "CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  paste("CREATE TABLE documents (id TEXT PRIMARY KEY, kind TEXT NOT NULL, metadata TEXT NOT NULL, source_sha256 TEXT NOT NULL,",
        "source_ref TEXT, mime TEXT NOT NULL, bytes INTEGER NOT NULL, unit_count INTEGER NOT NULL, duration REAL,",
        "created TEXT NOT NULL, updated TEXT NOT NULL, title TEXT, authors TEXT, year INTEGER, language TEXT, rights TEXT)"),
  paste("CREATE TABLE units (id TEXT PRIMARY KEY, document TEXT NOT NULL REFERENCES documents(id), ord INTEGER NOT NULL,",
        "anchor TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', notes TEXT, header TEXT, footer TEXT, image TEXT, thumbnail TEXT,",
        "reader TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, printed TEXT, t0 REAL, t1 REAL, words TEXT)"),
  "CREATE INDEX units_doc ON units(document, ord)",
  "CREATE INDEX units_printed ON units(document, printed)",
  paste("CREATE TABLE sections (id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL,",
        "title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT)"),
  paste("CREATE TABLE fragments (n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT NOT NULL, unit TEXT NOT NULL,",
        "ord INTEGER NOT NULL, text TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', section TEXT, anchor TEXT NOT NULL,",
        "anchor_end TEXT, search_text TEXT)"),
  "CREATE INDEX fragments_doc ON fragments(document, ord)",
  "CREATE INDEX fragments_unit ON fragments(unit)",
  paste("CREATE VIRTUAL TABLE fragments_fts USING fts5(text, context, section, search_text,",
        "content='fragments', content_rowid='n', tokenize='unicode61 remove_diacritics 2')"),
  paste("CREATE TABLE figures (id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL, image TEXT NOT NULL,",
        "caption TEXT, description TEXT, anchor TEXT NOT NULL)"),
  paste("CREATE TABLE spaces (id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, version TEXT,",
        "dims INTEGER NOT NULL, dtype TEXT NOT NULL DEFAULT 'f32', normalized INTEGER NOT NULL DEFAULT 1,",
        "truncated_from INTEGER, modalities TEXT NOT NULL, task_prefixes TEXT, created TEXT)"),
  paste("CREATE TABLE vectors (target TEXT NOT NULL, id TEXT NOT NULL, space TEXT NOT NULL REFERENCES spaces(id),",
        "document TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (target, id, space))"),
  "CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL)",
  paste("CREATE TABLE provenance (document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT,",
        "detail TEXT, ms INTEGER, at TEXT NOT NULL)"),
  "CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0)"
)

utc_now <- function() format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")

sql_value <- function(v, json = FALSE) {
  if (is.null(v) || (is.atomic(v) && length(v) == 1 && is.na(v))) {
    return(NA)
  }
  if (json && !is.character(v)) {
    return(spdf_canonical_json(v))
  }
  if (is.list(v)) {
    return(spdf_canonical_json(v))
  }
  v
}

insert_row <- function(con, table, row, json_cols = character(0)) {
  cols <- names(row)
  params <- lapply(cols, function(c) {
    v <- row[[c]]
    if (is.raw(v)) list(v) else sql_value(v, c %in% json_cols)
  })
  sql <- sprintf("INSERT INTO %s (%s) VALUES (%s)", quote_ident(table), paste(quote_ident(cols), collapse = ", "),
                 paste(rep("?", length(cols)), collapse = ", "))
  DBI::dbExecute(con, sql, params = unname(params))
}

pick <- function(row, cols, defaults = list()) {
  out <- lapply(cols, function(c) if (c %in% names(row)) row[[c]] else defaults[[c]])
  names(out) <- cols
  out
}

pack_values <- function(values, dtype) {
  v <- as.numeric(unlist(values))
  switch(dtype,
    i8 = writeBin(as.integer(v), raw(), size = 1),
    f16 = writeBin(double_to_half(v), raw(), size = 2, endian = "little"),
    writeBin(v, raw(), size = 4, endian = "little")
  )
}

as_rows <- function(x) {
  if (is.null(x)) {
    return(list())
  }
  if (is.data.frame(x)) {
    return(lapply(seq_len(nrow(x)), function(i) {
      r <- lapply(names(x), function(c) {
        v <- x[[c]][[i]]
        if (is.atomic(v) && length(v) == 1 && is.na(v)) NULL else v
      })
      names(r) <- names(x)
      r
    }))
  }
  x
}

write_spdf <- function(source, path, exact) {
  path <- normalizePath(path, mustWork = FALSE)
  tmp <- file.path(dirname(path), paste0(".", basename(path), ".", paste(sample(c(letters, 0:9), 8, TRUE), collapse = ""), ".tmp"))
  con <- DBI::dbConnect(RSQLite::SQLite(), tmp)
  done <- FALSE
  on.exit({
    if (!done) {
      try(DBI::dbDisconnect(con), silent = TRUE)
      unlink(tmp)
    }
  })
  for (p in c("PRAGMA page_size = 4096", "PRAGMA journal_mode = DELETE", paste("PRAGMA application_id =", format(spdf_application_id, scientific = FALSE)),
              "PRAGMA user_version = 500", "PRAGMA trusted_schema = OFF")) DBI::dbExecute(con, p)
  DBI::dbBegin(con)
  for (s in schema_50) DBI::dbExecute(con, s)
  trigram <- isTRUE(source$fts$trigram)
  doc <- source$document
  did <- doc$id
  m <- if (json_is_object(doc$metadata)) doc$metadata else list()
  meta <- source$meta %||% list()
  if (!exact) {
    defaults <- list(spdf_version = "5.0", profile = "core", created = utc_now(), generator = paste0("spdf-r/", utils::packageVersion("spdf")),
                     document_id = did)
    for (k in names(defaults)) if (is.null(meta[[k]])) meta[[k]] <- defaults[[k]]
  }
  ddef <- if (exact) list() else list(
    created = meta$created %||% utc_now(), updated = doc$created %||% meta$created %||% utc_now(), title = m$title,
    year = tryCatch(m$issued[["date-parts"]][[1]][[1]], error = function(e) NULL), language = m$language,
    authors = if (is.list(m$author)) paste(vapply(m$author, function(a) a$family %||% a$literal %||% "", character(1)), collapse = "; ") else NULL
  )
  insert_row(con, "documents", pick(doc, spdf_columns$documents, ddef), c("metadata", "rights"))
  for (u in as_rows(source$units)) {
    u$document <- did
    if (!exact && is.character(u$text)) u$text <- nfc(u$text)
    if (!exact && is.null(u$printed) && json_is_object(u$anchor)) u$printed <- u$anchor$printed
    insert_row(con, "units", pick(u, spdf_columns$units, list(text = "", confidence = 1)), c("anchor", "notes", "words"))
  }
  for (x in as_rows(source$sections)) {
    x$document <- did
    insert_row(con, "sections", pick(x, spdf_columns$sections))
  }
  for (f in as_rows(source$fragments)) {
    f$document <- did
    if (!exact) for (k in c("text", "context", "search_text")) if (is.character(f[[k]])) f[[k]] <- nfc(f[[k]])
    insert_row(con, "fragments", pick(f, spdf_columns$fragments, list(context = "")), c("section", "anchor", "anchor_end"))
  }
  for (g in as_rows(source$figures)) {
    g$document <- did
    insert_row(con, "figures", pick(g, spdf_columns$figures), "anchor")
  }
  dtypes <- list()
  for (s in as_rows(source$spaces)) {
    row <- pick(s, spdf_columns$spaces, list(dtype = "f32", normalized = 1L, modalities = list("text")))
    dtypes[[row$id]] <- row$dtype
    insert_row(con, "spaces", row, c("modalities", "task_prefixes"))
  }
  vectors <- source$vectors %||% list()
  for (space in names(vectors)) {
    dtype <- dtypes[[space]] %||% "f32"
    for (it in vectors[[space]]$items) {
      data <- if (is.raw(it$data)) it$data else if (exact) pack_values(it$values, dtype) else spdf_vector_encode(unlist(it$values), dtype)
      insert_row(con, "vectors", list(target = it$target, id = it$id, space = space, document = did, data = data))
    }
  }
  for (b in as_rows(source$blobs)) {
    data <- if (is.raw(b$data)) b$data else jsonlite::base64_dec(b$data_base64 %||% "")
    insert_row(con, "blobs", list(key = b$key, mime = b$mime, sha256 = b$sha256 %||% sha256_hex(data), data = data))
  }
  for (p in as_rows(source$provenance)) {
    p$document <- did
    insert_row(con, "provenance", pick(p, spdf_columns$provenance), "detail")
  }
  for (e in as_rows(source$extensions)) insert_row(con, "extensions", pick(e, spdf_columns$extensions, list(required = 0L)))
  for (k in names(meta)) insert_row(con, "spdf_meta", list(key = k, value = as.character(meta[[k]])))
  DBI::dbExecute(con, "INSERT INTO fragments_fts(fragments_fts) VALUES ('rebuild')")
  if (trigram) {
    DBI::dbExecute(con, "CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(text, content='fragments', content_rowid='n', tokenize='trigram')")
    DBI::dbExecute(con, "INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES ('rebuild')")
  }
  DBI::dbCommit(con)
  DBI::dbExecute(con, "VACUUM")
  DBI::dbDisconnect(con)
  if (file.exists(path)) unlink(path)
  if (!file.rename(tmp, path)) spdf_abort("E001", paste("cannot move the new file into", path))
  done <- TRUE
  invisible(path)
}

#' Write a SPDF 5.0 file
#'
#' `spdf_write()` builds a file from R data: a document (a list with `id`, `kind`,
#' `metadata` as a CSL-JSON list, `source_sha256`, `mime`, `bytes`, `unit_count`...)
#' and data frames (or lists of rows) of units, fragments and the optional tables.
#' Anchors and other JSON members go in list-columns. Vectors are a named list by
#' space id of `list(items = list(list(target, id, values), ...))`, quantized for
#' f16 and i8 spaces. The FTS index is rebuilt, the file has no triggers or views, it
#' is compacted with VACUUM and moved into place atomically.
#'
#' `spdf_write_source()` writes a conformance *source* (a canonical dump plus vector
#' values and blob bytes in base64) exactly as given.
#'
#' @param path Output path.
#' @param document A list with the `documents` row.
#' @param units,fragments Data frames or lists of rows.
#' @param sections,figures,spaces,provenance,extensions Optional data frames or lists.
#' @param vectors Optional named list (by space id) of `list(items = ...)`.
#' @param blobs Optional list of `list(key, mime, data)` with `data` a raw vector.
#' @param meta Extra `spdf_meta` keys (for example `license_note`).
#' @param profile Space-separated profile, for example `"core semantic"`.
#' @param generator `name/version` of the producing software.
#' @param trigram Build the optional trigram index (CJK).
#' @param source A list in the conformance source format.
#' @return The path, invisibly.
#' @examples
#' out <- tempfile(fileext = ".spdf")
#' anchor <- list(type = "page", physical = 1L, printed = "45")
#' spdf_write(out,
#'   document = list(id = "d1", kind = "pdf", source_sha256 = strrep("ab", 32),
#'                   mime = "application/pdf", bytes = 10L, unit_count = 1L,
#'                   metadata = list(type = "book", title = "Prueba")),
#'   units = list(list(id = "p1", ord = 1L, anchor = anchor, text = "Hola", reader = "manual")),
#'   fragments = list(list(n = 1L, id = "f1", unit = "p1", ord = 1L, text = "Hola", anchor = anchor)))
#' spdf_validate(out)$valid
#' @export
spdf_write <- function(path, document, units, fragments, sections = NULL, figures = NULL, spaces = NULL,
                       vectors = NULL, blobs = NULL, provenance = NULL, extensions = NULL, meta = list(),
                       profile = "core", generator = paste0("spdf-r/", utils::packageVersion("spdf")), trigram = FALSE) {
  meta$profile <- meta$profile %||% profile
  meta$generator <- meta$generator %||% generator
  write_spdf(list(
    meta = meta, fts = list(trigram = trigram), document = document, units = units, fragments = fragments,
    sections = sections, figures = figures, spaces = spaces, vectors = vectors, blobs = blobs,
    provenance = provenance, extensions = extensions
  ), path, exact = FALSE)
}

#' @rdname spdf_write
#' @export
spdf_write_source <- function(source, path) write_spdf(source, path, exact = TRUE)
