package io.github.joseluissaorin.spdf

/**
 * Bibliographic exports (SPEC §19.1–19.3): CSL-JSON and BibTeX ([Structure] has ALTO, TEI and
 * IIIF). Exports never invent data: fields absent from the metadata are absent from
 * the export. Keys and fields follow SPEC §19 exactly, so every implementation produces the
 * same `\cite{}` keys.
 */
public object Export {
    private val TYPES = mapOf(
        "book" to "book", "article-journal" to "article", "article-magazine" to "article", "article-newspaper" to "article",
        "chapter" to "incollection", "paper-conference" to "inproceedings", "thesis" to "phdthesis", "report" to "techreport",
    )

    private val SIMPLE = listOf(
        "publisher" to "publisher", "publisher-place" to "address", "collection-title" to "series", "volume" to "volume",
        "issue" to "number", "page" to "pages", "edition" to "edition", "DOI" to "doi", "ISBN" to "isbn", "URL" to "url",
        "language" to "language", "note" to "note",
    )

    /** NFKD, keep only ASCII letters, lowercase. */
    private fun fold(s: String): String {
        val b = StringBuilder()
        for (ch in java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFKD)) {
            if (ch in 'A'..'Z' || ch in 'a'..'z') b.append(ch.lowercaseChar())
        }
        return b.toString()
    }

    private fun isSpace(cp: Int): Boolean = Character.isWhitespace(cp) || Character.isSpaceChar(cp)

    /** Splits on whitespace runs, keeping them as separate tokens (`re.split(r"(\s+)")`). */
    private fun tokens(s: String): List<String> {
        val out = ArrayList<String>()
        val cur = StringBuilder()
        var inSpace: Boolean? = null
        for (cp in codePoints(s)) {
            val sp = isSpace(cp)
            if (inSpace != null && sp != inSpace) {
                out += cur.toString()
                cur.setLength(0)
            }
            inSpace = sp
            cur.appendCodePoint(cp)
        }
        if (cur.isNotEmpty()) out += cur.toString()
        return out
    }

    private fun words(s: String): List<String> = tokens(s).filter { it.isNotEmpty() && !isSpace(it.codePointAt(0)) }

    /** The first year of `issued` as an integer, sign included (`-350`), or null. */
    @JvmStatic
    public fun firstYear(metadata: Map<String, Any?>): Long? {
        val issued = asMap(metadata["issued"]) ?: return null
        val dp = asList(issued["date-parts"])?.takeIf { it.isNotEmpty() } ?: return null
        val first = asList(dp[0])?.takeIf { it.isNotEmpty() } ?: return null
        return when (val y = first[0]) {
            is Long -> y
            is Double -> if (y.isNaN() || y.isInfinite()) null else y.toLong() // int() truncates
            is String -> y.trim().replace("_", "").toLongOrNull()
            is Boolean -> if (y) 1L else 0L
            else -> null
        }
    }

    /**
     * The base BibTeX key (SPEC §19.1): the first author's `family`, `literal` or `given` (the
     * first non-empty), else the first word of `title-short` or `title`, folded to ASCII
     * letters and lowercased (`anon` if nothing is left), plus the first year of `issued`
     * (sign included) or `nd`: `cervantessaavedra1605`, `lazarillo1554`, `anonnd`.
     */
    @JvmStatic
    public fun citationKey(metadata: Map<String, Any?>): String {
        var base = ""
        val authors = asList(metadata["author"])
        if (!authors.isNullOrEmpty()) {
            val a = asMap(authors[0])
            if (a != null) {
                val name = listOf("family", "literal", "given").map { a[it] }.firstOrNull { truthy(it) }
                base = fold(name?.let { pyStr(it) } ?: "")
            }
        }
        if (base.isEmpty()) {
            val title = listOf("title-short", "title").map { metadata[it] }.firstOrNull { truthy(it) }?.let { pyStr(it) } ?: ""
            base = words(title).firstOrNull()?.let { fold(it) } ?: ""
        }
        return base.ifEmpty { "anon" } + (firstYear(metadata)?.toString() ?: "nd")
    }

    /** Keys of several items in one export: a base that occurs more than once gets `a`, `b`, `c`… in order. */
    @JvmStatic
    public fun citationKeys(items: List<Map<String, Any?>>): List<String> {
        val bases = items.map { citationKey(it) }
        val counts = bases.groupingBy { it }.eachCount()
        val seen = HashMap<String, Int>()
        return bases.map { b ->
            if (counts[b] == 1) {
                b
            } else {
                val n = seen.getOrDefault(b, 0)
                seen[b] = n + 1
                b + suffix(n)
            }
        }
    }

    private fun suffix(n0: Int): String {
        var n = n0 + 1
        val sb = StringBuilder()
        while (n > 0) {
            val r = (n - 1) % 26
            n = (n - 1) / 26
            sb.insert(0, 'a' + r)
        }
        return sb.toString()
    }

    // ------------------------------------------------------------------ CSL-JSON

    private fun folio(a: Map<String, Any?>): String? {
        val p = a["printed"] ?: return null
        return if (a["source"] == "inferred") "[${pyStr(p)}]" else pyStr(p)
    }

    /**
     * The CSL `label` and `locator` of an anchor (and optional end anchor) for citeproc
     * (SPEC §19.2): `("page", "145-146")`, `("folio", "1r")`, `("timestamp", "1:09:20")`…, or
     * null when the anchor has no locator.
     */
    @JvmStatic
    @JvmOverloads
    public fun labelLocator(anchor: Anchor?, end: Anchor? = null): Pair<String, String>? {
        val a = anchor?.members ?: return null
        val e = end?.members?.takeIf { it.isNotEmpty() }
        val t = a["type"]
        if (t == "page" || ((t == "section" || t == "web") && a["printed"] != null)) {
            val start = folio(a) ?: return null
            val label = if (t == "page") {
                when (a["foliation"]) {
                    "leaf" -> "folio"
                    "column" -> "column"
                    else -> "page"
                }
            } else {
                "page"
            }
            if (e != null && e["type"] == t && e["printed"] != null && !pyEquals(e["printed"], a["printed"])) {
                return label to "$start-${folio(e)}"
            }
            return label to start
        }
        if (t == "section" || t == "web") {
            if (a["paragraph"] != null) return "paragraph" to pyStr(a["paragraph"])
            val path = asList(a["path"])
            if (!path.isNullOrEmpty()) return "section" to pyStr(path.last())
            return null
        }
        if (t == "time") {
            var s = Citation.hms(numberValue(a["t0"]) ?: return null)
            if (e != null && e["type"] == "time") s += "-" + Citation.hms(numberValue(e["t1"]) ?: return "timestamp" to s)
            return "timestamp" to s
        }
        if (t == "verse") {
            val lf = a["line_from"]
            val lt = a["line_to"]
            return "verse" to if (lt == null || pyEquals(lt, lf)) pyStr(lf) else "${pyStr(lf)}-${pyStr(lt)}"
        }
        if (t == "canonical") return a["ref"]?.let { "section" to pyStr(it) }
        if (t == "sheet") {
            val rf = a["row_from"]
            val rt = a["row_to"]
            return "line" to if (pyEquals(rf, rt)) pyStr(rf) else "${pyStr(rf)}-${pyStr(rt)}"
        }
        return null
    }

    /** One CSL-JSON item: the metadata without `spdf`, `id` = [id] (default: the BibTeX key). */
    @JvmStatic
    @JvmOverloads
    public fun cslItem(metadata: Map<String, Any?>, id: String? = null): Map<String, Any?> {
        val out = LinkedHashMap<String, Any?>()
        for ((k, v) in metadata) if (k != "spdf") out[k] = v
        out["id"] = id ?: citationKey(metadata)
        return out
    }

    /**
     * The CSL-JSON export of several items (SPEC §19.1, §19.2): `id` = their keys; with an
     * [anchor] and exactly one item, the item also carries `label` and `locator`.
     */
    @JvmStatic
    @JvmOverloads
    public fun cslItems(items: List<Map<String, Any?>>, anchor: Anchor? = null, end: Anchor? = null): List<Map<String, Any?>> {
        val keys = citationKeys(items)
        val out = items.mapIndexed { i, m -> cslItem(m, keys[i]).toMutableMap() }
        if (anchor != null && out.size == 1) {
            labelLocator(anchor, end)?.let { (label, locator) ->
                out[0]["label"] = label
                out[0]["locator"] = locator
            }
        }
        @Suppress("UNCHECKED_CAST")
        return Json.canon(out) as List<Map<String, Any?>>
    }

    // ------------------------------------------------------------------ BibTeX

    /** Escapes `\`, `{` and `}`; the rest of UTF-8 stays as it is. */
    @JvmStatic
    public fun escape(value: String): String {
        val b = StringBuilder()
        for (ch in value) {
            when (ch) {
                '\\' -> b.append("\\textbackslash{}")
                '{', '}' -> b.append('\\').append(ch)
                else -> b.append(ch)
            }
        }
        return b.toString()
    }

    /** Escapes and braces every token with an uppercase letter (category Lu), so styles keep it. */
    @JvmStatic
    public fun protect(text: String): String = tokens(text).joinToString("") { t ->
        if (codePoints(t).any { Character.getType(it) == Character.UPPERCASE_LETTER.toInt() }) "{" + escape(t) + "}" else escape(t)
    }

    private fun names(v: Any?): String? {
        val out = ArrayList<String>()
        for (e in asList(v) ?: emptyList()) {
            val p = asMap(e) ?: continue
            if (truthy(p["literal"])) {
                out += "{" + escape(pyStr(p["literal"])) + "}"
                continue
            }
            var family = p["family"].takeIf { truthy(it) }?.let { pyStr(it) } ?: ""
            val particle = p["non-dropping-particle"]
            if (family.isNotEmpty() && truthy(particle)) family = pyStr(particle) + " " + family
            val given = p["given"].takeIf { truthy(it) }?.let { pyStr(it) } ?: ""
            when {
                family.isNotEmpty() && given.isNotEmpty() -> out += escape(family) + ", " + escape(given)
                family.isNotEmpty() || given.isNotEmpty() -> out += "{" + escape(family.ifEmpty { given }) + "}"
            }
        }
        return if (out.isEmpty()) null else out.joinToString(" and ")
    }

    /** The BibTeX entry type and fields of an item, in canonical order (values as written in the entry). */
    @JvmStatic
    public fun bibtexFields(metadata: Map<String, Any?>): Pair<String, List<Pair<String, String>>> {
        val entry = TYPES[metadata["type"] as? String] ?: "misc"
        val fields = ArrayList<Pair<String, String>>()
        names(metadata["author"])?.let { fields += "author" to it }
        names(metadata["editor"])?.let { fields += "editor" to it }
        if (truthy(metadata["title"])) fields += "title" to protect(pyStr(metadata["title"]))
        firstYear(metadata)?.let { fields += "year" to it.toString() }
        if (truthy(metadata["container-title"])) {
            fields += (if (entry == "article") "journal" else "booktitle") to protect(pyStr(metadata["container-title"]))
        }
        for ((csl, bib) in SIMPLE) {
            val v = metadata[csl]
            if (v == null || v == "" || (v is List<*> && v.isEmpty())) continue
            fields += bib to escape(pyStr(v))
        }
        return entry to fields
    }

    /** One item as a BibTeX entry ([key] default: [citationKey]). */
    @JvmStatic
    @JvmOverloads
    public fun bibtex(metadata: Map<String, Any?>, key: String? = null): String {
        val (entry, fields) = bibtexFields(metadata)
        val k = if (key.isNullOrEmpty()) citationKey(metadata) else key
        return "@$entry{$k,\n" + fields.joinToString(",\n") { (f, v) -> "  $f = {$v}" } + "\n}\n"
    }

    /** The BibTeX export of several items (SPEC §19.3): entries separated by a blank line, keys disambiguated. */
    @JvmStatic
    public fun bibtex(items: List<Map<String, Any?>>): String {
        val keys = citationKeys(items)
        return items.indices.joinToString("\n") { bibtex(items[it], keys[it]) }
    }

    /** BibTeX text as compared by the conformance suite: lines trimmed, empty lines dropped. */
    @JvmStatic
    public fun normalizeBibtex(text: String): List<String> =
        text.replace("\r\n", "\n").split("\n").map { it.trim() }.filter { it.isNotEmpty() }
}
