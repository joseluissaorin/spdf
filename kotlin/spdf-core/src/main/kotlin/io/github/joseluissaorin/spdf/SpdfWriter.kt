package io.github.joseluissaorin.spdf

import io.github.joseluissaorin.spdf.sql.SqlConnection
import io.github.joseluissaorin.spdf.sql.SqlDriver
import io.github.joseluissaorin.spdf.sql.exec
import java.io.File

/** How a [SpdfWriter] works. */
public class WriterOptions @JvmOverloads constructor(
    /** `spdf_meta.generator`. */
    public val generator: String = "${Spdf.IMPL_NAME}/${Spdf.VERSION}",
    /** Adds the optional CJK index (`fragments_fts_trigram`). */
    public val trigram: Boolean = false,
    /**
     * Writes every value verbatim: no default `spdf_meta` keys, no computed `unit_count`, no
     * automatic ordinals, no NFC normalization. Used to rebuild a file from a full dump.
     */
    public val exact: Boolean = false,
)

/**
 * Builds an SPDF 5.0 file. Rows go to a temporary file next to the destination; [finish]
 * writes `documents` and `spdf_meta`, rebuilds the FTS index, runs `VACUUM` and moves the file
 * into place. [close] without [finish] discards everything, so `use { … finish() }` is safe.
 *
 * ```kotlin
 * SpdfWriter.create(File("out.spdf")).use { w ->
 *     w.setDocument(Document("doc", "pdf", "application/pdf", sha).apply { title = "…" })
 *     w.addUnit(CitableUnit("u1", Anchor.page(1, "1"), "…", "pdf-text-layer"))
 *     w.finish()
 * }
 * ```
 */
public class SpdfWriter private constructor(
    private val conn: SqlConnection,
    private val target: File,
    private val tmp: File,
    private val options: WriterOptions,
) : AutoCloseable {
    private val meta = LinkedHashMap<String, String>()
    private var doc: Document? = null
    private var nextUnit = 0L
    private var nextFrag = 0L
    private var nextN = 0L
    private var units = 0L
    private var vectors = 0L
    private var hasTime = false
    private val spaces = HashMap<String, Space>()
    private var done = false

    private fun live() {
        check(!done) { "the writer is finished or aborted" }
    }

    private fun needDoc(): Document = doc ?: throw IllegalStateException("setDocument must be called first")

    private fun json(v: Any?): String? = if (v == null) null else Json.compact(v)

    private fun nfcIf(s: String): String = if (options.exact) s else nfc(s)

    /** Sets a `spdf_meta` key (overrides the defaults written by [finish]). */
    public fun setMeta(key: String, value: String) {
        live()
        meta[key] = value
    }

    /** Sets the document (once, before any row). */
    public fun setDocument(d: Document) {
        live()
        check(doc == null) { "document already set" }
        require(d.id.isNotEmpty() && d.kind.isNotEmpty() && d.mime.isNotEmpty() && d.sourceSha256.isNotEmpty()) {
            "document needs id, kind, mime and sourceSha256"
        }
        if (d.created == null) d.created = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.ROOT).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date())
        if (d.updated == null) d.updated = d.created
        doc = d
    }

    /** Adds a citable unit. */
    public fun addUnit(u: CitableUnit) {
        live()
        val d = needDoc()
        val ord = u.ord ?: if (options.exact) 0L else nextUnit + 1
        if (ord > nextUnit) nextUnit = ord
        if (u.anchor.type == "time") hasTime = true
        units++
        conn.exec(
            "INSERT INTO units (id, document, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            u.id, d.id, ord, json(u.anchor), nfcIf(u.text), json(u.notes), u.header, u.footer, u.image, u.thumbnail, u.reader,
            u.confidence ?: 1.0, u.printed, u.t0, u.t1, json(u.words),
        )
    }

    /** Adds a table-of-contents entry. */
    public fun addSection(s: Section) {
        live()
        val d = needDoc()
        conn.exec(
            "INSERT INTO sections (id, document, parent, level, title, unit_from, unit_to, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            s.id, d.id, s.parent, s.level, s.title, s.unitFrom, s.unitTo, s.summary,
        )
    }

    /** Adds a fragment (the FTS index is rebuilt by [finish]). */
    public fun addFragment(f: Fragment) {
        live()
        val d = needDoc()
        val n = f.n ?: if (options.exact) 0L else nextN + 1
        if (n > nextN) nextN = n
        val ord = f.ord ?: if (options.exact) 0L else nextFrag + 1
        if (ord > nextFrag) nextFrag = ord
        conn.exec(
            "INSERT INTO fragments (n, id, document, unit, ord, text, context, section, anchor, anchor_end, search_text) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            n, f.id, d.id, f.unit, ord, nfcIf(f.text), f.context, json(f.section), json(f.anchor), json(f.anchorEnd), f.searchText,
        )
    }

    /** Adds a figure. */
    public fun addFigure(g: Figure) {
        live()
        val d = needDoc()
        conn.exec(
            "INSERT INTO figures (id, document, unit, image, caption, description, anchor) VALUES (?, ?, ?, ?, ?, ?, ?)",
            g.id, d.id, g.unit, g.image, g.caption, g.description, json(g.anchor),
        )
    }

    /** Declares a vector space. */
    public fun addSpace(s: Space) {
        live()
        if (Vectors.size(s.dtype) == 0) throw SpdfException("E032", "unknown dtype ${s.dtype}", s.id)
        spaces[s.id] = s
        conn.exec(
            "INSERT INTO spaces (id, provider, model, version, dims, dtype, normalized, truncated_from, modalities, task_prefixes, created) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            s.id, s.provider, s.model, s.version, s.dims, s.dtype, s.rawNormalized ?: if (s.normalized) 1L else 0L, s.truncatedFrom,
            json(s.rawModalities ?: s.modalities), json(s.taskPrefixes), s.created,
        )
    }

    /** Stores an already encoded vector (little-endian, dims × dtype size bytes). */
    public fun addVectorRaw(target: String, id: String, space: String, data: ByteArray) {
        live()
        val d = needDoc()
        val s = spaces[space] ?: throw IllegalArgumentException("unknown space $space (call addSpace first)")
        val want = s.dims * Vectors.size(s.dtype)
        require(data.size.toLong() == want) { "vector $target/$id has ${data.size} bytes, space $space needs $want" }
        vectors++
        conn.exec("INSERT INTO vectors (target, id, space, document, data) VALUES (?, ?, ?, ?, ?)", target, id, space, d.id, data)
    }

    /** Encodes [values] in the dtype of [space] (f16 and i8 quantized as SPEC §9 says) and stores them. */
    public fun addVector(target: String, id: String, space: String, values: DoubleArray) {
        val s = spaces[space] ?: throw IllegalArgumentException("unknown space $space (call addSpace first)")
        addVectorRaw(target, id, space, Vectors.quantize(values, s.dtype))
    }

    /** [addVector] for float values. */
    public fun addVector(target: String, id: String, space: String, values: FloatArray) {
        addVector(target, id, space, DoubleArray(values.size) { values[it].toDouble() })
    }

    /** Stores a binary object and returns its reference (`blob:<key>`). */
    public fun addBlob(key: String, mime: String, data: ByteArray): String {
        live()
        conn.exec("INSERT INTO blobs (key, mime, sha256, data) VALUES (?, ?, ?, ?)", key, mime, sha256Hex(data), data)
        return "blob:$key"
    }

    /** Records a processing stage. */
    public fun addProvenance(p: Provenance) {
        live()
        val d = needDoc()
        conn.exec(
            "INSERT INTO provenance (document, stage, provider, model, detail, ms, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            d.id, p.stage, p.provider, p.model, json(p.detail), p.ms, p.at,
        )
    }

    /** Declares an extension (its `x_<vendor>_<name>` tables are created with [execute]). */
    public fun addExtension(name: String, version: String, required: Boolean) {
        addExtensionRaw(name, version, if (required) 1L else 0L)
    }

    internal fun addExtensionRaw(name: String, version: String, required: Any?) {
        live()
        conn.exec("INSERT INTO extensions (name, version, required) VALUES (?, ?, ?)", name, version, required)
    }

    /** Runs arbitrary SQL inside the writer transaction (extension tables). Never create triggers or views. */
    public fun execute(sql: String, vararg args: Any?) {
        live()
        conn.exec(sql, *args)
    }

    private fun defaultProfile(): String {
        val p = mutableListOf("core")
        if (vectors > 0) p += "semantic"
        if (hasTime) p += "media"
        return p.joinToString(" ")
    }

    /** Writes the document and `spdf_meta`, rebuilds FTS, VACUUMs and moves the file into place. */
    public fun finish() {
        live()
        val d = doc ?: throw IllegalStateException("no document")
        try {
            val unitCount = d.unitCount ?: if (options.exact) 0L else units
            conn.exec(
                "INSERT INTO documents (id, kind, metadata, source_sha256, source_ref, mime, bytes, unit_count, duration, created, updated, " +
                    "title, authors, year, language, rights) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                d.id, d.kind, json(d.metadata), if (options.exact) d.sourceSha256 else lower(d.sourceSha256), d.sourceRef, d.mime,
                d.bytes, unitCount, d.duration, d.created, d.updated, d.title, d.authors, d.year, d.language, json(d.rights),
            )
            val all = java.util.TreeMap<String, String>()
            if (!options.exact) {
                all["spdf_version"] = Spdf.FORMAT_VERSION
                all["profile"] = defaultProfile()
                all["created"] = d.created ?: ""
                all["generator"] = options.generator
                all["document_id"] = d.id
            }
            all.putAll(meta)
            for ((k, v) in all) conn.exec("INSERT INTO spdf_meta (key, value) VALUES (?, ?)", k, v)
            conn.exec("INSERT INTO fragments_fts(fragments_fts) VALUES ('rebuild')")
            if (options.trigram) conn.exec("INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES ('rebuild')")
            conn.exec("COMMIT")
            conn.exec("INSERT INTO fragments_fts(fragments_fts) VALUES ('optimize')")
            conn.exec("VACUUM")
            conn.close()
            done = true
            // rename(2) replaces the destination atomically on POSIX; Windows needs it gone first.
            if (!tmp.renameTo(target)) {
                target.delete()
                if (!tmp.renameTo(target)) {
                    tmp.copyTo(target, overwrite = true)
                    tmp.delete()
                }
            }
        } catch (e: Throwable) {
            abort()
            throw e
        }
    }

    /** Discards the file being written. */
    public fun abort() {
        if (!done) {
            done = true
            try {
                conn.close()
            } catch (e: Exception) {
                // ignore
            }
        }
        tmp.delete()
        File(tmp.path + "-journal").delete()
    }

    /** Discards the file unless [finish] was called. */
    override fun close() {
        if (!done) abort()
    }

    public companion object {
        /** Starts a new SPDF 5.0 file at [path] with the default adapter. */
        @JvmStatic
        public fun create(path: String): SpdfWriter = create(File(path))

        /** Starts a new SPDF 5.0 file at [file]. */
        @JvmStatic
        @JvmOverloads
        public fun create(file: File, options: WriterOptions = WriterOptions(), driver: SqlDriver = SqlDriver.default()): SpdfWriter {
            val target = file.absoluteFile
            val tmp = File.createTempFile(".spdf-writer-", ".tmp", target.parentFile)
            tmp.delete()
            val conn = driver.openReadWrite(tmp.path)
            try {
                conn.exec("PRAGMA page_size = 4096")
                conn.exec("PRAGMA journal_mode = DELETE")
                conn.exec("PRAGMA trusted_schema = OFF")
                conn.exec("PRAGMA application_id = ${Spdf.APPLICATION_ID}")
                conn.exec("PRAGMA user_version = ${Spdf.USER_VERSION}")
                for (s in Schema.STATEMENTS) conn.exec(s)
                if (options.trigram) conn.exec(Schema.TRIGRAM)
                conn.exec("BEGIN")
            } catch (e: Throwable) {
                conn.close()
                tmp.delete()
                throw e
            }
            return SpdfWriter(conn, target, tmp, options)
        }
    }
}
