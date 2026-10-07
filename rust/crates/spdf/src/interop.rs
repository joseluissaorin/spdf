//! Optional exports of SPEC §19.4: ALTO 4, minimal TEI P5 and IIIF
//! Presentation 3.
//!
//! The exports never invent data: ALTO pages carry `PRINTED_IMG_NR` only for
//! folios that were read (not inferred), TEI `pb/@n` and IIIF canvas labels
//! write the folio as the short citation does (`[iv]` for inferred), and
//! unnumbered pages have neither. Text is exported per unit (SPDF stores no
//! word boxes), with the light Markdown markers removed.
//!
//! [`page_structure`] reads the page sequence back from an export, which is
//! what the conformance suite compares.
//!
//! ```no_run
//! let doc = spdf::Spdf::open("quijote.spdf")?;
//! std::fs::write("quijote.alto.xml", spdf::interop::to_alto(&doc)?)?;
//! std::fs::write("quijote.tei.xml", spdf::interop::to_tei(&doc)?)?;
//! let manifest = spdf::interop::to_iiif(&doc, "https://example.org/iiif/quijote")?;
//! # let _ = manifest;
//! # Ok::<(), spdf::Error>(())
//! ```

use serde_json::{json, Map, Value};

use crate::error::{Error, Result};
use crate::model::{Document, Unit};
use crate::reader::Spdf;

const ALTO_NS: &str = "http://www.loc.gov/standards/alto/ns-v4#";
const ALTO_XSD: &str = "http://www.loc.gov/standards/alto/v4/alto-4-4.xsd";
const TEI_NS: &str = "http://www.tei-c.org/ns/1.0";
const IIIF_CONTEXT: &str = "http://iiif.io/api/presentation/3/context.json";

/// Escapes text for XML content and attribute values (double quotes).
pub fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c if (c as u32) < 0x20 && !matches!(c, '\n' | '\t' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

fn xml_unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Removes light Markdown markers from one line (headings, quotes, list
/// bullets, `**`, `__`, backticks).
fn clean_line(line: &str) -> String {
    let t = line.trim_start();
    let indent = line.len() - t.len();
    let mut rest = line;
    if indent <= 3 {
        let hashes = t.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes) && t[hashes..].starts_with(char::is_whitespace) {
            rest = t[hashes..].trim_start();
        } else if let Some(r) = t.strip_prefix('>') {
            rest = r.strip_prefix(' ').unwrap_or(r);
        } else if let Some(r) = t
            .strip_prefix("- ")
            .or_else(|| t.strip_prefix("* "))
            .or_else(|| t.strip_prefix("+ "))
        {
            if r.starts_with(|c: char| !c.is_whitespace()) {
                rest = r;
            }
        }
    }
    rest.replace("**", "").replace("__", "").replace('`', "")
}

fn paragraphs(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur: Vec<&str> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            if !cur.is_empty() {
                out.push(cur.join("\n"));
                cur.clear();
            }
        } else {
            cur.push(line);
        }
    }
    if !cur.is_empty() {
        out.push(cur.join("\n"));
    }
    out
}

fn anchor_str(a: &Value, k: &str) -> Option<String> {
    match a.get(k)? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// The folio of a page anchor as the short citation prints it (`[iv]` when
/// inferred), or `None` for unnumbered pages.
pub fn page_label(anchor: &Value) -> Option<String> {
    let p = anchor_str(anchor, "printed")?;
    Some(
        if anchor.get("source").and_then(Value::as_str) == Some("inferred") {
            format!("[{p}]")
        } else {
            p
        },
    )
}

fn is_page(u: &Unit) -> bool {
    u.anchor.get("type").and_then(Value::as_str) == Some("page")
}

fn physical(u: &Unit) -> i64 {
    u.anchor
        .get("physical")
        .and_then(Value::as_f64)
        .map(|f| f as i64)
        .unwrap_or(u.ord)
}

fn display_title(d: &Document) -> String {
    d.metadata
        .get("title")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| d.title.clone())
        .unwrap_or_else(|| d.id.clone())
}

/// Width and height of a PNG, JPEG or GIF image, if recognizable.
pub fn image_size(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() >= 24 && data.starts_with(b"\x89PNG\r\n\x1a\n") {
        let w = u32::from_be_bytes(data[16..20].try_into().ok()?);
        let h = u32::from_be_bytes(data[20..24].try_into().ok()?);
        return Some((w, h));
    }
    if data.len() >= 10 && (data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a")) {
        let w = u16::from_le_bytes([data[6], data[7]]) as u32;
        let h = u16::from_le_bytes([data[8], data[9]]) as u32;
        return Some((w, h));
    }
    if data.len() >= 4 && data[0] == 0xFF && data[1] == 0xD8 {
        let mut i = 2;
        while i + 9 < data.len() {
            if data[i] != 0xFF {
                i += 1;
                continue;
            }
            let marker = data[i + 1];
            let len = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
            if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
                let h = u16::from_be_bytes([data[i + 5], data[i + 6]]) as u32;
                let w = u16::from_be_bytes([data[i + 7], data[i + 8]]) as u32;
                return Some((w, h));
            }
            i += 2 + len;
        }
    }
    None
}

fn alto_block(id: &str, text: &str, tag: &str, extra: &str, out: &mut Vec<String>) {
    for (bi, para) in paragraphs(text).iter().enumerate() {
        let bid = format!("{id}_{}", bi + 1);
        out.push(format!("<{tag} ID=\"{bid}\"{extra}>"));
        let mut li = 0;
        for line in para.lines() {
            let words: Vec<String> = clean_line(line)
                .split_whitespace()
                .map(str::to_string)
                .collect();
            if words.is_empty() {
                continue;
            }
            li += 1;
            out.push(format!("<TextLine ID=\"{bid}_L{li}\">"));
            let mut parts = String::new();
            for (wi, w) in words.iter().enumerate() {
                if wi > 0 {
                    parts.push_str("<SP/>");
                }
                parts.push_str(&format!(
                    "<String ID=\"{bid}_L{li}_W{}\" CONTENT=\"{}\"/>",
                    wi + 1,
                    xml_escape(w)
                ));
            }
            out.push(parts);
            out.push("</TextLine>".into());
        }
        out.push(format!("</{tag}>"));
    }
}

/// ALTO 4 XML with one `Page` per page unit.
pub fn to_alto(doc: &Spdf) -> Result<String> {
    let d = doc.document()?;
    let units = doc.units()?;
    let pages: Vec<&Unit> = units.iter().filter(|u| is_page(u)).collect();
    if pages.is_empty() {
        return Err(Error::invalid(
            "ALTO export needs page units; this document has none (try IIIF or TEI)",
        ));
    }
    let mut out = vec![
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>".to_string(),
        format!(
            "<alto xmlns=\"{ALTO_NS}\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" \
             xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" \
             xsi:schemaLocation=\"{ALTO_NS} {ALTO_XSD}\">"
        ),
        "<Description>".into(),
        "<MeasurementUnit>pixel</MeasurementUnit>".into(),
        "<sourceImageInformation>".into(),
        format!("<fileName>{}</fileName>", xml_escape(&display_title(&d))),
        format!(
            "<fileIdentifier>{}</fileIdentifier>",
            xml_escape(&d.docref())
        ),
        "</sourceImageInformation>".into(),
        "<Processing ID=\"PROC_SPDF\">".into(),
        "<processingStepDescription>Export from SPDF</processingStepDescription>".into(),
        "<processingSoftware>".into(),
        "<softwareName>spdf (Rust)</softwareName>".into(),
        format!("<softwareVersion>{}</softwareVersion>", crate::VERSION),
        "</processingSoftware>".into(),
        "</Processing>".into(),
        "</Description>".into(),
        "<Tags>".into(),
        "<StructureTag ID=\"TAG_NOTE\" LABEL=\"footnote\"/>".into(),
        "</Tags>".into(),
        "<Layout>".into(),
    ];
    for u in pages {
        let p = physical(u);
        let pid = format!("P{p}");
        let mut attrs = vec![format!("ID=\"{pid}\""), format!("PHYSICAL_IMG_NR=\"{p}\"")];
        let inferred = u.anchor.get("source").and_then(Value::as_str) == Some("inferred");
        if let (Some(printed), false) = (anchor_str(&u.anchor, "printed"), inferred) {
            attrs.push(format!("PRINTED_IMG_NR=\"{}\"", xml_escape(&printed)));
        }
        if let Some(img) = &u.image {
            if let Ok(Some(b)) = doc.resolve_image(img) {
                if let Some((w, h)) = image_size(&b.data) {
                    attrs.push(format!("WIDTH=\"{w}\" HEIGHT=\"{h}\""));
                }
            }
        }
        attrs.push(format!(
            "PC=\"{}\"",
            crate::canon::format_number((u.confidence.clamp(0.0, 1.0) * 1e4).round() / 1e4)
        ));
        out.push(format!("<Page {}>", attrs.join(" ")));
        if let Some(h) = u.header.as_deref().filter(|h| !h.is_empty()) {
            out.push(format!("<TopMargin ID=\"{pid}_TM\">"));
            alto_block(&format!("{pid}_TM_B"), h, "TextBlock", "", &mut out);
            out.push("</TopMargin>".into());
        }
        if let Some(f) = u.footer.as_deref().filter(|f| !f.is_empty()) {
            out.push(format!("<BottomMargin ID=\"{pid}_BM\">"));
            alto_block(&format!("{pid}_BM_B"), f, "TextBlock", "", &mut out);
            out.push("</BottomMargin>".into());
        }
        out.push(format!("<PrintSpace ID=\"{pid}_PS\">"));
        alto_block(&format!("{pid}_B"), &u.text, "TextBlock", "", &mut out);
        let notes: Vec<String> = u
            .notes
            .as_ref()
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|n| n.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        if !notes.is_empty() {
            alto_block(
                &format!("{pid}_N"),
                &notes.join("\n\n"),
                "TextBlock",
                " TAGREFS=\"TAG_NOTE\"",
                &mut out,
            );
        }
        out.push("</PrintSpace>".into());
        out.push("</Page>".into());
    }
    out.push("</Layout>".into());
    out.push("</alto>".into());
    out.push(String::new());
    Ok(out.join("\n"))
}

fn person(p: &Value) -> String {
    if let Some(l) = p
        .get("literal")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        return l.to_string();
    }
    let family: Vec<&str> = ["non-dropping-particle", "family"]
        .iter()
        .filter_map(|k| p.get(*k).and_then(Value::as_str).filter(|s| !s.is_empty()))
        .collect();
    let family = family.join(" ");
    let given = p.get("given").and_then(Value::as_str).unwrap_or("");
    match (family.is_empty(), given.is_empty()) {
        (false, false) => format!("{family}, {given}"),
        (false, true) => family,
        _ => given.to_string(),
    }
}

fn tei_year(md: &Value) -> Option<String> {
    let parts = md.get("issued")?.get("date-parts")?.get(0)?.as_array()?;
    let mut out = Vec::new();
    for (i, x) in parts.iter().enumerate() {
        let n = x
            .as_i64()
            .or_else(|| x.as_str().and_then(|s| s.trim().parse().ok()))?;
        out.push(if i == 0 {
            format!("{n:04}")
        } else {
            format!("{n:02}")
        });
    }
    if out.is_empty() {
        None
    } else {
        Some(out.join("-"))
    }
}

fn tei_header(d: &Document) -> Vec<String> {
    let md = &d.metadata;
    let people = |k: &str| -> Vec<String> {
        md.get(k)
            .and_then(Value::as_array)
            .map(|a| a.iter().map(person).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default()
    };
    let mut out = vec![
        "<teiHeader>".to_string(),
        "<fileDesc>".into(),
        "<titleStmt>".into(),
        format!("<title>{}</title>", xml_escape(&display_title(d))),
    ];
    for a in people("author") {
        out.push(format!("<author>{}</author>", xml_escape(&a)));
    }
    for e in people("editor") {
        out.push(format!("<editor>{}</editor>", xml_escape(&e)));
    }
    out.push("</titleStmt>".into());
    out.push("<publicationStmt>".into());
    out.push(format!(
        "<distributor>Exported from SPDF with spdf (Rust) {}</distributor>",
        crate::VERSION
    ));
    out.push(format!(
        "<idno type=\"SPDF\">spdf:{}</idno>",
        xml_escape(&d.docref())
    ));
    if let Some(r) = d
        .rights
        .as_ref()
        .and_then(Value::as_object)
        .filter(|r| !r.is_empty())
    {
        let lic = r.get("license").and_then(Value::as_str).unwrap_or("");
        let note: Vec<&str> = ["holder", "note"]
            .iter()
            .filter_map(|k| r.get(*k).and_then(Value::as_str).filter(|s| !s.is_empty()))
            .collect();
        let attr = if lic.starts_with("http") {
            format!(" target=\"{}\"", xml_escape(lic))
        } else {
            String::new()
        };
        let text: Vec<&str> = std::iter::once(lic)
            .filter(|s| !s.is_empty())
            .chain(note.iter().copied())
            .collect();
        out.push(format!(
            "<availability><licence{attr}>{}</licence></availability>",
            xml_escape(&text.join(" "))
        ));
    }
    out.push("</publicationStmt>".into());
    out.push("<sourceDesc>".into());
    out.push("<bibl>".into());
    out.push(format!("<title>{}</title>", xml_escape(&display_title(d))));
    for a in people("author") {
        out.push(format!("<author>{}</author>", xml_escape(&a)));
    }
    for (csl, open, close) in [
        ("container-title", "title level=\"m\"", "title"),
        ("publisher-place", "pubPlace", "pubPlace"),
        ("publisher", "publisher", "publisher"),
        ("edition", "edition", "edition"),
        ("collection-title", "series", "series"),
    ] {
        if let Some(v) = md
            .get(csl)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            out.push(format!("<{open}>{}</{close}>", xml_escape(v)));
        }
    }
    if let Some(y) = tei_year(md) {
        out.push(format!("<date when=\"{y}\">{y}</date>"));
    }
    for (csl, kind) in [("DOI", "DOI"), ("ISBN", "ISBN"), ("URL", "URI")] {
        if let Some(v) = md
            .get(csl)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            out.push(format!("<idno type=\"{kind}\">{}</idno>", xml_escape(v)));
        }
    }
    out.push("</bibl>".into());
    out.push("</sourceDesc>".into());
    out.push("</fileDesc>".into());
    if let Some(l) = &d.language {
        out.push("<profileDesc>".into());
        out.push("<langUsage>".into());
        out.push(format!("<language ident=\"{}\"/>", xml_escape(l)));
        out.push("</langUsage>".into());
        out.push("</profileDesc>".into());
    }
    out.push("</teiHeader>".into());
    out
}

fn speaker_split(para: &str) -> Option<(String, &str)> {
    let rest = para.strip_prefix("**")?;
    let end = rest.find(":**")?;
    let who = &rest[..end];
    if who.is_empty() || who.contains('*') || who.chars().count() > 80 {
        return None;
    }
    Some((who.trim().to_string(), rest[end + 3..].trim_start()))
}

fn xml_id(s: &str) -> String {
    let mut out = String::new();
    let mut last_sep = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') {
            out.push(c);
            last_sep = false;
        } else if !last_sep {
            out.push('_');
            last_sep = true;
        }
    }
    out
}

fn tei_unit(u: &Unit, out: &mut Vec<String>) {
    let a = &u.anchor;
    let t = a.get("type").and_then(Value::as_str).unwrap_or("");
    let notes: Vec<String> = u
        .notes
        .as_ref()
        .and_then(Value::as_array)
        .map(|x| {
            x.iter()
                .filter_map(|n| n.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let note_lines = |out: &mut Vec<String>| {
        for n in &notes {
            out.push(format!(
                "<note place=\"foot\">{}</note>",
                xml_escape(&clean_line(n))
            ));
        }
    };
    if t == "page" {
        let mut attrs = String::new();
        if let Some(n) = page_label(a) {
            attrs.push_str(&format!(" n=\"{}\"", xml_escape(&n)));
        }
        if let Some(img) = &u.image {
            attrs.push_str(&format!(" facs=\"{}\"", xml_escape(img)));
        }
        out.push(format!("<pb{attrs}/>"));
    }
    let line_from = a.get("line_from").and_then(Value::as_i64);
    match (t, line_from) {
        ("verse", Some(from)) => {
            out.push("<lg>".into());
            for (i, line) in u.text.lines().filter(|l| !l.trim().is_empty()).enumerate() {
                out.push(format!(
                    "<l n=\"{}\">{}</l>",
                    from + i as i64,
                    xml_escape(clean_line(line).trim())
                ));
            }
            out.push("</lg>".into());
        }
        ("time", _) => {
            for para in paragraphs(&u.text) {
                let (who, body) = match speaker_split(&para) {
                    Some((w, b)) => (Some(w), b.to_string()),
                    None => (anchor_str(a, "speaker"), para.clone()),
                };
                let who_attr = who
                    .map(|w| format!(" who=\"#{}\"", xml_escape(&xml_id(&w))))
                    .unwrap_or_default();
                out.push(format!(
                    "<u{who_attr}>{}</u>",
                    xml_escape(&clean_line(&body))
                ));
            }
        }
        ("section" | "web", _)
            if a.get("path")
                .and_then(Value::as_array)
                .map(|p| !p.is_empty())
                .unwrap_or(false) =>
        {
            let head = a
                .get("path")
                .and_then(Value::as_array)
                .and_then(|p| p.last())
                .and_then(Value::as_str)
                .unwrap_or("");
            out.push("<div>".into());
            out.push(format!("<head>{}</head>", xml_escape(head)));
            for para in paragraphs(&u.text) {
                out.push(format!("<p>{}</p>", xml_escape(&clean_line(&para))));
            }
            note_lines(out);
            out.push("</div>".into());
            return;
        }
        _ => {
            for para in paragraphs(&u.text) {
                out.push(format!("<p>{}</p>", xml_escape(&clean_line(&para))));
            }
        }
    }
    note_lines(out);
}

/// A minimal TEI P5 document: header from the metadata, `pb` before each
/// page, paragraphs, verse lines, speaker turns and footnotes.
pub fn to_tei(doc: &Spdf) -> Result<String> {
    let d = doc.document()?;
    let lang_attr = d
        .language
        .as_ref()
        .map(|l| format!(" xml:lang=\"{}\"", xml_escape(l)))
        .unwrap_or_default();
    let mut out = vec![
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>".to_string(),
        format!("<TEI xmlns=\"{TEI_NS}\"{lang_attr}>"),
    ];
    out.extend(tei_header(&d));
    out.push("<text>".into());
    out.push("<body>".into());
    for u in doc.units()? {
        tei_unit(&u, &mut out);
    }
    out.push("</body>".into());
    out.push("</text>".into());
    out.push("</TEI>".into());
    out.push(String::new());
    Ok(out.join("\n"))
}

fn lang_map(lang: &str, text: &str) -> Value {
    json!({ lang: [text] })
}

fn rights_uri(rights: Option<&Value>) -> Option<String> {
    let lic = rights?.get("license")?.as_str()?;
    let ok = lic.starts_with("http://creativecommons.org/")
        || lic.starts_with("https://creativecommons.org/")
        || lic.starts_with("http://rightsstatements.org/")
        || lic.starts_with("https://rightsstatements.org/");
    ok.then(|| lic.replacen("https://", "http://", 1))
}

/// A IIIF Presentation 3 manifest: one canvas per unit in `ord` order
/// (page canvases labelled with their folio, unnumbered pages unlabelled),
/// the unit image as painting annotation and the text as `supplementing`
/// annotation; audio and video become one time-based canvas with a range
/// per unit. `base` is the URL prefix of the generated ids.
pub fn to_iiif(doc: &Spdf, base: &str) -> Result<Value> {
    let d = doc.document()?;
    let base = base.trim_end_matches('/');
    let lang = d.language.clone().unwrap_or_else(|| "none".into());
    let units = doc.units()?;
    let mut manifest = Map::new();
    manifest.insert("@context".into(), Value::from(IIIF_CONTEXT));
    manifest.insert("id".into(), Value::from(format!("{base}/manifest")));
    manifest.insert("type".into(), Value::from("Manifest"));
    manifest.insert("label".into(), lang_map(&lang, &display_title(&d)));
    let mut metadata = Vec::new();
    if let Some(a) = &d.authors {
        metadata.push(json!({"label": {"en": ["Author"]}, "value": {"none": [a]}}));
    }
    if let Some(y) = d.year {
        metadata.push(json!({"label": {"en": ["Year"]}, "value": {"none": [y.to_string()]}}));
    }
    metadata.push(
        json!({"label": {"en": ["SPDF"]}, "value": {"none": [format!("spdf:{}", d.docref())]}}),
    );
    manifest.insert("metadata".into(), Value::Array(metadata));
    if let Some(r) = rights_uri(d.rights.as_ref()) {
        manifest.insert("rights".into(), Value::from(r));
    }
    let timed = !units.is_empty()
        && units
            .iter()
            .all(|u| u.anchor.get("type").and_then(Value::as_str) == Some("time"));
    let mut items = Vec::new();
    let mut structures = Vec::new();
    if timed {
        let cid = format!("{base}/canvas/recording");
        let duration = d.duration.or_else(|| {
            units
                .iter()
                .filter_map(|u| u.anchor.get("t1").and_then(Value::as_f64))
                .fold(None, |m: Option<f64>, x| Some(m.map_or(x, |m| m.max(x))))
        });
        let mut canvas = Map::new();
        canvas.insert("id".into(), Value::from(cid.clone()));
        canvas.insert("type".into(), Value::from("Canvas"));
        if let Some(du) = duration {
            canvas.insert("duration".into(), json!(du));
        }
        let mut supplementing = Vec::new();
        for (i, u) in units.iter().enumerate() {
            let t0 = u.anchor.get("t0").and_then(Value::as_f64).unwrap_or(0.0);
            let t1 = u.anchor.get("t1").and_then(Value::as_f64).unwrap_or(t0);
            let target = format!(
                "{cid}#t={},{}",
                crate::canon::format_number(t0),
                crate::canon::format_number(t1)
            );
            supplementing.push(json!({
                "id": format!("{base}/annotation/text/{}", i + 1), "type": "Annotation",
                "motivation": "supplementing",
                "body": {"type": "TextualBody", "value": u.text, "format": "text/plain", "language": lang},
                "target": target
            }));
            structures.push(json!({
                "id": format!("{base}/range/{}", xml_id(&u.id)), "type": "Range",
                "label": {"none": [crate::cite::format_time(t0)]},
                "items": [{"id": target, "type": "Canvas"}]
            }));
        }
        if let Some(src) = &d.source_ref {
            let body_id = if let Some(k) = src.strip_prefix("blob:") {
                format!("{base}/blob/{k}")
            } else {
                src.clone()
            };
            let kind = if d.mime.starts_with("video/") {
                "Video"
            } else {
                "Sound"
            };
            let mut body = json!({"id": body_id, "type": kind, "format": d.mime});
            if let Some(du) = duration {
                body["duration"] = json!(du);
            }
            canvas.insert(
                "items".into(),
                json!([{"id": format!("{cid}/page/painting"), "type": "AnnotationPage", "items": [
                    {"id": format!("{cid}/painting"), "type": "Annotation", "motivation": "painting",
                     "body": body, "target": cid}
                ]}]),
            );
        }
        canvas.insert(
            "annotations".into(),
            json!([{"id": format!("{cid}/page/text"), "type": "AnnotationPage", "items": supplementing}]),
        );
        items.push(Value::Object(canvas));
    } else {
        for u in &units {
            let cid = format!("{base}/canvas/{}", xml_id(&u.id));
            let mut canvas = Map::new();
            canvas.insert("id".into(), Value::from(cid.clone()));
            canvas.insert("type".into(), Value::from("Canvas"));
            let t = u.anchor.get("type").and_then(Value::as_str).unwrap_or("");
            let label = if t == "page" {
                page_label(&u.anchor)
            } else if t == "slide" {
                anchor_str(&u.anchor, "n")
            } else {
                Some(u.ord.to_string())
            };
            if let Some(l) = label {
                canvas.insert("label".into(), json!({"none": [l]}));
            }
            let mut size = None;
            if let Some(img) = &u.image {
                let blob = doc.resolve_image(img).ok().flatten();
                size = blob.as_ref().and_then(|b| image_size(&b.data));
                let (img_id, mime) = match (&blob, img.strip_prefix("blob:")) {
                    (Some(b), Some(k)) => (format!("{base}/blob/{k}"), b.mime.clone()),
                    _ => (img.clone(), "image/jpeg".to_string()),
                };
                let mut body = json!({"id": img_id, "type": "Image", "format": mime});
                if let Some((w, h)) = size {
                    body["width"] = json!(w);
                    body["height"] = json!(h);
                }
                canvas.insert(
                    "items".into(),
                    json!([{"id": format!("{cid}/page/painting"), "type": "AnnotationPage", "items": [
                        {"id": format!("{cid}/painting"), "type": "Annotation", "motivation": "painting",
                         "body": body, "target": cid}
                    ]}]),
                );
            }
            if let Some((w, h)) = size {
                canvas.insert("width".into(), json!(w));
                canvas.insert("height".into(), json!(h));
            }
            if !u.text.is_empty() {
                canvas.insert(
                    "annotations".into(),
                    json!([{"id": format!("{cid}/page/text"), "type": "AnnotationPage", "items": [
                        {"id": format!("{cid}/text"), "type": "Annotation", "motivation": "supplementing",
                         "body": {"type": "TextualBody", "value": u.text, "format": "text/plain", "language": lang},
                         "target": cid}
                    ]}]),
                );
            }
            items.push(Value::Object(canvas));
        }
        let canvas_of = |unit: &str| format!("{base}/canvas/{}", xml_id(unit));
        for s in doc.sections()? {
            let from = units.iter().position(|u| u.id == s.unit_from);
            let to = s
                .unit_to
                .as_ref()
                .and_then(|t| units.iter().position(|u| &u.id == t))
                .or(from);
            if let (Some(a), Some(b)) = (from, to) {
                let canvases: Vec<Value> = units[a.min(b)..=a.max(b)]
                    .iter()
                    .map(|u| json!({"id": canvas_of(&u.id), "type": "Canvas"}))
                    .collect();
                structures.push(json!({
                    "id": format!("{base}/range/{}", xml_id(&s.id)), "type": "Range",
                    "label": lang_map(&lang, &s.title), "items": canvases
                }));
            }
        }
    }
    manifest.insert("items".into(), Value::Array(items));
    if !structures.is_empty() {
        manifest.insert("structures".into(), Value::Array(structures));
    }
    Ok(Value::Object(manifest))
}

fn xml_attr(tag: &str, name: &str) -> Option<String> {
    let pat = format!(" {name}=\"");
    let i = tag.find(&pat)? + pat.len();
    let j = tag[i..].find('"')? + i;
    Some(xml_unescape(&tag[i..j]))
}

fn xml_tags<'a>(xml: &'a str, name: &str) -> Vec<&'a str> {
    let open = format!("<{name}");
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find(&open) {
        let after = &rest[i + open.len()..];
        if after.starts_with([' ', '/', '>']) {
            let end = after.find('>').map(|e| e + 1).unwrap_or(after.len());
            out.push(&rest[i..i + open.len() + end]);
        }
        rest = &rest[i + open.len()..];
    }
    out
}

/// The page sequence of an export (`alto`, `tei` or `iiif`), read back from
/// the exported document: `{"physical","printed"}` per ALTO `Page`, `{"n"}`
/// per TEI `pb`, `{"label"}` per IIIF page canvas.
pub fn page_structure(doc: &Spdf, format: &str) -> Result<Value> {
    let pages: Vec<Value> = match format {
        "alto" => {
            let xml = to_alto(doc)?;
            xml_tags(&xml, "Page")
                .iter()
                .map(|t| {
                    let p = xml_attr(t, "PHYSICAL_IMG_NR").and_then(|x| x.parse::<i64>().ok());
                    json!({"physical": p, "printed": xml_attr(t, "PRINTED_IMG_NR")})
                })
                .collect()
        }
        "tei" => {
            let xml = to_tei(doc)?;
            xml_tags(&xml, "pb")
                .iter()
                .map(|t| json!({"n": xml_attr(t, "n")}))
                .collect()
        }
        "iiif" => {
            let m = to_iiif(doc, "https://example.org/iiif/spdf")?;
            let page_ids: Vec<String> = doc
                .units()?
                .iter()
                .filter(|u| is_page(u))
                .map(|u| format!("https://example.org/iiif/spdf/canvas/{}", xml_id(&u.id)))
                .collect();
            m.get("items")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter(|c| {
                            c.get("id")
                                .and_then(Value::as_str)
                                .map(|id| page_ids.iter().any(|p| p == id))
                                .unwrap_or(false)
                        })
                        .map(|c| {
                            let label = c
                                .get("label")
                                .and_then(|l| l.get("none"))
                                .and_then(|n| n.get(0))
                                .cloned()
                                .unwrap_or(Value::Null);
                            json!({ "label": label })
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        other => return Err(Error::invalid(format!("unknown export format `{other}`"))),
    };
    Ok(json!({ "pages": pages }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_and_xml_helpers() {
        assert_eq!(clean_line("## Título **fuerte**"), "Título fuerte");
        assert_eq!(clean_line("> cita"), "cita");
        assert_eq!(clean_line("- punto"), "punto");
        assert_eq!(xml_escape("a<b & \"c\""), "a&lt;b &amp; &quot;c&quot;");
        let tags = xml_tags("<pb n=\"[iv]\"/><p>x</p><pb/><pbx/>", "pb");
        assert_eq!(tags.len(), 2);
        assert_eq!(xml_attr(tags[0], "n").as_deref(), Some("[iv]"));
        assert_eq!(xml_attr(tags[1], "n"), None);
        assert_eq!(
            speaker_split("**Armstrong:** The Eagle has landed.").map(|x| x.0),
            Some("Armstrong".into())
        );
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend_from_slice(&640u32.to_be_bytes());
        png.extend_from_slice(&480u32.to_be_bytes());
        assert_eq!(image_size(&png), Some((640, 480)));
    }
}
