//! Anchors (contract §3): what a citation points to, and the `spdf:` URI.
//!
//! Anchors are stored as JSON. [`Anchor`] is the typed view; it keeps unknown
//! members in [`Anchor::extra`] so that converting JSON → `Anchor` → JSON is
//! lossless.
//!
//! ```
//! use spdf::anchor::{Anchor, AnchorKind, AnchorUri};
//! let a = Anchor::from_json(r#"{"type":"page","physical":29,"printed":"21","chars":[118,301]}"#).unwrap();
//! assert!(matches!(a.kind, AnchorKind::Page { physical: 29, .. }));
//! let uri = AnchorUri::from_anchor("sha256-3f2a", &a, None);
//! assert_eq!(uri.to_string(), "spdf:sha256-3f2a#p=29&f=21&c=118-301");
//! assert_eq!(AnchorUri::parse(&uri.to_string()).unwrap(), uri);
//! ```

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};

use crate::canon::{format_number, round6};
use crate::error::{Error, Result};

/// A rectangle in fractions (0–1) of the unit image.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Region {
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width.
    pub w: f64,
    /// Height.
    pub h: f64,
}

/// The anchor types of SPDF 5.0.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub enum AnchorKind {
    /// A page of a book or article.
    Page {
        /// 1-based physical index (PDF page, photo number).
        physical: u32,
        /// Printed folio as it appears ("23", "xiv", "1r"), if any.
        printed: Option<String>,
        /// The folio is a roman numeral (front matter).
        roman: Option<bool>,
        /// `page` | `leaf` | `column`.
        foliation: Option<String>,
        /// How the folio was obtained: `read` | `inferred` | `epub` | `none`.
        source: Option<String>,
        /// Confidence 0–1 of the folio.
        confidence: Option<f64>,
    },
    /// A span of a recording, in seconds.
    Time {
        /// Start.
        t0: f64,
        /// End.
        t1: Option<f64>,
        /// Who is speaking.
        speaker: Option<String>,
    },
    /// A section of a reflowable document.
    Section {
        /// Heading path.
        path: Vec<String>,
        /// Paragraph number within the section.
        paragraph: Option<u32>,
        /// Equivalent printed page, if known.
        printed: Option<String>,
    },
    /// A slide.
    Slide {
        /// 1-based slide number.
        n: u32,
    },
    /// Rows of a spreadsheet.
    Sheet {
        /// Sheet name.
        sheet: String,
        /// First row.
        row_from: Option<u32>,
        /// Last row.
        row_to: Option<u32>,
    },
    /// A web page.
    Web {
        /// The page URL.
        url: String,
        /// Heading path.
        path: Vec<String>,
        /// Paragraph number.
        paragraph: Option<u32>,
        /// Date of access (ISO 8601).
        accessed: Option<String>,
    },
    /// An image (use [`Anchor::region`] for the area).
    Image,
    /// Lines of verse.
    Verse {
        /// First line.
        line_from: u32,
        /// Last line.
        line_to: Option<u32>,
        /// Printed page, if known.
        printed: Option<String>,
    },
    /// A canonical reference system (Stephanus, Bekker, Bible, CTS…).
    Canonical {
        /// Scheme name, e.g. `stephanus`.
        scheme: String,
        /// The reference, e.g. `514a`.
        reference: String,
    },
}

impl AnchorKind {
    /// The `type` string of this kind.
    pub fn type_name(&self) -> &'static str {
        match self {
            AnchorKind::Page { .. } => "page",
            AnchorKind::Time { .. } => "time",
            AnchorKind::Section { .. } => "section",
            AnchorKind::Slide { .. } => "slide",
            AnchorKind::Sheet { .. } => "sheet",
            AnchorKind::Web { .. } => "web",
            AnchorKind::Image => "image",
            AnchorKind::Verse { .. } => "verse",
            AnchorKind::Canonical { .. } => "canonical",
        }
    }
}

/// The anchor types known to this implementation.
pub const ANCHOR_TYPES: &[&str] = &[
    "page",
    "time",
    "section",
    "slide",
    "sheet",
    "web",
    "image",
    "verse",
    "canonical",
];

/// A typed anchor.
#[derive(Clone, Debug, PartialEq)]
pub struct Anchor {
    /// Type-specific locator.
    pub kind: AnchorKind,
    /// Optional region of the unit image.
    pub region: Option<Region>,
    /// Optional code-point range `[start, end)` in the unit's NFC text.
    pub chars: Option<(u64, u64)>,
    /// Members this implementation does not know, preserved verbatim.
    pub extra: Map<String, Value>,
}

fn take_str(m: &mut Map<String, Value>, k: &str) -> Result<Option<String>> {
    match m.remove(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        Some(Value::Number(n)) => Ok(Some(n.to_string())),
        Some(v) => Err(Error::InvalidAnchor(format!("`{k}` must be a string, got {v}"))),
    }
}

fn take_f64(m: &mut Map<String, Value>, k: &str) -> Result<Option<f64>> {
    match m.remove(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(n.as_f64()),
        Some(v) => Err(Error::InvalidAnchor(format!("`{k}` must be a number, got {v}"))),
    }
}

fn take_u32(m: &mut Map<String, Value>, k: &str) -> Result<Option<u32>> {
    match m.remove(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => {
            let f = n.as_f64().unwrap_or(-1.0);
            if f >= 0.0 && f.fract() == 0.0 && f <= u32::MAX as f64 {
                Ok(Some(f as u32))
            } else {
                Err(Error::InvalidAnchor(format!("`{k}` must be a non-negative integer, got {n}")))
            }
        }
        Some(v) => Err(Error::InvalidAnchor(format!("`{k}` must be an integer, got {v}"))),
    }
}

fn take_bool(m: &mut Map<String, Value>, k: &str) -> Result<Option<bool>> {
    match m.remove(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(b)),
        Some(v) => Err(Error::InvalidAnchor(format!("`{k}` must be a boolean, got {v}"))),
    }
}

fn take_path(m: &mut Map<String, Value>, k: &str) -> Result<Vec<String>> {
    match m.remove(k) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(a)) => a
            .into_iter()
            .map(|v| match v {
                Value::String(s) => Ok(s),
                other => Err(Error::InvalidAnchor(format!("`{k}` must be an array of strings, got {other}"))),
            })
            .collect(),
        Some(v) => Err(Error::InvalidAnchor(format!("`{k}` must be an array, got {v}"))),
    }
}

fn need<T>(v: Option<T>, k: &str, t: &str) -> Result<T> {
    v.ok_or_else(|| Error::InvalidAnchor(format!("`{t}` anchor requires `{k}`")))
}

impl Anchor {
    /// A bare anchor of the given kind.
    pub fn new(kind: AnchorKind) -> Self {
        Anchor {
            kind,
            region: None,
            chars: None,
            extra: Map::new(),
        }
    }

    /// A page anchor with a physical index and an optional printed folio.
    pub fn page(physical: u32, printed: Option<&str>) -> Self {
        Anchor::new(AnchorKind::Page {
            physical,
            printed: printed.map(str::to_string),
            roman: None,
            foliation: None,
            source: None,
            confidence: None,
        })
    }

    /// Parses an anchor from its JSON text.
    pub fn from_json(s: &str) -> Result<Self> {
        let v: Value =
            serde_json::from_str(s).map_err(|e| Error::InvalidAnchor(format!("not JSON: {e}")))?;
        Self::from_value(&v)
    }

    /// Builds an anchor from a JSON value. Unknown `type` values produce
    /// [`Error::InvalidAnchor`] whose message starts with `unknown type`.
    pub fn from_value(v: &Value) -> Result<Self> {
        let mut m = match v {
            Value::Object(m) => m.clone(),
            _ => return Err(Error::InvalidAnchor("anchor must be a JSON object".into())),
        };
        let t = match m.remove("type") {
            Some(Value::String(s)) => s,
            _ => return Err(Error::InvalidAnchor("anchor has no string `type`".into())),
        };
        let region = match m.remove("region") {
            None | Some(Value::Null) => None,
            Some(r) => Some(
                serde_json::from_value::<Region>(r)
                    .map_err(|e| Error::InvalidAnchor(format!("bad region: {e}")))?,
            ),
        };
        let chars = match m.remove("chars") {
            None | Some(Value::Null) => None,
            Some(Value::Array(a)) if a.len() == 2 => {
                let s = a[0].as_u64();
                let e = a[1].as_u64();
                match (s, e) {
                    (Some(s), Some(e)) if s <= e => Some((s, e)),
                    _ => return Err(Error::InvalidAnchor("`chars` must be [start,end] with start <= end".into())),
                }
            }
            Some(_) => return Err(Error::InvalidAnchor("`chars` must be [start,end]".into())),
        };
        let kind = match t.as_str() {
            "page" => AnchorKind::Page {
                physical: need(take_u32(&mut m, "physical")?, "physical", "page")?,
                printed: take_str(&mut m, "printed")?,
                roman: take_bool(&mut m, "roman")?,
                foliation: take_str(&mut m, "foliation")?,
                source: take_str(&mut m, "source")?,
                confidence: take_f64(&mut m, "confidence")?,
            },
            "time" => AnchorKind::Time {
                t0: need(take_f64(&mut m, "t0")?, "t0", "time")?,
                t1: take_f64(&mut m, "t1")?,
                speaker: take_str(&mut m, "speaker")?,
            },
            "section" => AnchorKind::Section {
                path: take_path(&mut m, "path")?,
                paragraph: take_u32(&mut m, "paragraph")?,
                printed: take_str(&mut m, "printed")?,
            },
            "slide" => AnchorKind::Slide {
                n: need(take_u32(&mut m, "n")?, "n", "slide")?,
            },
            "sheet" => AnchorKind::Sheet {
                sheet: need(take_str(&mut m, "sheet")?, "sheet", "sheet")?,
                row_from: take_u32(&mut m, "row_from")?,
                row_to: take_u32(&mut m, "row_to")?,
            },
            "web" => AnchorKind::Web {
                url: need(take_str(&mut m, "url")?, "url", "web")?,
                path: take_path(&mut m, "path")?,
                paragraph: take_u32(&mut m, "paragraph")?,
                accessed: take_str(&mut m, "accessed")?,
            },
            "image" => AnchorKind::Image,
            "verse" => AnchorKind::Verse {
                line_from: need(take_u32(&mut m, "line_from")?, "line_from", "verse")?,
                line_to: take_u32(&mut m, "line_to")?,
                printed: take_str(&mut m, "printed")?,
            },
            "canonical" => AnchorKind::Canonical {
                scheme: need(take_str(&mut m, "scheme")?, "scheme", "canonical")?,
                reference: need(take_str(&mut m, "ref")?, "ref", "canonical")?,
            },
            other => return Err(Error::InvalidAnchor(format!("unknown type `{other}`"))),
        };
        Ok(Anchor {
            kind,
            region,
            chars,
            extra: m,
        })
    }

    /// Converts the anchor to JSON (only members that are present).
    pub fn to_value(&self) -> Value {
        let mut m = Map::new();
        m.insert("type".into(), Value::from(self.kind.type_name()));
        fn put<T: Into<Value>>(m: &mut Map<String, Value>, k: &str, v: Option<T>) {
            if let Some(v) = v {
                m.insert(k.into(), v.into());
            }
        }
        match &self.kind {
            AnchorKind::Page {
                physical,
                printed,
                roman,
                foliation,
                source,
                confidence,
            } => {
                m.insert("physical".into(), Value::from(*physical));
                put(&mut m, "printed", printed.clone());
                put(&mut m, "roman", *roman);
                put(&mut m, "foliation", foliation.clone());
                put(&mut m, "source", source.clone());
                put(&mut m, "confidence", *confidence);
            }
            AnchorKind::Time { t0, t1, speaker } => {
                m.insert("t0".into(), Value::from(*t0));
                put(&mut m, "t1", *t1);
                put(&mut m, "speaker", speaker.clone());
            }
            AnchorKind::Section {
                path,
                paragraph,
                printed,
            } => {
                m.insert("path".into(), Value::from(path.clone()));
                put(&mut m, "paragraph", *paragraph);
                put(&mut m, "printed", printed.clone());
            }
            AnchorKind::Slide { n } => {
                m.insert("n".into(), Value::from(*n));
            }
            AnchorKind::Sheet {
                sheet,
                row_from,
                row_to,
            } => {
                m.insert("sheet".into(), Value::from(sheet.clone()));
                put(&mut m, "row_from", *row_from);
                put(&mut m, "row_to", *row_to);
            }
            AnchorKind::Web {
                url,
                path,
                paragraph,
                accessed,
            } => {
                m.insert("url".into(), Value::from(url.clone()));
                m.insert("path".into(), Value::from(path.clone()));
                put(&mut m, "paragraph", *paragraph);
                put(&mut m, "accessed", accessed.clone());
            }
            AnchorKind::Image => {}
            AnchorKind::Verse {
                line_from,
                line_to,
                printed,
            } => {
                m.insert("line_from".into(), Value::from(*line_from));
                put(&mut m, "line_to", *line_to);
                put(&mut m, "printed", printed.clone());
            }
            AnchorKind::Canonical { scheme, reference } => {
                m.insert("scheme".into(), Value::from(scheme.clone()));
                m.insert("ref".into(), Value::from(reference.clone()));
            }
        }
        if let Some(r) = &self.region {
            m.insert(
                "region".into(),
                serde_json::to_value(r).unwrap_or(Value::Null),
            );
        }
        if let Some((s, e)) = self.chars {
            m.insert("chars".into(), Value::from(vec![s, e]));
        }
        for (k, v) in &self.extra {
            m.entry(k.clone()).or_insert_with(|| v.clone());
        }
        Value::Object(m)
    }

    /// Printed folio of page, section and verse anchors.
    pub fn printed(&self) -> Option<&str> {
        match &self.kind {
            AnchorKind::Page { printed, .. }
            | AnchorKind::Section { printed, .. }
            | AnchorKind::Verse { printed, .. } => printed.as_deref(),
            _ => None,
        }
    }
}

impl Serialize for Anchor {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        self.to_value().serialize(s)
    }
}

impl<'de> Deserialize<'de> for Anchor {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        let v = Value::deserialize(d)?;
        Anchor::from_value(&v).map_err(serde::de::Error::custom)
    }
}

impl FromStr for Anchor {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        Anchor::from_json(s)
    }
}

// ---------------------------------------------------------------------------
// URI
// ---------------------------------------------------------------------------

fn is_unreserved(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~')
}

/// Percent-encodes everything outside RFC 3986 `unreserved`, uppercase hex.
pub fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        if is_unreserved(b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Decodes `%XX` escapes (UTF-8). Fails on malformed escapes or invalid UTF-8.
pub fn percent_decode(s: &str) -> Result<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes
                .get(i + 1..i + 3)
                .and_then(|h| std::str::from_utf8(h).ok())
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or_else(|| Error::InvalidUri(format!("bad percent escape in `{s}`")))?;
            out.push(hex);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| Error::InvalidUri(format!("`{s}` is not UTF-8")))
}

fn fmt_num(x: f64) -> String {
    format_number(round6(x))
}

fn parse_f64(s: &str, what: &str) -> Result<f64> {
    let v: f64 = s
        .parse()
        .map_err(|_| Error::InvalidUri(format!("`{what}` is not a number: `{s}`")))?;
    if v.is_finite() {
        Ok(v)
    } else {
        Err(Error::InvalidUri(format!("`{what}` is not finite")))
    }
}

fn parse_u32(s: &str, what: &str) -> Result<u32> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Error::InvalidUri(format!("`{what}` is not an integer: `{s}`")));
    }
    s.parse()
        .map_err(|_| Error::InvalidUri(format!("`{what}` out of range: `{s}`")))
}

fn parse_u64(s: &str, what: &str) -> Result<u64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Error::InvalidUri(format!("`{what}` is not an integer: `{s}`")));
    }
    s.parse()
        .map_err(|_| Error::InvalidUri(format!("`{what}` out of range: `{s}`")))
}

/// A parsed `spdf:` URI. Parameters are kept typed; [`fmt::Display`] writes
/// them in the canonical order `p f t s para sl sh rows v ref c xywh fe`,
/// followed by unknown parameters in their original order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct AnchorUri {
    /// `sha256-<hex>` or a document id (decoded).
    pub doc: String,
    /// `p`: physical page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub physical: Option<u32>,
    /// `f`: printed folio.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub printed: Option<String>,
    /// `t`: time span in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<(f64, Option<f64>)>,
    /// `s`: section path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<Vec<String>>,
    /// `para`: paragraph.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paragraph: Option<u32>,
    /// `sl`: slide.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slide: Option<u32>,
    /// `sh`: sheet name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet: Option<String>,
    /// `rows`: row range.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<(u32, u32)>,
    /// `v`: verse line(s).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verse: Option<(u32, Option<u32>)>,
    /// `ref`: canonical reference `(scheme, ref)`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<(String, String)>,
    /// `c`: code-point range.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chars: Option<(u64, u64)>,
    /// `xywh`: region.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<Region>,
    /// `fe`: printed folio of the end.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub printed_end: Option<String>,
    /// Unknown parameters `(name, decoded value)`, in order.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub extra: Vec<(String, String)>,
}

impl AnchorUri {
    /// Document reference from a source SHA-256 (hex).
    pub fn docref_sha256(hex: &str) -> String {
        format!("sha256-{}", hex.to_ascii_lowercase())
    }

    /// Builds the URI of `anchor` (and, for ranges, `end`) within `doc`.
    pub fn from_anchor(doc: &str, anchor: &Anchor, end: Option<&Anchor>) -> Self {
        let mut u = AnchorUri {
            doc: doc.to_string(),
            ..Default::default()
        };
        match &anchor.kind {
            AnchorKind::Page {
                physical, printed, ..
            } => {
                u.physical = Some(*physical);
                u.printed = printed.clone();
            }
            AnchorKind::Time { t0, t1, .. } => u.time = Some((*t0, *t1)),
            AnchorKind::Section {
                path,
                paragraph,
                printed,
            } => {
                if !path.is_empty() {
                    u.section = Some(path.clone());
                }
                u.paragraph = *paragraph;
                u.printed = printed.clone();
            }
            AnchorKind::Slide { n } => u.slide = Some(*n),
            AnchorKind::Sheet {
                sheet,
                row_from,
                row_to,
            } => {
                u.sheet = Some(sheet.clone());
                if let Some(a) = row_from {
                    u.rows = Some((*a, row_to.unwrap_or(*a)));
                }
            }
            AnchorKind::Web {
                path, paragraph, ..
            } => {
                if !path.is_empty() {
                    u.section = Some(path.clone());
                }
                u.paragraph = *paragraph;
            }
            AnchorKind::Image => {}
            AnchorKind::Verse {
                line_from,
                line_to,
                printed,
            } => {
                u.verse = Some((*line_from, *line_to));
                u.printed = printed.clone();
            }
            AnchorKind::Canonical { scheme, reference } => {
                u.reference = Some((scheme.clone(), reference.clone()));
            }
        }
        u.chars = anchor.chars;
        u.region = anchor.region;
        if let Some(e) = end {
            if let Some(p) = e.printed() {
                if u.printed.as_deref() != Some(p) {
                    u.printed_end = Some(p.to_string());
                }
            }
        }
        u
    }

    /// Parses an `spdf:` URI.
    pub fn parse(s: &str) -> Result<Self> {
        let rest = s
            .strip_prefix("spdf:")
            .ok_or_else(|| Error::InvalidUri("must start with `spdf:`".into()))?;
        let (doc, frag) = match rest.split_once('#') {
            Some((d, f)) => (d, Some(f)),
            None => (rest, None),
        };
        if doc.is_empty() {
            return Err(Error::InvalidUri("empty document reference".into()));
        }
        let mut u = AnchorUri {
            doc: percent_decode(doc)?,
            ..Default::default()
        };
        let Some(frag) = frag else { return Ok(u) };
        for pair in frag.split('&').filter(|p| !p.is_empty()) {
            let (k, raw) = pair
                .split_once('=')
                .ok_or_else(|| Error::InvalidUri(format!("parameter without value: `{pair}`")))?;
            let dup = || Error::InvalidUri(format!("duplicate parameter `{k}`"));
            match k {
                "p" => {
                    if u.physical.is_some() {
                        return Err(dup());
                    }
                    u.physical = Some(parse_u32(raw, "p")?);
                }
                "f" => {
                    if u.printed.is_some() {
                        return Err(dup());
                    }
                    u.printed = Some(percent_decode(raw)?);
                }
                "fe" => {
                    if u.printed_end.is_some() {
                        return Err(dup());
                    }
                    u.printed_end = Some(percent_decode(raw)?);
                }
                "t" => {
                    if u.time.is_some() {
                        return Err(dup());
                    }
                    let (a, b) = match raw.split_once(',') {
                        Some((a, b)) => (a, Some(b)),
                        None => (raw, None),
                    };
                    let t0 = parse_f64(a, "t")?;
                    let t1 = b.map(|b| parse_f64(b, "t")).transpose()?;
                    u.time = Some((t0, t1));
                }
                "s" => {
                    if u.section.is_some() {
                        return Err(dup());
                    }
                    u.section = Some(
                        raw.split('/')
                            .map(percent_decode)
                            .collect::<Result<Vec<_>>>()?,
                    );
                }
                "para" => {
                    if u.paragraph.is_some() {
                        return Err(dup());
                    }
                    u.paragraph = Some(parse_u32(raw, "para")?);
                }
                "sl" => {
                    if u.slide.is_some() {
                        return Err(dup());
                    }
                    u.slide = Some(parse_u32(raw, "sl")?);
                }
                "sh" => {
                    if u.sheet.is_some() {
                        return Err(dup());
                    }
                    u.sheet = Some(percent_decode(raw)?);
                }
                "rows" => {
                    if u.rows.is_some() {
                        return Err(dup());
                    }
                    let (a, b) = raw
                        .split_once('-')
                        .ok_or_else(|| Error::InvalidUri("`rows` must be a-b".into()))?;
                    u.rows = Some((parse_u32(a, "rows")?, parse_u32(b, "rows")?));
                }
                "v" => {
                    if u.verse.is_some() {
                        return Err(dup());
                    }
                    let (a, b) = match raw.split_once('-') {
                        Some((a, b)) => (a, Some(b)),
                        None => (raw, None),
                    };
                    u.verse = Some((
                        parse_u32(a, "v")?,
                        b.map(|b| parse_u32(b, "v")).transpose()?,
                    ));
                }
                "ref" => {
                    if u.reference.is_some() {
                        return Err(dup());
                    }
                    let d = percent_decode(raw)?;
                    let (sch, r) = d
                        .split_once(':')
                        .ok_or_else(|| Error::InvalidUri("`ref` must be scheme:ref".into()))?;
                    u.reference = Some((sch.to_string(), r.to_string()));
                }
                "c" => {
                    if u.chars.is_some() {
                        return Err(dup());
                    }
                    let (a, b) = raw
                        .split_once('-')
                        .ok_or_else(|| Error::InvalidUri("`c` must be start-end".into()))?;
                    let (a, b) = (parse_u64(a, "c")?, parse_u64(b, "c")?);
                    if a > b {
                        return Err(Error::InvalidUri("`c` start > end".into()));
                    }
                    u.chars = Some((a, b));
                }
                "xywh" => {
                    if u.region.is_some() {
                        return Err(dup());
                    }
                    let parts: Vec<&str> = raw.split(',').collect();
                    if parts.len() != 4 {
                        return Err(Error::InvalidUri("`xywh` needs 4 numbers".into()));
                    }
                    u.region = Some(Region {
                        x: parse_f64(parts[0], "xywh")?,
                        y: parse_f64(parts[1], "xywh")?,
                        w: parse_f64(parts[2], "xywh")?,
                        h: parse_f64(parts[3], "xywh")?,
                    });
                }
                other => u
                    .extra
                    .push((percent_decode(other)?, percent_decode(raw)?)),
            }
        }
        Ok(u)
    }

    /// Best-effort anchor described by this URI. The type is inferred from
    /// the parameters (`p`/`f` → page, `t` → time, `sl` → slide, `sh` →
    /// sheet, `v` → verse, `ref` → canonical, `s`/`para` → section, only
    /// `xywh` → image).
    pub fn to_anchor(&self) -> Option<Anchor> {
        let kind = if let Some(p) = self.physical {
            AnchorKind::Page {
                physical: p,
                printed: self.printed.clone(),
                roman: None,
                foliation: None,
                source: None,
                confidence: None,
            }
        } else if let Some((t0, t1)) = self.time {
            AnchorKind::Time {
                t0,
                t1,
                speaker: None,
            }
        } else if let Some(n) = self.slide {
            AnchorKind::Slide { n }
        } else if let Some(sheet) = &self.sheet {
            AnchorKind::Sheet {
                sheet: sheet.clone(),
                row_from: self.rows.map(|r| r.0),
                row_to: self.rows.map(|r| r.1),
            }
        } else if let Some((a, b)) = self.verse {
            AnchorKind::Verse {
                line_from: a,
                line_to: b,
                printed: self.printed.clone(),
            }
        } else if let Some((s, r)) = &self.reference {
            AnchorKind::Canonical {
                scheme: s.clone(),
                reference: r.clone(),
            }
        } else if self.section.is_some() || self.paragraph.is_some() {
            AnchorKind::Section {
                path: self.section.clone().unwrap_or_default(),
                paragraph: self.paragraph,
                printed: self.printed.clone(),
            }
        } else if self.region.is_some() {
            AnchorKind::Image
        } else {
            return None;
        };
        Some(Anchor {
            kind,
            region: self.region,
            chars: self.chars,
            extra: Map::new(),
        })
    }

    /// The URI without the fragment (`spdf:<docref>`).
    pub fn document_uri(&self) -> String {
        format!("spdf:{}", percent_encode(&self.doc))
    }
}

impl fmt::Display for AnchorUri {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut params: Vec<String> = Vec::new();
        if let Some(p) = self.physical {
            params.push(format!("p={p}"));
        }
        if let Some(x) = &self.printed {
            params.push(format!("f={}", percent_encode(x)));
        }
        if let Some((t0, t1)) = self.time {
            match t1 {
                Some(t1) => params.push(format!("t={},{}", fmt_num(t0), fmt_num(t1))),
                None => params.push(format!("t={}", fmt_num(t0))),
            }
        }
        if let Some(s) = &self.section {
            let parts: Vec<String> = s.iter().map(|x| percent_encode(x)).collect();
            params.push(format!("s={}", parts.join("/")));
        }
        if let Some(x) = self.paragraph {
            params.push(format!("para={x}"));
        }
        if let Some(x) = self.slide {
            params.push(format!("sl={x}"));
        }
        if let Some(x) = &self.sheet {
            params.push(format!("sh={}", percent_encode(x)));
        }
        if let Some((a, b)) = self.rows {
            params.push(format!("rows={a}-{b}"));
        }
        if let Some((a, b)) = self.verse {
            match b {
                Some(b) => params.push(format!("v={a}-{b}")),
                None => params.push(format!("v={a}")),
            }
        }
        if let Some((s, r)) = &self.reference {
            params.push(format!("ref={}:{}", percent_encode(s), percent_encode(r)));
        }
        if let Some((a, b)) = self.chars {
            params.push(format!("c={a}-{b}"));
        }
        if let Some(r) = self.region {
            params.push(format!(
                "xywh={},{},{},{}",
                fmt_num(r.x),
                fmt_num(r.y),
                fmt_num(r.w),
                fmt_num(r.h)
            ));
        }
        if let Some(x) = &self.printed_end {
            params.push(format!("fe={}", percent_encode(x)));
        }
        for (k, v) in &self.extra {
            params.push(format!("{}={}", percent_encode(k), percent_encode(v)));
        }
        write!(f, "spdf:{}", percent_encode(&self.doc))?;
        if !params.is_empty() {
            write!(f, "#{}", params.join("&"))?;
        }
        Ok(())
    }
}

impl FromStr for AnchorUri {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        AnchorUri::parse(s)
    }
}

/// Formats the URI of an anchor given as JSON. `doc` is the document
/// reference (`sha256-<hex>` or an id).
pub fn format_uri(doc: &str, anchor: &Value, end: Option<&Value>) -> Result<String> {
    let a = Anchor::from_value(anchor)?;
    let e = end.map(Anchor::from_value).transpose()?;
    Ok(AnchorUri::from_anchor(doc, &a, e.as_ref()).to_string())
}

/// Parses an anchor URI.
pub fn parse_uri(uri: &str) -> Result<AnchorUri> {
    AnchorUri::parse(uri)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_roundtrip_keeps_unknown_members() {
        let v = json!({"type":"time","t0":4160.0,"t1":4175.5,"speaker":"Julio Cortázar","x_note":"y"});
        let a = Anchor::from_value(&v).unwrap();
        assert_eq!(a.to_value(), v);
    }

    #[test]
    fn uri_examples() {
        let a = Anchor::from_value(&json!({"type":"section","path":["Chapter 3","3.2 The/panopticon"],"paragraph":4})).unwrap();
        let s = AnchorUri::from_anchor("doc-1", &a, None).to_string();
        assert_eq!(s, "spdf:doc-1#s=Chapter%203/3.2%20The%2Fpanopticon&para=4");
        let back = AnchorUri::parse(&s).unwrap();
        assert_eq!(back.to_anchor().unwrap(), a);

        let t = Anchor::from_value(&json!({"type":"time","t0":4160.0,"t1":4175.5})).unwrap();
        assert_eq!(AnchorUri::from_anchor("d", &t, None).to_string(), "spdf:d#t=4160,4175.5");

        let c = Anchor::from_value(&json!({"type":"canonical","scheme":"bible","ref":"John 3:16"})).unwrap();
        let s = AnchorUri::from_anchor("d", &c, None).to_string();
        assert_eq!(s, "spdf:d#ref=bible:John%203%3A16");
        assert_eq!(AnchorUri::parse(&s).unwrap().to_anchor().unwrap(), c);
    }

    #[test]
    fn rejects_bad_uris() {
        for bad in ["http://x", "spdf:", "spdf:d#p=x", "spdf:d#p=1&p=2", "spdf:d#c=5-2", "spdf:d#xywh=1,2", "spdf:d#f=%G1"] {
            assert!(AnchorUri::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn unknown_type() {
        let e = Anchor::from_value(&json!({"type":"hologram"})).unwrap_err();
        assert!(e.to_string().contains("unknown type"));
    }
}
