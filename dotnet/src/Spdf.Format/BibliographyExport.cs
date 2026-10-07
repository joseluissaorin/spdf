using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Spdf;

/// <summary>A BibTeX entry: type, key and fields in output order (values already escaped).</summary>
/// <param name="EntryType">Entry type without <c>@</c> (<c>book</c>, <c>article</c>, <c>misc</c>…).</param>
/// <param name="Key">Citation key.</param>
/// <param name="Fields">Field names and values, in output order.</param>
public sealed record BibTexEntry(string EntryType, string Key, IReadOnlyList<KeyValuePair<string, string>> Fields)
{
    /// <summary>The entry as BibTeX text.</summary>
    public override string ToString() =>
        "@" + EntryType + "{" + Key + ",\n" + string.Join(",\n", Fields.Select(f => "  " + f.Key + " = {" + f.Value + "}")) + "\n}\n";
}

/// <summary>
/// Bibliography exports (specification §19, RFC 0002): CSL-JSON and BibTeX. Exports never
/// invent data: fields absent from the file are absent from the export.
/// </summary>
public static partial class BibliographyExport
{
    private static readonly Dictionary<string, string> BibTypes = new(StringComparer.Ordinal)
    {
        ["book"] = "book",
        ["article-journal"] = "article",
        ["article-magazine"] = "article",
        ["article-newspaper"] = "article",
        ["chapter"] = "incollection",
        ["paper-conference"] = "inproceedings",
        ["thesis"] = "phdthesis",
        ["report"] = "techreport",
    };

    private static readonly (string Csl, string Bib)[] SimpleFields =
    [
        ("publisher", "publisher"), ("publisher-place", "address"), ("collection-title", "series"),
        ("volume", "volume"), ("issue", "number"), ("page", "pages"), ("edition", "edition"),
        ("DOI", "doi"), ("ISBN", "isbn"), ("URL", "url"), ("language", "language"), ("note", "note"),
    ];

    [GeneratedRegex("^-?[0-9]+\\z", RegexOptions.CultureInvariant)]
    private static partial Regex IntegerText();

    [GeneratedRegex("(\\s+)", RegexOptions.CultureInvariant)]
    private static partial Regex Whitespace();

    /// <summary>
    /// The CSL-JSON item of a document: the metadata without the <c>spdf</c> member, with
    /// <c>id</c> set to <paramref name="id"/> (default: the BibTeX key).
    /// </summary>
    public static Dictionary<string, object?> CslItem(IDictionary<string, object?> metadata, string? id = null)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        var item = (Dictionary<string, object?>)SpdfJson.ToTree(metadata)!;
        item.Remove("spdf");
        item["id"] = id ?? CitationKey(item);
        return item;
    }

    /// <summary>The metadata as a CSL-JSON array with one item (compact JSON).</summary>
    public static string CslJson(IDictionary<string, object?> metadata) => SpdfJson.Compact(new List<object?> { CslItem(metadata) });

    /// <summary>Several documents as a CSL-JSON array; colliding keys get <c>a</c>, <c>b</c>, <c>c</c>… in document order.</summary>
    public static string CslJson(IEnumerable<IDictionary<string, object?>> metadata)
    {
        var items = metadata.ToList();
        var keys = Keys(items);
        return SpdfJson.Compact(items.Select((m, i) => (object?)CslItem(m, keys[i])).ToList());
    }

    /// <summary>
    /// The base citation key (§19, RFC 0002): the first author's <c>family</c> (or <c>literal</c>),
    /// else the first word of the title, decomposed with NFKD and reduced to lowercase ASCII
    /// letters (<c>anon</c> if nothing is left), followed by the first year of <c>issued</c>
    /// (or <c>nd</c>): <c>cervantessaavedra1605</c>, <c>la1554</c>, <c>anonnd</c>.
    /// </summary>
    public static string CitationKey(IDictionary<string, object?> metadata)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        var md = (Dictionary<string, object?>)SpdfJson.ToTree(metadata)!;
        string baseText = "";
        if (md.GetValueOrDefault("author") is List<object?> { Count: > 0 } authors && authors[0] is Dictionary<string, object?> first)
        {
            object? source = Legacy.Truthy(first.GetValueOrDefault("family")) ? first["family"] : first.GetValueOrDefault("literal");
            baseText = AsciiLetters(Legacy.Truthy(source) ? JsString(source) : "");
        }
        if (baseText.Length == 0)
        {
            string title = md.GetValueOrDefault("title") is { } t ? JsString(t) : "";
            string? word = title.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            baseText = word is null ? "" : AsciiLetters(word);
        }
        return (baseText.Length > 0 ? baseText : "anon") + (YearOf(md) ?? "nd");
    }

    /// <summary>NFKD, marks removed, only ASCII letters kept, lowercased.</summary>
    private static string AsciiLetters(string s)
    {
        var sb = new StringBuilder();
        foreach (char c in TextUtil.Nfkd(s))
        {
            if (char.IsAsciiLetter(c))
            {
                sb.Append(char.ToLowerInvariant(c));
            }
        }
        return sb.ToString();
    }

    /// <summary>The first year of <c>issued</c> (an integer, or a string of digits), or <c>null</c>.</summary>
    private static string? YearOf(Dictionary<string, object?> md)
    {
        if (md.GetValueOrDefault("issued") is Dictionary<string, object?> issued
            && issued.GetValueOrDefault("date-parts") is List<object?> { Count: > 0 } dp
            && dp[0] is List<object?> { Count: > 0 } first)
        {
            switch (first[0])
            {
                case long l:
                    return l.ToString(CultureInfo.InvariantCulture);
                case double d when double.IsFinite(d) && Math.Floor(d) == d:
                    return SpdfJson.FormatNumber(d);
                case string s when IntegerText().IsMatch(s.Trim()):
                    return SpdfJson.FormatNumber(double.Parse(s.Trim(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture));
            }
        }
        return null;
    }

    /// <summary>Escapes <c>\</c> (as <c>\textbackslash{}</c>), <c>{</c> and <c>}</c>; the rest of UTF-8 stays as it is.</summary>
    public static string Escape(string value)
    {
        var sb = new StringBuilder(value.Length);
        foreach (char c in value)
        {
            switch (c)
            {
                case '\\':
                    sb.Append("\\textbackslash{}");
                    break;
                case '{':
                case '}':
                    sb.Append('\\').Append(c);
                    break;
                default:
                    sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    /// <summary>Escapes and braces every whitespace-separated token that contains an uppercase letter.</summary>
    private static string ProtectTitle(string title) =>
        string.Concat(Whitespace().Split(title).Select(token =>
            token.EnumerateRunes().Any(r => Rune.GetUnicodeCategory(r) == UnicodeCategory.UppercaseLetter)
                ? "{" + Escape(token) + "}"
                : Escape(token)));

    private static string? Names(object? v)
    {
        if (v is not List<object?> people)
        {
            return null;
        }
        var out_ = new List<string>();
        foreach (var e in people)
        {
            if (e is not Dictionary<string, object?> p)
            {
                continue;
            }
            if (Legacy.Truthy(p.GetValueOrDefault("literal")))
            {
                out_.Add("{" + Escape(JsString(p["literal"])) + "}");
                continue;
            }
            string family = p.GetValueOrDefault("family") is { } f ? JsString(f) : "";
            string particle = p.GetValueOrDefault("non-dropping-particle") is { } np ? JsString(np) : "";
            if (particle.Length > 0 && family.Length > 0)
            {
                family = particle + " " + family;
            }
            string given = p.GetValueOrDefault("given") is { } g ? JsString(g) : "";
            if (family.Length > 0 && given.Length > 0)
            {
                out_.Add(Escape(family) + ", " + Escape(given));
            }
            else if (family.Length > 0 || given.Length > 0)
            {
                out_.Add("{" + Escape(family.Length > 0 ? family : given) + "}");
            }
        }
        return out_.Count > 0 ? string.Join(" and ", out_) : null;
    }

    /// <summary>The BibTeX entry of CSL-JSON metadata (§19, RFC 0002), with the given key or the default one.</summary>
    public static BibTexEntry BibTeXEntry(IDictionary<string, object?> metadata, string? key = null)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        var md = (Dictionary<string, object?>)SpdfJson.ToTree(metadata)!;
        string type = BibTypes.GetValueOrDefault(md.GetValueOrDefault("type") is { } t ? JsString(t) : "", "misc");
        var fields = new List<KeyValuePair<string, string>>();
        void Add(string name, string value) => fields.Add(new KeyValuePair<string, string>(name, value));
        if (Names(md.GetValueOrDefault("author")) is { } authors)
        {
            Add("author", authors);
        }
        if (Names(md.GetValueOrDefault("editor")) is { } editors)
        {
            Add("editor", editors);
        }
        if (Legacy.Truthy(md.GetValueOrDefault("title")))
        {
            Add("title", ProtectTitle(JsString(md["title"])));
        }
        if (YearOf(md) is { } year)
        {
            Add("year", year);
        }
        if (Legacy.Truthy(md.GetValueOrDefault("container-title")))
        {
            Add(type == "article" ? "journal" : "booktitle", ProtectTitle(JsString(md["container-title"])));
        }
        foreach (var (csl, bib) in SimpleFields)
        {
            var v = md.GetValueOrDefault(csl);
            if (v is null or "" || v is List<object?> { Count: 0 })
            {
                continue;
            }
            Add(bib, Escape(JsString(v)));
        }
        return new BibTexEntry(type, key ?? CitationKey(md), fields);
    }

    /// <summary>Renders CSL-JSON metadata as a BibTeX entry.</summary>
    public static string BibTeX(IDictionary<string, object?> metadata, string? key = null) => BibTeXEntry(metadata, key).ToString();

    /// <summary>BibTeX entries of several documents; colliding keys get <c>a</c>, <c>b</c>, <c>c</c>… in document order.</summary>
    public static string BibTeX(IEnumerable<IDictionary<string, object?>> metadata)
    {
        var items = metadata.ToList();
        var keys = Keys(items);
        return string.Join("\n", items.Select((m, i) => BibTeX(m, keys[i])));
    }

    private static List<string> Keys(List<IDictionary<string, object?>> items)
    {
        var bases = items.Select(CitationKey).ToList();
        var counts = bases.GroupBy(b => b, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);
        var seen = new Dictionary<string, int>(StringComparer.Ordinal);
        return bases.Select(b =>
        {
            if (counts[b] == 1)
            {
                return b;
            }
            int n = seen.GetValueOrDefault(b);
            seen[b] = n + 1;
            return b + Suffix(n);
        }).ToList();
    }

    /// <summary>0 → a, 25 → z, 26 → aa…</summary>
    private static string Suffix(int n)
    {
        string letters = "";
        int x = n + 1;
        while (x > 0)
        {
            int r = (x - 1) % 26;
            x = (x - 1) / 26;
            letters = (char)('a' + r) + letters;
        }
        return letters;
    }

    /// <summary>JavaScript <c>String(value)</c> for JSON values.</summary>
    private static string JsString(object? v) => v switch
    {
        null => "null",
        string s => s,
        bool b => b ? "true" : "false",
        long l => l.ToString(CultureInfo.InvariantCulture),
        double d => SpdfJson.FormatNumber(d),
        List<object?> l => string.Join(",", l.Select(e => e is null ? "" : JsString(e))),
        Dictionary<string, object?> => "[object Object]",
        _ => v.ToString() ?? "",
    };
}
