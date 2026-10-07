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

    [GeneratedRegex("^[+-]?[0-9]+\\z", RegexOptions.CultureInvariant)]
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

    /// <summary>
    /// The CSL-JSON export of several documents (§19.1, §19.2): items without <c>spdf</c>, <c>id</c>
    /// = the export key. With an anchor and exactly one document, the item also carries the CSL
    /// <c>label</c> and <c>locator</c> of the citation (when the anchor has one).
    /// </summary>
    public static List<Dictionary<string, object?>> CslItems(IEnumerable<IDictionary<string, object?>> metadata, Anchor? anchor = null, Anchor? end = null)
    {
        var items = metadata.ToList();
        var keys = Keys(items);
        var out_ = items.Select((m, i) => CslItem(m, keys[i])).ToList();
        if (anchor is not null && out_.Count == 1 && CslLabelLocator(anchor, end) is { } ll)
        {
            out_[0]["label"] = ll.Label;
            out_[0]["locator"] = ll.Locator;
        }
        return out_;
    }

    /// <summary>Several documents as a CSL-JSON array (compact JSON); see <see cref="CslItems"/>.</summary>
    public static string CslJson(IEnumerable<IDictionary<string, object?>> metadata, Anchor? anchor = null, Anchor? end = null) =>
        SpdfJson.Compact(CslItems(metadata, anchor, end));

    /// <summary>
    /// The CSL <c>label</c> and <c>locator</c> of a citation (§19.2): <c>page</c>, <c>folio</c>,
    /// <c>column</c>, <c>timestamp</c>, <c>paragraph</c>, <c>section</c>, <c>verse</c> or <c>line</c>;
    /// <c>null</c> when the anchor has no locator (an unnumbered page, an image).
    /// </summary>
    public static (string Label, string Locator)? CslLabelLocator(Anchor anchor, Anchor? end = null)
    {
        ArgumentNullException.ThrowIfNull(anchor);
        string? type = anchor.Type;
        static string? Folio(Anchor a) => a.GetString("printed") is { } p ? (a.GetString("source") == "inferred" ? "[" + p + "]" : p) : null;
        if (type == "page" || (type is "section" or "web" && anchor["printed"] is not null))
        {
            string? start = Folio(anchor);
            if (start is null)
            {
                return null;
            }
            string label = type == "page"
                ? (anchor.GetString("foliation") ?? "page") switch { "leaf" => "folio", "column" => "column", _ => "page" }
                : "page";
            if (end is not null && end.Type == type && end.GetString("printed") is { } endPrinted && endPrinted != anchor.GetString("printed"))
            {
                return (label, start + "-" + Folio(end));
            }
            return (label, start);
        }
        switch (type)
        {
            case "section":
            case "web":
                if (anchor["paragraph"] is { } paragraph)
                {
                    return ("paragraph", PyString(paragraph));
                }
                return anchor.Path is { Count: > 0 } path ? ("section", path[^1]) : null;
            case "time":
                if (anchor.GetNumber("t0") is not double t0)
                {
                    return null;
                }
                string loc = Citation.Clock(t0);
                if (end is not null && end.Type == "time" && end.GetNumber("t1") is double t1)
                {
                    loc += "-" + Citation.Clock(t1);
                }
                return ("timestamp", loc);
            case "verse":
            {
                if (anchor["line_from"] is not { } lf)
                {
                    return null;
                }
                var lt = anchor["line_to"];
                return ("verse", lt is null || SpdfJson.JsonEquals(lt, lf) ? PyString(lf) : PyString(lf) + "-" + PyString(lt));
            }
            case "canonical":
                return anchor.GetString("ref") is { } r ? ("section", r) : null;
            case "sheet":
            {
                if (anchor["row_from"] is not { } a || anchor["row_to"] is not { } b)
                {
                    return null;
                }
                return ("line", SpdfJson.JsonEquals(a, b) ? PyString(a) : PyString(a) + "-" + PyString(b));
            }
        }
        return null;
    }

    private static string PyString(object? v) => v switch
    {
        long l => l.ToString(CultureInfo.InvariantCulture),
        double d when Math.Floor(d) == d && Math.Abs(d) < 1e16 => ((long)d).ToString(CultureInfo.InvariantCulture),
        _ => JsString(v),
    };

    /// <summary>
    /// The base citation key (§19.1): the first author's <c>family</c>, <c>literal</c> or
    /// <c>given</c> (the first that is not empty), else the first word of <c>title-short</c>
    /// or <c>title</c>, decomposed with NFKD and reduced to lowercase ASCII letters (<c>anon</c>
    /// if nothing is left), followed by the first year of <c>issued</c> with its sign (or
    /// <c>nd</c>): <c>cervantessaavedra1605</c>, <c>lazarillo1554</c>, <c>anonnd</c>.
    /// </summary>
    public static string CitationKey(IDictionary<string, object?> metadata)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        var md = (Dictionary<string, object?>)SpdfJson.ToTree(metadata)!;
        string baseText = "";
        if (md.GetValueOrDefault("author") is List<object?> { Count: > 0 } authors && authors[0] is Dictionary<string, object?> first)
        {
            object? source = new[] { "family", "literal", "given" }.Select(k => first.GetValueOrDefault(k)).FirstOrDefault(Legacy.Truthy);
            baseText = source is null ? "" : AsciiLetters(JsString(source));
        }
        if (baseText.Length == 0)
        {
            object? t = new[] { "title-short", "title" }.Select(k => md.GetValueOrDefault(k)).FirstOrDefault(Legacy.Truthy);
            string title = t is null ? "" : JsString(t);
            string? word = title.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            baseText = word is null ? "" : AsciiLetters(word);
        }
        return (baseText.Length > 0 ? baseText : "anon") + (YearOf(md) ?? "nd");
    }

    /// <summary>The keys of an export of several documents (§19.1): a base key that occurs more than once gets <c>a</c>, <c>b</c>, <c>c</c>… in document order.</summary>
    public static IReadOnlyList<string> ExportKeys(IEnumerable<IDictionary<string, object?>> metadata) => Keys(metadata.ToList());

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

    /// <summary>The first year of <c>issued</c> as an integer with its sign (a number or a string of digits), or <c>null</c>.</summary>
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
                case double d when double.IsFinite(d) && Math.Abs(d) < 9e15:
                    return ((long)Math.Truncate(d)).ToString(CultureInfo.InvariantCulture);
                case string s when IntegerText().IsMatch(s.Trim()) && long.TryParse(s.Trim(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out long y):
                    return y.ToString(CultureInfo.InvariantCulture);
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
