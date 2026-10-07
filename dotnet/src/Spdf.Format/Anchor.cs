using System.Globalization;

namespace Spdf;

/// <summary>A rectangle in fractions (0–1) of a unit image.</summary>
/// <param name="X">Left edge.</param>
/// <param name="Y">Top edge.</param>
/// <param name="W">Width.</param>
/// <param name="H">Height.</param>
public readonly record struct Region(double X, double Y, double W, double H);

/// <summary>A character range in code points of the NFC unit text, end exclusive.</summary>
/// <param name="Start">First code point.</param>
/// <param name="End">One past the last code point.</param>
public readonly record struct CharRange(long Start, long End);

/// <summary>A problem found in an anchor: a validation code (E040, E041, E042) and a message.</summary>
/// <param name="Code">Validation code.</param>
/// <param name="Message">What is wrong.</param>
public sealed record AnchorProblem(string Code, string Message);

/// <summary>
/// An SPDF anchor (specification §4): where a passage is in the source, as a JSON object
/// (<c>{"type":"page","physical":29,"printed":"21"}</c>). Members this version does not
/// know are kept, so an anchor survives a round trip untouched.
/// </summary>
public sealed class Anchor
{
    /// <summary>Wraps (a deep copy of) a JSON object.</summary>
    public Anchor(IDictionary<string, object?> members)
    {
        ArgumentNullException.ThrowIfNull(members);
        Members = (Dictionary<string, object?>)SpdfJson.ToTree(members)!;
    }

    private Anchor(Dictionary<string, object?> members, bool _) => Members = members;

    /// <summary>The members of the anchor as a JSON value tree.</summary>
    public Dictionary<string, object?> Members { get; }

    /// <summary>A member, or <c>null</c> if absent.</summary>
    public object? this[string key] => Members.TryGetValue(key, out var v) ? v : null;

    /// <summary>The anchor type (<c>page</c>, <c>time</c>, <c>section</c>…), or <c>null</c>.</summary>
    public string? Type => GetString("type");

    /// <summary>Whether a member is present (even if it is <c>null</c>).</summary>
    public bool Has(string key) => Members.ContainsKey(key);

    /// <summary>A string member, or <c>null</c> if absent or not a string.</summary>
    public string? GetString(string key) => this[key] as string;

    /// <summary>An integer member (a JSON number with an integral value), or <c>null</c>.</summary>
    public long? GetInteger(string key) => AsInteger(this[key]);

    /// <summary>A numeric member, or <c>null</c>.</summary>
    public double? GetNumber(string key) => this[key] switch
    {
        long l => l,
        double d => d,
        _ => null,
    };

    /// <summary>The <c>path</c> member (section and web anchors), or <c>null</c> if absent or not a string array.</summary>
    public IReadOnlyList<string>? Path
    {
        get
        {
            if (this["path"] is not List<object?> l)
            {
                return null;
            }
            var out_ = new List<string>(l.Count);
            foreach (var e in l)
            {
                if (e is not string s)
                {
                    return null;
                }
                out_.Add(s);
            }
            return out_;
        }
    }

    /// <summary>The <c>region</c> member, or <c>null</c>.</summary>
    public Region? Region
    {
        get
        {
            if (this["region"] is not Dictionary<string, object?> r)
            {
                return null;
            }
            double? x = Num(r, "x"), y = Num(r, "y"), w = Num(r, "w"), h = Num(r, "h");
            return x is null || y is null || w is null || h is null ? null : new Region(x.Value, y.Value, w.Value, h.Value);
        }
    }

    /// <summary>The <c>chars</c> member, or <c>null</c>.</summary>
    public CharRange? Chars
    {
        get
        {
            if (this["chars"] is not List<object?> { Count: 2 } l)
            {
                return null;
            }
            long? a = AsInteger(l[0]), b = AsInteger(l[1]);
            return a is null || b is null ? null : new CharRange(a.Value, b.Value);
        }
    }

    /// <summary>Parses anchor JSON.</summary>
    /// <exception cref="FormatException">Not JSON, or not a JSON object.</exception>
    public static Anchor Parse(string json) => new(SpdfJson.ParseObject(json), true);

    /// <summary>Wraps a parsed JSON value if it is an object, else returns <c>null</c>.</summary>
    public static Anchor? FromTree(object? value) =>
        value is Dictionary<string, object?> d ? new Anchor(d, true) : value is IDictionary<string, object?> g ? new Anchor(g) : null;

    /// <summary>Compact JSON with sorted keys.</summary>
    public string ToJson() => SpdfJson.Compact(Members);

    /// <inheritdoc/>
    public override string ToString() => ToJson();

    /// <summary>A page anchor.</summary>
    public static Anchor Page(long physical, string? printed, string? source = null, string? foliation = null, bool? roman = null)
    {
        var m = new Dictionary<string, object?>(StringComparer.Ordinal) { ["type"] = "page", ["physical"] = physical, ["printed"] = printed };
        if (source is not null)
        {
            m["source"] = source;
        }
        if (foliation is not null)
        {
            m["foliation"] = foliation;
        }
        if (roman is not null)
        {
            m["roman"] = roman.Value;
        }
        return new Anchor(m, true);
    }

    /// <summary>A time anchor (seconds).</summary>
    public static Anchor Time(double t0, double t1, string? speaker = null)
    {
        var m = new Dictionary<string, object?>(StringComparer.Ordinal) { ["type"] = "time", ["t0"] = t0, ["t1"] = t1 };
        if (speaker is not null)
        {
            m["speaker"] = speaker;
        }
        return new Anchor(m, true);
    }

    /// <summary>A section anchor.</summary>
    public static Anchor Section(IEnumerable<string> path, long? paragraph = null, string? printed = null)
    {
        var m = new Dictionary<string, object?>(StringComparer.Ordinal) { ["type"] = "section", ["path"] = path.Cast<object?>().ToList() };
        if (paragraph is not null)
        {
            m["paragraph"] = paragraph.Value;
        }
        if (printed is not null)
        {
            m["printed"] = printed;
        }
        return new Anchor(m, true);
    }

    /// <summary>A slide anchor.</summary>
    public static Anchor Slide(long n) =>
        new(new Dictionary<string, object?>(StringComparer.Ordinal) { ["type"] = "slide", ["n"] = n }, true);

    /// <summary>A spreadsheet anchor.</summary>
    public static Anchor Sheet(string sheet, long rowFrom, long rowTo) =>
        new(new Dictionary<string, object?>(StringComparer.Ordinal) { ["type"] = "sheet", ["sheet"] = sheet, ["row_from"] = rowFrom, ["row_to"] = rowTo }, true);

    /// <summary>A verse anchor.</summary>
    public static Anchor Verse(long lineFrom, long? lineTo = null, string? printed = null)
    {
        var m = new Dictionary<string, object?>(StringComparer.Ordinal) { ["type"] = "verse", ["line_from"] = lineFrom };
        if (lineTo is not null)
        {
            m["line_to"] = lineTo.Value;
        }
        if (printed is not null)
        {
            m["printed"] = printed;
        }
        return new Anchor(m, true);
    }

    /// <summary>A canonical reference anchor (<c>stephanus</c> <c>514a</c>, <c>bible</c>…).</summary>
    public static Anchor Canonical(string scheme, string reference) =>
        new(new Dictionary<string, object?>(StringComparer.Ordinal) { ["type"] = "canonical", ["scheme"] = scheme, ["ref"] = reference }, true);

    /// <summary>Returns a copy with <c>chars</c> set.</summary>
    public Anchor WithChars(long start, long end)
    {
        var m = new Dictionary<string, object?>(Members, StringComparer.Ordinal) { ["chars"] = new List<object?> { start, end } };
        return new Anchor(m, true);
    }

    /// <summary>Returns a copy with <c>region</c> set.</summary>
    public Anchor WithRegion(Region r)
    {
        var m = new Dictionary<string, object?>(Members, StringComparer.Ordinal)
        {
            ["region"] = new Dictionary<string, object?>(StringComparer.Ordinal) { ["x"] = r.X, ["y"] = r.Y, ["w"] = r.W, ["h"] = r.H },
        };
        return new Anchor(m, true);
    }

    /// <summary>Checks this anchor (§4 and §22); see <see cref="Check(object?, string?)"/>.</summary>
    public AnchorProblem? Check(string? unitText = null) => Check(Members, unitText);

    /// <summary>
    /// Checks a parsed anchor: <c>null</c> when valid, else E040 (not an object, missing or
    /// mistyped member), E041 (unknown type) or E042 (<c>chars</c> outside the unit text, if
    /// <paramref name="unitText"/> is given).
    /// </summary>
    public static AnchorProblem? Check(object? anchor, string? unitText)
    {
        if (anchor is Anchor an)
        {
            anchor = an.Members;
        }
        if (anchor is not Dictionary<string, object?> a)
        {
            return new AnchorProblem("E040", "anchor is not an object");
        }
        if (!a.TryGetValue("type", out var tv) || tv is not string t)
        {
            return new AnchorProblem("E040", "anchor without type");
        }
        if (!SpdfInfo.AnchorTypes.Contains(t))
        {
            return new AnchorProblem("E041", $"unknown anchor type '{t}'");
        }
        object? Get(string k) => a.TryGetValue(k, out var v) ? v : null;
        bool ok = t switch
        {
            "page" => IsInteger(Get("physical")) && SpdfJson.ToDouble(Get("physical")) >= 1 && a.ContainsKey("printed") && Get("printed") is null or string,
            "time" => IsNumber(Get("t0")) && IsNumber(Get("t1")) && 0 <= SpdfJson.ToDouble(Get("t0")) && SpdfJson.ToDouble(Get("t0")) <= SpdfJson.ToDouble(Get("t1")),
            "section" => Get("path") is List<object?> p && p.All(x => x is string),
            "slide" => IsInteger(Get("n")) && SpdfJson.ToDouble(Get("n")) >= 1,
            "sheet" => Get("sheet") is string && IsInteger(Get("row_from")) && IsInteger(Get("row_to")),
            "web" => Get("url") is string,
            "image" => true,
            "verse" => IsInteger(Get("line_from")),
            "canonical" => Get("scheme") is string && Get("ref") is string,
            _ => true,
        };
        if (!ok)
        {
            return new AnchorProblem("E040", $"{t} anchor misses or mistypes a required member");
        }
        if (a.TryGetValue("region", out var region))
        {
            if (region is not Dictionary<string, object?> r || !new[] { "x", "y", "w", "h" }.All(k => r.TryGetValue(k, out var v) && IsNumber(v)))
            {
                return new AnchorProblem("E040", "bad region");
            }
        }
        if (a.TryGetValue("chars", out var chars))
        {
            if (chars is not List<object?> { Count: 2 } c || !IsInteger(c[0]) || !IsInteger(c[1]))
            {
                return new AnchorProblem("E040", "bad chars");
            }
            if (unitText is not null)
            {
                int n = TextUtil.CodePointCount(TextUtil.Nfc(unitText));
                double s = SpdfJson.ToDouble(c[0]), e = SpdfJson.ToDouble(c[1]);
                if (!(0 <= s && s <= e && e <= n))
                {
                    return new AnchorProblem("E042",
                        $"chars [{SpdfJson.FormatNumber(s)}, {SpdfJson.FormatNumber(e)}] out of range (unit text has {n.ToString(CultureInfo.InvariantCulture)} code points)");
                }
            }
        }
        return null;
    }

    /// <summary>A JSON number with an integral value (<c>10</c> and <c>10.0</c> count).</summary>
    internal static bool IsInteger(object? v) => v is long || (v is double d && double.IsFinite(d) && Math.Floor(d) == d);

    internal static bool IsNumber(object? v) => v is long or double;

    internal static long? AsInteger(object? v) => v switch
    {
        long l => l,
        double d when double.IsFinite(d) && Math.Floor(d) == d && d >= long.MinValue && d <= long.MaxValue => (long)d,
        _ => null,
    };

    private static double? Num(Dictionary<string, object?> m, string k) => m.TryGetValue(k, out var v) ? v switch
    {
        long l => l,
        double d => d,
        _ => null,
    } : null;
}
