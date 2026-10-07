using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Spdf;

/// <summary>A canonical reference (<c>stephanus:514a</c>).</summary>
/// <param name="Scheme">Reference scheme (<c>stephanus</c>, <c>bekker</c>, <c>bible</c>, <c>cts</c>…).</param>
/// <param name="Ref">The reference within the scheme.</param>
public sealed record CanonicalRef(string Scheme, string Ref);

/// <summary>
/// The fragment of an anchor URI (specification §5): only the parameters present are set.
/// </summary>
public sealed record Locator
{
    /// <summary>Physical page (<c>p</c>).</summary>
    public long? P { get; init; }

    /// <summary>Physical end page (<c>pe</c>).</summary>
    public long? Pe { get; init; }

    /// <summary>Printed folio (<c>f</c>).</summary>
    public string? F { get; init; }

    /// <summary>Printed end folio (<c>fe</c>).</summary>
    public string? Fe { get; init; }

    /// <summary>Time in seconds, <c>[t0]</c> or <c>[t0, t1]</c> (<c>t</c>).</summary>
    public IReadOnlyList<double>? T { get; init; }

    /// <summary>Section path (<c>s</c>).</summary>
    public IReadOnlyList<string>? S { get; init; }

    /// <summary>Paragraph (<c>para</c>).</summary>
    public long? Para { get; init; }

    /// <summary>Slide (<c>sl</c>).</summary>
    public long? Sl { get; init; }

    /// <summary>Sheet name (<c>sh</c>).</summary>
    public string? Sh { get; init; }

    /// <summary>Rows <c>[from, to]</c> (<c>rows</c>).</summary>
    public IReadOnlyList<long>? Rows { get; init; }

    /// <summary>Verse lines <c>[a]</c> or <c>[a, b]</c> (<c>v</c>).</summary>
    public IReadOnlyList<long>? V { get; init; }

    /// <summary>Canonical reference (<c>ref</c>).</summary>
    public CanonicalRef? Ref { get; init; }

    /// <summary>Characters <c>[start, end]</c> (<c>char</c>).</summary>
    public IReadOnlyList<long>? Char { get; init; }

    /// <summary>Region <c>[x, y, w, h]</c> in fractions (<c>xywh</c>, written as percent).</summary>
    public IReadOnlyList<double>? Xywh { get; init; }

    /// <summary>The locator as a JSON object with only the present members.</summary>
    public Dictionary<string, object?> ToTree()
    {
        var m = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (P is not null)
        {
            m["p"] = P.Value;
        }
        if (Pe is not null)
        {
            m["pe"] = Pe.Value;
        }
        if (F is not null)
        {
            m["f"] = F;
        }
        if (Fe is not null)
        {
            m["fe"] = Fe;
        }
        if (T is { Count: > 0 })
        {
            m["t"] = T.Select(x => (object?)x).ToList();
        }
        if (S is { Count: > 0 })
        {
            m["s"] = S.Select(x => (object?)x).ToList();
        }
        if (Para is not null)
        {
            m["para"] = Para.Value;
        }
        if (Sl is not null)
        {
            m["sl"] = Sl.Value;
        }
        if (Sh is not null)
        {
            m["sh"] = Sh;
        }
        if (Rows is { Count: > 0 })
        {
            m["rows"] = Rows.Select(x => (object?)x).ToList();
        }
        if (V is { Count: > 0 })
        {
            m["v"] = V.Select(x => (object?)x).ToList();
        }
        if (Ref is not null)
        {
            m["ref"] = new Dictionary<string, object?>(StringComparer.Ordinal) { ["scheme"] = Ref.Scheme, ["ref"] = Ref.Ref };
        }
        if (Char is { Count: > 0 })
        {
            m["char"] = Char.Select(x => (object?)x).ToList();
        }
        if (Xywh is { Count: > 0 })
        {
            m["xywh"] = Xywh.Select(x => (object?)x).ToList();
        }
        return m;
    }

    /// <summary>Builds a locator from its JSON form.</summary>
    public static Locator FromTree(IDictionary<string, object?> m)
    {
        object? Get(string k) => m.TryGetValue(k, out var v) ? v : null;
        List<double>? Doubles(string k) => Get(k) is List<object?> l ? l.Select(SpdfJson.ToDouble).ToList() : null;
        List<long>? Longs(string k) => Get(k) is List<object?> l ? l.Select(x => Anchor.AsInteger(x) ?? 0).ToList() : null;
        CanonicalRef? reference = null;
        if (Get("ref") is Dictionary<string, object?> r)
        {
            reference = new CanonicalRef(r.GetValueOrDefault("scheme") as string ?? "", r.GetValueOrDefault("ref") as string ?? "");
        }
        return new Locator
        {
            P = Anchor.AsInteger(Get("p")),
            Pe = Anchor.AsInteger(Get("pe")),
            F = Get("f") as string,
            Fe = Get("fe") as string,
            T = Doubles("t"),
            S = Get("s") is List<object?> s ? s.Select(x => x as string ?? "").ToList() : null,
            Para = Anchor.AsInteger(Get("para")),
            Sl = Anchor.AsInteger(Get("sl")),
            Sh = Get("sh") as string,
            Rows = Longs("rows"),
            V = Longs("v"),
            Ref = reference,
            Char = Longs("char"),
            Xywh = Doubles("xywh"),
        };
    }
}

/// <summary>A parsed anchor URI: the document reference and the locator.</summary>
/// <param name="DocRef">Document reference (<c>sha256-&lt;hex&gt;</c> or a document id), decoded.</param>
/// <param name="Locator">The parameters of the fragment.</param>
public sealed record ParsedAnchorUri(string DocRef, Locator Locator);

/// <summary>
/// Anchor URIs (specification §5): <c>spdf:&lt;docref&gt;#&lt;params&gt;</c>, aligned with
/// W3C Media Fragments and RFC 5147, with a canonical parameter order.
/// </summary>
public static partial class AnchorUri
{
    [GeneratedRegex("^sha256-[0-9a-f]{64}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex ShaRef();

    [GeneratedRegex("^(0|[1-9][0-9]*)\\z", RegexOptions.CultureInvariant)]
    private static partial Regex IntRe();

    [GeneratedRegex("^[0-9]+(\\.[0-9]+)?\\z", RegexOptions.CultureInvariant)]
    private static partial Regex DecRe();

    [GeneratedRegex("^(?:([0-9]+):)?([0-5]?[0-9]):([0-5][0-9](?:\\.[0-9]+)?)\\z", RegexOptions.CultureInvariant)]
    private static partial Regex ClockRe();

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    /// <summary>The preferred document reference: <c>sha256-&lt;lowercase hex of source_sha256&gt;</c>.</summary>
    public static string DocRef(string sourceSha256) => "sha256-" + sourceSha256.ToLowerInvariant();

    /// <summary>Percent-encodes every UTF-8 byte except RFC 3986 unreserved characters, with uppercase hex.</summary>
    public static string PercentEncode(string s)
    {
        var sb = new StringBuilder();
        foreach (byte b in SpdfJson.Utf8.GetBytes(s))
        {
            char c = (char)b;
            if (char.IsAsciiLetterOrDigit(c) || c is '-' or '.' or '_' or '~')
            {
                sb.Append(c);
            }
            else
            {
                sb.Append('%').Append(b.ToString("X2", CultureInfo.InvariantCulture));
            }
        }
        return sb.ToString();
    }

    /// <summary>Decodes <c>%XX</c> escapes leniently (raw characters pass through); a stray <c>%</c> or invalid UTF-8 is an error.</summary>
    /// <exception cref="FormatException">Bad percent-encoding.</exception>
    public static string PercentDecode(string s)
    {
        if (!s.Contains('%'))
        {
            return s;
        }
        var bytes = new List<byte>(s.Length);
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            if (c == '%')
            {
                if (i + 2 >= s.Length || !char.IsAsciiHexDigit(s[i + 1]) || !char.IsAsciiHexDigit(s[i + 2]))
                {
                    throw new FormatException("bad percent-encoding");
                }
                bytes.Add(byte.Parse(s.AsSpan(i + 1, 2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture));
                i += 2;
                continue;
            }
            int len = char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]) ? 2 : 1;
            try
            {
                bytes.AddRange(StrictUtf8.GetBytes(s.Substring(i, len)));
            }
            catch (ArgumentException e)
            {
                throw new FormatException("invalid character in URI", e);
            }
            i += len - 1;
        }
        try
        {
            return StrictUtf8.GetString(bytes.ToArray());
        }
        catch (ArgumentException e)
        {
            throw new FormatException("percent-encoding is not UTF-8", e);
        }
    }

    /// <summary>Derives the locator of an anchor and an optional end anchor (§5.2).</summary>
    public static Locator LocatorOf(Anchor anchor, Anchor? end = null)
    {
        ArgumentNullException.ThrowIfNull(anchor);
        long? p = null, pe = null, para = null, sl = null;
        string? f = null, fe = null, sh = null;
        List<double>? t = null;
        List<string>? s = null;
        List<long>? rows = null, v = null, chars = null;
        List<double>? xywh = null;
        CanonicalRef? reference = null;
        switch (anchor.Type)
        {
            case "page":
                p = anchor.GetInteger("physical");
                f = anchor.GetString("printed");
                if (end is not null && end.Type == "page")
                {
                    long? endPhysical = end.GetInteger("physical");
                    if (endPhysical is not null && endPhysical != p)
                    {
                        pe = endPhysical;
                    }
                    string? endPrinted = end.GetString("printed");
                    if (endPrinted is not null && endPrinted != f)
                    {
                        fe = endPrinted;
                    }
                }
                break;
            case "time":
            {
                double t0 = anchor.GetNumber("t0") ?? 0;
                double? t1 = end is not null && end.Type == "time" ? end.GetNumber("t1") : anchor.GetNumber("t1");
                t = t1 is null ? [t0] : [t0, t1.Value];
                break;
            }
            case "section":
            case "web":
            {
                var path = anchor.Path;
                if (path is { Count: > 0 })
                {
                    s = [.. path];
                }
                para = anchor.GetInteger("paragraph");
                f = anchor.GetString("printed");
                if (f is not null && end is not null)
                {
                    string? endPrinted = end.GetString("printed");
                    if (endPrinted is not null && endPrinted != f)
                    {
                        fe = endPrinted;
                    }
                }
                break;
            }
            case "slide":
                sl = anchor.GetInteger("n");
                break;
            case "sheet":
                sh = anchor.GetString("sheet");
                rows = [anchor.GetInteger("row_from") ?? 0, anchor.GetInteger("row_to") ?? 0];
                break;
            case "verse":
            {
                long a = anchor.GetInteger("line_from") ?? 0;
                long? b = anchor.GetInteger("line_to");
                v = b is null || b == a ? [a] : [a, b.Value];
                f = anchor.GetString("printed");
                break;
            }
            case "canonical":
                reference = new CanonicalRef(anchor.GetString("scheme") ?? "", anchor.GetString("ref") ?? "");
                break;
        }
        if (anchor.Chars is { } c)
        {
            chars = [c.Start, c.End];
        }
        if (anchor.Region is { } r)
        {
            xywh = [r.X, r.Y, r.W, r.H];
        }
        return new Locator
        {
            P = p, Pe = pe, F = f, Fe = fe, T = t, S = s, Para = para, Sl = sl, Sh = sh,
            Rows = rows, V = v, Ref = reference, Char = chars, Xywh = xywh,
        };
    }

    /// <summary>The canonical URI of a locator. <paramref name="docRef"/> is <c>sha256-&lt;hex&gt;</c> or a document id (percent-encoded here).</summary>
    public static string Format(string docRef, Locator locator)
    {
        ArgumentNullException.ThrowIfNull(docRef);
        ArgumentNullException.ThrowIfNull(locator);
        var parts = new List<string>();
        void Add(string k, string v) => parts.Add(k + "=" + v);
        static string I(long x) => x.ToString(CultureInfo.InvariantCulture);
        var l = locator;
        if (l.P is not null)
        {
            Add("p", I(l.P.Value));
        }
        if (l.Pe is not null)
        {
            Add("pe", I(l.Pe.Value));
        }
        if (l.F is not null)
        {
            Add("f", PercentEncode(l.F));
        }
        if (l.Fe is not null)
        {
            Add("fe", PercentEncode(l.Fe));
        }
        if (l.T is { Count: > 0 })
        {
            Add("t", string.Join(",", l.T.Select(x => SpdfJson.FormatNumber(SpdfJson.Round6(x)))));
        }
        if (l.S is { Count: > 0 })
        {
            Add("s", string.Join("/", l.S.Select(PercentEncode)));
        }
        if (l.Para is not null)
        {
            Add("para", I(l.Para.Value));
        }
        if (l.Sl is not null)
        {
            Add("sl", I(l.Sl.Value));
        }
        if (l.Sh is not null)
        {
            Add("sh", PercentEncode(l.Sh));
        }
        if (l.Rows is { Count: 2 })
        {
            Add("rows", I(l.Rows[0]) + "-" + I(l.Rows[1]));
        }
        if (l.V is { Count: > 0 })
        {
            Add("v", string.Join("-", l.V.Select(I)));
        }
        if (l.Ref is not null)
        {
            Add("ref", PercentEncode(l.Ref.Scheme) + ":" + PercentEncode(l.Ref.Ref));
        }
        if (l.Char is { Count: 2 })
        {
            Add("char", I(l.Char[0]) + "," + I(l.Char[1]));
        }
        if (l.Xywh is { Count: 4 })
        {
            Add("xywh", "percent:" + string.Join(",", l.Xywh.Select(x => SpdfJson.FormatNumber(SpdfJson.RoundDecimals(x * 100, 4)))));
        }
        string reference = ShaRef().IsMatch(docRef) ? docRef : PercentEncode(docRef);
        return parts.Count == 0 ? "spdf:" + reference : "spdf:" + reference + "#" + string.Join("&", parts);
    }

    /// <summary>The canonical URI of an anchor (and optional end anchor).</summary>
    public static string Format(string docRef, Anchor anchor, Anchor? end = null) => Format(docRef, LocatorOf(anchor, end));

    /// <summary>Parses an anchor URI strictly; unknown parameters are ignored.</summary>
    /// <exception cref="FormatException">The URI is malformed.</exception>
    public static ParsedAnchorUri Parse(string uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        if (!uri.StartsWith("spdf:", StringComparison.Ordinal))
        {
            throw new FormatException("not an spdf: URI");
        }
        string rest = uri[5..];
        int hash = rest.IndexOf('#');
        string rawRef = hash >= 0 ? rest[..hash] : rest;
        string frag = hash >= 0 ? rest[(hash + 1)..] : "";
        if (rawRef.Length == 0)
        {
            throw new FormatException("empty document reference");
        }
        string docRef = PercentDecode(rawRef);
        long? p = null, pe = null, para = null, sl = null;
        string? f = null, fe = null, sh = null;
        List<double>? t = null, xywh = null;
        List<string>? s = null;
        List<long>? rows = null, v = null, chars = null;
        CanonicalRef? reference = null;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (string part in frag.Split('&'))
        {
            if (part.Length == 0)
            {
                continue;
            }
            int eq = part.IndexOf('=');
            if (eq < 0)
            {
                throw new FormatException($"parameter without value: '{part}'");
            }
            string k = part[..eq], val = part[(eq + 1)..];
            if (!seen.Add(k))
            {
                throw new FormatException($"duplicate parameter {k}");
            }
            switch (k)
            {
                case "p":
                case "pe":
                case "para":
                case "sl":
                {
                    long n = ParseInt(val);
                    if (k != "para" && n < 1)
                    {
                        throw new FormatException($"{k} starts at 1");
                    }
                    if (k == "p")
                    {
                        p = n;
                    }
                    else if (k == "pe")
                    {
                        pe = n;
                    }
                    else if (k == "para")
                    {
                        para = n;
                    }
                    else
                    {
                        sl = n;
                    }
                    break;
                }
                case "f":
                    f = PercentDecode(val);
                    break;
                case "fe":
                    fe = PercentDecode(val);
                    break;
                case "sh":
                    sh = PercentDecode(val);
                    break;
                case "t":
                {
                    string tv = val.StartsWith("npt:", StringComparison.Ordinal) ? val[4..] : val;
                    var ts = tv.Split(',').Select(ParseNpt).ToList();
                    if (ts.Count > 2 || (ts.Count == 2 && ts[1] < ts[0]))
                    {
                        throw new FormatException("bad t");
                    }
                    t = ts;
                    break;
                }
                case "s":
                    s = val.Split('/').Select(PercentDecode).ToList();
                    break;
                case "rows":
                {
                    int dash = val.IndexOf('-');
                    if (dash < 0)
                    {
                        throw new FormatException("rows needs a-b");
                    }
                    rows = [ParseInt(val[..dash]), ParseInt(val[(dash + 1)..])];
                    break;
                }
                case "v":
                {
                    var ps = val.Split('-');
                    if (ps.Length > 2)
                    {
                        throw new FormatException("bad v");
                    }
                    v = ps.Select(ParseInt).ToList();
                    break;
                }
                case "ref":
                {
                    int colon = val.IndexOf(':');
                    if (colon <= 0)
                    {
                        throw new FormatException("ref needs scheme:ref");
                    }
                    reference = new CanonicalRef(PercentDecode(val[..colon]), PercentDecode(val[(colon + 1)..]));
                    break;
                }
                case "char":
                {
                    var ps = val.Split(',');
                    if (ps.Length != 2)
                    {
                        throw new FormatException("char needs start,end");
                    }
                    long a = ParseInt(ps[0]), b = ParseInt(ps[1]);
                    if (b < a)
                    {
                        throw new FormatException("char end before start");
                    }
                    chars = [a, b];
                    break;
                }
                case "xywh":
                {
                    if (!val.StartsWith("percent:", StringComparison.Ordinal))
                    {
                        throw new FormatException("xywh must use percent:");
                    }
                    var ps = val[8..].Split(',');
                    if (ps.Length != 4 || !ps.All(x => DecRe().IsMatch(x)))
                    {
                        throw new FormatException("bad xywh");
                    }
                    xywh = ps.Select(x => SpdfJson.Round6(double.Parse(x, NumberStyles.Float, CultureInfo.InvariantCulture) / 100)).ToList();
                    break;
                }
                default:
                    break; // unknown parameters are ignored
            }
        }
        return new ParsedAnchorUri(docRef, new Locator
        {
            P = p, Pe = pe, F = f, Fe = fe, T = t, S = s, Para = para, Sl = sl, Sh = sh,
            Rows = rows, V = v, Ref = reference, Char = chars, Xywh = xywh,
        });
    }

    /// <summary>Parses an anchor URI; returns <c>false</c> instead of throwing.</summary>
    public static bool TryParse(string? uri, out ParsedAnchorUri? result)
    {
        result = null;
        if (uri is null)
        {
            return false;
        }
        try
        {
            result = Parse(uri);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static long ParseInt(string s)
    {
        if (!IntRe().IsMatch(s) || !long.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out long n))
        {
            throw new FormatException($"not an integer: '{s}'");
        }
        return n;
    }

    private static double ParseNpt(string s)
    {
        if (DecRe().IsMatch(s))
        {
            return SpdfJson.Round6(double.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture));
        }
        var m = ClockRe().Match(s);
        if (!m.Success)
        {
            throw new FormatException($"bad time: '{s}'");
        }
        long h = m.Groups[1].Success ? long.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
        long mi = long.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture);
        double sec = double.Parse(m.Groups[3].Value, NumberStyles.Float, CultureInfo.InvariantCulture);
        return SpdfJson.Round6(h * 3600 + mi * 60 + sec);
    }
}
