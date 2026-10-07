package io.github.joseluissaorin.spdf

import java.text.Normalizer
import java.util.Locale

// Unicode helpers. SPDF counts in code points (never UTF-16 units) on NFC text.

internal fun nfc(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFC)

internal fun nfd(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFD)

// Android API 23 compatibility: no CharSequence.codePoints(), java.util.Base64, java.nio.file
// or java.time in this module.
internal fun codePoints(s: String): IntArray {
    val out = IntArray(s.codePointCount(0, s.length))
    var i = 0
    var k = 0
    while (i < s.length) {
        val cp = s.codePointAt(i)
        out[k++] = cp
        i += Character.charCount(cp)
    }
    return out
}

private const val B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** Strict standard base64 (RFC 4648 §4, padding required, nothing outside the alphabet). */
internal fun base64Decode(s: String): ByteArray {
    if (s.length % 4 != 0) throw IllegalArgumentException("bad base64 length")
    val pad = when {
        s.endsWith("==") -> 2
        s.endsWith("=") -> 1
        else -> 0
    }
    val out = java.io.ByteArrayOutputStream(s.length / 4 * 3)
    var i = 0
    while (i < s.length) {
        var v = 0
        for (k in 0 until 4) {
            val c = s[i + k]
            val d = if (c == '=' && i + 4 == s.length && k >= 4 - pad) 0 else B64.indexOf(c)
            if (d < 0) throw IllegalArgumentException("bad base64 character")
            v = (v shl 6) or d
        }
        out.write(v shr 16)
        if (!(i + 4 == s.length && pad == 2)) out.write((v shr 8) and 0xff)
        if (!(i + 4 == s.length && pad >= 1)) out.write(v and 0xff)
        i += 4
    }
    return out.toByteArray()
}

/** Standard base64 with padding. */
internal fun base64Encode(b: ByteArray): String {
    val sb = StringBuilder((b.size + 2) / 3 * 4)
    var i = 0
    while (i < b.size) {
        val n = minOf(3, b.size - i)
        var v = 0
        for (k in 0 until 3) v = (v shl 8) or (if (k < n) b[i + k].toInt() and 0xff else 0)
        for (k in 0 until 4) sb.append(if (k <= n) B64[(v shr (18 - 6 * k)) and 63] else '=')
        i += 3
    }
    return sb.toString()
}

internal fun codePointLength(s: String): Int = s.codePointCount(0, s.length)

internal fun fromCodePoints(cps: IntArray, from: Int = 0, to: Int = cps.size): String = String(cps, from, to - from)

/** Unicode general category L*, M* or N*. */
internal fun isWordCodePoint(cp: Int): Boolean = when (Character.getType(cp)) {
    Character.UPPERCASE_LETTER.toInt(), Character.LOWERCASE_LETTER.toInt(), Character.TITLECASE_LETTER.toInt(),
    Character.MODIFIER_LETTER.toInt(), Character.OTHER_LETTER.toInt(),
    Character.NON_SPACING_MARK.toInt(), Character.ENCLOSING_MARK.toInt(), Character.COMBINING_SPACING_MARK.toInt(),
    Character.DECIMAL_DIGIT_NUMBER.toInt(), Character.LETTER_NUMBER.toInt(), Character.OTHER_NUMBER.toInt(),
    -> true
    else -> false
}

internal fun lower(s: String): String = s.lowercase(Locale.ROOT)

/** Compares by code points (= UTF-8 byte order = SQLite BINARY), not by UTF-16 units. */
internal val codePointOrder: Comparator<String> = Comparator { a, b ->
    var i = 0
    var j = 0
    while (i < a.length && j < b.length) {
        val ca = a.codePointAt(i)
        val cb = b.codePointAt(j)
        if (ca != cb) return@Comparator ca.compareTo(cb)
        i += Character.charCount(ca)
        j += Character.charCount(cb)
    }
    (a.length - i).compareTo(b.length - j)
}

/** Unsigned lexicographic order of byte arrays. */
internal val byteOrder: Comparator<ByteArray> = Comparator { a, b ->
    val n = minOf(a.size, b.size)
    for (k in 0 until n) {
        val x = a[k].toInt() and 0xff
        val y = b[k].toInt() and 0xff
        if (x != y) return@Comparator x - y
    }
    a.size - b.size
}

internal fun hex(bytes: ByteArray): String {
    val digits = "0123456789abcdef"
    val sb = StringBuilder(bytes.size * 2)
    for (b in bytes) {
        val v = b.toInt() and 0xff
        sb.append(digits[v shr 4]).append(digits[v and 15])
    }
    return sb.toString()
}

internal fun sha256(): java.security.MessageDigest = java.security.MessageDigest.getInstance("SHA-256")

internal fun sha256Hex(bytes: ByteArray): String = hex(sha256().digest(bytes))

/** Python truthiness of a JSON value. */
internal fun truthy(v: Any?): Boolean = when (v) {
    null -> false
    is Boolean -> v
    is Long -> v != 0L
    is Double -> v != 0.0
    is Number -> v.toDouble() != 0.0
    is String -> v.isNotEmpty()
    is Collection<*> -> v.isNotEmpty()
    is Map<*, *> -> v.isNotEmpty()
    else -> true
}

/** Python `str()` of a JSON scalar (ints plain, floats as `repr`). */
internal fun pyStr(v: Any?): String = when (v) {
    null -> "None"
    true -> "True"
    false -> "False"
    is Long -> v.toString()
    is Double -> Json.pythonRepr(v)
    is String -> v
    else -> Json.compact(v)
}

/** Python `==` between JSON values (numbers by value, so 1 == 1.0). */
internal fun pyEquals(a: Any?, b: Any?): Boolean {
    if ((a is Long || a is Double) && (b is Long || b is Double)) {
        if (a is Long && b is Long) return a == b
        return (a as Number).toDouble() == (b as Number).toDouble()
    }
    if (a is Map<*, *> && b is Map<*, *>) {
        if (a.size != b.size) return false
        return a.all { (k, v) -> b.containsKey(k) && pyEquals(v, b[k]) }
    }
    if (a is List<*> && b is List<*>) {
        return a.size == b.size && a.indices.all { pyEquals(a[it], b[it]) }
    }
    return a == b
}

/** A JSON number with an integral value (10 and 10.0 are the same JSON value). */
internal fun isIntegral(v: Any?): Boolean = when (v) {
    is Long -> true
    is Double -> !v.isInfinite() && !v.isNaN() && v == Math.floor(v)
    else -> false
}

internal fun isNumber(v: Any?): Boolean = v is Long || v is Double

/** The value of an integral JSON number as Long, else null. */
internal fun integralValue(v: Any?): Long? = when (v) {
    is Long -> v
    is Double -> if (isIntegral(v) && Math.abs(v) < 9.2e18) v.toLong() else null
    else -> null
}

internal fun numberValue(v: Any?): Double? = when (v) {
    is Long -> v.toDouble()
    is Double -> v
    else -> null
}

@Suppress("UNCHECKED_CAST")
internal fun asMap(v: Any?): Map<String, Any?>? = v as? Map<String, Any?>

internal fun asList(v: Any?): List<Any?>? = v as? List<Any?>
