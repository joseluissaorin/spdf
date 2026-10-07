using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace Spdf;

/// <summary>Options for the IIIF Presentation 3 manifest.</summary>
public sealed record IiifOptions
{
    /// <summary>Base of the resource ids (default <c>spdf:&lt;docref&gt;</c>; use an HTTP(S) base when publishing).</summary>
    public string? Base { get; init; }

    /// <summary>Turns a reference (<c>blob:…</c> or a URL) into a URL for the manifest (default: the reference itself).</summary>
    public Func<string, string>? ImageUrl { get; init; }
}

/// <summary>
/// Structural exports (specification §19.4): ALTO 4, a minimal TEI and a IIIF Presentation 3
/// manifest. They never invent data: no coordinates or dimensions (the file has none), no folio
/// for an unnumbered page, inferred folios in brackets in TEI and IIIF and absent from ALTO
/// (which only records printed numbers). <see cref="PageSequence"/> reads the page sequence
/// back from an exported document, which is what the conformance suite compares.
/// </summary>
public static partial class StructureExport
{
    /// <summary>ALTO 4 namespace.</summary>
    public const string AltoNamespace = "http://www.loc.gov/standards/alto/ns-v4#";

    /// <summary>TEI namespace.</summary>
    public const string TeiNamespace = "http://www.tei-c.org/ns/1.0";

    /// <summary>Label of the IIIF canvas metadata entry that records the physical page of a page unit.</summary>
    public const string PhysicalPageLabel = "Physical page";

    [GeneratedRegex("\\n\\s*\\n", RegexOptions.CultureInvariant)]
    private static partial Regex BlankLines();

    [GeneratedRegex("^\\*\\*([^*]+):\\*\\*\\s*(.*)$", RegexOptions.CultureInvariant | RegexOptions.Singleline)]
    private static partial Regex SpeakerTurn();

    /// <summary>The paragraphs of a unit text (split on blank lines), each as its non-empty trimmed lines.</summary>
    internal static List<List<string>> Paragraphs(string text) =>
        BlankLines().Split(text.Replace("\r\n", "\n", StringComparison.Ordinal))
            .Select(p => p.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList())
            .Where(p => p.Count > 0)
            .ToList();

    /// <summary>Removes characters XML 1.0 cannot carry.</summary>
    internal static string XmlSafe(string s)
    {
        var sb = new StringBuilder(s.Length);
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]))
            {
                sb.Append(c).Append(s[i + 1]);
                i++;
            }
            else if (XmlConvert.IsXmlChar(c))
            {
                sb.Append(c);
            }
        }
        return sb.ToString();
    }

    /// <summary>The folio as cited without its label: <c>ii</c>, <c>[iv]</c>, <c>1r</c>; <c>null</c> when unnumbered.</summary>
    internal static string? Folio(Anchor a) =>
        a.GetString("printed") is { } p ? (a.GetString("source") == "inferred" ? "[" + p + "]" : p) : null;

    internal static XmlWriter NewXmlWriter(Stream output) => XmlWriter.Create(output, new XmlWriterSettings
    {
        Encoding = new UTF8Encoding(false),
        Indent = true,
        IndentChars = "  ",
        NewLineChars = "\n",
        NewLineHandling = NewLineHandling.Replace,
    });

    /// <summary>
    /// Reads the page sequence back from an exported document (§19.4): ALTO <c>Page</c>
    /// (<c>physical</c>, <c>printed</c> = <c>PRINTED_IMG_NR</c> or null), TEI <c>pb</c>
    /// (<c>n</c> or null), or the IIIF canvases of page units (<c>label</c> or null).
    /// </summary>
    /// <exception cref="XmlException">Malformed ALTO or TEI.</exception>
    /// <exception cref="FormatException">Malformed IIIF JSON.</exception>
    public static List<Dictionary<string, object?>> PageSequence(StructureFormat format, string exported)
    {
        ArgumentNullException.ThrowIfNull(exported);
        var pages = new List<Dictionary<string, object?>>();
        switch (format)
        {
            case StructureFormat.Alto:
                foreach (var page in XDocument.Parse(exported).Descendants(XName.Get("Page", AltoNamespace)))
                {
                    string physical = (string?)page.Attribute("PHYSICAL_IMG_NR") ?? throw new XmlException("Page without PHYSICAL_IMG_NR");
                    pages.Add(new Dictionary<string, object?>(StringComparer.Ordinal)
                    {
                        ["physical"] = SpdfJson.Parse(physical),
                        ["printed"] = (string?)page.Attribute("PRINTED_IMG_NR"),
                    });
                }
                break;
            case StructureFormat.Tei:
                foreach (var pb in XDocument.Parse(exported).Descendants(XName.Get("pb", TeiNamespace)))
                {
                    pages.Add(new Dictionary<string, object?>(StringComparer.Ordinal) { ["n"] = (string?)pb.Attribute("n") });
                }
                break;
            case StructureFormat.Iiif:
            {
                var manifest = SpdfJson.ParseObject(exported);
                foreach (var canvas in (manifest.GetValueOrDefault("items") as List<object?> ?? []).OfType<Dictionary<string, object?>>())
                {
                    bool isPage = (canvas.GetValueOrDefault("metadata") as List<object?> ?? []).OfType<Dictionary<string, object?>>()
                        .Any(m => m.GetValueOrDefault("label") is Dictionary<string, object?> l
                                  && l.Values.OfType<List<object?>>().Any(v => v.Contains(PhysicalPageLabel)));
                    if (!isPage)
                    {
                        continue;
                    }
                    object? label = canvas.GetValueOrDefault("label") is Dictionary<string, object?> lab
                        && lab.Values.OfType<List<object?>>().FirstOrDefault() is { Count: > 0 } values ? values[0] : null;
                    pages.Add(new Dictionary<string, object?>(StringComparer.Ordinal) { ["label"] = label });
                }
                break;
            }
        }
        return pages;
    }
}

public sealed partial class SpdfFile
{
    /// <summary>
    /// ALTO 4 (§19.4): one <c>Page</c> per page unit (<c>PHYSICAL_IMG_NR</c>, and
    /// <c>PRINTED_IMG_NR</c> unless the folio is inferred or absent), one <c>TextBlock</c> per
    /// paragraph, one <c>TextLine</c> per line, one <c>String</c> per word. No coordinates.
    /// </summary>
    public string ExportAlto()
    {
        var doc = GetDocument();
        using var ms = new MemoryStream();
        using (var w = StructureExport.NewXmlWriter(ms))
        {
            const string ns = StructureExport.AltoNamespace;
            w.WriteStartDocument();
            w.WriteStartElement("alto", ns);
            w.WriteAttributeString("xmlns", "xsi", null, "http://www.w3.org/2001/XMLSchema-instance");
            w.WriteAttributeString("xsi", "schemaLocation", "http://www.w3.org/2001/XMLSchema-instance",
                ns + " http://www.loc.gov/standards/alto/v4/alto-4-4.xsd");
            w.WriteAttributeString("SCHEMAVERSION", "4.4");
            w.WriteStartElement("Description", ns);
            w.WriteElementString("MeasurementUnit", ns, "pixel");
            w.WriteStartElement("sourceImageInformation", ns);
            w.WriteElementString("fileName", ns, StructureExport.XmlSafe(doc.Id));
            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteStartElement("Layout", ns);
            int p = 0;
            foreach (var u in GetUnits().Where(u => u.Anchor.Type == "page"))
            {
                p++;
                string pid = "P" + p.ToString(CultureInfo.InvariantCulture);
                w.WriteStartElement("Page", ns);
                w.WriteAttributeString("ID", pid);
                w.WriteAttributeString("PHYSICAL_IMG_NR", SpdfJson.Canonical(u.Anchor["physical"]));
                if (u.Anchor.GetString("printed") is { } printed && u.Anchor.GetString("source") != "inferred")
                {
                    w.WriteAttributeString("PRINTED_IMG_NR", StructureExport.XmlSafe(printed));
                }
                w.WriteStartElement("PrintSpace", ns);
                w.WriteAttributeString("ID", pid + "_PS");
                int b = 0;
                foreach (var lines in StructureExport.Paragraphs(u.Text))
                {
                    b++;
                    string bid = pid + "_B" + b.ToString(CultureInfo.InvariantCulture);
                    w.WriteStartElement("TextBlock", ns);
                    w.WriteAttributeString("ID", bid);
                    int l = 0;
                    foreach (var line in lines)
                    {
                        l++;
                        w.WriteStartElement("TextLine", ns);
                        w.WriteAttributeString("ID", bid + "_L" + l.ToString(CultureInfo.InvariantCulture));
                        var words = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                        for (int i = 0; i < words.Length; i++)
                        {
                            if (i > 0)
                            {
                                w.WriteStartElement("SP", ns);
                                w.WriteEndElement();
                            }
                            w.WriteStartElement("String", ns);
                            w.WriteAttributeString("CONTENT", StructureExport.XmlSafe(words[i]));
                            w.WriteEndElement();
                        }
                        w.WriteEndElement();
                    }
                    w.WriteEndElement();
                }
                w.WriteEndElement();
                w.WriteEndElement();
            }
            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteEndDocument();
        }
        return SpdfJson.Utf8.GetString(ms.ToArray()) + "\n";
    }

    /// <summary>
    /// A minimal TEI (§19.4): <c>teiHeader</c> from the metadata (title, authors, editors,
    /// rights, imprint) and a body with <c>&lt;pb n facs/&gt;</c> before each page unit
    /// (<c>n="[21]"</c> for inferred folios, no <c>n</c> for unnumbered pages), <c>&lt;p&gt;</c> per
    /// paragraph, <c>&lt;lg&gt;</c>/<c>&lt;l n&gt;</c> for verse anchors, <c>&lt;u who&gt;</c> for speaker
    /// turns and <c>&lt;note place="foot"&gt;</c> for notes.
    /// </summary>
    public string ExportTei()
    {
        var doc = GetDocument();
        var md = doc.Metadata as Dictionary<string, object?> ?? (Dictionary<string, object?>)SpdfJson.ToTree(doc.Metadata)!;
        const string ns = StructureExport.TeiNamespace;
        static string S(object? v) => StructureExport.XmlSafe(v switch
        {
            null => "",
            string s => s,
            _ => SpdfJson.Canonical(v),
        });
        using var ms = new MemoryStream();
        using (var w = StructureExport.NewXmlWriter(ms))
        {
            w.WriteStartDocument();
            w.WriteStartElement("TEI", ns);
            if (!string.IsNullOrEmpty(doc.Language))
            {
                w.WriteAttributeString("xml", "lang", "http://www.w3.org/XML/1998/namespace", S(doc.Language));
            }
            w.WriteStartElement("teiHeader", ns);
            w.WriteStartElement("fileDesc", ns);
            w.WriteStartElement("titleStmt", ns);
            w.WriteElementString("title", ns, S(md.GetValueOrDefault("title")));
            foreach (var a in TeiNames(md.GetValueOrDefault("author")))
            {
                w.WriteElementString("author", ns, S(a));
            }
            foreach (var e in TeiNames(md.GetValueOrDefault("editor")))
            {
                w.WriteElementString("editor", ns, S(e));
            }
            w.WriteEndElement();
            w.WriteStartElement("publicationStmt", ns);
            var rights = doc.Rights is null ? null : (Dictionary<string, object?>)SpdfJson.ToTree(doc.Rights)!;
            if (rights is not null && new[] { "license", "holder", "note" }.Any(k => Legacy.Truthy(rights.GetValueOrDefault(k))))
            {
                w.WriteStartElement("availability", ns);
                if (Legacy.Truthy(rights.GetValueOrDefault("license")))
                {
                    w.WriteStartElement("licence", ns);
                    w.WriteAttributeString("target", S(rights["license"]));
                    w.WriteEndElement();
                }
                foreach (var k in new[] { "holder", "note" })
                {
                    if (Legacy.Truthy(rights.GetValueOrDefault(k)))
                    {
                        w.WriteElementString("p", ns, S(rights[k]));
                    }
                }
                w.WriteEndElement();
            }
            else
            {
                w.WriteElementString("p", ns, "Exported from an SPDF file; no rights statement recorded.");
            }
            w.WriteEndElement();
            w.WriteStartElement("sourceDesc", ns);
            w.WriteStartElement("biblStruct", ns);
            w.WriteStartElement("monogr", ns);
            foreach (var a in TeiNames(md.GetValueOrDefault("author")))
            {
                w.WriteElementString("author", ns, S(a));
            }
            w.WriteElementString("title", ns, S(md.GetValueOrDefault("title")));
            w.WriteStartElement("imprint", ns);
            if (Legacy.Truthy(md.GetValueOrDefault("publisher-place")))
            {
                w.WriteElementString("pubPlace", ns, S(md["publisher-place"]));
            }
            if (Legacy.Truthy(md.GetValueOrDefault("publisher")))
            {
                w.WriteElementString("publisher", ns, S(md["publisher"]));
            }
            if (md.GetValueOrDefault("issued") is Dictionary<string, object?> issued
                && issued.GetValueOrDefault("date-parts") is List<object?> { Count: > 0 } dp
                && dp[0] is List<object?> { Count: > 0 } first && first[0] is { } year)
            {
                w.WriteStartElement("date", ns);
                w.WriteAttributeString("when", S(year));
                w.WriteString(S(year));
                w.WriteEndElement();
            }
            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteStartElement("text", ns);
            w.WriteStartElement("body", ns);
            foreach (var u in GetUnits())
            {
                var a = u.Anchor;
                if (a.Type == "page")
                {
                    w.WriteStartElement("pb", ns);
                    if (StructureExport.Folio(a) is { } n)
                    {
                        w.WriteAttributeString("n", S(n));
                    }
                    if (!string.IsNullOrEmpty(u.Image))
                    {
                        w.WriteAttributeString("facs", S(u.Image));
                    }
                    w.WriteEndElement();
                }
                if (a.Type == "verse")
                {
                    long from = a.GetInteger("line_from") ?? 1;
                    w.WriteStartElement("lg", ns);
                    foreach (var line in u.Text.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0))
                    {
                        w.WriteStartElement("l", ns);
                        w.WriteAttributeString("n", from.ToString(CultureInfo.InvariantCulture));
                        w.WriteString(S(line));
                        w.WriteEndElement();
                        from++;
                    }
                    w.WriteEndElement();
                }
                else
                {
                    foreach (var lines in StructureExport.Paragraphs(u.Text))
                    {
                        string text = string.Join(" ", lines);
                        var turn = StructureExport.SpeakerTurnMatch(text);
                        string? who = turn?.Who ?? (a.Type == "time" ? a.GetString("speaker") : null);
                        if (who is not null)
                        {
                            w.WriteStartElement("u", ns);
                            w.WriteAttributeString("who", S(who));
                            w.WriteString(S(turn?.Text ?? text));
                            w.WriteEndElement();
                        }
                        else
                        {
                            w.WriteElementString("p", ns, S(text));
                        }
                    }
                }
                foreach (var note in u.Notes ?? [])
                {
                    w.WriteStartElement("note", ns);
                    w.WriteAttributeString("place", "foot");
                    w.WriteString(S(note));
                    w.WriteEndElement();
                }
            }
            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteEndDocument();
        }
        return SpdfJson.Utf8.GetString(ms.ToArray()) + "\n";
    }

    private static List<string> TeiNames(object? v) =>
        (v as List<object?> ?? []).OfType<Dictionary<string, object?>>()
            .Select(n => n.GetValueOrDefault("literal") as string is { Length: > 0 } lit
                ? lit
                : string.Join(" ", new[] { "given", "non-dropping-particle", "family" }.Select(k => n.GetValueOrDefault(k) as string).Where(x => !string.IsNullOrEmpty(x))))
            .Where(s => s.Length > 0)
            .ToList();

    /// <summary>
    /// The IIIF Presentation 3 manifest (§19.4) as a JSON value tree: one canvas per unit (page
    /// units labelled with their folio, <c>[folio]</c> when inferred, no label when unnumbered,
    /// and a metadata entry with the physical page), the unit image as a painting annotation and
    /// the text as a supplementing <c>TextualBody</c>; audio and video as one time-based canvas
    /// with a <c>Range</c> per unit; sections as <c>structures</c>. No invented dimensions.
    /// </summary>
    public Dictionary<string, object?> ExportIiifManifest(IiifOptions? options = null)
    {
        options ??= new IiifOptions();
        var doc = GetDocument();
        string baseId = options.Base ?? "spdf:" + DocRef;
        Func<string, string> url = options.ImageUrl ?? (r => r);
        var units = GetUnits();
        static Dictionary<string, object?> O() => new(StringComparer.Ordinal);
        static Dictionary<string, object?> Label(string lang, string text) => new(StringComparer.Ordinal) { [lang] = new List<object?> { text } };
        string lang = string.IsNullOrEmpty(doc.Language) ? "none" : doc.Language;
        var manifest = O();
        manifest["@context"] = "http://iiif.io/api/presentation/3/context.json";
        manifest["id"] = baseId + "/manifest";
        manifest["type"] = "Manifest";
        manifest["label"] = Label(lang, doc.Metadata.TryGetValue("title", out var t) && t is string title ? title : doc.Id);
        static string Span(Anchor a) =>
            "t=" + SpdfJson.FormatNumber(SpdfJson.Round6(a.GetNumber("t0") ?? 0)) + "," + SpdfJson.FormatNumber(SpdfJson.Round6(a.GetNumber("t1") ?? 0));
        bool timed = units.Count > 0 && units.All(u => u.Anchor.Type == "time");
        if (timed)
        {
            string canvasId = baseId + "/canvas/1";
            var canvas = O();
            canvas["id"] = canvasId;
            canvas["type"] = "Canvas";
            double? duration = doc.Duration ?? units[^1].Anchor.GetNumber("t1");
            if (duration is not null)
            {
                canvas["duration"] = duration.Value;
            }
            var painting = new List<object?>();
            if (!string.IsNullOrEmpty(doc.SourceRef))
            {
                painting.Add(new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["id"] = canvasId + "/media",
                    ["type"] = "Annotation",
                    ["motivation"] = "painting",
                    ["target"] = canvasId,
                    ["body"] = new Dictionary<string, object?>(StringComparer.Ordinal)
                    {
                        ["id"] = url(doc.SourceRef),
                        ["type"] = doc.Kind == "video" ? "Video" : "Sound",
                        ["format"] = doc.Mime,
                    },
                });
            }
            canvas["items"] = new List<object?> { new Dictionary<string, object?>(StringComparer.Ordinal) { ["id"] = canvasId + "/page", ["type"] = "AnnotationPage", ["items"] = painting } };
            canvas["annotations"] = new List<object?>
            {
                new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["id"] = canvasId + "/text",
                    ["type"] = "AnnotationPage",
                    ["items"] = units.Select((u, i) => (object?)new Dictionary<string, object?>(StringComparer.Ordinal)
                    {
                        ["id"] = canvasId + "/text/" + (i + 1).ToString(CultureInfo.InvariantCulture),
                        ["type"] = "Annotation",
                        ["motivation"] = "supplementing",
                        ["body"] = TextBody(u.Text, doc.Language),
                        ["target"] = canvasId + "#" + Span(u.Anchor),
                    }).ToList(),
                },
            };
            manifest["items"] = new List<object?> { canvas };
            manifest["structures"] = units.Select((u, i) => (object?)new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["id"] = baseId + "/range/" + (i + 1).ToString(CultureInfo.InvariantCulture),
                ["type"] = "Range",
                ["items"] = new List<object?> { new Dictionary<string, object?>(StringComparer.Ordinal) { ["id"] = canvasId + "#" + Span(u.Anchor), ["type"] = "Canvas" } },
            }).ToList();
            return manifest;
        }
        var canvases = new List<object?>();
        for (int i = 0; i < units.Count; i++)
        {
            var u = units[i];
            string canvasId = baseId + "/canvas/" + (i + 1).ToString(CultureInfo.InvariantCulture);
            var c = O();
            c["id"] = canvasId;
            c["type"] = "Canvas";
            if (u.Anchor.Type == "page")
            {
                if (StructureExport.Folio(u.Anchor) is { } folio)
                {
                    c["label"] = Label("none", folio);
                }
                c["metadata"] = new List<object?>
                {
                    new Dictionary<string, object?>(StringComparer.Ordinal)
                    {
                        ["label"] = Label("en", StructureExport.PhysicalPageLabel),
                        ["value"] = Label("none", SpdfJson.Canonical(u.Anchor["physical"])),
                    },
                };
            }
            else
            {
                c["label"] = Label("none", u.Anchor.Type == "slide" && u.Anchor.GetInteger("n") is long n
                    ? n.ToString(CultureInfo.InvariantCulture)
                    : u.Ord.ToString(CultureInfo.InvariantCulture));
            }
            var painting = new List<object?>();
            if (!string.IsNullOrEmpty(u.Image))
            {
                painting.Add(new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["id"] = canvasId + "/image",
                    ["type"] = "Annotation",
                    ["motivation"] = "painting",
                    ["target"] = canvasId,
                    ["body"] = new Dictionary<string, object?>(StringComparer.Ordinal) { ["id"] = url(u.Image), ["type"] = "Image" },
                });
            }
            c["items"] = new List<object?> { new Dictionary<string, object?>(StringComparer.Ordinal) { ["id"] = canvasId + "/page", ["type"] = "AnnotationPage", ["items"] = painting } };
            if (u.Text.Length > 0)
            {
                c["annotations"] = new List<object?>
                {
                    new Dictionary<string, object?>(StringComparer.Ordinal)
                    {
                        ["id"] = canvasId + "/text",
                        ["type"] = "AnnotationPage",
                        ["items"] = new List<object?>
                        {
                            new Dictionary<string, object?>(StringComparer.Ordinal)
                            {
                                ["id"] = canvasId + "/text/1",
                                ["type"] = "Annotation",
                                ["motivation"] = "supplementing",
                                ["body"] = TextBody(u.Text, doc.Language),
                                ["target"] = canvasId,
                            },
                        },
                    },
                };
            }
            canvases.Add(c);
        }
        manifest["items"] = canvases;
        var sections = GetSections();
        if (sections.Count > 0)
        {
            var index = new Dictionary<string, int>(StringComparer.Ordinal);
            for (int i = 0; i < units.Count; i++)
            {
                index.TryAdd(units[i].Id, i + 1);
            }
            manifest["structures"] = sections.Select(s =>
            {
                int from = index.GetValueOrDefault(s.UnitFrom, 1);
                int to = s.UnitTo is not null && index.TryGetValue(s.UnitTo, out int k) ? k : from;
                return (object?)new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["id"] = baseId + "/range/" + s.Id,
                    ["type"] = "Range",
                    ["label"] = Label("none", s.Title),
                    ["items"] = Enumerable.Range(from, Math.Max(0, to - from + 1))
                        .Select(x => (object?)new Dictionary<string, object?>(StringComparer.Ordinal) { ["id"] = baseId + "/canvas/" + x.ToString(CultureInfo.InvariantCulture), ["type"] = "Canvas" })
                        .ToList(),
                };
            }).ToList();
        }
        return manifest;
    }

    private static Dictionary<string, object?> TextBody(string text, string? language)
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal) { ["type"] = "TextualBody", ["value"] = text, ["format"] = "text/plain" };
        if (!string.IsNullOrEmpty(language))
        {
            body["language"] = language;
        }
        return body;
    }

    /// <summary>The IIIF Presentation 3 manifest as JSON (see <see cref="ExportIiifManifest"/>).</summary>
    public string ExportIiif(IiifOptions? options = null) => SpdfJson.Compact(ExportIiifManifest(options));

    /// <summary>
    /// The page sequence of one structural export (§19.4) as <c>{"pages": [...]}</c>, read back by
    /// parsing the ALTO, TEI or IIIF document this library produces.
    /// </summary>
    public Dictionary<string, object?> ExportStructure(StructureFormat format)
    {
        string exported = format switch
        {
            StructureFormat.Alto => ExportAlto(),
            StructureFormat.Tei => ExportTei(),
            _ => ExportIiif(),
        };
        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["pages"] = StructureExport.PageSequence(format, exported).Cast<object?>().ToList(),
        };
    }
}

public static partial class StructureExport
{
    /// <summary>A speaker turn marked as <c>**Name:** text</c>, or <c>null</c>.</summary>
    internal static (string Who, string Text)? SpeakerTurnMatch(string paragraph)
    {
        var m = SpeakerTurn().Match(paragraph);
        return m.Success ? (m.Groups[1].Value, m.Groups[2].Value) : null;
    }
}
