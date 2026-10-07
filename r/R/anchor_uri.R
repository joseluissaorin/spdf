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
#' Resolves an anchor URI, or the URL of a `.spdf` resource with a fragment, against a
#' file (specification section 5.4). The first parameter present among `p`, `f`, `t`,
#' `sl`, `v`, `ref`, `s` and `sh` selects the rule; `units` are the matching units in
#' reading order, `fragments` the matching fragments (narrowed by `char`), and `char` and
#' `xywh` are copied from the reference.
#'
#' @param doc A `spdf_document`.
#' @param reference An anchor URI, or a URL or path with a fragment.
#' @return A list with `document` (logical), `units`, `fragments` (character vectors),
#'   `char` and `xywh`.
#' @examples
#' doc <- spdf_open(system.file("extdata", "quijote.spdf", package = "spdf"))
#' uri <- spdf_search(doc, "hermoso")$anchor_uri[1]
#' str(spdf_locate(doc, uri))
#' spdf_close(doc)
#' @export
spdf_locate <- function(doc, reference) {
  check_open(doc)
  empty <- list(document = FALSE, units = list(), fragments = list(), char = NULL, xywh = NULL)
  d <- doc_document(doc)
  if (startsWith(reference, "spdf:")) {
    parsed <- spdf_parse_uri(reference)
    if (!(parsed$docref %in% c(paste0("sha256-", d$source_sha256), as.character(d$id)))) {
      return(empty)
    }
    l <- parsed$locator
  } else {
    hash <- regexpr("#", reference, fixed = TRUE)
    frag <- if (hash > 0) substring(reference, hash + 1) else ""
    l <- if (nzchar(frag)) spdf_parse_uri(paste0("spdf:x#", frag))$locator else list()
  }
  out <- list(document = TRUE, units = list(), fragments = list(), char = l$char, xywh = l$xywh)
  if (is.null(out$char)) out["char"] <- list(NULL)
  if (is.null(out$xywh)) out["xywh"] <- list(NULL)
  rule <- intersect(c("p", "f", "t", "sl", "v", "ref", "s", "sh"), names(l))
  if (length(rule) == 0) {
    return(out)
  }
  rule <- rule[1]
  units <- doc_units(doc)
  hits <- character(0)
  for (u in units) {
    if (locate_match(rule, l, u$anchor, if (rule == "f") u$printed else NULL)) hits <- c(hits, u$id)
  }
  if (rule == "t" && length(hits) == 0) {
    timed <- Filter(function(u) json_is_object(u$anchor) && identical(u$anchor$type, "time"), units)
    if (length(timed) > 0) {
      last <- timed[[length(timed)]]
      if (is.numeric(last$anchor$t1) && last$anchor$t1 == l$t[[1]]) hits <- last$id
    }
  }
  frags <- Filter(function(f) {
    locate_match(rule, l, f$anchor, NULL) || (json_is_object(f$anchor_end) && locate_match(rule, l, f$anchor_end, NULL))
  }, doc_rows(doc, "fragments", "ORDER BY {n}"))
  if (length(hits) == 0 && length(frags) > 0) {
    wanted <- vapply(frags, function(f) f$unit, character(1))
    hits <- unlist(lapply(units, function(u) if (u$id %in% wanted) u$id else NULL))
  }
  if (!is.null(l$char)) {
    cc <- l$char[[1]]
    dd <- l$char[[2]]
    first <- if (length(hits) > 0) hits[[1]] else NULL # char refers to the text of the first unit
    overlaps <- function(x) {
      ch <- if (json_is_object(x)) x$chars else NULL
      if (!is.list(ch) || length(ch) != 2) return(FALSE)
      a <- ch[[1]]
      b <- ch[[2]]
      if (cc < dd) a < dd && cc < b else a <= cc && cc < b
    }
    frags <- Filter(function(f) {
      if (identical(f$unit, first) && overlaps(f$anchor)) return(TRUE)
      eu <- end_unit(units, f$unit, f$anchor_end)
      !is.null(eu) && identical(eu$id, first) && overlaps(f$anchor_end)
    }, frags)
  }
  out$units <- as.list(hits)
  out$fragments <- lapply(frags, function(f) f$id)
  out
}

locate_match <- function(rule, l, a, printed) {
  if (!json_is_object(a)) {
    return(FALSE)
  }
  t <- a$type %||% ""
  isint <- function(v) is.numeric(v) && length(v) == 1 && is.finite(v) && v == floor(v)
  isnum <- function(v) is.numeric(v) && length(v) == 1
  switch(rule,
    p = t == "page" && isint(a$physical) && l$p <= a$physical && a$physical <= (l$pe %||% l$p),
    f = identical(as.character(printed %||% a$printed %||% NA), as.character(l$f)),
    t = {
      x <- l$t[[1]]
      t == "time" && isnum(a$t0) && isnum(a$t1) && a$t0 <= x && x < a$t1
    },
    sl = t == "slide" && !is.null(a$n) && isTRUE(a$n == l$sl),
    v = {
      x <- l$v[[1]]
      lf <- a$line_from
      lt <- a$line_to %||% lf
      t == "verse" && isint(lf) && lf <= x && x <= lt
    },
    ref = t == "canonical" && identical(a$scheme, l$ref$scheme) && identical(a$ref, l$ref$ref),
    s = {
      path <- a$path
      if (!(t %in% c("section", "web")) || !is.list(path)) {
        FALSE
      } else if (!is.null(l$para)) {
        identical(unlist(path), unlist(l$s)) && length(path) == length(l$s) && !is.null(a$paragraph) && isTRUE(a$paragraph == l$para)
      } else {
        length(path) >= length(l$s) && identical(unlist(path[seq_along(l$s)]), unlist(l$s))
      }
    },
    sh = {
      if (t != "sheet" || !identical(a$sheet, l$sh)) {
        FALSE
      } else if (!is.null(l$rows)) {
        x <- l$rows[[1]]
        isint(a$row_from) && isint(a$row_to) && a$row_from <= x && x <= a$row_to
      } else {
        TRUE
      }
    },
    FALSE
  )
}

anchor_identity <- function(a) if (json_is_object(a)) a[!(names(a) %in% c("chars", "region"))] else a

# JSON equality: key order ignored, 10 equals 10.0.
json_same <- function(a, b) {
  if (is.list(a) && is.list(b)) {
    if (!is.null(names(a)) || !is.null(names(b))) {
      if (is.null(names(a)) || is.null(names(b)) || !setequal(names(a), names(b)) || length(a) != length(b)) return(FALSE)
      return(all(vapply(names(a), function(k) json_same(a[[k]], b[[k]]), logical(1))))
    }
    if (length(a) != length(b)) return(FALSE)
    return(all(vapply(seq_along(a), function(i) json_same(a[[i]], b[[i]]), logical(1))))
  }
  if (is.null(a) || is.null(b)) return(is.null(a) && is.null(b))
  if (is.numeric(a) && is.numeric(b)) return(isTRUE(a == b))
  identical(a, b)
}

# The unit where a fragment ends: the first unit after its start unit whose anchor equals
# anchor_end once chars and region are removed (SPEC 4.4).
end_unit <- function(units, start_id, anchor_end) {
  if (!json_is_object(anchor_end)) return(NULL)
  want <- anchor_identity(anchor_end)
  after <- FALSE
  for (u in units) {
    if (identical(u$id, start_id)) {
      after <- TRUE
      next
    }
    if (after && json_same(anchor_identity(u$anchor), want)) return(u)
  }
  NULL
}

matter_of <- function(a) {
  m <- if (json_is_object(a)) a$matter else NULL
  if (is.character(m) && length(m) == 1) m else "body"
}

#' Cite a passage
#'
#' Cites a quotation taken from a fragment by the unit or units it actually lies in
#' (specification section 18.2): a quotation from the second page of a fragment that
#' begins on an unnumbered plate cites the folio of the second page.
#'
#' @param doc A `spdf_document`.
#' @param fragment Fragment id.
#' @param quote The quoted text, as it appears in the fragment.
#' @param locale `"es"` or `"en"`.
#' @return A list with the short citation `text` and the anchor `uri`.
#' @examples
#' doc <- spdf_open(system.file("extdata", "quijote.spdf", package = "spdf"))
#' f <- spdf_fragments(doc)[2, ]
#' spdf_cite_passage(doc, f$id, substr(f$text, 1, 20))
#' spdf_close(doc)
#' @export
spdf_cite_passage <- function(doc, fragment, quote, locale = "es") {
  check_open(doc)
  units <- doc_units(doc)
  byid <- stats::setNames(units, vapply(units, function(u) u$id, character(1)))
  rows <- doc_rows(doc, "fragments", "WHERE {id} = ?", params = list(fragment))
  if (length(rows) == 0) spdf_abort("E040", paste("unknown fragment", fragment))
  f <- rows[[1]]
  q <- nfc(quote)
  u1 <- byid[[f$unit]]
  a <- if (json_is_object(f$anchor)) f$anchor else list()
  sub_cp <- function(text, c) stringi::stri_sub(text, c[[1]] + 1, c[[2]])
  text1 <- as.character(u1$text %||% "")
  c1 <- a$chars %||% list(0, nchar(text1, type = "chars"))
  seg1 <- sub_cp(text1, c1)
  u2 <- end_unit(units, u1$id, f$anchor_end)
  seg2 <- ""
  c2 <- NULL
  if (!is.null(u2)) {
    text2 <- as.character(u2$text %||% "")
    c2 <- f$anchor_end$chars %||% list(0, nchar(text2, type = "chars"))
    seg2 <- sub_cp(text2, c2)
  }
  strip <- function(x) x[!(names(x) %in% c("chars", "region"))]
  find <- function(hay, needle) {
    pos <- stringi::stri_locate_first_fixed(hay, needle)[1, 1]
    if (is.na(pos)) NULL else pos - 1
  }
  end <- NULL
  if (!is.null(p <- find(seg1, q))) {
    i <- p + c1[[1]]
    anchor <- strip(u1$anchor)
    anchor$chars <- list(i, i + nchar(q, type = "chars"))
  } else if (!is.null(u2) && !is.null(p <- find(seg2, q))) {
    i <- p + c2[[1]]
    anchor <- strip(u2$anchor)
    anchor$chars <- list(i, i + nchar(q, type = "chars"))
  } else if (!is.null(u2) && !is.null(find(as.character(f$text), q))) {
    anchor <- strip(u1$anchor)
    end <- strip(u2$anchor)
  } else {
    spdf_abort("E040", "the quote is not in the fragment")
  }
  d <- doc_document(doc)
  list(text = spdf_cite(spdf_metadata(doc), anchor, end, locale),
       uri = spdf_anchor_uri(paste0("sha256-", d$source_sha256), anchor, end))
}
