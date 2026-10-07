namespace Spdf.Tests;

public class ExportTests
{
    [Theory]
    [InlineData("files/quijote.spdf", "cervantessaavedra1605")]
    [InlineData("files/lazarillo.spdf", "lazarillo1554")]
    [InlineData("files/apolo11.spdf", "nationalaeronauticsandspaceadministration1969")]
    [InlineData("files/lunyu.spdf", "anonnd")]
    [InlineData("files/micrographia.spdf", "hooke1665")]
    public void CitationKeysFollowRfc0002(string file, string key)
    {
        using var f = SpdfFile.Open(TestPaths.Conformance(file));
        Assert.Equal(key, f.CitationKey());
        Assert.Equal(key, f.ExportBibTeXEntry().Key);
        var csl = (List<object?>)SpdfJson.Parse(f.ExportCslJson())!;
        var item = Assert.IsType<Dictionary<string, object?>>(Assert.Single(csl));
        Assert.Equal(key, item["id"]);
        Assert.False(item.ContainsKey("spdf"));
    }

    [Fact]
    public void BibTeXEntryHasTheSpecifiedFieldsInOrder()
    {
        using var f = SpdfFile.Open(TestPaths.Conformance("files/quijote.spdf"));
        var e = f.ExportBibTeXEntry();
        Assert.Equal("book", e.EntryType);
        Assert.Equal(["author", "title", "year", "publisher", "address", "language", "note"], e.Fields.Select(x => x.Key));
        var fields = e.Fields.ToDictionary(x => x.Key, x => x.Value);
        Assert.Equal("Cervantes Saavedra, Miguel de", fields["author"]);
        Assert.Equal("{El} ingenioso hidalgo don {Quijote} de la {Mancha}", fields["title"]);
        Assert.Equal("1605", fields["year"]);
        Assert.StartsWith("@book{cervantessaavedra1605,\n  author = {Cervantes Saavedra, Miguel de},\n  title = {{El} ingenioso", f.ExportBibTeX(), StringComparison.Ordinal);

        using var m = SpdfFile.Open(TestPaths.Conformance("files/micrographia.spdf"));
        Assert.StartsWith("{Micrographia:} or some ", m.ExportBibTeXEntry().Fields.Single(x => x.Key == "title").Value, StringComparison.Ordinal);
    }

    [Fact]
    public void NamesEscapingTypesAndCollisions()
    {
        var md = new Dictionary<string, object?>
        {
            ["type"] = "article-journal",
            ["title"] = "On {braces} and \\ backslashes",
            ["author"] = new List<object?>
            {
                new Dictionary<string, object?> { ["literal"] = "NASA" },
                new Dictionary<string, object?> { ["family"] = "Vega", ["non-dropping-particle"] = "de", ["given"] = "Lope" },
                new Dictionary<string, object?> { ["given"] = "Platón" },
            },
            ["container-title"] = "Revista de Filología Española",
            ["page"] = "12-34",
            ["volume"] = 7L,
            ["translator"] = new List<object?> { new Dictionary<string, object?> { ["family"] = "X", ["given"] = "Y" } },
            ["abstract"] = "dropped",
            ["issued"] = new Dictionary<string, object?> { ["date-parts"] = new List<object?> { new List<object?> { "0350" } } },
        };
        var e = BibliographyExport.BibTeXEntry(md);
        Assert.Equal("article", e.EntryType);
        Assert.Equal("nasa350", e.Key);
        var fields = e.Fields.ToDictionary(x => x.Key, x => x.Value);
        Assert.Equal("{NASA} and de Vega, Lope and {Platón}", fields["author"]);
        Assert.Equal("{On} \\{braces\\} and \\textbackslash{} backslashes", fields["title"]);
        Assert.Equal("{Revista} de {Filología} {Española}", fields["journal"]);
        Assert.Equal("12-34", fields["pages"]);
        Assert.Equal("7", fields["volume"]);
        Assert.False(fields.ContainsKey("translator"));
        Assert.False(fields.ContainsKey("abstract"));
        Assert.Equal("misc", BibliographyExport.BibTeXEntry(new Dictionary<string, object?> { ["type"] = "webpage" }).EntryType);
        var plato = new Dictionary<string, object?>
        {
            ["type"] = "book",
            ["title"] = "Πολιτεία",
            ["author"] = new List<object?> { new Dictionary<string, object?> { ["given"] = "Plátōn" } },
            ["issued"] = new Dictionary<string, object?> { ["date-parts"] = new List<object?> { new List<object?> { -375L } } },
        };
        Assert.Equal("platon-375", BibliographyExport.CitationKey(plato));
        Assert.Contains("year = {-375}", BibliographyExport.BibTeX(plato), StringComparison.Ordinal);

        string two = BibliographyExport.BibTeX([md, md]);
        Assert.Contains("@article{nasa350a,", two, StringComparison.Ordinal);
        Assert.Contains("@article{nasa350b,", two, StringComparison.Ordinal);
    }

    [Fact]
    public void CslCitationsCarryLabelAndLocator()
    {
        var md = new Dictionary<string, object?> { ["type"] = "book", ["title"] = "T" };
        var items = BibliographyExport.CslItems([md], Anchor.Page(5, "1r", foliation: "leaf"), Anchor.Page(6, "1v", source: "inferred", foliation: "leaf"));
        Assert.Equal("folio", items[0]["label"]);
        Assert.Equal("1r-[1v]", items[0]["locator"]);
        Assert.Equal(("timestamp", "1:09:20-1:10:05"), BibliographyExport.CslLabelLocator(Anchor.Time(4160, 4170), Anchor.Time(4200, 4205.5)));
        Assert.Equal(("verse", "3-5"), BibliographyExport.CslLabelLocator(Anchor.Verse(3, 5)));
        Assert.Null(BibliographyExport.CslLabelLocator(Anchor.Page(1, null)));
        Assert.False(BibliographyExport.CslItems([md, md], Anchor.Page(1, "1"))[0].ContainsKey("label"));
        Assert.Equal(["tnda", "tndb"], BibliographyExport.CslItems([md, md]).Select(i => i["id"]));
    }
}
