using System.Globalization;
using System.Text.RegularExpressions;

namespace Spdf;

/// <summary>The legacy 4.x → 5.0 mapping of JSON stored in TEXT columns (specification §20.1).</summary>
public static partial class Legacy
{
    internal static readonly Dictionary<string, string> AnchorKeys = new(StringComparer.Ordinal)
    {
        ["tipo"] = "type", ["fisica"] = "physical", ["impresa"] = "printed", ["romana"] = "roman",
        ["origen"] = "source", ["confianza"] = "confidence", ["hablante"] = "speaker", ["ruta"] = "path",
        ["parrafo"] = "paragraph", ["n"] = "n", ["hoja"] = "sheet", ["filaDesde"] = "row_from", ["filaHasta"] = "row_to",
        ["consultada"] = "accessed", ["region"] = "region",
    };

    internal static readonly Dictionary<string, string> AnchorTypes = new(StringComparer.Ordinal)
    {
        ["pagina"] = "page", ["tiempo"] = "time", ["seccion"] = "section", ["diapositiva"] = "slide",
        ["hoja"] = "sheet", ["web"] = "web", ["imagen"] = "image",
    };

    internal static readonly Dictionary<string, string> AnchorSources = new(StringComparer.Ordinal)
    {
        ["leido"] = "read", ["deducido"] = "inferred", ["epub"] = "epub", ["ninguno"] = "none",
    };

    internal static readonly Dictionary<string, string> Kinds = new(StringComparer.Ordinal)
    {
        ["pdf"] = "pdf", ["pdf_escaneado"] = "scanned_pdf", ["fotos"] = "photos", ["imagen"] = "image",
        ["audio"] = "audio", ["video"] = "video", ["documento"] = "document", ["epub"] = "epub",
        ["presentacion"] = "slides", ["hoja"] = "sheet", ["web"] = "web",
    };

    internal static readonly Dictionary<string, string> Targets = new(StringComparer.Ordinal)
    {
        ["fragmento"] = "fragment", ["unidad"] = "unit", ["figura"] = "figure",
    };

    internal static readonly Dictionary<string, string> Modalities = new(StringComparer.Ordinal)
    {
        ["texto"] = "text", ["imagen"] = "image", ["audio"] = "audio", ["video"] = "video", ["pdf"] = "pdf",
    };

    internal static readonly Dictionary<string, string> MetaKeys = new(StringComparer.Ordinal)
    {
        ["creado"] = "created", ["generador"] = "generator",
    };

    private static readonly Dictionary<string, string> FieldNames = new(StringComparer.Ordinal)
    {
        ["titulo"] = "title", ["subtitulo"] = "subtitle", ["tituloOriginal"] = "original-title", ["autores"] = "author",
        ["editores"] = "editor", ["traductores"] = "translator", ["entrevistadores"] = "interviewer", ["anio"] = "issued",
        ["anioOriginal"] = "original-date", ["editorial"] = "publisher", ["lugar"] = "publisher-place",
        ["revista"] = "container-title", ["contenedor"] = "container-title", ["coleccion"] = "collection-title",
        ["volumen"] = "volume", ["numero"] = "issue", ["paginas"] = "page", ["edicion"] = "edition", ["doi"] = "DOI",
        ["isbn"] = "ISBN", ["url"] = "URL", ["idioma"] = "language", ["tipoCSL"] = "type", ["resumen"] = "abstract",
        ["idiomaOriginal"] = "original_language", ["fecha"] = "issued", ["sinFecha"] = "undated",
    };

    private static readonly Dictionary<string, string> ProvenanceSources = new(StringComparer.Ordinal)
    {
        ["lectura"] = "reading", ["usuario"] = "user", ["colofon"] = "colophon", ["impresores"] = "printers",
    };

    private static readonly Dictionary<string, string> DefaultCslType = new(StringComparer.Ordinal)
    {
        ["audio"] = "speech", ["video"] = "motion_picture", ["web"] = "webpage", ["presentacion"] = "speech",
        ["hoja"] = "dataset", ["imagen"] = "graphic", ["fotos"] = "graphic",
    };

    private static readonly (string From, string To)[] SimpleFields =
    [
        ("editorial", "publisher"), ("lugar", "publisher-place"), ("coleccion", "collection-title"),
        ("volumen", "volume"), ("numero", "issue"), ("paginas", "page"), ("edicion", "edition"), ("doi", "DOI"),
        ("isbn", "ISBN"), ("url", "URL"), ("idioma", "language"), ("resumen", "abstract"),
    ];

    private static readonly (string From, string To)[] NameLists =
    [
        ("autores", "author"), ("editores", "editor"), ("traductores", "translator"), ("entrevistadores", "interviewer"),
    ];

    [GeneratedRegex("^(-?[0-9]{1,4})(?:-([0-9]{1,2})(?:-([0-9]{1,2}))?)?", RegexOptions.CultureInvariant)]
    private static partial Regex IsoDate();

    /// <summary>Converts a legacy (Spanish) anchor value to 5.0; values that are not objects are returned as they are.</summary>
    public static object? MapAnchor(object? value)
    {
        if (value is not Dictionary<string, object?> m)
        {
            return value;
        }
        var o = new Dictionary<string, object?>(m.Count, StringComparer.Ordinal);
        foreach (var (k, v0) in m)
        {
            object? v = v0;
            if (k == "tipo" && v is string t && AnchorTypes.TryGetValue(t, out var mt))
            {
                v = mt;
            }
            else if (k == "origen" && v is string s && AnchorSources.TryGetValue(s, out var ms))
            {
                v = ms;
            }
            o[AnchorKeys.GetValueOrDefault(k, k)] = v;
        }
        return o;
    }

    /// <summary>
    /// Converts legacy <c>MetadatosDocumento</c> to a CSL-JSON item plus the <c>spdf</c>
    /// extension object. <paramref name="legacyKind"/> is <c>documentos.tipo</c>.
    /// </summary>
    public static object? MapMetadata(object? value, string legacyKind)
    {
        if (value is not Dictionary<string, object?> m)
        {
            return value;
        }
        bool Has(string k) => m.TryGetValue(k, out var v) && v is not null && !(v is string { Length: 0 }) && !(v is List<object?> { Count: 0 });
        object? Get(string k) => m.GetValueOrDefault(k);

        var item = new Dictionary<string, object?>(StringComparer.Ordinal);
        var ext = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (Truthy(Get("tipoCSL")))
        {
            item["type"] = Get("tipoCSL");
        }
        else if (Truthy(Get("revista")))
        {
            item["type"] = "article-journal";
        }
        else
        {
            item["type"] = DefaultCslType.GetValueOrDefault(legacyKind, "book");
        }
        string title = Get("titulo") as string ?? "";
        if (Has("subtitulo"))
        {
            item["title"] = title + ": " + PyStr(Get("subtitulo"));
            item["title-short"] = title;
            ext["subtitle"] = Get("subtitulo");
        }
        else
        {
            item["title"] = title;
        }
        if (Has("tituloOriginal"))
        {
            item["original-title"] = Get("tituloOriginal");
        }
        var orcid = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (from, to) in NameLists)
        {
            if (Get(from) is not List<object?> people)
            {
                continue;
            }
            var names = new List<object?>();
            foreach (var e in people)
            {
                if (e is not Dictionary<string, object?> p)
                {
                    continue;
                }
                var n = new Dictionary<string, object?>(StringComparer.Ordinal);
                if (Truthy(p.GetValueOrDefault("apellidos")))
                {
                    n["family"] = p["apellidos"];
                }
                if (Truthy(p.GetValueOrDefault("nombre")))
                {
                    n["given"] = p["nombre"];
                }
                if (n.Count > 0)
                {
                    names.Add(n);
                }
                if (Truthy(p.GetValueOrDefault("orcid")))
                {
                    string key = p.GetValueOrDefault("apellidos") as string ?? "";
                    if (p.GetValueOrDefault("nombre") is string { Length: > 0 } given)
                    {
                        key += ", " + given;
                    }
                    orcid[key] = p["orcid"];
                }
            }
            if (names.Count > 0)
            {
                item[to] = names;
            }
        }
        List<object?>? fecha = Has("fecha") && Get("fecha") is string f ? DateParts(f) : null;
        if (fecha is not null && (!Has("anio") || SpdfJson.JsonEquals(fecha[0], Get("anio"))))
        {
            item["issued"] = DateValue(fecha);
        }
        else if (Has("anio"))
        {
            item["issued"] = DateValue([Get("anio")]);
        }
        if (Has("anioOriginal"))
        {
            item["original-date"] = DateValue([Get("anioOriginal")]);
        }
        foreach (var (from, to) in SimpleFields)
        {
            if (Has(from))
            {
                item[to] = Get(from);
            }
        }
        if (Has("revista"))
        {
            item["container-title"] = Get("revista");
        }
        else if (Has("contenedor"))
        {
            item["container-title"] = Get("contenedor");
        }
        if (Has("idiomaOriginal"))
        {
            ext["original_language"] = Get("idiomaOriginal");
        }
        if (Has("sinFecha"))
        {
            var undated = new Dictionary<string, object?>(StringComparer.Ordinal);
            if (Get("sinFecha") is Dictionary<string, object?> sf)
            {
                if (sf.GetValueOrDefault("desde") is { } desde)
                {
                    undated["from"] = desde;
                }
                if (sf.GetValueOrDefault("hasta") is { } hasta)
                {
                    undated["to"] = hasta;
                }
                if (Truthy(sf.GetValueOrDefault("fundamento")))
                {
                    undated["basis"] = sf["fundamento"];
                }
            }
            ext["undated"] = undated;
        }
        if (Has("procedencia"))
        {
            var prov = new Dictionary<string, object?>(StringComparer.Ordinal);
            if (Get("procedencia") is Dictionary<string, object?> pr)
            {
                foreach (var (field, val) in pr)
                {
                    var e = val as Dictionary<string, object?>;
                    object? source = e?.GetValueOrDefault("fuente");
                    if (source is string s && ProvenanceSources.TryGetValue(s, out var mapped))
                    {
                        source = mapped;
                    }
                    prov[FieldNames.GetValueOrDefault(field, field)] = new Dictionary<string, object?>(StringComparer.Ordinal)
                    {
                        ["source"] = source,
                        ["confidence"] = e?.GetValueOrDefault("confianza"),
                    };
                }
            }
            ext["provenance"] = prov;
        }
        if (orcid.Count > 0)
        {
            ext["orcid"] = orcid;
        }
        if (ext.Count > 0)
        {
            item["spdf"] = ext;
        }
        return item;
    }

    private static Dictionary<string, object?> DateValue(List<object?> parts) =>
        new(StringComparer.Ordinal) { ["date-parts"] = new List<object?> { parts } };

    /// <summary>"1977-03-20" (or "1977-03", "1977", "-0350") → CSL date-parts.</summary>
    internal static List<object?>? DateParts(string iso)
    {
        var m = IsoDate().Match(iso.Trim());
        if (!m.Success)
        {
            return null;
        }
        var parts = new List<object?>();
        for (int g = 1; g <= 3; g++)
        {
            if (m.Groups[g].Success)
            {
                parts.Add(long.Parse(m.Groups[g].Value, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture));
            }
        }
        return parts;
    }

    /// <summary>JSON truthiness (as in JavaScript/Python): null, false, 0, "" and empty containers are false.</summary>
    internal static bool Truthy(object? v) => v switch
    {
        null => false,
        bool b => b,
        string s => s.Length > 0,
        long l => l != 0,
        double d => d != 0,
        List<object?> l => l.Count > 0,
        Dictionary<string, object?> o => o.Count > 0,
        _ => true,
    };

    private static string PyStr(object? v) => v switch
    {
        string s => s,
        bool b => b ? "True" : "False",
        long l => l.ToString(CultureInfo.InvariantCulture),
        double d => d.ToString("R", CultureInfo.InvariantCulture),
        _ => SpdfJson.Compact(v),
    };

    /// <summary>A legacy storage reference: "" → null (kept as "" for figures), a blob key → "blob:key", anything else verbatim.</summary>
    internal static object? MapReference(object? v, IReadOnlySet<string> blobKeys, bool keepEmpty)
    {
        if (v is not string s)
        {
            return v;
        }
        if (s.Length == 0)
        {
            return keepEmpty ? "" : null;
        }
        return blobKeys.Contains(s) ? "blob:" + s : s;
    }
}
