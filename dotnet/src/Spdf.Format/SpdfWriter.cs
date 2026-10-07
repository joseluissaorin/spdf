using System.Globalization;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

namespace Spdf;

/// <summary>Options for <see cref="SpdfWriter"/>.</summary>
public sealed record SpdfWriterOptions
{
    /// <summary><c>spdf_meta.generator</c>; default <c>spdf-dotnet/&lt;version&gt;</c>.</summary>
    public string? Generator { get; init; }

    /// <summary>Adds the optional trigram index for Chinese, Japanese and Korean text.</summary>
    public bool Trigram { get; init; }

    /// <summary>
    /// Writes every value verbatim: no default <c>spdf_meta</c> keys, no computed
    /// <c>unit_count</c>, no automatic ordinals, no NFC normalization. Used to rebuild a file
    /// from a full dump (<see cref="SpdfSource.Write(IDictionary{string, object?}, string)"/>).
    /// </summary>
    public bool Exact { get; init; }
}

/// <summary>
/// Builds an SPDF 5.0 file. Rows go to a temporary file next to the destination, inside one
/// transaction; <see cref="Commit"/> writes the document and <c>spdf_meta</c>, rebuilds the FTS
/// index, runs <c>VACUUM</c> and moves the file into place. Disposing without committing
/// discards everything. The file never contains triggers or views.
/// </summary>
/// <example>
/// <code>
/// using var w = SpdfWriter.Create("out.spdf");
/// w.SetDocument(new Document { Id = "doc", Kind = "pdf", Mime = "application/pdf", SourceSha256 = sha });
/// w.AddUnit(new Unit { Id = "u1", Reader = "pdf-text-layer", Text = "…", Anchor = Anchor.Page(1, "1") });
/// w.AddFragment(new Fragment { Id = "f1", Unit = "u1", Text = "…", Anchor = Anchor.Page(1, "1") });
/// w.Commit();
/// </code>
/// </example>
public sealed class SpdfWriter : IDisposable
{
    private readonly string _path;
    private readonly string _tmp;
    private readonly SpdfWriterOptions _options;
    private readonly string _generator;
    private readonly Dictionary<string, string> _meta = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Space> _spaces = new(StringComparer.Ordinal);
    private SqliteConnection? _con;
    private SqliteTransaction? _tx;
    private Document? _doc;
    private long _nextUnit;
    private long _nextFragment;
    private long _nextN;
    private long _units;
    private long _vectors;
    private bool _hasTime;
    private bool _done;

    private SpdfWriter(string path, string tmp, SpdfWriterOptions options)
    {
        _path = path;
        _tmp = tmp;
        _options = options;
        _generator = options.Generator ?? SpdfInfo.ImplName + "/" + SpdfInfo.Version;
    }

    /// <summary>Starts a new SPDF 5.0 file at <paramref name="path"/> (replaced on commit).</summary>
    public static SpdfWriter Create(string path, SpdfWriterOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(path);
        options ??= new SpdfWriterOptions();
        string full = System.IO.Path.GetFullPath(path);
        string dir = System.IO.Path.GetDirectoryName(full) ?? ".";
        string tmp = System.IO.Path.Combine(dir, ".spdf-writer-" + Guid.NewGuid().ToString("N") + ".tmp");
        var w = new SpdfWriter(full, tmp, options);
        try
        {
            w._con = SqliteUtil.OpenWritable(tmp);
            SqliteUtil.Exec(w._con, "PRAGMA page_size = 4096");
            SqliteUtil.Exec(w._con, "PRAGMA journal_mode = DELETE");
            SqliteUtil.Exec(w._con, "PRAGMA application_id = " + SpdfInfo.ApplicationId.ToString(CultureInfo.InvariantCulture));
            SqliteUtil.Exec(w._con, "PRAGMA user_version = " + SpdfInfo.UserVersion.ToString(CultureInfo.InvariantCulture));
            SqliteUtil.Exec(w._con, SpdfSchema.Ddl);
            if (options.Trigram)
            {
                SqliteUtil.Exec(w._con, SpdfSchema.TrigramDdl);
            }
            w._tx = w._con.BeginTransaction();
            return w;
        }
        catch
        {
            w.Abort();
            throw;
        }
    }

    private int Exec(string sql, params object?[] args)
    {
        if (_con is null || _tx is null)
        {
            throw new InvalidOperationException("the writer is closed");
        }
        return SqliteUtil.Exec(_con, sql, args, _tx);
    }

    private string Nfc(string s) => _options.Exact ? s : TextUtil.Nfc(s);

    private static string? Json(object? v) => v is null ? null : SpdfJson.Compact(v);

    private void NeedDocument()
    {
        if (_doc is null)
        {
            throw new InvalidOperationException("SetDocument must be called first");
        }
    }

    /// <summary>Sets an <c>spdf_meta</c> key (overrides the defaults written on commit).</summary>
    public void SetMeta(string key, string value) => _meta[key] = value;

    /// <summary>Sets the document (written on commit). Call it once, before adding rows.</summary>
    public void SetDocument(Document document)
    {
        ArgumentNullException.ThrowIfNull(document);
        if (_doc is not null)
        {
            throw new InvalidOperationException("the document is already set");
        }
        if (!_options.Exact && (string.IsNullOrEmpty(document.Id) || string.IsNullOrEmpty(document.Kind) ||
                                string.IsNullOrEmpty(document.Mime) || string.IsNullOrEmpty(document.SourceSha256)))
        {
            throw new ArgumentException("the document needs id, kind, mime and source_sha256", nameof(document));
        }
        string created = document.Created ?? DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
        _doc = document with { Created = created, Updated = document.Updated ?? created };
    }

    /// <summary>Adds a citable unit.</summary>
    public void AddUnit(Unit unit)
    {
        ArgumentNullException.ThrowIfNull(unit);
        NeedDocument();
        long ord = unit.Ord == 0 && !_options.Exact ? _nextUnit + 1 : unit.Ord;
        _nextUnit = Math.Max(_nextUnit, ord);
        if (unit.Anchor.Type == "time")
        {
            _hasTime = true;
        }
        _units++;
        Exec("""
             INSERT INTO units (id, document, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words)
             VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13, @p14, @p15)
             """,
            unit.Id, _doc!.Id, ord, unit.Anchor.ToJson(), Nfc(unit.Text), Json(unit.Notes), unit.Header, unit.Footer,
            unit.Image, unit.Thumbnail, unit.Reader, unit.Confidence ?? 1.0, unit.Printed, unit.T0, unit.T1, Json(unit.Words));
    }

    /// <summary>Adds an entry of the table of contents.</summary>
    public void AddSection(Section section)
    {
        ArgumentNullException.ThrowIfNull(section);
        NeedDocument();
        Exec("INSERT INTO sections (id, document, parent, level, title, unit_from, unit_to, summary) VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)",
            section.Id, _doc!.Id, section.Parent, section.Level, section.Title, section.UnitFrom, section.UnitTo, section.Summary);
    }

    /// <summary>Adds a fragment (the FTS index is rebuilt on commit).</summary>
    public void AddFragment(Fragment fragment)
    {
        ArgumentNullException.ThrowIfNull(fragment);
        NeedDocument();
        long n = fragment.N == 0 && !_options.Exact ? _nextN + 1 : fragment.N;
        _nextN = Math.Max(_nextN, n);
        long ord = fragment.Ord == 0 && !_options.Exact ? _nextFragment + 1 : fragment.Ord;
        _nextFragment = Math.Max(_nextFragment, ord);
        Exec("""
             INSERT INTO fragments (n, id, document, unit, ord, text, context, section, anchor, anchor_end, search_text)
             VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10)
             """,
            n, fragment.Id, _doc!.Id, fragment.Unit, ord, Nfc(fragment.Text), fragment.Context, Json(fragment.Section),
            fragment.Anchor.ToJson(), fragment.AnchorEnd?.ToJson(), fragment.SearchText);
    }

    /// <summary>Adds a figure.</summary>
    public void AddFigure(Figure figure)
    {
        ArgumentNullException.ThrowIfNull(figure);
        NeedDocument();
        Exec("INSERT INTO figures (id, document, unit, image, caption, description, anchor) VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6)",
            figure.Id, _doc!.Id, figure.Unit, figure.Image, figure.Caption, figure.Description, figure.Anchor.ToJson());
    }

    /// <summary>Declares a vector space.</summary>
    public void AddSpace(Space space)
    {
        ArgumentNullException.ThrowIfNull(space);
        if (VectorCodec.DTypeSize(space.DType) == 0)
        {
            throw new ArgumentException($"unknown dtype '{space.DType}'", nameof(space));
        }
        _spaces[space.Id] = space;
        object? modalities = space.RawModalities ?? space.Modalities.Cast<object?>().ToList();
        Exec("""
             INSERT INTO spaces (id, provider, model, version, dims, dtype, normalized, truncated_from, modalities, task_prefixes, created)
             VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10)
             """,
            space.Id, space.Provider, space.Model, space.Version, space.Dims, space.DType, space.Normalized ? 1L : 0L,
            space.TruncatedFrom, Json(modalities), Json(space.TaskPrefixes), space.Created);
    }

    /// <summary>Stores an already encoded vector (little-endian, dims × dtype size bytes).</summary>
    public void AddVectorRaw(string target, string id, string space, byte[] data)
    {
        ArgumentNullException.ThrowIfNull(data);
        NeedDocument();
        if (!_spaces.TryGetValue(space, out var sp))
        {
            throw new ArgumentException($"unknown space '{space}' (call AddSpace first)", nameof(space));
        }
        long expected = sp.Dims * VectorCodec.DTypeSize(sp.DType);
        if (data.Length != expected)
        {
            throw new ArgumentException($"vector {target}/{id} has {data.Length} bytes, space {space} needs {expected}", nameof(data));
        }
        _vectors++;
        Exec("INSERT INTO vectors (target, id, space, document, data) VALUES (@p0, @p1, @p2, @p3, @p4)", target, id, space, _doc!.Id, data);
    }

    /// <summary>Encodes a vector in the dtype of its space (rounding f16, quantizing i8; §9.2) and stores it.</summary>
    public void AddVector(string target, string id, string space, ReadOnlySpan<float> vector)
    {
        if (!_spaces.TryGetValue(space, out var sp))
        {
            throw new ArgumentException($"unknown space '{space}' (call AddSpace first)", nameof(space));
        }
        AddVectorRaw(target, id, space, VectorCodec.Quantize(vector, sp.DType));
    }

    /// <summary>Encodes a vector in the dtype of its space (§9.2) and stores it.</summary>
    public void AddVector(string target, string id, string space, ReadOnlySpan<double> vector)
    {
        if (!_spaces.TryGetValue(space, out var sp))
        {
            throw new ArgumentException($"unknown space '{space}' (call AddSpace first)", nameof(space));
        }
        AddVectorRaw(target, id, space, VectorCodec.Quantize(vector, sp.DType));
    }

    /// <summary>Stores a binary object; reference it as <c>blob:&lt;key&gt;</c>.</summary>
    public void AddBlob(string key, string mime, byte[] data)
    {
        ArgumentNullException.ThrowIfNull(data);
        Exec("INSERT INTO blobs (key, mime, sha256, data) VALUES (@p0, @p1, @p2, @p3)", key, mime, TextUtil.Hex(SHA256.HashData(data)), data);
    }

    /// <summary>Records a processing stage.</summary>
    public void AddProvenance(ProvenanceEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        NeedDocument();
        Exec("INSERT INTO provenance (document, stage, provider, model, detail, ms, at) VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6)",
            _doc!.Id, entry.Stage, entry.Provider, entry.Model, Json(entry.Detail), entry.Ms, entry.At);
    }

    /// <summary>Declares an extension (its <c>x_&lt;vendor&gt;_&lt;name&gt;</c> tables are created with <see cref="Execute"/>).</summary>
    public void AddExtension(string name, string version, bool required) =>
        Exec("INSERT INTO extensions (name, version, required) VALUES (@p0, @p1, @p2)", name, version, required ? 1L : 0L);

    /// <summary>Runs arbitrary SQL inside the writer transaction (extension tables). Parameters are <c>@p0</c>, <c>@p1</c>…</summary>
    public int Execute(string sql, params object?[] args) => Exec(sql, args);

    private string DefaultProfile()
    {
        var p = new List<string> { "core" };
        if (_vectors > 0)
        {
            p.Add("semantic");
        }
        if (_hasTime)
        {
            p.Add("media");
        }
        return string.Join(" ", p);
    }

    /// <summary>Finalizes the file: document, <c>spdf_meta</c>, FTS rebuild, <c>VACUUM</c>, atomic move into place.</summary>
    public void Commit()
    {
        if (_done || _con is null || _tx is null)
        {
            throw new InvalidOperationException("the writer is closed");
        }
        try
        {
            var d = _doc ?? throw new InvalidOperationException("no document");
            long unitCount = d.UnitCount == 0 && !_options.Exact ? _units : d.UnitCount;
            Exec("""
                 INSERT INTO documents (id, kind, metadata, source_sha256, source_ref, mime, bytes, unit_count, duration, created, updated, title, authors, year, language, rights)
                 VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13, @p14, @p15)
                 """,
                d.Id, d.Kind, Json(d.Metadata), _options.Exact ? d.SourceSha256 : d.SourceSha256.ToLowerInvariant(), d.SourceRef, d.Mime,
                d.Bytes, unitCount, d.Duration, d.Created, d.Updated, d.Title, d.Authors, d.Year, d.Language, Json(d.Rights));
            var meta = _options.Exact
                ? new Dictionary<string, string>(StringComparer.Ordinal)
                : new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["spdf_version"] = SpdfInfo.FormatVersion,
                    ["profile"] = DefaultProfile(),
                    ["created"] = d.Created!,
                    ["generator"] = _generator,
                    ["document_id"] = d.Id,
                };
            foreach (var (k, v) in _meta)
            {
                meta[k] = v;
            }
            foreach (var k in meta.Keys.Order(CodePointComparer.Instance))
            {
                Exec("INSERT INTO spdf_meta (key, value) VALUES (@p0, @p1)", k, meta[k]);
            }
            Exec("INSERT INTO fragments_fts(fragments_fts) VALUES ('rebuild')");
            if (_options.Trigram)
            {
                Exec("INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES ('rebuild')");
            }
            _tx.Commit();
            _tx.Dispose();
            _tx = null;
            SqliteUtil.Exec(_con, "INSERT INTO fragments_fts(fragments_fts) VALUES ('optimize')");
            SqliteUtil.Exec(_con, "VACUUM");
            _con.Dispose();
            _con = null;
            File.Move(_tmp, _path, overwrite: true);
            _done = true;
        }
        catch
        {
            Abort();
            throw;
        }
    }

    /// <summary>Finalizes the file on the thread pool (see <see cref="Commit"/>).</summary>
    public Task CommitAsync(CancellationToken cancellationToken = default) => Task.Run(Commit, cancellationToken);

    /// <summary>Discards the file being written.</summary>
    public void Abort()
    {
        _done = true;
        try
        {
            _tx?.Rollback();
        }
        catch (SqliteException)
        {
        }
        catch (InvalidOperationException)
        {
        }
        _tx?.Dispose();
        _tx = null;
        _con?.Dispose();
        _con = null;
        SpdfFile.TryDelete(_tmp);
    }

    /// <summary>Discards the file unless <see cref="Commit"/> succeeded.</summary>
    public void Dispose()
    {
        if (!_done || _con is not null)
        {
            Abort();
        }
    }
}
