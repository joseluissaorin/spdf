using System.Globalization;
using System.Text;

namespace Spdf;

/// <summary>Unicode helpers that work on code points, never on UTF-16 units.</summary>
internal static class TextUtil
{
    public static string Nfc(string s) => Normalize(s, NormalizationForm.FormC);

    public static string Nfd(string s) => Normalize(s, NormalizationForm.FormD);

    public static string Nfkd(string s) => Normalize(s, NormalizationForm.FormKD);

    private static string Normalize(string s, NormalizationForm form)
    {
        try
        {
            return s.Normalize(form);
        }
        catch (ArgumentException)
        {
            return s; // lone surrogates: leave the text as it is
        }
    }

    /// <summary>The code points of a string (a lone surrogate counts as one).</summary>
    public static List<int> CodePoints(string s)
    {
        var cps = new List<int>(s.Length);
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]))
            {
                cps.Add(char.ConvertToUtf32(c, s[i + 1]));
                i++;
            }
            else
            {
                cps.Add(c);
            }
        }
        return cps;
    }

    public static int CodePointCount(string s)
    {
        int n = 0;
        for (int i = 0; i < s.Length; i++)
        {
            if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]))
            {
                i++;
            }
            n++;
        }
        return n;
    }

    public static string FromCodePoints(IEnumerable<int> cps)
    {
        var sb = new StringBuilder();
        foreach (int cp in cps)
        {
            AppendCodePoint(sb, cp);
        }
        return sb.ToString();
    }

    public static void AppendCodePoint(StringBuilder sb, int cp)
    {
        if (cp >= 0x10000 && cp <= 0x10FFFF)
        {
            sb.Append(char.ConvertFromUtf32(cp));
        }
        else
        {
            sb.Append((char)cp);
        }
    }

    public static UnicodeCategory Category(int cp) =>
        cp >= 0xD800 && cp <= 0xDFFF ? UnicodeCategory.Surrogate : CharUnicodeInfo.GetUnicodeCategory(cp);

    /// <summary>Unicode general category L, M or N.</summary>
    public static bool IsWordChar(int cp)
    {
        switch (Category(cp))
        {
            case UnicodeCategory.UppercaseLetter:
            case UnicodeCategory.LowercaseLetter:
            case UnicodeCategory.TitlecaseLetter:
            case UnicodeCategory.ModifierLetter:
            case UnicodeCategory.OtherLetter:
            case UnicodeCategory.NonSpacingMark:
            case UnicodeCategory.SpacingCombiningMark:
            case UnicodeCategory.EnclosingMark:
            case UnicodeCategory.DecimalDigitNumber:
            case UnicodeCategory.LetterNumber:
            case UnicodeCategory.OtherNumber:
                return true;
            default:
                return false;
        }
    }

    /// <summary>Compares two strings in code point order (SQLite BINARY over UTF-8, Python <c>str</c> order).</summary>
    public static int CompareCodePoints(string a, string b)
    {
        int i = 0, j = 0;
        while (i < a.Length && j < b.Length)
        {
            int ca = NextCodePoint(a, ref i);
            int cb = NextCodePoint(b, ref j);
            if (ca != cb)
            {
                return ca < cb ? -1 : 1;
            }
        }
        if (i < a.Length)
        {
            return 1;
        }
        return j < b.Length ? -1 : 0;
    }

    private static int NextCodePoint(string s, ref int i)
    {
        char c = s[i];
        if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]))
        {
            int cp = char.ConvertToUtf32(c, s[i + 1]);
            i += 2;
            return cp;
        }
        i++;
        return c;
    }

    /// <summary>Lexicographic comparison of byte arrays.</summary>
    public static int CompareBytes(byte[] a, byte[] b) => a.AsSpan().SequenceCompareTo(b);

    public static string Hex(ReadOnlySpan<byte> bytes) => Convert.ToHexString(bytes).ToLowerInvariant();
}

/// <summary>Code point order comparer for strings.</summary>
internal sealed class CodePointComparer : IComparer<string>
{
    public static readonly CodePointComparer Instance = new();

    public int Compare(string? x, string? y)
    {
        if (ReferenceEquals(x, y))
        {
            return 0;
        }
        if (x is null)
        {
            return -1;
        }
        if (y is null)
        {
            return 1;
        }
        return TextUtil.CompareCodePoints(x, y);
    }
}
