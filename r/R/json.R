# Canonical JSON (RFC 8785, JCS) after rounding non-integer numbers to 6 decimals.
#
# JSON values live in R as: NULL (null), length-one logical / numeric / character
# vectors (scalars), unnamed lists (arrays) and named lists (objects; an empty object is
# a list with an empty names attribute).

json_parse <- function(text) {
  jsonlite::fromJSON(text, simplifyVector = FALSE)
}

# JSON-in-TEXT column: NULL/NA stay NULL, invalid JSON stays the raw string.
json_column <- function(text) {
  if (is.null(text) || length(text) == 0 || is.na(text)) {
    return(NULL)
  }
  tryCatch(json_parse(text), error = function(e) text)
}

json_object <- function(x = list()) {
  if (length(x) == 0) {
    return(structure(list(), names = character(0)))
  }
  x
}

json_is_object <- function(x) is.list(x) && !is.null(names(x))

# Rounds to 6 decimals, half to even on the exact binary value; -0 becomes 0.
round6 <- function(x) {
  if (!is.finite(x) || abs(x) >= 2^52) {
    return(x)
  }
  r <- as.numeric(sprintf("%.6f", x))
  if (r == 0) 0 else r
}

# A double rounded to 6 decimals in ECMAScript form (1 -> "1", 1e-6 -> "0.000001").
# The rounded decimal is printed directly (no parsing back), which is the shortest
# form for every value with up to 15 significant digits.
json_number <- function(x) {
  if (is.integer(x)) {
    return(as.character(x))
  }
  if (!is.finite(x)) {
    stop("NaN and infinities are not JSON")
  }
  if (abs(x) >= 1e21) {
    m <- formatC(abs(x), digits = 16, format = "e")
    parts <- strsplit(m, "e", fixed = TRUE)[[1]]
    mant <- sub("\\.?0+$", "", parts[1])
    return(paste0(if (x < 0) "-" else "", mant, "e+", as.integer(parts[2])))
  }
  s <- sub("\\.?0+$", "", sprintf("%.6f", x))
  if (s == "-0") "0" else s
}

json_string <- function(s) {
  s <- enc2utf8(s)
  s <- gsub("\\", "\\\\", s, fixed = TRUE)
  s <- gsub("\"", "\\\"", s, fixed = TRUE)
  if (grepl("[\x01-\x1f]", s, useBytes = TRUE)) {
    cps <- utf8ToInt(s)
    out <- vapply(cps, function(cp) {
      if (cp >= 0x20) {
        return(intToUtf8(cp))
      }
      switch(as.character(cp),
        "8" = "\\b", "12" = "\\f", "10" = "\\n", "13" = "\\r", "9" = "\\t",
        sprintf("\\u%04x", cp)
      )
    }, character(1))
    s <- paste(out, collapse = "")
  }
  paste0("\"", s, "\"")
}

# Order of keys by UTF-16 code units.
utf16_order <- function(keys) {
  hex <- vapply(keys, function(k) {
    paste(as.character(iconv(enc2utf8(k), "UTF-8", "UTF-16BE", toRaw = TRUE)[[1]]), collapse = "")
  }, character(1), USE.NAMES = FALSE)
  order(hex, method = "radix")
}

#' Canonical JSON (RFC 8785) of an R value
#'
#' Serializes a JSON value held in R (named lists are objects, unnamed lists are
#' arrays, length-one vectors are scalars, `NULL` is null) with sorted keys, no
#' whitespace and non-integer numbers rounded to 6 decimals, as the SPDF dump requires.
#'
#' @param x An R value.
#' @return A character string.
#' @examples
#' spdf_canonical_json(list(b = 1, a = list(0.1234567, "x")))
#' @export
spdf_canonical_json <- function(x) {
  if (is.null(x)) {
    return("null")
  }
  if (is.list(x)) {
    if (!is.null(names(x))) {
      if (length(x) == 0) {
        return("{}")
      }
      keys <- names(x)
      o <- utf16_order(keys)
      parts <- vapply(o, function(i) {
        paste0(json_string(keys[i]), ":", spdf_canonical_json(x[[i]]))
      }, character(1))
      return(paste0("{", paste(parts, collapse = ","), "}"))
    }
    parts <- vapply(seq_along(x), function(i) spdf_canonical_json(x[[i]]), character(1))
    return(paste0("[", paste(parts, collapse = ","), "]"))
  }
  if (inherits(x, "blob") || is.raw(x)) {
    stop("raw bytes are not JSON")
  }
  if (length(x) != 1) {
    return(spdf_canonical_json(as.list(unname(x))))
  }
  if (is.na(x)) {
    return("null")
  }
  if (is.logical(x)) {
    return(if (x) "true" else "false")
  }
  if (is.numeric(x)) {
    return(json_number(x))
  }
  json_string(as.character(x))
}

# Rounds every number in a tree (integral results become integer-like doubles).
json_canon <- function(x) {
  if (is.list(x)) {
    nms <- names(x)
    out <- lapply(x, json_canon)
    if (!is.null(nms)) names(out) <- nms
    return(out)
  }
  if (is.double(x) && length(x) == 1 && is.finite(x)) {
    return(round6(x))
  }
  x
}

# Plain JSON text for exports meant for tools (keys in insertion order).
json_text <- function(x, pretty = FALSE) {
  as.character(jsonlite::toJSON(x, auto_unbox = TRUE, null = "null", na = "null", pretty = pretty, digits = NA))
}
