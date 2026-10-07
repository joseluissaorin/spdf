using System.Globalization;
using System.Text;
using Spdf;
using Spdf.Conformance;

namespace Spdf.Cli;

/// <summary>The <c>spdf</c> command-line tool of the .NET implementation.</summary>
internal static class Program
{
    private const string Usage = """
        usage:
          spdf validate FILE                       validation report (JSON); exit 1 if invalid
          spdf dump FILE                           canonical dump (RFC 8785 JSON)
          spdf hash FILE                           content_sha256 of the canonical dump
          spdf search FILE QUERY... [-n N]         lexical search
          spdf vsearch FILE SPACE V1,V2,... [-n N] [--target fragment|unit|figure]
          spdf hybrid FILE SPACE V1,V2,... QUERY... [-n N]
          spdf cite FILE FRAGMENT_ID [--locale es|en]
          spdf export FILE csl|bibtex
          spdf uri parse URI
          spdf uri format DOCREF ANCHOR_JSON [END_ANCHOR_JSON]
          spdf build SOURCE.json OUT.spdf
          spdf conformance [DIR] [-o conformance.json]
          spdf version
        """;

    private static int Main(string[] argv)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (argv.Length == 0)
        {
            return Fail(Usage, 2);
        }
        string cmd = argv[0];
        var positional = new List<string>();
        int n = 10;
        string locale = "es";
        string target = "fragment";
        string? output = null;
        for (int i = 1; i < argv.Length; i++)
        {
            string a = argv[i];
            string? Next() => i + 1 < argv.Length ? argv[++i] : null;
            switch (a)
            {
                case "-n":
                case "--limit":
                    if (!int.TryParse(Next(), NumberStyles.Integer, CultureInfo.InvariantCulture, out n))
                    {
                        return Fail("spdf: -n needs a number", 2);
                    }
                    break;
                case "-locale":
                case "--locale":
                    locale = Next() ?? "es";
                    break;
                case "--target":
                    target = Next() ?? "fragment";
                    break;
                case "-o":
                case "--output":
                    output = Next();
                    break;
                default:
                    positional.Add(a);
                    break;
            }
        }
        try
        {
            return Execute(cmd, positional, n, locale, target, output);
        }
        catch (Exception e) when (e is SpdfException or IOException or FormatException or ArgumentException or KeyNotFoundException or UnauthorizedAccessException)
        {
            return Fail("spdf: " + e.Message, 1);
        }
    }

    private static int Fail(string message, int code)
    {
        Console.Error.WriteLine(message);
        return code;
    }

    private static void Out(object? tree) => Console.Out.Write(SpdfJson.Canonical(tree) + "\n");

    private static List<double> Vector(string s) =>
        s.Split(',').Select(x => double.Parse(x.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture)).ToList();

    private static int Execute(string cmd, List<string> pos, int n, string locale, string target, string? output)
    {
        bool Need(int k) => pos.Count >= k;
        switch (cmd)
        {
            case "version":
            case "--version":
                Console.WriteLine($"{SpdfInfo.ImplName} {SpdfInfo.Version} (SPDF {SpdfInfo.FormatVersion})");
                return 0;
            case "help":
            case "--help":
            case "-h":
                Console.WriteLine(Usage);
                return 0;
            case "validate" when Need(1):
            {
                var r = SpdfValidator.Validate(pos[0]);
                Out(r.ToTree());
                return r.Valid ? 0 : 1;
            }
            case "dump" when Need(1):
            {
                using var f = SpdfFile.Open(pos[0]);
                Console.Out.Write(f.DumpJson() + "\n");
                return 0;
            }
            case "hash" when Need(1):
            {
                using var f = SpdfFile.Open(pos[0]);
                Console.WriteLine(f.ContentSha256());
                return 0;
            }
            case "search" when Need(2):
            {
                using var f = SpdfFile.Open(pos[0]);
                Out(f.SearchLexical(string.Join(" ", pos.Skip(1)), n).Select(h => (object?)h.ToTree()).ToList());
                return 0;
            }
            case "vsearch" when Need(3):
            {
                using var f = SpdfFile.Open(pos[0]);
                Out(f.SearchVector(Vector(pos[2]), pos[1], target, n).Select(h => (object?)h.ToTree()).ToList());
                return 0;
            }
            case "hybrid" when Need(4):
            {
                using var f = SpdfFile.Open(pos[0]);
                Out(f.SearchHybrid(string.Join(" ", pos.Skip(3)), Vector(pos[2]), pos[1], n).Select(h => (object?)h.ToTree()).ToList());
                return 0;
            }
            case "cite" when Need(2):
            {
                using var f = SpdfFile.Open(pos[0]);
                Console.WriteLine(f.CiteFragment(pos[1], locale));
                return 0;
            }
            case "export" when Need(2):
            {
                using var f = SpdfFile.Open(pos[0]);
                switch (pos[1])
                {
                    case "csl":
                        Console.Out.Write(f.ExportCslJson() + "\n");
                        return 0;
                    case "bibtex":
                        Console.Out.Write(f.ExportBibTeX());
                        return 0;
                }
                break;
            }
            case "uri" when Need(2) && pos[0] == "parse":
            {
                var p = AnchorUri.Parse(pos[1]);
                Out(new Dictionary<string, object?>
                {
                    ["docref"] = p.DocRef,
                    ["locator"] = p.Locator.ToTree(),
                    ["canonical"] = AnchorUri.Format(p.DocRef, p.Locator),
                });
                return 0;
            }
            case "uri" when Need(3) && pos[0] == "format":
            {
                var end = pos.Count > 3 ? Anchor.Parse(pos[3]) : null;
                Console.WriteLine(AnchorUri.Format(pos[1], Anchor.Parse(pos[2]), end));
                return 0;
            }
            case "build" when Need(2):
                SpdfSource.Write(pos[0], pos[1]);
                return 0;
            case "conformance":
            {
                string dir = pos.Count > 0 ? pos[0] : "conformance";
                var report = ConformanceRunner.Run(dir);
                string json = report.ToJson() + "\n";
                Console.Out.Write(json);
                if (output is not null)
                {
                    File.WriteAllText(output, json, new UTF8Encoding(false));
                }
                Console.Error.WriteLine($"{report.Passed.Count} passed, {report.Failed.Count} failed, {report.Skipped.Count} skipped");
                foreach (var f in report.Failed)
                {
                    Console.Error.WriteLine($"  FAIL {f.Id}: {f.Reason}");
                }
                return report.Failed.Count > 0 ? 1 : 0;
            }
        }
        return Fail(Usage, 2);
    }
}
