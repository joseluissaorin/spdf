//! Validation (contract §12) with the error codes of the contract.
//!
//! ```no_run
//! let report = spdf::validate("book.spdf");
//! if !report.valid {
//!     for e in &report.errors {
//!         eprintln!("{} {} ({})", e.code, e.message, e.r#where);
//!     }
//! }
//! ```

use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::anchor::ANCHOR_TYPES;
use crate::error::Error;
use crate::integrity::{content_sha256_of_dump, verify_signature};
use crate::model::Dtype;
use crate::reader::{self, Flavor, OpenOptions, Origin, SchemaInfo, Spdf};
use crate::schema;
use crate::text;

/// One finding.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issue {
    /// Contract code (`E010`, `W100`…).
    pub code: String,
    /// Human-readable explanation.
    pub message: String,
    /// Where (table, row id, key…).
    #[serde(rename = "where")]
    pub r#where: String,
}

/// Validation report (§12).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ValidationReport {
    /// No errors.
    pub valid: bool,
    /// Format version found (`5.0`, `4.1`…), if it could be read.
    pub version: Option<String>,
    /// Declared profile.
    pub profile: Vec<String>,
    /// Errors.
    pub errors: Vec<Issue>,
    /// Warnings (including E003).
    pub warnings: Vec<Issue>,
}

impl ValidationReport {
    /// Sorted, deduplicated error codes.
    pub fn error_codes(&self) -> Vec<String> {
        self.errors
            .iter()
            .map(|e| e.code.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    /// Sorted, deduplicated warning codes.
    pub fn warning_codes(&self) -> Vec<String> {
        self.warnings
            .iter()
            .map(|e| e.code.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }
}

const MAX_PER_CODE: usize = 50;

struct Collector {
    errors: Vec<Issue>,
    warnings: Vec<Issue>,
    counts: HashMap<String, usize>,
    /// Error codes reported as warnings (forward compatibility, SPEC §23).
    soft: Vec<&'static str>,
}

impl Collector {
    fn push(
        &mut self,
        warning: bool,
        code: &str,
        message: impl Into<String>,
        at: impl Into<String>,
    ) {
        let c = self.counts.entry(code.to_string()).or_insert(0);
        *c += 1;
        if *c > MAX_PER_CODE {
            return;
        }
        let issue = Issue {
            code: code.to_string(),
            message: message.into(),
            r#where: at.into(),
        };
        if warning {
            self.warnings.push(issue);
        } else {
            self.errors.push(issue);
        }
    }
    fn err(&mut self, code: &str, message: impl Into<String>, at: impl Into<String>) {
        let soft = self.soft.contains(&code);
        self.push(soft, code, message, at);
    }
    fn warn(&mut self, code: &str, message: impl Into<String>, at: impl Into<String>) {
        self.push(true, code, message, at);
    }
}

/// Validates a file.
pub fn validate(path: impl AsRef<Path>) -> ValidationReport {
    let opts = OpenOptions {
        ignore_required_extensions: true,
        ..Default::default()
    };
    let path = path.as_ref();
    let mut c = Collector {
        errors: Vec::new(),
        warnings: Vec::new(),
        counts: HashMap::new(),
        soft: Vec::new(),
    };
    match reader::open_connection(path, &opts) {
        Ok((conn, gzip, origin)) => validate_connection(conn, gzip, origin, c),
        Err(e) => {
            c.err(
                code_or(&e, "E001"),
                e.to_string(),
                path.display().to_string(),
            );
            finish(c, None, Vec::new())
        }
    }
}

/// Validates an in-memory file (SQLite or gzip-wrapped SQLite).
pub fn validate_bytes(bytes: &[u8]) -> ValidationReport {
    let opts = OpenOptions {
        ignore_required_extensions: true,
        ..Default::default()
    };
    let mut c = Collector {
        errors: Vec::new(),
        warnings: Vec::new(),
        counts: HashMap::new(),
        soft: Vec::new(),
    };
    let gzip = bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b;
    match reader::connection_from_bytes(bytes.to_vec(), &opts) {
        Ok(conn) => validate_connection(conn, gzip, Origin::Memory, c),
        Err(e) => {
            c.err(code_or(&e, "E001"), e.to_string(), "");
            finish(c, None, Vec::new())
        }
    }
}

fn code_or(e: &Error, default: &'static str) -> &'static str {
    match e {
        Error::Io(_) | Error::Sqlite(_) | Error::TooLarge(_) => default,
        other => other.code().unwrap_or(default),
    }
}

fn finish(c: Collector, version: Option<String>, profile: Vec<String>) -> ValidationReport {
    ValidationReport {
        valid: c.errors.is_empty(),
        version,
        profile,
        errors: c.errors,
        warnings: c.warnings,
    }
}

/// Columns required in each 5.0 table (§2); `fragments_fts` only has to exist.
fn required_columns(t: &str) -> Vec<&'static str> {
    if t == "fragments_fts" {
        return Vec::new();
    }
    schema::TABLES
        .iter()
        .find(|d| d.name == t)
        .map(|d| d.columns.iter().map(|c| c.0).collect())
        .unwrap_or_default()
}

const REQUIRED_TABLES: &[&str] = &[
    "spdf_meta",
    "documents",
    "units",
    "sections",
    "fragments",
    "fragments_fts",
    "figures",
    "spaces",
    "vectors",
    "blobs",
    "provenance",
    "extensions",
];

/// (id, metadata, rights, unit_count) of a `documents` row.
type DocRow = (String, Option<String>, Option<String>, Option<i64>);

fn json_ok(s: &str) -> bool {
    serde_json::from_str::<Value>(s).is_ok()
}

fn validate_connection(
    conn: Connection,
    gzip: bool,
    origin: Origin,
    mut c: Collector,
) -> ValidationReport {
    let info = match SchemaInfo::read(&conn) {
        Ok(i) => i,
        Err(e) => {
            c.err(
                "E001",
                format!("cannot read the SQLite schema: {e}"),
                "sqlite_master",
            );
            return finish(c, None, Vec::new());
        }
    };
    let Some(flavor) = info.flavor() else {
        c.err(
            "E002",
            format!(
                "not an SPDF database (application_id {}, user_version {})",
                info.application_id, info.user_version
            ),
            "header",
        );
        return finish(c, None, Vec::new());
    };
    let doc = match Spdf::assemble(conn, gzip, origin, info.clone(), flavor) {
        Ok(d) => d,
        Err(e) => {
            c.err("E001", e.to_string(), "sqlite");
            return finish(c, None, Vec::new());
        }
    };
    if let Err(e) = doc.check_version() {
        c.err("E002", e.to_string(), "header");
        return finish(c, None, Vec::new());
    }
    if flavor == Flavor::Legacy {
        let version = Some(doc.version.clone());
        c.warn(
            "W110",
            format!("legacy SPDF {} file", doc.version),
            "header",
        );
        for t in [
            "spdf",
            "documentos",
            "unidades",
            "fragmentos",
            "fragmentos_fts",
        ] {
            if !info.tables.contains_key(t) {
                c.err("E010", format!("missing legacy table `{t}`"), t);
            }
        }
        for obj in info.forbidden_objects(Some(flavor)) {
            c.err("E020", format!("{obj} is not allowed"), obj.clone());
        }
        return finish(c, version, Vec::new());
    }

    // 5.x
    let uv = info.user_version;
    let version_s = format!("{}.{}", uv / 100, (uv % 100) / 10);
    let version = Some(version_s.clone());
    if gzip {
        c.warn(
            "E003",
            "SPDF 5.0 files must not be gzip-wrapped",
            "container",
        );
    }
    if version_s != schema::SPDF_VERSION {
        c.warn("W105", format!("newer minor version {version_s}"), "header");
        // A later minor version may define new anchor types and dtypes.
        c.soft = vec!["E041", "E032"];
    }
    for obj in info.forbidden_objects(Some(flavor)) {
        c.err("E020", format!("{obj} is not allowed"), obj.clone());
    }

    // E010 / E011
    let mut present: HashMap<&str, Vec<String>> = HashMap::new();
    for t in REQUIRED_TABLES {
        if !info.tables.contains_key(*t) {
            c.err("E010", format!("missing table `{t}`"), *t);
            continue;
        }
        let have: Vec<String> = doc
            .conn
            .prepare("SELECT name FROM pragma_table_info(?1)")
            .and_then(|mut st| {
                st.query_map([*t], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap_or_default();
        for col in required_columns(t) {
            if !have.iter().any(|h| h == col) {
                c.err(
                    "E011",
                    format!("missing column `{t}.{col}`"),
                    format!("{t}.{col}"),
                );
            }
        }
        present.insert(t, have);
    }
    let ok = |t: &str, cols: &[&str]| {
        present
            .get(t)
            .map(|have| cols.iter().all(|c| have.iter().any(|h| h == c)))
            .unwrap_or(false)
    };

    // E012
    let mut meta: HashMap<String, String> = HashMap::new();
    let mut profile: Vec<String> = Vec::new();
    if ok("spdf_meta", &["key", "value"]) {
        if let Ok(mut st) = doc.conn.prepare("SELECT key, value FROM spdf_meta") {
            if let Ok(rows) = st.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                ))
            }) {
                meta.extend(rows.flatten());
            }
        }
        for k in schema::REQUIRED_META {
            if !meta.contains_key(*k) {
                c.err("E012", format!("missing spdf_meta key `{k}`"), *k);
            }
        }
        profile = meta
            .get("profile")
            .map(|p| p.split_whitespace().map(str::to_string).collect())
            .unwrap_or_default();
    }

    // E013 / E050 / E051
    let mut docs: Vec<DocRow> = Vec::new();
    if ok("documents", &["id", "metadata"]) {
        let full = ok("documents", &["rights", "unit_count"]);
        let sql = if full {
            "SELECT id, metadata, rights, unit_count FROM documents"
        } else {
            "SELECT id, metadata, NULL, NULL FROM documents"
        };
        if let Ok(mut st) = doc.conn.prepare(sql) {
            if let Ok(rows) = st.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(1).ok().flatten(),
                    r.get::<_, Option<String>>(2).ok().flatten(),
                    r.get::<_, Option<i64>>(3).ok().flatten(),
                ))
            }) {
                docs.extend(rows.flatten());
            }
        }
        if docs.len() != 1 {
            c.err(
                "E013",
                format!("documents has {} rows, expected 1", docs.len()),
                "documents",
            );
        }
        for (id, md, rights, _) in &docs {
            match md.as_deref().map(serde_json::from_str::<Value>) {
                Some(Ok(Value::Object(m))) => {
                    let good = m.get("type").map(Value::is_string).unwrap_or(false)
                        && m.get("title").map(Value::is_string).unwrap_or(false);
                    if !good {
                        c.err(
                            "E051",
                            "metadata needs a string `type` and `title`",
                            id.clone(),
                        );
                    }
                }
                Some(Ok(_)) => c.err(
                    "E051",
                    "metadata needs a string `type` and `title`",
                    id.clone(),
                ),
                _ => c.err("E050", "metadata is not valid JSON", id.clone()),
            }
            if let Some(r) = rights {
                if !json_ok(r) {
                    c.err("E050", "rights is not valid JSON", id.clone());
                }
            }
        }
    }

    // E060
    if ok("extensions", &["name", "required"]) {
        for e in doc.extensions().unwrap_or_default() {
            if e.required {
                c.err(
                    "E060",
                    format!("unknown required extension `{}`", e.name),
                    e.name.clone(),
                );
            }
        }
    }

    // E090, W102, anchors
    let mut texts: HashMap<String, String> = HashMap::new();
    if ok("units", &["id", "ord", "anchor", "text"]) {
        let mut rows: Vec<(String, i64, Option<String>, String)> = Vec::new();
        if let Ok(mut st) = doc
            .conn
            .prepare("SELECT id, ord, anchor, text FROM units ORDER BY ord, id")
        {
            if let Ok(it) = st.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    r.get::<_, Option<i64>>(1)
                        .ok()
                        .flatten()
                        .unwrap_or(i64::MIN),
                    r.get::<_, Option<String>>(2).ok().flatten(),
                    r.get::<_, Option<String>>(3)
                        .ok()
                        .flatten()
                        .unwrap_or_default(),
                ))
            }) {
                rows.extend(it.flatten());
            }
        }
        if rows.iter().enumerate().any(|(i, r)| r.1 != i as i64 + 1) {
            c.err("E090", "units.ord is not 1..N", "units");
        }
        if docs.len() == 1 {
            if let Some(n) = docs[0].3 {
                if n != rows.len() as i64 {
                    c.warn(
                        "W102",
                        format!("unit_count {n} but {} units", rows.len()),
                        "documents.unit_count",
                    );
                }
            }
        }
        for (id, _, anchor, text) in rows {
            check_anchor_text(
                &mut c,
                anchor.as_deref(),
                Some(&text),
                &format!("units/{id}"),
            );
            texts.insert(id, text);
        }
    }
    if ok("fragments", &["id", "unit", "anchor"]) {
        let has_end = ok("fragments", &["anchor_end"]);
        let sql = format!(
            "SELECT id, unit, anchor, {} FROM fragments ORDER BY n",
            if has_end { "anchor_end" } else { "NULL" }
        );
        if let Ok(mut st) = doc.conn.prepare(&sql) {
            if let Ok(it) = st.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(2).ok().flatten(),
                    r.get::<_, Option<String>>(3).ok().flatten(),
                ))
            }) {
                for (id, unit, anchor, end) in it.flatten() {
                    let text = texts.get(&unit).map(String::as_str);
                    check_anchor_text(&mut c, anchor.as_deref(), text, &format!("fragments/{id}"));
                    if let Some(e) = end {
                        check_anchor_text(
                            &mut c,
                            Some(&e),
                            None,
                            &format!("fragments/{id}/anchor_end"),
                        );
                    }
                }
            }
        }
    }
    if ok("figures", &["id", "unit", "anchor"]) {
        if let Ok(mut st) = doc
            .conn
            .prepare("SELECT id, unit, anchor FROM figures ORDER BY id")
        {
            if let Ok(it) = st.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(2).ok().flatten(),
                ))
            }) {
                for (id, unit, anchor) in it.flatten() {
                    let text = texts.get(&unit).map(String::as_str);
                    check_anchor_text(&mut c, anchor.as_deref(), text, &format!("figures/{id}"));
                }
            }
        }
    }

    // E032 / E031 / E030
    let mut spaces: HashMap<String, (i64, String)> = HashMap::new();
    if ok("spaces", &["id", "dims", "dtype"]) {
        if let Ok(mut st) = doc
            .conn
            .prepare("SELECT id, dims, dtype FROM spaces ORDER BY id")
        {
            if let Ok(it) = st.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    r.get::<_, Option<i64>>(1).ok().flatten().unwrap_or(0),
                    r.get::<_, Option<String>>(2)
                        .ok()
                        .flatten()
                        .unwrap_or_default(),
                ))
            }) {
                for (id, dims, dtype) in it.flatten() {
                    if Dtype::parse(&dtype).is_none() {
                        c.err("E032", format!("unknown dtype `{dtype}`"), id.clone());
                    }
                    spaces.insert(id, (dims, dtype));
                }
            }
        }
    }
    let mut nvec = 0usize;
    if ok("vectors", &["target", "id", "space", "data"]) {
        let sql = "SELECT target, id, space, typeof(data), length(data) FROM vectors ORDER BY space, target, id";
        if let Ok(mut st) = doc.conn.prepare(sql) {
            if let Ok(it) = st.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                ))
            }) {
                for (target, id, space, ty, len) in it.flatten() {
                    nvec += 1;
                    let at = format!("vectors/{space}/{target}/{id}");
                    let Some((dims, dtype)) = spaces.get(&space) else {
                        c.err("E031", format!("unknown space `{space}`"), at);
                        continue;
                    };
                    let Some(dt) = Dtype::parse(dtype) else {
                        continue;
                    };
                    if ty != "blob" || len != dims * dt.size() as i64 {
                        c.err(
                            "E030",
                            format!("vector length {len} != {dims} x {}", dt.size()),
                            at,
                        );
                    }
                }
            }
        }
    }

    // E070
    if info.tables.contains_key("fragments_fts") {
        let mut tables = vec!["fragments_fts"];
        if info.tables.contains_key("fragments_fts_trigram") {
            tables.push("fragments_fts_trigram");
        }
        if let Err(msg) = fts_integrity(&doc, &tables) {
            c.err(
                "E070",
                format!("FTS index out of sync: {msg}"),
                "fragments_fts",
            );
        }
    }

    // E080
    if ok("blobs", &["key", "sha256", "data"]) {
        let stored: HashMap<String, String> = doc
            .blobs()
            .unwrap_or_default()
            .into_iter()
            .map(|b| (b.key, b.sha256))
            .collect();
        for (key, _, _, computed) in doc.computed_blob_hashes().unwrap_or_default() {
            if stored.get(&key) != Some(&computed) {
                c.err("E080", "blob sha256 mismatch", key);
            }
        }
    }

    // E081 / E082 (only on an otherwise valid file)
    if let Some(stored) = meta.get("content_sha256") {
        if c.errors.is_empty() {
            let actual = doc
                .dump()
                .map(|d| content_sha256_of_dump(&d))
                .unwrap_or_else(|e| format!("unavailable ({e})"));
            if &actual != stored {
                c.err(
                    "E081",
                    "content_sha256 does not match the canonical dump",
                    "spdf_meta.content_sha256",
                );
            } else if let Some(sig) = meta.get("signature") {
                let signer = meta.get("signer").map(String::as_str).unwrap_or("");
                if verify_signature(stored, sig, signer).is_err() {
                    c.err("E082", "signature does not verify", "spdf_meta.signature");
                }
            }
        }
    }

    // Warnings
    if profile.iter().any(|p| p == "semantic") && nvec == 0 {
        c.warn(
            "W100",
            "profile `semantic` without vectors",
            "spdf_meta.profile",
        );
    }
    if profile.iter().any(|p| p == "media") && ok("units", &["anchor"]) {
        let mut has_time = false;
        if let Ok(mut st) = doc.conn.prepare("SELECT anchor FROM units") {
            if let Ok(it) = st.query_map([], |r| r.get::<_, Option<String>>(0)) {
                has_time = it.flatten().flatten().any(|a| {
                    serde_json::from_str::<Value>(&a)
                        .ok()
                        .and_then(|v| v.get("type").and_then(Value::as_str).map(|t| t == "time"))
                        .unwrap_or(false)
                });
            }
        }
        if !has_time {
            c.warn(
                "W101",
                "profile `media` without time anchors",
                "spdf_meta.profile",
            );
        }
    }
    finish(c, version, profile)
}

fn check_anchor_text(c: &mut Collector, raw: Option<&str>, unit_text: Option<&str>, at: &str) {
    let v = match raw.map(serde_json::from_str::<Value>) {
        Some(Ok(v)) => v,
        _ => {
            c.err("E040", "anchor is not valid JSON", at);
            return;
        }
    };
    let len = unit_text.map(|t| text::cp_len(&text::nfc(t)));
    if let Some((code, msg)) = check_anchor_value(&v, len) {
        c.err(code, msg, at);
    }
}

fn fts_integrity(doc: &Spdf, tables: &[&str]) -> std::result::Result<(), String> {
    let data = doc
        .conn
        .serialize(rusqlite::MAIN_DB)
        .map_err(|e| e.to_string())?;
    let mut copy = Connection::open_in_memory().map_err(|e| e.to_string())?;
    let len = data.len();
    copy.deserialize_read_exact(rusqlite::MAIN_DB, &data[..], len, false)
        .map_err(|e| e.to_string())?;
    drop(data);
    use rusqlite::config::DbConfig;
    for (cfg, on) in [
        (DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true),
        (DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false),
        (DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER, false),
    ] {
        copy.set_db_config(cfg, on).map_err(|e| e.to_string())?;
    }
    for fts in tables {
        copy.execute(
            &format!("INSERT INTO \"{fts}\"(\"{fts}\", rank) VALUES('integrity-check', 1)"),
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A JSON number with an integral value (`10` and `10.0` are the same value).
fn is_int(v: Option<&Value>) -> bool {
    v.and_then(Value::as_f64)
        .map(|f| f.is_finite() && f.fract() == 0.0)
        .unwrap_or(false)
}

fn is_num(v: Option<&Value>) -> bool {
    v.map(Value::is_number).unwrap_or(false)
}

fn is_str(v: Option<&Value>) -> bool {
    v.map(Value::is_string).unwrap_or(false)
}

fn num(v: Option<&Value>) -> f64 {
    v.and_then(Value::as_f64).unwrap_or(f64::NAN)
}

/// Strict anchor check (§3 required members, `region`, `chars`). `unit_len`
/// is the length in code points of the NFC text of the anchor's unit, when
/// known. Returns `(code, message)` for the first problem.
pub fn check_anchor_value(v: &Value, unit_len: Option<usize>) -> Option<(&'static str, String)> {
    let Value::Object(m) = v else {
        return Some(("E040", "anchor is not an object".into()));
    };
    let Some(t) = m.get("type").and_then(Value::as_str) else {
        return Some(("E040", "anchor without type".into()));
    };
    if !ANCHOR_TYPES.contains(&t) {
        return Some(("E041", format!("unknown anchor type `{t}`")));
    }
    let good = match t {
        "page" => {
            is_int(m.get("physical"))
                && num(m.get("physical")) >= 1.0
                && matches!(m.get("printed"), Some(Value::Null) | Some(Value::String(_)))
        }
        "time" => {
            is_num(m.get("t0"))
                && is_num(m.get("t1"))
                && 0.0 <= num(m.get("t0"))
                && num(m.get("t0")) <= num(m.get("t1"))
        }
        "section" => m
            .get("path")
            .and_then(Value::as_array)
            .map(|a| a.iter().all(Value::is_string))
            .unwrap_or(false),
        "slide" => is_int(m.get("n")) && num(m.get("n")) >= 1.0,
        "sheet" => is_str(m.get("sheet")) && is_int(m.get("row_from")) && is_int(m.get("row_to")),
        "web" => is_str(m.get("url")),
        "verse" => is_int(m.get("line_from")),
        "canonical" => is_str(m.get("scheme")) && is_str(m.get("ref")),
        _ => true,
    };
    if !good {
        return Some((
            "E040",
            format!("{t} anchor misses or mistypes a required member"),
        ));
    }
    if let Some(r) = m.get("region") {
        let ok = r
            .as_object()
            .map(|o| ["x", "y", "w", "h"].iter().all(|k| is_num(o.get(*k))))
            .unwrap_or(false);
        if !ok {
            return Some(("E040", "bad region".into()));
        }
    }
    if let Some(ch) = m.get("chars") {
        let pair = ch
            .as_array()
            .filter(|a| a.len() == 2 && a.iter().all(|x| is_int(Some(x))))
            .map(|a| (num(a.first()), num(a.get(1))));
        let Some((s, e)) = pair else {
            return Some(("E040", "bad chars".into()));
        };
        if let Some(len) = unit_len {
            if !(0.0 <= s && s <= e && e <= len as f64) {
                return Some((
                    "E042",
                    format!("chars [{s},{e}] out of range (unit text has {len} code points)"),
                ));
            }
        }
    }
    None
}
