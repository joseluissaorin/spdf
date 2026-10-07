using System.Globalization;

namespace Spdf;

public sealed partial class SpdfFile
{
    /// <summary>Reciprocal rank fusion constant of the reference hybrid search.</summary>
    public const int RrfK = 10;

    /// <summary>The document reference used in anchor URIs: <c>sha256-&lt;hex&gt;</c>, or the document id.</summary>
    public string DocRef => _docRef ??= ReadDocRef();

    private string? _docRef;

    private string ReadDocRef()
    {
        if (!HasTable("documents"))
        {
            return "";
        }
        var rows = SqliteUtil.Rows(Connection,
            "SELECT " + Col("documents", "source_sha256") + ", " + Col("documents", "id") + " FROM " +
            SqliteUtil.QuoteIdent(Table("documents")) + " ORDER BY " + Col("documents", "id") + " LIMIT 1");
        if (rows.Count == 0)
        {
            return "";
        }
        if (rows[0][0] is string { Length: > 0 } sha)
        {
            return AnchorUri.DocRef(sha);
        }
        return rows[0][1] as string ?? "";
    }

    /// <summary>How a lexical query runs on this file (route and MATCH string).</summary>
    public LexicalPlan PlanLexical(LexicalQuery query)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (query.Match is null)
        {
            return new LexicalPlan("fts", null);
        }
        if (query.IsCjk)
        {
            bool trigram = !IsLegacy && _tables.Contains("fragments_fts_trigram");
            if (trigram && query.Terms.All(t => TextUtil.CodePointCount(t) >= 3))
            {
                return new LexicalPlan("trigram", query.Match);
            }
            return new LexicalPlan("substring", null);
        }
        return new LexicalPlan("fts", query.Match);
    }

    /// <summary>How a lexical query runs on this file (route and MATCH string).</summary>
    public LexicalPlan PlanLexical(string query) => PlanLexical(LexicalQuery.Compile(query));

    /// <summary>
    /// The reference lexical search (§8.1): FTS5 BM25 with weights 1, 0.5, 0.5, 1; CJK queries
    /// go to the trigram index or to a substring scan.
    /// </summary>
    public IReadOnlyList<SearchHit> SearchLexical(string query, int limit = 10)
    {
        if (limit <= 0)
        {
            limit = 10;
        }
        var lq = LexicalQuery.Compile(query);
        var plan = PlanLexical(lq);
        if (lq.Match is null)
        {
            return [];
        }
        List<(long N, double Score)> hits;
        switch (plan.Route)
        {
            case "trigram":
                hits = FtsQuery("fragments_fts_trigram", "bm25(\"fragments_fts_trigram\")", lq.Match, limit);
                break;
            case "substring":
                hits = SubstringQuery(lq, limit);
                break;
            default:
            {
                string fts = Table("fragments_fts");
                string weights = FtsColumnCount(fts) == 3 ? "1.0, 0.5, 0.5" : "1.0, 0.5, 0.5, 1.0";
                hits = FtsQuery(fts, "bm25(" + SqliteUtil.QuoteIdent(fts) + ", " + weights + ")", lq.Match, limit);
                break;
            }
        }
        return FragmentHits(hits, "lexical");
    }

    private int FtsColumnCount(string table)
    {
        var sql = SqliteUtil.Scalar(Connection, "SELECT sql FROM sqlite_master WHERE name = @p0", [table]) as string ?? "";
        return sql.Contains("search_text", StringComparison.Ordinal) || sql.Contains("texto_busqueda", StringComparison.Ordinal) ? 4 : 3;
    }

    private List<(long N, double Score)> FtsQuery(string table, string rank, string match, int limit)
    {
        string t = SqliteUtil.QuoteIdent(table);
        string sql = $"SELECT rowid, {rank} AS r FROM {t} WHERE {t} MATCH @p0 ORDER BY r, rowid LIMIT @p1";
        return SqliteUtil.Rows(Connection, sql, [match, (long)limit])
            .Select(r => ((long)r[0]!, -SpdfJson.ToDouble(r[1])))
            .ToList();
    }

    private List<(long N, double Score)> SubstringQuery(LexicalQuery lq, int limit)
    {
        string text = Col("fragments", "text");
        var args = new List<object?>();
        var parts = new List<string>();
        foreach (var term in lq.Terms)
        {
            parts.Add($"(instr({text}, @p{args.Count.ToString(CultureInfo.InvariantCulture)}) > 0)");
            args.Add(term);
        }
        string cond = lq.Phrases ? "hits = " + lq.Terms.Count.ToString(CultureInfo.InvariantCulture) : "hits > 0";
        string sql = $"SELECT n, hits FROM (SELECT {Col("fragments", "n")} AS n, {string.Join(" + ", parts)} AS hits FROM " +
                     $"{SqliteUtil.QuoteIdent(Table("fragments"))}) WHERE {cond} ORDER BY hits DESC, n LIMIT @p{args.Count.ToString(CultureInfo.InvariantCulture)}";
        args.Add((long)limit);
        return SqliteUtil.Rows(Connection, sql, args)
            .Select(r => ((long)r[0]!, SpdfJson.ToDouble(r[1])))
            .ToList();
    }

    private Anchor? AnchorValue(object? v)
    {
        var g = ParseJsonColumn(v);
        if (IsLegacy)
        {
            g = Legacy.MapAnchor(g);
        }
        return Anchor.FromTree(g);
    }

    private List<SearchHit> FragmentHits(List<(long N, double Score)> hits, string via)
    {
        var info = new Dictionary<long, (string Id, Anchor? Anchor, Anchor? End)>();
        if (hits.Count > 0)
        {
            var args = hits.Select(h => (object?)h.N).ToList();
            string inList = string.Join(", ", Enumerable.Range(0, args.Count).Select(i => "@p" + i.ToString(CultureInfo.InvariantCulture)));
            foreach (var r in QueryRows("fragments", ["n", "id", "anchor", "anchor_end"], "WHERE " + Col("fragments", "n") + " IN (" + inList + ")", args))
            {
                if (r["n"] is long n)
                {
                    info[n] = (AsText(r["id"]), AnchorValue(r["anchor"]), r["anchor_end"] is null ? null : AnchorValue(r["anchor_end"]));
                }
            }
        }
        string docRef = DocRef;
        var out_ = new List<SearchHit>(hits.Count);
        foreach (var (n, score) in hits)
        {
            info.TryGetValue(n, out var i);
            out_.Add(new SearchHit
            {
                Target = "fragment",
                Id = i.Id ?? "",
                Score = score,
                Via = [via],
                Anchor = i.Anchor,
                AnchorEnd = i.End,
                AnchorUri = i.Anchor is null ? "spdf:" + docRef : AnchorUri.Format(docRef, i.Anchor, i.End),
                Order = n,
            });
        }
        return out_;
    }

    /// <summary>
    /// Brute-force vector search (§8.2) over the vectors of a space and target (<c>fragment</c>,
    /// <c>unit</c> or <c>figure</c>): dot product for normalized spaces, cosine otherwise; the
    /// query vector is used as given.
    /// </summary>
    /// <exception cref="SpdfException">E031 if the space does not exist.</exception>
    /// <exception cref="ArgumentException">The query vector has the wrong length.</exception>
    public IReadOnlyList<SearchHit> SearchVector(IReadOnlyList<double> queryVector, string space, string target = "fragment", int limit = 10)
    {
        ArgumentNullException.ThrowIfNull(queryVector);
        if (limit <= 0)
        {
            limit = 10;
        }
        if (string.IsNullOrEmpty(target))
        {
            target = "fragment";
        }
        var sp = GetSpaces().FirstOrDefault(s => s.Id == space) ?? throw new SpdfException("E031", "unknown vector space", space);
        if (queryVector.Count != sp.Dims)
        {
            throw new ArgumentException($"query vector has {queryVector.Count} dimensions, space {space} has {sp.Dims}", nameof(queryVector));
        }
        string storedTarget = target;
        if (IsLegacy)
        {
            foreach (var (k, v) in Legacy.Targets)
            {
                if (v == target)
                {
                    storedTarget = k;
                }
            }
        }
        double qsum = 0;
        for (int i = 0; i < queryVector.Count; i++)
        {
            qsum += queryVector[i] * queryVector[i];
        }
        double qnorm = Math.Sqrt(qsum);
        var scored = new List<(string Id, double Score)>();
        var rows = QueryRows("vectors", ["id", "data"], "WHERE " + Col("vectors", "space") + " = @p0 AND " + Col("vectors", "target") + " = @p1", [space, storedTarget]);
        foreach (var r in rows)
        {
            var data = r["data"] as byte[] ?? [];
            var v = VectorCodec.Decode(data, sp.DType);
            double dot = 0;
            for (int i = 0; i < v.Length && i < queryVector.Count; i++)
            {
                dot += queryVector[i] * v[i];
            }
            double score = dot;
            if (!sp.Normalized)
            {
                double vsum = 0;
                foreach (double x in v)
                {
                    vsum += x * x;
                }
                double vn = Math.Sqrt(vsum);
                score = vn == 0 || qnorm == 0 ? 0 : dot / (qnorm * vn);
            }
            scored.Add((AsText(r["id"]), score));
        }
        var keys = new Dictionary<string, long>(StringComparer.Ordinal);
        if (target == "fragment")
        {
            foreach (var r in QueryRows("fragments", ["n", "id"]))
            {
                keys[AsText(r["id"])] = r["n"] as long? ?? 0;
            }
        }
        else if (target == "unit")
        {
            int i = 0;
            foreach (var r in QueryRows("units", ["id", "ord"], "ORDER BY " + Col("units", "ord") + ", " + Col("units", "id")))
            {
                i++;
                keys[AsText(r["id"])] = IsLegacy ? i : r["ord"] as long? ?? 0;
            }
        }
        scored.Sort((a, b) =>
        {
            int c = b.Score.CompareTo(a.Score);
            if (c != 0)
            {
                return c;
            }
            if (target != "figure")
            {
                c = keys.GetValueOrDefault(a.Id).CompareTo(keys.GetValueOrDefault(b.Id));
                if (c != 0)
                {
                    return c;
                }
            }
            return TextUtil.CompareCodePoints(a.Id, b.Id);
        });
        if (scored.Count > limit)
        {
            scored.RemoveRange(limit, scored.Count - limit);
        }
        if (target == "fragment")
        {
            return FragmentHits(scored.Select(s => (keys.GetValueOrDefault(s.Id), s.Score)).ToList(), "vector");
        }
        string t5 = target == "figure" ? "figures" : "units";
        string docRef = DocRef;
        var hits = new List<SearchHit>();
        foreach (var (id, score) in scored)
        {
            var anchorRows = QueryRows(t5, ["anchor"], "WHERE " + Col(t5, "id") + " = @p0", [id]);
            var a = anchorRows.Count > 0 ? AnchorValue(anchorRows[0]["anchor"]) : null;
            hits.Add(new SearchHit
            {
                Target = target,
                Id = id,
                Score = score,
                Via = ["vector"],
                Anchor = a,
                AnchorUri = a is null ? "spdf:" + docRef : AnchorUri.Format(docRef, a),
                Order = keys.GetValueOrDefault(id),
            });
        }
        return hits;
    }

    /// <summary>
    /// Hybrid search (§8.3): lexical and vector lists (fragments), each to depth
    /// <c>max(limit, 50)</c>, fused with reciprocal rank fusion (k = 10). Without a vector or
    /// space only the lexical list is used.
    /// </summary>
    public IReadOnlyList<SearchHit> SearchHybrid(string query, IReadOnlyList<double>? queryVector, string? space, int limit = 10)
    {
        if (limit <= 0)
        {
            limit = 10;
        }
        int depth = Math.Max(limit, 50);
        var lexical = SearchLexical(query, depth);
        IReadOnlyList<SearchHit> vector = queryVector is not null && !string.IsNullOrEmpty(space)
            ? SearchVector(queryVector, space, "fragment", depth)
            : [];
        return FuseRrf(lexical, vector, RrfK, limit);
    }

    /// <summary>Reciprocal rank fusion of a lexical and a vector list: score = Σ 1/(k + rank), rank from 1.</summary>
    public static IReadOnlyList<SearchHit> FuseRrf(IReadOnlyList<SearchHit> lexical, IReadOnlyList<SearchHit> vector, int k = RrfK, int limit = 10)
    {
        var acc = new Dictionary<string, (SearchHit Hit, double Score, List<string> Via)>(StringComparer.Ordinal);
        var order = new List<string>();
        void Add(IReadOnlyList<SearchHit> list, string via)
        {
            for (int i = 0; i < list.Count; i++)
            {
                var h = list[i];
                if (!acc.TryGetValue(h.Id, out var a))
                {
                    a = (h, 0.0, []);
                    order.Add(h.Id);
                }
                a.Score += 1.0 / (k + i + 1);
                a.Via.Add(via);
                acc[h.Id] = a;
            }
        }
        Add(lexical, "lexical");
        Add(vector, "vector");
        return order
            .Select(id => acc[id].Hit with { Score = acc[id].Score, Via = acc[id].Via })
            .OrderByDescending(h => h.Score)
            .ThenBy(h => h.Order)
            .Take(limit)
            .ToList();
    }
}
