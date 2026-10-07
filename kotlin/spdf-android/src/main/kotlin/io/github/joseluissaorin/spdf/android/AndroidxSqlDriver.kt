package io.github.joseluissaorin.spdf.android

import androidx.sqlite.SQLITE_DATA_BLOB
import androidx.sqlite.SQLITE_DATA_FLOAT
import androidx.sqlite.SQLITE_DATA_INTEGER
import androidx.sqlite.SQLITE_DATA_NULL
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.driver.bundled.SQLITE_OPEN_CREATE
import androidx.sqlite.driver.bundled.SQLITE_OPEN_READONLY
import androidx.sqlite.driver.bundled.SQLITE_OPEN_READWRITE
import io.github.joseluissaorin.spdf.sql.SqlConnection
import io.github.joseluissaorin.spdf.sql.SqlDriver
import io.github.joseluissaorin.spdf.sql.SqlException
import io.github.joseluissaorin.spdf.sql.SqlRow
import io.github.joseluissaorin.spdf.sql.SqlRowHandler
import io.github.joseluissaorin.spdf.sql.SqlSafety
import io.github.joseluissaorin.spdf.sql.SqlValue

/**
 * The SQLite adapter for Android, over the androidx.sqlite driver API with
 * [BundledSQLiteDriver] (`androidx.sqlite:sqlite-bundled`): the app ships its own SQLite, built
 * with FTS5 and the trigram tokenizer, which the system `android.database.sqlite` does not
 * guarantee. The same code runs on the host JVM (the bundled driver ships desktop natives),
 * which is how it is tested. Registered with `ServiceLoader`.
 *
 * Safety (SPEC §2.4): files open with SQLITE_OPEN_READONLY and extensions are never added;
 * the core adds `query_only`, `trusted_schema = OFF`, `mmap_size = 0` and `cell_size_check`.
 * The driver API exposes neither `sqlite3_db_config` (no SQLITE_DBCONFIG_DEFENSIVE) nor
 * `sqlite3_limit`; the core therefore bounds value sizes itself (no value can exceed the file
 * size, and larger files are measured once on open).
 */
public class AndroidxSqlDriver @JvmOverloads constructor(
    private val driver: BundledSQLiteDriver = BundledSQLiteDriver(),
) : SqlDriver {
    override val name: String = "androidx.sqlite bundled"

    override fun openReadOnly(path: String, maxValueLength: Long): SqlConnection =
        AndroidxConnection(open(path, SQLITE_OPEN_READONLY), SqlSafety(readOnly = true, defensive = false, lengthLimit = false, extensionsDisabled = true))

    override fun openReadWrite(path: String): SqlConnection =
        AndroidxConnection(
            open(path, SQLITE_OPEN_READWRITE or SQLITE_OPEN_CREATE),
            SqlSafety(readOnly = false, defensive = false, lengthLimit = false, extensionsDisabled = true),
        )

    private fun open(path: String, flags: Int): SQLiteConnection = try {
        driver.open(path, flags)
    } catch (e: RuntimeException) {
        throw SqlException("cannot open $path: ${e.message}", e)
    }

    override fun toString(): String = name
}

private class AndroidxConnection(private val conn: SQLiteConnection, override val safety: SqlSafety) : SqlConnection {
    private fun prepare(sql: String, args: List<SqlValue>): SQLiteStatement {
        val st = conn.prepare(sql)
        try {
            args.forEachIndexed { i, v ->
                val k = i + 1
                when (v) {
                    SqlValue.Null -> st.bindNull(k)
                    is SqlValue.Integer -> st.bindLong(k, v.value)
                    is SqlValue.Real -> st.bindDouble(k, v.value)
                    is SqlValue.Text -> st.bindText(k, v.value)
                    is SqlValue.Blob -> st.bindBlob(k, v.value)
                }
            }
        } catch (e: Throwable) {
            st.close()
            throw e
        }
        return st
    }

    override fun query(sql: String, args: List<SqlValue>, handler: SqlRowHandler) {
        try {
            prepare(sql, args).use { st ->
                val n = st.getColumnCount()
                val names = (0 until n).map { st.getColumnName(it) }
                while (st.step()) {
                    val values = ArrayList<SqlValue>(n)
                    for (i in 0 until n) {
                        values += when (st.getColumnType(i)) {
                            SQLITE_DATA_NULL -> SqlValue.Null
                            SQLITE_DATA_INTEGER -> SqlValue.Integer(st.getLong(i))
                            SQLITE_DATA_FLOAT -> SqlValue.Real(st.getDouble(i))
                            SQLITE_DATA_BLOB -> SqlValue.Blob(st.getBlob(i))
                            else -> SqlValue.Text(st.getText(i))
                        }
                    }
                    handler.handle(SqlRow(names, values))
                }
            }
        } catch (e: SqlException) {
            throw e
        } catch (e: RuntimeException) {
            throw SqlException(e.message ?: e.toString(), e)
        }
    }

    override fun execute(sql: String, args: List<SqlValue>) {
        try {
            prepare(sql, args).use { st -> while (st.step()) continue }
        } catch (e: RuntimeException) {
            throw SqlException(e.message ?: e.toString(), e)
        }
    }

    override fun close() {
        conn.close()
    }
}
