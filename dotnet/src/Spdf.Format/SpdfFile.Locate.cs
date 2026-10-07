namespace Spdf;

/// <summary>The result of <see cref="SpdfFile.Locate(string)"/> (specification §5.4).</summary>
public sealed record LocateResult
{
    /// <summary>The reference designates this document (false: another document; everything else is empty).</summary>
    public bool Document { get; init; }

    /// <summary>Ids of the units the reference designates, in reading order.</summary>
    public IReadOnlyList<string> Units { get; init; } = [];

    /// <summary>Ids of the fragments the reference designates, in <c>n</c> order.</summary>
    public IReadOnlyList<string> Fragments { get; init; } = [];

    /// <summary>The <c>char</c> range of the reference, if any.</summary>
    public IReadOnlyList<long>? Char { get; init; }

    /// <summary>The <c>xywh</c> region of the reference (fractions), if any.</summary>
    public IReadOnlyList<double>? Xywh { get; init; }

    /// <summary>The result as a JSON value tree: <c>{document, units, fragments, char, xywh}</c>.</summary>
    public Dictionary<string, object?> ToTree() => new(StringComparer.Ordinal)
    {
        ["document"] = Document,
        ["units"] = Units.Cast<object?>().ToList(),
        ["fragments"] = Fragments.Cast<object?>().ToList(),
        ["char"] = Char?.Cast<object?>().ToList(),
        ["xywh"] = Xywh?.Cast<object?>().ToList(),
    };
}

/// <summary>Output formats of the structural exports of §19.4.</summary>
public enum StructureFormat
{
    /// <summary>ALTO 4: one <c>Page</c> per page unit.</summary>
    Alto,

    /// <summary>TEI: one <c>pb</c> per page unit.</summary>
    Tei,

    /// <summary>IIIF Presentation 3: one canvas per page unit.</summary>
    Iiif,
}

/// <summary>
/// One page of a structural export (§19.4): the physical page, the printed folio as ALTO
/// <c>PRINTED_IMG_NR</c> (absent for inferred and unnumbered folios), and the label used by
/// TEI <c>pb/@n</c> and the IIIF canvas (<c>[iv]</c> for inferred folios, absent when unnumbered).
/// </summary>
/// <param name="Physical">Physical page (ALTO <c>PHYSICAL_IMG_NR</c>).</param>
/// <param name="Printed">ALTO <c>PRINTED_IMG_NR</c>, or <c>null</c>.</param>
/// <param name="Label">TEI <c>pb/@n</c> and IIIF canvas <c>label</c>, or <c>null</c>.</param>
public sealed record StructurePage(object? Physical, string? Printed, string? Label)
{
    /// <summary>The page as the conformance suite compares it for a format.</summary>
    public Dictionary<string, object?> ToTree(StructureFormat format) => format switch
    {
        StructureFormat.Alto => new(StringComparer.Ordinal) { ["physical"] = Physical, ["printed"] = Printed },
        StructureFormat.Tei => new(StringComparer.Ordinal) { ["n"] = Label },
        _ => new(StringComparer.Ordinal) { ["label"] = Label },
    };
}

public sealed partial class SpdfFile
{
    private static readonly string[] RuleOrder = ["p", "f", "t", "sl", "v", "ref", "s", "sh"];

    /// <summary>
    /// Resolves a reference against this file (§5.4): an <c>spdf:</c> anchor URI, or the URL of
    /// a <c>.spdf</c> file whose fragment is read as a locator. An <c>spdf:</c> URI whose
    /// document reference is neither <c>sha256-&lt;source_sha256&gt;</c> nor the document id
    /// designates another document (<see cref="LocateResult.Document"/> false).
    /// </summary>
    /// <exception cref="FormatException">The reference is a malformed anchor URI.</exception>
    public LocateResult Locate(string reference)
    {
        ArgumentNullException.ThrowIfNull(reference);
        Locator locator;
        if (reference.StartsWith("spdf:", StringComparison.Ordinal))
        {
            var parsed = AnchorUri.Parse(reference);
            var doc = DocumentRow();
            if (parsed.DocRef != "sha256-" + AsText(doc["source_sha256"]) && parsed.DocRef != AsText(doc["id"]))
            {
                return new LocateResult { Document = false };
            }
            locator = parsed.Locator;
        }
        else
        {
            int hash = reference.IndexOf('#');
            string fragment = hash >= 0 ? reference[(hash + 1)..] : "";
            locator = fragment.Length > 0 ? AnchorUri.Parse("spdf:x#" + fragment).Locator : new Locator();
        }
        var present = locator.ToTree();
        string? rule = RuleOrder.FirstOrDefault(present.ContainsKey);
        if (rule is null)
        {
            return new LocateResult { Document = true, Char = locator.Char, Xywh = locator.Xywh };
        }
        var units = UnitRows().Cast<Dictionary<string, object?>>().ToList();
        var fragments = RowsForDump("fragments", "ORDER BY " + Col("fragments", "n"));
        var unitIds = units
            .Where(u => AnchorMatches(rule, locator, u["anchor"], rule == "f" ? u["printed"] : null))
            .Select(u => AsText(u["id"]))
            .ToList();
        if (rule == "t" && unitIds.Count == 0)
        {
            var last = units.LastOrDefault(u => u["anchor"] is Dictionary<string, object?> a && a.GetValueOrDefault("type") as string == "time");
            if (last?["anchor"] is Dictionary<string, object?> la && la.GetValueOrDefault("t1") is long or double
                && SpdfJson.ToDouble(la["t1"]) == locator.T![0])
            {
                unitIds = [AsText(last["id"])];
            }
        }
        // A fragment matches by its start anchor or by its end anchor.
        var frags = fragments
            .Where(f => AnchorMatches(rule, locator, f["anchor"], null) || (f["anchor_end"] is not null && AnchorMatches(rule, locator, f["anchor_end"], null)))
            .ToList();
        if (unitIds.Count == 0 && frags.Count > 0)
        {
            var ord = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var u in units)
            {
                ord.TryAdd(AsText(u["id"]), u["ord"] is long or double ? SpdfJson.ToDouble(u["ord"]) : 0);
            }
            unitIds = frags.Select(f => AsText(f["unit"])).Distinct(StringComparer.Ordinal)
                .OrderBy(id => ord.GetValueOrDefault(id)).ToList();
        }
        if (locator.Char is { Count: 2 } range)
        {
            // `char` refers to the text of the first designated unit.
            long c = range[0], d = range[1];
            string? first = unitIds.Count > 0 ? unitIds[0] : null;
            bool Overlaps(object? x)
            {
                if (x is not Dictionary<string, object?> a || a.GetValueOrDefault("chars") is not List<object?> { Count: 2 } ch
                    || ch[0] is not (long or double) || ch[1] is not (long or double))
                {
                    return false;
                }
                double s = SpdfJson.ToDouble(ch[0]), e = SpdfJson.ToDouble(ch[1]);
                return c < d ? s < d && c < e : s <= c && c < e;
            }
            frags = frags.Where(f =>
            {
                if (AsText(f["unit"]) == first && Overlaps(f["anchor"]))
                {
                    return true;
                }
                var endUnit = EndUnit(units, AsText(f["unit"]), f["anchor_end"]);
                return endUnit is not null && AsText(endUnit["id"]) == first && Overlaps(f["anchor_end"]);
            }).ToList();
        }
        return new LocateResult
        {
            Document = true,
            Units = unitIds,
            Fragments = frags.Select(f => AsText(f["id"])).ToList(),
            Char = locator.Char,
            Xywh = locator.Xywh,
        };
    }

    /// <summary>
    /// The unit where a fragment ends (§4.4): the first unit after its start unit, in reading
    /// order, whose anchor equals the end anchor ignoring <c>chars</c> and <c>region</c>.
    /// </summary>
    internal static Dictionary<string, object?>? EndUnit(List<Dictionary<string, object?>> units, string startId, object? anchorEnd)
    {
        if (anchorEnd is not Dictionary<string, object?> end)
        {
            return null;
        }
        var target = Anchor.Identity(end);
        bool after = false;
        foreach (var u in units)
        {
            if (AsText(u["id"]) == startId)
            {
                after = true;
                continue;
            }
            if (after && u["anchor"] is Dictionary<string, object?> a && SpdfJson.ValueEquals(Anchor.Identity(a), target))
            {
                return u;
            }
        }
        return null;
    }

    private static bool AnchorMatches(string rule, Locator l, object? anchorValue, object? printed)
    {
        if (anchorValue is not Dictionary<string, object?> a)
        {
            return false;
        }
        string? type = a.GetValueOrDefault("type") as string;
        object? Get(string k) => a.GetValueOrDefault(k);
        static bool Num(object? v) => v is long or double;
        static double D(object? v) => SpdfJson.ToDouble(v);
        switch (rule)
        {
            case "p":
                return type == "page" && Anchor.IsInteger(Get("physical")) && l.P <= D(Get("physical")) && D(Get("physical")) <= (l.Pe ?? l.P);
            case "f":
                return ValueEquals(printed ?? Get("printed"), l.F);
            case "t":
            {
                double x = l.T![0];
                return type == "time" && Num(Get("t0")) && Num(Get("t1")) && D(Get("t0")) <= x && x < D(Get("t1"));
            }
            case "sl":
                return type == "slide" && ValueEquals(Get("n"), l.Sl);
            case "v":
            {
                long x = l.V![0];
                object? lf = Get("line_from");
                object? lt = Get("line_to") ?? lf;
                return type == "verse" && Anchor.IsInteger(lf) && Num(lt) && D(lf) <= x && x <= D(lt);
            }
            case "ref":
                return type == "canonical" && ValueEquals(Get("scheme"), l.Ref!.Scheme) && ValueEquals(Get("ref"), l.Ref.Ref);
            case "s":
            {
                if (type is not ("section" or "web") || Get("path") is not List<object?> path)
                {
                    return false;
                }
                var want = l.S!;
                if (l.Para is not null)
                {
                    return path.Count == want.Count && path.Zip(want).All(p => ValueEquals(p.First, p.Second)) && ValueEquals(Get("paragraph"), l.Para);
                }
                return path.Count >= want.Count && path.Take(want.Count).Zip(want).All(p => ValueEquals(p.First, p.Second));
            }
            case "sh":
            {
                if (type != "sheet" || !ValueEquals(Get("sheet"), l.Sh))
                {
                    return false;
                }
                if (l.Rows is { Count: > 0 } rows)
                {
                    long x = rows[0];
                    return Anchor.IsInteger(Get("row_from")) && Anchor.IsInteger(Get("row_to")) && D(Get("row_from")) <= x && x <= D(Get("row_to"));
                }
                return true;
            }
        }
        return false;
    }

    /// <summary>Equality of JSON values as in the reference (numbers by value, strings ordinal).</summary>
    private static bool ValueEquals(object? a, object? b)
    {
        if (a is long or double or int && b is long or double or int)
        {
            return Convert.ToDouble(a, System.Globalization.CultureInfo.InvariantCulture) == Convert.ToDouble(b, System.Globalization.CultureInfo.InvariantCulture);
        }
        return a switch
        {
            null => b is null,
            string s => b is string t && string.Equals(s, t, StringComparison.Ordinal),
            bool x => b is bool y && x == y,
            _ => SpdfJson.Canonical(a) == SpdfJson.Canonical(b),
        };
    }

    /// <summary>
    /// The page sequence of the structural exports (§19.4) taken from the data: one entry per
    /// unit with a page anchor, in reading order. <see cref="ExportStructure"/> reads the same
    /// sequence back from the ALTO, TEI and IIIF documents this library writes.
    /// </summary>
    public IReadOnlyList<StructurePage> GetStructurePages()
    {
        var pages = new List<StructurePage>();
        foreach (Dictionary<string, object?> u in UnitRows().Cast<Dictionary<string, object?>>())
        {
            if (u["anchor"] is not Dictionary<string, object?> a || a.GetValueOrDefault("type") as string != "page")
            {
                continue;
            }
            object? printed = a.GetValueOrDefault("printed");
            bool inferred = a.GetValueOrDefault("source") as string == "inferred";
            string? printedText = printed is null ? null : AsText(printed);
            pages.Add(new StructurePage(
                a.GetValueOrDefault("physical"),
                printed is null || inferred ? null : printedText,
                printed is null ? null : inferred ? "[" + printedText + "]" : printedText));
        }
        return pages;
    }
}
