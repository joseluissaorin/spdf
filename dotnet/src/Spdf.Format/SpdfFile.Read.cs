namespace Spdf;

public sealed partial class SpdfFile
{
    /// <summary>The <c>spdf_meta</c> pairs (legacy keys mapped to 5.0 names).</summary>
    public IReadOnlyDictionary<string, string> GetMeta() =>
        MetaValues().ToDictionary(kv => kv.Key, kv => AsText(kv.Value), StringComparer.Ordinal);

    /// <summary>The document (5.0 view; legacy metadata mapped to CSL-JSON).</summary>
    /// <exception cref="SpdfException">E013 if <c>documents</c> does not hold exactly one row.</exception>
    public Document GetDocument()
    {
        var d = DocumentRow();
        return new Document
        {
            Id = AsText(d["id"]),
            Kind = AsText(d["kind"]),
            Metadata = d["metadata"] as Dictionary<string, object?> ?? new Dictionary<string, object?>(StringComparer.Ordinal),
            SourceSha256 = AsText(d["source_sha256"]),
            SourceRef = d["source_ref"] as string,
            Mime = AsText(d["mime"]),
            Bytes = Anchor.AsInteger(d["bytes"]) ?? 0,
            UnitCount = Anchor.AsInteger(d["unit_count"]) ?? 0,
            Duration = d["duration"] is long or double ? SpdfJson.ToDouble(d["duration"]) : null,
            Created = d["created"] as string,
            Updated = d["updated"] as string,
            Title = d["title"] as string,
            Authors = d["authors"] as string,
            Year = Anchor.AsInteger(d["year"]),
            Language = d["language"] as string,
            Rights = d["rights"] as Dictionary<string, object?>,
        };
    }

    /// <summary>The CSL-JSON item of the document, with the <c>spdf</c> extension object.</summary>
    public Dictionary<string, object?> GetMetadata() =>
        DocumentRow()["metadata"] as Dictionary<string, object?> ?? new Dictionary<string, object?>(StringComparer.Ordinal);

    /// <summary>The citable units in reading order.</summary>
    public IReadOnlyList<Unit> GetUnits() => UnitRows().Cast<Dictionary<string, object?>>().Select(u => new Unit
    {
        Id = AsText(u["id"]),
        Ord = Anchor.AsInteger(u["ord"]) ?? 0,
        Anchor = Anchor.FromTree(u["anchor"]) ?? new Anchor(new Dictionary<string, object?>()),
        Text = u["text"] as string ?? "",
        Notes = Strings(u["notes"]),
        Header = u["header"] as string,
        Footer = u["footer"] as string,
        Image = u["image"] as string,
        Thumbnail = u["thumbnail"] as string,
        Reader = AsText(u["reader"]),
        Confidence = u["confidence"] is long or double ? SpdfJson.ToDouble(u["confidence"]) : null,
        Printed = u["printed"] as string,
        T0 = u["t0"] is long or double ? SpdfJson.ToDouble(u["t0"]) : null,
        T1 = u["t1"] is long or double ? SpdfJson.ToDouble(u["t1"]) : null,
        Words = u["words"],
    }).ToList();

    /// <summary>The table of contents.</summary>
    public IReadOnlyList<Section> GetSections() => RowsForDump("sections", "ORDER BY " + Col("sections", "id")).Select(s => new Section
    {
        Id = AsText(s["id"]),
        Parent = s["parent"] as string,
        Level = Anchor.AsInteger(s["level"]) ?? 0,
        Title = AsText(s["title"]),
        UnitFrom = AsText(s["unit_from"]),
        UnitTo = s["unit_to"] as string,
        Summary = s["summary"] as string,
    }).ToList();

    /// <summary>The fragments in <c>n</c> order.</summary>
    public IReadOnlyList<Fragment> GetFragments() => RowsForDump("fragments", "ORDER BY " + Col("fragments", "n")).Select(ToFragment).ToList();

    /// <summary>One fragment by id, or <c>null</c>.</summary>
    public Fragment? GetFragment(string id) =>
        RowsForDump("fragments", "WHERE " + Col("fragments", "id") + " = @p0", [id]).Select(ToFragment).FirstOrDefault();

    private static Fragment ToFragment(Dictionary<string, object?> f) => new()
    {
        N = Anchor.AsInteger(f["n"]) ?? 0,
        Id = AsText(f["id"]),
        Unit = AsText(f["unit"]),
        Ord = Anchor.AsInteger(f["ord"]) ?? 0,
        Text = AsText(f["text"]),
        Context = f["context"] as string ?? "",
        Section = Strings(f["section"]),
        Anchor = Anchor.FromTree(f["anchor"]) ?? new Anchor(new Dictionary<string, object?>()),
        AnchorEnd = Anchor.FromTree(f["anchor_end"]),
        SearchText = f["search_text"] as string,
    };

    /// <summary>The figures.</summary>
    public IReadOnlyList<Figure> GetFigures() => FigureRows().Select(g => new Figure
    {
        Id = AsText(g["id"]),
        Unit = AsText(g["unit"]),
        Image = AsText(g["image"]),
        Caption = g["caption"] as string,
        Description = g["description"] as string,
        Anchor = Anchor.FromTree(g["anchor"]) ?? new Anchor(new Dictionary<string, object?>()),
    }).ToList();

    /// <summary>The vector spaces.</summary>
    public IReadOnlyList<Space> GetSpaces() => SpaceRows().Select(s => new Space
    {
        Id = AsText(s["id"]),
        Provider = AsText(s["provider"]),
        Model = AsText(s["model"]),
        Version = s["version"] as string,
        Dims = Anchor.AsInteger(s["dims"]) ?? 0,
        DType = s["dtype"] as string is { Length: > 0 } dt ? dt : "f32",
        Normalized = Anchor.AsInteger(s["normalized"]) is not 0L,
        TruncatedFrom = Anchor.AsInteger(s["truncated_from"]),
        Modalities = Strings(s["modalities"]) ?? [],
        TaskPrefixes = s["task_prefixes"] as Dictionary<string, object?>,
        Created = s["created"] as string,
    }).ToList();

    /// <summary>The provenance entries, in dump order.</summary>
    public IReadOnlyList<ProvenanceEntry> GetProvenance() => ProvenanceRows().Select(p => new ProvenanceEntry
    {
        Stage = AsText(p["stage"]),
        Provider = p["provider"] as string,
        Model = p["model"] as string,
        Detail = p["detail"],
        Ms = Anchor.AsInteger(p["ms"]),
        At = AsText(p["at"]),
    }).ToList();

    /// <summary>The declared extensions (none for legacy files).</summary>
    public IReadOnlyList<Extension> GetExtensions() => IsLegacy || !HasTable("extensions")
        ? []
        : RowsForDump("extensions", "ORDER BY name")
            .Select(e => new Extension(AsText(e["name"]), AsText(e["version"]), Legacy.Truthy(e["required"])))
            .ToList();

    /// <summary>The keys of the stored blobs.</summary>
    public IReadOnlyList<string> GetBlobKeys() => QueryRows("blobs", ["key"], "ORDER BY " + Col("blobs", "key")).Select(r => AsText(r["key"])).ToList();

    /// <summary>A blob by key (the <c>blob:</c> prefix is optional), or <c>null</c>.</summary>
    public Blob? GetBlob(string key)
    {
        ArgumentNullException.ThrowIfNull(key);
        if (key.StartsWith("blob:", StringComparison.Ordinal))
        {
            key = key[5..];
        }
        var rows = QueryRows("blobs", ["mime", "data"], "WHERE " + Col("blobs", "key") + " = @p0", [key]);
        if (rows.Count == 0)
        {
            return null;
        }
        var data = rows[0]["data"] switch
        {
            byte[] b => b,
            string s => SpdfJson.Utf8.GetBytes(s),
            _ => [],
        };
        return new Blob(key, AsText(rows[0]["mime"]), data);
    }

    /// <summary>The anchor and end anchor of a fragment.</summary>
    /// <exception cref="KeyNotFoundException">No such fragment.</exception>
    public (Anchor Anchor, Anchor? AnchorEnd) GetFragmentAnchors(string id)
    {
        var f = GetFragment(id) ?? throw new KeyNotFoundException($"no fragment '{id}'");
        return (f.Anchor, f.AnchorEnd);
    }

    /// <summary>The canonical URI of an anchor of this file.</summary>
    public string AnchorUriOf(Anchor anchor, Anchor? end = null) => AnchorUri.Format(DocRef, anchor, end);

    /// <summary>Cites an anchor of this file (§18).</summary>
    public string Cite(Anchor anchor, Anchor? end = null, string locale = "es") => Citation.Cite(anchor, end, GetMetadata(), locale);

    /// <summary>Cites a fragment of this file by id (§18).</summary>
    public string CiteFragment(string fragmentId, string locale = "es")
    {
        var (a, end) = GetFragmentAnchors(fragmentId);
        return Cite(a, end, locale);
    }

    /// <summary>The document as a CSL-JSON array with one item (§19).</summary>
    public string ExportCslJson() => BibliographyExport.CslJson(GetMetadata());

    /// <summary>The document as a BibTeX entry (§19).</summary>
    public string ExportBibTeX() => BibliographyExport.BibTeX(GetMetadata());

    /// <summary>The document as a structured BibTeX entry: type, key and fields (§19, RFC 0002).</summary>
    public BibTexEntry ExportBibTeXEntry() => BibliographyExport.BibTeXEntry(GetMetadata());

    /// <summary>The BibTeX citation key of the document (§19, RFC 0002).</summary>
    public string CitationKey() => BibliographyExport.CitationKey(GetMetadata());

    private static List<string>? Strings(object? v) => v is List<object?> l ? l.Select(e => e as string ?? AsText(e)).ToList() : null;
}
