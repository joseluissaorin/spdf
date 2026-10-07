namespace Spdf.Tests;

public class AnchorAndCitationTests
{
    private const string Doc = "sha256-3f2a000000000000000000000000000000000000000000000000000000000000";

    [Fact]
    public void FormatsAndParsesPageAnchors()
    {
        var a = Anchor.Page(29, "21").WithChars(118, 301);
        string uri = AnchorUri.Format(Doc, a);
        Assert.Equal(Doc.Insert(0, "spdf:") + "#p=29&f=21&char=118,301", uri);
        var parsed = AnchorUri.Parse(uri);
        Assert.Equal(Doc, parsed.DocRef);
        Assert.Equal(29, parsed.Locator.P);
        Assert.Equal("21", parsed.Locator.F);
        Assert.Equal(uri, AnchorUri.Format(parsed.DocRef, parsed.Locator));
    }

    [Fact]
    public void EncodesFoliosPathsAndRegions()
    {
        var a = Anchor.Section(["Capítulo 3", "a/b"], paragraph: 4).WithRegion(new Region(0.125, 0.5, 0.25, 0.1));
        Assert.Equal("spdf:doc%20id#s=Cap%C3%ADtulo%203/a%2Fb&para=4&xywh=percent:12.5,50,25,10", AnchorUri.Format("doc id", a));
        Assert.Equal("spdf:" + Doc + "#t=4160,4175.5", AnchorUri.Format(Doc, Anchor.Time(4160, 4175.5)));
    }

    [Theory]
    [InlineData("http://x")]
    [InlineData("spdf:#p=1")]
    [InlineData("spdf:x#p=0")]
    [InlineData("spdf:x#p=1&p=2")]
    [InlineData("spdf:x#char=5,2")]
    [InlineData("spdf:x#xywh=1,2,3,4")]
    [InlineData("spdf:x#f=%C3")]
    [InlineData("spdf:x#t=5,4")]
    public void RejectsMalformedUris(string uri) => Assert.False(AnchorUri.TryParse(uri, out _));

    [Fact]
    public void ParsesNptClockTimes()
    {
        var p = AnchorUri.Parse("spdf:x#t=npt:1:09:20,1:10:00.5&zz=ignored");
        Assert.Equal([4160.0, 4200.5], p.Locator.T!);
    }

    [Fact]
    public void ChecksAnchors()
    {
        Assert.Null(Anchor.Page(1, null).Check());
        Assert.Null(Anchor.Parse("{\"type\":\"page\",\"physical\":10.0,\"printed\":null}").Check());
        Assert.Equal("E040", Anchor.Parse("{\"type\":\"page\",\"physical\":0,\"printed\":null}").Check()?.Code);
        Assert.Equal("E041", Anchor.Parse("{\"type\":\"scroll\"}").Check()?.Code);
        Assert.Equal("E042", Anchor.Page(1, "1").WithChars(0, 5).Check("abc")?.Code);
        Assert.Null(Anchor.Page(1, "1").WithChars(0, 3).Check("a😀c"));
    }

    [Fact]
    public void CitesInSpanishAndEnglish()
    {
        var md = new Dictionary<string, object?>
        {
            ["type"] = "book",
            ["title"] = "Arte nuevo de hacer comedias",
            ["author"] = new List<object?>
            {
                new Dictionary<string, object?> { ["family"] = "Vega", ["non-dropping-particle"] = "de", ["given"] = "Lope" },
                new Dictionary<string, object?> { ["family"] = "Iglesias" },
            },
            ["issued"] = new Dictionary<string, object?> { ["date-parts"] = new List<object?> { new List<object?> { 1609L } } },
        };
        Assert.Equal("(de Vega e Iglesias, 1609, p. [21])", Citation.Cite(Anchor.Page(29, "21", source: "inferred"), null, md, "es"));
        Assert.Equal("(de Vega and Iglesias, 1609, pp. 21-22)", Citation.Cite(Anchor.Page(29, "21"), Anchor.Page(30, "22"), md, "en-GB"));
        Assert.Equal("(de Vega e Iglesias, 1609, 1:09:20-1:10:05)", Citation.Cite(Anchor.Time(4160.9, 4170), Anchor.Time(4200, 4205.99), md, "es"));
        var undated = new Dictionary<string, object?> { ["type"] = "book", ["title"] = "Politeia: a dialogue" };
        Assert.Equal("(Politeia, n.d., 514a)", Citation.Cite(Anchor.Canonical("stephanus", "514a"), null, undated, "fr"));
        Assert.Equal("(Politeia, s. f., s. p.)", Citation.Cite(Anchor.Page(3, null), null, undated, "es"));
    }

    [Fact]
    public void CompilesLexicalQueries()
    {
        var q = LexicalQuery.Compile("Straße «lugar de la Mancha» “otro”");
        Assert.True(q.Phrases);
        Assert.Equal("\"lugar de la Mancha\" AND \"otro\"", q.Match);
        var w = LexicalQuery.Compile("Hidalgo hidalgo HIDALGÓ, ﬁn");
        Assert.Equal("\"Hidalgo\" OR \"ﬁn\"", w.Match);
        Assert.True(LexicalQuery.Compile("學而").IsCjk);
        Assert.True(LexicalQuery.Compile("𠀀").IsCjk);
        Assert.Null(LexicalQuery.Compile(" «» ,.").Match);
    }
}
