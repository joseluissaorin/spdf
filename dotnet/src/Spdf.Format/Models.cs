namespace Spdf;

/// <summary>The <c>documents</c> row: the one document of a file (specification §3.3).</summary>
public sealed record Document
{
    /// <summary>Document id (also <c>spdf_meta.document_id</c>).</summary>
    public required string Id { get; init; }

    /// <summary>Kind: <c>pdf</c>, <c>scanned_pdf</c>, <c>photos</c>, <c>image</c>, <c>audio</c>, <c>video</c>, <c>document</c>, <c>epub</c>, <c>slides</c>, <c>sheet</c>, <c>web</c>.</summary>
    public required string Kind { get; init; }

    /// <summary>CSL-JSON item plus the <c>spdf</c> extension object (§6).</summary>
    public IDictionary<string, object?> Metadata { get; init; } = new Dictionary<string, object?>(StringComparer.Ordinal);

    /// <summary>Lowercase hex SHA-256 of the original bytes.</summary>
    public required string SourceSha256 { get; init; }

    /// <summary><c>blob:&lt;key&gt;</c>, a URL, or <c>null</c> if the original is not shipped.</summary>
    public string? SourceRef { get; init; }

    /// <summary>MIME type of the original.</summary>
    public required string Mime { get; init; }

    /// <summary>Size of the original in bytes.</summary>
    public long Bytes { get; init; }

    /// <summary>Number of units (the writer computes it when 0).</summary>
    public long UnitCount { get; init; }

    /// <summary>Duration in seconds (audio and video).</summary>
    public double? Duration { get; init; }

    /// <summary>Creation time, ISO 8601 UTC (the writer uses the current time when <c>null</c>).</summary>
    public string? Created { get; init; }

    /// <summary>Last update, ISO 8601 UTC (the writer uses <see cref="Created"/> when <c>null</c>).</summary>
    public string? Updated { get; init; }

    /// <summary>Denormalized title.</summary>
    public string? Title { get; init; }

    /// <summary>Denormalized authors, <c>Family; Family</c>.</summary>
    public string? Authors { get; init; }

    /// <summary>Denormalized year.</summary>
    public long? Year { get; init; }

    /// <summary>Language (BCP 47).</summary>
    public string? Language { get; init; }

    /// <summary>Rights object: <c>{license, access, holder, note}</c>.</summary>
    public IDictionary<string, object?>? Rights { get; init; }
}

/// <summary>A citable unit: a page, a time span, a slide, a section, a sheet (§3.4).</summary>
public sealed record Unit
{
    /// <summary>Unit id.</summary>
    public required string Id { get; init; }

    /// <summary>1-based reading order (the writer assigns the next one when 0).</summary>
    public long Ord { get; init; }

    /// <summary>Anchor of the unit.</summary>
    public required Anchor Anchor { get; init; }

    /// <summary>Text (NFC, light Markdown).</summary>
    public string Text { get; init; } = "";

    /// <summary>Footnotes.</summary>
    public IReadOnlyList<string>? Notes { get; init; }

    /// <summary>Running header.</summary>
    public string? Header { get; init; }

    /// <summary>Running footer.</summary>
    public string? Footer { get; init; }

    /// <summary>Unit image: <c>blob:&lt;key&gt;</c> or a URL.</summary>
    public string? Image { get; init; }

    /// <summary>Thumbnail: <c>blob:&lt;key&gt;</c> or a URL.</summary>
    public string? Thumbnail { get; init; }

    /// <summary>Who produced the text (<c>pdf-text-layer</c>, <c>gemma-4-e4b</c>, <c>whisper-large-v3-turbo</c>…).</summary>
    public required string Reader { get; init; }

    /// <summary>Confidence of the reading (<c>null</c> = 1).</summary>
    public double? Confidence { get; init; }

    /// <summary>Printed folio, denormalized from the anchor.</summary>
    public string? Printed { get; init; }

    /// <summary>Start time in seconds.</summary>
    public double? T0 { get; init; }

    /// <summary>End time in seconds.</summary>
    public double? T1 { get; init; }

    /// <summary>Word timings as a JSON value tree (<c>{"v":1,"t0":…,"cs":[…]}</c>).</summary>
    public object? Words { get; init; }
}

/// <summary>An entry of the table of contents (§3.5).</summary>
public sealed record Section
{
    /// <summary>Section id.</summary>
    public required string Id { get; init; }

    /// <summary>Parent section id.</summary>
    public string? Parent { get; init; }

    /// <summary>Depth (1 = top level).</summary>
    public long Level { get; init; }

    /// <summary>Heading.</summary>
    public required string Title { get; init; }

    /// <summary>First unit.</summary>
    public required string UnitFrom { get; init; }

    /// <summary>Last unit.</summary>
    public string? UnitTo { get; init; }

    /// <summary>Summary.</summary>
    public string? Summary { get; init; }
}

/// <summary>A searchable, citable passage (§3.6).</summary>
public sealed record Fragment
{
    /// <summary>Stable rowid used by the FTS index (the writer assigns the next one when 0).</summary>
    public long N { get; init; }

    /// <summary>Fragment id.</summary>
    public required string Id { get; init; }

    /// <summary>Unit where the fragment starts.</summary>
    public required string Unit { get; init; }

    /// <summary>Reading order in the document (the writer assigns the next one when 0).</summary>
    public long Ord { get; init; }

    /// <summary>Literal text, NFC (never modernized).</summary>
    public required string Text { get; init; }

    /// <summary>One line situating the fragment in the work.</summary>
    public string Context { get; init; } = "";

    /// <summary>Heading path.</summary>
    public IReadOnlyList<string>? Section { get; init; }

    /// <summary>Anchor of the start.</summary>
    public required Anchor Anchor { get; init; }

    /// <summary>Anchor of the end, if the fragment crosses units.</summary>
    public Anchor? AnchorEnd { get; init; }

    /// <summary>Modernized-spelling layer, used only for search (<c>""</c> = nothing to add).</summary>
    public string? SearchText { get; init; }
}

/// <summary>A figure of a unit (§3.8).</summary>
public sealed record Figure
{
    /// <summary>Figure id.</summary>
    public required string Id { get; init; }

    /// <summary>Unit that holds the figure.</summary>
    public required string Unit { get; init; }

    /// <summary><c>blob:&lt;key&gt;</c> of the cropped image, or the unit image with a region in the anchor.</summary>
    public required string Image { get; init; }

    /// <summary>Printed caption.</summary>
    public string? Caption { get; init; }

    /// <summary>Description in the document language.</summary>
    public string? Description { get; init; }

    /// <summary>Anchor, usually with a <c>region</c>.</summary>
    public required Anchor Anchor { get; init; }
}

/// <summary>A vector space (§9.1).</summary>
public sealed record Space
{
    /// <summary>Space id: <c>&lt;model&gt;@&lt;dims&gt;</c> for f32, <c>&lt;model&gt;@&lt;dims&gt;:&lt;dtype&gt;</c> otherwise.</summary>
    public required string Id { get; init; }

    /// <summary>Provider (<c>local</c>, <c>google</c>…).</summary>
    public required string Provider { get; init; }

    /// <summary>Model name.</summary>
    public required string Model { get; init; }

    /// <summary>Model version.</summary>
    public string? Version { get; init; }

    /// <summary>Number of dimensions.</summary>
    public required long Dims { get; init; }

    /// <summary><c>f32</c>, <c>f16</c> or <c>i8</c>.</summary>
    public string DType { get; init; } = "f32";

    /// <summary>Vectors are normalized (score = dot product); otherwise cosine.</summary>
    public bool Normalized { get; init; } = true;

    /// <summary>Original dimensions if Matryoshka-truncated.</summary>
    public long? TruncatedFrom { get; init; }

    /// <summary>Modalities: <c>text</c>, <c>image</c>, <c>audio</c>, <c>video</c>.</summary>
    public IReadOnlyList<string> Modalities { get; init; } = ["text"];

    /// <summary>Task prefixes used at encode time: <c>{"query": "…", "document": "…"}</c>.</summary>
    public IDictionary<string, object?>? TaskPrefixes { get; init; }

    /// <summary>Creation time.</summary>
    public string? Created { get; init; }

    /// <summary>Exact JSON of <c>modalities</c> (used to rebuild files verbatim).</summary>
    internal object? RawModalities { get; init; }
}

/// <summary>A processing stage recorded in <c>provenance</c> (§3.11).</summary>
public sealed record ProvenanceEntry
{
    /// <summary>Stage (<c>read</c>, <c>embed</c>, <c>metadata</c>…).</summary>
    public required string Stage { get; init; }

    /// <summary>Provider.</summary>
    public string? Provider { get; init; }

    /// <summary>Model.</summary>
    public string? Model { get; init; }

    /// <summary>Detail as a JSON value tree (an object), or <c>null</c>.</summary>
    public object? Detail { get; init; }

    /// <summary>Duration in milliseconds.</summary>
    public long? Ms { get; init; }

    /// <summary>When, ISO 8601.</summary>
    public required string At { get; init; }
}

/// <summary>An extension declared in <c>extensions</c> (§11).</summary>
/// <param name="Name">Extension name.</param>
/// <param name="Version">Extension version.</param>
/// <param name="Required">Readers that do not know it must refuse the file.</param>
public sealed record Extension(string Name, string Version, bool Required);

/// <summary>A binary object stored in <c>blobs</c>.</summary>
/// <param name="Key">Key (referenced as <c>blob:&lt;key&gt;</c>).</param>
/// <param name="Mime">MIME type.</param>
/// <param name="Data">Bytes.</param>
public sealed record Blob(string Key, string Mime, byte[] Data);
