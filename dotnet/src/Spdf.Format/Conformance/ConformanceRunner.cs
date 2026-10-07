using System.Globalization;

namespace Spdf.Conformance;

/// <summary>A failed or skipped case.</summary>
/// <param name="Id">Case id.</param>
/// <param name="Reason">Why.</param>
public sealed record CaseOutcome(string Id, string Reason);

/// <summary>The runner report of the conformance protocol: <c>{"impl","version","passed","failed","skipped"}</c>.</summary>
public sealed record ConformanceReport
{
    /// <summary>Implementation name.</summary>
    public string Impl { get; init; } = SpdfInfo.ImplName;

    /// <summary>Implementation version.</summary>
    public string Version { get; init; } = SpdfInfo.Version;

    /// <summary>Ids of the passed cases.</summary>
    public List<string> Passed { get; init; } = [];

    /// <summary>Failed cases with the reason.</summary>
    public List<CaseOutcome> Failed { get; init; } = [];

    /// <summary>Skipped cases (none: this implementation claims every kind).</summary>
    public List<CaseOutcome> Skipped { get; init; } = [];

    /// <summary>The report as a JSON value tree.</summary>
    public Dictionary<string, object?> ToTree()
    {
        static List<object?> Outcomes(IEnumerable<CaseOutcome> l) => l.Select(o => (object?)new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["id"] = o.Id,
            ["reason"] = o.Reason,
        }).ToList();
        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["impl"] = Impl,
            ["version"] = Version,
            ["passed"] = Passed.Cast<object?>().ToList(),
            ["failed"] = Outcomes(Failed),
            ["skipped"] = Outcomes(Skipped),
        };
    }

    /// <summary>The report as one line of JSON (keys sorted).</summary>
    public string ToJson() => SpdfJson.Compact(ToTree());
}

/// <summary>Runs the SPDF conformance suite (<c>conformance/</c> in the repository).</summary>
public static class ConformanceRunner
{
    private const double Tolerance = 1e-6;

    /// <summary>Runs every case in <c>&lt;dir&gt;/cases</c>, discovered by listing the folder.</summary>
    /// <exception cref="DirectoryNotFoundException">No cases folder.</exception>
    public static ConformanceReport Run(string dir)
    {
        string casesDir = Path.Combine(dir, "cases");
        var files = Directory.GetFiles(casesDir, "*.json").Order(StringComparer.Ordinal).ToList();
        if (files.Count == 0)
        {
            throw new DirectoryNotFoundException("no cases in " + casesDir);
        }
        var report = new ConformanceReport();
        foreach (var file in files)
        {
            string id = Path.GetFileNameWithoutExtension(file);
            string? reason;
            try
            {
                var c = SpdfJson.ParseObject(File.ReadAllText(file, SpdfJson.Utf8));
                if (c.GetValueOrDefault("id") is string cid)
                {
                    id = cid;
                }
                reason = RunCase(dir, c.GetValueOrDefault("kind") as string ?? "",
                    c.GetValueOrDefault("input") as Dictionary<string, object?> ?? [],
                    c.GetValueOrDefault("expect") as Dictionary<string, object?> ?? []);
            }
            catch (Exception e)
            {
                reason = "exception: " + e.GetType().Name + ": " + e.Message;
            }
            if (reason is null)
            {
                report.Passed.Add(id);
            }
            else
            {
                report.Failed.Add(new CaseOutcome(id, reason));
            }
        }
        return report;
    }

    private static string Str(Dictionary<string, object?> m, string k) => m.GetValueOrDefault(k) as string ?? "";

    private static string In(string dir, string rel) => Path.Combine(dir, rel.Replace('/', Path.DirectorySeparatorChar));

    private static object? ReadJson(string path) => SpdfJson.Parse(File.ReadAllText(path, SpdfJson.Utf8));

    private static List<double> Doubles(object? v) => v is List<object?> l ? l.Select(SpdfJson.ToDouble).ToList() : [];

    /// <summary>Runs one case; returns <c>null</c> when it passes, else the reason.</summary>
    public static string? RunCase(string dir, string kind, Dictionary<string, object?> input, Dictionary<string, object?> expect)
    {
        switch (kind)
        {
            case "dump":
            case "legacy_dump":
            {
                using var f = SpdfFile.Open(In(dir, Str(input, "file")));
                var got = SpdfJson.Parse(SpdfJson.Canonical(f.Dump()));
                var want = ReadJson(In(dir, Str(expect, "dump")));
                if (SpdfJson.Diff(got, want) is { } diff)
                {
                    return "dump differs at " + diff;
                }
                string h = f.ContentSha256();
                return h == Str(expect, "content_sha256") ? null : $"content_sha256 {h} != {Str(expect, "content_sha256")}";
            }
            case "roundtrip":
            {
                var source = SpdfSource.Read(In(dir, Str(input, "source")));
                string tmpDir = Path.Combine(Path.GetTempPath(), "spdf-roundtrip-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(tmpDir);
                try
                {
                    string output = Path.Combine(tmpDir, "x.spdf");
                    SpdfSource.Write(source, output);
                    using var f = SpdfFile.Open(output);
                    var got = SpdfJson.Parse(SpdfJson.Canonical(f.Dump()));
                    var want = ReadJson(In(dir, Str(expect, "dump")));
                    return SpdfJson.Diff(got, want) is { } diff ? "roundtrip dump differs at " + diff : null;
                }
                finally
                {
                    try
                    {
                        Directory.Delete(tmpDir, recursive: true);
                    }
                    catch (IOException)
                    {
                    }
                }
            }
            case "validate":
            {
                var r = SpdfValidator.Validate(In(dir, Str(input, "file")));
                var got = new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["valid"] = r.Valid,
                    ["version"] = r.Version,
                    ["errors"] = r.ErrorCodes.Cast<object?>().ToList(),
                    ["warnings"] = r.WarningCodes.Cast<object?>().ToList(),
                };
                var want = new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["valid"] = expect.GetValueOrDefault("valid"),
                    ["version"] = expect.GetValueOrDefault("version"),
                    ["errors"] = SortedCodes(expect.GetValueOrDefault("errors")),
                    ["warnings"] = SortedCodes(expect.GetValueOrDefault("warnings")),
                };
                return SpdfJson.Diff(got, want) is { } diff ? $"got {SpdfJson.Compact(got)} ({diff})" : null;
            }
            case "search_lexical":
            case "search_vector":
            case "search_hybrid":
            {
                using var f = SpdfFile.Open(In(dir, Str(input, "file")));
                int limit = (int)(Anchor.AsInteger(input.GetValueOrDefault("limit")) ?? 10);
                IReadOnlyList<SearchHit> hits;
                if (kind == "search_lexical")
                {
                    var plan = f.PlanLexical(Str(input, "query"));
                    if (plan.Route != Str(expect, "route") || !SpdfJson.JsonEquals(plan.Match, expect.GetValueOrDefault("match")))
                    {
                        return $"route/match {plan.Route}/{SpdfJson.Compact(plan.Match)} != {Str(expect, "route")}/{SpdfJson.Compact(expect.GetValueOrDefault("match"))}";
                    }
                    hits = f.SearchLexical(Str(input, "query"), limit);
                }
                else if (kind == "search_vector")
                {
                    string target = input.GetValueOrDefault("target") as string ?? "fragment";
                    hits = f.SearchVector(Doubles(input.GetValueOrDefault("query_vector")), Str(input, "space"), target, limit);
                }
                else
                {
                    hits = f.SearchHybrid(Str(input, "query"), Doubles(input.GetValueOrDefault("query_vector")), Str(input, "space"), limit);
                }
                return CompareResults(hits, expect.GetValueOrDefault("results"), withVia: kind != "search_vector");
            }
            case "anchor_uri":
                return RunAnchorUri(input, expect);
            case "locate":
            {
                using var f = SpdfFile.Open(In(dir, Str(input, "file")));
                var got = f.Locate(Str(input, "reference")).ToTree();
                return SpdfJson.Diff(got, expect) is { } diff ? $"got {SpdfJson.Compact(got)} ({diff})" : null;
            }
            case "export_csl":
            case "export_bibtex":
            {
                var items = new List<IDictionary<string, object?>>();
                foreach (var file in (input.GetValueOrDefault("files") as List<object?> ?? []).OfType<string>())
                {
                    using var f = SpdfFile.Open(In(dir, file));
                    items.Add(f.GetMetadata());
                }
                if (kind == "export_csl")
                {
                    var got = BibliographyExport.CslItems(items, Anchor.FromTree(input.GetValueOrDefault("anchor")), Anchor.FromTree(input.GetValueOrDefault("anchor_end")));
                    return SpdfJson.Diff(got, expect.GetValueOrDefault("items")) is { } diff ? $"got {SpdfJson.Compact(got)} ({diff})" : null;
                }
                string text = BibliographyExport.BibTeX(items);
                return NormalizeBibTeX(text).SequenceEqual(NormalizeBibTeX(Str(expect, "text")), StringComparer.Ordinal) ? null : "got " + text;
            }
            case "export_structure":
            {
                using var f = SpdfFile.Open(In(dir, Str(input, "file")));
                var format = Str(input, "format") switch
                {
                    "alto" => StructureFormat.Alto,
                    "tei" => StructureFormat.Tei,
                    "iiif" => StructureFormat.Iiif,
                    var other => throw new FormatException("unknown format " + other),
                };
                var got = f.ExportStructure(format);
                return SpdfJson.Diff(got, expect) is { } diff ? $"got {SpdfJson.Compact(got)} ({diff})" : null;
            }
            case "cite_passage":
            {
                using var f = SpdfFile.Open(In(dir, Str(input, "file")));
                var got = f.CitePassage(Str(input, "fragment"), Str(input, "quote"), Str(input, "locale")).ToTree();
                return Str(expect, "text") == (string?)got["text"] && Str(expect, "uri") == (string?)got["uri"] ? null : "got " + SpdfJson.Compact(got);
            }
            case "cite":
            {
                var md = input.GetValueOrDefault("metadata") as Dictionary<string, object?> ?? [];
                var anchor = Anchor.FromTree(input.GetValueOrDefault("anchor")) ?? throw new FormatException("case without anchor");
                string text = Citation.Cite(anchor, Anchor.FromTree(input.GetValueOrDefault("anchor_end")), md, Str(input, "locale"));
                return text == Str(expect, "text") ? null : $"got \"{text}\"";
            }
            case "quantize":
            {
                Dictionary<string, object?> got;
                try
                {
                    var data = VectorCodec.Quantize(Doubles(input.GetValueOrDefault("values")).ToArray(), Str(input, "dtype"));
                    got = new Dictionary<string, object?>(StringComparer.Ordinal) { ["hex"] = TextUtil.Hex(data) };
                }
                catch (ArgumentException)
                {
                    got = new Dictionary<string, object?>(StringComparer.Ordinal) { ["error"] = true };
                }
                return SpdfJson.Diff(got, expect) is null ? null : "got " + SpdfJson.Compact(got);
            }
        }
        return "unknown kind " + kind;
    }

    private static string? RunAnchorUri(Dictionary<string, object?> input, Dictionary<string, object?> expect)
    {
        if (input.ContainsKey("anchor"))
        {
            string docRef = Str(input, "docref");
            var anchor = Anchor.FromTree(input["anchor"]) ?? throw new FormatException("anchor is not an object");
            string uri = AnchorUri.Format(docRef, anchor, Anchor.FromTree(input.GetValueOrDefault("anchor_end")));
            if (uri != Str(expect, "uri"))
            {
                return "format gives " + uri;
            }
            var parsed = AnchorUri.Parse(uri);
            var got = new Dictionary<string, object?>(StringComparer.Ordinal) { ["docref"] = parsed.DocRef, ["locator"] = parsed.Locator.ToTree() };
            var want = new Dictionary<string, object?>(StringComparer.Ordinal) { ["docref"] = docRef, ["locator"] = expect.GetValueOrDefault("locator") };
            if (SpdfJson.Diff(got, want) is { } diff)
            {
                return "parse differs at " + diff;
            }
            return AnchorUri.Format(parsed.DocRef, parsed.Locator) == uri ? null : "no round trip";
        }
        if (expect.GetValueOrDefault("error") is true)
        {
            return AnchorUri.TryParse(Str(input, "uri"), out _) ? "accepted an invalid URI" : null;
        }
        var p = AnchorUri.Parse(Str(input, "uri"));
        var g = new Dictionary<string, object?>(StringComparer.Ordinal) { ["docref"] = p.DocRef, ["locator"] = p.Locator.ToTree() };
        var w = new Dictionary<string, object?>(StringComparer.Ordinal) { ["docref"] = expect.GetValueOrDefault("docref"), ["locator"] = expect.GetValueOrDefault("locator") };
        if (SpdfJson.Diff(g, w) is { } d)
        {
            return "parse differs at " + d;
        }
        string canonical = AnchorUri.Format(p.DocRef, p.Locator);
        return canonical == Str(expect, "canonical") ? null : "canonical form " + canonical;
    }

    private static List<string> NormalizeBibTeX(string text) =>
        text.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList();

    private static List<object?> SortedCodes(object? v) =>
        (v as List<object?> ?? []).OfType<string>().Distinct().Order(StringComparer.Ordinal).Cast<object?>().ToList();

    private static string? CompareResults(IReadOnlyList<SearchHit> hits, object? expected, bool withVia)
    {
        var exp = (expected as List<object?> ?? []).OfType<Dictionary<string, object?>>().ToList();
        var gotIds = hits.Select(h => h.Target + ":" + h.Id).ToList();
        var wantIds = exp.Select(e =>
            e.TryGetValue("fragment_id", out var fid) ? "fragment:" + fid
            : e.TryGetValue("unit_id", out var uid) ? "unit:" + uid
            : "figure:" + e.GetValueOrDefault("figure_id")).ToList();
        if (!gotIds.SequenceEqual(wantIds, StringComparer.Ordinal))
        {
            return $"order [{string.Join(",", gotIds)}] != [{string.Join(",", wantIds)}]";
        }
        for (int i = 0; i < exp.Count; i++)
        {
            var e = exp[i];
            var h = hits[i];
            double want = SpdfJson.ToDouble(e.GetValueOrDefault("score"));
            if (!(Math.Abs(h.Score - want) <= Tolerance))
            {
                return string.Create(CultureInfo.InvariantCulture, $"{h.Id}: score {h.Score:R} != {want:R}");
            }
            if (h.AnchorUri != e.GetValueOrDefault("anchor_uri") as string)
            {
                return $"{h.Id}: anchor_uri {h.AnchorUri} != {e.GetValueOrDefault("anchor_uri")}";
            }
            if (withVia && e.TryGetValue("via", out var via) && !SpdfJson.JsonEquals(h.Via.Cast<object?>().ToList(), via))
            {
                return $"{h.Id}: via {string.Join(",", h.Via)} != {SpdfJson.Compact(via)}";
            }
        }
        return null;
    }
}
