//! Writing SPDF 5.0 files: [`Writer`] and [`convert_legacy`].
//!
//! The writer builds the database in memory and, on [`Writer::write`],
//! rebuilds the FTS index, sets `application_id`/`user_version`, compacts
//! with `VACUUM` and writes the bytes atomically. Files never contain
//! triggers or views.
//!
//! ```
//! use serde_json::json;
//! use spdf::{Writer, Document, Unit, Fragment, Space, Target};
//!
//! let mut w = Writer::new()?;
//! w.set_document(&Document {
//!     id: "doc-1".into(), kind: "pdf".into(),
//!     metadata: json!({"type":"book","title":"Lazarillo de Tormes","issued":{"date-parts":[[1554]]}}),
//!     source_sha256: "0".repeat(64), source_ref: None, mime: "application/pdf".into(), bytes: 1,
//!     unit_count: 1, duration: None, created: "2026-10-07T00:00:00Z".into(),
//!     updated: "2026-10-07T00:00:00Z".into(), title: Some("Lazarillo de Tormes".into()),
//!     authors: None, year: Some(1554), language: Some("es".into()), rights: None,
//! })?;
//! w.add_unit(&Unit {
//!     id: "u1".into(), document: "doc-1".into(), ord: 1,
//!     anchor: json!({"type":"page","physical":1,"printed":"3"}),
//!     text: "Pues sepa Vuestra Merced ante todas cosas que a mí llaman Lázaro de Tormes".into(),
//!     notes: None, header: None, footer: None, image: None, thumbnail: None,
//!     reader: "pdf-text-layer".into(), confidence: 1.0, printed: Some("3".into()),
//!     t0: None, t1: None, words: None,
//! })?;
//! w.add_fragment(&Fragment {
//!     n: 1, id: "f1".into(), document: "doc-1".into(), unit: "u1".into(), ord: 1,
//!     text: "Pues sepa Vuestra Merced ante todas cosas que a mí llaman Lázaro de Tormes".into(),
//!     context: "Tratado primero".into(), section: Some(json!(["Tratado primero"])),
//!     anchor: json!({"type":"page","physical":1,"printed":"3"}), anchor_end: None, search_text: None,
//! })?;
//! w.add_space(&Space::new("local", "toy", 2))?;
//! w.add_vector(Target::Fragment, "f1", "toy@2", &[0.6, 0.8])?;
//! let bytes = w.to_bytes()?;
//! let doc = spdf::Spdf::from_bytes(&bytes, &Default::default())?;
//! assert_eq!(doc.search_lexical("lazaro", 5)?[0].fragment_id, "f1");
//! assert!(spdf::validate_bytes(&bytes).valid);
//! # Ok::<(), spdf::Error>(())
//! ```

use std::collections::BTreeMap;
use std::path::Path;

use rusqlite::{params_from_iter, Connection};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::integrity::{content_sha256_of_dump, KeyPair};
use crate::model::*;
use crate::reader::{hex, OpenOptions, Spdf};
use crate::schema::{self, TableDef};
use crate::vector;

/// Generator string written by default (`spdf-rs/<version>`).
pub const GENERATOR: &str = concat!("spdf-rs/", env!("CARGO_PKG_VERSION"));

const JSON_COLUMNS: &[&str] = &[
    "metadata",
    "rights",
    "anchor",
    "notes",
    "words",
    "section",
    "anchor_end",
    "modalities",
    "task_prefixes",
    "detail",
];

/// Current UTC time as ISO 8601 (`2026-10-07T10:00:00Z`).
pub fn now_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil date from days since 1970-01-01 (H. Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn to_sql(v: &Value, json_col: bool) -> rusqlite::types::Value {
    use rusqlite::types::Value as S;
    match v {
        Value::Null => S::Null,
        _ if json_col => S::Text(v.to_string()),
        Value::Bool(b) => S::Integer(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => S::Integer(i),
            None => S::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => S::Text(s.clone()),
        other => S::Text(other.to_string()),
    }
}

/// Builds SPDF 5.0 files.
pub struct Writer {
    conn: Connection,
    meta: BTreeMap<String, String>,
    document_id: Option<String>,
    trigram: bool,
    seal: Option<Option<KeyPair>>,
}

impl std::fmt::Debug for Writer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Writer")
            .field("document_id", &self.document_id)
            .field("meta", &self.meta)
            .finish()
    }
}

impl Writer {
    /// An empty 5.0 database in memory.
    pub fn new() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA page_size = 4096;")?;
        conn.execute_batch(schema::SCHEMA_SQL)?;
        conn.pragma_update(None, "application_id", schema::APPLICATION_ID)?;
        conn.pragma_update(None, "user_version", schema::USER_VERSION)?;
        Ok(Writer {
            conn,
            meta: BTreeMap::new(),
            document_id: None,
            trigram: false,
            seal: None,
        })
    }

    /// Sets a `spdf_meta` key (e.g. `profile`, `license_note`).
    pub fn set_meta(&mut self, key: &str, value: &str) {
        self.meta.insert(key.to_string(), value.to_string());
    }

    /// Adds the optional `fragments_fts_trigram` index (CJK search).
    pub fn enable_trigram(&mut self, on: bool) {
        self.trigram = on;
    }

    /// Computes `content_sha256` on write and, with a key, signs it.
    pub fn seal(&mut self, key: Option<&KeyPair>) {
        self.seal = Some(key.cloned());
    }

    fn insert(&self, t: &TableDef, row: &Map<String, Value>) -> Result<()> {
        let cols: Vec<&str> = t
            .columns
            .iter()
            .map(|c| c.0)
            .filter(|c| row.contains_key(*c))
            .collect();
        let placeholders: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "INSERT INTO {} ({}) VALUES ({})",
            t.name,
            cols.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", "),
            placeholders.join(", ")
        );
        let vals: Vec<rusqlite::types::Value> = cols
            .iter()
            .map(|c| to_sql(&row[*c], JSON_COLUMNS.contains(c)))
            .collect();
        self.conn.execute(&sql, params_from_iter(vals))?;
        Ok(())
    }

    fn insert_ser<T: Serialize>(&self, t: &TableDef, item: &T) -> Result<()> {
        match serde_json::to_value(item)? {
            Value::Object(m) => self.insert(t, &m),
            _ => Err(Error::invalid("row must serialize to an object")),
        }
    }

    fn doc_id(&self) -> String {
        self.document_id.clone().unwrap_or_default()
    }

    /// Sets the document row (exactly one per file).
    pub fn set_document(&mut self, d: &Document) -> Result<()> {
        self.conn.execute("DELETE FROM documents", [])?;
        self.insert_ser(&schema::DOCUMENTS, d)?;
        self.document_id = Some(d.id.clone());
        Ok(())
    }

    /// Adds a unit.
    pub fn add_unit(&mut self, u: &Unit) -> Result<()> {
        self.insert_ser(&schema::UNITS, u)
    }

    /// Adds a section.
    pub fn add_section(&mut self, s: &Section) -> Result<()> {
        self.insert_ser(&schema::SECTIONS, s)
    }

    /// Adds a fragment (`n` is the stable FTS rowid; use 1, 2, 3…).
    pub fn add_fragment(&mut self, f: &Fragment) -> Result<()> {
        self.insert_ser(&schema::FRAGMENTS, f)
    }

    /// Adds a figure.
    pub fn add_figure(&mut self, f: &Figure) -> Result<()> {
        self.insert_ser(&schema::FIGURES, f)
    }

    /// Adds (or replaces) a vector space.
    pub fn add_space(&mut self, s: &Space) -> Result<()> {
        if Dtype::parse(&s.dtype).is_none() {
            return Err(Error::Vector(format!("unknown dtype `{}`", s.dtype)));
        }
        self.conn.execute("DELETE FROM spaces WHERE id = ?1", [&s.id])?;
        let mut m = match serde_json::to_value(s)? {
            Value::Object(m) => m,
            _ => Map::new(),
        };
        if m.get("created").map(Value::is_null).unwrap_or(true) {
            m.insert("created".into(), Value::from(now_utc()));
        }
        self.insert(&schema::SPACES, &m)
    }

    fn space_shape(&self, space: &str) -> Result<(Dtype, usize)> {
        let (dtype, dims): (String, i64) = self
            .conn
            .query_row(
                "SELECT dtype, dims FROM spaces WHERE id = ?1",
                [space],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| Error::Vector(format!("unknown space `{space}`; add it first")))?;
        let dt = Dtype::parse(&dtype).ok_or_else(|| Error::Vector(format!("unknown dtype `{dtype}`")))?;
        Ok((dt, usize::try_from(dims).unwrap_or(0)))
    }

    /// Adds a vector, encoded in the space's dtype (i8 and f16 quantized as
    /// the contract says).
    pub fn add_vector(&mut self, target: Target, id: &str, space: &str, values: &[f32]) -> Result<()> {
        let (dtype, dims) = self.space_shape(space)?;
        if values.len() != dims {
            return Err(Error::Vector(format!(
                "vector for `{id}` has {} dimensions, space `{space}` has {dims}",
                values.len()
            )));
        }
        self.add_vector_raw(target, id, space, &vector::encode(values, dtype))
    }

    /// Adds a vector already encoded (little-endian, dims × dtype size).
    pub fn add_vector_raw(&mut self, target: Target, id: &str, space: &str, data: &[u8]) -> Result<()> {
        let (dtype, dims) = self.space_shape(space)?;
        if data.len() != dims * dtype.size() {
            return Err(Error::Vector(format!(
                "vector for `{id}` has {} bytes, expected {}",
                data.len(),
                dims * dtype.size()
            )));
        }
        self.conn.execute(
            "INSERT OR REPLACE INTO vectors (target, id, space, document, data) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![target.as_str(), id, space, self.doc_id(), data],
        )?;
        Ok(())
    }

    /// Adds a blob; returns its reference (`blob:<key>`).
    pub fn add_blob(&mut self, key: &str, mime: &str, data: &[u8]) -> Result<String> {
        let sha = hex(&Sha256::digest(data));
        self.conn.execute(
            "INSERT OR REPLACE INTO blobs (key, mime, sha256, data) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![key, mime, sha, data],
        )?;
        Ok(format!("blob:{key}"))
    }

    /// Adds a provenance entry.
    pub fn add_provenance(&mut self, p: &Provenance) -> Result<()> {
        self.insert_ser(&schema::PROVENANCE, p)
    }

    /// Declares an extension.
    pub fn add_extension(&mut self, e: &Extension) -> Result<()> {
        self.insert_ser(&schema::EXTENSIONS, e)
    }

    /// A writer pre-filled with everything in `doc` (5.0 or legacy 4.x,
    /// which is converted through the 5.0 view).
    pub fn from_spdf(doc: &Spdf) -> Result<Self> {
        let mut w = Writer::new()?;
        let meta = doc.meta()?;
        for (k, v) in &meta {
            w.meta.insert(k.clone(), v.clone());
        }
        if doc.is_legacy() {
            w.meta.insert("spdf_version".into(), schema::SPDF_VERSION.into());
            w.meta.insert("converted_from".into(), doc.version().to_string());
            if let Some(g) = w.meta.remove("generator") {
                w.meta.insert("source_generator".into(), g);
            }
            w.meta.remove("fts_pendiente");
        }
        w.meta.remove("content_sha256");
        w.meta.remove("signature");
        w.meta.remove("signer");
        let d = doc.document()?;
        w.set_document(&d)?;
        for u in doc.units()? {
            w.add_unit(&u)?;
        }
        for s in doc.sections()? {
            w.add_section(&s)?;
        }
        for f in doc.fragments()? {
            w.add_fragment(&f)?;
        }
        for f in doc.figures()? {
            w.add_figure(&f)?;
        }
        for s in doc.spaces()? {
            w.insert_ser(&schema::SPACES, &s)?;
            for (target, id, data) in doc.raw_vectors(&s.id, None)? {
                w.conn.execute(
                    "INSERT OR REPLACE INTO vectors (target, id, space, document, data) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![target, id, s.id, d.id, data],
                )?;
            }
        }
        for b in doc.blobs()? {
            if let Some(blob) = doc.blob(&b.key)? {
                w.add_blob(&blob.key, &blob.mime, &blob.data)?;
            }
        }
        for p in doc.provenance()? {
            w.add_provenance(&p)?;
        }
        for e in doc.extensions()? {
            w.add_extension(&e)?;
        }
        w.trigram = doc.has_trigram();
        Ok(w)
    }

    /// A writer from a canonical dump (§5). Because a dump only carries
    /// digests of vectors and blobs, their contents can be supplied in the
    /// conformance `sources` form: `"vector_data": {"<space>": [{"target",
    /// "id", "values": [...]}, …]}` and `"blob_data": {"<key>": "<base64>"}`
    /// next to the dump members (or inside `"vectors"`/`"blobs"` entries as
    /// `"items"`/`"data_base64"`).
    pub fn from_dump(dump: &Value) -> Result<Self> {
        crate::sources::writer_from_dump(dump)
    }

    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }

    pub(crate) fn meta_mut(&mut self) -> &mut BTreeMap<String, String> {
        &mut self.meta
    }

    pub(crate) fn set_document_id(&mut self, id: &str) {
        self.document_id = Some(id.to_string());
    }

    fn default_profile(&self) -> Result<String> {
        let mut p = vec!["core"];
        let vectors: i64 = self.conn.query_row("SELECT count(*) FROM vectors", [], |r| r.get(0))?;
        if vectors > 0 {
            p.push("semantic");
        }
        let times: i64 = self.conn.query_row(
            "SELECT count(*) FROM units WHERE json_valid(anchor) AND json_extract(anchor, '$.type') = 'time'",
            [],
            |r| r.get(0),
        )?;
        if times > 0 {
            p.push("media");
        }
        Ok(p.join(" "))
    }

    fn write_meta(&mut self) -> Result<()> {
        let doc_id: Option<String> = self
            .conn
            .query_row("SELECT id FROM documents LIMIT 1", [], |r| r.get(0))
            .ok();
        self.meta
            .entry("spdf_version".into())
            .or_insert_with(|| schema::SPDF_VERSION.into());
        if !self.meta.contains_key("profile") {
            let p = self.default_profile()?;
            self.meta.insert("profile".into(), p);
        }
        self.meta.entry("created".into()).or_insert_with(now_utc);
        self.meta
            .entry("generator".into())
            .or_insert_with(|| GENERATOR.to_string());
        if let Some(id) = doc_id {
            self.meta.entry("document_id".into()).or_insert(id);
        }
        self.conn.execute("DELETE FROM spdf_meta", [])?;
        for (k, v) in &self.meta {
            self.conn.execute(
                "INSERT INTO spdf_meta (key, value) VALUES (?1, ?2)",
                [k, v],
            )?;
        }
        Ok(())
    }

    fn finalize(&mut self) -> Result<Vec<u8>> {
        self.write_meta()?;
        self.conn
            .execute("INSERT INTO fragments_fts(fragments_fts) VALUES('rebuild')", [])?;
        let has_tri: bool = self.conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = 'fragments_fts_trigram'",
            [],
            |r| r.get::<_, i64>(0).map(|n| n > 0),
        )?;
        if self.trigram && !has_tri {
            self.conn.execute_batch(schema::TRIGRAM_SQL)?;
        }
        if !self.trigram && has_tri {
            self.conn.execute_batch("DROP TABLE fragments_fts_trigram")?;
        }
        if self.trigram {
            self.conn.execute(
                "INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES('rebuild')",
                [],
            )?;
        }
        if let Some(key) = self.seal.take() {
            self.meta.remove("content_sha256");
            self.meta.remove("signature");
            self.meta.remove("signer");
            if let Some(k) = &key {
                self.meta.insert("signer".into(), k.signer());
            }
            self.write_meta()?;
            let bytes = self.serialize()?;
            let opts = OpenOptions {
                ignore_required_extensions: true,
                ..Default::default()
            };
            let h = content_sha256_of_dump(&Spdf::from_bytes(&bytes, &opts)?.dump()?);
            self.meta.insert("content_sha256".into(), h.clone());
            if let Some(k) = &key {
                self.meta.insert("signature".into(), k.sign_hash(&h));
            }
            self.write_meta()?;
            self.seal = Some(key);
        }
        self.conn.execute_batch("VACUUM")?;
        self.serialize()
    }

    fn serialize(&self) -> Result<Vec<u8>> {
        let data = self.conn.serialize(rusqlite::MAIN_DB)?;
        let mut v = data.to_vec();
        // Rollback journal (DELETE) header bytes, never WAL.
        if v.len() > 19 {
            v[18] = 1;
            v[19] = 1;
        }
        Ok(v)
    }

    /// Finishes the file and returns its bytes.
    pub fn to_bytes(&mut self) -> Result<Vec<u8>> {
        self.finalize()
    }

    /// Finishes the file and writes it atomically to `path`.
    pub fn write(&mut self, path: impl AsRef<Path>) -> Result<()> {
        let bytes = self.finalize()?;
        let path = path.as_ref();
        let tmp = path.with_extension("spdf.tmp");
        std::fs::write(&tmp, &bytes)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}

/// Converts a legacy 4.x file (gzip or not) to a 5.0 file at `dst`.
pub fn convert_legacy(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> Result<()> {
    let doc = Spdf::open(src.as_ref())?;
    if !doc.is_legacy() {
        return Err(Error::invalid(format!(
            "{} is already SPDF {}",
            src.as_ref().display(),
            doc.version()
        )));
    }
    let mut w = Writer::from_spdf(&doc)?;
    drop(doc);
    w.write(dst)
}
