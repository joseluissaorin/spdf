package io.github.joseluissaorin.spdf

/**
 * The compiled form of a lexical query (SPEC §10.1, CONTRACT §6 steps 1–5): terms as written
 * (NFC, no case folding), whether they are phrases (joined with AND) or words (OR), and the
 * FTS5 MATCH expression.
 */
public class LexicalQuery private constructor(
    /** NFC form of the query. */
    public val normalized: String,
    public val terms: List<String>,
    public val phrases: Boolean,
) {
    /** The FTS5 MATCH expression, or null when there are no terms. */
    public val match: String? =
        if (terms.isEmpty()) null else terms.joinToString(if (phrases) " AND " else " OR ") { "\"" + it.replace("\"", "\"\"") + "\"" }

    /** True if the query contains CJK code points (route `trigram` or `substring`). */
    public val cjk: Boolean get() = codePoints(normalized).any { isCjk(it) }

    override fun toString(): String = "LexicalQuery(terms=$terms, phrases=$phrases, match=$match)"

    public companion object {
        private val CLOSERS: Map<Int, IntArray> = mapOf(
            '"'.code to intArrayOf('"'.code),
            '“'.code to intArrayOf('”'.code),
            '«'.code to intArrayOf('»'.code),
            '„'.code to intArrayOf('“'.code, '”'.code),
        )
        private val CJK_RANGES = arrayOf(
            0x2E80..0x2FDF, 0x3040..0x30FF, 0x3100..0x312F, 0x3130..0x318F, 0x31A0..0x31FF, 0x3400..0x4DBF,
            0x4E00..0x9FFF, 0xA960..0xA97F, 0xAC00..0xD7AF, 0xF900..0xFAFF, 0xFF66..0xFF9F, 0x20000..0x3FFFF,
        )

        internal fun isCjk(cp: Int): Boolean = CJK_RANGES.any { cp in it }

        /** Words: maximal runs of code points of general category L, M or N. */
        internal fun words(cps: IntArray, from: Int = 0, to: Int = cps.size): List<String> {
            val out = ArrayList<String>()
            var start = -1
            for (i in from until to) {
                if (isWordCodePoint(cps[i])) {
                    if (start < 0) start = i
                } else if (start >= 0) {
                    out += fromCodePoints(cps, start, i)
                    start = -1
                }
            }
            if (start >= 0) out += fromCodePoints(cps, start, to)
            return out
        }

        /** Deduplication key (only for deduplication): `lower(remove_Mn(NFD(term)))`. */
        internal fun dedupKey(t: String): String {
            val sb = StringBuilder()
            codePoints(nfd(t)).forEach { cp -> if (Character.getType(cp) != Character.NON_SPACING_MARK.toInt()) sb.appendCodePoint(cp) }
            return lower(sb.toString())
        }

        /** Compiles a user query. */
        @JvmStatic
        public fun compile(query: String): LexicalQuery {
            val q = nfc(query)
            val cps = codePoints(q)
            val phrases = ArrayList<IntArray>()
            val rest = ArrayList<Int>()
            var i = 0
            while (i < cps.size) {
                val c = cps[i]
                val closers = CLOSERS[c]
                if (closers != null) {
                    var j = -1
                    for (k in i + 1 until cps.size) {
                        if (cps[k] in closers) {
                            j = k
                            break
                        }
                    }
                    rest += ' '.code
                    if (j >= 0) {
                        phrases += cps.copyOfRange(i + 1, j)
                        i = j + 1
                    } else {
                        i++
                    }
                    continue
                }
                rest += c
                i++
            }
            val phraseTerms = phrases.mapNotNull { p -> words(p).takeIf { it.isNotEmpty() }?.joinToString(" ") }
            val (terms, isPhrase) = if (phraseTerms.isNotEmpty()) phraseTerms to true else words(rest.toIntArray()) to false
            val seen = HashSet<String>()
            val out = terms.filter { seen.add(dedupKey(it)) }
            return LexicalQuery(q, out, isPhrase)
        }
    }
}
