package io.github.joseluissaorin.spdf

/**
 * An anchor (SPEC §5): a JSON object saying where a passage is (`page`, `time`, `section`,
 * `slide`, `sheet`, `web`, `image`, `verse`, `canonical`). Kept as a generic object so
 * members this version does not know survive a round trip. Immutable.
 */
public class Anchor(members: Map<String, Any?>) : JsonConvertible {
    /** All members, in their original order. */
    public val members: Map<String, Any?> = java.util.Collections.unmodifiableMap(LinkedHashMap(asMap(Json.toTree(members)) ?: emptyMap()))

    /** The `type` member, or null. */
    public val type: String? get() = members["type"] as? String

    /** True if the member is present (even if null). */
    public fun has(key: String): Boolean = members.containsKey(key)

    /** A member as a raw JSON value. */
    public operator fun get(key: String): Any? = members[key]

    /** A string member. */
    public fun string(key: String): String? = members[key] as? String

    /** An integral number member (1 and 1.0 both count). */
    public fun long(key: String): Long? = integralValue(members[key])

    /** A numeric member. */
    public fun number(key: String): Double? = numberValue(members[key])

    /** The `path` member (section and web anchors), if it is a list of strings. */
    public fun path(): List<String>? {
        val l = asList(members["path"]) ?: return null
        return if (l.all { it is String }) l.map { it as String } else null
    }

    /** The `region` member, if well formed. */
    public fun region(): Region? {
        val m = asMap(members["region"]) ?: return null
        val x = numberValue(m["x"]) ?: return null
        val y = numberValue(m["y"]) ?: return null
        val w = numberValue(m["w"]) ?: return null
        val h = numberValue(m["h"]) ?: return null
        return Region(x, y, w, h)
    }

    /** The `chars` member `[start, end)` in code points, if well formed. */
    public fun chars(): LongArray? {
        val l = asList(members["chars"]) ?: return null
        if (l.size != 2) return null
        val a = integralValue(l[0]) ?: return null
        val b = integralValue(l[1]) ?: return null
        return longArrayOf(a, b)
    }

    /** A copy with one member set. */
    public fun with(key: String, value: Any?): Anchor = Anchor(LinkedHashMap(members).apply { put(key, Json.toTree(value)) })

    /** A copy without one member. */
    public fun without(key: String): Anchor = Anchor(LinkedHashMap(members).apply { remove(key) })

    override fun toJson(): Map<String, Any?> = members

    /** The anchor as compact JSON. */
    override fun toString(): String = Json.compact(members)

    override fun equals(other: Any?): Boolean = other is Anchor && Json.equivalent(members, other.members)

    override fun hashCode(): Int = Json.canonical(members).hashCode()

    public companion object {
        /** Parses anchor JSON (must be an object). */
        @JvmStatic
        public fun parse(json: String): Anchor = Anchor(Json.parseObject(json))

        /** Wraps a JSON object. */
        @JvmStatic
        public fun of(members: Map<String, Any?>): Anchor = Anchor(members)

        /** A page anchor. [printed] null means an unnumbered page. */
        @JvmStatic
        @JvmOverloads
        public fun page(physical: Long, printed: String?, source: String? = null, foliation: String? = null): Anchor {
            val m = linkedMapOf<String, Any?>("type" to "page", "physical" to physical, "printed" to printed)
            if (source != null) m["source"] = source
            if (foliation != null) m["foliation"] = foliation
            return Anchor(m)
        }

        /** A time anchor in seconds. */
        @JvmStatic
        @JvmOverloads
        public fun time(t0: Double, t1: Double, speaker: String? = null): Anchor {
            val m = linkedMapOf<String, Any?>("type" to "time", "t0" to t0, "t1" to t1)
            if (speaker != null) m["speaker"] = speaker
            return Anchor(m)
        }

        /** A section anchor (heading path, optional paragraph and printed folio). */
        @JvmStatic
        @JvmOverloads
        public fun section(path: List<String>, paragraph: Long? = null, printed: String? = null): Anchor {
            val m = linkedMapOf<String, Any?>("type" to "section", "path" to path)
            if (paragraph != null) m["paragraph"] = paragraph
            if (printed != null) m["printed"] = printed
            return Anchor(m)
        }

        /** A slide anchor. */
        @JvmStatic
        public fun slide(n: Long): Anchor = Anchor(linkedMapOf("type" to "slide", "n" to n))

        /** A spreadsheet anchor. */
        @JvmStatic
        public fun sheet(sheet: String, rowFrom: Long, rowTo: Long): Anchor =
            Anchor(linkedMapOf("type" to "sheet", "sheet" to sheet, "row_from" to rowFrom, "row_to" to rowTo))

        /** A verse anchor. */
        @JvmStatic
        @JvmOverloads
        public fun verse(lineFrom: Long, lineTo: Long? = null): Anchor {
            val m = linkedMapOf<String, Any?>("type" to "verse", "line_from" to lineFrom)
            if (lineTo != null) m["line_to"] = lineTo
            return Anchor(m)
        }

        /** A canonical reference (`stephanus` `514a`, `bible` `Gen.1.1`…). */
        @JvmStatic
        public fun canonical(scheme: String, ref: String): Anchor =
            Anchor(linkedMapOf("type" to "canonical", "scheme" to scheme, "ref" to ref))

        internal fun ofTree(v: Any?): Anchor? = asMap(v)?.let { Anchor(it) }
    }
}

/** A rectangle in fractions (0–1) of the unit image. */
public data class Region(val x: Double, val y: Double, val w: Double, val h: Double) : JsonConvertible {
    override fun toJson(): Map<String, Any?> = linkedMapOf("x" to x, "y" to y, "w" to w, "h" to h)
}

/** A canonical reference of a locator (`ref=stephanus:514a`). */
public data class CanonicalRef(val scheme: String, val ref: String) : JsonConvertible {
    override fun toJson(): Map<String, Any?> = linkedMapOf("scheme" to scheme, "ref" to ref)
}

/**
 * The parsed fragment of an anchor URI (SPEC §6, CONTRACT §3). Only the present members are
 * set. Numbers are already in canonical form (times and fractions rounded to six decimals).
 */
public data class Locator(
    val p: Long? = null,
    val pe: Long? = null,
    val f: String? = null,
    val fe: String? = null,
    val t: List<Double>? = null,
    val s: List<String>? = null,
    val para: Long? = null,
    val sl: Long? = null,
    val sh: String? = null,
    val rows: List<Long>? = null,
    val v: List<Long>? = null,
    val ref: CanonicalRef? = null,
    val char: List<Long>? = null,
    val xywh: List<Double>? = null,
) : JsonConvertible {
    /** The locator object of the conformance suite (only present keys). */
    override fun toJson(): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        p?.let { m["p"] = it }
        pe?.let { m["pe"] = it }
        f?.let { m["f"] = it }
        fe?.let { m["fe"] = it }
        t?.let { m["t"] = it }
        s?.let { m["s"] = it }
        para?.let { m["para"] = it }
        sl?.let { m["sl"] = it }
        sh?.let { m["sh"] = it }
        rows?.let { m["rows"] = it }
        v?.let { m["v"] = it }
        ref?.let { m["ref"] = it.toJson() }
        char?.let { m["char"] = it }
        xywh?.let { m["xywh"] = it }
        return m
    }

    public companion object {
        /** Builds a locator from its JSON form. */
        @JvmStatic
        public fun fromJson(m: Map<String, Any?>): Locator {
            fun longs(k: String) = asList(m[k])?.map { integralValue(it) ?: 0L }
            fun doubles(k: String) = asList(m[k])?.map { numberValue(it) ?: 0.0 }
            return Locator(
                p = integralValue(m["p"]),
                pe = integralValue(m["pe"]),
                f = m["f"] as? String,
                fe = m["fe"] as? String,
                t = doubles("t"),
                s = asList(m["s"])?.map { it as? String ?: pyStr(it) },
                para = integralValue(m["para"]),
                sl = integralValue(m["sl"]),
                sh = m["sh"] as? String,
                rows = longs("rows"),
                v = longs("v"),
                ref = asMap(m["ref"])?.let { CanonicalRef(it["scheme"] as? String ?: "", it["ref"] as? String ?: "") },
                char = longs("char"),
                xywh = doubles("xywh"),
            )
        }

        /** The locator of an anchor and an optional end anchor (ranges), as the reference builds it. */
        @JvmStatic
        @JvmOverloads
        public fun fromAnchor(anchor: Anchor, end: Anchor? = null): Locator {
            val a = anchor.members
            val e = end?.members?.takeIf { it.isNotEmpty() } // an empty end anchor counts as none
            var l = Locator()
            when (anchor.type) {
                "page" -> {
                    val p = integralValue(a["physical"])
                    l = l.copy(p = p, f = a["printed"] as? String)
                    if (e != null && e["type"] == "page") {
                        val pe = e["physical"]
                        if (pe != null && !pyEquals(pe, a["physical"])) l = l.copy(pe = integralValue(pe))
                        val fe = e["printed"]
                        if (fe != null && !pyEquals(fe, a["printed"])) l = l.copy(fe = fe as? String)
                    }
                }
                "time" -> {
                    val t0 = numberValue(a["t0"]) ?: 0.0
                    val t1 = if (e != null && e["type"] == "time") numberValue(e["t1"]) else numberValue(a["t1"])
                    l = l.copy(t = if (t1 == null) listOf(Json.round6(t0)) else listOf(Json.round6(t0), Json.round6(t1)))
                }
                "section", "web" -> {
                    anchor.path()?.takeIf { it.isNotEmpty() }?.let { l = l.copy(s = it) }
                    if (a["paragraph"] != null) l = l.copy(para = integralValue(a["paragraph"]))
                    val printed = a["printed"]
                    if (printed != null) {
                        l = l.copy(f = printed as? String)
                        val fe = e?.get("printed")
                        if (fe != null && !pyEquals(fe, printed)) l = l.copy(fe = fe as? String)
                    }
                }
                "slide" -> l = l.copy(sl = integralValue(a["n"]))
                "sheet" -> {
                    val rf = integralValue(a["row_from"])
                    val rt = integralValue(a["row_to"])
                    l = l.copy(sh = a["sheet"] as? String, rows = if (rf != null && rt != null) listOf(rf, rt) else null)
                }
                "verse" -> {
                    val lf = integralValue(a["line_from"])
                    val lt = a["line_to"]
                    if (lf != null) {
                        l = l.copy(v = if (lt == null || pyEquals(lt, a["line_from"])) listOf(lf) else listOf(lf, integralValue(lt) ?: lf))
                    }
                    if (a["printed"] != null) l = l.copy(f = a["printed"] as? String)
                }
                "canonical" -> l = l.copy(ref = CanonicalRef(a["scheme"] as? String ?: "", a["ref"] as? String ?: ""))
            }
            if (a["chars"] != null) {
                asList(a["chars"])?.let { c -> l = l.copy(char = c.map { integralValue(it) ?: 0L }) }
            }
            if (a["region"] != null) {
                anchor.region()?.let { r -> l = l.copy(xywh = listOf(r.x, r.y, r.w, r.h).map { Json.round6(it) }) }
            }
            return l
        }
    }
}

/** Anchor URIs: `spdf:<docref>#<params>` (SPEC §6). */
public object AnchorUri {
    private val SHA_REF = Regex("^sha256-[0-9a-f]{64}$")
    private val INT = Regex("^(0|[1-9][0-9]*)$")
    private val DEC = Regex("^[0-9]+(\\.[0-9]+)?$")
    private val CLOCK = Regex("^(?:([0-9]+):)?([0-5]?[0-9]):([0-5][0-9](?:\\.[0-9]+)?)$")

    /** The preferred document reference: `sha256-<lowercase hex>`. */
    @JvmStatic
    public fun docRef(sourceSha256: String): String = "sha256-" + lower(sourceSha256)

    /** Percent-encodes every UTF-8 byte except RFC 3986 unreserved characters (uppercase hex). */
    @JvmStatic
    public fun encode(s: String): String {
        val sb = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = b.toInt() and 0xff
            if (c in 'A'.code..'Z'.code || c in 'a'.code..'z'.code || c in '0'.code..'9'.code ||
                c == '-'.code || c == '.'.code || c == '_'.code || c == '~'.code
            ) {
                sb.append(c.toChar())
            } else {
                sb.append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 15])
            }
        }
        return sb.toString()
    }

    /** Decodes percent-escapes; a stray `%` or escapes that are not UTF-8 are errors. */
    @JvmStatic
    public fun decode(s: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < s.length) {
            if (s[i] != '%') {
                out.append(s[i])
                i++
                continue
            }
            // A run of consecutive %XX escapes is decoded as one strict UTF-8 sequence.
            val bytes = java.io.ByteArrayOutputStream()
            while (i < s.length && s[i] == '%') {
                if (i + 3 > s.length) fail("bad percent-encoding")
                val h = s.substring(i + 1, i + 3)
                if (!h.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) fail("bad percent-encoding")
                bytes.write(h.toInt(16))
                i += 3
            }
            val decoder = Charsets.UTF_8.newDecoder()
                .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
            try {
                out.append(decoder.decode(java.nio.ByteBuffer.wrap(bytes.toByteArray())))
            } catch (e: java.nio.charset.CharacterCodingException) {
                fail("percent-encoding is not UTF-8")
            }
        }
        return out.toString()
    }

    private fun fail(msg: String): Nothing = throw SpdfException(null, msg)

    /** The URI of an anchor (and optional end anchor) of the document [docref]. */
    @JvmStatic
    @JvmOverloads
    public fun format(docref: String, anchor: Anchor, end: Anchor? = null): String =
        format(docref, Locator.fromAnchor(anchor, end))

    /** The canonical URI of a locator (parameters in canonical order). */
    @JvmStatic
    public fun format(docref: String, l: Locator): String {
        val parts = ArrayList<String>()
        l.p?.let { parts += "p=$it" }
        l.pe?.let { parts += "pe=$it" }
        l.f?.let { parts += "f=" + encode(it) }
        l.fe?.let { parts += "fe=" + encode(it) }
        l.t?.let { t -> parts += "t=" + t.joinToString(",") { Json.formatNumber(Json.round6(it)) } }
        l.s?.let { s -> parts += "s=" + s.joinToString("/") { encode(it) } }
        l.para?.let { parts += "para=$it" }
        l.sl?.let { parts += "sl=$it" }
        l.sh?.let { parts += "sh=" + encode(it) }
        l.rows?.let { r -> if (r.size == 2) parts += "rows=${r[0]}-${r[1]}" }
        l.v?.let { v -> parts += "v=" + v.joinToString("-") }
        l.ref?.let { parts += "ref=" + encode(it.scheme) + ":" + encode(it.ref) }
        l.char?.let { c -> if (c.size == 2) parts += "char=${c[0]},${c[1]}" }
        l.xywh?.let { x ->
            if (x.size == 4) parts += "xywh=percent:" + x.joinToString(",") { Json.formatNumber(Json.roundTo(Json.round6(it) * 100, 4)) }
        }
        val ref = if (SHA_REF.matches(docref)) docref else encode(docref)
        return "spdf:" + ref + if (parts.isEmpty()) "" else "#" + parts.joinToString("&")
    }

    /** A parsed anchor URI. */
    public data class Parsed(val docref: String, val locator: Locator) : JsonConvertible {
        override fun toJson(): Map<String, Any?> = linkedMapOf("docref" to docref, "locator" to locator.toJson())

        /** The canonical form of the URI. */
        public fun canonical(): String = format(docref, locator)
    }

    private fun int(s: String): Long {
        if (!INT.matches(s)) fail("not an integer: $s")
        return s.toLongOrNull() ?: fail("integer out of range: $s")
    }

    private fun npt(s: String): Double {
        if (DEC.matches(s)) return s.toDouble()
        val m = CLOCK.matchEntire(s) ?: fail("bad time: $s")
        val h = m.groupValues[1].ifEmpty { "0" }.toLong()
        val min = m.groupValues[2].toLong()
        val sec = m.groupValues[3].toDouble()
        return Json.round6((h * 3600 + min * 60).toDouble() + sec)
    }

    /** Parses an anchor URI (strict: malformed values are errors; unknown parameters are ignored). */
    @JvmStatic
    public fun parse(uri: String): Parsed {
        if (!uri.startsWith("spdf:")) fail("not an spdf: URI")
        val rest = uri.substring(5)
        val hash = rest.indexOf('#')
        val rawRef = if (hash < 0) rest else rest.substring(0, hash)
        val frag = if (hash < 0) "" else rest.substring(hash + 1)
        if (rawRef.isEmpty()) fail("empty document reference")
        val docref = decode(rawRef)
        var l = Locator()
        val seen = HashSet<String>()
        if (frag.isNotEmpty()) {
            for (part in frag.split("&")) {
                if (part.isEmpty()) continue
                val eq = part.indexOf('=')
                if (eq < 0) fail("parameter without value: $part")
                val k = part.substring(0, eq)
                var v = part.substring(eq + 1)
                if (k in seen) fail("duplicate parameter $k")
                when (k) {
                    "p", "pe", "para", "sl" -> {
                        val n = int(v)
                        if (k != "para" && n < 1) fail("$k starts at 1")
                        l = when (k) {
                            "p" -> l.copy(p = n)
                            "pe" -> l.copy(pe = n)
                            "para" -> l.copy(para = n)
                            else -> l.copy(sl = n)
                        }
                    }
                    "f" -> l = l.copy(f = decode(v))
                    "fe" -> l = l.copy(fe = decode(v))
                    "sh" -> l = l.copy(sh = decode(v))
                    "t" -> {
                        if (v.startsWith("npt:")) v = v.substring(4)
                        val xs = v.split(",").map { npt(it) }
                        if (xs.size > 2 || (xs.size == 2 && xs[1] < xs[0])) fail("bad t")
                        l = l.copy(t = xs.map { Json.round6(it) })
                    }
                    "s" -> l = l.copy(s = v.split("/").map { decode(it) })
                    "rows" -> {
                        val dash = v.indexOf('-')
                        if (dash < 0) fail("rows needs a-b")
                        l = l.copy(rows = listOf(int(v.substring(0, dash)), int(v.substring(dash + 1))))
                    }
                    "v" -> {
                        val xs = v.split("-").map { int(it) }
                        if (xs.size > 2) fail("bad v")
                        l = l.copy(v = xs)
                    }
                    "ref" -> {
                        val colon = v.indexOf(':')
                        if (colon <= 0) fail("ref needs scheme:ref")
                        l = l.copy(ref = CanonicalRef(decode(v.substring(0, colon)), decode(v.substring(colon + 1))))
                    }
                    "char" -> {
                        val xs = v.split(",")
                        if (xs.size != 2) fail("char needs start,end")
                        val a = int(xs[0])
                        val b = int(xs[1])
                        if (b < a) fail("char end before start")
                        l = l.copy(char = listOf(a, b))
                    }
                    "xywh" -> {
                        if (!v.startsWith("percent:")) fail("xywh must use percent:")
                        val xs = v.substring(8).split(",")
                        if (xs.size != 4 || !xs.all { DEC.matches(it) }) fail("bad xywh")
                        l = l.copy(xywh = xs.map { Json.round6(it.toDouble() / 100) })
                    }
                    else -> continue // unknown parameters are ignored (and may repeat)
                }
                seen += k
            }
        }
        return Parsed(docref, l)
    }
}
