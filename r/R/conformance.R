# Runner of the shared conformance suite (conformance/cases/*.json, section 11).

conf_compare <- function(want, got, path = "$") {
  if (is.null(want) || is.null(got)) {
    return(if (is.null(want) && is.null(got)) NULL else sprintf("%s: expected %s, got %s", path, if (is.null(want)) "null" else "a value", if (is.null(got)) "null" else "a value"))
  }
  if (is.numeric(want) && is.numeric(got) && length(want) == 1 && length(got) == 1) {
    return(if (abs(want - got) <= 1e-6) NULL else sprintf("%s: expected %s, got %s", path, want, got))
  }
  if (is.list(want) && is.list(got)) {
    wo <- !is.null(names(want))
    go <- !is.null(names(got))
    if (length(want) == 0 && length(got) == 0) {
      return(NULL)
    }
    if (wo != go) {
      return(paste0(path, ": list/object mismatch"))
    }
    if (wo) {
      missing <- setdiff(names(want), names(got))
      extra <- setdiff(names(got), names(want))
      if (length(missing) > 0) return(paste0(path, ".", missing[1], ": missing"))
      if (length(extra) > 0) return(paste0(path, ".", extra[1], ": unexpected key"))
      for (k in names(want)) {
        r <- conf_compare(want[[k]], got[[k]], paste0(path, ".", k))
        if (!is.null(r)) return(r)
      }
      return(NULL)
    }
    if (length(want) != length(got)) {
      return(sprintf("%s: expected %d items, got %d", path, length(want), length(got)))
    }
    for (i in seq_along(want)) {
      r <- conf_compare(want[[i]], got[[i]], sprintf("%s[%d]", path, i - 1))
      if (!is.null(r)) return(r)
    }
    return(NULL)
  }
  if (identical(want, got)) NULL else sprintf("%s: expected %s, got %s", path, paste(format(want), collapse = ","), paste(format(got), collapse = ","))
}

conf_results <- function(want, got, via) {
  if (length(want) != length(got)) {
    return(sprintf("results: expected %d, got %d", length(want), length(got)))
  }
  for (i in seq_along(want)) {
    w <- want[[i]]
    g <- got[[i]]
    for (k in c("fragment_id", "unit_id", "figure_id")) {
      if (!is.null(w[[k]]) && !identical(w[[k]], g[[k]])) return(sprintf("results[%d].%s: expected %s, got %s", i - 1, k, w[[k]], format(g[[k]])))
    }
    if (abs(w$score - g$score) > 1e-6) return(sprintf("results[%d].score: expected %s, got %s", i - 1, w$score, g$score))
    if (!identical(w$anchor_uri, g$anchor_uri)) return(sprintf("results[%d].anchor_uri: expected %s, got %s", i - 1, w$anchor_uri, g$anchor_uri))
    if (via && !is.null(w$via) && !identical(unlist(w$via), unlist(g$via))) {
      return(sprintf("results[%d].via: expected %s, got %s", i - 1, paste(unlist(w$via), collapse = ","), paste(unlist(g$via), collapse = ",")))
    }
  }
  NULL
}

conf_case <- function(dir, c) {
  p <- function(rel) file.path(dir, rel)
  js <- function(rel) json_parse(paste(readLines(p(rel), encoding = "UTF-8", warn = FALSE), collapse = "\n"))
  input <- c$input %||% list()
  ex <- c$expect %||% list()
  kind <- c$kind %||% ""
  if (kind %in% c("dump", "legacy_dump")) {
    doc <- spdf_open(p(input$file))
    on.exit(spdf_close(doc))
    r <- conf_compare(js(ex$dump), spdf_dump(doc), "dump")
    if (!is.null(r)) return(r)
    sha <- spdf_content_sha256(doc)
    if (!is.null(ex$content_sha256) && sha != ex$content_sha256) return(paste("content_sha256: expected", ex$content_sha256, "got", sha))
    return(NULL)
  }
  if (kind == "roundtrip") {
    out <- tempfile(fileext = ".spdf")
    on.exit(unlink(out))
    spdf_write_source(js(input$source), out)
    doc <- spdf_open(out)
    on.exit(spdf_close(doc), add = TRUE)
    return(conf_compare(js(ex$dump), spdf_dump(doc), "dump"))
  }
  if (kind == "validate") {
    r <- spdf_validate(p(input$file))
    if ("version" %in% names(ex) && !identical(ex$version, r$version)) return(sprintf("version: expected %s, got %s", format(ex$version), format(r$version)))
    if (!is.null(ex$valid) && !identical(ex$valid, r$valid)) {
      return(sprintf("valid: expected %s, got %s (%s)", ex$valid, r$valid, paste(vapply(r$errors, function(e) e$code, character(1)), collapse = ",")))
    }
    for (k in c("errors", "warnings")) {
      if (is.null(ex[[k]])) next
      want <- sort(unique(vapply(ex[[k]], function(e) if (is.list(e)) e$code else e, character(1))))
      got <- sort(unique(vapply(r[[k]], function(e) e$code, character(1))))
      if (!identical(as.character(want), as.character(got))) return(sprintf("%s: expected [%s], got [%s]", k, paste(want, collapse = ","), paste(got, collapse = ",")))
    }
    return(NULL)
  }
  if (kind == "search_lexical") {
    doc <- spdf_open(p(input$file))
    on.exit(spdf_close(doc))
    res <- lexical_raw(doc, input$query, input$limit %||% 10)
    for (k in c("route", "match")) {
      if (k %in% names(ex) && !identical(ex[[k]], res$trace[[k]])) return(sprintf("%s: expected %s, got %s", k, format(ex[[k]]), format(res$trace[[k]])))
    }
    return(conf_results(ex$results, res$items, TRUE))
  }
  if (kind == "search_vector") {
    doc <- spdf_open(p(input$file))
    on.exit(spdf_close(doc))
    return(conf_results(ex$results, vector_raw(doc, unlist(input$query_vector), input$space, input$limit %||% 10, input$target %||% "fragment"), FALSE))
  }
  if (kind == "search_hybrid") {
    doc <- spdf_open(p(input$file))
    on.exit(spdf_close(doc))
    return(conf_results(ex$results, hybrid_raw(doc, input$query, unlist(input$query_vector), input$space, input$limit %||% 10), TRUE))
  }
  if (kind == "anchor_uri") {
    if (!is.null(input$uri)) {
      if (isTRUE(ex$error)) {
        r <- tryCatch(spdf_parse_uri(input$uri), spdf_error = function(e) NULL)
        return(if (is.null(r)) NULL else "expected a parse error")
      }
      pr <- spdf_parse_uri(input$uri)
      if (!identical(pr$docref, ex$docref)) return(paste("docref: expected", ex$docref, "got", pr$docref))
      r <- conf_compare(ex$locator, pr$locator, "locator")
      if (!is.null(r)) return(r)
      f <- spdf_format_locator(pr$docref, pr$locator)
      return(if (identical(f, ex$canonical)) NULL else paste("format(parse(uri)): expected", ex$canonical, "got", f))
    }
    uri <- spdf_anchor_uri(input$docref, input$anchor, input$anchor_end)
    if (!identical(uri, ex$uri)) return(paste("uri: expected", ex$uri, "got", uri))
    pr <- spdf_parse_uri(uri)
    if (!identical(pr$docref, input$docref)) return(paste("parse(uri).docref: expected", input$docref, "got", pr$docref))
    r <- conf_compare(ex$locator, pr$locator, "locator")
    if (!is.null(r)) return(r)
    f <- spdf_format_locator(pr$docref, pr$locator)
    return(if (identical(f, uri)) NULL else paste("format(parse(uri)): expected", uri, "got", f))
  }
  if (kind == "cite") {
    text <- spdf_cite(input$metadata %||% list(), input$anchor, input$anchor_end, input$locale %||% "en")
    return(if (identical(text, ex$text)) NULL else paste("expected", ex$text, "got", text))
  }
  if (kind == "locate") {
    doc <- spdf_open(p(input$file))
    on.exit(spdf_close(doc))
    got <- tryCatch(spdf_locate(doc, input$reference), spdf_error = function(e) {
      list(document = FALSE, units = list(), fragments = list(), char = NULL, xywh = NULL)
    })
    return(conf_compare(ex, got, "locate"))
  }
  if (kind %in% c("export_csl", "export_bibtex")) {
    metas <- lapply(input$files, function(f) {
      d <- spdf_open(p(f))
      on.exit(spdf_close(d))
      spdf_metadata(d)
    })
    if (kind == "export_csl") {
      return(conf_compare(ex$items, csl_export(metas, input$anchor, input$anchor_end), "items"))
    }
    items <- lapply(metas, csl_base)
    keys <- bib_keys(items)
    text <- paste(vapply(seq_along(items), function(i) bibtex_entry(items[[i]], keys[i]), character(1)), collapse = "\n")
    lines <- function(t) {
      x <- trimws(strsplit(gsub("\r\n", "\n", t, fixed = TRUE), "\n", fixed = TRUE)[[1]])
      x[nzchar(x)]
    }
    want <- lines(ex$text)
    got <- lines(text)
    if (!identical(want, got)) {
      i <- which(want[seq_len(min(length(want), length(got)))] != got[seq_len(min(length(want), length(got)))])
      return(if (length(i) > 0) paste0("line ", i[1], ": expected ", want[i[1]], ", got ", got[i[1]]) else "line count differs")
    }
    return(NULL)
  }
  if (kind == "export_structure") {
    return(structure("ALTO, TEI and IIIF exports (SPEC 19.4, optional) are not implemented", class = "conf_skip"))
  }
  if (kind == "quantize") {
    hex <- tryCatch(paste(as.character(spdf_vector_encode(unlist(input$values), input$dtype)), collapse = ""), spdf_error = function(e) NULL)
    if (isTRUE(ex$error)) return(if (is.null(hex)) NULL else paste("expected an error, got", hex))
    if (is.null(hex)) return("unexpected error")
    return(if (identical(hex, ex$hex)) NULL else paste("expected", ex$hex, "got", hex))
  }
  paste("unknown case kind", kind)
}

#' Run the SPDF conformance suite
#'
#' Executes every case of `conformance/cases/*.json` of the SPDF repository and returns
#' the report of the specification (section 11): `impl`, `version`, `passed`, `failed`
#' (with `id` and `reason`) and `skipped`.
#'
#' @param dir The `conformance` directory of the SPDF repository.
#' @return A list; `jsonlite::toJSON(x, auto_unbox = TRUE)` gives the JSON report.
#' @export
spdf_conformance <- function(dir) {
  files <- sort(list.files(file.path(dir, "cases"), pattern = "\\.json$", full.names = TRUE), method = "radix")
  passed <- character(0)
  failed <- list()
  skipped <- list()
  for (f in files) {
    c <- json_parse(paste(readLines(f, encoding = "UTF-8", warn = FALSE), collapse = "\n"))
    id <- c$id %||% sub("\\.json$", "", basename(f))
    reason <- tryCatch(conf_case(dir, c), error = function(e) paste("error:", conditionMessage(e)))
    if (is.null(reason)) {
      passed <- c(passed, id)
    } else if (inherits(reason, "conf_skip")) {
      skipped[[length(skipped) + 1]] <- list(id = id, reason = as.character(unclass(reason)))
    } else {
      failed[[length(failed) + 1]] <- list(id = id, reason = reason)
    }
  }
  list(impl = "spdf (R)", version = as.character(utils::packageVersion("spdf")), passed = as.list(passed), failed = failed, skipped = skipped)
}

# One request of the `eval` test protocol (inst/scripts/eval.R).
spdf_eval <- function(q) {
  with_doc <- function(f) {
    doc <- spdf_open(q$file)
    on.exit(spdf_close(doc))
    f(doc)
  }
  strip <- function(items) lapply(items, function(i) i[setdiff(names(i), c("n", "target", "id"))])
  switch(q$op,
    dump = with_doc(spdf_dump),
    validate = spdf_validate(q$file),
    lexical = with_doc(function(d) strip(lexical_raw(d, q$query, q$limit %||% 10)$items)),
    vector = with_doc(function(d) strip(vector_raw(d, unlist(q$vector), q$space, q$limit %||% 10, q$target %||% "fragment"))),
    hybrid = with_doc(function(d) strip(hybrid_raw(d, q$query, unlist(q$vector), q$space, q$limit %||% 10))),
    uri = spdf_anchor_uri(q$docref, q$anchor, q$end),
    format_locator = spdf_format_locator(q$docref, q$locator),
    parse_uri = spdf_parse_uri(q$uri),
    cite = spdf_cite(q$metadata, q$anchor, q$end, q$locale %||% "es"),
    write = {
      spdf_write_source(q$source, q$path)
      with_doc2 <- spdf_open(q$path)
      on.exit(spdf_close(with_doc2))
      spdf_dump(with_doc2)
    },
    stop("unknown op ", q$op)
  )
}
