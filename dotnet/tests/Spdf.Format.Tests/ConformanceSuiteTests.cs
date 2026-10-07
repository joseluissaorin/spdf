using Spdf.Conformance;
using Xunit.Abstractions;

namespace Spdf.Tests;

public class ConformanceSuiteTests(ITestOutputHelper output)
{
    [Fact]
    public void WholeSuitePasses()
    {
        var report = ConformanceRunner.Run(TestPaths.ConformanceDir);
        output.WriteLine($"{report.Passed.Count} passed, {report.Failed.Count} failed, {report.Skipped.Count} skipped");
        foreach (var f in report.Failed)
        {
            output.WriteLine($"FAIL {f.Id}: {f.Reason}");
        }
        Assert.Empty(report.Failed);
        Assert.Empty(report.Skipped);
        Assert.True(report.Passed.Count >= 228, $"only {report.Passed.Count} cases found");
    }

    [Fact]
    public void ReportHasTheProtocolShape()
    {
        var report = new ConformanceReport { Passed = ["a"], Failed = [new CaseOutcome("b", "why")] };
        Assert.Equal("""{"failed":[{"id":"b","reason":"why"}],"impl":"spdf-dotnet","passed":["a"],"skipped":[],"version":"0.1.0"}""", report.ToJson());
    }
}
