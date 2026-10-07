namespace Spdf;

/// <summary>The citation of a quoted passage (specification §18.2).</summary>
/// <param name="Text">Short citation, e.g. <c>(Hooke, 1665, p. 211)</c>.</param>
/// <param name="Uri">Canonical anchor URI of the passage.</param>
/// <param name="Anchor">Anchor of the passage: the unit it lies in, with <c>chars</c> when it lies in one unit.</param>
/// <param name="AnchorEnd">End anchor when the passage crosses from one unit to the next, else <c>null</c>.</param>
public sealed record PassageCitation(string Text, string Uri, Anchor Anchor, Anchor? AnchorEnd)
{
    /// <summary><c>{"text", "uri"}</c> as the conformance suite compares it.</summary>
    public Dictionary<string, object?> ToTree() => new(StringComparer.Ordinal) { ["text"] = Text, ["uri"] = Uri };
}

public sealed partial class SpdfFile
{
    /// <summary>
    /// Cites a quotation taken from a fragment (§18.2) by the unit it actually lies in, never by
    /// the start anchor of the fragment: inside the fragment's part of its start unit, the
    /// citation is that unit with the <c>chars</c> of the quotation; inside its part of the end
    /// unit, that unit; across both, the range from the start unit to the end unit. The quotation
    /// is normalized to NFC and searched literally (code points).
    /// </summary>
    /// <exception cref="KeyNotFoundException">No such fragment, or its unit is missing.</exception>
    /// <exception cref="ArgumentException">The quotation is not in the fragment.</exception>
    public PassageCitation CitePassage(string fragmentId, string quote, string locale = "es")
    {
        ArgumentNullException.ThrowIfNull(fragmentId);
        ArgumentNullException.ThrowIfNull(quote);
        var units = UnitRows().Cast<Dictionary<string, object?>>().ToList();
        var f = RowsForDump("fragments", "WHERE " + Col("fragments", "id") + " = @p0", [fragmentId]).FirstOrDefault()
            ?? throw new KeyNotFoundException($"no fragment '{fragmentId}'");
        string q = TextUtil.Nfc(quote);
        string startId = AsText(f["unit"]);
        var u1 = units.FirstOrDefault(u => AsText(u["id"]) == startId) ?? throw new KeyNotFoundException($"no unit '{startId}'");
        string text1 = u1["text"] as string ?? "";
        var (c1From, c1To) = Range(f["anchor"], text1);
        string seg1 = SliceCodePoints(text1, c1From, c1To);
        var u2 = EndUnit(units, startId, f["anchor_end"]);
        string seg2 = "";
        long c2From = 0;
        if (u2 is not null)
        {
            string text2 = u2["text"] as string ?? "";
            (c2From, long c2To) = Range(f["anchor_end"], text2);
            seg2 = SliceCodePoints(text2, c2From, c2To);
        }
        Anchor anchor;
        Anchor? end = null;
        if (seg1.Contains(q, StringComparison.Ordinal))
        {
            anchor = WithChars(u1, c1From + CodePointIndexOf(seg1, q), q);
        }
        else if (u2 is not null && seg2.Contains(q, StringComparison.Ordinal))
        {
            anchor = WithChars(u2, c2From + CodePointIndexOf(seg2, q), q);
        }
        else if (u2 is not null && (f["text"] as string ?? "").Contains(q, StringComparison.Ordinal))
        {
            anchor = Stripped(u1);
            end = Stripped(u2);
        }
        else
        {
            throw new ArgumentException("the quote is not in the fragment", nameof(quote));
        }
        string text = Citation.Cite(anchor, end, GetMetadata(), locale);
        return new PassageCitation(text, AnchorUri.Format(DocRef, anchor, end), anchor, end);
    }

    /// <summary>The <c>chars</c> of an anchor, or the whole unit text.</summary>
    private static (long From, long To) Range(object? anchor, string unitText)
    {
        if (anchor is Dictionary<string, object?> a && a.GetValueOrDefault("chars") is List<object?> { Count: 2 } ch
            && Anchor.AsInteger(ch[0]) is long from && Anchor.AsInteger(ch[1]) is long to)
        {
            return (from, to);
        }
        return (0, TextUtil.CodePointCount(unitText));
    }

    private static string SliceCodePoints(string s, long from, long to)
    {
        var cps = TextUtil.CodePoints(s);
        int a = (int)Math.Clamp(from, 0, cps.Count), b = (int)Math.Clamp(to, 0, cps.Count);
        return b <= a ? "" : TextUtil.FromCodePoints(cps.GetRange(a, b - a));
    }

    private static long CodePointIndexOf(string s, string q) =>
        TextUtil.CodePointCount(s[..s.IndexOf(q, StringComparison.Ordinal)]);

    private static Anchor Stripped(Dictionary<string, object?> unit) =>
        new(unit["anchor"] is Dictionary<string, object?> a ? Anchor.Identity(a) : new Dictionary<string, object?>(StringComparer.Ordinal));

    private static Anchor WithChars(Dictionary<string, object?> unit, long start, string q) =>
        Stripped(unit).WithChars(start, start + TextUtil.CodePointCount(q));
}
