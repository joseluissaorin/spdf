package io.github.joseluissaorin.spdf.sql

import java.io.File
import java.util.ServiceLoader

/**
 * A value read from or bound to SQLite. Exactly the five storage classes of SQLite, so no
 * binding-specific type (JDBC, androidx.sqlite…) ever reaches the core.
 */
public sealed class SqlValue {
    /** SQL NULL. */
    public object Null : SqlValue() {
        override fun toString(): String = "NULL"
    }

    /** INTEGER. */
    public data class Integer(val value: Long) : SqlValue()

    /** REAL. */
    public data class Real(val value: Double) : SqlValue()

    /** TEXT. */
    public data class Text(val value: String) : SqlValue()

    /** BLOB. */
    public class Blob(public val value: ByteArray) : SqlValue() {
        override fun equals(other: Any?): Boolean = other is Blob && value.contentEquals(other.value)
        override fun hashCode(): Int = value.contentHashCode()
        override fun toString(): String = "Blob(${value.size} bytes)"
    }

    /** The value as a plain Kotlin/Java object: null, Long, Double, String or ByteArray. */
    public fun toAny(): Any? = when (this) {
        Null -> null
        is Integer -> value
        is Real -> value
        is Text -> value
        is Blob -> value
    }

    public companion object {
        /** Wraps null, any integral number, Float/Double, String, ByteArray or Boolean. */
        @JvmStatic
        public fun of(value: Any?): SqlValue = when (value) {
            null -> Null
            is SqlValue -> value
            is Long -> Integer(value)
            is Int -> Integer(value.toLong())
            is Short -> Integer(value.toLong())
            is Byte -> Integer(value.toLong())
            is Boolean -> Integer(if (value) 1 else 0)
            is Double -> Real(value)
            is Float -> Real(value.toDouble())
            is String -> Text(value)
            is ByteArray -> Blob(value)
            is Number -> Real(value.toDouble())
            else -> throw IllegalArgumentException("cannot bind ${value::class.java.name} to SQLite")
        }
    }
}

/** An error reported by the SQLite binding (adapters wrap their own exceptions in it). */
public class SqlException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

/** One result row: column names and values, in the order of the SELECT list. */
public class SqlRow(public val columns: List<String>, public val values: List<SqlValue>) {
    init {
        require(columns.size == values.size) { "columns and values differ in length" }
    }

    /** Number of columns. */
    public val size: Int get() = values.size

    /** Value of column [index] (0-based). */
    public operator fun get(index: Int): SqlValue = values[index]

    /** Value of the first column called [column], or [SqlValue.Null] if there is none. */
    public operator fun get(column: String): SqlValue {
        val i = columns.indexOf(column)
        return if (i < 0) SqlValue.Null else values[i]
    }

    /** True if the row has a column called [column]. */
    public fun has(column: String): Boolean = columns.contains(column)

    override fun toString(): String = columns.zip(values).joinToString(", ", "{", "}") { (c, v) -> "$c=$v" }
}

/** Receives result rows one by one (streaming, so large blobs are never all in memory). */
public fun interface SqlRowHandler {
    public fun handle(row: SqlRow)
}

/** What the binding could enforce when a file was opened read-only (SPEC §2.4). */
public class SqlSafety(
    /** Opened with SQLITE_OPEN_READONLY (or mode=ro). */
    public val readOnly: Boolean,
    /** SQLITE_DBCONFIG_DEFENSIVE is on. */
    public val defensive: Boolean,
    /** SQLITE_LIMIT_LENGTH caps every TEXT and BLOB value. */
    public val lengthLimit: Boolean,
    /** Extension loading is off. */
    public val extensionsDisabled: Boolean,
) {
    override fun toString(): String =
        "SqlSafety(readOnly=$readOnly, defensive=$defensive, lengthLimit=$lengthLimit, extensionsDisabled=$extensionsDisabled)"
}

/** A connection to one SQLite database. Not thread-safe. */
public interface SqlConnection : AutoCloseable {
    /** Protections in force on this connection. */
    public val safety: SqlSafety

    /** Runs one statement and streams its rows (if any) to [handler]. Parameters are 1-based `?`. */
    public fun query(sql: String, args: List<SqlValue>, handler: SqlRowHandler)

    /** Runs one statement that returns no rows of interest. */
    public fun execute(sql: String, args: List<SqlValue>)

    /** Closes the connection. */
    override fun close()

    /** Runs one statement and returns all its rows. */
    public fun queryAll(sql: String, args: List<SqlValue>): List<SqlRow> {
        val out = ArrayList<SqlRow>()
        query(sql, args) { out.add(it) }
        return out
    }
}

/**
 * Opens SQLite databases. The core never talks to a binding directly: adapters implement this
 * interface (`JdbcSqlDriver` in `io.github.joseluissaorin:spdf`, `AndroidxSqlDriver` in
 * `io.github.joseluissaorin:spdf-android`). An adapter MUST NOT load extensions.
 */
public interface SqlDriver {
    /** Short name, for messages ("sqlite-jdbc 3.53.4", "androidx.sqlite bundled"…). */
    public val name: String

    /**
     * Opens an existing database read-only, with as many of the protections of SPEC §2.4 as
     * the binding allows, and with [maxValueLength] as SQLITE_LIMIT_LENGTH if it can. The core
     * sets the pragmas (`query_only`, `trusted_schema`…) itself.
     */
    public fun openReadOnly(path: String, maxValueLength: Long): SqlConnection

    /** Opens (creating it if needed) a database read-write. Used by the writer and for private copies. */
    public fun openReadWrite(path: String): SqlConnection

    /**
     * Opens a private, writable copy of the database at [path] (for FTS5 `integrity-check`,
     * which is a write). The default copies the file to a temporary file that is deleted on close.
     */
    public fun openPrivateCopy(path: String, tempDir: File?): SqlConnection {
        val tmp = File.createTempFile("spdf-copy-", ".sqlite", tempDir)
        try {
            File(path).inputStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
            val conn = openReadWrite(tmp.path)
            return object : SqlConnection by conn {
                override fun close() {
                    try {
                        conn.close()
                    } finally {
                        tmp.delete()
                        File(tmp.path + "-journal").delete()
                    }
                }
            }
        } catch (e: Throwable) {
            tmp.delete()
            throw e
        }
    }

    public companion object {
        /**
         * The first driver registered with [ServiceLoader] (`META-INF/services/
         * io.github.joseluissaorin.spdf.sql.SqlDriver`): the JDBC adapter on the JVM, the
         * androidx.sqlite adapter on Android. Throws if no adapter is on the classpath. From Java:
         * `SqlDriver.defaultDriver()` (`default` is a Java keyword).
         */
        @JvmStatic
        @JvmName("defaultDriver")
        public fun default(): SqlDriver = cached ?: synchronized(this) {
            cached ?: run {
                val loader = SqlDriver::class.java.classLoader
                val found = ServiceLoader.load(SqlDriver::class.java, loader).firstOrNull()
                    ?: ServiceLoader.load(SqlDriver::class.java).firstOrNull()
                    ?: throw IllegalStateException(
                        "no SPDF SQLite adapter on the classpath: add io.github.joseluissaorin:spdf " +
                            "(JVM) or io.github.joseluissaorin:spdf-android, or pass a SqlDriver",
                    )
                cached = found
                found
            }
        }

        @Volatile
        private var cached: SqlDriver? = null
    }
}

// Small conveniences used throughout the core.

internal fun args(vararg values: Any?): List<SqlValue> = values.map { SqlValue.of(it) }

internal fun SqlConnection.rows(sql: String, vararg values: Any?): List<SqlRow> = queryAll(sql, args(*values))

internal fun SqlConnection.each(sql: String, vararg values: Any?, handler: (SqlRow) -> Unit) {
    query(sql, args(*values)) { handler(it) }
}

internal fun SqlConnection.exec(sql: String, vararg values: Any?) {
    execute(sql, args(*values))
}

internal fun SqlConnection.scalar(sql: String, vararg values: Any?): SqlValue {
    var out: SqlValue = SqlValue.Null
    var seen = false
    query(sql, args(*values)) { row ->
        if (!seen && row.size > 0) {
            out = row[0]
            seen = true
        }
    }
    return out
}

internal fun SqlValue.asLong(): Long? = when (this) {
    is SqlValue.Integer -> value
    is SqlValue.Real -> if (value == Math.floor(value) && !value.isInfinite()) value.toLong() else null
    is SqlValue.Text -> value.trim().toLongOrNull()
    else -> null
}

internal fun SqlValue.asText(): String? = when (this) {
    is SqlValue.Text -> value
    is SqlValue.Blob -> value.toString(Charsets.UTF_8)
    is SqlValue.Integer -> value.toString()
    is SqlValue.Real -> value.toString()
    SqlValue.Null -> null
}

internal fun SqlValue.asBytes(): ByteArray? = when (this) {
    is SqlValue.Blob -> value
    is SqlValue.Text -> value.toByteArray(Charsets.UTF_8)
    else -> null
}

internal fun quoteIdent(s: String): String = "\"" + s.replace("\"", "\"\"") + "\""
