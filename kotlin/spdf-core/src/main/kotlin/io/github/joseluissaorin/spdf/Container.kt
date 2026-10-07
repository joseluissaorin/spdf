package io.github.joseluissaorin.spdf

import io.github.joseluissaorin.spdf.sql.SqlConnection
import io.github.joseluissaorin.spdf.sql.SqlDriver
import io.github.joseluissaorin.spdf.sql.SqlValue
import io.github.joseluissaorin.spdf.sql.asLong
import io.github.joseluissaorin.spdf.sql.asText
import io.github.joseluissaorin.spdf.sql.exec
import io.github.joseluissaorin.spdf.sql.quoteIdent
import io.github.joseluissaorin.spdf.sql.rows
import io.github.joseluissaorin.spdf.sql.scalar
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.zip.GZIPInputStream

/** How files are opened. The defaults are safe. */
public class OpenOptions @JvmOverloads constructor(
    /** Maximum size of any single TEXT or BLOB value (SQLITE_LIMIT_LENGTH). */
    public val maxBlobSize: Long = DEFAULT_MAX_BLOB_SIZE,
    /** Maximum size of a gunzipped (legacy) file. */
    public val maxDecompressedSize: Long = DEFAULT_MAX_DECOMPRESSED_SIZE,
    /** Where temporary copies go (gunzipped files, WAL fixes, private copies); null: the system default. */
    public val tempDir: File? = null,
) {
    public companion object {
        /** 512 MiB. */
        public const val DEFAULT_MAX_BLOB_SIZE: Long = 512L shl 20

        /** 4 GiB. */
        public const val DEFAULT_MAX_DECOMPRESSED_SIZE: Long = 4L shl 30

        /** The defaults. */
        @JvmField
        public val DEFAULT: OpenOptions = OpenOptions()
    }
}

/** One `sqlite_master` entry. */
internal data class MasterEntry(val type: String, val name: String, val tblName: String?, val sql: String?)

/**
 * A database opened the safe way (SPEC §2.4): the physical file (a temporary copy for gzip and
 * WAL files), a read-only connection with `query_only`, `trusted_schema = OFF`,
 * `mmap_size = 0`, `cell_size_check = ON`, and what the header and schema say.
 */
internal class Container private constructor(
    val conn: SqlConnection,
    val driver: SqlDriver,
    val options: OpenOptions,
    val display: String,
    val physical: File,
    private val tmp: File?,
    val gzipped: Boolean,
    val master: List<MasterEntry>,
    val appId: Long,
    val userVersion: Long,
    /** '5' for 5.x, '4' for legacy 4.x, '?' otherwise. */
    val kind: Char,
    val version: String?,
) : AutoCloseable {
    val tables: Set<String> = master.filter { it.type == "table" }.map { it.name }.toSet()
    val legacy: Boolean get() = kind == '4'
    private val columnCache = HashMap<String, Set<String>>()

    /** Column names of a physical table (empty if absent or unreadable). */
    fun columns(table: String): Set<String> = columnCache.getOrPut(table) {
        if (table !in tables) return@getOrPut emptySet()
        try {
            conn.rows("SELECT name FROM pragma_table_info(?)", table).mapNotNull { it[0].asText() }.toSet()
        } catch (e: Exception) {
            emptySet()
        }
    }

    /** Physical name of a 5.0 table. */
    fun table(t5: String): String = if (legacy) Legacy.TABLES[t5] ?: t5 else t5

    fun hasTable(t5: String): Boolean = table(t5) in tables

    /** Physical name of a column of a 5.0 table, or null if it has none in a legacy file. */
    fun column(t5: String, c: String): String? {
        if (!legacy) return c
        val m = Legacy.COLUMNS[t5] ?: return c
        if (!m.containsKey(c)) return c
        return m[c]
    }

    /** `"col" AS "alias"`, `NULL AS "alias"` or a legacy default, for a SELECT list. */
    fun select(t5: String, cols: List<String>): String {
        val present = columns(table(t5))
        return cols.joinToString(", ") { c ->
            val src = column(t5, c)
            when {
                src != null && src in present -> quoteIdent(src) + " AS " + quoteIdent(c)
                legacy && Legacy.DEFAULTS.containsKey("$t5.$c") -> Legacy.DEFAULTS.getValue("$t5.$c") + " AS " + quoteIdent(c)
                else -> "NULL AS " + quoteIdent(c)
            }
        }
    }

    /** Quoted physical column for ORDER BY / WHERE. */
    fun col(t5: String, c: String): String = quoteIdent(column(t5, c) ?: c)

    override fun close() {
        try {
            conn.close()
        } finally {
            tmp?.delete()
        }
    }

    companion object {
        private val SQLITE_MAGIC = "SQLite format 3\u0000".toByteArray(Charsets.US_ASCII)
        private val FTS5_USING = java.util.regex.Pattern.compile(
            "USING\\s+fts5\\s*\\(",
            java.util.regex.Pattern.CASE_INSENSITIVE,
        )

        /** Extensions this implementation understands (none yet). */
        val KNOWN_EXTENSIONS: Set<String> = emptySet()

        /**
         * Opens a file. With [strict] (readers) every problem of SPEC §2.4 is an exception;
         * without it (the validator) only "not a database" problems are.
         */
        fun open(file: File, driver: SqlDriver, options: OpenOptions, strict: Boolean): Container {
            val head = ByteArray(100)
            val n = try {
                file.inputStream().use { readFully(it, head) }
            } catch (e: java.io.IOException) {
                throw SpdfException("E001", "cannot read file: ${e.message}", file.path, e)
            }
            val gz = n >= 2 && head[0] == 0x1f.toByte() && head[1] == 0x8b.toByte()
            var tmp: File? = null
            when {
                gz -> tmp = file.inputStream().use { gunzipToTemp(it, options) }
                n < 16 || !head.copyOfRange(0, 16).contentEquals(SQLITE_MAGIC) ->
                    throw SpdfException("E001", "not an SQLite database", file.path)
                n >= 20 && (head[18] == 2.toByte() || head[19] == 2.toByte()) ->
                    // A WAL database cannot be opened read-only without its -shm file: use a
                    // copy whose header says rollback journal.
                    tmp = file.inputStream().use { copyToTemp(it, options.maxDecompressedSize, options) }
            }
            return try {
                connect(tmp ?: file, tmp, file.path, gz, driver, options, strict)
            } catch (e: Throwable) {
                tmp?.delete()
                throw e
            }
        }

        /** Opens bytes held in memory (gzip-wrapped or not) through a temporary file. */
        fun open(data: ByteArray, driver: SqlDriver, options: OpenOptions, strict: Boolean): Container {
            val gz = data.size >= 2 && data[0] == 0x1f.toByte() && data[1] == 0x8b.toByte()
            if (!gz && (data.size < 16 || !data.copyOfRange(0, 16).contentEquals(SQLITE_MAGIC))) {
                throw SpdfException("E001", "not an SQLite database")
            }
            val tmp = if (gz) gunzipToTemp(data.inputStream(), options) else copyToTemp(data.inputStream(), options.maxDecompressedSize, options)
            return try {
                connect(tmp, tmp, "<memory>", gz, driver, options, strict)
            } catch (e: Throwable) {
                tmp.delete()
                throw e
            }
        }

        private fun readFully(input: InputStream, buf: ByteArray): Int {
            var n = 0
            while (n < buf.size) {
                val r = input.read(buf, n, buf.size - n)
                if (r < 0) break
                n += r
            }
            return n
        }

        private fun gunzipToTemp(input: InputStream, options: OpenOptions): File = try {
            GZIPInputStream(input.buffered(), 1 shl 16).use { copyToTemp(it, options.maxDecompressedSize, options) }
        } catch (e: SpdfException) {
            throw e
        } catch (e: java.io.IOException) {
            throw SpdfException("E001", "invalid gzip stream: ${e.message}", null, e)
        }

        /** Copies at most [limit] bytes to a temporary file, checks the magic, fixes a WAL header. */
        private fun copyToTemp(input: InputStream, limit: Long, options: OpenOptions): File {
            val tmp = File.createTempFile("spdf-", ".sqlite", options.tempDir)
            try {
                var total = 0L
                tmp.outputStream().buffered().use { out ->
                    val buf = ByteArray(1 shl 16)
                    while (true) {
                        val r = input.read(buf)
                        if (r < 0) break
                        total += r
                        if (total > limit) throw SpdfException("E001", "decompressed size exceeds $limit bytes")
                        out.write(buf, 0, r)
                    }
                }
                RandomAccessFile(tmp, "rw").use { raf ->
                    val head = ByteArray(100)
                    raf.seek(0)
                    val n = raf.read(head)
                    if (n < 16 || !head.copyOfRange(0, 16).contentEquals(SQLITE_MAGIC)) {
                        throw SpdfException("E001", "not an SQLite database")
                    }
                    if (n >= 20 && (head[18] == 2.toByte() || head[19] == 2.toByte())) {
                        raf.seek(18)
                        raf.write(byteArrayOf(1, 1))
                    }
                }
                return tmp
            } catch (e: Throwable) {
                tmp.delete()
                if (e is java.io.IOException) throw SpdfException("E001", "cannot copy the database: ${e.message}", null, e)
                throw e
            }
        }

        private fun connect(
            physical: File,
            tmp: File?,
            display: String,
            gzipped: Boolean,
            driver: SqlDriver,
            options: OpenOptions,
            strict: Boolean,
        ): Container {
            val conn = try {
                driver.openReadOnly(physical.path, options.maxBlobSize)
            } catch (e: Exception) {
                throw SpdfException("E001", "cannot open: ${e.message}", display, e)
            }
            try {
                // Connection settings first, query_only last (SPEC §2.4).
                conn.exec("PRAGMA trusted_schema = OFF")
                conn.exec("PRAGMA mmap_size = 0")
                conn.exec("PRAGMA cell_size_check = ON")
                conn.exec("PRAGMA query_only = 1")
                if (conn.scalar("PRAGMA query_only").asLong() != 1L || conn.scalar("PRAGMA trusted_schema").asLong() != 0L) {
                    throw SpdfException(null, "the SQLite binding cannot set query_only and trusted_schema", display)
                }
                if (!conn.safety.readOnly) throw SpdfException(null, "the SQLite binding did not open the file read-only", display)
                val master = try {
                    conn.rows("SELECT type, name, tbl_name, sql FROM sqlite_master").map {
                        MasterEntry(it[0].asText() ?: "", it[1].asText() ?: "", it[2].asText(), it[3].asText())
                    }
                } catch (e: SpdfException) {
                    throw e
                } catch (e: Exception) {
                    throw SpdfException("E001", "not an SQLite database: ${e.message}", display, e)
                }
                val tables = master.filter { it.type == "table" }.map { it.name }.toSet()
                val appId: Long
                val userVersion: Long
                var kind = '?'
                var version: String? = null
                try {
                    appId = conn.scalar("PRAGMA application_id").asLong() ?: 0
                    userVersion = conn.scalar("PRAGMA user_version").asLong() ?: 0
                    if (appId == Spdf.APPLICATION_ID) {
                        if (userVersion in 500..599) {
                            kind = '5'
                            version = "${userVersion / 100}.${(userVersion % 100) / 10}"
                        }
                    } else if ("spdf" in tables && "documentos" in tables) {
                        val v = conn.scalar("SELECT valor FROM spdf WHERE clave = 'spdf_version'")
                        val s = if (v == SqlValue.Null) null else pyStr(v.toAny().let { if (it is ByteArray) String(it, Charsets.UTF_8) else it })
                        if (s != null && s.startsWith("4.")) {
                            kind = '4'
                            version = s
                        } else if (userVersion == 400L || userVersion == 410L) {
                            kind = '4'
                            version = "${userVersion / 100}.${(userVersion % 100) / 10}"
                        }
                    }
                } catch (e: SpdfException) {
                    throw e
                } catch (e: Exception) {
                    throw SpdfException("E001", "cannot read the database header: ${e.message}", display, e)
                }
                val c = Container(conn, driver, options, display, physical, tmp, gzipped, master, appId, userVersion, kind, version)
                if (strict) c.checkStrict()
                return c
            } catch (e: Throwable) {
                conn.close()
                throw e
            }
        }
    }

    /** Problems that make a reader refuse the file (SPEC §2.4 step 4, required extensions). */
    fun schemaIssues(): List<SpdfException> {
        val out = ArrayList<SpdfException>()
        for (e in master) {
            when {
                e.type == "view" -> out += SpdfException("E020", "views are not allowed in an SPDF file", e.name)
                e.type == "trigger" && !(legacy && e.name in Legacy.TRIGGERS) ->
                    out += SpdfException("E020", "triggers are not allowed in an SPDF file", e.name)
                e.type == "table" && (e.sql ?: "").trimStart().uppercase(java.util.Locale.ROOT).startsWith("CREATE VIRTUAL TABLE") -> {
                    val allowed = if (legacy) setOf("fragmentos_fts", "fragmentos_fts_trigram") else ALLOWED_VTABLES
                    if (e.name !in allowed || !FTS5_USING.matcher(e.sql ?: "").find()) {
                        out += SpdfException("E020", "virtual table ${e.name} is not allowed", e.name)
                    }
                }
            }
        }
        return out
    }

    private fun checkStrict() {
        if (kind == '?') {
            throw SpdfException("E002", "unknown application_id $appId / user_version $userVersion", display)
        }
        schemaIssues().firstOrNull()?.let { throw it }
        if (!legacy && "extensions" in tables && "required" in columns("extensions") && "name" in columns("extensions")) {
            for (r in conn.rows("SELECT name, required FROM extensions ORDER BY name")) {
                val name = r[0].asText() ?: ""
                if (sqlTruthy(r[1]) && name !in KNOWN_EXTENSIONS) {
                    throw SpdfException("E060", "unknown required extension", name)
                }
            }
        }
        if (!conn.safety.lengthLimit && physical.length() > options.maxBlobSize) enforceLengthBound()
    }

    /**
     * Without SQLITE_LIMIT_LENGTH no value can still be larger than the file; for bigger files
     * every stored value is measured once.
     */
    private fun enforceLengthBound() {
        for (e in master) {
            if (e.type != "table" || e.name.startsWith("sqlite_")) continue
            if ((e.sql ?: "").uppercase(java.util.Locale.ROOT).contains("VIRTUAL TABLE")) continue
            for (c in columns(e.name)) {
                val max = conn.scalar("SELECT max(length(CAST(${quoteIdent(c)} AS BLOB))) FROM ${quoteIdent(e.name)}").asLong() ?: 0
                if (max > options.maxBlobSize) {
                    throw SpdfException(null, "a value in ${e.name}.$c is larger than the maximum blob size (${options.maxBlobSize})", display)
                }
            }
        }
    }
}

internal val ALLOWED_VTABLES: Set<String> = setOf("fragments_fts", "fragments_fts_trigram")

/** Python truthiness of an SQL value. */
internal fun sqlTruthy(v: SqlValue): Boolean = when (v) {
    SqlValue.Null -> false
    is SqlValue.Integer -> v.value != 0L
    is SqlValue.Real -> v.value != 0.0
    is SqlValue.Text -> v.value.isNotEmpty()
    is SqlValue.Blob -> v.value.isNotEmpty()
}
