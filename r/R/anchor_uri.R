# Anchor URIs: spdf:<docref>#<params> (specification section 3).

uri_order <- c("p", "pe", "f", "fe", "t", "s", "para", "sl", "sh", "rows", "v", "ref", "char", "xywh")

uri_enc <- function(s) {
  b <- charToRaw(enc2utf8(as.character(s)))
  keep <- (b >= as.raw(0x41) & b <= as.raw(0x5a)) | (b >= as.raw(0x61) & b <= as.raw(0x7a)) |
    (b >= as.raw(0x30) & b <= as.raw(0x39)) | b %in% charToRaw("-._~")
  out <- character(length(b))
  out[keep] <- vapply(b[keep], function(x) rawToChar(x), character(1))
  out[!keep] <- sprintf("%%%02X", as.integer(b[!keep]))
  paste(out, collapse = "")
}

uri_bad <- function(why) spdf_abort("E040", paste("bad anchor URI:", why))

uri_dec <- function(s) {
  if (grepl("%(?![0-9A-Fa-f]{2})", s, perl = TRUE)) uri_bad("bad percent-encoding")
  b <- charToRaw(s)
  out <- raw(0)
  i <- 1L
  n <- length(b)
  while (i <= n) {
    if (b[i] == charToRaw("%")) {
      out <- c(out, as.raw(strtoi(rawToChar(b[(i + 1):(i + 2)]), 16L)))
      i <- i + 3L
    } else {
      out <- c(out, b[i])
      i <- i + 1L
    }
  }
  d <- rawToChar(out)
  Encoding(d) <- "UTF-8"
  if (!validUTF8(d)) uri_bad("percent-encoding is not UTF-8")
  d
}

is_whole <- function(x) is.numeric(x) && length(x) == 1 && is.finite(x) && x == floor(x)
int_text <- function(x) if (is_whole(x)) format(x, scientific = FALSE, trim = TRUE) else as.character(x)

#' Anchor URIs
#'
#' `spdf_anchor_uri()` builds the URI of an anchor (`spdf:sha256-...#p=29&f=21`);
#' `spdf_locator()` gives its parameters as a list; `spdf_format_locator()` writes a
#' locator back; `spdf_parse_uri()` parses a URI into `list(docref, locator)` and fails
#' (error code E040) on malformed input. `spdf_format_locator(parse)` reproduces the
#' canonical URI byte for byte.
#'
#' @param docref `sha256-<hex>` (portable) or a document id.
#' @param anchor An anchor (a named list, as found in `spdf_fragments(doc)$anchor`).
#' @param anchor_end Optional end anchor (fragments that cross units).
#' @param locator A locator list.
#' @param uri An anchor URI.
#' @return A string (`spdf_anchor_uri()`, `spdf_format_locator()`) or a list.
#' @examples
#' a <- list(type = "page", physical = 29, printed = "21", chars = list(118, 301))
#' u <- spdf_anchor_uri("doc-1", a)
#' u
#' str(spdf_parse_uri(u))
#' @export
spdf_anchor_uri <- function(docref, anchor, anchor_end = NULL) {
  spdf_format_locator(docref, spdf_locator(anchor, anchor_end))
}

#' @rdname spdf_anchor_uri
#' @export
spdf_locator <- function(anchor, anchor_end = NULL) {
  a <- anchor
  e <- anchor_end
  l <- list()
  t <- a$type %||% ""
  et <- if (is.null(e)) "" else e$type %||% ""
  if (t == "page") {
    l$p <- a$physical
    if (!is.null(a$printed)) l$f <- a$printed
    if (et == "page") {
      if (!is.null(e$physical) && !isTRUE(e$physical == a$physical)) l$pe <- e$physical
      if (!is.null(e$printed) && !identical(e$printed, a$printed)) l$fe <- e$printed
    }
  } else if (t == "time") {
    t1 <- if (et == "time") e$t1 else a$t1
    l$t <- if (is.null(t1)) list(a$t0) else list(a$t0, t1)
  } else if (t %in% c("section", "web")) {
    if (is.list(a$path) && length(a$path) > 0) l$s <- lapply(a$path, as.character)
    if (!is.null(a$paragraph)) l$para <- a$paragraph
    if (!is.null(a$printed)) {
      l$f <- a$printed
      if (!is.null(e) && !is.null(e$printed) && !identical(e$printed, a$printed)) l$fe <- e$printed
    }
  } else if (t == "slide") {
    l$sl <- a$n
  } else if (t == "sheet") {
    l$sh <- a$sheet
    l$rows <- list(a$row_from, a$row_to)
  } else if (t == "verse") {
    to <- a$line_to
    l$v <- if (is.null(to) || isTRUE(to == a$line_from)) list(a$line_from) else list(a$line_from, to)
    if (!is.null(a$printed)) l$f <- a$printed
  } else if (t == "canonical") {
    l$ref <- list(scheme = a$scheme, ref = a$ref)
  }
  if (!is.null(a$chars)) l$char <- as.list(a$chars)
  if (!is.null(a$region)) {
    r <- a$region
    l$xywh <- list(r$x, r$y, r$w, r$h)
  }
  l
}

#' @rdname spdf_anchor_uri
#' @export
spdf_format_locator <- function(docref, locator) {
  l <- locator
  parts <- character(0)
  for (k in uri_order) {
    if (!(k %in% names(l))) next
    v <- l[[k]]
    s <- switch(k,
      p = , pe = , para = , sl = int_text(v),
      f = , fe = , sh = uri_enc(v),
      t = paste(vapply(v, function(x) json_number(as.numeric(x)), character(1)), collapse = ","),
      s = paste(vapply(v, uri_enc, character(1)), collapse = "/"),
      rows = paste0(int_text(v[[1]]), "-", int_text(v[[2]])),
      v = paste(vapply(v, int_text, character(1)), collapse = "-"),
      ref = paste0(uri_enc(v$scheme), ":", uri_enc(v$ref)),
      char = paste0(int_text(v[[1]]), ",", int_text(v[[2]])),
      xywh = paste0("percent:", paste(vapply(v, function(x) {
        json_number(as.numeric(sprintf("%.4f", as.numeric(x) * 100)))
      }, character(1)), collapse = ","))
    )
    parts <- c(parts, paste0(k, "=", s))
  }
  ref <- if (grepl("^sha256-[0-9a-f]{64}$", docref)) docref else uri_enc(docref)
  paste0("spdf:", ref, if (length(parts) > 0) paste0("#", paste(parts, collapse = "&")) else "")
}

uri_int <- function(s) {
  if (!grepl("^(0|[1-9][0-9]*)$", s)) uri_bad(paste("not an integer:", s))
  as.numeric(s)
}

canon_num <- function(x) round6(x)

uri_npt <- function(s) {
  if (grepl("^[0-9]+(\\.[0-9]+)?$", s)) {
    return(canon_num(as.numeric(s)))
  }
  m <- regmatches(s, regexec("^(?:([0-9]+):)?([0-5]?[0-9]):([0-5][0-9](?:\\.[0-9]+)?)$", s, perl = TRUE))[[1]]
  if (length(m) == 0) uri_bad(paste("bad time:", s))
  h <- if (m[2] == "") 0 else as.numeric(m[2])
  canon_num(h * 3600 + as.numeric(m[3]) * 60 + as.numeric(m[4]))
}

split_keep <- function(s, sep) {
  parts <- strsplit(s, sep, fixed = TRUE)[[1]]
  if (endsWith(s, sep) || s == "") parts <- c(parts, "")
  if (length(parts) == 0) "" else parts
}

#' @rdname spdf_anchor_uri
#' @export
spdf_parse_uri <- function(uri) {
  if (!startsWith(uri, "spdf:")) uri_bad("not an spdf: URI")
  rest <- substring(uri, 6)
  hash <- regexpr("#", rest, fixed = TRUE)
  docref_raw <- if (hash > 0) substr(rest, 1, hash - 1) else rest
  frag <- if (hash > 0) substring(rest, hash + 1) else ""
  if (docref_raw == "") uri_bad("empty document reference")
  docref <- uri_dec(docref_raw)
  l <- list()
  for (part in if (frag == "") character(0) else split_keep(frag, "&")) {
    if (part == "") next
    eq <- regexpr("=", part, fixed = TRUE)
    if (eq < 0) uri_bad(paste("parameter without value:", part))
    k <- substr(part, 1, eq - 1)
    v <- substring(part, eq + 1)
    if (k %in% names(l)) uri_bad(paste("duplicate parameter", k))
    if (k %in% c("p", "pe", "para", "sl")) {
      l[[k]] <- uri_int(v)
      if (k != "para" && l[[k]] < 1) uri_bad(paste(k, "starts at 1"))
    } else if (k %in% c("f", "fe", "sh")) {
      l[[k]] <- uri_dec(v)
    } else if (k == "t") {
      v <- sub("^npt:", "", v)
      xs <- lapply(split_keep(v, ","), uri_npt)
      if (length(xs) > 2 || (length(xs) == 2 && xs[[2]] < xs[[1]])) uri_bad("bad t")
      l$t <- xs
    } else if (k == "s") {
      l$s <- lapply(split_keep(v, "/"), uri_dec)
    } else if (k == "rows") {
      dash <- regexpr("-", v, fixed = TRUE)
      if (dash < 0) uri_bad("rows needs a-b")
      l$rows <- list(uri_int(substr(v, 1, dash - 1)), uri_int(substring(v, dash + 1)))
    } else if (k == "v") {
      xs <- lapply(split_keep(v, "-"), uri_int)
      if (length(xs) > 2) uri_bad("bad v")
      l$v <- xs
    } else if (k == "ref") {
      colon <- regexpr(":", v, fixed = TRUE)
      if (colon <= 1) uri_bad("ref needs scheme:ref")
      l$ref <- list(scheme = uri_dec(substr(v, 1, colon - 1)), ref = uri_dec(substring(v, colon + 1)))
    } else if (k == "char") {
      xs <- split_keep(v, ",")
      if (length(xs) != 2) uri_bad("char needs start,end")
      a <- uri_int(xs[1])
      b <- uri_int(xs[2])
      if (b < a) uri_bad("char end before start")
      l$char <- list(a, b)
    } else if (k == "xywh") {
      if (!startsWith(v, "percent:")) uri_bad("xywh must use percent:")
      xs <- split_keep(substring(v, 9), ",")
      if (length(xs) != 4 || !all(grepl("^[0-9]+(\\.[0-9]+)?$", xs))) uri_bad("bad xywh")
      l$xywh <- lapply(xs, function(x) round6(as.numeric(x) / 100))
    }
  }
  list(docref = docref, locator = json_object(l))
}

#' Resolve an anchor URI
#'
#' The units an anchor URI points at (specification section 5.4): by physical page
#' (and end page), else by printed folio, time, slide, verse, canonical reference or
#' section path. A URI that designates another document gives no rows.
#'
#' @param doc A `spdf_document`.
#' @param uri An anchor URI.
#' @return A tibble of units (as [spdf_units()]).
#' @examples
#' doc <- spdf_open(system.file("extdata", "quijote.spdf", package = "spdf"))
#' uri <- spdf_search(doc, "\"lugar de la Mancha\"")$anchor_uri[1]
#' spdf_locate(doc, uri)[, c("ord", "printed")]
#' spdf_close(doc)
#' @export
spdf_locate <- function(doc, uri) {
  check_open(doc)
  parsed <- spdf_parse_uri(uri)
  ref <- parsed$docref
  d <- doc_document(doc)
  units <- strip_document(doc_units(doc))
  cols <- setdiff(spdf_columns$units, "document")
  none <- rows_to_tibble(list(), cols, c("anchor", "notes", "words"))
  if (startsWith(ref, "sha256-")) {
    if (substring(ref, 8) != tolower(d$source_sha256 %||% "")) return(none)
  } else if (ref != as.character(d$id)) {
    return(none)
  }
  l <- parsed$locator
  hit <- vapply(units, function(u) {
    a <- if (json_is_object(u$anchor)) u$anchor else list()
    if (!is.null(l$p)) {
      !is.null(a$physical) && l$p <= a$physical && a$physical <= (l$pe %||% l$p)
    } else if (!is.null(l$f)) {
      identical(u$printed, l$f) || identical(a$printed, l$f)
    } else if (!is.null(l$t)) {
      t <- l$t[[1]]
      !is.null(a$t0) && !is.null(a$t1) && a$t0 <= t && t < a$t1
    } else if (!is.null(l$sl)) {
      isTRUE(a$n == l$sl)
    } else if (!is.null(l$v)) {
      !is.null(a$line_from) && a$line_from <= l$v[[1]] && l$v[[1]] <= (a$line_to %||% a$line_from)
    } else if (!is.null(l$ref)) {
      identical(a$scheme, l$ref$scheme) && identical(a$ref, l$ref$ref)
    } else if (!is.null(l$s)) {
      is.list(a$path) && length(a$path) >= length(l$s) && identical(unlist(a$path[seq_along(l$s)]), unlist(l$s))
    } else {
      FALSE
    }
  }, logical(1))
  if (!any(hit)) return(none)
  rows_to_tibble(units[hit], cols, c("anchor", "notes", "words"))
}
