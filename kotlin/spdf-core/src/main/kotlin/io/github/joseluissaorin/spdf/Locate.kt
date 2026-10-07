package io.github.joseluissaorin.spdf

/** The result of [SpdfFile.locate] (SPEC §5.4). */
public data class Location(
    /** False when the reference names another document. */
    val document: Boolean,
    /** Ids of the units the reference designates, in reading order. */
    val units: List<String>,
    /** Ids of the fragments it designates (narrowed by `char` when present). */
    val fragments: List<String>,
    /** `char` range of the reference, `[start, end)` in code points, or null. */
    val char: List<Long>?,
    /** `xywh` region of the reference in fractions, or null. */
    val xywh: List<Double>?,
) : JsonConvertible {
    override fun toJson(): Map<String, Any?> =
        linkedMapOf("document" to document, "units" to units, "fragments" to fragments, "char" to char, "xywh" to xywh)

    public companion object {
        /** A reference to another document. */
        @JvmField
        public val ELSEWHERE: Location = Location(false, emptyList(), emptyList(), null, null)
    }
}

/** A citation of a quoted passage (SPEC §18.2): the short citation and the anchor URI of the passage. */
public data class PassageCitation(val text: String, val uri: String, val anchor: Anchor, val anchorEnd: Anchor?) : JsonConvertible {
    override fun toJson(): Map<String, Any?> = linkedMapOf("text" to text, "uri" to uri)
}

/** The matching rules of SPEC §5.4, one locator key at a time, and the unit identity of §4.4. */
internal object Locate {
    private val IDENTITY_SKIP = setOf("chars", "region")

    /** An anchor without `chars` and `region`: what identifies its unit. */
    fun identity(a: Map<String, Any?>): Map<String, Any?> = a.filterKeys { it !in IDENTITY_SKIP }

    /** `matter` of an anchor, `body` when absent (SPEC §4.1). */
    fun matterOf(a: Any?): String = asMap(a)?.get("matter") as? String ?: "body"

    /**
     * The unit where a fragment ends (SPEC §4.4): the first unit after its start unit, in `ord`
     * order, whose anchor equals [anchorEnd] ignoring `chars` and `region`. [units] are dump
     * rows (`id`, `anchor`) in `ord` order.
     */
    fun endUnit(units: List<Map<String, Any?>>, startId: Any?, anchorEnd: Any?): Map<String, Any?>? {
        val end = asMap(anchorEnd) ?: return null
        val want = identity(end)
        var after = false
        for (u in units) {
            if (u["id"] == startId) {
                after = true
                continue
            }
            val a = asMap(u["anchor"])
            if (after && a != null && pyEquals(identity(a), want)) return u
        }
        return null
    }

    private fun le(a: Any?, b: Any?): Boolean {
        val x = numberValue(a) ?: return false
        val y = numberValue(b) ?: return false
        return x <= y
    }

    fun matches(rule: String, l: Locator, anchor: Any?, printed: Any?): Boolean {
        val a = asMap(anchor) ?: return false
        val t = a["type"]
        return when (rule) {
            "p" -> t == "page" && isIntegral(a["physical"]) && le(l.p, a["physical"]) && le(a["physical"], l.pe ?: l.p)
            "f" -> pyEquals(printed ?: a["printed"], l.f)
            "t" -> {
                val x = l.t!![0]
                val t0 = numberValue(a["t0"])
                val t1 = numberValue(a["t1"])
                t == "time" && t0 != null && t1 != null && t0 <= x && x < t1
            }
            "sl" -> t == "slide" && pyEquals(a["n"], l.sl)
            "v" -> {
                val x = l.v!![0]
                val lf = a["line_from"]
                val lt = a["line_to"] ?: lf
                t == "verse" && isIntegral(lf) && le(lf, x) && le(x, lt)
            }
            "ref" -> t == "canonical" && a["scheme"] == l.ref!!.scheme && a["ref"] == l.ref.ref
            "s" -> {
                val path = a["path"]
                if ((t != "section" && t != "web") || path !is List<*>) return false
                val s = l.s!!
                if (l.para != null) {
                    pyEquals(path, s) && pyEquals(a["paragraph"], l.para)
                } else {
                    path.size >= s.size && pyEquals(path.subList(0, s.size), s)
                }
            }
            "sh" -> {
                if (t != "sheet" || a["sheet"] != l.sh) return false
                val rows = l.rows ?: return true
                val x = rows[0]
                isIntegral(a["row_from"]) && isIntegral(a["row_to"]) && le(a["row_from"], x) && le(x, a["row_to"])
            }
            else -> false
        }
    }
}
