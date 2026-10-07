namespace Spdf;

/// <summary>Library and format constants.</summary>
public static class SpdfInfo
{
    /// <summary>Version of this library.</summary>
    public const string Version = "0.1.0";

    /// <summary>Name of this implementation in conformance reports and in <c>spdf_meta.generator</c>.</summary>
    public const string ImplName = "spdf-dotnet";

    /// <summary>The SPDF version written by <see cref="SpdfWriter"/>.</summary>
    public const string FormatVersion = "5.0";

    /// <summary><c>PRAGMA application_id</c> of an SPDF file (0x53504446, "SPDF").</summary>
    public const int ApplicationId = 1397769286;

    /// <summary><c>PRAGMA user_version</c> of an SPDF 5.0 file.</summary>
    public const int UserVersion = 500;

    /// <summary>Default cap for any single string or blob read from a file (512 MiB).</summary>
    public const long DefaultMaxBlobSize = 512L << 20;

    /// <summary>Default cap for the decompressed size of a gzip-wrapped file (4 GiB).</summary>
    public const long DefaultMaxDecompressedSize = 4L << 30;

    /// <summary>Anchor types defined by SPDF 5.0.</summary>
    public static IReadOnlySet<string> AnchorTypes { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "page", "time", "section", "slide", "sheet", "web", "image", "verse", "canonical",
    };

    /// <summary>Document kinds (<c>documents.kind</c>).</summary>
    public static IReadOnlySet<string> Kinds { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "pdf", "scanned_pdf", "photos", "image", "audio", "video", "document", "epub", "slides", "sheet", "web",
    };

    /// <summary>Profiles defined by the specification.</summary>
    public static IReadOnlySet<string> Profiles { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "core", "semantic", "media", "full",
    };

    /// <summary>Extensions this implementation understands (none yet).</summary>
    public static IReadOnlySet<string> KnownExtensions { get; } = new HashSet<string>(StringComparer.Ordinal);
}
