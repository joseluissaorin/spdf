# Test protocol for differential testing: one JSON request per line on stdin, one
# JSON answer per line on stdout ({"ok": ...} or {"error": "..."}).
con <- file("stdin", "r")
while (length(line <- readLines(con, n = 1, encoding = "UTF-8")) > 0) {
  if (!nzchar(trimws(line))) next
  res <- tryCatch(list(ok = spdf:::spdf_eval(jsonlite::fromJSON(line, simplifyVector = FALSE))),
                  error = function(e) list(error = conditionMessage(e)))
  if (is.null(res$ok) && is.null(res$error)) res <- list(ok = NULL)
  out <- if ("ok" %in% names(res)) paste0("{\"ok\":", spdf::spdf_canonical_json(res$ok), "}") else spdf::spdf_canonical_json(res)
  cat(out, "\n", sep = "")
  flush(stdout())
}
