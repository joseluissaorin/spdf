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
}

impl Collector {
    fn push(&mut self, warning: bool, code: &str, message: impl Into<String>, at: impl Into<String>) {
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
        self.push(false, code, message, at);
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
    };
    match reader::open_connection(path, &opts) {
        Ok((conn, gzip, origin)) => validate_connection(conn, gzip, origin, c),
        Err(e) => {
            c.err(code_or(&e, "E001"), e.to_string(), path.display().to_string());
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

fn validate_connection(conn: Connection, gzip: bool, origin: Origin, mut c: Collector) -> ValidationReport {
    let info = match SchemaInfo::read(&conn) {
        Ok(i) => i,
        Err(e) => {
            c.err("E001", format!("cannot read the SQLite schema: {e}"), "sqlite_master");
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
    if gzip && flavor == Flavor::V5 {
        c.warn("E003", "SPDF 5.0 files must not be gzip-wrapped", "container");
    }
    let doc = match Spdf::assemble(conn, gzip, origin, info.clone(), flavor) {
        Ok(d) => d,
        Err(e) => {
            c.err("E001", e.to_string(), "sqlite");
            return finish(c, None, Vec::new());
        }
    };
    if let Err(e) = doc.check_version() {
        c.err("E002", e.to_string(), "header");
        return finish(c, Some(doc.version.clone()), Vec::new());
    }
    let version = Some(doc.version.clone());
    if flavor == Flavor::V5 && info.user_version > schema::USER_VERSION {
        c.warn(
            "W105",
            format!("newer minor version (user_version {})", info.user_version),
            "header",
        );
    }
    if flavor == Flavor::Legacy {
        c.warn("W110", format!("legacy SPDF {} file", doc.version), "header");
    }

    // E020
    for obj in info.forbidden_objects(Some(flavor)) {
        c.err("E020", format!("{obj} is not allowed"), obj.clone());
    }

    // E010 / E011
    let required_tables: Vec<&schema::TableDef> = schema::TABLES
        .iter()
        .copied()
        .filter(|t| flavor == Flavor::V5 || !t.legacy.is_empty())
        .collect();
    for t in &required_tables {
        let name = if flavor == Flavor::V5 { t.name } else { t.legacy };
        if !info.tables.contains_key(name) {
            c.err("E010", format!("missing table `{name}`"), name);
        }
    }
    let fts_name = doc.fts_table();
    if !info.tables.contains_key(fts_name) {
        c.err("E010", format!("missing table `{fts_name}`"), fts_name);
    }
    for t in &required_tables {
        let Some(res) = doc.resolved.get(t.name) else {
            continue;
        };
        for (col5, col4) in t.columns {
            let actual = if flavor == Flavor::V5 { *col5 } else { *col4 };
            if actual.is_empty() {
                continue;
            }
            // 4.0 lacks the 4.1 additions.
            if flavor == Flavor::Legacy
                && doc.version == "4.0"
                && matches!(actual, "palabras" | "texto_busqueda")
            {
                continue;
            }
            if !res.columns.contains(actual) {
                c.err(
                    "E011",
                    format!("missing column `{}.{actual}`", res.table),
                    format!("{}.{actual}", res.table),
                );
            }
        }
    }
    if flavor == Flavor::V5 && info.tables.contains_key("fragments_fts") {
        let cols: Vec<String> = doc
            .conn
            .prepare("SELECT name FROM pragma_table_info('fragments_fts')")
            .and_then(|mut st| {
                st.query_map([], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap_or_default();
        for col in ["text", "context", "section", "search_text"] {
            if !cols.iter().any(|x| x == col) {
                c.err(
                    "E011",
                    format!("missing column `fragments_fts.{col}`"),
                    format!("fragments_fts.{col}"),
                );
            }
        }
    }

    // E012
    let meta = doc.meta().unwrap_or_default();
    if flavor == Flavor::V5 {
        for k in schema::REQUIRED_META {
            if !meta.contains_key(*k) {
                c.err("E012", format!("missing spdf_meta key `{k}`"), format!("spdf_meta.{k}"));
            }
        }
    }
    let profile: Vec<String> = meta
        .get("profile")
        .map(|p| p.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default();

    // E013
    let doc_rows = doc
        .table_name("documents")
        .and_then(|t| {
            doc.conn
                .query_row(&format!("SELECT count(*) FROM \"{t}\""), [], |r| r.get::<_, i64>(0))
                .ok()
        })
        .unwrap_or(0);
    if doc.has_table("documents") && doc_rows != 1 {
        c.err("E013", format!("documents has {doc_rows} rows, expected 1"), "documents");
    }

    // E050 / E051
    let doc_row = doc.document_row().ok().flatten();
    if let Some(row) = &doc_row {
        match row.get("metadata") {
            Some(Value::Object(m)) => {
                let has_type = m.get("type").map(Value::is_string).unwrap_or(false);
                let has_title = m.get("title").map(Value::is_string).unwrap_or(false);
                if !has_type || !has_title {
                    c.err("E051", "metadata needs string `type` and `title`", "documents.metadata");
                }
            }
            _ => c.err("E050", "metadata is not a JSON object", "documents.metadata"),
        }
        match row.get("rights") {
            None | Some(Value::Null) | Some(Value::Object(_)) => {}
            Some(_) => c.err("E050", "rights is not a JSON object", "documents.rights"),
        }
    }

    // E060
    if flavor == Flavor::V5 {
        for e in doc.extensions().unwrap_or_default() {
            if e.required {
                c.err(
                    "E060",
                    format!("unknown required extension `{}`", e.name),
                    format!("extensions.{}", e.name),
                );
            }
        }
    }

    // E090
    let units = doc.units().unwrap_or_default();
    if doc.has_table("units") {
        let mut ords: Vec<i64> = units.iter().map(|u| u.ord).collect();
        ords.sort_unstable();
        if ords.iter().enumerate().any(|(i, o)| *o != i as i64 + 1) {
            c.err("E090", "units.ord is not contiguous from 1", "units.ord");
        }
    }

    // E040 / E041 / E042
    let unit_len: HashMap<String, usize> = units
        .iter()
        .map(|u| (u.id.clone(), text::cp_len(&text::nfc(&u.text))))
        .collect();
    let mut physical_unit: HashMap<i64, String> = HashMap::new();
    for u in &units {
        if let Some(p) = u.anchor.get("physical").and_then(Value::as_i64) {
            physical_unit.entry(p).or_insert_with(|| u.id.clone());
        }
    }
    for u in &units {
        check_anchor(&mut c, &u.anchor, &format!("units[{}].anchor", u.id), unit_len.get(&u.id).copied());
    }
    if let Some(t) = doc.table_name("fragments") {
        let _ = t;
        let cols: Vec<&str> = schema::FRAGMENTS.columns.iter().map(|c| c.0).collect();
        for f in doc.rows(&schema::FRAGMENTS, &cols, None, "n").unwrap_or_default() {
            let id = f.get("id").and_then(Value::as_str).unwrap_or("?").to_string();
            let unit = f.get("unit").and_then(Value::as_str).unwrap_or("");
            let a = f.get("anchor").cloned().unwrap_or(Value::Null);
            check_anchor(&mut c, &a, &format!("fragments[{id}].anchor"), unit_len.get(unit).copied());
            match f.get("anchor_end") {
                None | Some(Value::Null) => {}
                Some(e) => {
                    let end_unit = e
                        .get("physical")
                        .and_then(Value::as_i64)
                        .and_then(|p| physical_unit.get(&p))
                        .and_then(|u| unit_len.get(u))
                        .copied();
                    check_anchor(&mut c, e, &format!("fragments[{id}].anchor_end"), end_unit);
                }
            }
        }
    }
    if doc.has_table("figures") {
        let cols: Vec<&str> = schema::FIGURES.columns.iter().map(|c| c.0).collect();
        for f in doc.rows(&schema::FIGURES, &cols, None, "id").unwrap_or_default() {
            let id = f.get("id").and_then(Value::as_str).unwrap_or("?").to_string();
            let unit = f.get("unit").and_then(Value::as_str).unwrap_or("");
            let a = f.get("anchor").cloned().unwrap_or(Value::Null);
            check_anchor(&mut c, &a, &format!("figures[{id}].anchor"), unit_len.get(unit).copied());
        }
    }

    // E031 / E032 / E030
    let spaces = doc.spaces().unwrap_or_default();
    let mut shapes: HashMap<String, Option<(Dtype, usize)>> = HashMap::new();
    for s in &spaces {
        match s.dtype() {
            Some(d) => {
                shapes.insert(s.id.clone(), Some((d, usize::try_from(s.dims).unwrap_or(0))));
            }
            None => {
                c.err("E032", format!("unknown dtype `{}`", s.dtype), format!("spaces[{}]", s.id));
                shapes.insert(s.id.clone(), None);
            }
        }
    }
    let mut vector_count = 0usize;
    if let Some(t) = doc.table_name("vectors") {
        let tc = doc.col_expr(&schema::VECTORS, "target");
        let ic = doc.col_expr(&schema::VECTORS, "id");
        let sc = doc.col_expr(&schema::VECTORS, "space");
        let dc = doc.col_expr(&schema::VECTORS, "data");
        let sql = format!("SELECT {tc}, {ic}, {sc}, length({dc}) FROM \"{t}\" ORDER BY {sc}, {tc}, {ic}");
        if let Ok(mut st) = doc.conn.prepare(&sql) {
            if let Ok(rows) = st.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                ))
            }) {
                for (target, id, space, len) in rows.flatten() {
                    vector_count += 1;
                    let at = format!("vectors[{target}/{id}/{space}]");
                    match shapes.get(&space) {
                        None => c.err("E031", format!("vector space `{space}` is not declared"), at),
                        Some(None) => {}
                        Some(Some((dt, dims))) => {
                            let want = (dims * dt.size()) as i64;
                            if len != want {
                                c.err("E030", format!("vector has {len} bytes, expected {want}"), at);
                            }
                        }
                    }
                }
            }
        }
    }

    // E070
    if info.tables.contains_key(fts_name) {
        if let Err(msg) = fts_integrity(&doc, fts_name) {
            c.err("E070", format!("FTS index out of sync: {msg}"), fts_name);
        }
    }

    // E080
    if flavor == Flavor::V5 {
        let stored: HashMap<String, String> = doc
            .blobs()
            .unwrap_or_default()
            .into_iter()
            .map(|b| (b.key, b.sha256.to_ascii_lowercase()))
            .collect();
        for (key, _, _, computed) in doc.computed_blob_hashes().unwrap_or_default() {
            if stored.get(&key).map(String::as_str) != Some(computed.as_str()) {
                c.err("E080", "blob sha256 does not match its data", format!("blobs[{key}]"));
            }
        }
    }

    // E081 / E082
    if flavor == Flavor::V5 && (meta.contains_key("content_sha256") || meta.contains_key("signature")) {
        match doc.dump() {
            Ok(d) => {
                let h = content_sha256_of_dump(&d);
                if let Some(stored) = meta.get("content_sha256") {
                    if stored.to_ascii_lowercase() != h {
                        c.err("E081", "content_sha256 does not match the content", "spdf_meta.content_sha256");
                    }
                }
                if let Some(sig) = meta.get("signature") {
                    let ok = match meta.get("signer") {
                        Some(s) => verify_signature(&h, sig, s).is_ok(),
                        None => false,
                    };
                    if !ok {
                        c.err("E082", "signature does not verify", "spdf_meta.signature");
                    }
                }
            }
            Err(e) => c.err("E081", format!("cannot compute content_sha256: {e}"), "spdf_meta"),
        }
    }

    // Warnings
    if profile.iter().any(|p| p == "semantic") && vector_count == 0 {
        c.warn("W100", "profile `semantic` without vectors", "spdf_meta.profile");
    }
    if profile.iter().any(|p| p == "media")
        && !units
            .iter()
            .any(|u| u.anchor.get("type").and_then(Value::as_str) == Some("time"))
    {
        c.warn("W101", "profile `media` without time anchors", "spdf_meta.profile");
    }
    if let Some(row) = &doc_row {
        if let Some(n) = row.get("unit_count").and_then(Value::as_i64) {
            if doc.has_table("units") && n != units.len() as i64 {
                c.warn(
                    "W102",
                    format!("unit_count is {n} but there are {} units", units.len()),
                    "documents.unit_count",
                );
            }
        }
    }
    finish(c, version, profile)
}

fn fts_integrity(doc: &Spdf, fts: &str) -> std::result::Result<(), String> {
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
    copy.execute(
        &format!("INSERT INTO \"{fts}\"(\"{fts}\", rank) VALUES('integrity-check', 1)"),
        [],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn is_int(v: Option<&Value>) -> bool {
    v.and_then(Value::as_f64).map(|f| f.fract() == 0.0).unwrap_or(false)
}

fn is_num(v: Option<&Value>) -> bool {
    v.map(Value::is_number).unwrap_or(false)
}

fn is_str(v: Option<&Value>) -> bool {
    v.map(Value::is_string).unwrap_or(false)
}

/// Strict anchor check (§3 required members). Returns `(code, message)`.
pub fn check_anchor_value(v: &Value, unit_len: Option<usize>) -> Option<(&'static str, String)> {
    let m = match v {
        Value::Object(m) => m,
        Value::String(_) => return Some(("E040", "anchor is not valid JSON".into())),
        _ => return Some(("E040", "anchor is not a JSON object".into())),
    };
    let Some(t) = m.get("type").and_then(Value::as_str) else {
        return Some(("E040", "anchor has no string `type`".into()));
    };
    if !ANCHOR_TYPES.contains(&t) {
        return Some(("E041", format!("unknown anchor type `{t}`")));
    }
    let bad = |msg: &str| Some(("E040", format!("`{t}` anchor: {msg}")));
    match t {
        "page" => {
            let ok = is_int(m.get("physical")) && m.get("physical").and_then(Value::as_f64).unwrap_or(0.0) >= 1.0;
            if !ok {
                return bad("`physical` must be an integer >= 1");
            }
            match m.get("printed") {
                Some(Value::String(_)) | Some(Value::Null) => {}
                _ => return bad("`printed` must be a string or null"),
            }
        }
        "time" => {
            if !is_num(m.get("t0")) || !is_num(m.get("t1")) {
                return bad("`t0` and `t1` must be numbers");
            }
        }
        "section" => {
            let ok = m
                .get("path")
                .and_then(Value::as_array)
                .map(|a| a.iter().all(Value::is_string))
                .unwrap_or(false);
            if !ok {
                return bad("`path` must be an array of strings");
            }
        }
        "slide" => {
            if !is_int(m.get("n")) {
                return bad("`n` must be an integer");
            }
        }
        "sheet" => {
            if !is_str(m.get("sheet")) || !is_int(m.get("row_from")) || !is_int(m.get("row_to")) {
                return bad("`sheet`, `row_from` and `row_to` are required");
            }
        }
        "web" => {
            if !is_str(m.get("url")) {
                return bad("`url` must be a string");
            }
        }
        "verse" => {
            if !is_int(m.get("line_from")) {
                return bad("`line_from` must be an integer");
            }
        }
        "canonical" => {
            if !is_str(m.get("scheme")) || !is_str(m.get("ref")) {
                return bad("`scheme` and `ref` must be strings");
            }
        }
        _ => {}
    }
    if let Some(r) = m.get("region") {
        let ok = r
            .as_object()
            .map(|o| ["x", "y", "w", "h"].iter().all(|k| is_num(o.get(*k))))
            .unwrap_or(false);
        if !ok {
            return bad("`region` must be {x,y,w,h}");
        }
    }
    if let Some(ch) = m.get("chars") {
        let pair = ch.as_array().filter(|a| a.len() == 2).and_then(|a| {
            Some((a[0].as_u64()?, a[1].as_u64()?))
        });
        match pair {
            None => return bad("`chars` must be [start, end]"),
            Some((s, e)) => {
                if s > e {
                    return Some(("E042", format!("chars [{s},{e}] start > end")));
                }
                if let Some(len) = unit_len {
                    if e as usize > len {
                        return Some(("E042", format!("chars [{s},{e}] beyond unit text ({len} code points)")));
                    }
                }
            }
        }
    }
    None
}

fn check_anchor(c: &mut Collector, v: &Value, at: &str, unit_len: Option<usize>) {
    if let Some((code, msg)) = check_anchor_value(v, unit_len) {
        c.err(code, msg, at);
    }
}
