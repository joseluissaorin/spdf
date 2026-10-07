using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Spdf;

public sealed partial class SpdfFile
{
    private static readonly string[] IntegrityKeys = ["content_sha256", "signature", "signer"];

    [GeneratedRegex("tokenize\\s*=\\s*'([^']*)'", RegexOptions.CultureInvariant)]
    private static partial Regex TokenizeRe();

    /// <summary>
    /// The canonical dump (specification §12) as a JSON value tree. Serialize it with
    /// <see cref="SpdfJson.Canonical(object?)"/>, or use <see cref="DumpJson"/>.
    /// </summary>
    /// <exception cref="SpdfException">E013 if <c>documents</c> does not hold exactly one row.</exception>
    public Dictionary<string, object?> Dump()
    {
        var meta = MetaValues();
        object? version;
        if (IsLegacy)
        {
            version = Legacy.Truthy(meta.GetValueOrDefault("spdf_version")) ? meta["spdf_version"] : Version;
        }
        else
        {
            version = meta.GetValueOrDefault("spdf_version");
        }
        var dump = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["spdf_version"] = version,
            ["meta"] = meta,
            ["fts"] = FtsInfo(),
            ["document"] = DocumentRow(),
            ["units"] = UnitRows(),
            ["sections"] = Objects(RowsForDump("sections", "ORDER BY " + Col("sections", "id"))),
            ["fragments"] = Objects(RowsForDump("fragments", "ORDER BY " + Col("fragments", "n"))),
            ["figures"] = Objects(FigureRows()),
            ["spaces"] = Objects(SpaceRows()),
            ["vectors"] = VectorDigests(),
            ["blobs"] = BlobDigests(),
            ["provenance"] = Objects(ProvenanceRows()),
            ["extensions"] = IsLegacy || !HasTable("extensions")
                ? new List<object?>()
                : Objects(RowsForDump("extensions", "ORDER BY name")),
        };
        if (IsLegacy)
        {
            dump["legacy"] = true;
        }
        return dump;
    }

    /// <summary>The canonical dump serialized with RFC 8785 (JCS).</summary>
    public string DumpJson() => SpdfJson.Canonical(Dump());

    /// <summary>
    /// The integrity hash of §13: lowercase hex SHA-256 of the JCS dump without
    /// <c>meta.content_sha256</c>, <c>meta.signature</c> and <c>meta.signer</c>.
    /// </summary>
    public string ContentSha256() => ContentSha256Of(Dump());

    /// <summary>The integrity hash of a dump (see <see cref="ContentSha256()"/>).</summary>
    public static string ContentSha256Of(IDictionary<string, object?> dump)
    {
        var copy = (Dictionary<string, object?>)SpdfJson.ToTree(dump)!;
        if (copy.GetValueOrDefault("meta") is Dictionary<string, object?> meta)
        {
            foreach (var k in IntegrityKeys)
            {
                meta.Remove(k);
            }
        }
        return TextUtil.Hex(SHA256.HashData(SpdfJson.CanonicalUtf8(copy)));
    }

    private static List<object?> Objects(List<Dictionary<string, object?>> rows) => rows.Cast<object?>().ToList();

    /// <summary><c>spdf_meta</c> as stored (legacy keys mapped), values untouched.</summary>
    internal Dictionary<string, object?> MetaValues()
    {
        var meta = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var r in QueryRows("spdf_meta", ["key", "value"], "ORDER BY " + Col("spdf_meta", "key")))
        {
            string key = r["key"] switch
            {
                string s => s,
                null => "",
                var o => Convert.ToString(o, System.Globalization.CultureInfo.InvariantCulture) ?? "",
            };
            if (IsLegacy && Legacy.MetaKeys.TryGetValue(key, out var mapped))
            {
                key = mapped;
            }
            meta[key] = r["value"] is byte[] b ? SpdfJson.Utf8.GetString(b) : r["value"];
        }
        return meta;
    }

    /// <summary>Reads a table, parses its JSON columns and maps legacy anchors.</summary>
    internal List<Dictionary<string, object?>> RowsForDump(string t5, string tail = "", IReadOnlyList<object?>? args = null)
    {
        var cols = SpdfSchema.Columns[t5];
        var rows = QueryRows(t5, cols, tail, args);
        SpdfSchema.JsonColumns.TryGetValue(t5, out var jsonCols);
        var out_ = new List<Dictionary<string, object?>>(rows.Count);
        foreach (var r in rows)
        {
            var o = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var c in cols)
            {
                if (c == "document")
                {
                    continue;
                }
                object? v = r[c];
                if (jsonCols is not null && jsonCols.Contains(c))
                {
                    v = ParseJsonColumn(v);
                    if (IsLegacy && c is "anchor" or "anchor_end")
                    {
                        v = Legacy.MapAnchor(v);
                    }
                }
                if (v is byte[] b && !(t5 is "vectors" or "blobs"))
                {
                    v = SpdfJson.Utf8.GetString(b);
                }
                o[c] = v;
            }
            out_.Add(o);
        }
        return out_;
    }

    internal static object? ParseJsonColumn(object? v)
    {
        string? s = v switch
        {
            string str => str,
            byte[] b => SpdfJson.Utf8.GetString(b),
            _ => null,
        };
        if (s is null)
        {
            return v;
        }
        return SpdfJson.TryParse(s, out var g) ? g : s;
    }

    /// <summary>The document row (5.0 view); E013 unless there is exactly one.</summary>
    internal Dictionary<string, object?> DocumentRow()
    {
        var rows = RowsForDump("documents", "ORDER BY " + Col("documents", "id"));
        if (rows.Count != 1)
        {
            throw new SpdfException("E013", $"documents must hold exactly one row (it has {rows.Count})", "documents");
        }
        var doc = rows[0];
        if (IsLegacy)
        {
            string legacyKind = doc["kind"] as string ?? "";
            if (Legacy.Kinds.TryGetValue(legacyKind, out var kind))
            {
                doc["kind"] = kind;
            }
            doc["metadata"] = Legacy.MapMetadata(doc["metadata"], legacyKind);
            doc["source_ref"] = Legacy.MapReference(doc["source_ref"], LegacyBlobKeys(), keepEmpty: false);
            doc["rights"] = null;
        }
        return doc;
    }

    internal List<object?> UnitRows()
    {
        var units = RowsForDump("units", "ORDER BY " + Col("units", "ord") + ", " + Col("units", "id"));
        if (IsLegacy)
        {
            var keys = LegacyBlobKeys();
            for (int i = 0; i < units.Count; i++)
            {
                units[i]["ord"] = (long)(i + 1);
                units[i]["image"] = Legacy.MapReference(units[i]["image"], keys, keepEmpty: false);
                units[i]["thumbnail"] = Legacy.MapReference(units[i]["thumbnail"], keys, keepEmpty: false);
            }
        }
        return Objects(units);
    }

    internal List<Dictionary<string, object?>> FigureRows()
    {
        var figures = RowsForDump("figures", "ORDER BY " + Col("figures", "id"));
        if (IsLegacy)
        {
            var keys = LegacyBlobKeys();
            foreach (var g in figures)
            {
                g["image"] = Legacy.MapReference(g["image"], keys, keepEmpty: true);
            }
        }
        return figures;
    }

    internal List<Dictionary<string, object?>> SpaceRows()
    {
        var spaces = RowsForDump("spaces", "ORDER BY " + Col("spaces", "id"));
        if (IsLegacy)
        {
            foreach (var s in spaces)
            {
                if (s["modalities"] is List<object?> l)
                {
                    for (int i = 0; i < l.Count; i++)
                    {
                        if (l[i] is string m && Legacy.Modalities.TryGetValue(m, out var mapped))
                        {
                            l[i] = mapped;
                        }
                    }
                }
            }
        }
        return spaces;
    }

    internal List<Dictionary<string, object?>> ProvenanceRows()
    {
        var rows = RowsForDump("provenance");
        return SortProvenance(rows);
    }

    /// <summary>Orders provenance entries by the UTF-8 bytes of their JCS serialization (§12).</summary>
    internal static List<Dictionary<string, object?>> SortProvenance(List<Dictionary<string, object?>> rows) =>
        rows.Select(r => (Key: SpdfJson.CanonicalUtf8(r), Row: r))
            .OrderBy(x => x.Key, Comparer<byte[]>.Create(TextUtil.CompareBytes))
            .Select(x => x.Row)
            .ToList();

    /// <summary>Per space: count and SHA-256 of the data blobs concatenated in (target, id) order.</summary>
    internal Dictionary<string, object?> VectorDigests()
    {
        var out_ = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (!HasTable("vectors"))
        {
            return out_;
        }
        if (!IsLegacy)
        {
            // Stream in SQL order (BINARY = code point order) and hash incrementally.
            using var cmd = SqliteUtil.Command(Connection, "SELECT space, data FROM vectors ORDER BY space, target, id");
            using var reader = cmd.ExecuteReader();
            string? current = null;
            long count = 0;
            IncrementalHash? hash = null;
            void Flush()
            {
                if (current is not null && hash is not null)
                {
                    out_[current] = new Dictionary<string, object?>(StringComparer.Ordinal)
                    {
                        ["count"] = count,
                        ["sha256"] = TextUtil.Hex(hash.GetHashAndReset()),
                    };
                    hash.Dispose();
                }
            }
            while (reader.Read())
            {
                string space = AsText(SqliteUtil.Normalize(reader.GetValue(0)));
                if (current is null || !string.Equals(space, current, StringComparison.Ordinal))
                {
                    Flush();
                    current = space;
                    count = 0;
                    hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                }
                count++;
                byte[] data = SqliteUtil.Normalize(reader.GetValue(1)) switch
                {
                    byte[] b => b,
                    string s => SpdfJson.Utf8.GetBytes(s),
                    null => [],
                    var o => SpdfJson.Utf8.GetBytes(SpdfJson.Compact(o)),
                };
                hash!.AppendData(data);
            }
            Flush();
            return out_;
        }
        var rows = QueryRows("vectors", ["target", "id", "space", "data"]);
        var groups = new SortedDictionary<string, List<(string Target, string Id, byte[] Data)>>(CodePointComparer.Instance);
        foreach (var r in rows)
        {
            string target = AsText(r["target"]);
            if (IsLegacy && Legacy.Targets.TryGetValue(target, out var mapped))
            {
                target = mapped;
            }
            string space = AsText(r["space"]);
            byte[] data = r["data"] switch
            {
                byte[] b => b,
                string s => SpdfJson.Utf8.GetBytes(s),
                null => [],
                var o => SpdfJson.Utf8.GetBytes(SpdfJson.Compact(o)),
            };
            if (!groups.TryGetValue(space, out var list))
            {
                groups[space] = list = [];
            }
            list.Add((target, AsText(r["id"]), data));
        }
        foreach (var (space, list) in groups)
        {
            list.Sort((a, b) =>
            {
                int c = TextUtil.CompareCodePoints(a.Target, b.Target);
                return c != 0 ? c : TextUtil.CompareCodePoints(a.Id, b.Id);
            });
            using var h = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            foreach (var item in list)
            {
                h.AppendData(item.Data);
            }
            out_[space] = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["count"] = (long)list.Count,
                ["sha256"] = TextUtil.Hex(h.GetHashAndReset()),
            };
        }
        return out_;
    }

    private List<object?> BlobDigests()
    {
        var out_ = new List<object?>();
        if (!HasTable("blobs"))
        {
            return out_;
        }
        string sql = "SELECT " + SelectList("blobs", ["key", "mime", "data"]) + " FROM " + SqliteUtil.QuoteIdent(Table("blobs")) +
                     " ORDER BY " + Col("blobs", "key");
        using var cmd = SqliteUtil.Command(Connection, sql);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            byte[] data = SqliteUtil.Normalize(reader.GetValue(2)) switch
            {
                byte[] b => b,
                string s => SpdfJson.Utf8.GetBytes(s),
                _ => [],
            };
            out_.Add(new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["key"] = SqliteUtil.Normalize(reader.GetValue(0)),
                ["mime"] = SqliteUtil.Normalize(reader.GetValue(1)),
                ["bytes"] = (long)data.Length,
                ["sha256"] = TextUtil.Hex(SHA256.HashData(data)),
            });
        }
        return out_;
    }

    /// <summary>Tokenizer of the lexical index and whether the optional trigram index exists.</summary>
    internal Dictionary<string, object?> FtsInfo()
    {
        object? tokenizer = null;
        var sql = SqliteUtil.Scalar(Connection, "SELECT sql FROM sqlite_master WHERE name = @p0", [Table("fragments_fts")]) as string;
        if (!string.IsNullOrEmpty(sql))
        {
            var m = TokenizeRe().Match(sql);
            tokenizer = m.Success ? m.Groups[1].Value : "unicode61";
        }
        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["tokenizer"] = tokenizer,
            ["trigram"] = !IsLegacy && _tables.Contains("fragments_fts_trigram"),
        };
    }

    internal static string AsText(object? v) => v switch
    {
        string s => s,
        null => "",
        byte[] b => SpdfJson.Utf8.GetString(b),
        long l => l.ToString(System.Globalization.CultureInfo.InvariantCulture),
        double d => d.ToString("R", System.Globalization.CultureInfo.InvariantCulture),
        _ => v.ToString() ?? "",
    };
}
