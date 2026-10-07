using Microsoft.Data.Sqlite;
using SQLitePCL;

namespace Spdf;

/// <summary>Connection helpers: hardened read-only opening, parameter binding, row reading.</summary>
internal static class SqliteUtil
{
    private const int SqliteDbConfigEnableLoadExtension = 1005;
    private const int SqliteDbConfigDefensive = 1010;
    private const int SqliteDbConfigTrustedSchema = 1017;
    private const int SqliteLimitLength = 0;

    static SqliteUtil() => Batteries_V2.Init();

    public static void EnsureInitialized()
    {
        // The static constructor does the work.
    }

    /// <summary>Opens a database read-only with every protection of the specification (§2.4).</summary>
    public static SqliteConnection OpenReadOnly(string path, long maxBlobSize)
    {
        var csb = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadOnly,
            Pooling = false,
            Cache = SqliteCacheMode.Private,
        };
        var con = new SqliteConnection(csb.ToString());
        try
        {
            con.Open();
            Harden(con, maxBlobSize);
            Exec(con, "PRAGMA query_only = 1");
            Exec(con, "PRAGMA mmap_size = 0");
            Exec(con, "PRAGMA cell_size_check = ON");
            return con;
        }
        catch
        {
            con.Dispose();
            throw;
        }
    }

    /// <summary>Opens a private in-memory database (FTS integrity checks run on such a copy).</summary>
    public static SqliteConnection OpenMemory()
    {
        var con = new SqliteConnection("Data Source=:memory:;Pooling=False");
        try
        {
            con.Open();
            Harden(con, SpdfInfo.DefaultMaxBlobSize);
            return con;
        }
        catch
        {
            con.Dispose();
            throw;
        }
    }

    /// <summary>Opens (creating) a database for writing.</summary>
    public static SqliteConnection OpenWritable(string path)
    {
        var csb = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
            Cache = SqliteCacheMode.Private,
            ForeignKeys = false, // the document row is written last, on commit
        };
        var con = new SqliteConnection(csb.ToString());
        try
        {
            con.Open();
            Harden(con, int.MaxValue);
            return con;
        }
        catch
        {
            con.Dispose();
            throw;
        }
    }

    /// <summary>Defensive mode, no extension loading, untrusted schema, length limit.</summary>
    public static void Harden(SqliteConnection con, long maxBlobSize)
    {
        var db = con.Handle ?? throw new InvalidOperationException("connection is not open");
        if (raw.sqlite3_db_config(db, SqliteDbConfigDefensive, 1, out int defensive) != raw.SQLITE_OK || defensive != 1)
        {
            throw new SpdfException("E001", "SQLITE_DBCONFIG_DEFENSIVE is not available in this SQLite build");
        }
        raw.sqlite3_db_config(db, SqliteDbConfigEnableLoadExtension, 0, out _);
        raw.sqlite3_db_config(db, SqliteDbConfigTrustedSchema, 0, out _);
        raw.sqlite3_limit(db, SqliteLimitLength, (int)Math.Clamp(maxBlobSize, 1, int.MaxValue));
        Exec(con, "PRAGMA trusted_schema = OFF");
    }

    public static SqliteCommand Command(SqliteConnection con, string sql, IReadOnlyList<object?>? args = null, SqliteTransaction? tx = null)
    {
        var cmd = con.CreateCommand();
        cmd.CommandText = sql;
        cmd.Transaction = tx;
        if (args is not null)
        {
            for (int i = 0; i < args.Count; i++)
            {
                cmd.Parameters.AddWithValue("@p" + i.ToString(System.Globalization.CultureInfo.InvariantCulture), args[i] ?? DBNull.Value);
            }
        }
        return cmd;
    }

    public static int Exec(SqliteConnection con, string sql, IReadOnlyList<object?>? args = null, SqliteTransaction? tx = null)
    {
        using var cmd = Command(con, sql, args, tx);
        return cmd.ExecuteNonQuery();
    }

    public static object? Scalar(SqliteConnection con, string sql, IReadOnlyList<object?>? args = null)
    {
        using var cmd = Command(con, sql, args);
        return Normalize(cmd.ExecuteScalar());
    }

    /// <summary>Runs a query and returns every row as an array of normalized values.</summary>
    public static List<object?[]> Rows(SqliteConnection con, string sql, IReadOnlyList<object?>? args = null)
    {
        using var cmd = Command(con, sql, args);
        using var r = cmd.ExecuteReader();
        var rows = new List<object?[]>();
        while (r.Read())
        {
            var row = new object?[r.FieldCount];
            for (int i = 0; i < row.Length; i++)
            {
                row[i] = Normalize(r.GetValue(i));
            }
            rows.Add(row);
        }
        return rows;
    }

    /// <summary>DBNull → null; everything else (long, double, string, byte[]) as it is.</summary>
    public static object? Normalize(object? v) => v is DBNull ? null : v;

    public static string QuoteIdent(string s) => "\"" + s.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
}
