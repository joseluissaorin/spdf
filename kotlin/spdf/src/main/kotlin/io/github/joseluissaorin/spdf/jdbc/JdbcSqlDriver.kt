package io.github.joseluissaorin.spdf.jdbc

import io.github.joseluissaorin.spdf.sql.SqlConnection
import io.github.joseluissaorin.spdf.sql.SqlDriver
import io.github.joseluissaorin.spdf.sql.SqlException
import io.github.joseluissaorin.spdf.sql.SqlRow
import io.github.joseluissaorin.spdf.sql.SqlRowHandler
import io.github.joseluissaorin.spdf.sql.SqlSafety
import io.github.joseluissaorin.spdf.sql.SqlValue
import org.sqlite.SQLiteConfig
import org.sqlite.SQLiteLimits
import org.sqlite.SQLiteOpenMode
import java.io.File
import java.sql.Connection
import java.sql.PreparedStatement
import java.sql.SQLException
import java.sql.Types

/**
 * The SQLite adapter for the JVM, over `org.xerial:sqlite-jdbc` (bundled SQLite with FTS5 and
 * the trigram tokenizer). Registered with `ServiceLoader`, so `SpdfFile.open(path)` uses it
 * when this artifact is on the classpath.
 *
 * Safety (SPEC §2.4): files open with SQLITE_OPEN_READONLY, extension loading off and
 * SQLITE_LIMIT_LENGTH set to the maximum blob size; the core adds `query_only`,
 * `trusted_schema = OFF`, `mmap_size = 0` and `cell_size_check`. sqlite-jdbc does not expose
 * `sqlite3_db_config`, so SQLITE_DBCONFIG_DEFENSIVE cannot be enabled (reported in
 * [SqlSafety.defensive]); the read-only, query-only connection already refuses every write.
 */
public class JdbcSqlDriver : SqlDriver {
    override val name: String = "sqlite-jdbc " + (runCatching { org.sqlite.SQLiteJDBCLoader.getVersion() }.getOrNull() ?: "")

    override fun openReadOnly(path: String, maxValueLength: Long): SqlConnection {
        val cfg = SQLiteConfig()
        cfg.setReadOnly(true)
        cfg.setOpenMode(SQLiteOpenMode.READONLY)
        cfg.enableLoadExtension(false)
        val conn = connect(path, cfg)
        try {
            (conn as org.sqlite.SQLiteConnection).setLimit(SQLiteLimits.SQLITE_LIMIT_LENGTH, minOf(maxValueLength, Int.MAX_VALUE.toLong()).toInt())
        } catch (e: SQLException) {
            conn.close()
            throw SqlException("cannot set SQLITE_LIMIT_LENGTH: ${e.message}", e)
        }
        return JdbcConnection(conn, SqlSafety(readOnly = true, defensive = false, lengthLimit = true, extensionsDisabled = true))
    }

    override fun openReadWrite(path: String): SqlConnection {
        val cfg = SQLiteConfig()
        cfg.enableLoadExtension(false)
        return JdbcConnection(connect(path, cfg), SqlSafety(readOnly = false, defensive = false, lengthLimit = false, extensionsDisabled = true))
    }

    private fun connect(path: String, cfg: SQLiteConfig): Connection = try {
        cfg.createConnection("jdbc:sqlite:" + File(path).absolutePath)
    } catch (e: SQLException) {
        throw SqlException("cannot open $path: ${e.message}", e)
    }

    override fun toString(): String = name
}

private class JdbcConnection(private val conn: Connection, override val safety: SqlSafety) : SqlConnection {
    private fun bind(ps: PreparedStatement, args: List<SqlValue>) {
        args.forEachIndexed { i, v ->
            val k = i + 1
            when (v) {
                SqlValue.Null -> ps.setNull(k, Types.NULL)
                is SqlValue.Integer -> ps.setLong(k, v.value)
                is SqlValue.Real -> ps.setDouble(k, v.value)
                is SqlValue.Text -> ps.setString(k, v.value)
                is SqlValue.Blob -> ps.setBytes(k, v.value)
            }
        }
    }

    override fun query(sql: String, args: List<SqlValue>, handler: SqlRowHandler) {
        try {
            conn.prepareStatement(sql).use { ps ->
                bind(ps, args)
                if (!ps.execute()) return
                ps.resultSet.use { rs ->
                    val md = rs.metaData
                    val n = md.columnCount
                    val names = (1..n).map { md.getColumnLabel(it) ?: md.getColumnName(it) ?: "" }
                    while (rs.next()) {
                        val values = ArrayList<SqlValue>(n)
                        for (i in 1..n) {
                            values += when (val o = rs.getObject(i)) {
                                null -> SqlValue.Null
                                is Int -> SqlValue.Integer(o.toLong())
                                is Long -> SqlValue.Integer(o)
                                is Double -> SqlValue.Real(o)
                                is Float -> SqlValue.Real(o.toDouble())
                                is String -> SqlValue.Text(o)
                                is ByteArray -> SqlValue.Blob(o)
                                is Number -> SqlValue.Real(o.toDouble())
                                else -> SqlValue.Text(o.toString())
                            }
                        }
                        handler.handle(SqlRow(names, values))
                    }
                }
            }
        } catch (e: SQLException) {
            throw SqlException(e.message ?: e.toString(), e)
        }
    }

    override fun execute(sql: String, args: List<SqlValue>) {
        try {
            conn.prepareStatement(sql).use { ps ->
                bind(ps, args)
                if (ps.execute()) ps.resultSet.use { rs -> while (rs.next()) continue }
            }
        } catch (e: SQLException) {
            throw SqlException(e.message ?: e.toString(), e)
        }
    }

    override fun close() {
        try {
            conn.close()
        } catch (e: SQLException) {
            throw SqlException(e.message ?: e.toString(), e)
        }
    }
}
