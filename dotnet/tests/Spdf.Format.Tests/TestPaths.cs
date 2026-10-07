namespace Spdf.Tests;

/// <summary>Locates the conformance suite: SPDF_CONFORMANCE_DIR, else ../conformance relative to dotnet/.</summary>
internal static class TestPaths
{
    public static string ConformanceDir
    {
        get
        {
            string? env = Environment.GetEnvironmentVariable("SPDF_CONFORMANCE_DIR");
            if (!string.IsNullOrEmpty(env))
            {
                return Path.GetFullPath(env);
            }
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Spdf.sln")))
            {
                dir = dir.Parent;
            }
            if (dir?.Parent is null)
            {
                throw new DirectoryNotFoundException("cannot find dotnet/Spdf.sln above " + AppContext.BaseDirectory);
            }
            return Path.Combine(dir.Parent.FullName, "conformance");
        }
    }

    public static string Conformance(string relative) => Path.Combine(ConformanceDir, relative.Replace('/', Path.DirectorySeparatorChar));

    public static string TempFile(string extension = ".spdf") =>
        Path.Combine(Path.GetTempPath(), "spdf-test-" + Guid.NewGuid().ToString("N") + extension);
}
