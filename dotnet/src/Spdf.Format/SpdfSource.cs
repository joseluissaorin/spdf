namespace Spdf;

/// <summary>
/// Sources (specification §21.3, <c>conformance/sources/</c>): a canonical dump plus vector
/// values (<c>vectors.&lt;space&gt;.items = [{target, id, values}]</c>) and blob bytes
/// (<c>blobs[].data_base64</c>). <see cref="Write(IDictionary{string, object?}, string)"/> rebuilds the
/// SPDF 5.0 file a source describes, value for value.
/// </summary>
public static class SpdfSource
{
    /// <summary>Reads a source JSON file.</summary>
    public static Dictionary<string, object?> Read(string path) => SpdfJson.ParseObject(File.ReadAllText(path, SpdfJson.Utf8));

    /// <summary>The expected dump of a source: without vector values and blob bytes.</summary>
    public static Dictionary<string, object?> Strip(IDictionary<string, object?> source)
    {
        var d = (Dictionary<string, object?>)SpdfJson.ToTree(source)!;
        if (d.GetValueOrDefault("vectors") is Dictionary<string, object?> vectors)
        {
            foreach (var v in vectors.Values)
            {
                (v as Dictionary<string, object?>)?.Remove("items");
            }
        }
        foreach (var b in Objects(d.GetValueOrDefault("blobs")))
        {
            b.Remove("data_base64");
        }
        return d;
    }

    /// <summary>Builds an SPDF 5.0 file at <paramref name="path"/> from a source (exact mode).</summary>
    public static void Write(IDictionary<string, object?> source, string path)
    {
        ArgumentNullException.ThrowIfNull(source);
        var s = (Dictionary<string, object?>)SpdfJson.ToTree(source)!;
        bool trigram = s.GetValueOrDefault("fts") is Dictionary<string, object?> fts && fts.GetValueOrDefault("trigram") is true;
        using var w = SpdfWriter.Create(path, new SpdfWriterOptions { Exact = true, Trigram = trigram });
        if (s.GetValueOrDefault("meta") is Dictionary<string, object?> meta)
        {
            foreach (var (k, v) in meta)
            {
                w.SetMeta(k, v as string ?? SpdfFile.AsText(v));
            }
        }
        var doc = s.GetValueOrDefault("document") as Dictionary<string, object?> ?? throw new ArgumentException("source without document", nameof(source));
        w.SetDocument(new Document
        {
            Id = Str(doc, "id"),
            Kind = Str(doc, "kind"),
            Metadata = doc.GetValueOrDefault("metadata") as Dictionary<string, object?> ?? new Dictionary<string, object?>(StringComparer.Ordinal),
            SourceSha256 = Str(doc, "source_sha256"),
            SourceRef = doc.GetValueOrDefault("source_ref") as string,
            Mime = Str(doc, "mime"),
            Bytes = Anchor.AsInteger(doc.GetValueOrDefault("bytes")) ?? 0,
            UnitCount = Anchor.AsInteger(doc.GetValueOrDefault("unit_count")) ?? 0,
            Duration = Num(doc, "duration"),
            Created = Str(doc, "created"),
            Updated = Str(doc, "updated"),
            Title = doc.GetValueOrDefault("title") as string,
            Authors = doc.GetValueOrDefault("authors") as string,
            Year = Anchor.AsInteger(doc.GetValueOrDefault("year")),
            Language = doc.GetValueOrDefault("language") as string,
            Rights = doc.GetValueOrDefault("rights") as Dictionary<string, object?>,
        });
        foreach (var u in Objects(s.GetValueOrDefault("units")))
        {
            w.AddUnit(new Unit
            {
                Id = Str(u, "id"),
                Ord = Anchor.AsInteger(u.GetValueOrDefault("ord")) ?? 0,
                Anchor = AnchorOf(u, "anchor") ?? throw new ArgumentException($"unit {Str(u, "id")} without anchor", nameof(source)),
                Text = Str(u, "text"),
                Notes = Strings(u.GetValueOrDefault("notes")),
                Header = u.GetValueOrDefault("header") as string,
                Footer = u.GetValueOrDefault("footer") as string,
                Image = u.GetValueOrDefault("image") as string,
                Thumbnail = u.GetValueOrDefault("thumbnail") as string,
                Reader = Str(u, "reader"),
                Confidence = Num(u, "confidence"),
                Printed = u.GetValueOrDefault("printed") as string,
                T0 = Num(u, "t0"),
                T1 = Num(u, "t1"),
                Words = u.GetValueOrDefault("words"),
            });
        }
        foreach (var x in Objects(s.GetValueOrDefault("sections")))
        {
            w.AddSection(new Section
            {
                Id = Str(x, "id"),
                Parent = x.GetValueOrDefault("parent") as string,
                Level = Anchor.AsInteger(x.GetValueOrDefault("level")) ?? 0,
                Title = Str(x, "title"),
                UnitFrom = Str(x, "unit_from"),
                UnitTo = x.GetValueOrDefault("unit_to") as string,
                Summary = x.GetValueOrDefault("summary") as string,
            });
        }
        foreach (var f in Objects(s.GetValueOrDefault("fragments")))
        {
            w.AddFragment(new Fragment
            {
                N = Anchor.AsInteger(f.GetValueOrDefault("n")) ?? 0,
                Id = Str(f, "id"),
                Unit = Str(f, "unit"),
                Ord = Anchor.AsInteger(f.GetValueOrDefault("ord")) ?? 0,
                Text = Str(f, "text"),
                Context = Str(f, "context"),
                Section = Strings(f.GetValueOrDefault("section")),
                Anchor = AnchorOf(f, "anchor") ?? throw new ArgumentException($"fragment {Str(f, "id")} without anchor", nameof(source)),
                AnchorEnd = AnchorOf(f, "anchor_end"),
                SearchText = f.GetValueOrDefault("search_text") as string,
            });
        }
        foreach (var g in Objects(s.GetValueOrDefault("figures")))
        {
            w.AddFigure(new Figure
            {
                Id = Str(g, "id"),
                Unit = Str(g, "unit"),
                Image = Str(g, "image"),
                Caption = g.GetValueOrDefault("caption") as string,
                Description = g.GetValueOrDefault("description") as string,
                Anchor = AnchorOf(g, "anchor") ?? throw new ArgumentException($"figure {Str(g, "id")} without anchor", nameof(source)),
            });
        }
        var dtypes = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var sp in Objects(s.GetValueOrDefault("spaces")))
        {
            var space = new Space
            {
                Id = Str(sp, "id"),
                Provider = Str(sp, "provider"),
                Model = Str(sp, "model"),
                Version = sp.GetValueOrDefault("version") as string,
                Dims = Anchor.AsInteger(sp.GetValueOrDefault("dims")) ?? 0,
                DType = sp.GetValueOrDefault("dtype") as string ?? "f32",
                Normalized = Anchor.AsInteger(sp.GetValueOrDefault("normalized")) is not 0L,
                TruncatedFrom = Anchor.AsInteger(sp.GetValueOrDefault("truncated_from")),
                TaskPrefixes = sp.GetValueOrDefault("task_prefixes") as Dictionary<string, object?>,
                Created = sp.GetValueOrDefault("created") as string,
                RawModalities = sp.GetValueOrDefault("modalities"),
            };
            dtypes[space.Id] = space.DType;
            w.AddSpace(space);
        }
        if (s.GetValueOrDefault("vectors") is Dictionary<string, object?> vectors)
        {
            foreach (var space in vectors.Keys.Order(CodePointComparer.Instance))
            {
                if (vectors[space] is not Dictionary<string, object?> v)
                {
                    continue;
                }
                foreach (var item in Objects(v.GetValueOrDefault("items")))
                {
                    var values = item.GetValueOrDefault("values") as List<object?> ?? [];
                    var data = VectorCodec.PackExact(values, dtypes.GetValueOrDefault(space, "f32"));
                    w.AddVectorRaw(Str(item, "target"), Str(item, "id"), space, data);
                }
            }
        }
        foreach (var b in Objects(s.GetValueOrDefault("blobs")))
        {
            w.AddBlob(Str(b, "key"), Str(b, "mime"), Convert.FromBase64String(Str(b, "data_base64")));
        }
        foreach (var p in Objects(s.GetValueOrDefault("provenance")))
        {
            w.AddProvenance(new ProvenanceEntry
            {
                Stage = Str(p, "stage"),
                Provider = p.GetValueOrDefault("provider") as string,
                Model = p.GetValueOrDefault("model") as string,
                Detail = p.GetValueOrDefault("detail"),
                Ms = Anchor.AsInteger(p.GetValueOrDefault("ms")),
                At = Str(p, "at"),
            });
        }
        foreach (var e in Objects(s.GetValueOrDefault("extensions")))
        {
            w.AddExtension(Str(e, "name"), Str(e, "version"), Legacy.Truthy(e.GetValueOrDefault("required")));
        }
        w.Commit();
    }

    /// <summary>Builds an SPDF 5.0 file from a source JSON file.</summary>
    public static void Write(string sourcePath, string path) => Write(Read(sourcePath), path);

    private static IEnumerable<Dictionary<string, object?>> Objects(object? v) =>
        v is List<object?> l ? l.OfType<Dictionary<string, object?>>() : [];

    private static string Str(Dictionary<string, object?> m, string k) => m.GetValueOrDefault(k) as string ?? "";

    private static double? Num(Dictionary<string, object?> m, string k) =>
        m.GetValueOrDefault(k) is long or double ? SpdfJson.ToDouble(m[k]) : null;

    private static Anchor? AnchorOf(Dictionary<string, object?> m, string k) => Anchor.FromTree(m.GetValueOrDefault(k));

    private static List<string>? Strings(object? v) => v is List<object?> l ? l.Select(e => e as string ?? "").ToList() : null;
}
