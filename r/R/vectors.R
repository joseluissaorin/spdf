# Little-endian vector blobs: f32, f16 (IEEE binary16) and i8 (value / 127).

dtype_sizes <- c(f32 = 4L, f16 = 2L, i8 = 1L)

half_to_double <- function(h) {
  sign <- ifelse(bitwAnd(h, 0x8000L) != 0, -1, 1)
  e <- bitwAnd(bitwShiftR(h, 10L), 0x1fL)
  f <- bitwAnd(h, 0x3ffL)
  out <- ifelse(e == 0, sign * f * 2^-24, sign * (1 + f / 1024) * 2^(e - 15))
  out[e == 31 & f == 0] <- sign[e == 31 & f == 0] * Inf
  out[e == 31 & f != 0] <- NaN
  out
}

double_to_half <- function(x) {
  bits <- readBin(writeBin(x, raw(), size = 4, endian = "little"), "integer", n = length(x), size = 4, endian = "little")
  vapply(bits, function(b) {
    sign <- bitwAnd(bitwShiftR(b, 16L), 0x8000L)
    raw_exp <- bitwAnd(bitwShiftR(b, 23L), 0xffL)
    mant <- bitwAnd(b, 0x7fffffL)
    if (raw_exp == 0xffL) {
      return(bitwOr(sign, bitwOr(0x7c00L, if (mant != 0) 0x200L else 0L)))
    }
    e <- raw_exp - 127L + 15L
    if (e >= 31L) {
      return(bitwOr(sign, 0x7c00L))
    }
    if (e <= 0L) {
      if (e < -10L) {
        return(sign)
      }
      mant <- bitwOr(mant, 0x800000L)
      shift <- 14L - e
      half <- bitwShiftR(mant, shift)
      rem <- bitwAnd(mant, bitwShiftL(1L, shift) - 1L)
      mid <- bitwShiftL(1L, shift - 1L)
      if (rem > mid || (rem == mid && bitwAnd(half, 1L) == 1L)) half <- half + 1L
      return(bitwOr(sign, half))
    }
    half <- bitwOr(bitwShiftL(e, 10L), bitwShiftR(mant, 13L))
    rem <- bitwAnd(mant, 0x1fffL)
    if (rem > 0x1000L || (rem == 0x1000L && bitwAnd(half, 1L) == 1L)) half <- half + 1L
    bitwOr(sign, half)
  }, integer(1))
}

#' Decode and encode SPDF vector blobs
#'
#' `spdf_vector_decode()` turns the little-endian bytes of a vector into doubles;
#' `spdf_vector_encode()` quantizes doubles as a writer must (f32 and f16 round to
#' nearest even and refuse overflow; i8 is `clamp(round_half_away(v * 127), -127, 127)`).
#'
#' @param data A raw vector.
#' @param values A numeric vector.
#' @param dtype One of `"f32"`, `"f16"`, `"i8"`.
#' @return A numeric vector (decode) or a raw vector (encode).
#' @examples
#' spdf_vector_decode(spdf_vector_encode(c(0.5, -1), "f16"), "f16")
#' @export
spdf_vector_decode <- function(data, dtype = "f32") {
  data <- as.raw(data)
  switch(dtype,
    f32 = readBin(data, "double", n = length(data) %/% 4L, size = 4, endian = "little"),
    f16 = half_to_double(readBin(data, "integer", n = length(data) %/% 2L, size = 2, signed = FALSE, endian = "little")),
    i8 = readBin(data, "integer", n = length(data), size = 1, signed = TRUE) / 127,
    spdf_abort("E032", paste("unknown dtype", dtype))
  )
}

#' @rdname spdf_vector_decode
#' @export
spdf_vector_encode <- function(values, dtype = "f32") {
  values <- as.numeric(values)
  switch(dtype,
    f32 = {
      out <- writeBin(values, raw(), size = 4, endian = "little")
      back <- readBin(out, "double", n = length(values), size = 4, endian = "little")
      if (any(is.infinite(back) & !is.infinite(values))) spdf_abort("E030", "value out of range for f32")
      out
    },
    f16 = {
      h <- double_to_half(values)
      if (any(bitwAnd(h, 0x7fffL) == 0x7c00L & !is.infinite(values))) spdf_abort("E030", "value out of range for f16")
      writeBin(as.integer(h), raw(), size = 2, endian = "little")
    },
    i8 = {
      y <- values * 127
      q <- floor(abs(y) + 0.5) * ifelse(y >= 0, 1, -1)
      q <- pmax(-127, pmin(127, q)) # also clamps v * 127 overflowing to infinity
      writeBin(as.integer(q), raw(), size = 1)
    },
    spdf_abort("E032", paste("unknown dtype", dtype))
  )
}
