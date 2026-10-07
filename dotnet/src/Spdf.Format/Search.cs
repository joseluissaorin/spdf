using System.Text;

namespace Spdf;

/// <summary>A search result (specification §8).</summary>
public sealed record SearchHit
{
    /// <summary>What was found: <c>fragment</c>, <c>unit</c> or <c>figure</c>.</summary>
    public required string Target { get; init; }

    /// <summary>Id of the fragment, unit or figure.</summary>
    public required string Id { get; init; }

    /// <summary>The fragment id, for fragment results.</summary>
    public string? FragmentId => Target == "fragment" ? Id : null;

    /// <summary>The unit id, for unit results.</summary>
    public string? UnitId => Target == "unit" ? Id : null;

    /// <summary>The figure id, for figure results.</summary>
    public string? FigureId => Target == "figure" ? Id : null;

    /// <summary>Score (higher is better).</summary>
    public double Score { get; init; }

    /// <summary>The lists that found it, in the order <c>lexical</c>, <c>vector</c>.</summary>
    public IReadOnlyList<string> Via { get; init; } = [];

    /// <summary>Anchor of the result.</summary>
    public Anchor? Anchor { get; init; }

    /// <summary>End anchor, if the fragment crosses units.</summary>
    public Anchor? AnchorEnd { get; init; }

    /// <summary>Canonical anchor URI.</summary>
    public required string AnchorUri { get; init; }

    /// <summary>Tie-break key: fragment <c>n</c> or unit <c>ord</c>.</summary>
    public long Order { get; init; }

    /// <summary>
    /// The result item of the specification as a JSON value tree: <c>fragment_id</c>,
    /// <c>unit_id</c> or <c>figure_id</c>, <c>score</c>, <c>via</c>, <c>anchor</c>, <c>anchor_uri</c>.
    /// </summary>
    public Dictionary<string, object?> ToTree()
    {
        var m = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["score"] = Score,
            ["via"] = Via.Cast<object?>().ToList(),
            ["anchor"] = Anchor?.Members,
            ["anchor_uri"] = AnchorUri,
        };
        if (AnchorEnd is not null)
        {
            m["anchor_end"] = AnchorEnd.Members;
        }
        m[Target + "_id"] = Id;
        return m;
    }
}

/// <summary>How a lexical query runs on a file: the route and the FTS5 MATCH string.</summary>
/// <param name="Route"><c>fts</c>, <c>trigram</c> or <c>substring</c>.</param>
/// <param name="Match">The MATCH string, or <c>null</c> (substring route, or no terms).</param>
public sealed record LexicalPlan(string Route, string? Match);

/// <summary>A compiled lexical query (specification §8.1, steps 1 to 5).</summary>
public sealed record LexicalQuery
{
    private static readonly Dictionary<int, int[]> PhraseClosers = new()
    {
        ['"'] = ['"'],
        ['“'] = ['”'],
        ['«'] = ['»'],
        ['„'] = ['“', '”'],
    };

    private static readonly (int From, int To)[] CjkRanges =
    [
        (0x2E80, 0x2FDF), (0x3040, 0x30FF), (0x3100, 0x312F), (0x3130, 0x318F), (0x31A0, 0x31FF),
        (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xA960, 0xA97F), (0xAC00, 0xD7AF), (0xF900, 0xFAFF),
        (0xFF66, 0xFF9F), (0x20000, 0x3FFFF),
    ];

    /// <summary>The query after NFC normalization.</summary>
    public required string Text { get; init; }

    /// <summary>Terms as written (NFC, no case folding).</summary>
    public required IReadOnlyList<string> Terms { get; init; }

    /// <summary>The terms are phrases (joined with AND); otherwise words (joined with OR).</summary>
    public bool Phrases { get; init; }

    /// <summary>The FTS5 MATCH expression, or <c>null</c> when there are no terms.</summary>
    public string? Match { get; init; }

    /// <summary>The query contains Chinese, Japanese or Korean characters (CJK route).</summary>
    public bool IsCjk { get; init; }

    /// <summary>Compiles a user query.</summary>
    public static LexicalQuery Compile(string query)
    {
        ArgumentNullException.ThrowIfNull(query);
        string q = TextUtil.Nfc(query);
        var cps = TextUtil.CodePoints(q);
        var phrases = new List<string>();
        var loose = new List<int>();
        for (int i = 0; i < cps.Count; i++)
        {
            int c = cps[i];
            if (!PhraseClosers.TryGetValue(c, out var closers))
            {
                loose.Add(c);
                continue;
            }
            int end = -1;
            for (int j = i + 1; j < cps.Count; j++)
            {
                if (Array.IndexOf(closers, cps[j]) >= 0)
                {
                    end = j;
                    break;
                }
            }
            loose.Add(' ');
            if (end < 0)
            {
                continue;
            }
            var words = Words(cps.GetRange(i + 1, end - i - 1));
            if (words.Count > 0)
            {
                phrases.Add(string.Join(" ", words));
            }
            i = end;
        }
        bool isPhrase = phrases.Count > 0;
        var terms = isPhrase ? phrases : Words(loose);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var dedup = new List<string>();
        foreach (var t in terms)
        {
            if (seen.Add(DedupKey(t)))
            {
                dedup.Add(t);
            }
        }
        string? match = dedup.Count == 0
            ? null
            : string.Join(isPhrase ? " AND " : " OR ", dedup.Select(t => "\"" + t.Replace("\"", "\"\"", StringComparison.Ordinal) + "\""));
        return new LexicalQuery
        {
            Text = q,
            Terms = dedup,
            Phrases = isPhrase,
            Match = match,
            IsCjk = cps.Any(cp => CjkRanges.Any(r => cp >= r.From && cp <= r.To)),
        };
    }

    private static List<string> Words(List<int> cps)
    {
        var out_ = new List<string>();
        var cur = new StringBuilder();
        foreach (int cp in cps)
        {
            if (TextUtil.IsWordChar(cp))
            {
                TextUtil.AppendCodePoint(cur, cp);
            }
            else if (cur.Length > 0)
            {
                out_.Add(cur.ToString());
                cur.Clear();
            }
        }
        if (cur.Length > 0)
        {
            out_.Add(cur.ToString());
        }
        return out_;
    }

    /// <summary>Deduplication key: lower(remove_Mn(NFD(term))).</summary>
    internal static string DedupKey(string term)
    {
        var sb = new StringBuilder();
        foreach (int cp in TextUtil.CodePoints(TextUtil.Nfd(term)))
        {
            if (TextUtil.Category(cp) != System.Globalization.UnicodeCategory.NonSpacingMark)
            {
                TextUtil.AppendCodePoint(sb, cp);
            }
        }
        return sb.ToString().ToLowerInvariant();
    }
}
