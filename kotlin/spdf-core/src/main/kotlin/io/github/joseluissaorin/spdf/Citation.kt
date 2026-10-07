package io.github.joseluissaorin.spdf

/**
 * Short author-date citations (SPEC §16, CONTRACT §10): `(Names, Year, locator)` in Spanish
 * (`es`) or English (any other locale).
 */
public object Citation {
    private val VOWELS = codePoints("aeiouáéíóúü").toSet()

    /**
     * Cites [anchor] (and the optional [end] anchor of a range) of the work described by the
     * CSL-JSON item [metadata]. [locale] `es`/`es-ES` gives Spanish; anything else English.
     */
    @JvmStatic
    @JvmOverloads
    public fun cite(anchor: Anchor, end: Anchor?, metadata: Map<String, Any?>, locale: String = "en"): String {
        val es = lower(locale.split("-")[0]) == "es"
        val md = asMap(Json.toTree(metadata)) ?: emptyMap()
        val names = (asList(md["author"]) ?: emptyList()).map { name(it) }.filter { truthy(it) }.map { pyStr(it) }
        val who = when (names.size) {
            0 -> shortTitle(md)
            1 -> names[0]
            2 -> names[0] + (if (es) (if (startsWithISound(names[1])) " e " else " y ") else " and ") + names[1]
            else -> names[0] + " et al."
        }
        val year = year(md, es) ?: if (es) "s. f." else "n.d."
        val loc = locator(anchor, end?.takeIf { it.members.isNotEmpty() }, es)
        val parts = mutableListOf(who, year)
        if (!loc.isNullOrEmpty()) parts += loc
        return "(" + parts.joinToString(", ") + ")"
    }

    private fun name(a: Any?): Any? {
        if (a is String) return a
        val m = asMap(a) ?: return null
        if (truthy(m["literal"])) return m["literal"]
        if (truthy(m["family"])) {
            val ndp = m["non-dropping-particle"]
            return (if (truthy(ndp)) pyStr(ndp) + " " else "") + pyStr(m["family"])
        }
        return if (m.containsKey("given")) m["given"] else ""
    }

    /** The name begins with the sound /i/ (i, í, hi, hí) not followed by a vowel: `y` becomes `e`. */
    internal fun startsWithISound(s: String): Boolean {
        val low = codePoints(lower(s))
        val i = 'i'.code
        val iAcute = 'í'.code
        val rest = when {
            low.size >= 2 && low[0] == 'h'.code && (low[1] == i || low[1] == iAcute) -> 2
            low.isNotEmpty() && (low[0] == i || low[0] == iAcute) -> 1
            else -> return false
        }
        return !(low.size > rest && low[rest] in VOWELS)
    }

    private fun shortTitle(m: Map<String, Any?>): String {
        if (truthy(m["title-short"])) return pyStr(m["title-short"])
        val t = m["title"].takeIf { truthy(it) }?.let { pyStr(it) } ?: ""
        return t.split(":")[0].trim()
    }

    private fun year(m: Map<String, Any?>, es: Boolean): String? {
        val issued = m["issued"].takeIf { truthy(it) } ?: return null
        val dp = asMap(issued)?.get("date-parts") ?: return null
        val list = asList(dp)?.takeIf { it.isNotEmpty() } ?: return null
        val first = asList(list[0])?.takeIf { it.isNotEmpty() } ?: return null
        val y: Long = when (val v = first[0]) {
            is Long -> v
            is Double -> if (v.isNaN() || v.isInfinite()) return null else v.toLong() // int() truncates
            is String -> v.trim().toLongOrNull() ?: return null
            is Boolean -> if (v) 1 else 0
            else -> return null
        }
        return if (y > 0) y.toString() else if (es) "${-y} a. C." else "${-y} BC"
    }

    private fun label(a: Map<String, Any?>): String? {
        val p = a["printed"] ?: return null
        val s = pyStr(p)
        return if (a["source"] == "inferred") "[$s]" else s
    }

    private fun pageLocator(a: Map<String, Any?>, e: Map<String, Any?>?, es: Boolean, single: String, plural: String): String {
        val first = label(a) ?: return if (es) "s. p." else "n. pag."
        if (e != null && pyEquals(e["type"], a["type"])) {
            val second = label(e)
            if (second != null && !pyEquals(e["printed"], a["printed"])) return "$plural $first-$second"
        }
        return "$single $first"
    }

    internal fun hms(t: Double): String {
        val s = Math.floor(t).toLong()
        val h = s.floorDiv(3600L)
        val m = s.mod(3600L).floorDiv(60L)
        val x = s.mod(60L)
        return if (h != 0L) "$h:${m.toString().padStart(2, '0')}:${x.toString().padStart(2, '0')}" else "$m:${x.toString().padStart(2, '0')}"
    }

    /** The locator part of a citation, or null (image anchors, unknown types). */
    @JvmStatic
    public fun locator(anchor: Anchor, end: Anchor?, es: Boolean): String? {
        val a = anchor.members
        val e = end?.members?.takeIf { it.isNotEmpty() }
        return when (anchor.type) {
            "page" -> when (a["foliation"]) {
                "leaf" -> pageLocator(a, e, es, "fol.", "fols.")
                "column" -> pageLocator(a, e, es, "col.", "cols.")
                else -> pageLocator(a, e, es, "p.", "pp.")
            }
            "time" -> {
                var s = hms(numberValue(a["t0"]) ?: return null)
                if (e != null && e["type"] == "time") s += "-" + hms(numberValue(e["t1"]) ?: return s)
                s
            }
            "section", "web" -> {
                if (a["printed"] != null) return pageLocator(a, e, es, "p.", "pp.")
                val parts = ArrayList<String>()
                val path = asList(a["path"])
                if (path != null && path.isNotEmpty()) parts += "§ " + pyStr(path.last())
                if (a["paragraph"] != null) parts += (if (es) "párr. " else "para. ") + pyStr(a["paragraph"])
                parts.joinToString(", ").ifEmpty { null }
            }
            "slide" -> (if (es) "diap. " else "slide ") + pyStr(a["n"])
            "sheet" -> {
                val rf = a["row_from"]
                val rt = a["row_to"]
                if (pyEquals(rf, rt)) {
                    "${pyStr(a["sheet"])}, ${if (es) "fila" else "row"} ${pyStr(rf)}"
                } else {
                    "${pyStr(a["sheet"])}, ${if (es) "filas" else "rows"} ${pyStr(rf)}-${pyStr(rt)}"
                }
            }
            "verse" -> {
                val lf = a["line_from"]
                val lt = a["line_to"]
                if (lt == null || pyEquals(lt, lf)) "v. ${pyStr(lf)}" else "vv. ${pyStr(lf)}-${pyStr(lt)}"
            }
            "canonical" -> a["ref"]?.let { pyStr(it) }
            else -> null
        }
    }
}
