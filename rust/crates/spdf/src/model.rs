//! Row types of the 5.0 view. Legacy files are mapped to the same types.
//!
//! JSON-in-TEXT columns (`metadata`, `anchor`, `notes`…) are exposed as
//! [`serde_json::Value`]; use [`crate::Anchor::from_value`] for a typed anchor.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use crate::anchor::Anchor;
use crate::error::Result;

fn bool_from_int<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<bool, D::Error> {
    let v = Value::deserialize(d)?;
    Ok(match v {
        Value::Bool(b) => b,
        Value::Number(n) => n.as_f64().unwrap_or(0.0) != 0.0,
        Value::String(s) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    })
}

fn default_dtype() -> String {
    "f32".to_string()
}

/// The document described by the file (`documents`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Document {
    /// Document id.
    pub id: String,
    /// `pdf`, `scanned_pdf`, `photos`, `image`, `audio`, `video`, `document`, `epub`, `slides`, `sheet`, `web`.
    pub kind: String,
    /// CSL-JSON item plus the `spdf` extension object.
    pub metadata: Value,
    /// Hex SHA-256 of the original bytes.
    pub source_sha256: String,
    /// `blob:<key>`, URL, or `None` if the original is not shipped.
    pub source_ref: Option<String>,
    /// Media type of the original.
    pub mime: String,
    /// Size of the original in bytes.
    pub bytes: i64,
    /// Number of citable units.
    pub unit_count: i64,
    /// Duration in seconds (audio, video).
    pub duration: Option<f64>,
    /// Creation timestamp (ISO 8601).
    pub created: String,
    /// Last update timestamp (ISO 8601).
    pub updated: String,
    /// Denormalized title.
    pub title: Option<String>,
    /// Denormalized authors (`Family; Family`).
    pub authors: Option<String>,
    /// Denormalized year.
    pub year: Option<i64>,
    /// Denormalized language (BCP 47).
    pub language: Option<String>,
    /// Rights JSON `{license, access, holder, note}`.
    pub rights: Option<Value>,
}

impl Document {
    /// The anchor-URI document reference (`sha256-<hex>`).
    pub fn docref(&self) -> String {
        crate::anchor::AnchorUri::docref_sha256(&self.source_sha256)
    }
}

/// A citable unit: page, time span, slide, section or sheet (`units`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Unit {
    /// Unit id.
    pub id: String,
    /// Owning document id.
    pub document: String,
    /// 1-based position.
    pub ord: i64,
    /// Anchor JSON.
    pub anchor: Value,
    /// NFC text (light Markdown).
    pub text: String,
    /// Footnotes (JSON string array).
    pub notes: Option<Value>,
    /// Running header.
    pub header: Option<String>,
    /// Running footer.
    pub footer: Option<String>,
    /// `blob:<key>` or URL of the unit image.
    pub image: Option<String>,
    /// `blob:<key>` or URL of the thumbnail.
    pub thumbnail: Option<String>,
    /// Who produced the text.
    pub reader: String,
    /// Confidence 0–1.
    pub confidence: f64,
    /// Printed folio.
    pub printed: Option<String>,
    /// Start time (s).
    pub t0: Option<f64>,
    /// End time (s).
    pub t1: Option<f64>,
    /// Word timings JSON.
    pub words: Option<Value>,
}

impl Unit {
    /// The typed anchor.
    pub fn parse_anchor(&self) -> Result<Anchor> {
        Anchor::from_value(&self.anchor)
    }
}

/// A section of the table of contents (`sections`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Section {
    /// Section id.
    pub id: String,
    /// Owning document id.
    pub document: String,
    /// Parent section id.
    pub parent: Option<String>,
    /// Depth (1 = top).
    pub level: i64,
    /// Heading.
    pub title: String,
    /// First unit id.
    pub unit_from: String,
    /// Last unit id.
    pub unit_to: Option<String>,
    /// Summary.
    pub summary: Option<String>,
}

/// A searchable, citable passage (`fragments`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Fragment {
    /// Stable rowid used by FTS.
    pub n: i64,
    /// Fragment id.
    pub id: String,
    /// Owning document id.
    pub document: String,
    /// Unit id where the fragment starts.
    pub unit: String,
    /// Reading order.
    pub ord: i64,
    /// Literal NFC text.
    pub text: String,
    /// One line situating the fragment.
    pub context: String,
    /// Heading path (JSON string array).
    pub section: Option<Value>,
    /// Anchor of the start.
    pub anchor: Value,
    /// Anchor of the end, if the fragment crosses units.
    pub anchor_end: Option<Value>,
    /// Modernized-spelling layer, search only.
    pub search_text: Option<String>,
}

impl Fragment {
    /// The typed start anchor.
    pub fn parse_anchor(&self) -> Result<Anchor> {
        Anchor::from_value(&self.anchor)
    }
    /// The typed end anchor, if any.
    pub fn parse_anchor_end(&self) -> Result<Option<Anchor>> {
        self.anchor_end
            .as_ref()
            .filter(|v| !v.is_null())
            .map(Anchor::from_value)
            .transpose()
    }
}

/// A figure (`figures`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Figure {
    /// Figure id.
    pub id: String,
    /// Owning document id.
    pub document: String,
    /// Unit id.
    pub unit: String,
    /// `blob:<key>` (cropped) or the unit image.
    pub image: String,
    /// Caption.
    pub caption: Option<String>,
    /// Description in the document language.
    pub description: Option<String>,
    /// Anchor with `region`.
    pub anchor: Value,
}

/// Element type of stored vectors.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Dtype {
    /// IEEE binary32.
    F32,
    /// IEEE binary16.
    F16,
    /// Signed 8-bit, value = q / 127.
    I8,
}

impl Dtype {
    /// Parses `f32` | `f16` | `i8`.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "f32" => Some(Dtype::F32),
            "f16" => Some(Dtype::F16),
            "i8" => Some(Dtype::I8),
            _ => None,
        }
    }
    /// Size of one component in bytes.
    pub fn size(self) -> usize {
        match self {
            Dtype::F32 => 4,
            Dtype::F16 => 2,
            Dtype::I8 => 1,
        }
    }
    /// Name as stored.
    pub fn as_str(self) -> &'static str {
        match self {
            Dtype::F32 => "f32",
            Dtype::F16 => "f16",
            Dtype::I8 => "i8",
        }
    }
}

/// A vector space: which model produced the vectors (`spaces`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Space {
    /// `model@dims[:dtype]`.
    pub id: String,
    /// Provider (`google`, `local`…).
    pub provider: String,
    /// Model name.
    pub model: String,
    /// Model version.
    pub version: Option<String>,
    /// Dimensions.
    pub dims: i64,
    /// `f32` | `f16` | `i8`.
    #[serde(default = "default_dtype")]
    pub dtype: String,
    /// Vectors are L2-normalized.
    #[serde(deserialize_with = "bool_from_int")]
    pub normalized: bool,
    /// Matryoshka: original dims if truncated.
    pub truncated_from: Option<i64>,
    /// JSON array of modalities.
    pub modalities: Value,
    /// JSON `{query, document}` prefixes used at encode time.
    pub task_prefixes: Option<Value>,
    /// Creation timestamp.
    pub created: Option<String>,
}

impl Space {
    /// A new f32, normalized, text-only space with id `model@dims`.
    pub fn new(provider: &str, model: &str, dims: usize) -> Self {
        Space {
            id: format!("{model}@{dims}"),
            provider: provider.to_string(),
            model: model.to_string(),
            version: None,
            dims: dims as i64,
            dtype: "f32".to_string(),
            normalized: true,
            truncated_from: None,
            modalities: Value::from(vec!["text"]),
            task_prefixes: None,
            created: None,
        }
    }

    /// Typed dtype, if known.
    pub fn dtype(&self) -> Option<Dtype> {
        Dtype::parse(&self.dtype)
    }

    /// True if vectors of both spaces can be compared with one query vector
    /// (same provider, model, version, dims, normalized, truncated_from and
    /// task_prefixes; dtype may differ).
    pub fn compatible_with(&self, other: &Space) -> bool {
        self.provider == other.provider
            && self.model == other.model
            && self.version == other.version
            && self.dims == other.dims
            && self.normalized == other.normalized
            && self.truncated_from == other.truncated_from
            && self.task_prefixes == other.task_prefixes
    }
}

/// What a vector describes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    /// A fragment (the default for search).
    #[default]
    Fragment,
    /// A unit.
    Unit,
    /// A figure.
    Figure,
}

impl Target {
    /// Name as stored.
    pub fn as_str(self) -> &'static str {
        match self {
            Target::Fragment => "fragment",
            Target::Unit => "unit",
            Target::Figure => "figure",
        }
    }
    /// Parses `fragment` | `unit` | `figure`.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "fragment" => Some(Target::Fragment),
            "unit" => Some(Target::Unit),
            "figure" => Some(Target::Figure),
            _ => None,
        }
    }
}

/// A decoded vector.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Vector {
    /// What it describes.
    pub target: Target,
    /// Id of the fragment, unit or figure.
    pub id: String,
    /// Space id.
    pub space: String,
    /// Components (decoded to f32; i8 as q/127).
    pub values: Vec<f32>,
}

/// One processing step (`provenance`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Provenance {
    /// Document id.
    pub document: String,
    /// Stage name.
    pub stage: String,
    /// Provider.
    pub provider: Option<String>,
    /// Model.
    pub model: Option<String>,
    /// JSON object or null.
    pub detail: Option<Value>,
    /// Duration in milliseconds.
    pub ms: Option<i64>,
    /// Timestamp.
    pub at: String,
}

/// A declared extension (`extensions`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Extension {
    /// Extension name.
    pub name: String,
    /// Version.
    pub version: String,
    /// A reader that does not know it must refuse the file.
    #[serde(deserialize_with = "bool_from_int")]
    pub required: bool,
}

/// Blob metadata.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BlobInfo {
    /// Key (referenced as `blob:<key>`).
    pub key: String,
    /// Media type.
    pub mime: String,
    /// Size in bytes.
    pub bytes: i64,
    /// Stored SHA-256 (hex); computed for legacy files.
    pub sha256: String,
}

fn ser_b64<S: Serializer>(d: &[u8], s: S) -> std::result::Result<S::Ok, S::Error> {
    use base64::Engine;
    s.serialize_str(&base64::engine::general_purpose::STANDARD.encode(d))
}

fn de_b64<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Vec<u8>, D::Error> {
    use base64::Engine;
    let s = String::deserialize(d)?;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(serde::de::Error::custom)
}

/// A blob with its bytes (serialized as base64).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Blob {
    /// Key.
    pub key: String,
    /// Media type.
    pub mime: String,
    /// Bytes.
    #[serde(serialize_with = "ser_b64", deserialize_with = "de_b64")]
    pub data: Vec<u8>,
}

/// One search result (SPEC §8).
///
/// In JSON the id is written under the name of its target: `fragment_id`
/// for fragments (lexical, hybrid and fragment vector search), `unit_id` or
/// `figure_id` for vector search over units or figures.
#[derive(Clone, Debug, PartialEq)]
pub struct SearchHit {
    /// Id of the hit. For unit and figure targets this is the unit or figure
    /// id (the field keeps its historical name; see [`SearchHit::id`]).
    pub fragment_id: String,
    /// What the id refers to.
    pub target: Target,
    /// Score (higher is better).
    pub score: f64,
    /// Which lists produced it: `lexical`, `vector`.
    pub via: Vec<String>,
    /// Anchor JSON of the hit.
    pub anchor: Value,
    /// `spdf:` URI of the hit.
    pub anchor_uri: String,
}

impl SearchHit {
    /// Id of the fragment, unit or figure (see [`SearchHit::target`]).
    pub fn id(&self) -> &str {
        &self.fragment_id
    }
}

impl Serialize for SearchHit {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut m = s.serialize_map(Some(5))?;
        let key = match self.target {
            Target::Fragment => "fragment_id",
            Target::Unit => "unit_id",
            Target::Figure => "figure_id",
        };
        m.serialize_entry(key, &self.fragment_id)?;
        m.serialize_entry("score", &self.score)?;
        m.serialize_entry("via", &self.via)?;
        m.serialize_entry("anchor", &self.anchor)?;
        m.serialize_entry("anchor_uri", &self.anchor_uri)?;
        m.end()
    }
}

impl<'de> Deserialize<'de> for SearchHit {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        let v = Value::deserialize(d)?;
        let (target, id) = [
            (Target::Fragment, "fragment_id"),
            (Target::Unit, "unit_id"),
            (Target::Figure, "figure_id"),
        ]
        .iter()
        .find_map(|(t, k)| {
            v.get(*k)
                .and_then(Value::as_str)
                .map(|id| (*t, id.to_string()))
        })
        .ok_or_else(|| {
            serde::de::Error::custom("search hit without fragment_id, unit_id or figure_id")
        })?;
        Ok(SearchHit {
            fragment_id: id,
            target,
            score: v.get("score").and_then(Value::as_f64).unwrap_or(0.0),
            via: v
                .get("via")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
            anchor: v.get("anchor").cloned().unwrap_or(Value::Null),
            anchor_uri: v
                .get("anchor_uri")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        })
    }
}

/// Result of [`crate::Spdf::locate`] (SPEC §5.4).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Location {
    /// The reference designates this document.
    pub document: bool,
    /// Ids of the matching units, in `ord` order.
    pub units: Vec<String>,
    /// Ids of the matching fragments, in `n` order.
    pub fragments: Vec<String>,
    /// `char` range of the locator, if any.
    #[serde(rename = "char")]
    pub chars: Option<[u64; 2]>,
    /// `xywh` region of the locator (fractions), if any.
    pub xywh: Option<[f64; 4]>,
}

/// Result of [`crate::Spdf::cite_passage`] (SPEC §18.2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PassageCitation {
    /// Short citation, e.g. `(Hooke, 1665, p. 211)`.
    pub text: String,
    /// Anchor URI of the cited unit or range.
    pub uri: String,
    /// Anchor cited (the unit's anchor, with `chars` when the quotation lies in one unit).
    pub anchor: Value,
    /// End anchor when the quotation spans two units.
    pub anchor_end: Option<Value>,
}
