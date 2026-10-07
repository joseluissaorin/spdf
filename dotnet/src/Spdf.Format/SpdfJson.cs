using System.Collections;
using System.Globalization;
using System.Numerics;
using System.Text;

namespace Spdf;

/// <summary>
/// The JSON layer of SPDF: a small strict parser, the canonical serialization of
/// RFC 8785 (JCS) used for dumps and hashes, and structural comparison.
/// </summary>
/// <remarks>
/// <para>Parsed values form a plain tree: <c>null</c>, <see cref="bool"/>, <see cref="long"/>
/// (numbers written without fraction or exponent that fit in 64 bits), <see cref="double"/>
/// (every other number), <see cref="string"/>, <see cref="List{T}"/> of values (arrays) and
/// <see cref="Dictionary{TKey,TValue}"/> with ordinal string keys (objects).</para>
/// <para>The serializers also accept the usual .NET shapes (<see cref="int"/>,
/// <see cref="float"/>, <see cref="decimal"/>, any <see cref="IDictionary"/> with string keys,
/// any <see cref="IEnumerable"/>, <see cref="Anchor"/>).</para>
/// </remarks>
public static class SpdfJson
{
    private const int MaxDepth = 512;

    /// <summary>Parses JSON text into the value tree described in the remarks of <see cref="SpdfJson"/>.</summary>
    /// <exception cref="FormatException">The text is not valid JSON.</exception>
    public static object? Parse(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var p = new Parser(text);
        p.SkipWhitespace();
        var v = p.ParseValue(0);
        p.SkipWhitespace();
        if (!p.AtEnd)
        {
            throw new FormatException($"Trailing data after the JSON value at offset {p.Position}.");
        }
        return v;
    }

    /// <summary>Parses JSON text; returns <c>false</c> instead of throwing on invalid input.</summary>
    public static bool TryParse(string? text, out object? value)
    {
        value = null;
        if (text is null)
        {
            return false;
        }
        try
        {
            value = Parse(text);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    /// <summary>Parses a JSON object; throws if the text is not a JSON object.</summary>
    public static Dictionary<string, object?> ParseObject(string text) =>
        Parse(text) as Dictionary<string, object?> ?? throw new FormatException("The JSON value is not an object.");

    /// <summary>
    /// Canonical serialization (RFC 8785 after rounding every non-integer number to six
    /// decimals, round half to even on the exact binary value).
    /// </summary>
    public static string Canonical(object? value)
    {
        var sb = new StringBuilder();
        Write(sb, value, round: true);
        return sb.ToString();
    }

    /// <summary>UTF-8 bytes of <see cref="Canonical(object?)"/> (what gets hashed).</summary>
    public static byte[] CanonicalUtf8(object? value) => Utf8.GetBytes(Canonical(value));

    /// <summary>
    /// Compact serialization with sorted keys and shortest round-trip numbers, without
    /// rounding. Writers use it to store JSON columns.
    /// </summary>
    public static string Compact(object? value)
    {
        var sb = new StringBuilder();
        Write(sb, value, round: false);
        return sb.ToString();
    }

    internal static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: false);

    /// <summary>
    /// Rounds to six decimals, half to even, on the exact binary value of <paramref name="x"/>
    /// (like Python's <c>round(x, 6)</c>); −0 becomes 0.
    /// </summary>
    public static double Round6(double x) => RoundDecimals(x, 6);

    /// <summary>Rounds to <paramref name="decimals"/> decimals, half to even on the exact binary value.</summary>
    internal static double RoundDecimals(double x, int decimals)
    {
        if (double.IsNaN(x) || double.IsInfinity(x) || x == 0)
        {
            return x == 0 ? 0.0 : x;
        }
        if (Math.Floor(x) == x)
        {
            return x;
        }
        long bits = BitConverter.DoubleToInt64Bits(x);
        bool negative = bits < 0;
        int exponent = (int)((bits >> 52) & 0x7FF);
        long mantissa = bits & 0xFFFFFFFFFFFFFL;
        if (exponent == 0)
        {
            exponent = 1;
        }
        else
        {
            mantissa |= 1L << 52;
        }
        exponent -= 1075;
        int shift = -exponent;
        var scaled = new BigInteger(mantissa) * BigInteger.Pow(10, decimals);
        var q = scaled >> shift;
        var remainder = scaled - (q << shift);
        int cmp = (remainder << 1).CompareTo(BigInteger.One << shift);
        if (cmp > 0 || (cmp == 0 && !q.IsEven))
        {
            q += 1;
        }
        if (q.IsZero)
        {
            return 0.0;
        }
        double r = double.Parse(q.ToString(CultureInfo.InvariantCulture) + "E-" + decimals.ToString(CultureInfo.InvariantCulture),
            NumberStyles.Float, CultureInfo.InvariantCulture);
        return negative ? -r : r;
    }

    /// <summary>
    /// Writes a number in the ECMAScript <c>Number::toString</c> form used by RFC 8785
    /// (<c>1</c>, <c>0.000001</c>, <c>1e-7</c>, <c>1e+21</c>). Non-finite numbers are written as <c>null</c>.
    /// </summary>
    public static string FormatNumber(double x)
    {
        if (double.IsNaN(x) || double.IsInfinity(x))
        {
            return "null";
        }
        if (x == 0)
        {
            return "0";
        }
        string sign = x < 0 ? "-" : "";
        string r = Math.Abs(x).ToString("R", CultureInfo.InvariantCulture);
        int ePos = r.IndexOfAny(['E', 'e']);
        string mant = ePos >= 0 ? r[..ePos] : r;
        int exp10 = ePos >= 0 ? int.Parse(r[(ePos + 1)..], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture) : 0;
        int dot = mant.IndexOf('.');
        string intPart = dot >= 0 ? mant[..dot] : mant;
        string frac = dot >= 0 ? mant[(dot + 1)..] : "";
        string digits = intPart + frac;
        int point = intPart.Length + exp10;
        int lead = 0;
        while (lead < digits.Length - 1 && digits[lead] == '0')
        {
            lead++;
        }
        digits = digits[lead..];
        point -= lead;
        digits = digits.TrimEnd('0');
        if (digits.Length == 0)
        {
            return "0";
        }
        int k = digits.Length;
        int n = point;
        string s;
        if (k <= n && n <= 21)
        {
            s = digits + new string('0', n - k);
        }
        else if (0 < n && n <= 21)
        {
            s = digits[..n] + "." + digits[n..];
        }
        else if (-6 < n && n <= 0)
        {
            s = "0." + new string('0', -n) + digits;
        }
        else
        {
            int e = n - 1;
            string es = (e > 0 ? "+" : "-") + Math.Abs(e).ToString(CultureInfo.InvariantCulture);
            s = k == 1 ? digits + "e" + es : digits[0] + "." + digits[1..] + "e" + es;
        }
        return sign + s;
    }

    /// <summary>
    /// Converts .NET values (ints, floats, dictionaries, enumerables, anchors) into the
    /// plain value tree. Values already in tree form are copied deeply.
    /// </summary>
    public static object? ToTree(object? value)
    {
        switch (value)
        {
            case null:
            case DBNull:
                return null;
            case bool b:
                return b;
            case string s:
                return s;
            case long l:
                return l;
            case int i:
                return (long)i;
            case short sh:
                return (long)sh;
            case sbyte sb:
                return (long)sb;
            case byte by:
                return (long)by;
            case ushort us:
                return (long)us;
            case uint ui:
                return (long)ui;
            case ulong ul:
                return ul <= long.MaxValue ? (long)ul : (double)ul;
            case double d:
                return d;
            case float f:
                return (double)f;
            case decimal m:
                return decimal.Truncate(m) == m && m >= long.MinValue && m <= long.MaxValue ? (long)m : (double)m;
            case Half h:
                return (double)h;
            case Anchor a:
                return ToTree(a.Members);
            case IDictionary<string, object?> dict:
            {
                var o = new Dictionary<string, object?>(dict.Count, StringComparer.Ordinal);
                foreach (var kv in dict)
                {
                    o[kv.Key] = ToTree(kv.Value);
                }
                return o;
            }
            case IReadOnlyDictionary<string, object?> rdict:
            {
                var o = new Dictionary<string, object?>(rdict.Count, StringComparer.Ordinal);
                foreach (var kv in rdict)
                {
                    o[kv.Key] = ToTree(kv.Value);
                }
                return o;
            }
            case IDictionary ndict:
            {
                var o = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (DictionaryEntry kv in ndict)
                {
                    o[Convert.ToString(kv.Key, CultureInfo.InvariantCulture) ?? ""] = ToTree(kv.Value);
                }
                return o;
            }
            case IEnumerable e:
            {
                var l = new List<object?>();
                foreach (var x in e)
                {
                    l.Add(ToTree(x));
                }
                return l;
            }
        }
        throw new ArgumentException($"Value of type {value.GetType()} cannot be represented as JSON.", nameof(value));
    }

    // ------------------------------------------------------------------
    // Serialization
    // ------------------------------------------------------------------

    private static void Write(StringBuilder sb, object? v, bool round)
    {
        switch (v)
        {
            case null:
            case DBNull:
                sb.Append("null");
                return;
            case bool b:
                sb.Append(b ? "true" : "false");
                return;
            case string s:
                WriteString(sb, s);
                return;
            case long l:
                sb.Append(l.ToString(CultureInfo.InvariantCulture));
                return;
            case int i:
                sb.Append(i.ToString(CultureInfo.InvariantCulture));
                return;
            case short or sbyte or byte or ushort or uint:
                sb.Append(Convert.ToInt64(v, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture));
                return;
            case ulong ul:
                sb.Append(ul.ToString(CultureInfo.InvariantCulture));
                return;
            case double d:
                sb.Append(FormatNumber(round ? Round6(d) : d));
                return;
            case float f:
                sb.Append(FormatNumber(round ? Round6(f) : f));
                return;
            case decimal m:
                Write(sb, ToTree(m), round);
                return;
            case Half h:
                sb.Append(FormatNumber(round ? Round6((double)h) : (double)h));
                return;
            case Anchor a:
                Write(sb, a.Members, round);
                return;
            case IDictionary<string, object?> dict:
                WriteObject(sb, dict.Keys, k => dict[k], round);
                return;
            case IReadOnlyDictionary<string, object?> rdict:
                WriteObject(sb, rdict.Keys, k => rdict[k], round);
                return;
            case IDictionary ndict:
                Write(sb, ToTree(ndict), round);
                return;
            case IEnumerable e:
            {
                sb.Append('[');
                bool first = true;
                foreach (var x in e)
                {
                    if (!first)
                    {
                        sb.Append(',');
                    }
                    first = false;
                    Write(sb, x, round);
                }
                sb.Append(']');
                return;
            }
        }
        throw new ArgumentException($"Value of type {v.GetType()} cannot be serialized as JSON.");
    }

    private static void WriteObject(StringBuilder sb, IEnumerable<string> keys, Func<string, object?> get, bool round)
    {
        var sorted = keys.ToArray();
        Array.Sort(sorted, StringComparer.Ordinal); // UTF-16 code units (RFC 8785)
        sb.Append('{');
        for (int i = 0; i < sorted.Length; i++)
        {
            if (i > 0)
            {
                sb.Append(',');
            }
            WriteString(sb, sorted[i]);
            sb.Append(':');
            Write(sb, get(sorted[i]), round);
        }
        sb.Append('}');
    }

    private static void WriteString(StringBuilder sb, string s)
    {
        sb.Append('"');
        foreach (char c in s)
        {
            switch (c)
            {
                case '"':
                    sb.Append("\\\"");
                    break;
                case '\\':
                    sb.Append("\\\\");
                    break;
                case '\b':
                    sb.Append("\\b");
                    break;
                case '\f':
                    sb.Append("\\f");
                    break;
                case '\n':
                    sb.Append("\\n");
                    break;
                case '\r':
                    sb.Append("\\r");
                    break;
                case '\t':
                    sb.Append("\\t");
                    break;
                default:
                    if (c < 0x20)
                    {
                        sb.Append("\\u00").Append(((int)c).ToString("x2", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        sb.Append(c);
                    }
                    break;
            }
        }
        sb.Append('"');
    }

    // ------------------------------------------------------------------
    // Comparison
    // ------------------------------------------------------------------

    /// <summary>
    /// Structural equality of two value trees: numbers compare as doubles after rounding
    /// to six decimals (so <c>1</c> and <c>1.0</c> are equal), object key order is irrelevant.
    /// </summary>
    public static bool JsonEquals(object? a, object? b) => Diff(a, b) is null;

    /// <summary>The first difference between two value trees as <c>path: a != b</c>, or <c>null</c> when equal.</summary>
    public static string? Diff(object? a, object? b) => Diff(ToTree(a), ToTree(b), "");

    private static string? Diff(object? a, object? b, string path)
    {
        string where = path.Length == 0 ? "/" : path;
        if (a is long or double)
        {
            if (b is not (long or double) || Round6(ToDouble(a)) != Round6(ToDouble(b)))
            {
                return $"{where}: {Short(a)} != {Short(b)}";
            }
            return null;
        }
        switch (a)
        {
            case null:
                return b is null ? null : $"{where}: null != {Short(b)}";
            case bool ba:
                return b is bool bb && bb == ba ? null : $"{where}: {Short(a)} != {Short(b)}";
            case string sa:
                return b is string sb && string.Equals(sa, sb, StringComparison.Ordinal) ? null : $"{where}: {Short(a)} != {Short(b)}";
            case List<object?> la:
            {
                if (b is not List<object?> lb)
                {
                    return $"{where}: array != {Short(b)}";
                }
                if (la.Count != lb.Count)
                {
                    return $"{where}: length {la.Count} != {lb.Count}";
                }
                for (int i = 0; i < la.Count; i++)
                {
                    var d = Diff(la[i], lb[i], path + "/" + i.ToString(CultureInfo.InvariantCulture));
                    if (d is not null)
                    {
                        return d;
                    }
                }
                return null;
            }
            case Dictionary<string, object?> oa:
            {
                if (b is not Dictionary<string, object?> ob)
                {
                    return $"{where}: object != {Short(b)}";
                }
                var keys = new SortedSet<string>(oa.Keys, StringComparer.Ordinal);
                keys.UnionWith(ob.Keys);
                foreach (var k in keys)
                {
                    bool ha = oa.TryGetValue(k, out var va);
                    bool hb = ob.TryGetValue(k, out var vb);
                    if (!ha)
                    {
                        return $"{path}/{k}: missing != {Short(vb)}";
                    }
                    if (!hb)
                    {
                        return $"{path}/{k}: {Short(va)} != missing";
                    }
                    var d = Diff(va, vb, path + "/" + k);
                    if (d is not null)
                    {
                        return d;
                    }
                }
                return null;
            }
        }
        return Canonical(a) == Canonical(b) ? null : $"{where}: {Short(a)} != {Short(b)}";
    }

    private static string Short(object? v)
    {
        string s = Canonical(v);
        return s.Length > 200 ? s[..200] + "…" : s;
    }

    internal static double ToDouble(object? v) => v switch
    {
        long l => l,
        double d => d,
        int i => i,
        float f => f,
        _ => double.NaN,
    };

    // ------------------------------------------------------------------
    // Parser
    // ------------------------------------------------------------------

    private sealed class Parser(string text)
    {
        private readonly string _s = text;
        private int _i;

        public bool AtEnd => _i >= _s.Length;

        public int Position => _i;

        public void SkipWhitespace()
        {
            while (_i < _s.Length && _s[_i] is ' ' or '\t' or '\n' or '\r')
            {
                _i++;
            }
        }

        private FormatException Error(string what) => new($"Invalid JSON: {what} at offset {_i}.");

        public object? ParseValue(int depth)
        {
            if (depth > MaxDepth)
            {
                throw Error("nesting too deep");
            }
            if (_i >= _s.Length)
            {
                throw Error("unexpected end");
            }
            char c = _s[_i];
            switch (c)
            {
                case '{':
                    return ParseObject(depth);
                case '[':
                    return ParseArray(depth);
                case '"':
                    return ParseString();
                case 't':
                    Expect("true");
                    return true;
                case 'f':
                    Expect("false");
                    return false;
                case 'n':
                    Expect("null");
                    return null;
                default:
                    if (c == '-' || (c >= '0' && c <= '9'))
                    {
                        return ParseNumber();
                    }
                    throw Error($"unexpected character '{c}'");
            }
        }

        private void Expect(string word)
        {
            if (string.CompareOrdinal(_s, _i, word, 0, word.Length) != 0)
            {
                throw Error($"expected {word}");
            }
            _i += word.Length;
        }

        private Dictionary<string, object?> ParseObject(int depth)
        {
            var o = new Dictionary<string, object?>(StringComparer.Ordinal);
            _i++; // {
            SkipWhitespace();
            if (_i < _s.Length && _s[_i] == '}')
            {
                _i++;
                return o;
            }
            while (true)
            {
                SkipWhitespace();
                if (_i >= _s.Length || _s[_i] != '"')
                {
                    throw Error("expected a string key");
                }
                string key = ParseString();
                SkipWhitespace();
                if (_i >= _s.Length || _s[_i] != ':')
                {
                    throw Error("expected ':'");
                }
                _i++;
                SkipWhitespace();
                o[key] = ParseValue(depth + 1);
                SkipWhitespace();
                if (_i >= _s.Length)
                {
                    throw Error("unexpected end in object");
                }
                if (_s[_i] == ',')
                {
                    _i++;
                    continue;
                }
                if (_s[_i] == '}')
                {
                    _i++;
                    return o;
                }
                throw Error("expected ',' or '}'");
            }
        }

        private List<object?> ParseArray(int depth)
        {
            var l = new List<object?>();
            _i++; // [
            SkipWhitespace();
            if (_i < _s.Length && _s[_i] == ']')
            {
                _i++;
                return l;
            }
            while (true)
            {
                SkipWhitespace();
                l.Add(ParseValue(depth + 1));
                SkipWhitespace();
                if (_i >= _s.Length)
                {
                    throw Error("unexpected end in array");
                }
                if (_s[_i] == ',')
                {
                    _i++;
                    continue;
                }
                if (_s[_i] == ']')
                {
                    _i++;
                    return l;
                }
                throw Error("expected ',' or ']'");
            }
        }

        private string ParseString()
        {
            _i++; // opening quote
            var sb = new StringBuilder();
            while (true)
            {
                if (_i >= _s.Length)
                {
                    throw Error("unterminated string");
                }
                char c = _s[_i++];
                if (c == '"')
                {
                    return sb.ToString();
                }
                if (c < 0x20)
                {
                    throw Error("control character in string");
                }
                if (c != '\\')
                {
                    sb.Append(c);
                    continue;
                }
                if (_i >= _s.Length)
                {
                    throw Error("unterminated escape");
                }
                char e = _s[_i++];
                switch (e)
                {
                    case '"':
                        sb.Append('"');
                        break;
                    case '\\':
                        sb.Append('\\');
                        break;
                    case '/':
                        sb.Append('/');
                        break;
                    case 'b':
                        sb.Append('\b');
                        break;
                    case 'f':
                        sb.Append('\f');
                        break;
                    case 'n':
                        sb.Append('\n');
                        break;
                    case 'r':
                        sb.Append('\r');
                        break;
                    case 't':
                        sb.Append('\t');
                        break;
                    case 'u':
                        if (_i + 4 > _s.Length || !int.TryParse(_s.AsSpan(_i, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out int cp))
                        {
                            throw Error("bad \\u escape");
                        }
                        _i += 4;
                        sb.Append((char)cp);
                        break;
                    default:
                        throw Error($"bad escape \\{e}");
                }
            }
        }

        private object ParseNumber()
        {
            int start = _i;
            bool isInteger = true;
            if (_s[_i] == '-')
            {
                _i++;
            }
            if (_i >= _s.Length)
            {
                throw Error("bad number");
            }
            if (_s[_i] == '0')
            {
                _i++;
            }
            else if (_s[_i] >= '1' && _s[_i] <= '9')
            {
                while (_i < _s.Length && char.IsAsciiDigit(_s[_i]))
                {
                    _i++;
                }
            }
            else
            {
                throw Error("bad number");
            }
            if (_i < _s.Length && _s[_i] == '.')
            {
                isInteger = false;
                _i++;
                int digits = _i;
                while (_i < _s.Length && char.IsAsciiDigit(_s[_i]))
                {
                    _i++;
                }
                if (_i == digits)
                {
                    throw Error("bad fraction");
                }
            }
            if (_i < _s.Length && (_s[_i] == 'e' || _s[_i] == 'E'))
            {
                isInteger = false;
                _i++;
                if (_i < _s.Length && (_s[_i] == '+' || _s[_i] == '-'))
                {
                    _i++;
                }
                int digits = _i;
                while (_i < _s.Length && char.IsAsciiDigit(_s[_i]))
                {
                    _i++;
                }
                if (_i == digits)
                {
                    throw Error("bad exponent");
                }
            }
            var span = _s.AsSpan(start, _i - start);
            if (isInteger && long.TryParse(span, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out long l))
            {
                return l;
            }
            return double.Parse(span, NumberStyles.Float, CultureInfo.InvariantCulture);
        }
    }
}
