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
    public void LocatesReferences()
    {
        using var f = SpdfFile.Open(TestPaths.Conformance("files/quijote.spdf"));
        string docRef = f.DocRef;
        var page = f.Locate($"spdf:{docRef}#p=3&pe=4");
        Assert.True(page.Document);
        Assert.Equal(["p3", "p4"], page.Units);
        Assert.Equal(["q3"], page.Fragments);
        Assert.Equal(["p6"], f.Locate($"spdf:{docRef}#f=1v").Units);
        Assert.Equal(["p7"], f.Locate("https://example.org/quijote.spdf#p=7").Units);
        var other = f.Locate("spdf:sha256-" + new string('0', 64) + "#p=1");
        Assert.False(other.Document);
        Assert.Empty(other.Units);
        Assert.Equal("""{"char":null,"document":true,"fragments":[],"units":[],"xywh":null}""",
            SpdfJson.Canonical(f.Locate("https://example.org/quijote.spdf").ToTree()));
        Assert.Throws<FormatException>(() => f.Locate("spdf:x#p=0"));
    }

    [Fact]
    public void GivesThePageSequenceOfStructuralExports()
    {
        using var f = SpdfFile.Open(TestPaths.Conformance("files/quijote.spdf"));
        var pages = f.GetStructurePages();
        Assert.Equal(8, pages.Count);
        Assert.Null(pages[0].Printed);
        Assert.Equal("1r", pages[4].Printed);
        Assert.Null(pages[5].Printed);
        Assert.Equal("[1v]", pages[5].Label);
        Assert.Equal("""{"pages":[{"n":null}""", SpdfJson.Canonical(f.ExportStructure(StructureFormat.Tei))[..20]);
    }

    [Fact]
    public void SearchesUnitAndFigureVectors()
    {
        using var f = SpdfFile.Open(TestPaths.Conformance("files/micrographia.spdf"));
        var figures = f.SearchVector([1, 0.5, 0.25, 0], "toy-clip@4", "figure", 2);
        Assert.Equal(["fig-flea", "fig-louse"], figures.Select(h => h.FigureId));
        Assert.Equal(0.9759, figures[0].Score, 4);
        Assert.Contains("xywh=percent:10,25,80,50", figures[0].AnchorUri, StringComparison.Ordinal);
        Assert.True(figures[0].ToTree().ContainsKey("figure_id"));
        var units = f.SearchVector([1, 0.5, 0.25, 0], "toy-clip@4", "unit", 2);
        Assert.All(units, h => Assert.NotNull(h.UnitId));
    }

    [Fact]
    public void WriterAddsContentHashAndSignature()
    {
        string plain = TestPaths.TempFile(), signed = TestPaths.TempFile();
        var seed = Convert.FromHexString("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
        try
        {
            void Build(string path, byte[]? key)
            {
                using var w = SpdfWriter.Create(path, new SpdfWriterOptions { SigningKey = key });
                w.SetDocument(new Document
                {
                    Id = "d", Kind = "document", Mime = "text/plain", SourceSha256 = new string('b', 64), Created = "2026-10-07T00:00:00Z",
                    Metadata = new Dictionary<string, object?> { ["type"] = "book", ["title"] = "T" },
                });
                w.SetMeta("content_sha256", "ignored");
                w.AddUnit(new Unit { Id = "u1", Reader = "test", Text = "Uno dos tres", Anchor = Anchor.Page(1, "1") });
                w.AddFragment(new Fragment { Id = "f1", Unit = "u1", Text = "Uno dos tres", Anchor = Anchor.Page(1, "1").WithChars(0, 12) });
                w.Commit();
            }
            Build(plain, null);
            Build(signed, seed);
            using (var f = SpdfFile.Open(plain))
            {
                var meta = f.GetMeta();
                Assert.Equal(f.ContentSha256(), meta["content_sha256"]);
                Assert.False(meta.ContainsKey("signature"));
            }
            using (var f = SpdfFile.Open(signed))
            {
                var meta = f.GetMeta();
                Assert.Equal(f.ContentSha256(), meta["content_sha256"]);
                Assert.Equal("ed25519:" + Convert.ToBase64String(Ed25519.PublicKey(seed)), meta["signer"]);
                Assert.True(SpdfValidator.VerifySignature(meta["content_sha256"], meta["signature"], meta["signer"]));
            }
            var r = SpdfValidator.Validate(signed);
            Assert.True(r.Valid, string.Join(", ", r.ErrorCodes));
            Assert.DoesNotContain("E081", r.ErrorCodes);
            Assert.DoesNotContain("E082", r.ErrorCodes);
            Assert.Throws<ArgumentException>(() => SpdfWriter.Create(TestPaths.TempFile(), new SpdfWriterOptions { SigningKey = new byte[31] }));
        }
        finally
        {
            File.Delete(plain);
            File.Delete(signed);
        }
    }

    [Fact]
    public void StructuralExportsAreWellFormedAndParseBack()
    {
        using var f = SpdfFile.Open(TestPaths.Conformance("files/quijote.spdf"));
        var alto = System.Xml.Linq.XDocument.Parse(f.ExportAlto());
        Assert.Equal(8, alto.Descendants(System.Xml.Linq.XName.Get("Page", StructureExport.AltoNamespace)).Count());
        var tei = StructureExport.PageSequence(StructureFormat.Tei, f.ExportTei());
        Assert.Equal("[1v]", tei[5]["n"]);
        Assert.Null(tei[0]["n"]);
        var iiif = SpdfJson.ParseObject(f.ExportIiif(new IiifOptions { Base = "https://example.org/q" }));
        Assert.Equal("https://example.org/q/manifest", iiif["id"]);
        Assert.Equal(8, StructureExport.PageSequence(StructureFormat.Iiif, f.ExportIiif()).Count);
        using var a = SpdfFile.Open(TestPaths.Conformance("files/apolo11.spdf"));
        var manifest = a.ExportIiifManifest();
        var canvas = Assert.IsType<Dictionary<string, object?>>(Assert.Single((List<object?>)manifest["items"]!));
        Assert.True(canvas.ContainsKey("duration"));
        Assert.Equal(6, ((List<object?>)manifest["structures"]!).Count);
        Assert.Contains("<u who=\"Neil Armstrong\">", a.ExportTei(), StringComparison.Ordinal);
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
