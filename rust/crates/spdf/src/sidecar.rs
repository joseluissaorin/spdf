//! Sidecar files (SPEC §17): annotations (`.spdfa.json`, W3C Web Annotation)
//! and collections (`.spdfl.json`, a manifest of documents by identity).
//!
//! ```no_run
//! use spdf::sidecar;
//! let doc = spdf::Spdf::open("quijote.spdf")?;
//! let f = doc.fragments()?.remove(0);
//! let a = sidecar::annotation(&doc, &f, Some("Origen del tópico."), &Default::default())?;
//! sidecar::write_annotations("quijote.spdfa.json", &[a], Some("Notas de lectura"))?;
//! # Ok::<(), spdf::Error>(())
//! ```

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::anchor::{Anchor, AnchorUri};
use crate::error::{Error, Result};
use crate::model::Fragment;
use crate::reader::{hex, Spdf};
use crate::text;
use crate::writer::now_utc;

/// JSON-LD context of Web Annotations.
pub const ANNO_CONTEXT: &str = "http://www.w3.org/ns/anno.jsonld";
/// Version of the SPDF annotation profile.
pub const ANNOTATIONS_VERSION: &str = "1.0";
/// Version of the collection manifest.
pub const LIBRARY_VERSION: &str = "1.0";

/// Options for [`annotation`].
#[derive(Clone, Debug)]
pub struct AnnotationOptions {
    /// `commenting`, `highlighting`… (default: `commenting` with a body, else `highlighting`).
    pub motivation: Option<String>,
    /// Language of the body (default: the document language).
    pub language: Option<String>,
    /// Creation time (default: now).
    pub created: Option<String>,
    /// Annotation id (default: a random `urn:uuid:`).
    pub id: Option<String>,
    /// Code points of context in the quote selector (default 32).
    pub context: usize,
}

impl Default for AnnotationOptions {
    fn default() -> Self {
        AnnotationOptions {
            motivation: None,
            language: None,
            created: None,
            id: None,
            context: 32,
        }
    }
}

fn uuid_v4() -> String {
    let mut b = [0u8; 16];
    if getrandom::getrandom(&mut b).is_err() {
        // Fall back to a hash of the clock: still unique enough for an id.
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        b.copy_from_slice(&Sha256::digest(t.to_le_bytes())[..16]);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = hex(&b);
    format!(
        "{}-{}-{}-{}-{}",
        &h[..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..]
    )
}

/// A `TextQuoteSelector` for a fragment: the `chars` range of its unit text
/// with some context, or the fragment text itself.
fn quote(doc: &Spdf, f: &Fragment, context: usize) -> Result<Value> {
    let anchor = Anchor::from_value(&f.anchor).ok();
    if let (Some((a, b)), Some(unit)) = (anchor.and_then(|a| a.chars), doc.unit(&f.unit)?) {
        let t = &unit.text;
        let (a, b) = (a as usize, b as usize);
        if let Some(exact) = text::cp_slice(t, a, b) {
            let prefix = text::cp_slice(t, a.saturating_sub(context), a).unwrap_or("");
            let end = (b + context).min(text::cp_len(t));
            let suffix = text::cp_slice(t, b, end).unwrap_or("");
            return Ok(
                json!({"type": "TextQuoteSelector", "exact": exact, "prefix": prefix, "suffix": suffix}),
            );
        }
    }
    Ok(json!({"type": "TextQuoteSelector", "exact": f.text, "prefix": "", "suffix": ""}))
}

/// A W3C Web Annotation targeting a fragment of an open document. With a
/// `body` it is a comment; without it, a highlight.
pub fn annotation(
    doc: &Spdf,
    f: &Fragment,
    body: Option<&str>,
    opts: &AnnotationOptions,
) -> Result<Value> {
    let d = doc.document()?;
    let a = Anchor::from_value(&f.anchor)?;
    let end = f.parse_anchor_end()?;
    let uri = AnchorUri::from_anchor(&d.docref(), &a, end.as_ref());
    let mut m = Map::new();
    m.insert(
        "id".into(),
        Value::from(
            opts.id
                .clone()
                .unwrap_or_else(|| format!("urn:uuid:{}", uuid_v4())),
        ),
    );
    m.insert("type".into(), Value::from("Annotation"));
    let motivation = opts.motivation.clone().unwrap_or_else(|| {
        if body.is_some() {
            "commenting".into()
        } else {
            "highlighting".into()
        }
    });
    m.insert("motivation".into(), Value::from(motivation));
    m.insert(
        "created".into(),
        Value::from(opts.created.clone().unwrap_or_else(now_utc)),
    );
    if let Some(text) = body {
        let mut b = Map::new();
        b.insert("type".into(), Value::from("TextualBody"));
        b.insert("value".into(), Value::from(text));
        b.insert("format".into(), Value::from("text/plain"));
        if let Some(lang) = opts.language.clone().or(d.language.clone()) {
            b.insert("language".into(), Value::from(lang));
        }
        m.insert("body".into(), Value::Object(b));
    }
    let selectors = vec![
        json!({"type": "SpdfAnchorSelector", "value": uri.to_string()}),
        quote(doc, f, opts.context)?,
    ];
    m.insert(
        "target".into(),
        json!({"source": uri.document_uri(), "selector": selectors}),
    );
    Ok(Value::Object(m))
}

/// Wraps annotations in the `.spdfa.json` collection object.
pub fn annotation_collection(items: &[Value], label: Option<&str>) -> Value {
    let mut m = Map::new();
    m.insert("@context".into(), Value::from(ANNO_CONTEXT));
    m.insert("type".into(), Value::from("AnnotationCollection"));
    m.insert("spdf_annotations".into(), Value::from(ANNOTATIONS_VERSION));
    if let Some(l) = label {
        m.insert("label".into(), Value::from(l));
    }
    m.insert(
        "first".into(),
        json!({"type": "AnnotationPage", "items": items}),
    );
    Value::Object(m)
}

/// Writes a `.spdfa.json` file.
pub fn write_annotations(
    path: impl AsRef<Path>,
    items: &[Value],
    label: Option<&str>,
) -> Result<()> {
    let s = serde_json::to_string_pretty(&annotation_collection(items, label))?;
    std::fs::write(path, s + "\n")?;
    Ok(())
}

/// Reads the annotations of a `.spdfa.json` file.
pub fn read_annotations(path: impl AsRef<Path>) -> Result<Vec<Value>> {
    let v: Value = serde_json::from_slice(&std::fs::read(path)?)?;
    if v.get("type").and_then(Value::as_str) != Some("AnnotationCollection")
        || v.get("spdf_annotations").is_none()
    {
        return Err(Error::invalid(
            "not an SPDF annotation collection (.spdfa.json)",
        ));
    }
    v.get("first")
        .and_then(|f| f.get("items"))
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| Error::invalid("annotation collection without first.items"))
}

/// The SPDF anchor URI of an annotation (its `SpdfAnchorSelector`), if any.
pub fn annotation_uri(annotation: &Value) -> Option<String> {
    annotation
        .get("target")?
        .get("selector")?
        .as_array()?
        .iter()
        .find(|s| s.get("type").and_then(Value::as_str) == Some("SpdfAnchorSelector"))?
        .get("value")?
        .as_str()
        .map(str::to_string)
}

/// One document of a collection.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LibraryItem {
    /// `documents.source_sha256` (the identity used by anchor URIs).
    pub sha256: String,
    /// Title.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title: Option<String>,
    /// Authors (`Family; Family`).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub authors: Option<String>,
    /// Year.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub year: Option<i64>,
    /// Where to fetch a copy.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub url: Option<String>,
    /// SHA-256 of the `.spdf` file bytes.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub file_sha256: Option<String>,
}

/// A collection manifest (`.spdfl.json`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Library {
    /// Manifest version (`1.0`).
    pub spdf_library: String,
    /// Name.
    pub name: String,
    /// Description.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
    /// Creation time.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub created: Option<String>,
    /// Documents, in the user's order.
    pub items: Vec<LibraryItem>,
}

impl Library {
    /// An empty library.
    pub fn new(name: &str) -> Self {
        Library {
            spdf_library: LIBRARY_VERSION.into(),
            name: name.into(),
            description: None,
            created: Some(now_utc()),
            items: Vec::new(),
        }
    }

    /// Adds an SPDF file (opened to read its identity; `file_sha256` computed).
    pub fn add_file(&mut self, path: impl AsRef<Path>, url: Option<&str>) -> Result<&LibraryItem> {
        let bytes = std::fs::read(path.as_ref())?;
        let doc = Spdf::from_bytes(&bytes, &Default::default())?;
        let d = doc.document()?;
        self.items.push(LibraryItem {
            sha256: d.source_sha256.to_ascii_lowercase(),
            title: d.title.clone(),
            authors: d.authors.clone(),
            year: d.year,
            url: url.map(str::to_string),
            file_sha256: Some(hex(&Sha256::digest(&bytes))),
        });
        Ok(self.items.last().expect("just pushed"))
    }

    /// Reads a `.spdfl.json` file.
    pub fn read(path: impl AsRef<Path>) -> Result<Self> {
        let lib: Library = serde_json::from_slice(&std::fs::read(path)?)?;
        Ok(lib)
    }

    /// Writes the manifest.
    pub fn write(&self, path: impl AsRef<Path>) -> Result<()> {
        std::fs::write(path, serde_json::to_string_pretty(self)? + "\n")?;
        Ok(())
    }
}
