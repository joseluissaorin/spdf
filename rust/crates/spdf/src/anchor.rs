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
//! assert_eq!(uri.to_string(), "spdf:sha256-3f2a#p=29&f=21&char=118,301");
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
        Some(v) => Err(Error::InvalidAnchor(format!(
            "`{k}` must be a string, got {v}"
        ))),
    }
}

fn take_f64(m: &mut Map<String, Value>, k: &str) -> Result<Option<f64>> {
    match m.remove(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(n.as_f64()),
        Some(v) => Err(Error::InvalidAnchor(format!(
            "`{k}` must be a number, got {v}"
        ))),
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
                Err(Error::InvalidAnchor(format!(
                    "`{k}` must be a non-negative integer, got {n}"
                )))
            }
        }
        Some(v) => Err(Error::InvalidAnchor(format!(
            "`{k}` must be an integer, got {v}"
        ))),
    }
}

fn take_bool(m: &mut Map<String, Value>, k: &str) -> Result<Option<bool>> {
    match m.remove(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(b)),
        Some(v) => Err(Error::InvalidAnchor(format!(
            "`{k}` must be a boolean, got {v}"
        ))),
    }
}

fn take_path(m: &mut Map<String, Value>, k: &str) -> Result<Vec<String>> {
    match m.remove(k) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(a)) => a
            .into_iter()
            .map(|v| match v {
                Value::String(s) => Ok(s),
                other => Err(Error::InvalidAnchor(format!(
                    "`{k}` must be an array of strings, got {other}"
                ))),
            })
            .collect(),
        Some(v) => Err(Error::InvalidAnchor(format!(
            "`{k}` must be an array, got {v}"
        ))),
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
                    _ => {
                        return Err(Error::InvalidAnchor(
                            "`chars` must be [start,end] with start <= end".into(),
                        ))
                    }
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

fn round_to(x: f64, decimals: usize) -> f64 {
    let s = format!("{x:.decimals$}");
    let v: f64 = s.parse().unwrap_or(x);
    if v == 0.0 {
        0.0
    } else {
        v
    }
}

fn parse_f64(s: &str, what: &str) -> Result<f64> {
    let v: f64 = s
        .trim()
        .parse()
        .map_err(|_| Error::InvalidUri(format!("`{what}` is not a number: `{s}`")))?;
    if v.is_finite() {
        Ok(v)
    } else {
        Err(Error::InvalidUri(format!("`{what}` is not finite")))
    }
}

fn parse_int<T: FromStr>(s: &str, what: &str) -> Result<T> {
    let ok =
        !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) && (s == "0" || !s.starts_with('0'));
    if !ok {
        return Err(Error::InvalidUri(format!(
            "`{what}` is not a canonical integer: `{s}`"
        )));
    }
    s.parse()
        .map_err(|_| Error::InvalidUri(format!("`{what}` out of range: `{s}`")))
}

/// `^[0-9]+(\.[0-9]+)?$`
fn is_decimal(s: &str) -> bool {
    let (a, b) = match s.split_once('.') {
        Some((a, b)) => (a, Some(b)),
        None => (s, None),
    };
    !a.is_empty()
        && a.bytes().all(|c| c.is_ascii_digit())
        && b.map(|b| !b.is_empty() && b.bytes().all(|c| c.is_ascii_digit()))
            .unwrap_or(true)
}

/// A Media Fragments NPT value: seconds (`4160.5`) or clock (`1:09:20.5`, `9:20`).
fn parse_npt(s: &str) -> Result<f64> {
    if is_decimal(s) {
        return parse_f64(s, "t").map(round6);
    }
    let parts: Vec<&str> = s.split(':').collect();
    let bad = || Error::InvalidUri(format!("bad time `{s}`"));
    let (h, m, sec) = match parts.as_slice() {
        [m, sec] => ("0", *m, *sec),
        [h, m, sec] => (*h, *m, *sec),
        _ => return Err(bad()),
    };
    let digits = |x: &str| !x.is_empty() && x.bytes().all(|c| c.is_ascii_digit());
    if !digits(h) || !digits(m) || m.len() > 2 {
        return Err(bad());
    }
    let (si, sf) = match sec.split_once('.') {
        Some((a, b)) => (a, Some(b)),
        None => (sec, None),
    };
    if si.len() != 2 || !digits(si) || sf.map(|f| !digits(f)).unwrap_or(false) {
        return Err(bad());
    }
    let mi: f64 = m.parse().map_err(|_| bad())?;
    let se: f64 = sec.parse().map_err(|_| bad())?;
    if mi >= 60.0 || se >= 60.0 {
        return Err(bad());
    }
    let hi: f64 = h.parse().map_err(|_| bad())?;
    Ok(round6(hi * 3600.0 + mi * 60.0 + se))
}

fn pair<'a>(raw: &'a str, sep: char, what: &str) -> Result<(&'a str, &'a str)> {
    raw.split_once(sep)
        .ok_or_else(|| Error::InvalidUri(format!("`{what}` must be <a>{sep}<b>")))
}

/// A canonical reference inside a locator (`ref=<scheme>:<ref>`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanonicalRef {
    /// Scheme (`stephanus`, `bekker`, `bible`, `cts`…).
    pub scheme: String,
    /// The reference.
    #[serde(rename = "ref")]
    pub reference: String,
}

/// The parameters of an anchor URI (contract §3). Serializes to the
/// `locator` object of the conformance protocol (short keys, only the
/// present ones).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Locator {
    /// `p`: physical page.
    #[serde(rename = "p", skip_serializing_if = "Option::is_none", default)]
    pub physical: Option<u64>,
    /// `pe`: physical end page.
    #[serde(rename = "pe", skip_serializing_if = "Option::is_none", default)]
    pub physical_end: Option<u64>,
    /// `f`: printed folio.
    #[serde(rename = "f", skip_serializing_if = "Option::is_none", default)]
    pub printed: Option<String>,
    /// `fe`: printed end folio.
    #[serde(rename = "fe", skip_serializing_if = "Option::is_none", default)]
    pub printed_end: Option<String>,
    /// `t`: `[t0]` or `[t0, t1]` in seconds.
    #[serde(rename = "t", skip_serializing_if = "Option::is_none", default)]
    pub time: Option<Vec<f64>>,
    /// `s`: section path.
    #[serde(rename = "s", skip_serializing_if = "Option::is_none", default)]
    pub section: Option<Vec<String>>,
    /// `para`: paragraph.
    #[serde(rename = "para", skip_serializing_if = "Option::is_none", default)]
    pub paragraph: Option<u64>,
    /// `sl`: slide.
    #[serde(rename = "sl", skip_serializing_if = "Option::is_none", default)]
    pub slide: Option<u64>,
    /// `sh`: sheet name.
    #[serde(rename = "sh", skip_serializing_if = "Option::is_none", default)]
    pub sheet: Option<String>,
    /// `rows`: `[from, to]`.
    #[serde(rename = "rows", skip_serializing_if = "Option::is_none", default)]
    pub rows: Option<[u64; 2]>,
    /// `v`: `[line]` or `[from, to]`.
    #[serde(rename = "v", skip_serializing_if = "Option::is_none", default)]
    pub verse: Option<Vec<u64>>,
    /// `ref`: canonical reference.
    #[serde(rename = "ref", skip_serializing_if = "Option::is_none", default)]
    pub reference: Option<CanonicalRef>,
    /// `char`: code-point range `[start, end]`.
    #[serde(rename = "char", skip_serializing_if = "Option::is_none", default)]
    pub chars: Option<[u64; 2]>,
    /// `xywh`: region `[x, y, w, h]` as fractions 0–1.
    #[serde(rename = "xywh", skip_serializing_if = "Option::is_none", default)]
    pub region: Option<[f64; 4]>,
}

fn json_u64(v: Option<&Value>) -> Option<u64> {
    v.and_then(|x| {
        x.as_u64().or_else(|| {
            x.as_f64()
                .filter(|f| *f >= 0.0 && f.fract() == 0.0)
                .map(|f| f as u64)
        })
    })
}

fn json_string(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

impl Locator {
    /// The locator of an anchor (and optional end anchor) given as JSON,
    /// exactly as the reference builds it (§3).
    pub fn from_anchor_value(anchor: &Value, end: Option<&Value>) -> Self {
        let mut l = Locator::default();
        let t = anchor.get("type").and_then(Value::as_str).unwrap_or("");
        let end_type = end.and_then(|e| e.get("type")).and_then(Value::as_str);
        let printed = json_string(anchor.get("printed"));
        match t {
            "page" => {
                l.physical = json_u64(anchor.get("physical"));
                l.printed = printed.clone();
                if let (Some(e), Some("page")) = (end, end_type) {
                    let pe = json_u64(e.get("physical"));
                    if pe.is_some() && pe != l.physical {
                        l.physical_end = pe;
                    }
                    let fe = json_string(e.get("printed"));
                    if fe.is_some() && fe != printed {
                        l.printed_end = fe;
                    }
                }
            }
            "time" => {
                let t0 = anchor.get("t0").and_then(Value::as_f64).unwrap_or(0.0);
                let t1 = if end_type == Some("time") {
                    end.and_then(|e| e.get("t1")).and_then(Value::as_f64)
                } else {
                    anchor.get("t1").and_then(Value::as_f64)
                };
                l.time = Some(match t1 {
                    Some(t1) => vec![t0, t1],
                    None => vec![t0],
                });
            }
            "section" | "web" => {
                if let Some(p) = anchor.get("path").and_then(Value::as_array) {
                    if !p.is_empty() {
                        l.section = Some(
                            p.iter()
                                .map(|x| x.as_str().unwrap_or("").to_string())
                                .collect(),
                        );
                    }
                }
                l.paragraph = json_u64(anchor.get("paragraph"));
                if printed.is_some() {
                    l.printed = printed.clone();
                    let fe = end.and_then(|e| json_string(e.get("printed")));
                    if fe.is_some() && fe != printed {
                        l.printed_end = fe;
                    }
                }
            }
            "slide" => l.slide = json_u64(anchor.get("n")),
            "sheet" => {
                l.sheet = json_string(anchor.get("sheet"));
                if let (Some(a), Some(b)) = (
                    json_u64(anchor.get("row_from")),
                    json_u64(anchor.get("row_to")),
                ) {
                    l.rows = Some([a, b]);
                }
            }
            "verse" => {
                if let Some(a) = json_u64(anchor.get("line_from")) {
                    let b = json_u64(anchor.get("line_to"));
                    l.verse = Some(match b {
                        Some(b) if b != a => vec![a, b],
                        _ => vec![a],
                    });
                }
                l.printed = printed;
            }
            "canonical" => {
                if let (Some(sc), Some(r)) = (
                    json_string(anchor.get("scheme")),
                    json_string(anchor.get("ref")),
                ) {
                    l.reference = Some(CanonicalRef {
                        scheme: sc,
                        reference: r,
                    });
                }
            }
            _ => {}
        }
        if let Some(c) = anchor.get("chars").and_then(Value::as_array) {
            if let (Some(a), Some(b)) = (json_u64(c.first()), json_u64(c.get(1))) {
                l.chars = Some([a, b]);
            }
        }
        if let Some(r) = anchor.get("region").filter(|r| r.is_object()) {
            let g = |k: &str| r.get(k).and_then(Value::as_f64).unwrap_or(0.0);
            l.region = Some([g("x"), g("y"), g("w"), g("h")]);
        }
        l
    }
}

/// A parsed `spdf:` URI: document reference plus [`Locator`].
///
/// [`fmt::Display`] writes the canonical form (parameter order `p pe f fe t s
/// para sl sh rows v ref char xywh`), so `parse` ∘ `to_string` reproduces any
/// canonical URI byte for byte.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct AnchorUri {
    /// `sha256-<hex>` or a document id (decoded).
    pub docref: String,
    /// The parameters.
    pub locator: Locator,
}

impl AnchorUri {
    /// Document reference for a source SHA-256 given in hex.
    pub fn docref_sha256(hex: &str) -> String {
        format!("sha256-{}", hex.to_ascii_lowercase())
    }

    /// Builds the URI of `anchor` (and, for ranges, `end`) within `docref`.
    pub fn from_anchor(docref: &str, anchor: &Anchor, end: Option<&Anchor>) -> Self {
        let e = end.map(Anchor::to_value);
        Self::from_anchor_value(docref, &anchor.to_value(), e.as_ref())
    }

    /// Builds the URI of an anchor given as JSON (5.0 names).
    pub fn from_anchor_value(docref: &str, anchor: &Value, end: Option<&Value>) -> Self {
        AnchorUri {
            docref: docref.to_string(),
            locator: Locator::from_anchor_value(anchor, end.filter(|e| !e.is_null())),
        }
    }

    /// Parses an `spdf:` URI (strictly for known parameters: canonical
    /// integers, no duplicates, pages from 1). Unknown parameters are ignored.
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
            docref: percent_decode(doc)?,
            locator: Locator::default(),
        };
        let Some(frag) = frag else { return Ok(u) };
        let l = &mut u.locator;
        let mut seen = std::collections::HashSet::new();
        for p in frag.split('&').filter(|p| !p.is_empty()) {
            let (k, raw) = p
                .split_once('=')
                .ok_or_else(|| Error::InvalidUri(format!("parameter without value: `{p}`")))?;
            if !seen.insert(k.to_string()) {
                return Err(Error::InvalidUri(format!("duplicate parameter `{k}`")));
            }
            match k {
                "p" | "pe" | "sl" | "para" => {
                    let n: u64 = parse_int(raw, k)?;
                    if k != "para" && n < 1 {
                        return Err(Error::InvalidUri(format!("`{k}` starts at 1")));
                    }
                    match k {
                        "p" => l.physical = Some(n),
                        "pe" => l.physical_end = Some(n),
                        "sl" => l.slide = Some(n),
                        _ => l.paragraph = Some(n),
                    }
                }
                "f" => l.printed = Some(percent_decode(raw)?),
                "fe" => l.printed_end = Some(percent_decode(raw)?),
                "sh" => l.sheet = Some(percent_decode(raw)?),
                "t" => {
                    let raw = raw.strip_prefix("npt:").unwrap_or(raw);
                    let mut v = Vec::new();
                    for x in raw.split(',') {
                        v.push(parse_npt(x)?);
                    }
                    if v.len() > 2 || (v.len() == 2 && v[1] < v[0]) {
                        return Err(Error::InvalidUri("bad `t`".into()));
                    }
                    l.time = Some(v);
                }
                "s" => {
                    l.section = Some(
                        raw.split('/')
                            .map(percent_decode)
                            .collect::<Result<Vec<_>>>()?,
                    )
                }
                "rows" => {
                    let (a, b) = pair(raw, '-', "rows")?;
                    l.rows = Some([parse_int(a, "rows")?, parse_int(b, "rows")?]);
                }
                "v" => {
                    let parts: Vec<&str> = raw.split('-').collect();
                    if parts.len() > 2 {
                        return Err(Error::InvalidUri("bad `v`".into()));
                    }
                    l.verse = Some(
                        parts
                            .iter()
                            .map(|x| parse_int(x, "v"))
                            .collect::<Result<Vec<u64>>>()?,
                    );
                }
                "ref" => {
                    let (sch, r) = pair(raw, ':', "ref")?;
                    if sch.is_empty() {
                        return Err(Error::InvalidUri("`ref` needs scheme:ref".into()));
                    }
                    l.reference = Some(CanonicalRef {
                        scheme: percent_decode(sch)?,
                        reference: percent_decode(r)?,
                    });
                }
                "char" => {
                    let parts: Vec<&str> = raw.split(',').collect();
                    if parts.len() != 2 {
                        return Err(Error::InvalidUri("`char` needs start,end".into()));
                    }
                    let (a, b): (u64, u64) =
                        (parse_int(parts[0], "char")?, parse_int(parts[1], "char")?);
                    if b < a {
                        return Err(Error::InvalidUri("`char` end before start".into()));
                    }
                    l.chars = Some([a, b]);
                }
                "xywh" => {
                    let body = raw.strip_prefix("percent:").ok_or_else(|| {
                        Error::InvalidUri("`xywh` must use `percent:` units".into())
                    })?;
                    let parts: Vec<&str> = body.split(',').collect();
                    if parts.len() != 4 || !parts.iter().all(|x| is_decimal(x)) {
                        return Err(Error::InvalidUri("bad `xywh`".into()));
                    }
                    let mut r = [0.0; 4];
                    for (i, x) in parts.iter().enumerate() {
                        r[i] = round6(parse_f64(x, "xywh")? / 100.0);
                    }
                    l.region = Some(r);
                }
                _ => {}
            }
        }
        Ok(u)
    }

    /// Best-effort anchor described by this URI. The type is inferred from
    /// the parameters (`p` → page, `t` → time, `sl` → slide, `sh` → sheet,
    /// `v` → verse, `ref` → canonical, `s`/`para`/`f` → section, only `xywh`
    /// → image).
    pub fn to_anchor(&self) -> Option<Anchor> {
        let l = &self.locator;
        let u32_of = |x: u64| u32::try_from(x).ok();
        let kind = if let Some(p) = l.physical {
            AnchorKind::Page {
                physical: u32_of(p)?,
                printed: l.printed.clone(),
                roman: None,
                foliation: None,
                source: None,
                confidence: None,
            }
        } else if let Some(t) = &l.time {
            AnchorKind::Time {
                t0: *t.first()?,
                t1: t.get(1).copied(),
                speaker: None,
            }
        } else if let Some(n) = l.slide {
            AnchorKind::Slide { n: u32_of(n)? }
        } else if let Some(sheet) = &l.sheet {
            AnchorKind::Sheet {
                sheet: sheet.clone(),
                row_from: l.rows.and_then(|r| u32_of(r[0])),
                row_to: l.rows.and_then(|r| u32_of(r[1])),
            }
        } else if let Some(v) = &l.verse {
            AnchorKind::Verse {
                line_from: u32_of(*v.first()?)?,
                line_to: v.get(1).and_then(|x| u32_of(*x)),
                printed: l.printed.clone(),
            }
        } else if let Some(r) = &l.reference {
            AnchorKind::Canonical {
                scheme: r.scheme.clone(),
                reference: r.reference.clone(),
            }
        } else if l.section.is_some() || l.paragraph.is_some() || l.printed.is_some() {
            AnchorKind::Section {
                path: l.section.clone().unwrap_or_default(),
                paragraph: l.paragraph.and_then(u32_of),
                printed: l.printed.clone(),
            }
        } else if l.region.is_some() {
            AnchorKind::Image
        } else {
            return None;
        };
        Some(Anchor {
            kind,
            region: l.region.map(|r| Region {
                x: r[0],
                y: r[1],
                w: r[2],
                h: r[3],
            }),
            chars: l.chars.map(|c| (c[0], c[1])),
            extra: Map::new(),
        })
    }

    /// The URI without the fragment (`spdf:<docref>`).
    pub fn document_uri(&self) -> String {
        format!("spdf:{}", percent_encode(&self.docref))
    }
}

impl fmt::Display for AnchorUri {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let l = &self.locator;
        let mut params: Vec<String> = Vec::new();
        if let Some(p) = l.physical {
            params.push(format!("p={p}"));
        }
        if let Some(p) = l.physical_end {
            params.push(format!("pe={p}"));
        }
        if let Some(x) = &l.printed {
            params.push(format!("f={}", percent_encode(x)));
        }
        if let Some(x) = &l.printed_end {
            params.push(format!("fe={}", percent_encode(x)));
        }
        if let Some(t) = &l.time {
            let parts: Vec<String> = t.iter().map(|x| fmt_num(*x)).collect();
            params.push(format!("t={}", parts.join(",")));
        }
        if let Some(s) = &l.section {
            let parts: Vec<String> = s.iter().map(|x| percent_encode(x)).collect();
            params.push(format!("s={}", parts.join("/")));
        }
        if let Some(x) = l.paragraph {
            params.push(format!("para={x}"));
        }
        if let Some(x) = l.slide {
            params.push(format!("sl={x}"));
        }
        if let Some(x) = &l.sheet {
            params.push(format!("sh={}", percent_encode(x)));
        }
        if let Some([a, b]) = l.rows {
            params.push(format!("rows={a}-{b}"));
        }
        if let Some(v) = &l.verse {
            let parts: Vec<String> = v.iter().map(u64::to_string).collect();
            params.push(format!("v={}", parts.join("-")));
        }
        if let Some(r) = &l.reference {
            params.push(format!(
                "ref={}:{}",
                percent_encode(&r.scheme),
                percent_encode(&r.reference)
            ));
        }
        if let Some([a, b]) = l.chars {
            params.push(format!("char={a},{b}"));
        }
        if let Some(r) = l.region {
            let parts: Vec<String> = r
                .iter()
                .map(|x| format_number(round_to(x * 100.0, 4)))
                .collect();
            params.push(format!("xywh=percent:{}", parts.join(",")));
        }
        write!(f, "spdf:{}", percent_encode(&self.docref))?;
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

/// Formats the URI of an anchor given as JSON (5.0 names). `docref` is
/// `sha256-<hex>` or a document id.
pub fn format_uri(docref: &str, anchor: &Value, end: Option<&Value>) -> Result<String> {
    if !anchor.is_object() {
        return Err(Error::InvalidAnchor("anchor must be a JSON object".into()));
    }
    Ok(AnchorUri::from_anchor_value(docref, anchor, end).to_string())
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
        let v =
            json!({"type":"time","t0":4160.0,"t1":4175.5,"speaker":"Julio Cortázar","x_note":"y"});
        let a = Anchor::from_value(&v).unwrap();
        assert_eq!(a.to_value(), v);
    }

    #[test]
    fn uri_examples() {
        let a = Anchor::from_value(
            &json!({"type":"section","path":["Chapter 3","3.2 The/panopticon"],"paragraph":4}),
        )
        .unwrap();
        let s = AnchorUri::from_anchor("doc-1", &a, None).to_string();
        assert_eq!(s, "spdf:doc-1#s=Chapter%203/3.2%20The%2Fpanopticon&para=4");
        let back = AnchorUri::parse(&s).unwrap();
        assert_eq!(back.to_anchor().unwrap(), a);

        let t = Anchor::from_value(&json!({"type":"time","t0":4160.0,"t1":4175.5})).unwrap();
        assert_eq!(
            AnchorUri::from_anchor("d", &t, None).to_string(),
            "spdf:d#t=4160,4175.5"
        );

        let c = Anchor::from_value(&json!({"type":"canonical","scheme":"bible","ref":"John 3:16"}))
            .unwrap();
        let s = AnchorUri::from_anchor("d", &c, None).to_string();
        assert_eq!(s, "spdf:d#ref=bible:John%203%3A16");
        assert_eq!(AnchorUri::parse(&s).unwrap().to_anchor().unwrap(), c);

        let p = Anchor::from_value(&json!({"type":"page","physical":29,"printed":"21","chars":[118,301],"region":{"x":0.125,"y":0.2,"w":0.5,"h":0.1}})).unwrap();
        let e = Anchor::from_value(&json!({"type":"page","physical":30,"printed":"22"})).unwrap();
        let s = AnchorUri::from_anchor("sha256-ab", &p, Some(&e)).to_string();
        assert_eq!(
            s,
            "spdf:sha256-ab#p=29&pe=30&f=21&fe=22&char=118,301&xywh=percent:12.5,20,50,10"
        );
        let u = AnchorUri::parse(&s).unwrap();
        assert_eq!(u.to_string(), s);
        assert_eq!(
            serde_json::to_value(&u).unwrap(),
            json!({"docref":"sha256-ab","locator":{"p":29,"pe":30,"f":"21","fe":"22","char":[118,301],"xywh":[0.125,0.2,0.5,0.1]}})
        );
    }

    #[test]
    fn rejects_bad_uris() {
        for bad in [
            "http://x",
            "spdf:",
            "spdf:d#p=x",
            "spdf:d#char=5,2",
            "spdf:d#xywh=percent:1,2",
            "spdf:d#f=%G1",
            "spdf:d#xywh=1,2,3,4",
        ] {
            assert!(AnchorUri::parse(bad).is_err(), "{bad}");
        }
        assert!(AnchorUri::parse("spdf:d#zz=1&p=3").is_ok());
    }

    #[test]
    fn unknown_type() {
        let e = Anchor::from_value(&json!({"type":"hologram"})).unwrap_err();
        assert!(e.to_string().contains("unknown type"));
    }
}
