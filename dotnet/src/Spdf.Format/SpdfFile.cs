using System.IO.Compression;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Spdf;

/// <summary>Options for opening a file. The defaults are safe.</summary>
public sealed record SpdfOpenOptions
{
    /// <summary>Cap for any single string or blob (<c>SQLITE_LIMIT_LENGTH</c>). Default 512 MiB.</summary>
    public long MaxBlobSize { get; init; } = SpdfInfo.DefaultMaxBlobSize;

    /// <summary>Cap for the decompressed size of a gzip-wrapped file. Default 4 GiB.</summary>
    public long MaxDecompressedSize { get; init; } = SpdfInfo.DefaultMaxDecompressedSize;
}

/// <summary>
/// An open SPDF file (5.0, or legacy 4.0/4.1 through the 5.0 view), read-only.
/// </summary>
/// <remarks>
/// Opening is always defensive (specification §2.4): read-only, <c>query_only</c>,
/// <c>trusted_schema=OFF</c>, <c>SQLITE_DBCONFIG_DEFENSIVE</c>, extension loading disabled,
/// a length limit for strings and blobs, and files with triggers, views, foreign virtual
/// tables or unknown required extensions are refused. Gzip-wrapped files (legacy 4.x) and
/// files left in WAL mode are read from a private temporary copy that is deleted on
/// <see cref="Dispose"/>. Instances are not thread-safe.
/// </remarks>
public sealed partial class SpdfFile : IDisposable, IAsyncDisposable
{
    private static readonly byte[] SqliteMagic = "SQLite format 3\0"u8.ToArray();

    private static readonly HashSet<string> LegacyTriggers = new(StringComparer.Ordinal) { "fragmentos_ai", "fragmentos_ad", "fragmentos_au" };

    private static readonly HashSet<string> AllowedVirtualTables = new(StringComparer.Ordinal) { "fragments_fts", "fragments_fts_trigram" };

    [GeneratedRegex("USING\\s+fts5\\s*\\(", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex UsingFts5();

    private SqliteConnection? _con;
    private readonly string? _tmp;
    private readonly HashSet<string> _tables = new(StringComparer.Ordinal);
    private readonly Dictionary<string, HashSet<string>> _columns = new(StringComparer.Ordinal);
    private HashSet<string>? _legacyBlobKeys;

    private SpdfFile(SqliteConnection con, string? path, string physical, string? tmp, bool gzipped, SpdfOpenOptions options)
    {
        _con = con;
        Path = path;
        PhysicalPath = physical;
        _tmp = tmp;
        IsGzipped = gzipped;
        Options = options;
    }

    /// <summary>The path the file was opened from, or <c>null</c> for in-memory input.</summary>
    public string? Path { get; }

    /// <summary>SPDF version of the file: <c>5.0</c> (or a newer 5.x), <c>4.1</c> or <c>4.0</c>.</summary>
    public string Version { get; private set; } = "";

    /// <summary>Whether the file uses the legacy 4.x (Spanish) schema.</summary>
    public bool IsLegacy { get; private set; }

    /// <summary>Whether the file was gzip-wrapped.</summary>
    public bool IsGzipped { get; }

    /// <summary>The options the file was opened with.</summary>
    public SpdfOpenOptions Options { get; }

    internal string PhysicalPath { get; }

    internal long UserVersion { get; private set; }

    internal IReadOnlySet<string> Tables => _tables;

    /// <summary>The underlying read-only connection, for advanced queries. Do not dispose it.</summary>
    public SqliteConnection Connection => _con ?? throw new ObjectDisposedException(nameof(SpdfFile));

    // ------------------------------------------------------------------
    // Opening
    // ------------------------------------------------------------------

    /// <summary>Opens an SPDF file safely.</summary>
    /// <exception cref="SpdfException">The file is not an SPDF file or breaks a safety rule (E001, E002, E020, E060).</exception>
    public static SpdfFile Open(string path, SpdfOpenOptions? options = null) => OpenPath(path, options ?? new SpdfOpenOptions(), lenient: false);

    /// <summary>Opens an SPDF file safely, decompressing or copying it asynchronously when needed.</summary>
    public static async Task<SpdfFile> OpenAsync(string path, SpdfOpenOptions? options = null, CancellationToken cancellationToken = default)
    {
        options ??= new SpdfOpenOptions();
        string? tmp = await PrepareAsync(path, options, cancellationToken).ConfigureAwait(false);
        return OpenPrepared(path, tmp ?? path, tmp, IsGzipFile(path), options, lenient: false);
    }

    /// <summary>Opens an SPDF file held in memory (gzip-wrapped or not); the bytes go to a temporary file deleted on <see cref="Dispose"/>.</summary>
    public static SpdfFile Open(ReadOnlySpan<byte> data, SpdfOpenOptions? options = null)
    {
        options ??= new SpdfOpenOptions();
        using var ms = new MemoryStream(data.ToArray(), writable: false);
        return Open(ms, options);
    }

    /// <summary>Opens an SPDF file from a stream (gzip-wrapped or not); the bytes go to a temporary file deleted on <see cref="Dispose"/>.</summary>
    public static SpdfFile Open(Stream stream, SpdfOpenOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(stream);
        options ??= new SpdfOpenOptions();
        var head = new byte[2];
        int n = ReadAtMost(stream, head);
        var all = new ConcatStream(head.AsMemory(0, n), stream);
        bool gz = n == 2 && head[0] == 0x1f && head[1] == 0x8b;
        string tmp = gz ? GunzipToTemp(all, options.MaxDecompressedSize) : CopyToTemp(all, options.MaxDecompressedSize);
        return OpenPrepared(null, tmp, tmp, gz, options, lenient: false);
    }

    internal static SpdfFile OpenLenient(string path, SpdfOpenOptions options) => OpenPath(path, options, lenient: true);

    private static bool IsGzipFile(string path)
    {
        using var fh = File.OpenRead(path);
        return fh.ReadByte() == 0x1f && fh.ReadByte() == 0x8b;
    }

    private static SpdfFile OpenPath(string path, SpdfOpenOptions options, bool lenient)
    {
        ArgumentNullException.ThrowIfNull(path);
        bool gz;
        string? tmp = null;
        using (var fh = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            var head = new byte[100];
            int n = ReadAtMost(fh, head);
            gz = n >= 2 && head[0] == 0x1f && head[1] == 0x8b;
            if (gz)
            {
                fh.Position = 0;
                tmp = GunzipToTemp(fh, options.MaxDecompressedSize);
            }
            else if (n < 100 || !head.AsSpan(0, 16).SequenceEqual(SqliteMagic))
            {
                throw new SpdfException("E001", "not an SQLite database", path);
            }
            else if (head[18] == 2 || head[19] == 2)
            {
                // A database left in WAL mode cannot be opened read-only without its -shm
                // file: work on a copy with the header switched back to rollback mode.
                fh.Position = 0;
                tmp = CopyToTemp(fh, options.MaxDecompressedSize);
            }
        }
        return OpenPrepared(path, tmp ?? path, tmp, gz, options, lenient);
    }

    private static async Task<string?> PrepareAsync(string path, SpdfOpenOptions options, CancellationToken ct)
    {
        await using var fh = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 81920, useAsync: true);
        var head = new byte[100];
        int n = 0;
        while (n < head.Length)
        {
            int r = await fh.ReadAsync(head.AsMemory(n), ct).ConfigureAwait(false);
            if (r == 0)
            {
                break;
            }
            n += r;
        }
        bool gz = n >= 2 && head[0] == 0x1f && head[1] == 0x8b;
        if (!gz && (n < 100 || !head.AsSpan(0, 16).SequenceEqual(SqliteMagic)))
        {
            throw new SpdfException("E001", "not an SQLite database", path);
        }
        if (!gz && head[18] != 2 && head[19] != 2)
        {
            return null;
        }
        fh.Position = 0;
        if (gz)
        {
            await using var z = new GZipStream(fh, CompressionMode.Decompress, leaveOpen: true);
            return await CopyToTempAsync(z, options.MaxDecompressedSize, ct).ConfigureAwait(false);
        }
        return await CopyToTempAsync(fh, options.MaxDecompressedSize, ct).ConfigureAwait(false);
    }

    private static int ReadAtMost(Stream s, byte[] buffer)
    {
        int n = 0;
        while (n < buffer.Length)
        {
            int r = s.Read(buffer, n, buffer.Length - n);
            if (r == 0)
            {
                break;
            }
            n += r;
        }
        return n;
    }

    private static string NewTempPath() =>
        System.IO.Path.Combine(System.IO.Path.GetTempPath(), "spdf-" + Guid.NewGuid().ToString("N") + ".sqlite");

    internal static string GunzipToTemp(Stream input, long limit)
    {
        try
        {
            using var z = new GZipStream(input, CompressionMode.Decompress, leaveOpen: true);
            return CopyToTemp(z, limit);
        }
        catch (InvalidDataException e)
        {
            throw new SpdfException("E001", "invalid gzip stream: " + e.Message, null, e);
        }
    }

    /// <summary>Copies to a temporary file (bounded), checks the SQLite magic and switches a WAL header back to rollback mode.</summary>
    internal static string CopyToTemp(Stream source, long limit)
    {
        string name = NewTempPath();
        try
        {
            using (var out_ = new FileStream(name, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
            {
                var buffer = new byte[81920];
                long total = 0;
                int r;
                while ((r = source.Read(buffer, 0, buffer.Length)) > 0)
                {
                    total += r;
                    if (total > limit)
                    {
                        throw new SpdfException("E001", $"decompressed size exceeds {limit} bytes");
                    }
                    out_.Write(buffer, 0, r);
                }
                FinishTemp(out_);
            }
            return name;
        }
        catch (InvalidDataException e)
        {
            TryDelete(name);
            throw new SpdfException("E001", "invalid gzip stream: " + e.Message, null, e);
        }
        catch
        {
            TryDelete(name);
            throw;
        }
    }

    private static async Task<string> CopyToTempAsync(Stream source, long limit, CancellationToken ct)
    {
        string name = NewTempPath();
        try
        {
            await using (var out_ = new FileStream(name, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 81920, useAsync: true))
            {
                var buffer = new byte[81920];
                long total = 0;
                int r;
                while ((r = await source.ReadAsync(buffer, ct).ConfigureAwait(false)) > 0)
                {
                    total += r;
                    if (total > limit)
                    {
                        throw new SpdfException("E001", $"decompressed size exceeds {limit} bytes");
                    }
                    await out_.WriteAsync(buffer.AsMemory(0, r), ct).ConfigureAwait(false);
                }
                FinishTemp(out_);
            }
            return name;
        }
        catch (InvalidDataException e)
        {
            TryDelete(name);
            throw new SpdfException("E001", "invalid gzip stream: " + e.Message, null, e);
        }
        catch
        {
            TryDelete(name);
            throw;
        }
    }

    private static void FinishTemp(FileStream f)
    {
        f.Flush();
        f.Position = 0;
        var head = new byte[100];
        int n = ReadAtMost(f, head);
        if (n < 100 || !head.AsSpan(0, 16).SequenceEqual(SqliteMagic))
        {
            throw new SpdfException("E001", "not an SQLite database");
        }
        if (head[18] == 2 || head[19] == 2)
        {
            f.Position = 18;
            f.Write([1, 1]);
            f.Flush();
        }
    }

    internal static void TryDelete(string? path)
    {
        if (path is null)
        {
            return;
        }
        foreach (var p in new[] { path, path + "-journal", path + "-wal", path + "-shm" })
        {
            try
            {
                File.Delete(p);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    private static SpdfFile OpenPrepared(string? display, string physical, string? tmp, bool gz, SpdfOpenOptions options, bool lenient)
    {
        SqliteConnection? con = null;
        try
        {
            try
            {
                con = SqliteUtil.OpenReadOnly(physical, options.MaxBlobSize);
            }
            catch (SqliteException e)
            {
                throw new SpdfException("E001", "cannot open: " + e.Message, display, e);
            }
            var f = new SpdfFile(con, display, physical, tmp, gz, options);
            f.Inspect(lenient);
            return f;
        }
        catch
        {
            con?.Dispose();
            TryDelete(tmp);
            throw;
        }
    }

    /// <summary>Reads the schema, detects the version and enforces the safety rules.</summary>
    private void Inspect(bool lenient)
    {
        var con = Connection;
        List<object?[]> entries;
        long appId, userVersion;
        try
        {
            entries = SqliteUtil.Rows(con, "SELECT type, name, sql FROM sqlite_master");
            appId = (long)(SqliteUtil.Scalar(con, "PRAGMA application_id") ?? 0L);
            userVersion = (long)(SqliteUtil.Scalar(con, "PRAGMA user_version") ?? 0L);
        }
        catch (SqliteException e)
        {
            throw new SpdfException("E001", "not an SQLite database: " + e.Message, Path, e);
        }
        UserVersion = userVersion;
        foreach (var e in entries)
        {
            if (e[0] as string == "table" && e[1] is string name)
            {
                _tables.Add(name);
            }
        }
        if (appId == SpdfInfo.ApplicationId)
        {
            if (userVersion < 500 || userVersion > 599)
            {
                throw new SpdfException("E002", $"unknown user_version {userVersion}", Path);
            }
            Version = FormatVersion(userVersion);
        }
        else if (_tables.Contains("spdf") && _tables.Contains("documentos"))
        {
            IsLegacy = true;
            string? v = null;
            try
            {
                v = SqliteUtil.Scalar(con, "SELECT valor FROM spdf WHERE clave = 'spdf_version'") switch
                {
                    null => null,
                    string s => s,
                    var o => Convert.ToString(o, System.Globalization.CultureInfo.InvariantCulture),
                };
            }
            catch (SqliteException)
            {
            }
            if (v is not null && v.StartsWith("4.", StringComparison.Ordinal))
            {
                Version = v;
            }
            else if (userVersion is 400 or 410)
            {
                Version = FormatVersion(userVersion);
            }
            else
            {
                throw new SpdfException("E002", "unknown legacy version", Path);
            }
        }
        else
        {
            throw new SpdfException("E002", $"unknown application_id {appId} / user_version {userVersion}", Path);
        }
        if (!lenient)
        {
            foreach (var problem in SchemaObjectProblems(entries))
            {
                throw problem;
            }
        }
        // Columns of the tables this library reads.
        var wanted = new HashSet<string>(SpdfSchema.Columns.Keys, StringComparer.Ordinal);
        wanted.UnionWith(SpdfSchema.LegacyTables.Values);
        wanted.ExceptWith(["fragments_fts", "fragmentos_fts"]);
        foreach (var t in wanted)
        {
            if (!_tables.Contains(t))
            {
                continue;
            }
            var cols = new HashSet<string>(StringComparer.Ordinal);
            try
            {
                foreach (var r in SqliteUtil.Rows(con, "SELECT name FROM pragma_table_info(@p0)", [t]))
                {
                    if (r[0] is string c)
                    {
                        cols.Add(c);
                    }
                }
            }
            catch (SqliteException e)
            {
                if (!lenient)
                {
                    throw new SpdfException("E001", $"cannot read table {t}: {e.Message}", Path, e);
                }
            }
            _columns[t] = cols;
        }
        if (!lenient && !IsLegacy && HasColumns("extensions", "name", "required"))
        {
            foreach (var r in SqliteUtil.Rows(con, "SELECT name FROM extensions WHERE required <> 0 ORDER BY name"))
            {
                if (r[0] is string ext && !SpdfInfo.KnownExtensions.Contains(ext))
                {
                    throw new SpdfException("E060", "unknown required extension", ext);
                }
            }
        }
    }

    private static string FormatVersion(long userVersion) =>
        $"{userVersion / 100}.{userVersion % 100 / 10}";

    /// <summary>Triggers, views and foreign virtual tables (E020).</summary>
    internal IEnumerable<SpdfException> SchemaObjectProblems(List<object?[]>? entries = null)
    {
        entries ??= SqliteUtil.Rows(Connection, "SELECT type, name, sql FROM sqlite_master");
        foreach (var e in entries)
        {
            string type = e[0] as string ?? "";
            string name = e[1] as string ?? "";
            string sql = e[2] as string ?? "";
            if (type == "view")
            {
                yield return new SpdfException("E020", $"view {name} present", name);
            }
            else if (type == "trigger" && !(IsLegacy && LegacyTriggers.Contains(name)))
            {
                yield return new SpdfException("E020", $"trigger {name} present", name);
            }
            else if (type == "table" && !IsLegacy && sql.StartsWith("CREATE VIRTUAL TABLE", StringComparison.OrdinalIgnoreCase)
                     && (!AllowedVirtualTables.Contains(name) || !UsingFts5().IsMatch(sql)))
            {
                yield return new SpdfException("E020", $"virtual table {name} present", name);
            }
        }
    }

    /// <summary>Closes the connection and deletes the temporary copy, if any.</summary>
    public void Dispose()
    {
        var con = _con;
        _con = null;
        con?.Dispose();
        TryDelete(_tmp);
    }

    /// <inheritdoc/>
    public ValueTask DisposeAsync()
    {
        Dispose();
        return ValueTask.CompletedTask;
    }

    // ------------------------------------------------------------------
    // Table and column mapping (5.0 names → physical names)
    // ------------------------------------------------------------------

    internal string Table(string t5) => IsLegacy && SpdfSchema.LegacyTables.TryGetValue(t5, out var l) ? l : t5;

    internal bool HasTable(string t5) => _tables.Contains(Table(t5));

    internal bool HasColumns(string physicalTable, params string[] cols) =>
        _columns.TryGetValue(physicalTable, out var have) && cols.All(have.Contains);

    internal string Col(string t5, string c)
    {
        if (IsLegacy && SpdfSchema.LegacyColumns.TryGetValue(t5, out var m) && m.TryGetValue(c, out var l) && l.Length > 0)
        {
            return SqliteUtil.QuoteIdent(l);
        }
        return SqliteUtil.QuoteIdent(c);
    }

    /// <summary>SELECT list for 5.0 columns, mapping legacy names and substituting NULL (or a default) for absent columns.</summary>
    internal string SelectList(string t5, IEnumerable<string> cols)
    {
        string phys = Table(t5);
        _columns.TryGetValue(phys, out var present);
        var parts = new List<string>();
        foreach (var c in cols)
        {
            string src = c;
            if (IsLegacy && SpdfSchema.LegacyColumns.TryGetValue(t5, out var m) && m.TryGetValue(c, out var l))
            {
                src = l;
            }
            if (src.Length == 0 || present is null || !present.Contains(src))
            {
                if (IsLegacy && SpdfSchema.LegacyDefaults.TryGetValue(t5 + "." + c, out var lit))
                {
                    parts.Add(lit + " AS " + SqliteUtil.QuoteIdent(c));
                }
                else
                {
                    parts.Add("NULL AS " + SqliteUtil.QuoteIdent(c));
                }
                continue;
            }
            parts.Add(SqliteUtil.QuoteIdent(src) + " AS " + SqliteUtil.QuoteIdent(c));
        }
        return string.Join(", ", parts);
    }

    /// <summary>Selects 5.0 columns of a 5.0 table (mapped on legacy files) as dictionaries.</summary>
    internal List<Dictionary<string, object?>> QueryRows(string t5, IReadOnlyList<string> cols, string tail = "", IReadOnlyList<object?>? args = null)
    {
        var rows = new List<Dictionary<string, object?>>();
        if (!HasTable(t5))
        {
            return rows;
        }
        string sql = "SELECT " + SelectList(t5, cols) + " FROM " + SqliteUtil.QuoteIdent(Table(t5)) + (tail.Length > 0 ? " " + tail : "");
        foreach (var r in SqliteUtil.Rows(Connection, sql, args))
        {
            var d = new Dictionary<string, object?>(cols.Count, StringComparer.Ordinal);
            for (int i = 0; i < cols.Count; i++)
            {
                d[cols[i]] = r[i];
            }
            rows.Add(d);
        }
        return rows;
    }

    internal IReadOnlySet<string> LegacyBlobKeys()
    {
        if (_legacyBlobKeys is not null)
        {
            return _legacyBlobKeys;
        }
        var keys = new HashSet<string>(StringComparer.Ordinal);
        if (_tables.Contains("blobs") && HasColumns("blobs", "clave"))
        {
            foreach (var r in SqliteUtil.Rows(Connection, "SELECT clave FROM blobs"))
            {
                if (r[0] is string k)
                {
                    keys.Add(k);
                }
            }
        }
        _legacyBlobKeys = keys;
        return keys;
    }

    /// <summary>A stream that first yields a prefix, then the rest of another stream.</summary>
    private sealed class ConcatStream(ReadOnlyMemory<byte> prefix, Stream rest) : Stream
    {
        private ReadOnlyMemory<byte> _prefix = prefix;

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            if (_prefix.Length > 0)
            {
                int n = Math.Min(count, _prefix.Length);
                _prefix.Span[..n].CopyTo(buffer.AsSpan(offset, n));
                _prefix = _prefix[n..];
                return n;
            }
            return rest.Read(buffer, offset, count);
        }

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
