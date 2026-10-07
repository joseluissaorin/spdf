using System.Security.Cryptography;
using System.Text;

namespace Spdf.Cli;

/// <summary>A small demo document (Bécquer, public domain) built with the typed writer.</summary>
internal static class Sample
{
    public static void Write(string path, byte[]? signingKey)
    {
        const string text1 = "Volverán las oscuras golondrinas\nen tu balcón sus nidos a colgar,\ny otra vez con el ala a sus cristales\njugando llamarán.";
        const string text2 = "Del salón en el ángulo oscuro,\nde su dueña tal vez olvidada,\nsilenciosa y cubierta de polvo\nveíase el arpa.";
        string sha = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text1 + "\n\n" + text2))).ToLowerInvariant();
        using var w = SpdfWriter.Create(path, new SpdfWriterOptions { SigningKey = signingKey });
        w.SetDocument(new Document
        {
            Id = "rimas-sample",
            Kind = "document",
            Mime = "text/plain",
            SourceSha256 = sha,
            Bytes = Encoding.UTF8.GetByteCount(text1 + "\n\n" + text2),
            Created = "2026-10-07T00:00:00Z",
            Title = "Rimas",
            Authors = "Bécquer",
            Year = 1871,
            Language = "es",
            Metadata = new Dictionary<string, object?>
            {
                ["type"] = "book",
                ["title"] = "Rimas",
                ["author"] = new List<object?> { new Dictionary<string, object?> { ["family"] = "Bécquer", ["given"] = "Gustavo Adolfo" } },
                ["issued"] = new Dictionary<string, object?> { ["date-parts"] = new List<object?> { new List<object?> { 1871L } } },
                ["language"] = "es",
                ["note"] = "Sample document of the SPDF .NET command-line tool; synthetic layout.",
            },
        });
        w.AddUnit(new Unit { Id = "u1", Reader = "sample", Text = text1, Anchor = Anchor.Page(1, "1") });
        w.AddUnit(new Unit { Id = "u2", Reader = "sample", Text = text2, Anchor = Anchor.Page(2, "2") });
        w.AddFragment(new Fragment { Id = "f1", Unit = "u1", Text = text1, Anchor = Anchor.Page(1, "1").WithChars(0, text1.Length) });
        w.AddFragment(new Fragment { Id = "f2", Unit = "u2", Text = text2, Anchor = Anchor.Page(2, "2").WithChars(0, text2.Length) });
        w.AddProvenance(new ProvenanceEntry { Stage = "read", Provider = "sample", At = "2026-10-07T00:00:00Z" });
        w.Commit();
    }
}
