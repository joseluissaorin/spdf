# Errors carry the validation code of the specification (E001, E002, E020...).

spdf_abort <- function(code, message) {
  cond <- structure(
    class = c(paste0("spdf_error_", code), "spdf_error", "error", "condition"),
    list(message = paste0("[", code, "] ", message), call = NULL, code = code)
  )
  stop(cond)
}

`%||%` <- function(a, b) if (is.null(a)) b else a
