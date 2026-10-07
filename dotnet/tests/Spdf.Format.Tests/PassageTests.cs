namespace Spdf.Tests;

/// <summary>Citations of passages, crossing fragments, W103 and locate on a synthetic file.</summary>
public sealed class PassageTests : IDisposable
{
    private readonly string _path = TestPaths.TempFile();

    public PassageTests()
    {
        using var w = SpdfWriter.Create(_path);
        w.SetDocument(new Document
        {
            Id = "hooke", Kind = "scanned_pdf", Mime = "application/pdf", SourceSha256 = new string('c', 64), Created = "2026-10-07T00:00:00Z",
            Metadata = new Dictionary<string, object?>
            {
                ["type"] = "book",
                ["title"] = "Micrographia",
                ["author"] = new List<object?> { new Dictionary<string, object?> { ["family"] = "Hooke", ["given"] = "Robert" } },
                ["issued"] = new Dictionary<string, object?> { ["date-parts"] = new List<object?> { new List<object?> { 1665L } } },
            },
        });
        w.AddUnit(new Unit { Id = "p1", Reader = "t", Text = "MICROGRAPHIA", Anchor = Anchor.Page(1, null, matter: "front") });
        w.AddUnit(new Unit { Id = "p2", Reader = "t", Text = "Alpha beta gamma delta.", Anchor = Anchor.Page(2, "1"), Image = "blob:p2.png" });
        w.AddUnit(new Unit { Id = "p3", Reader = "t", Text = "Epsilon zeta eta theta.", Anchor = Anchor.Page(3, "2") });
        w.AddUnit(new Unit { Id = "p4", Reader = "t", Text = "Schem. I.", Anchor = Anchor.Page(4, null, matter: "plate") });
        w.AddFragment(new Fragment
        {
            Id = "f1", Unit = "p2", Text = "beta gamma delta. Epsilon zeta",
            Anchor = Anchor.Page(2, "1").WithChars(6, 23), AnchorEnd = Anchor.Page(3, "2").WithChars(0, 12),
        });
        w.AddFragment(new Fragment
        {
            Id = "f2", Unit = "p3", Text = "eta theta. Schem. I.",
            Anchor = Anchor.Page(3, "2").WithChars(13, 23), AnchorEnd = Anchor.Page(4, null, matter: "plate").WithChars(0, 9),
        });
        w.Commit();
    }

    public void Dispose() => File.Delete(_path);

    [Fact]
    public void CitesThePassageByTheUnitItLiesIn()
    {
        using var f = SpdfFile.Open(_path);
        string doc = "spdf:sha256-" + new string('c', 64);
        var inStart = f.CitePassage("f1", "gamma", "en");
        Assert.Equal("(Hooke, 1665, p. 1)", inStart.Text);
        Assert.Equal(doc + "#p=2&f=1&char=11,16", inStart.Uri);
        var inEnd = f.CitePassage("f1", "zeta", "es");
        Assert.Equal("(Hooke, 1665, p. 2)", inEnd.Text);
        Assert.Equal(doc + "#p=3&f=2&char=8,12", inEnd.Uri);
        var across = f.CitePassage("f1", "delta. Epsilon", "en");
        Assert.Equal("(Hooke, 1665, pp. 1-2)", across.Text);
        Assert.Equal(doc + "#p=2&pe=3&f=1&fe=2", across.Uri);
        var intoPlate = f.CitePassage("f2", "theta. Schem", "en");
        Assert.Equal("(Hooke, 1665, p. 2)", intoPlate.Text);   // never "pp. 2-n. pag."
        Assert.Equal(doc + "#p=3&pe=4&f=2", intoPlate.Uri);
        Assert.Throws<ArgumentException>(() => f.CitePassage("f1", "omega"));
        Assert.Throws<KeyNotFoundException>(() => f.CitePassage("nope", "x"));
    }

    [Fact]
    public void PageRangesSkipEndsWithoutAFolio()
    {
        var md = new Dictionary<string, object?> { ["type"] = "book", ["title"] = "T" };
        Assert.Equal("(T, n.d., p. 211)", Citation.Cite(Anchor.Page(5, null), Anchor.Page(6, "211"), md, "en"));
        Assert.Equal("(T, s. f., p. 211)", Citation.Cite(Anchor.Page(5, "211"), Anchor.Page(6, null), md, "es"));
        Assert.Equal("(T, s. f., s. p.)", Citation.Cite(Anchor.Page(5, null), Anchor.Page(6, null), md, "es"));
    }

    [Fact]
    public void WarnsAboutFragmentsCrossingMatterOrFolio()
    {
        var r = SpdfValidator.Validate(_path);
        Assert.True(r.Valid, string.Join(",", r.ErrorCodes));
        var w103 = Assert.Single(r.Warnings);
        Assert.Equal("W103", w103.Code);
        Assert.Equal("fragments/f2", w103.Where);
        Assert.Equal("E040", Anchor.Parse("""{"type":"page","physical":1,"printed":null,"matter":1}""").Check()?.Code);
        Assert.Equal("plate", Anchor.Page(4, null, matter: "plate").Matter);
        Assert.Equal("body", Anchor.Page(4, null).Matter);
    }

    [Fact]
    public void LocatesFragmentsByStartAndEndAnchors()
    {
        using var f = SpdfFile.Open(_path);
        string doc = "spdf:sha256-" + new string('c', 64);
        var page = f.Locate(doc + "#p=3");
        Assert.Equal(["p3"], page.Units);
        Assert.Equal(["f1", "f2"], page.Fragments);
        Assert.Equal(["f1"], f.Locate(doc + "#p=3&char=0,5").Fragments);      // char refers to p3: f1 ends there
        Assert.Equal(["f2"], f.Locate(doc + "#p=3&char=15,16").Fragments);
        Assert.Equal(["p2"], f.Locate(doc + "#f=1").Units);
        Assert.Equal(["p2"], f.Locate("https://example.org/hooke.spdf#p=2").Units);
        Assert.False(f.Locate("spdf:sha256-" + new string('d', 64) + "#p=2").Document);
        Assert.Equal("""{"char":null,"document":true,"fragments":[],"units":[],"xywh":null}""",
            SpdfJson.Canonical(f.Locate("https://example.org/hooke.spdf").ToTree()));
        Assert.Throws<FormatException>(() => f.Locate("spdf:x#p=0"));
    }

    [Fact]
    public void StructuralExportsCarryFoliosWithoutInventingThem()
    {
        using var f = SpdfFile.Open(_path);
        Assert.Equal("""{"pages":[{"n":null},{"n":"1"},{"n":"2"},{"n":null}]}""", SpdfJson.Canonical(f.ExportStructure(StructureFormat.Tei)));
        Assert.Equal("""{"pages":[{"physical":1,"printed":null},{"physical":2,"printed":"1"},{"physical":3,"printed":"2"},{"physical":4,"printed":null}]}""",
            SpdfJson.Canonical(f.ExportStructure(StructureFormat.Alto)));
        var manifest = SpdfJson.ParseObject(f.ExportIiif(new IiifOptions { Base = "https://example.org/h", ImageUrl = r => "https://example.org/img/" + r[5..] }));
        Assert.Equal("https://example.org/h/manifest", manifest["id"]);
        var canvases = (List<object?>)manifest["items"]!;
        Assert.Equal(4, canvases.Count);
        Assert.False(((Dictionary<string, object?>)canvases[0]!).ContainsKey("label"));
        Assert.Contains("https://example.org/img/p2.png", SpdfJson.Compact(canvases[1]), StringComparison.Ordinal);
        Assert.Contains("<pb n=\"1\" facs=\"blob:p2.png\" />", f.ExportTei(), StringComparison.Ordinal);
        Assert.Contains("<String CONTENT=\"gamma\" />", f.ExportAlto(), StringComparison.Ordinal);
    }
}
