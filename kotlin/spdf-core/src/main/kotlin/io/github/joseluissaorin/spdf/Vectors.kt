package io.github.joseluissaorin.spdf

/**
 * Vector encodings (SPEC §9): little-endian `f32`, `f16` (IEEE binary16) or `i8` (q / 127).
 * Writers quantize with [quantize]; readers decode with [decode].
 */
public object Vectors {
    /** Bytes per component of [dtype], or 0 if the dtype is unknown. */
    @JvmStatic
    public fun size(dtype: String?): Int = when (dtype) {
        "f32" -> 4
        "f16" -> 2
        "i8" -> 1
        else -> 0
    }

    /** IEEE binary16 bits to a double (exact). */
    @JvmStatic
    public fun halfToDouble(h: Int): Double {
        val sign = if (h and 0x8000 != 0) -1.0 else 1.0
        val exp = (h shr 10) and 0x1f
        val frac = (h and 0x3ff).toDouble()
        return when (exp) {
            0 -> sign * frac * Math.scalb(1.0, -24)
            31 -> if (frac == 0.0) sign * Double.POSITIVE_INFINITY else Double.NaN
            else -> sign * (1 + frac / 1024) * Math.scalb(1.0, exp - 15)
        }
    }

    /**
     * A double to IEEE binary16 bits, rounding to nearest even directly from the double (never
     * through float32, whose double rounding differs). Throws when a finite value overflows.
     */
    @JvmStatic
    public fun doubleToHalf(x: Double): Int {
        val sign = if (x < 0 || (x == 0.0 && 1.0 / x < 0)) 0x8000 else 0
        if (x.isNaN()) return sign or 0x7e00
        if (x.isInfinite()) return sign or 0x7c00
        val a = Math.abs(x)
        if (a == 0.0) return sign
        if (a < Math.scalb(1.0, -14)) {
            // Subnormal (or rounds up to the smallest normal, which the bit pattern handles).
            val m = Math.rint(a * Math.scalb(1.0, 24)).toInt()
            return sign or m
        }
        var e = Math.getExponent(a)
        var f = Math.rint((a / Math.scalb(1.0, e) - 1.0) * 1024).toInt()
        if (f == 1024) {
            f = 0
            e += 1
        }
        if (e > 15) throw SpdfException(null, "value $x out of range for f16")
        return sign or ((e + 15) shl 10) or f
    }

    /**
     * Writer-side encoding of float values (CONTRACT §2, conformance kind `quantize`):
     * `f32` and `f16` round to nearest even and fail on overflow; `i8` is
     * `clamp(round_half_away_from_zero(v × 127), −127, 127)`.
     */
    @JvmStatic
    public fun quantize(values: DoubleArray, dtype: String): ByteArray = when (dtype) {
        "i8" -> ByteArray(values.size) { i ->
            val x = values[i] * 127
            if (Math.abs(x) >= 127) {
                (if (x > 0) 127 else -127).toByte() // also when v × 127 overflows to infinity
            } else {
                val q = Math.floor(Math.abs(x) + 0.5) * (if (x >= 0) 1 else -1)
                q.coerceIn(-127.0, 127.0).toInt().toByte()
            }
        }
        "f32" -> {
            val out = ByteArray(values.size * 4)
            values.forEachIndexed { i, v ->
                val y = v.toFloat()
                if (y.isInfinite() && !v.isInfinite()) throw SpdfException(null, "value $v out of range for f32")
                putLE(out, i * 4, java.lang.Float.floatToRawIntBits(y).toLong(), 4)
            }
            out
        }
        "f16" -> {
            val out = ByteArray(values.size * 2)
            values.forEachIndexed { i, v -> putLE(out, i * 2, doubleToHalf(v).toLong(), 2) }
            out
        }
        else -> throw SpdfException("E032", "unknown dtype $dtype")
    }

    /** [quantize] for float input. */
    @JvmStatic
    public fun quantize(values: FloatArray, dtype: String): ByteArray =
        quantize(DoubleArray(values.size) { values[it].toDouble() }, dtype)

    /** Decodes a stored vector to doubles (f32 and f16 exactly, i8 as q / 127). */
    @JvmStatic
    public fun decode(data: ByteArray, dtype: String?): DoubleArray = when (dtype ?: "f32") {
        "f32" -> DoubleArray(data.size / 4) { i -> java.lang.Float.intBitsToFloat(getLE(data, i * 4, 4).toInt()).toDouble() }
        "f16" -> DoubleArray(data.size / 2) { i -> halfToDouble(getLE(data, i * 2, 2).toInt()) }
        "i8" -> DoubleArray(data.size) { i -> data[i].toDouble() / 127 }
        else -> throw SpdfException("E032", "unknown dtype $dtype")
    }

    /**
     * Encodes the values of a source file exactly (conformance `roundtrip`): `i8` values are
     * the stored integers (−127…127); `f32`/`f16` values must be exactly representable.
     */
    @JvmStatic
    public fun packExact(values: List<Any?>, dtype: String?): ByteArray = when (dtype ?: "f32") {
        "i8" -> ByteArray(values.size) { i ->
            val v = values[i]
            if (v !is Long || v < -127 || v > 127) throw SpdfException(null, "i8 values are integers in [-127, 127], got $v")
            v.toByte()
        }
        "f32", "f16" -> {
            val d = DoubleArray(values.size) { i -> numberValue(values[i]) ?: throw SpdfException(null, "vector value ${values[i]} is not a number") }
            val bytes = quantize(d, dtype ?: "f32")
            val back = decode(bytes, dtype ?: "f32")
            for (i in d.indices) {
                if (back[i] != d[i] && !d[i].isNaN()) throw SpdfException(null, "$dtype value ${d[i]} is not exactly representable")
            }
            bytes
        }
        else -> throw SpdfException("E032", "unknown dtype $dtype")
    }

    internal fun putLE(out: ByteArray, at: Int, v: Long, n: Int) {
        for (k in 0 until n) out[at + k] = (v shr (8 * k)).toByte()
    }

    internal fun getLE(data: ByteArray, at: Int, n: Int): Long {
        var v = 0L
        for (k in 0 until n) v = v or ((data[at + k].toLong() and 0xff) shl (8 * k))
        return v
    }
}
