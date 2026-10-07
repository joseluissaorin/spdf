using System.IO.Compression;

namespace Spdf.Tests;

public class FileTests
{
    [Fact]
    public void ReadsAFileThroughTheTypedApi()
    {
        using var f = SpdfFile.Open(TestPaths.Conformance("files/quijote.spdf"));
        Assert.Equal("5.0", f.Version);
        Assert.False(f.IsLegacy);
        var doc = f.GetDocument();
        Assert.Equal("book", f.GetMetadata()["type"]);
        Assert.Equal(doc.UnitCount, f.GetUnits().Count);
        Assert.NotEmpty(f.GetFragments());
        Assert.Equal("5.0", f.GetMeta()["spdf_version"]);
        var first = f.GetFragments()[0];
        Assert.StartsWith("spdf:sha256-", f.AnchorUriOf(first.Anchor, first.AnchorEnd), StringComparison.Ordinal);
        Assert.StartsWith("(", f.CiteFragment(first.Id, "en"), StringComparison.Ordinal);
        Assert.StartsWith("@book{cervantessaavedra1605,", f.ExportBibTeX(), StringComparison.Ordinal);
        Assert.Contains("\"type\":\"book\"", f.ExportCslJson(), StringComparison.Ordinal);
    }

    [Fact]
    public void ReadsLegacyFilesThroughThe50View()
    {
        using var f = SpdfFile.Open(TestPaths.Conformance("legacy/garcilaso-4.1.spdf"));
        Assert.True(f.IsLegacy);
        Assert.True(f.IsGzipped);
        Assert.Equal("4.1", f.Version);
        var units = f.GetUnits();
        Assert.Equal(Enumerable.Range(1, units.Count).Select(i => (long)i), units.Select(u => u.Ord));
        Assert.Equal(true, f.Dump()["legacy"]);
        Assert.Equal("spdf:sha256-", f.SearchLexical("dulce lamentar")[0].AnchorUri[..12]);
    }

    [Fact]
    public async Task OpensFromBytesStreamsAndAsync()
    {
        var bytes = File.ReadAllBytes(TestPaths.Conformance("files/minimo.spdf"));
        string expected;
        using (var f = SpdfFile.Open(TestPaths.Conformance("files/minimo.spdf")))
        {
            expected = f.ContentSha256();
        }
        using (var f = SpdfFile.Open(bytes.AsSpan()))
        {
            Assert.Equal(expected, f.ContentSha256());
        }
        var gz = new MemoryStream();
        using (var z = new GZipStream(gz, CompressionLevel.Fastest, leaveOpen: true))
        {
            z.Write(bytes);
        }
        gz.Position = 0;
        using (var f = SpdfFile.Open(gz))
        {
            Assert.True(f.IsGzipped);
            Assert.Equal(expected, f.ContentSha256());
        }
        await using (var f = await SpdfFile.OpenAsync(TestPaths.Conformance("legacy/kennedy-4.0.spdf")))
        {
            Assert.Equal("4.0", f.Version);
        }
    }

    [Theory]
    [InlineData("invalid/W105-newer-minor.spdf")]
    [InlineData("invalid/W105-newer-minor-new-anchor-type.spdf")]
    public void OpensNewerMinorVersions(string file)
    {
        using var f = SpdfFile.Open(TestPaths.Conformance(file));
        Assert.Equal("5.1", f.Version);
        Assert.NotEmpty(f.GetUnits());
        Assert.Equal(64, f.ContentSha256().Length);
        var r = SpdfValidator.Validate(TestPaths.Conformance(file));
        Assert.True(r.Valid);
        Assert.Contains("W105", r.WarningCodes);
    }

    [Theory]
    [InlineData("invalid/E020-trigger.spdf", "E020")]
    [InlineData("invalid/E020-view.spdf", "E020")]
    [InlineData("invalid/E020-virtual-table.spdf", "E020")]
    [InlineData("invalid/E060-required-extension.spdf", "E060")]
    [InlineData("invalid/E001-not-sqlite.spdf", "E001")]
    [InlineData("invalid/E001-gzip-of-text.spdf", "E001")]
    [InlineData("invalid/E002-major-version.spdf", "E002")]
    public void RefusesUnsafeOrForeignFiles(string file, string code)
    {
        var e = Assert.Throws<SpdfException>(() => SpdfFile.Open(TestPaths.Conformance(file)));
        Assert.Equal(code, e.Code);
    }

    [Fact]
    public void TemporaryCopiesAreDeleted()
    {
        string physical;
        using (var f = SpdfFile.Open(TestPaths.Conformance("legacy/garcilaso-4.1.spdf")))
        {
            physical = f.PhysicalPath;
            Assert.NotEqual(TestPaths.Conformance("legacy/garcilaso-4.1.spdf"), physical);
            Assert.True(File.Exists(physical));
            Assert.NotEmpty(f.GetUnits());
        }
        Assert.False(File.Exists(physical));
    }

    [Fact]
    public void WritesAValidFileThatSearchesAndCites()
    {
        string path = TestPaths.TempFile();
        try
        {
            using (var w = SpdfWriter.Create(path, new SpdfWriterOptions { Generator = "tests/1.0" }))
            {
                w.SetDocument(new Document
                {
                    Id = "rimas",
                    Kind = "pdf",
                    Mime = "application/pdf",
                    SourceSha256 = new string('A', 64),
                    Bytes = 1234,
                    Created = "2026-10-07T00:00:00Z",
                    Metadata = new Dictionary<string, object?>
                    {
                        ["type"] = "book",
                        ["title"] = "Rimas",
                        ["author"] = new List<object?> { new Dictionary<string, object?> { ["family"] = "Bécquer", ["given"] = "Gustavo Adolfo" } },
                        ["issued"] = new Dictionary<string, object?> { ["date-parts"] = new List<object?> { new List<object?> { 1871L } } },
                    },
                });
                // Decomposed input is stored as NFC.
                w.AddUnit(new Unit { Id = "u1", Reader = "pdf-text-layer", Text = "Volverán las oscuras golondrinas", Anchor = Anchor.Page(1, "1") });
                w.AddUnit(new Unit { Id = "u2", Reader = "pdf-text-layer", Text = "Del salón en el ángulo oscuro", Anchor = Anchor.Page(2, "2") });
                w.AddFragment(new Fragment { Id = "f1", Unit = "u1", Text = "Volverán las oscuras golondrinas", Anchor = Anchor.Page(1, "1").WithChars(0, 32) });
                w.AddFragment(new Fragment { Id = "f2", Unit = "u2", Text = "Del salón en el ángulo oscuro", Anchor = Anchor.Page(2, "2").WithChars(0, 29) });
                w.AddSpace(new Space { Id = "toy@2:i8", Provider = "local", Model = "toy", Dims = 2, DType = "i8" });
                w.AddVector("fragment", "f1", "toy@2:i8", new float[] { 1, 0 });
                w.AddVector("fragment", "f2", "toy@2:i8", new double[] { 0, 1 });
                w.AddBlob("original.pdf", "application/pdf", [1, 2, 3]);
                w.AddProvenance(new ProvenanceEntry { Stage = "read", Provider = "local", At = "2026-10-07T00:00:00Z", Detail = new Dictionary<string, object?> { ["pages"] = 2L } });
                w.Commit();
            }
            var result = SpdfValidator.Validate(path);
            Assert.True(result.Valid, string.Join(", ", result.Errors.Select(e => e.Code + " " + e.Message)));
            Assert.Empty(result.Warnings);
            Assert.Equal(["core", "semantic"], result.Profile);

            using var f = SpdfFile.Open(path);
            Assert.Equal("Volverán las oscuras golondrinas", f.GetUnits()[0].Text);
            Assert.Equal(2, f.GetDocument().UnitCount);
            Assert.Equal("tests/1.0", f.GetMeta()["generator"]);
            Assert.Equal(new string('a', 64), f.GetDocument().SourceSha256);
            var lex = f.SearchLexical("oscuro");
            Assert.Equal("f2", Assert.Single(lex).FragmentId);
            Assert.Equal(["f2", "f1"], f.SearchLexical("OSCURAS volveran oscuro").Select(h => h.Id).ToList().Order().Reverse().ToList());
            var vec = f.SearchVector([0, 1], "toy@2:i8");
            Assert.Equal("f2", vec[0].Id);
            Assert.Equal(1.0, vec[0].Score, 6);
            var hybrid = f.SearchHybrid("golondrinas", [1, 0], "toy@2:i8", 5);
            Assert.Equal("f1", hybrid[0].Id);
            Assert.Equal(["lexical", "vector"], hybrid[0].Via);
            Assert.Equal(2.0 / 11, hybrid[0].Score, 9);
            Assert.Equal("(Bécquer, 1871, p. 2)", f.CiteFragment("f2"));
            Assert.Equal(new byte[] { 1, 2, 3 }, f.GetBlob("blob:original.pdf")!.Data);
            Assert.Equal(64, f.ContentSha256().Length);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void DisposingWithoutCommitLeavesNothing()
    {
        string dir = Path.Combine(Path.GetTempPath(), "spdf-abort-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            string path = Path.Combine(dir, "x.spdf");
            using (var w = SpdfWriter.Create(path))
            {
                w.SetDocument(new Document { Id = "d", Kind = "pdf", Mime = "application/pdf", SourceSha256 = new string('0', 64) });
                w.AddUnit(new Unit { Id = "u1", Reader = "test", Anchor = Anchor.Page(1, "1") });
            }
            Assert.Empty(Directory.GetFiles(dir));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void RebuildsSourcesExactly()
    {
        string path = TestPaths.TempFile();
        try
        {
            var source = SpdfSource.Read(TestPaths.Conformance("sources/darwin.json"));
            SpdfSource.Write(source, path);
            using var f = SpdfFile.Open(path);
            Assert.Null(SpdfJson.Diff(SpdfJson.Parse(f.DumpJson()), SpdfSource.Strip(source)));
        }
        finally
        {
            File.Delete(path);
        }
    }
}
