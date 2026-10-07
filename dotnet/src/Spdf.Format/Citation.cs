using System.Globalization;

namespace Spdf;

/// <summary>Short author-date citations (specification §18): <c>(Cervantes Saavedra, 1605, fol. 1r)</c>.</summary>
public static class Citation
{
    private const string Vowels = "aeiouáéíóúü";

    /// <summary>
    /// Cites an anchor: <c>(names, year[, locator])</c>. <paramref name="end"/> is the end
    /// anchor of a range; <paramref name="metadata"/> is the CSL-JSON item; <paramref name="locale"/>
    /// is <c>es</c> or <c>en</c> (with or without region; anything else falls back to English).
    /// </summary>
    public static string Cite(Anchor anchor, Anchor? end, IDictionary<string, object?> metadata, string locale)
    {
        ArgumentNullException.ThrowIfNull(anchor);
        ArgumentNullException.ThrowIfNull(metadata);
        var md = (Dictionary<string, object?>)SpdfJson.ToTree(metadata)!;
        bool es = string.Equals((locale ?? "").Split('-')[0].ToLowerInvariant(), "es", StringComparison.Ordinal);
        var parts = new List<string> { Names(md, es), Year(md, es) };
        string? loc = LocatorText(anchor, end, es);
        if (!string.IsNullOrEmpty(loc))
        {
            parts.Add(loc);
        }
        return "(" + string.Join(", ", parts) + ")";
    }

    private static string Name(object? v)
    {
        if (v is string s)
        {
            return s;
        }
        if (v is not Dictionary<string, object?> m)
        {
            return "";
        }
        if (m.GetValueOrDefault("literal") is string { Length: > 0 } literal)
        {
            return literal;
        }
        if (m.GetValueOrDefault("family") is string { Length: > 0 } family)
        {
            return m.GetValueOrDefault("non-dropping-particle") is string { Length: > 0 } particle ? particle + " " + family : family;
        }
        return m.GetValueOrDefault("given") as string ?? "";
    }

    private static string Names(Dictionary<string, object?> md, bool es)
    {
        var names = new List<string>();
        if (md.GetValueOrDefault("author") is List<object?> list)
        {
            foreach (var a in list)
            {
                string n = Name(a);
                if (n.Length > 0)
                {
                    names.Add(n);
                }
            }
        }
        switch (names.Count)
        {
            case 1:
                return names[0];
            case 2:
                if (es)
                {
                    return names[0] + (StartsWithISound(names[1]) ? " e " : " y ") + names[1];
                }
                return names[0] + " and " + names[1];
            case > 2:
                return names[0] + " et al.";
        }
        if (md.GetValueOrDefault("title-short") is string { Length: > 0 } shortTitle)
        {
            return shortTitle;
        }
        string title = md.GetValueOrDefault("title") as string ?? "";
        int colon = title.IndexOf(':');
        return (colon >= 0 ? title[..colon] : title).Trim();
    }

    /// <summary>The name begins with the sound /i/ (i, í, hi, hí) not followed by a vowel.</summary>
    internal static bool StartsWithISound(string s)
    {
        string low = s.ToLowerInvariant();
        string rest;
        if (low.Length >= 2 && low[0] == 'h' && (low[1] == 'i' || low[1] == 'í'))
        {
            rest = low[2..];
        }
        else if (low.Length >= 1 && (low[0] == 'i' || low[0] == 'í'))
        {
            rest = low[1..];
        }
        else
        {
            return false;
        }
        return !(rest.Length > 0 && Vowels.Contains(rest[0]));
    }

    private static string Year(Dictionary<string, object?> md, bool es)
    {
        if (md.GetValueOrDefault("issued") is Dictionary<string, object?> issued
            && issued.GetValueOrDefault("date-parts") is List<object?> { Count: > 0 } dp
            && dp[0] is List<object?> { Count: > 0 } first)
        {
            long? y = first[0] switch
            {
                long l => l,
                double d when double.IsFinite(d) => (long)Math.Truncate(d),
                string str when long.TryParse(str.Trim(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out long p) => p,
                _ => null,
            };
            if (y is not null)
            {
                if (y > 0)
                {
                    return y.Value.ToString(CultureInfo.InvariantCulture);
                }
                string bc = (-y.Value).ToString(CultureInfo.InvariantCulture);
                return es ? bc + " a. C." : bc + " BC";
            }
        }
        return es ? "s. f." : "n.d.";
    }

    private static string Bracketed(Anchor a, string printed) => a.GetString("source") == "inferred" ? "[" + printed + "]" : printed;

    private static string PageLocator(Anchor a, Anchor? end, bool es, string single, string plural)
    {
        string? printed = a.GetString("printed");
        if (printed is null)
        {
            return es ? "s. p." : "n. pag.";
        }
        string first = Bracketed(a, printed);
        if (end is not null && end.Type == a.Type)
        {
            string? endPrinted = end.GetString("printed");
            if (endPrinted is not null && endPrinted != printed)
            {
                return plural + " " + first + "-" + Bracketed(end, endPrinted);
            }
        }
        return single + " " + first;
    }

    internal static string Clock(double t)
    {
        long s = Math.Max(0, (long)Math.Floor(t));
        long h = s / 3600, m = s % 3600 / 60, sec = s % 60;
        return h > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{h}:{m:00}:{sec:00}")
            : string.Create(CultureInfo.InvariantCulture, $"{m}:{sec:00}");
    }

    private static string? LocatorText(Anchor a, Anchor? end, bool es)
    {
        switch (a.Type)
        {
            case "page":
                return a.GetString("foliation") switch
                {
                    "leaf" => PageLocator(a, end, es, "fol.", "fols."),
                    "column" => PageLocator(a, end, es, "col.", "cols."),
                    _ => PageLocator(a, end, es, "p.", "pp."),
                };
            case "time":
            {
                double? t0 = a.GetNumber("t0");
                if (t0 is null)
                {
                    return null;
                }
                if (end is not null && end.Type == "time" && end.GetNumber("t1") is double t1)
                {
                    return Clock(t0.Value) + "-" + Clock(t1);
                }
                return Clock(t0.Value);
            }
            case "section":
            case "web":
            {
                if (a.GetString("printed") is not null)
                {
                    return PageLocator(a, end, es, "p.", "pp.");
                }
                var parts = new List<string>();
                if (a.Path is { Count: > 0 } path)
                {
                    parts.Add("§ " + path[^1]);
                }
                if (a["paragraph"] is { } para)
                {
                    parts.Add((es ? "párr. " : "para. ") + SpdfJson.Canonical(para));
                }
                return parts.Count == 0 ? null : string.Join(", ", parts);
            }
            case "slide":
                return a.GetInteger("n") is long n ? (es ? "diap. " : "slide ") + n.ToString(CultureInfo.InvariantCulture) : null;
            case "sheet":
            {
                string sheet = a.GetString("sheet") ?? "";
                long? from = a.GetInteger("row_from"), to = a.GetInteger("row_to");
                if (from is null || to is null)
                {
                    return sheet;
                }
                if (from == to)
                {
                    return string.Create(CultureInfo.InvariantCulture, $"{sheet}, {(es ? "fila" : "row")} {from}");
                }
                return string.Create(CultureInfo.InvariantCulture, $"{sheet}, {(es ? "filas" : "rows")} {from}-{to}");
            }
            case "verse":
            {
                long? from = a.GetInteger("line_from");
                if (from is null)
                {
                    return null;
                }
                long? to = a.GetInteger("line_to");
                return to is not null && to != from
                    ? string.Create(CultureInfo.InvariantCulture, $"vv. {from}-{to}")
                    : string.Create(CultureInfo.InvariantCulture, $"v. {from}");
            }
            case "canonical":
                return a.GetString("ref");
        }
        return null;
    }
}
