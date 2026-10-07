# Validation (specification section 12).

required_tables <- c("spdf_meta", "documents", "units", "sections", "fragments", "fragments_fts", "figures", "spaces",
                     "vectors", "blobs", "provenance", "extensions")
required_meta <- c("spdf_version", "profile", "created", "generator", "document_id")
anchor_types <- c("page", "time", "section", "slide", "sheet", "web", "image", "verse", "canonical")
ed25519_prefix <- as.raw(c(0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00))

is_int_json <- function(v) is.numeric(v) && length(v) == 1 && is.finite(v) && v == floor(v)
is_num_json <- function(v) is.numeric(v) && length(v) == 1
is_str_json <- function(v) is.character(v) && length(v) == 1

check_anchor <- function(a, text) {
  if (!json_is_object(a)) {
    return(c("E040", "anchor is not an object"))
  }
  t <- a$type
  if (!is_str_json(t)) {
    return(c("E040", "anchor without type"))
  }
  if (!(t %in% anchor_types)) {
    return(c("E041", paste("unknown anchor type", t)))
  }
  ok <- switch(t,
    page = is_int_json(a$physical) && a$physical >= 1 && "printed" %in% names(a) && (is.null(a$printed) || is_str_json(a$printed)),
    time = is_num_json(a$t0) && is_num_json(a$t1) && a$t0 >= 0 && a$t0 <= a$t1,
    section = is.list(a$path) && is.null(names(a$path)) && all(vapply(a$path, is_str_json, logical(1))),
    slide = is_int_json(a$n) && a$n >= 1,
    sheet = is_str_json(a$sheet) && is_int_json(a$row_from) && is_int_json(a$row_to),
    web = is_str_json(a$url),
    image = TRUE,
    verse = is_int_json(a$line_from),
    canonical = is_str_json(a$scheme) && is_str_json(a$ref)
  )
  if (!isTRUE(ok)) {
    return(c("E040", paste(t, "anchor misses or mistypes a required member")))
  }
  if ("region" %in% names(a)) {
    r <- a$region
    if (!json_is_object(r) || !all(vapply(c("x", "y", "w", "h"), function(k) is_num_json(r[[k]]), logical(1)))) {
      return(c("E040", "bad region"))
    }
  }
  if ("chars" %in% names(a)) {
    ch <- a$chars
    if (!is.list(ch) || !is.null(names(ch)) || length(ch) != 2 || !all(vapply(ch, is_int_json, logical(1)))) {
      return(c("E040", "bad chars"))
    }
    if (!is.null(text) && !(ch[[1]] >= 0 && ch[[1]] <= ch[[2]] && ch[[2]] <= nchar(nfc(text), type = "chars"))) {
      return(c("E042", "chars out of range"))
    }
  }
  NULL
}

#' Validate a SPDF file
#'
#' Runs the checks of the specification (section 12) in order: container (E001),
#' version (E002), triggers, views and foreign virtual tables (E020), tables and
#' columns (E010, E011), metadata (E012, E013, E050, E051), extensions (E060), units
#' (E090), anchors (E040-E042), vectors (E030-E032), the FTS index (E070, on an
#' in-memory copy), blobs (E080), integrity (E081, E082) and profile warnings.
#'
#' @param path Path to the file.
#' @return A list with `valid`, `version`, `profile`, `errors` and `warnings` (each
#'   error and warning has `code`, `message` and `where`).
#' @examples
#' r <- spdf_validate(system.file("extdata", "quijote.spdf", package = "spdf"))
#' r$valid
#' @export
spdf_validate <- function(path) {
  st <- new.env(parent = emptyenv())
  st$errors <- list()
  st$warnings <- list()
  err <- function(code, message, where = "") st$errors[[length(st$errors) + 1]] <- list(code = code, message = message, where = where)
  warn <- function(code, message, where = "") st$warnings[[length(st$warnings) + 1]] <- list(code = code, message = message, where = where)
  result <- function(version, profile) {
    list(valid = length(st$errors) == 0, version = version, profile = profile, errors = st$errors, warnings = st$warnings)
  }
  doc <- tryCatch(container_open(path, 512 * 1024^2, 4 * 1024^3, strict = FALSE), error = function(e) e)
  if (inherits(doc, "error")) {
    code <- if (identical(doc$code, "E002")) "E002" else "E001"
    err(code, conditionMessage(doc))
    return(result(NULL, list()))
  }
  on.exit(spdf_close(doc))
  con <- doc$con
  version <- doc$version
  profile <- list()
  if (doc$legacy) {
    warn("W110", paste("legacy SPDF", version, "file"))
    for (t in c("spdf", "documentos", "unidades", "fragmentos", "fragmentos_fts")) if (!(t %in% doc$tables)) err("E010", paste("missing legacy table", t), t)
    for (f in doc$forbidden) err("E020", paste(f$type, f$name, "present"), f$name)
    return(result(version, profile))
  }
  if (doc$gzipped) warn("E003", "SPDF 5.0 should not be gzip-wrapped")
  if (version != "5.0") warn("W105", paste("newer minor version", version))
  for (f in doc$forbidden) err("E020", paste(f$type, f$name, "present"), f$name)

  present <- list()
  for (t in required_tables) {
    if (!(t %in% doc$tables)) {
      err("E010", paste("missing table", t), t)
      next
    }
    have <- doc_columns(doc, t)
    present[[t]] <- have
    for (c in spdf_columns[[t]]) if (!(c %in% have)) err("E011", paste0("missing column ", t, ".", c), paste0(t, ".", c))
  }
  ok <- function(t, ...) !is.null(present[[t]]) && all(c(...) %in% present[[t]])

  meta <- list()
  if (ok("spdf_meta", "key", "value")) {
    df <- DBI::dbGetQuery(con, "SELECT key, value FROM spdf_meta")
    meta <- as.list(df$value)
    names(meta) <- df$key
    for (k in required_meta) if (!(k %in% names(meta))) err("E012", paste("missing spdf_meta key", k), k)
    profile <- as.list(strsplit(trimws(meta$profile %||% ""), "\\s+")[[1]])
    profile <- Filter(nzchar, profile)
  }

  docs <- NULL
  if (ok("documents", "id", "metadata")) {
    docs <- if (ok("documents", "rights", "unit_count")) {
      DBI::dbGetQuery(con, "SELECT id, metadata, rights, unit_count FROM documents")
    } else {
      DBI::dbGetQuery(con, "SELECT id, metadata, NULL AS rights, NULL AS unit_count FROM documents")
    }
    if (nrow(docs) != 1) err("E013", sprintf("documents has %d rows", nrow(docs)), "documents")
    for (i in seq_len(nrow(docs))) {
      m <- tryCatch(json_parse(docs$metadata[i]), error = function(e) e)
      if (inherits(m, "error") || is.na(docs$metadata[i])) {
        err("E050", "metadata is not valid JSON", as.character(docs$id[i]))
      } else if (!json_is_object(m) || !is_str_json(m$type) || !is_str_json(m$title)) {
        err("E051", "metadata needs a string type and title", as.character(docs$id[i]))
      }
      if (!is.na(docs$rights[i])) {
        r <- tryCatch(json_parse(docs$rights[i]), error = function(e) e)
        if (inherits(r, "error")) err("E050", "rights is not valid JSON", as.character(docs$id[i]))
      }
    }
  }

  if (ok("extensions", "name", "required")) {
    ex <- DBI::dbGetQuery(con, "SELECT name, required FROM extensions ORDER BY name")
    for (i in seq_len(nrow(ex))) {
      if (!is.na(ex$required[i]) && ex$required[i] != 0 && !(ex$name[i] %in% known_extensions)) {
        err("E060", paste("unknown required extension", ex$name[i]), ex$name[i])
      }
    }
  }

  anchor_error <- function(raw, text, where) {
    if (is.na(raw)) {
      err("E040", "anchor is not valid JSON", where)
      return(invisible())
    }
    a <- tryCatch(json_parse(raw), error = function(e) e)
    if (inherits(a, "error")) {
      err("E040", "anchor is not valid JSON", where)
      return(invisible())
    }
    r <- check_anchor(a, text)
    if (!is.null(r)) err(r[1], r[2], where)
  }

  texts <- list()
  if (ok("units", "id", "ord", "anchor", "text")) {
    u <- DBI::dbGetQuery(con, "SELECT id, ord, anchor, text FROM units ORDER BY ord, id")
    if (!identical(as.numeric(u$ord), as.numeric(seq_len(nrow(u))))) err("E090", "units.ord is not 1..N", "units")
    if (!is.null(docs) && nrow(docs) == 1 && !is.na(docs$unit_count[1]) && docs$unit_count[1] != nrow(u)) {
      warn("W102", sprintf("unit_count %s but %d units", docs$unit_count[1], nrow(u)), "documents.unit_count")
    }
    for (i in seq_len(nrow(u))) {
      texts[[u$id[i]]] <- u$text[i]
      anchor_error(u$anchor[i], if (is.na(u$text[i])) NULL else u$text[i], paste0("units/", u$id[i]))
    }
  }
  if (ok("fragments", "id", "unit", "anchor")) {
    end_col <- if (ok("fragments", "anchor_end")) "anchor_end" else "NULL AS anchor_end"
    f <- DBI::dbGetQuery(con, paste("SELECT id, unit, anchor,", end_col, "FROM fragments ORDER BY n"))
    for (i in seq_len(nrow(f))) {
      anchor_error(f$anchor[i], texts[[f$unit[i]]], paste0("fragments/", f$id[i]))
      if (!is.na(f$anchor_end[i])) anchor_error(f$anchor_end[i], NULL, paste0("fragments/", f$id[i], "/anchor_end"))
    }
  }
  if (ok("figures", "id", "unit", "anchor")) {
    g <- DBI::dbGetQuery(con, "SELECT id, unit, anchor FROM figures ORDER BY id")
    for (i in seq_len(nrow(g))) anchor_error(g$anchor[i], texts[[g$unit[i]]], paste0("figures/", g$id[i]))
  }

  spaces <- list()
  if (ok("spaces", "id", "dims", "dtype")) {
    s <- DBI::dbGetQuery(con, "SELECT id, dims, dtype FROM spaces ORDER BY id")
    for (i in seq_len(nrow(s))) {
      spaces[[s$id[i]]] <- list(dims = s$dims[i], dtype = s$dtype[i])
      if (!(s$dtype[i] %in% names(dtype_sizes))) err("E032", paste("unknown dtype", s$dtype[i]), s$id[i])
    }
  }
  nvec <- 0
  if (ok("vectors", "target", "id", "space", "data")) {
    v <- DBI::dbGetQuery(con, "SELECT target, id, space, typeof(data) AS t, length(data) AS len FROM vectors ORDER BY space, target, id")
    nvec <- nrow(v)
    for (i in seq_len(nrow(v))) {
      where <- paste0("vectors/", v$space[i], "/", v$target[i], "/", v$id[i])
      sp <- spaces[[v$space[i]]]
      if (is.null(sp)) {
        err("E031", paste("unknown space", v$space[i]), where)
        next
      }
      if (!(sp$dtype %in% names(dtype_sizes))) next
      size <- dtype_sizes[[sp$dtype]]
      if (v$t[i] != "blob" || v$len[i] != sp$dims * size) err("E030", sprintf("vector length %s != %s x %d", v$len[i], sp$dims, size), where)
    }
  }

  if ("fragments_fts" %in% doc$tables) {
    mem <- DBI::dbConnect(RSQLite::SQLite(), ":memory:")
    tryCatch(
      {
        RSQLite::sqliteCopyDatabase(con, mem)
        DBI::dbExecute(mem, "PRAGMA trusted_schema = OFF")
        DBI::dbExecute(mem, "INSERT INTO fragments_fts(fragments_fts, rank) VALUES ('integrity-check', 1)")
        if ("fragments_fts_trigram" %in% doc$tables) {
          DBI::dbExecute(mem, "INSERT INTO fragments_fts_trigram(fragments_fts_trigram, rank) VALUES ('integrity-check', 1)")
        }
      },
      error = function(e) err("E070", paste("FTS index out of sync:", conditionMessage(e)), "fragments_fts"),
      finally = DBI::dbDisconnect(mem)
    )
  }

  if (ok("blobs", "key", "sha256", "data")) {
    b <- DBI::dbGetQuery(con, "SELECT key, sha256, data FROM blobs ORDER BY key")
    for (i in seq_len(nrow(b))) {
      if (!identical(sha256_hex(b$data[[i]] %||% raw(0)), b$sha256[i])) err("E080", "blob sha256 mismatch", b$key[i])
    }
  }

  if ("content_sha256" %in% names(meta) && length(st$errors) == 0) {
    actual <- tryCatch(spdf_content_sha256(doc), error = function(e) "unavailable")
    if (!identical(actual, meta$content_sha256)) {
      err("E081", "content_sha256 does not match the canonical dump", "spdf_meta.content_sha256")
    } else if ("signature" %in% names(meta)) {
      good <- tryCatch(
        {
          signer <- meta$signer %||% ""
          if (!startsWith(signer, "ed25519:")) stop("bad signer")
          pk <- jsonlite::base64_dec(substring(signer, 9))
          sig <- jsonlite::base64_dec(meta$signature)
          if (length(pk) != 32 || length(sig) != 64) stop("bad sizes")
          key <- openssl::read_ed25519_pubkey(pk)
          isTRUE(openssl::ed25519_verify(charToRaw(paste0("spdf-content-sha256:", meta$content_sha256)), sig, key))
        },
        error = function(e) FALSE
      )
      if (!good) err("E082", "signature does not verify", "spdf_meta.signature")
    }
  }

  if ("semantic" %in% unlist(profile) && nvec == 0) warn("W100", "profile semantic without vectors")
  if ("media" %in% unlist(profile) && ok("units", "anchor")) {
    anchors <- DBI::dbGetQuery(con, "SELECT anchor FROM units")$anchor
    has_time <- any(vapply(anchors, function(a) {
      x <- tryCatch(json_parse(a), error = function(e) NULL)
      json_is_object(x) && identical(x$type, "time")
    }, logical(1)))
    if (!has_time) warn("W101", "profile media without time anchors")
  }
  result(version, profile)
}
