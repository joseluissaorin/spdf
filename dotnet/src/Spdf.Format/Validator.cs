using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

namespace Spdf;

/// <summary>A validation error or warning.</summary>
/// <param name="Code">Code (<c>E001</c>…<c>W110</c>).</param>
/// <param name="Message">Free text.</param>
/// <param name="Where">Location (a table, a key, a row), or an empty string.</param>
public sealed record ValidationIssue(string Code, string Message, string Where);

/// <summary>The result of <see cref="SpdfValidator.Validate(string, SpdfOpenOptions?)"/> (specification §22).</summary>
public sealed record ValidationResult
{
    /// <summary>True if and only if there are no errors.</summary>
    public bool Valid => Errors.Count == 0;

    /// <summary>SPDF version, or <c>null</c> when unknown.</summary>
    public string? Version { get; init; }

    /// <summary>Declared profiles.</summary>
    public IReadOnlyList<string> Profile { get; init; } = [];

    /// <summary>Errors, in the order of the procedure.</summary>
    public IReadOnlyList<ValidationIssue> Errors { get; init; } = [];

    /// <summary>Warnings.</summary>
    public IReadOnlyList<ValidationIssue> Warnings { get; init; } = [];

    /// <summary>Distinct error codes, sorted.</summary>
    public IReadOnlyList<string> ErrorCodes => Errors.Select(e => e.Code).Distinct().Order(StringComparer.Ordinal).ToList();

    /// <summary>Distinct warning codes, sorted.</summary>
    public IReadOnlyList<string> WarningCodes => Warnings.Select(e => e.Code).Distinct().Order(StringComparer.Ordinal).ToList();

    /// <summary>The result as a JSON value tree (the shape of §22.1).</summary>
    public Dictionary<string, object?> ToTree()
    {
        static List<object?> Issues(IEnumerable<ValidationIssue> l) => l.Select(e => (object?)new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["code"] = e.Code,
            ["message"] = e.Message,
            ["where"] = e.Where,
        }).ToList();
        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["valid"] = Valid,
            ["version"] = Version,
            ["profile"] = Profile.Cast<object?>().ToList(),
            ["errors"] = Issues(Errors),
            ["warnings"] = Issues(Warnings),
        };
    }
}

/// <summary>Validates SPDF files (specification §22), in the order of the procedure.</summary>
public static class SpdfValidator
{
    private static readonly string[] LegacyRequiredTables = ["spdf", "documentos", "unidades", "fragmentos", "fragmentos_fts"];

    private static readonly byte[] SignPrefix = "spdf-content-sha256:"u8.ToArray();

    /// <summary>Validates a file and reports every problem found.</summary>
    public static ValidationResult Validate(string path, SpdfOpenOptions? options = null)
    {
        var v = new Run();
        SpdfFile f;
        try
        {
            f = SpdfFile.OpenLenient(path, options ?? new SpdfOpenOptions());
        }
        catch (SpdfException e)
        {
            v.Error(e.Code, e.Detail, e.Where);
            return v.Result(null);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or SqliteException)
        {
            v.Error("E001", e.Message, path);
            return v.Result(null);
        }
        using (f)
        {
            try
            {
                v.Check(f);
            }
            catch (SqliteException e)
            {
                v.Error("E001", e.Message, path);
            }
            return v.Result(f.Version);
        }
    }

    /// <summary>Validates a file asynchronously (the work runs on the thread pool).</summary>
    public static Task<ValidationResult> ValidateAsync(string path, SpdfOpenOptions? options = null, CancellationToken cancellationToken = default) =>
        Task.Run(() => Validate(path, options), cancellationToken);

    private sealed class Run
    {
        private readonly List<ValidationIssue> _errors = [];
        private readonly List<ValidationIssue> _warnings = [];
        private List<string> _profile = [];

        // In a file of a newer minor version, unknown anchor types and dtypes may be defined
        // by that minor: they are warnings, not errors (§22.1 step 4, §23).
        private bool _newerMinor;

        public void Error(string code, string message, string where = "")
        {
            var issue = new ValidationIssue(code, message, where);
            if (_newerMinor && code is "E041" or "E032")
            {
                _warnings.Add(issue);
            }
            else
            {
                _errors.Add(issue);
            }
        }

        public void Warn(string code, string message, string where = "") => _warnings.Add(new ValidationIssue(code, message, where));

        public ValidationResult Result(string? version) => new()
        {
            Version = version,
            Profile = _profile,
            Errors = _errors,
            Warnings = _warnings,
        };

        public void Check(SpdfFile f)
        {
            var con = f.Connection;
            if (f.IsLegacy)
            {
                Warn("W110", $"legacy SPDF {f.Version} file");
                foreach (var t in LegacyRequiredTables)
                {
                    if (!f.Tables.Contains(t))
                    {
                        Error("E010", $"missing legacy table {t}", t);
                    }
                }
                foreach (var p in f.SchemaObjectProblems())
                {
                    Error(p.Code, p.Detail, p.Where);
                }
                return;
            }
            if (f.IsGzipped)
            {
                Warn("E003", "SPDF 5.x files should not be gzip-wrapped");
            }
            if (f.Version != "5.0")
            {
                Warn("W105", $"newer minor version {f.Version}", "user_version");
                _newerMinor = true;
            }
            foreach (var p in f.SchemaObjectProblems())
            {
                Error(p.Code, p.Detail, p.Where);
            }

            // Required tables and columns.
            var present = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            foreach (var t in SpdfSchema.RequiredTables)
            {
                if (!f.Tables.Contains(t))
                {
                    Error("E010", $"missing table {t}", t);
                    continue;
                }
                var have = new HashSet<string>(StringComparer.Ordinal);
                foreach (var r in SqliteUtil.Rows(con, "SELECT name FROM pragma_table_info(@p0)", [t]))
                {
                    if (r[0] is string c)
                    {
                        have.Add(c);
                    }
                }
                present[t] = have;
                foreach (var c in SpdfSchema.Columns[t])
                {
                    if (!have.Contains(c))
                    {
                        Error("E011", $"missing column {t}.{c}", $"{t}.{c}");
                    }
                }
            }
            bool Ok(string t, params string[] cols) => present.TryGetValue(t, out var have) && cols.All(have.Contains);

            // spdf_meta.
            var meta = new Dictionary<string, object?>(StringComparer.Ordinal);
            if (Ok("spdf_meta", "key", "value"))
            {
                foreach (var r in SqliteUtil.Rows(con, "SELECT key, value FROM spdf_meta"))
                {
                    meta[SpdfFile.AsText(r[0])] = r[1];
                }
                foreach (var k in SpdfSchema.RequiredMetaKeys)
                {
                    if (!meta.ContainsKey(k))
                    {
                        Error("E012", $"missing spdf_meta key {k}", k);
                    }
                }
                string profile = meta.GetValueOrDefault("profile") as string ?? "";
                _profile = profile.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).ToList();
            }

            // documents.
            List<object?[]>? docs = null;
            if (Ok("documents", "id", "metadata"))
            {
                docs = Ok("documents", "rights", "unit_count")
                    ? SqliteUtil.Rows(con, "SELECT id, metadata, rights, unit_count FROM documents")
                    : SqliteUtil.Rows(con, "SELECT id, metadata, NULL, NULL FROM documents");
                if (docs.Count != 1)
                {
                    Error("E013", $"documents has {docs.Count} rows", "documents");
                }
                foreach (var d in docs)
                {
                    string id = SpdfFile.AsText(d[0]);
                    if (d[1] is string md && SpdfJson.TryParse(md, out var m))
                    {
                        if (m is not Dictionary<string, object?> item || item.GetValueOrDefault("type") is not string || item.GetValueOrDefault("title") is not string)
                        {
                            Error("E051", "metadata needs a string type and title", id);
                        }
                    }
                    else
                    {
                        Error("E050", "metadata is not valid JSON", id);
                    }
                    if (d[2] is not null && !(d[2] is string rights && SpdfJson.TryParse(rights, out _)))
                    {
                        Error("E050", "rights is not valid JSON", id);
                    }
                }
            }

            // extensions.
            if (Ok("extensions", "name", "required"))
            {
                foreach (var r in SqliteUtil.Rows(con, "SELECT name, required FROM extensions ORDER BY name"))
                {
                    string name = SpdfFile.AsText(r[0]);
                    if (Legacy.Truthy(r[1]) && !SpdfInfo.KnownExtensions.Contains(name))
                    {
                        Error("E060", $"unknown required extension {name}", name);
                    }
                }
            }

            // units, fragments, figures.
            var texts = new Dictionary<string, string?>(StringComparer.Ordinal);
            if (Ok("units", "id", "ord", "anchor", "text"))
            {
                var rows = SqliteUtil.Rows(con, "SELECT id, ord, anchor, text FROM units ORDER BY ord, id");
                for (int i = 0; i < rows.Count; i++)
                {
                    if (rows[i][1] is not (long or double) || SpdfJson.ToDouble(rows[i][1]) != i + 1)
                    {
                        Error("E090", "units.ord is not 1..N", "units");
                        break;
                    }
                }
                if (docs is { Count: 1 } && docs[0][3] is { } unitCount)
                {
                    bool same = unitCount is long or double && SpdfJson.ToDouble(unitCount) == rows.Count;
                    if (!same)
                    {
                        Warn("W102", $"unit_count {SpdfJson.Compact(unitCount)} but {rows.Count} units", "documents.unit_count");
                    }
                }
                foreach (var r in rows)
                {
                    string uid = SpdfFile.AsText(r[0]);
                    string? text = r[3] as string;
                    texts[uid] = text;
                    CheckAnchor(r[2], text, "units/" + uid);
                }
            }
            if (Ok("fragments", "id", "unit", "anchor"))
            {
                string end = present["fragments"].Contains("anchor_end") ? "anchor_end" : "NULL";
                foreach (var r in SqliteUtil.Rows(con, $"SELECT id, unit, anchor, {end} FROM fragments ORDER BY n"))
                {
                    string fid = SpdfFile.AsText(r[0]);
                    CheckAnchor(r[2], texts.GetValueOrDefault(SpdfFile.AsText(r[1])), "fragments/" + fid);
                    if (r[3] is not null)
                    {
                        CheckAnchor(r[3], null, $"fragments/{fid}/anchor_end");
                    }
                }
            }
            if (Ok("figures", "id", "unit", "anchor"))
            {
                foreach (var r in SqliteUtil.Rows(con, "SELECT id, unit, anchor FROM figures ORDER BY id"))
                {
                    CheckAnchor(r[2], texts.GetValueOrDefault(SpdfFile.AsText(r[1])), "figures/" + SpdfFile.AsText(r[0]));
                }
            }

            // spaces and vectors.
            var spaces = new Dictionary<string, (object? Dims, string? DType)>(StringComparer.Ordinal);
            if (Ok("spaces", "id", "dims", "dtype"))
            {
                foreach (var r in SqliteUtil.Rows(con, "SELECT id, dims, dtype FROM spaces ORDER BY id"))
                {
                    string sid = SpdfFile.AsText(r[0]);
                    spaces[sid] = (r[1], r[2] as string);
                    if (VectorCodec.DTypeSize(r[2] as string) == 0)
                    {
                        Error("E032", $"unknown dtype {SpdfJson.Compact(r[2])}", sid);
                    }
                }
            }
            long vectorCount = 0;
            if (Ok("vectors", "target", "id", "space", "data"))
            {
                foreach (var r in SqliteUtil.Rows(con, "SELECT target, id, space, typeof(data), length(data) FROM vectors ORDER BY space, target, id"))
                {
                    vectorCount++;
                    string space = SpdfFile.AsText(r[2]);
                    string where = $"vectors/{space}/{SpdfFile.AsText(r[0])}/{SpdfFile.AsText(r[1])}";
                    if (!spaces.TryGetValue(space, out var sp))
                    {
                        Error("E031", $"unknown space {space}", where);
                        continue;
                    }
                    int size = VectorCodec.DTypeSize(sp.DType);
                    if (size == 0)
                    {
                        continue;
                    }
                    long length = r[4] as long? ?? -1;
                    bool ok = r[3] as string == "blob" && sp.Dims is long dims && length == dims * size;
                    if (!ok)
                    {
                        Error("E030", $"vector length {length} != {SpdfJson.Compact(sp.Dims)} x {size}", where);
                    }
                }
            }

            // FTS integrity on a private in-memory copy.
            if (f.Tables.Contains("fragments_fts"))
            {
                try
                {
                    using var mem = SqliteUtil.OpenMemory();
                    con.BackupDatabase(mem);
                    SqliteUtil.Exec(mem, "INSERT INTO fragments_fts(fragments_fts, rank) VALUES ('integrity-check', 1)");
                    if (f.Tables.Contains("fragments_fts_trigram"))
                    {
                        SqliteUtil.Exec(mem, "INSERT INTO fragments_fts_trigram(fragments_fts_trigram, rank) VALUES ('integrity-check', 1)");
                    }
                }
                catch (SqliteException e)
                {
                    Error("E070", "FTS index out of sync: " + e.Message, "fragments_fts");
                }
            }

            // blobs.
            if (Ok("blobs", "key", "sha256", "data"))
            {
                using var cmd = SqliteUtil.Command(con, "SELECT key, sha256, data FROM blobs ORDER BY key");
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var data = SqliteUtil.Normalize(reader.GetValue(2)) switch
                    {
                        byte[] b => b,
                        string s => SpdfJson.Utf8.GetBytes(s),
                        _ => [],
                    };
                    if (TextUtil.Hex(SHA256.HashData(data)) != SqliteUtil.Normalize(reader.GetValue(1)) as string)
                    {
                        Error("E080", "blob sha256 mismatch", SpdfFile.AsText(SqliteUtil.Normalize(reader.GetValue(0))));
                    }
                }
            }

            // Integrity (§13).
            if (meta.TryGetValue("content_sha256", out var expected) && _errors.Count == 0)
            {
                string actual;
                try
                {
                    actual = f.ContentSha256();
                }
                catch (Exception e) when (e is SpdfException or SqliteException or FormatException)
                {
                    actual = "unavailable (" + e.Message + ")";
                }
                if (actual != expected as string)
                {
                    Error("E081", "content_sha256 does not match the canonical dump", "spdf_meta.content_sha256");
                }
                else if (meta.TryGetValue("signature", out var signature))
                {
                    if (!VerifySignature(actual, signature as string, meta.GetValueOrDefault("signer") as string))
                    {
                        Error("E082", "signature does not verify", "spdf_meta.signature");
                    }
                }
            }

            // Profile warnings.
            if (_profile.Contains("semantic") && vectorCount == 0)
            {
                Warn("W100", "profile semantic without vectors");
            }
            if (_profile.Contains("media") && Ok("units", "anchor"))
            {
                bool hasTime = SqliteUtil.Rows(con, "SELECT anchor FROM units")
                    .Any(r => r[0] is string a && SpdfJson.TryParse(a, out var g) && g is Dictionary<string, object?> m && m.GetValueOrDefault("type") as string == "time");
                if (!hasTime)
                {
                    Warn("W101", "profile media without time anchors");
                }
            }
        }

        private void CheckAnchor(object? raw, string? unitText, string where)
        {
            if (raw is not string s || !SpdfJson.TryParse(s, out var g))
            {
                Error("E040", "anchor is not valid JSON", where);
                return;
            }
            if (Anchor.Check(g, unitText) is { } problem)
            {
                Error(problem.Code, problem.Message, where);
            }
        }
    }

    /// <summary>
    /// Verifies the signature of §13: Ed25519 over <c>spdf-content-sha256:</c> + the hex hash;
    /// <paramref name="signature"/> is standard base64 with padding, <paramref name="signer"/> is
    /// <c>ed25519:</c> + base64 of the public key.
    /// </summary>
    public static bool VerifySignature(string contentSha256, string? signature, string? signer)
    {
        if (signature is null || signer is null || !signer.StartsWith("ed25519:", StringComparison.Ordinal))
        {
            return false;
        }
        var pub = StrictBase64(signer[8..]);
        var sig = StrictBase64(signature);
        if (pub is null || sig is null)
        {
            return false;
        }
        byte[] message = [.. SignPrefix, .. System.Text.Encoding.ASCII.GetBytes(contentSha256.ToLowerInvariant())];
        return Ed25519.Verify(pub, message, sig);
    }

    /// <summary>
    /// Signs a content hash as §13 specifies: Ed25519 over the ASCII bytes
    /// <c>spdf-content-sha256:</c> + the lowercase hex hash. Returns the values of
    /// <c>spdf_meta.signer</c> (<c>ed25519:</c> + base64 of the public key) and
    /// <c>spdf_meta.signature</c> (base64 with padding). Not constant-time: see <see cref="Ed25519"/>.
    /// </summary>
    public static (string Signer, string Signature) SignContentHash(string contentSha256, byte[] secretKey)
    {
        ArgumentNullException.ThrowIfNull(contentSha256);
        ArgumentNullException.ThrowIfNull(secretKey);
        byte[] message = [.. SignPrefix, .. System.Text.Encoding.ASCII.GetBytes(contentSha256.ToLowerInvariant())];
        return ("ed25519:" + Convert.ToBase64String(Ed25519.PublicKey(secretKey)), Convert.ToBase64String(Ed25519.Sign(secretKey, message)));
    }

    private static byte[]? StrictBase64(string s)
    {
        if (s.Length % 4 != 0 || s.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '+' or '/' or '=')))
        {
            return null;
        }
        try
        {
            return Convert.FromBase64String(s);
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
