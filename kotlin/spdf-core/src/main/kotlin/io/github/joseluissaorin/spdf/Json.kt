package io.github.joseluissaorin.spdf

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

/** An object that has a JSON form (a tree of the types [Json] works with). */
public interface JsonConvertible {
    /** The JSON form: null, Boolean, Long, Double, String, List or Map with String keys. */
    public fun toJson(): Any?
}

/**
 * JSON as SPDF needs it. Parsed values are plain trees: `null`, [Boolean], [Long] (numbers
 * written without `.`, `e` or `E`), [Double] (every other number), [String], [List] and
 * [Map] (insertion-ordered, String keys).
 *
 * [canonical] is RFC 8785 (JCS) after rounding every non-integer number to six decimals,
 * which is the serialization the SPDF dump and `content_sha256` are defined on.
 */
public object Json {
    // ------------------------------------------------------------------ parsing

    /** Parses one JSON value (RFC 8259, strict: no NaN, no trailing data). */
    @JvmStatic
    public fun parse(text: String): Any? = Parser(text).parseDocument()

    /** Parses a JSON object. */
    @JvmStatic
    public fun parseObject(text: String): Map<String, Any?> {
        val v = parse(text)
        @Suppress("UNCHECKED_CAST")
        return v as? Map<String, Any?> ?: throw SpdfException(null, "JSON value is not an object")
    }

    private class Parser(val s: String) {
        var i = 0

        fun parseDocument(): Any? {
            skipWs()
            val v = value()
            skipWs()
            if (i != s.length) fail("trailing data after JSON value")
            return v
        }

        fun fail(msg: String): Nothing = throw SpdfException(null, "invalid JSON at offset $i: $msg")

        fun skipWs() {
            while (i < s.length) {
                val c = s[i]
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++ else break
            }
        }

        fun value(): Any? {
            if (i >= s.length) fail("unexpected end")
            return when (val c = s[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c in '0'..'9') num() else fail("unexpected character '$c'")
            }
        }

        fun literal(word: String, v: Any?): Any? {
            if (!s.startsWith(word, i)) fail("bad literal")
            i += word.length
            return v
        }

        fun obj(): Map<String, Any?> {
            val m = LinkedHashMap<String, Any?>()
            i++
            skipWs()
            if (i < s.length && s[i] == '}') {
                i++
                return m
            }
            while (true) {
                skipWs()
                if (i >= s.length || s[i] != '"') fail("expected a string key")
                val k = str()
                skipWs()
                if (i >= s.length || s[i] != ':') fail("expected ':'")
                i++
                skipWs()
                m[k] = value()
                skipWs()
                if (i >= s.length) fail("unterminated object")
                when (s[i]) {
                    ',' -> i++
                    '}' -> {
                        i++
                        return m
                    }
                    else -> fail("expected ',' or '}'")
                }
            }
        }

        fun arr(): List<Any?> {
            val l = ArrayList<Any?>()
            i++
            skipWs()
            if (i < s.length && s[i] == ']') {
                i++
                return l
            }
            while (true) {
                skipWs()
                l.add(value())
                skipWs()
                if (i >= s.length) fail("unterminated array")
                when (s[i]) {
                    ',' -> i++
                    ']' -> {
                        i++
                        return l
                    }
                    else -> fail("expected ',' or ']'")
                }
            }
        }

        fun str(): String {
            i++ // opening quote
            val b = StringBuilder()
            while (true) {
                if (i >= s.length) fail("unterminated string")
                val c = s[i]
                when {
                    c == '"' -> {
                        i++
                        return b.toString()
                    }
                    c == '\\' -> {
                        if (i + 1 >= s.length) fail("bad escape")
                        when (val e = s[i + 1]) {
                            '"' -> b.append('"')
                            '\\' -> b.append('\\')
                            '/' -> b.append('/')
                            'b' -> b.append('\b')
                            'f' -> b.append('\u000c')
                            'n' -> b.append('\n')
                            'r' -> b.append('\r')
                            't' -> b.append('\t')
                            'u' -> {
                                if (i + 6 > s.length) fail("bad \\u escape")
                                val hex = s.substring(i + 2, i + 6)
                                if (!hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) fail("bad \\u escape")
                                b.append(hex.toInt(16).toChar())
                                i += 4
                            }
                            else -> fail("bad escape \\$e")
                        }
                        i += 2
                    }
                    c < ' ' -> fail("control character in string")
                    else -> {
                        b.append(c)
                        i++
                    }
                }
            }
        }

        fun num(): Any {
            val start = i
            if (s[i] == '-') i++
            if (i >= s.length) fail("bad number")
            if (s[i] == '0') {
                i++
            } else if (s[i] in '1'..'9') {
                while (i < s.length && s[i] in '0'..'9') i++
            } else {
                fail("bad number")
            }
            var integral = true
            if (i < s.length && s[i] == '.') {
                integral = false
                i++
                val d = i
                while (i < s.length && s[i] in '0'..'9') i++
                if (i == d) fail("bad fraction")
            }
            if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
                integral = false
                i++
                if (i < s.length && (s[i] == '+' || s[i] == '-')) i++
                val d = i
                while (i < s.length && s[i] in '0'..'9') i++
                if (i == d) fail("bad exponent")
            }
            val text = s.substring(start, i)
            if (integral) {
                text.toLongOrNull()?.let { return it }
            }
            return text.toDouble()
        }
    }

    // ------------------------------------------------------------- normalizing

    /**
     * Converts any supported value to the plain JSON tree (Long/Double numbers, Lists, Maps).
     * Accepts [JsonConvertible], arrays, Iterables, Int/Float and friends.
     */
    @JvmStatic
    public fun toTree(value: Any?): Any? = when (value) {
        null, is Boolean, is String, is Long, is Double -> value
        is Int -> value.toLong()
        is Short -> value.toLong()
        is Byte -> value.toLong()
        is Float -> value.toDouble()
        is java.math.BigInteger -> if (value.bitLength() < 64) value.toLong() else value.toDouble()
        is BigDecimal -> value.toDouble()
        is Number -> value.toDouble()
        is JsonConvertible -> toTree(value.toJson())
        is Map<*, *> -> {
            val m = LinkedHashMap<String, Any?>()
            for ((k, v) in value) m[k as? String ?: k.toString()] = toTree(v)
            m
        }
        is Iterable<*> -> value.map { toTree(it) }
        is Array<*> -> value.map { toTree(it) }
        is LongArray -> value.map { it }
        is IntArray -> value.map { it.toLong() }
        is DoubleArray -> value.map { it }
        is FloatArray -> value.map { it.toDouble() }
        is CharSequence -> value.toString()
        else -> throw SpdfException(null, "not a JSON value: ${value::class.java.name}")
    }

    /**
     * Rounds every non-integer number to six decimals (half to even on the exact binary value),
     * turns integral results below 2^53 into [Long] and -0 into 0 (SPEC canonical form).
     */
    @JvmStatic
    public fun canon(value: Any?): Any? = when (val v = toTree(value)) {
        is Double -> {
            val r = round6(v)
            if (!r.isNaN() && !r.isInfinite() && r == Math.floor(r) && Math.abs(r) < TWO_53) r.toLong() else r
        }
        is Map<*, *> -> {
            val m = LinkedHashMap<String, Any?>()
            for ((k, x) in v) m[k as String] = canon(x)
            m
        }
        is List<*> -> v.map { canon(it) }
        else -> v
    }

    private const val TWO_53 = 9007199254740992.0

    /** Rounds to six decimals, half to even on the exact binary value; -0 becomes 0. */
    @JvmStatic
    public fun round6(x: Double): Double = roundTo(x, 6)

    /** Rounds to [decimals] decimals, half to even on the exact binary value; -0 becomes 0. */
    @JvmStatic
    public fun roundTo(x: Double, decimals: Int): Double {
        if (x.isNaN() || x.isInfinite()) return x
        val r = BigDecimal(x).setScale(decimals, RoundingMode.HALF_EVEN).toDouble()
        return if (r == 0.0) 0.0 else r
    }

    // ------------------------------------------------------------- serializing

    /** RFC 8785 (JCS) of the canonical form of [value]: what `content_sha256` hashes. */
    @JvmStatic
    public fun canonical(value: Any?): String {
        val b = StringBuilder()
        write(b, canon(value))
        return b.toString()
    }

    /** JCS layout (sorted keys, no whitespace, shortest numbers) without rounding numbers. */
    @JvmStatic
    public fun compact(value: Any?): String {
        val b = StringBuilder()
        write(b, toTree(value))
        return b.toString()
    }

    /** Indented form with the same key order and number form as JCS (for people). */
    @JvmStatic
    public fun pretty(value: Any?): String {
        val b = StringBuilder()
        writePretty(b, toTree(value), 0)
        return b.toString()
    }

    private fun write(b: StringBuilder, v: Any?) {
        when (v) {
            null -> b.append("null")
            true -> b.append("true")
            false -> b.append("false")
            is Long -> b.append(v.toString())
            is Double -> b.append(formatNumber(v))
            is String -> writeString(b, v)
            is List<*> -> {
                b.append('[')
                v.forEachIndexed { idx, e ->
                    if (idx > 0) b.append(',')
                    write(b, e)
                }
                b.append(']')
            }
            is Map<*, *> -> {
                b.append('{')
                val keys = v.keys.map { it as String }.sorted() // String order = UTF-16 code units
                keys.forEachIndexed { idx, k ->
                    if (idx > 0) b.append(',')
                    writeString(b, k)
                    b.append(':')
                    write(b, v[k])
                }
                b.append('}')
            }
            else -> write(b, toTree(v))
        }
    }

    private fun writePretty(b: StringBuilder, v: Any?, level: Int) {
        val pad = "  ".repeat(level + 1)
        val end = "  ".repeat(level)
        when (v) {
            is List<*> -> {
                if (v.isEmpty()) {
                    b.append("[]")
                } else if (v.none { it is List<*> || it is Map<*, *> }) {
                    b.append('[')
                    v.forEachIndexed { i, e ->
                        if (i > 0) b.append(", ")
                        write(b, e)
                    }
                    b.append(']')
                } else {
                    b.append("[\n")
                    v.forEachIndexed { i, e ->
                        if (i > 0) b.append(",\n")
                        b.append(pad)
                        writePretty(b, e, level + 1)
                    }
                    b.append('\n').append(end).append(']')
                }
            }
            is Map<*, *> -> {
                if (v.isEmpty()) {
                    b.append("{}")
                } else {
                    b.append("{\n")
                    v.keys.map { it as String }.sorted().forEachIndexed { i, k ->
                        if (i > 0) b.append(",\n")
                        b.append(pad)
                        writeString(b, k)
                        b.append(": ")
                        writePretty(b, v[k], level + 1)
                    }
                    b.append('\n').append(end).append('}')
                }
            }
            else -> write(b, v)
        }
    }

    private fun writeString(b: StringBuilder, s: String) {
        b.append('"')
        for (c in s) {
            when {
                c == '"' -> b.append("\\\"")
                c == '\\' -> b.append("\\\\")
                c == '\b' -> b.append("\\b")
                c == '\u000c' -> b.append("\\f")
                c == '\n' -> b.append("\\n")
                c == '\r' -> b.append("\\r")
                c == '\t' -> b.append("\\t")
                c < ' ' -> b.append("\\u00").append(HEX[c.code shr 4]).append(HEX[c.code and 15])
                else -> b.append(c)
            }
        }
        b.append('"')
    }

    private const val HEX = "0123456789abcdef"

    /**
     * ECMAScript `Number::toString` (the number form of RFC 8785): the shortest decimal that
     * round-trips, laid out as JavaScript does (`1`, `0.5`, `1e+21`, `1e-7`).
     */
    @JvmStatic
    public fun formatNumber(x: Double): String {
        if (x.isNaN() || x.isInfinite()) throw SpdfException(null, "NaN and infinities are not allowed in SPDF JSON")
        if (x == 0.0) return "0"
        val sign = if (x < 0) "-" else ""
        val (digits, n) = shortestDigits(Math.abs(x))
        val k = digits.length
        val s = when {
            n in k..21 -> digits + "0".repeat(n - k)
            n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
            n in -5..0 -> "0." + "0".repeat(-n) + digits
            else -> {
                val e = n - 1
                val es = (if (e > 0) "+" else "-") + Math.abs(e)
                if (k == 1) digits + "e" + es else digits[0] + "." + digits.substring(1) + "e" + es
            }
        }
        return sign + s
    }

    /**
     * The shortest digit string d1…dk (no trailing zeros) and the position n of the decimal
     * point such that 0.d1…dk × 10^n parses back to [x] (x > 0). Among the shortest
     * candidates, the one closest to x (David Gay's shortest mode, as Python's repr).
     */
    internal fun shortestDigits(x: Double): Pair<String, Int> {
        val exact = BigDecimal(x)
        for (p in 1..17) {
            val down = exact.round(MathContext(p, RoundingMode.FLOOR))
            val up = exact.round(MathContext(p, RoundingMode.CEILING))
            val okDown = down.toDouble() == x
            val okUp = up.toDouble() == x
            val pick = when {
                okDown && okUp -> exact.round(MathContext(p, RoundingMode.HALF_EVEN))
                okDown -> down
                okUp -> up
                else -> null
            } ?: continue
            return layout(pick)
        }
        return layout(exact.round(MathContext(17, RoundingMode.HALF_EVEN)))
    }

    private fun layout(d: BigDecimal): Pair<String, Int> {
        val t = d.stripTrailingZeros()
        val digits = t.unscaledValue().abs().toString()
        return digits to (digits.length - t.scale())
    }

    /** Python `repr(float)` (used where the reference prints a number with `str()`). */
    internal fun pythonRepr(x: Double): String {
        if (x.isNaN()) return "nan"
        if (x.isInfinite()) return if (x > 0) "inf" else "-inf"
        if (x == 0.0) return if (1.0 / x < 0) "-0.0" else "0.0"
        val sign = if (x < 0) "-" else ""
        val (digits, n) = shortestDigits(Math.abs(x))
        val e = n - 1 // exponent of the first digit
        val s = if (e < -4 || e >= 16) {
            val mant = if (digits.length == 1) digits else digits[0] + "." + digits.substring(1)
            mant + "e" + (if (e < 0) "-" else "+") + Math.abs(e).toString().padStart(2, '0')
        } else if (n <= 0) {
            "0." + "0".repeat(-n) + digits
        } else if (n >= digits.length) {
            digits + "0".repeat(n - digits.length) + ".0"
        } else {
            digits.substring(0, n) + "." + digits.substring(n)
        }
        return sign + s
    }

    // ------------------------------------------------------------- comparing

    /** Structural equality; numbers compare as doubles after six-decimal rounding (1 == 1.0). */
    @JvmStatic
    public fun equivalent(a: Any?, b: Any?): Boolean = diff(a, b) == null

    /** The first difference between two trees as `path: a != b`, or null when equivalent. */
    @JvmStatic
    public fun diff(a: Any?, b: Any?): String? = diffAt(toTree(a), toTree(b), "")

    private fun diffAt(a: Any?, b: Any?, path: String): String? {
        val here = path.ifEmpty { "/" }
        if (a is Long || a is Double) {
            val fa = (a as Number).toDouble()
            val fb = (b as? Long)?.toDouble() ?: (b as? Double)
            return if (fb == null || round6(fa) != round6(fb)) "$here: ${short(a)} != ${short(b)}" else null
        }
        return when (a) {
            null -> if (b == null) null else "$here: null != ${short(b)}"
            is Boolean, is String -> if (a == b) null else "$here: ${short(a)} != ${short(b)}"
            is List<*> -> {
                if (b !is List<*>) return "$here: array != ${short(b)}"
                if (a.size != b.size) return "$here: length ${a.size} != ${b.size}"
                for (i in a.indices) diffAt(a[i], b[i], "$path/$i")?.let { return it }
                null
            }
            is Map<*, *> -> {
                if (b !is Map<*, *>) return "$here: object != ${short(b)}"
                for (k in (a.keys + b.keys).map { it as String }.sorted()) {
                    if (!a.containsKey(k)) return "$path/$k: missing != ${short(b[k])}"
                    if (!b.containsKey(k)) return "$path/$k: ${short(a[k])} != missing"
                    diffAt(a[k], b[k], "$path/$k")?.let { return it }
                }
                null
            }
            else -> if (compact(a) == compact(b)) null else "$here: ${short(a)} != ${short(b)}"
        }
    }

    private fun short(v: Any?): String {
        val s = try {
            compact(v)
        } catch (e: SpdfException) {
            v.toString()
        }
        return if (s.length > 200) s.substring(0, 200) + "…" else s
    }
}
