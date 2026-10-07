package io.github.joseluissaorin.spdf

/**
 * Bibliography export (SPEC §19, RFC 0002): CSL-JSON and BibTeX. Exports never invent data:
 * fields absent from the metadata are absent from the export. The same algorithm as the
 * other implementations (`js/src/bib.ts` is the reference), so keys match across tools.
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

    private val YEAR = Regex("^-?[0-9]+$")

    /** NFKD, keep only ASCII letters, lowercase. */
    private fun asciiLetters(s: String): String {
        val b = StringBuilder()
        for (ch in java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFKD)) {
            if (ch in 'A'..'Z' || ch in 'a'..'z') b.append(ch.lowercaseChar())
        }
        return b.toString()
    }

    private fun isSpace(cp: Int): Boolean = Character.isWhitespace(cp) || Character.isSpaceChar(cp)

    /** Splits on whitespace runs, keeping them as separate tokens. */
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

    private fun yearOf(md: Map<String, Any?>): String? {
        val dp = asList(asMap(md["issued"])?.get("date-parts")) ?: return null
        return when (val y = asList(dp.firstOrNull())?.firstOrNull()) {
            is Long -> y.toString()
            is Double -> if (isIntegral(y)) y.toLong().toString() else null
            is String -> y.trim().takeIf { YEAR.matches(it) }?.toBigInteger()?.toString()
            else -> null
        }
    }

    /**
     * The BibTeX key: the first author's `family` (or `literal`), else the first word of the
     * title, folded to ASCII letters and lowercased (`anon` if nothing is left), plus the first
     * year of `issued` (or `nd`): `cervantessaavedra1605`, `la1554`, `anonnd`.
     */
    @JvmStatic
    public fun citationKey(metadata: Map<String, Any?>): String {
        var base = ""
        val first = asMap(asList(metadata["author"])?.firstOrNull())
        if (first != null) {
            val name = first["family"].takeIf { truthy(it) } ?: first["literal"].takeIf { truthy(it) } ?: ""
            base = asciiLetters(pyStr(name))
        }
        if (base.isEmpty()) {
            val title = metadata["title"]?.let { if (it is String) it else pyStr(it) } ?: ""
            val word = tokens(title).firstOrNull { t -> t.isNotEmpty() && !isSpace(t.codePointAt(0)) }
            if (word != null) base = asciiLetters(word)
        }
        return base.ifEmpty { "anon" } + (yearOf(metadata) ?: "nd")
    }

    /** Keys for several items: collisions get `a`, `b`, `c`… in document order. */
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

    private fun suffix(n: Int): String {
        var x = n + 1
        val sb = StringBuilder()
        while (x > 0) {
            val r = (x - 1) % 26
            x = (x - 1) / 26
            sb.insert(0, ('a' + r))
        }
        return sb.toString()
    }

    /** A CSL-JSON item: the metadata without `spdf`, with `id` = [id] (default: the BibTeX key). */
    @JvmStatic
    @JvmOverloads
    public fun cslItem(metadata: Map<String, Any?>, id: String? = null): Map<String, Any?> {
        val out = LinkedHashMap<String, Any?>()
        for ((k, v) in metadata) if (k != "spdf") out[k] = v
        out["id"] = id ?: citationKey(out)
        return out
    }

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

    /** Escapes and braces every word with an uppercase letter, so styles cannot lowercase it. */
    private fun protect(title: String): String = tokens(title).joinToString("") { t ->
        if (codePoints(t).any { Character.isUpperCase(it) }) "{" + escape(t) + "}" else escape(t)
    }

    private fun names(v: Any?): String? {
        val out = ArrayList<String>()
        for (e in asList(v) ?: return null) {
            val p = asMap(e) ?: continue
            if (truthy(p["literal"])) {
                out += "{" + escape(pyStr(p["literal"])) + "}"
                continue
            }
            var family = p["family"]?.let { pyStr(it) } ?: ""
            val particle = p["non-dropping-particle"]?.let { pyStr(it) } ?: ""
            if (particle.isNotEmpty() && family.isNotEmpty()) family = "$particle $family"
            val given = p["given"]?.let { pyStr(it) } ?: ""
            when {
                family.isNotEmpty() && given.isNotEmpty() -> out += escape(family) + ", " + escape(given)
                family.isNotEmpty() || given.isNotEmpty() -> out += "{" + escape(family.ifEmpty { given }) + "}"
            }
        }
        return if (out.isEmpty()) null else out.joinToString(" and ")
    }

    private fun scalar(v: Any?): String = when (v) {
        is String -> v
        is Long -> v.toString()
        is Double -> Json.formatNumber(v)
        is List<*> -> v.joinToString(",") { scalar(it) }
        else -> pyStr(v)
    }

    /** The BibTeX entry type and the fields, in order (values escaped as written in the entry). */
    @JvmStatic
    public fun bibtexFields(metadata: Map<String, Any?>): Pair<String, List<Pair<String, String>>> {
        val entry = TYPES[metadata["type"] as? String] ?: "misc"
        val fields = ArrayList<Pair<String, String>>()
        names(metadata["author"])?.let { fields += "author" to it }
        names(metadata["editor"])?.let { fields += "editor" to it }
        if (truthy(metadata["title"])) fields += "title" to protect(scalar(metadata["title"]))
        yearOf(metadata)?.let { fields += "year" to it }
        if (truthy(metadata["container-title"])) {
            fields += (if (entry == "article") "journal" else "booktitle") to protect(scalar(metadata["container-title"]))
        }
        for ((csl, bib) in SIMPLE) {
            val v = metadata[csl]
            if (v == null || v == "" || (v is List<*> && v.isEmpty())) continue
            fields += bib to escape(scalar(v))
        }
        return entry to fields
    }

    /** One CSL-JSON item as a BibTeX entry ([key] default: [citationKey]). */
    @JvmStatic
    @JvmOverloads
    public fun bibtex(metadata: Map<String, Any?>, key: String? = null): String {
        val (entry, fields) = bibtexFields(metadata)
        val k = if (key.isNullOrEmpty()) citationKey(metadata) else key
        return "@$entry{$k,\n" + fields.joinToString(",\n") { (f, v) -> "  $f = {$v}" } + "\n}\n"
    }

    /** Several items as BibTeX entries (keys disambiguated with a, b, c…). */
    @JvmStatic
    public fun bibtex(items: List<Map<String, Any?>>): String {
        val keys = citationKeys(items)
        return items.indices.joinToString("\n") { bibtex(items[it], keys[it]) }
    }
}
