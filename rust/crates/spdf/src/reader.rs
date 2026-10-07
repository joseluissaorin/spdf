//! Safe opening and reading (contract §1, §7).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rusqlite::config::DbConfig;
use rusqlite::limits::Limit;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::legacy;
use crate::model::*;
use crate::schema::{self, TableDef};

/// SQLite file header.
pub const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
/// Default maximum blob/string size (512 MiB).
pub const DEFAULT_MAX_BLOB: usize = 512 * 1024 * 1024;
/// Default maximum decompressed size for gzip input (4 GiB).
pub const DEFAULT_MAX_DECOMPRESSED: u64 = 4 * 1024 * 1024 * 1024;

/// Options for [`Spdf::open_with`].
#[derive(Clone, Debug)]
pub struct OpenOptions {
    /// Maximum size of any blob or string read from the file.
    pub max_blob_bytes: usize,
    /// Maximum size of a gzip-wrapped file once decompressed.
    pub max_decompressed_bytes: u64,
    /// Required extensions this reader understands (others → E060).
    pub known_extensions: Vec<String>,
    /// Open even if the file declares unknown required extensions (used by
    /// validators and dump tools; never by end-user readers).
    pub ignore_required_extensions: bool,
}

impl Default for OpenOptions {
    fn default() -> Self {
        OpenOptions {
            max_blob_bytes: DEFAULT_MAX_BLOB,
            max_decompressed_bytes: DEFAULT_MAX_DECOMPRESSED,
            known_extensions: Vec::new(),
            ignore_required_extensions: false,
        }
    }
}

/// Which schema the file uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Flavor {
    /// SPDF 5.x (English identifiers).
    V5,
    /// Legacy SPDF 4.0/4.1 (Spanish identifiers), read through the 5.0 view.
    Legacy,
}

/// Raw facts about the SQLite schema, gathered before any check.
#[derive(Clone, Debug, Default)]
pub(crate) struct SchemaInfo {
    pub tables: BTreeMap<String, String>,
    pub triggers: Vec<(String, String)>,
    pub views: Vec<String>,
    pub application_id: i64,
    pub user_version: i64,
}

impl SchemaInfo {
    pub fn read(conn: &Connection) -> Result<Self> {
        let mut info = SchemaInfo::default();
        let mut st = conn.prepare("SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master")?;
        let mut rows = st.query([])?;
        while let Some(r) = rows.next()? {
            let t: String = r.get(0)?;
            let name: String = r.get(1)?;
            let tbl: String = r.get(2)?;
            let sql: String = r.get(3)?;
            match t.as_str() {
                "table" => {
                    info.tables.insert(name, sql);
                }
                "trigger" => info.triggers.push((name, tbl)),
                "view" => info.views.push(name),
                _ => {}
            }
        }
        info.application_id = conn.pragma_query_value(None, "application_id", |r| r.get(0))?;
        info.user_version = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        Ok(info)
    }

    pub fn flavor(&self) -> Option<Flavor> {
        if self.tables.contains_key("spdf_meta") || self.application_id == schema::APPLICATION_ID {
            Some(Flavor::V5)
        } else if self.tables.contains_key("spdf") && self.tables.contains_key("documentos") {
            Some(Flavor::Legacy)
        } else {
            None
        }
    }

    /// Triggers and views that are not tolerated (legacy FTS sync triggers are).
    pub fn forbidden_objects(&self, flavor: Option<Flavor>) -> Vec<String> {
        let mut out = Vec::new();
        for (name, tbl) in &self.triggers {
            let tolerated = flavor == Some(Flavor::Legacy)
                && tbl == "fragmentos"
                && matches!(name.as_str(), "fragmentos_ai" | "fragmentos_ad" | "fragmentos_au");
            if !tolerated {
                out.push(format!("trigger {name}"));
            }
        }
        for v in &self.views {
            out.push(format!("view {v}"));
        }
        out
    }

    /// Tokenizer declared by the FTS table's `CREATE` statement.
    pub fn fts_tokenizer(&self, table: &str) -> Option<String> {
        let sql = self.tables.get(table)?;
        let i = sql.find("tokenize")?;
        let rest = &sql[i + "tokenize".len()..];
        let rest = rest.trim_start().strip_prefix('=')?.trim_start();
        let quote = rest.chars().next()?;
        if quote != '\'' && quote != '"' {
            return None;
        }
        let body = &rest[1..];
        let end = body.find(quote)?;
        Some(body[..end].to_string())
    }
}

/// Where a database comes from (for error messages and integrity tools).
#[derive(Clone, Debug)]
pub(crate) enum Origin {
    Path(PathBuf),
    Memory,
    #[cfg(feature = "http")]
    Remote(String),
}

/// Opens a connection read-only and hardened. Shared by [`Spdf`] and the
/// validator. Returns the connection and whether the input was gzip.
pub(crate) fn open_connection(path: &Path, opts: &OpenOptions) -> Result<(Connection, bool, Origin)> {
    let mut f = File::open(path)?;
    let mut head = [0u8; 100];
    let n = read_up_to(&mut f, &mut head)?;
    if n >= 2 && head[0] == 0x1f && head[1] == 0x8b {
        f.seek(SeekFrom::Start(0))?;
        let bytes = gunzip_bounded(f, opts.max_decompressed_bytes)?;
        let conn = connection_from_bytes(bytes, opts)?;
        return Ok((conn, true, Origin::Path(path.to_path_buf())));
    }
    if n < 100 || &head[..16] != SQLITE_MAGIC {
        return Err(Error::NotSqlite(format!(
            "{} does not start with the SQLite header",
            path.display()
        )));
    }
    let wal = head[18] == 2 || head[19] == 2;
    let conn = if wal {
        // A WAL-mode file cannot always be opened read-only in place: read
        // it into memory and open it as a rollback-journal database.
        drop(f);
        let bytes = std::fs::read(path)?;
        connection_from_bytes(bytes, opts)?
    } else {
        let c = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        harden(&c, opts)?;
        c
    };
    Ok((conn, false, Origin::Path(path.to_path_buf())))
}

fn read_up_to(r: &mut impl Read, buf: &mut [u8]) -> Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        let k = r.read(&mut buf[n..])?;
        if k == 0 {
            break;
        }
        n += k;
    }
    Ok(n)
}

/// Decompresses gzip input, refusing to produce more than `max` bytes.
pub(crate) fn gunzip_bounded(r: impl Read, max: u64) -> Result<Vec<u8>> {
    let dec = flate2::read::MultiGzDecoder::new(r);
    let mut out = Vec::new();
    let mut limited = dec.take(max.saturating_add(1));
    limited.read_to_end(&mut out)?;
    if out.len() as u64 > max {
        return Err(Error::TooLarge(format!(
            "gzip input expands beyond {max} bytes"
        )));
    }
    Ok(out)
}

/// Builds a hardened read-only in-memory connection from SQLite bytes
/// (gzip is detected and decompressed).
pub(crate) fn connection_from_bytes(mut bytes: Vec<u8>, opts: &OpenOptions) -> Result<Connection> {
    if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        bytes = gunzip_bounded(&bytes[..], opts.max_decompressed_bytes)?;
    }
    if bytes.len() < 100 || &bytes[..16] != SQLITE_MAGIC {
        return Err(Error::NotSqlite("data does not start with the SQLite header".into()));
    }
    if bytes[18] == 2 || bytes[19] == 2 {
        bytes[18] = 1;
        bytes[19] = 1;
    }
    let mut conn = Connection::open_in_memory_with_flags(
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let len = bytes.len();
    conn.deserialize_read_exact(rusqlite::MAIN_DB, &bytes[..], len, true)?;
    drop(bytes);
    harden(&conn, opts)?;
    Ok(conn)
}

/// Applies the safe-opening settings of §1 to a connection.
pub(crate) fn harden(conn: &Connection, opts: &OpenOptions) -> Result<()> {
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER, false)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_VIEW, false)?;
    // Never load extensions (rusqlite does not enable it either; be explicit).
    // SAFETY: valid open handle; the variadic call takes (int, int*) for this op.
    unsafe {
        rusqlite::ffi::sqlite3_db_config(
            conn.handle(),
            rusqlite::ffi::SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION,
            0 as std::os::raw::c_int,
            std::ptr::null_mut::<std::os::raw::c_int>(),
        );
    }
    let max = i32::try_from(opts.max_blob_bytes).unwrap_or(i32::MAX);
    conn.set_limit(Limit::SQLITE_LIMIT_LENGTH, max)?;
    conn.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0)?;
    conn.pragma_update(None, "trusted_schema", "OFF")?;
    conn.pragma_update(None, "query_only", 1)?;
    Ok(())
}

/// Converts one SQLite value to JSON.
pub(crate) fn sql_to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => {
            use base64::Engine;
            Value::String(base64::engine::general_purpose::STANDARD.encode(b))
        }
    }
}

/// Parses a JSON-in-TEXT value; text that is not JSON stays a string.
pub(crate) fn parse_json_column(v: Value) -> Value {
    match v {
        Value::String(s) => serde_json::from_str(&s).unwrap_or(Value::String(s)),
        other => other,
    }
}

/// Actual table and columns present in the file for a logical table.
#[derive(Clone, Debug)]
pub(crate) struct Resolved {
    pub table: String,
    pub columns: HashSet<String>,
}

/// An open SPDF file (5.0, or legacy 4.x through the 5.0 view).
///
/// ```no_run
/// let doc = spdf::Spdf::open("book.spdf")?;
/// println!("{} ({})", doc.document()?.title.unwrap_or_default(), doc.version());
/// for hit in doc.search_lexical("panóptico", 5)? {
///     println!("{:.3} {}", hit.score, hit.anchor_uri);
/// }
/// # Ok::<(), spdf::Error>(())
/// ```
pub struct Spdf {
    pub(crate) conn: Connection,
    pub(crate) flavor: Flavor,
    pub(crate) version: String,
    pub(crate) gzip: bool,
    pub(crate) info: SchemaInfo,
    pub(crate) resolved: HashMap<&'static str, Resolved>,
    pub(crate) origin: Origin,
    blob_keys: OnceLock<HashSet<String>>,
}

impl std::fmt::Debug for Spdf {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Spdf")
            .field("version", &self.version)
            .field("flavor", &self.flavor)
            .field("gzip", &self.gzip)
            .finish()
    }
}

impl Spdf {
    /// Opens a file with default [`OpenOptions`].
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_with(path, &OpenOptions::default())
    }

    /// Opens a file safely (read-only, defensive, no triggers or views). Gzip
    /// input (legacy 4.x) is decompressed in memory.
    pub fn open_with(path: impl AsRef<Path>, opts: &OpenOptions) -> Result<Self> {
        let (conn, gzip, origin) = open_connection(path.as_ref(), opts)?;
        Self::from_connection(conn, gzip, origin, opts)
    }

    /// Opens an SPDF held in memory (SQLite or gzip-wrapped SQLite).
    pub fn from_bytes(bytes: &[u8], opts: &OpenOptions) -> Result<Self> {
        let gzip = bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b;
        let conn = connection_from_bytes(bytes.to_vec(), opts)?;
        Self::from_connection(conn, gzip, Origin::Memory, opts)
    }

    pub(crate) fn from_connection(conn: Connection, gzip: bool, origin: Origin, opts: &OpenOptions) -> Result<Self> {
        let info = SchemaInfo::read(&conn).map_err(|e| match e {
            Error::Sqlite(e) => Error::NotSqlite(e.to_string()),
            other => other,
        })?;
        let flavor = match info.flavor() {
            Some(f) => f,
            None if info.tables.contains_key("metadata") && info.tables.contains_key("chunks") => {
                return Err(Error::UnsupportedVersion(
                    "legacy SPDF 1-3 (Scholaris v1) is not supported; import it with Scholaris first".into(),
                ))
            }
            None => return Err(Error::UnsupportedVersion("SQLite database without the SPDF schema".into())),
        };
        let bad = info.forbidden_objects(Some(flavor));
        if !bad.is_empty() {
            return Err(Error::UnsafeSchema(bad.join(", ")));
        }
        let doc = Self::assemble(conn, gzip, origin, info, flavor)?;
        doc.check_version()?;
        if flavor == Flavor::V5 && !opts.ignore_required_extensions {
            for ext in doc.extensions().unwrap_or_default() {
                if ext.required && !opts.known_extensions.iter().any(|k| k == &ext.name) {
                    return Err(Error::UnknownRequiredExtension(ext.name));
                }
            }
        }
        Ok(doc)
    }

    /// Builds the reader without any safety or version check (the caller
    /// has already hardened the connection; used by the validator).
    pub(crate) fn assemble(conn: Connection, gzip: bool, origin: Origin, info: SchemaInfo, flavor: Flavor) -> Result<Self> {
        let mut doc = Spdf {
            conn,
            flavor,
            version: String::new(),
            gzip,
            info,
            resolved: HashMap::new(),
            origin,
            blob_keys: OnceLock::new(),
        };
        doc.resolve_tables()?;
        doc.version = doc.best_effort_version();
        Ok(doc)
    }

    fn resolve_tables(&mut self) -> Result<()> {
        for t in schema::TABLES {
            let actual = match self.flavor {
                Flavor::V5 => t.name,
                Flavor::Legacy => t.legacy,
            };
            if actual.is_empty() || !self.info.tables.contains_key(actual) {
                continue;
            }
            let mut st = self
                .conn
                .prepare("SELECT name FROM pragma_table_info(?1)")?;
            let cols: HashSet<String> = st
                .query_map([actual], |r| r.get::<_, String>(0))?
                .collect::<std::result::Result<_, _>>()?;
            self.resolved.insert(
                t.name,
                Resolved {
                    table: actual.to_string(),
                    columns: cols,
                },
            );
        }
        Ok(())
    }

    fn best_effort_version(&self) -> String {
        let meta = self.meta().unwrap_or_default();
        let uv = self.info.user_version;
        match self.flavor {
            Flavor::V5 => meta
                .get("spdf_version")
                .cloned()
                .unwrap_or_else(|| format!("{}.{}", uv / 100, (uv % 100) / 10)),
            Flavor::Legacy => meta.get("spdf_version").cloned().unwrap_or_else(|| {
                match uv {
                    400 => "4.0".to_string(),
                    _ => "4.1".to_string(),
                }
            }),
        }
    }

    /// E002 checks: application_id and user_version (5.x), or a 4.x version row.
    pub(crate) fn check_version(&self) -> Result<()> {
        match self.flavor {
            Flavor::V5 => {
                if self.info.application_id != schema::APPLICATION_ID {
                    return Err(Error::UnsupportedVersion(format!(
                        "application_id {} is not SPDF ({})",
                        self.info.application_id,
                        schema::APPLICATION_ID
                    )));
                }
                let uv = self.info.user_version;
                if !(500..=599).contains(&uv) {
                    return Err(Error::UnsupportedVersion(format!("user_version {uv} is not 5.x")));
                }
                Ok(())
            }
            Flavor::Legacy => {
                if !self.version.starts_with("4.") {
                    return Err(Error::UnsupportedVersion(format!(
                        "legacy version {} is not 4.x",
                        self.version
                    )));
                }
                Ok(())
            }
        }
    }

    /// Format version: `"5.0"`, or `"4.0"`/`"4.1"` for legacy files.
    pub fn version(&self) -> &str {
        &self.version
    }

    /// Schema flavor.
    pub fn flavor(&self) -> Flavor {
        self.flavor
    }

    /// True for legacy 4.x files.
    pub fn is_legacy(&self) -> bool {
        self.flavor == Flavor::Legacy
    }

    /// Path of the file, if it was opened from disk.
    pub fn path(&self) -> Option<&Path> {
        match &self.origin {
            Origin::Path(p) => Some(p.as_path()),
            _ => None,
        }
    }

    /// True if the input was gzip-wrapped.
    pub fn was_gzip(&self) -> bool {
        self.gzip
    }

    /// The underlying read-only connection (for advanced queries; it is
    /// `query_only`).
    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    pub(crate) fn has_table(&self, logical: &str) -> bool {
        self.resolved.contains_key(logical)
    }

    pub(crate) fn table_name(&self, logical: &str) -> Option<&str> {
        self.resolved.get(logical).map(|r| r.table.as_str())
    }

    /// SQL expression selecting logical column `col` of `t`, or `NULL`.
    pub(crate) fn col_expr(&self, t: &TableDef, col: &str) -> String {
        let Some(r) = self.resolved.get(t.name) else {
            return "NULL".into();
        };
        let actual = match self.flavor {
            Flavor::V5 => col,
            Flavor::Legacy => t
                .columns
                .iter()
                .find(|(c, _)| *c == col)
                .map(|(_, l)| *l)
                .unwrap_or(""),
        };
        if !actual.is_empty() && r.columns.contains(actual) {
            format!("\"{actual}\"")
        } else {
            "NULL".into()
        }
    }

    /// Reads rows of a logical table as JSON maps under 5.0 names, with
    /// JSON-in-TEXT columns parsed and legacy values mapped.
    pub(crate) fn rows(
        &self,
        t: &TableDef,
        cols: &[&str],
        where_: Option<(&str, &[&dyn rusqlite::ToSql])>,
        order: &str,
    ) -> Result<Vec<Map<String, Value>>> {
        let Some(table) = self.table_name(t.name) else {
            return Ok(Vec::new());
        };
        let select: Vec<String> = cols
            .iter()
            .map(|c| format!("{} AS \"{c}\"", self.col_expr(t, c)))
            .collect();
        let mut sql = format!("SELECT {} FROM \"{table}\"", select.join(", "));
        let params: &[&dyn rusqlite::ToSql] = match where_ {
            Some((w, p)) => {
                sql.push_str(" WHERE ");
                sql.push_str(w);
                p
            }
            None => &[],
        };
        if !order.is_empty() {
            sql.push_str(" ORDER BY ");
            sql.push_str(order);
        }
        let mut st = self.conn.prepare(&sql)?;
        let mut rows = st.query(params)?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            let mut m = Map::new();
            for (i, c) in cols.iter().enumerate() {
                m.insert((*c).to_string(), sql_to_json(r.get_ref(i)?));
            }
            self.map_row(t, &mut m);
            out.push(m);
        }
        if self.flavor == Flavor::Legacy && t.name == "units" && cols.contains(&"ord") {
            // 4.x numbers units from 0: ord = 1-based rank by (orden, id).
            let mut ranked: Vec<(i64, String, usize)> = out
                .iter()
                .enumerate()
                .map(|(i, m)| {
                    (
                        m.get("ord").and_then(Value::as_i64).unwrap_or(0),
                        m.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
                        i,
                    )
                })
                .collect();
            ranked.sort();
            for (rank, (_, _, i)) in ranked.iter().enumerate() {
                out[*i].insert("ord".into(), Value::from(rank as i64 + 1));
            }
            if order.starts_with("ord") {
                out.sort_by_key(|m| m.get("ord").and_then(Value::as_i64).unwrap_or(0));
            }
        }
        Ok(out)
    }

    pub(crate) fn blob_key_set(&self) -> &HashSet<String> {
        self.blob_keys.get_or_init(|| {
            let mut set = HashSet::new();
            if let Some(t) = self.table_name("blobs") {
                let col = self.col_expr(&schema::BLOBS, "key");
                if let Ok(mut st) = self.conn.prepare(&format!("SELECT {col} FROM \"{t}\"")) {
                    if let Ok(rows) = st.query_map([], |r| r.get::<_, String>(0)) {
                        set.extend(rows.flatten());
                    }
                }
            }
            set
        })
    }

    fn legacy_ref(&self, v: &mut Value, empty_to_null: bool) {
        if let Value::String(s) = v {
            if s.is_empty() {
                if empty_to_null {
                    *v = Value::Null;
                }
            } else if self.blob_key_set().contains(s.as_str()) {
                *v = Value::String(format!("blob:{s}"));
            }
        }
    }

    fn map_row(&self, t: &TableDef, m: &mut Map<String, Value>) {
        let json_cols: &[&str] = match t.name {
            "documents" => &["metadata", "rights"],
            "units" => &["anchor", "notes", "words"],
            "fragments" => &["section", "anchor", "anchor_end"],
            "figures" => &["anchor"],
            "spaces" => &["modalities", "task_prefixes"],
            "provenance" => &["detail"],
            _ => &[],
        };
        for c in json_cols {
            if let Some(v) = m.remove(*c) {
                m.insert((*c).to_string(), parse_json_column(v));
            }
        }
        if self.flavor != Flavor::Legacy {
            return;
        }
        match t.name {
            "spdf_meta" => {
                if let Some(Value::String(k)) = m.get("key") {
                    let nk = schema::legacy_meta_key(k).to_string();
                    m.insert("key".into(), Value::String(nk));
                }
            }
            "documents" => {
                let legacy_kind = m
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if m.contains_key("kind") {
                    m.insert("kind".into(), Value::from(schema::legacy_kind(&legacy_kind)));
                }
                if let Some(md) = m.get("metadata") {
                    let mapped = legacy::map_metadata(md, &legacy_kind);
                    m.insert("metadata".into(), mapped);
                }
                if let Some(v) = m.get_mut("source_ref") {
                    let mut x = v.clone();
                    self.legacy_ref(&mut x, true);
                    *v = x;
                }
            }
            "units" => {
                for c in ["anchor"] {
                    if let Some(v) = m.get(c) {
                        let mapped = legacy::map_anchor(v);
                        m.insert(c.into(), mapped);
                    }
                }
                for c in ["image", "thumbnail"] {
                    if let Some(v) = m.get(c) {
                        let mut x = v.clone();
                        self.legacy_ref(&mut x, true);
                        m.insert(c.into(), x);
                    }
                }
            }
            "fragments" => {
                for c in ["anchor", "anchor_end"] {
                    if let Some(v) = m.get(c) {
                        let mapped = legacy::map_anchor(v);
                        m.insert(c.into(), mapped);
                    }
                }
            }
            "figures" => {
                if let Some(v) = m.get("anchor") {
                    let mapped = legacy::map_anchor(v);
                    m.insert("anchor".into(), mapped);
                }
                if let Some(v) = m.get("image") {
                    let mut x = v.clone();
                    self.legacy_ref(&mut x, false);
                    m.insert("image".into(), x);
                }
            }
            "spaces" => {
                if m.contains_key("dtype") {
                    m.insert("dtype".into(), Value::from("f32"));
                }
                if let Some(v) = m.get("modalities") {
                    let mapped = legacy::map_modalities(v);
                    m.insert("modalities".into(), mapped);
                }
            }
            "vectors" => {
                if let Some(Value::String(t)) = m.get("target") {
                    let nt = schema::legacy_target(t).to_string();
                    m.insert("target".into(), Value::String(nt));
                }
            }
            _ => {}
        }
    }

    fn typed<T: DeserializeOwned>(rows: Vec<Map<String, Value>>, what: &str) -> Result<Vec<T>> {
        rows.into_iter()
            .map(|m| {
                serde_json::from_value(Value::Object(m))
                    .map_err(|e| Error::invalid(format!("bad {what} row: {e}")))
            })
            .collect()
    }

    // ------------------------------------------------------------------
    // Public accessors
    // ------------------------------------------------------------------

    /// `spdf_meta` as a map (legacy keys mapped: `creado` → `created`…).
    pub fn meta(&self) -> Result<BTreeMap<String, String>> {
        let rows = self.rows(&schema::META, &["key", "value"], None, "")?;
        Ok(rows
            .into_iter()
            .filter_map(|m| {
                let k = m.get("key")?.as_str()?.to_string();
                let v = match m.get("value")? {
                    Value::String(s) => s.clone(),
                    Value::Null => return None,
                    other => other.to_string(),
                };
                Some((k, v))
            })
            .collect())
    }

    pub(crate) fn document_row(&self) -> Result<Option<Map<String, Value>>> {
        let cols: Vec<&str> = schema::DOCUMENTS.columns.iter().map(|c| c.0).collect();
        Ok(self.rows(&schema::DOCUMENTS, &cols, None, "rowid")?.into_iter().next())
    }

    /// The document (the first row of `documents`).
    pub fn document(&self) -> Result<Document> {
        let row = self
            .document_row()?
            .ok_or_else(|| Error::NotFound("the file has no document row".into()))?;
        serde_json::from_value(Value::Object(row))
            .map_err(|e| Error::invalid(format!("bad document row: {e}")))
    }

    /// All units in reading order.
    pub fn units(&self) -> Result<Vec<Unit>> {
        let cols: Vec<&str> = schema::UNITS.columns.iter().map(|c| c.0).collect();
        Self::typed(self.rows(&schema::UNITS, &cols, None, "ord, id")?, "unit")
    }

    /// The unit with a given id.
    pub fn unit(&self, id: &str) -> Result<Option<Unit>> {
        if self.is_legacy() {
            return Ok(self.units()?.into_iter().find(|u| u.id == id));
        }
        let cols: Vec<&str> = schema::UNITS.columns.iter().map(|c| c.0).collect();
        let rows = self.rows(&schema::UNITS, &cols, Some(("id = ?1", &[&id])), "")?;
        Ok(Self::typed(rows, "unit")?.into_iter().next())
    }

    /// The unit at 1-based position `ord`.
    pub fn unit_by_ord(&self, ord: i64) -> Result<Option<Unit>> {
        if self.is_legacy() {
            return Ok(self.units()?.into_iter().find(|u| u.ord == ord));
        }
        let cols: Vec<&str> = schema::UNITS.columns.iter().map(|c| c.0).collect();
        let rows = self.rows(&schema::UNITS, &cols, Some(("ord = ?1", &[&ord])), "id")?;
        Ok(Self::typed(rows, "unit")?.into_iter().next())
    }

    /// The first unit whose printed folio is `printed` ("go to page 145").
    pub fn unit_by_printed(&self, printed: &str) -> Result<Option<Unit>> {
        Ok(self.units()?.into_iter().find(|u| u.printed.as_deref() == Some(printed)))
    }

    /// Sections ordered by id.
    pub fn sections(&self) -> Result<Vec<Section>> {
        let cols: Vec<&str> = schema::SECTIONS.columns.iter().map(|c| c.0).collect();
        Self::typed(self.rows(&schema::SECTIONS, &cols, None, "id")?, "section")
    }

    /// Fragments ordered by `n`.
    pub fn fragments(&self) -> Result<Vec<Fragment>> {
        let cols: Vec<&str> = schema::FRAGMENTS.columns.iter().map(|c| c.0).collect();
        Self::typed(self.rows(&schema::FRAGMENTS, &cols, None, "n")?, "fragment")
    }

    /// The fragment with a given id.
    pub fn fragment(&self, id: &str) -> Result<Option<Fragment>> {
        let cols: Vec<&str> = schema::FRAGMENTS.columns.iter().map(|c| c.0).collect();
        let idc = self.col_expr(&schema::FRAGMENTS, "id");
        let w = format!("{idc} = ?1");
        let rows = self.rows(&schema::FRAGMENTS, &cols, Some((&w, &[&id])), "")?;
        Ok(Self::typed(rows, "fragment")?.into_iter().next())
    }

    pub(crate) fn fragments_by_n(&self, ns: &[i64]) -> Result<HashMap<i64, Fragment>> {
        let mut out = HashMap::new();
        if ns.is_empty() {
            return Ok(out);
        }
        let cols: Vec<&str> = schema::FRAGMENTS.columns.iter().map(|c| c.0).collect();
        let nc = self.col_expr(&schema::FRAGMENTS, "n");
        let list: Vec<String> = ns.iter().map(|n| n.to_string()).collect();
        let w = format!("{nc} IN ({})", list.join(","));
        for f in Self::typed::<Fragment>(self.rows(&schema::FRAGMENTS, &cols, Some((&w, &[])), "")?, "fragment")? {
            out.insert(f.n, f);
        }
        Ok(out)
    }

    /// Figures ordered by id.
    pub fn figures(&self) -> Result<Vec<Figure>> {
        let cols: Vec<&str> = schema::FIGURES.columns.iter().map(|c| c.0).collect();
        Self::typed(self.rows(&schema::FIGURES, &cols, None, "id")?, "figure")
    }

    /// Vector spaces ordered by id.
    pub fn spaces(&self) -> Result<Vec<Space>> {
        let cols: Vec<&str> = schema::SPACES.columns.iter().map(|c| c.0).collect();
        Self::typed(self.rows(&schema::SPACES, &cols, None, "id")?, "space")
    }

    /// One space by id.
    pub fn space(&self, id: &str) -> Result<Option<Space>> {
        Ok(self.spaces()?.into_iter().find(|s| s.id == id))
    }

    /// Raw vector rows `(target, id, data)` of a space, ordered by target, id.
    pub(crate) fn raw_vectors(&self, space: &str, target: Option<Target>) -> Result<Vec<(String, String, Vec<u8>)>> {
        let Some(table) = self.table_name("vectors") else {
            return Ok(Vec::new());
        };
        let tc = self.col_expr(&schema::VECTORS, "target");
        let ic = self.col_expr(&schema::VECTORS, "id");
        let sc = self.col_expr(&schema::VECTORS, "space");
        let dc = self.col_expr(&schema::VECTORS, "data");
        let mut sql = format!("SELECT {tc}, {ic}, {dc} FROM \"{table}\" WHERE {sc} = ?1");
        let tval;
        if let Some(t) = target {
            tval = if self.is_legacy() {
                schema::target_to_legacy(t.as_str())
            } else {
                t.as_str()
            };
            sql.push_str(&format!(" AND {tc} = ?2"));
        } else {
            tval = "";
        }
        sql.push_str(&format!(" ORDER BY {tc}, {ic}"));
        let mut st = self.conn.prepare(&sql)?;
        let map = |r: &rusqlite::Row<'_>| -> rusqlite::Result<(String, String, Vec<u8>)> {
            let t: String = r.get(0)?;
            let data = match r.get_ref(2)? {
                ValueRef::Blob(b) => b.to_vec(),
                ValueRef::Text(b) => b.to_vec(),
                _ => Vec::new(),
            };
            Ok((t, r.get(1)?, data))
        };
        let rows: Vec<_> = if target.is_some() {
            st.query_map(rusqlite::params![space, tval], map)?
                .collect::<std::result::Result<_, _>>()?
        } else {
            st.query_map(rusqlite::params![space], map)?
                .collect::<std::result::Result<_, _>>()?
        };
        Ok(rows
            .into_iter()
            .map(|(t, i, d)| {
                let t = if self.is_legacy() {
                    schema::legacy_target(&t).to_string()
                } else {
                    t
                };
                (t, i, d)
            })
            .collect())
    }

    /// Decoded vectors of a space (and optionally one target), ordered by
    /// target and id. Fails with [`Error::Vector`] on a size mismatch.
    pub fn vectors(&self, space: &str, target: Option<Target>) -> Result<Vec<Vector>> {
        let sp = self
            .space(space)?
            .ok_or_else(|| Error::Vector(format!("unknown space `{space}`")))?;
        let dtype = sp
            .dtype()
            .ok_or_else(|| Error::Vector(format!("unknown dtype `{}`", sp.dtype)))?;
        let dims = usize::try_from(sp.dims).map_err(|_| Error::Vector("negative dims".into()))?;
        self.raw_vectors(space, target)?
            .into_iter()
            .map(|(t, id, data)| {
                let values = crate::vector::decode(&data, dtype, dims)?;
                Ok(Vector {
                    target: Target::parse(&t).unwrap_or_default(),
                    id,
                    space: space.to_string(),
                    values,
                })
            })
            .collect()
    }

    /// Blob metadata ordered by key (SHA-256 computed for legacy files).
    pub fn blobs(&self) -> Result<Vec<BlobInfo>> {
        let Some(table) = self.table_name("blobs") else {
            return Ok(Vec::new());
        };
        let kc = self.col_expr(&schema::BLOBS, "key");
        let mc = self.col_expr(&schema::BLOBS, "mime");
        let sc = self.col_expr(&schema::BLOBS, "sha256");
        let dc = self.col_expr(&schema::BLOBS, "data");
        let sql = format!("SELECT {kc}, {mc}, {sc}, length({dc}) FROM \"{table}\" ORDER BY {kc}");
        let mut st = self.conn.prepare(&sql)?;
        let rows = st.query_map([], |r| {
            Ok(BlobInfo {
                key: r.get(0)?,
                mime: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                sha256: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                bytes: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
            })
        })?;
        let mut out: Vec<BlobInfo> = rows.collect::<std::result::Result<_, _>>()?;
        if self.is_legacy() {
            for b in &mut out {
                if let Some(blob) = self.blob(&b.key)? {
                    b.sha256 = hex(&Sha256::digest(&blob.data));
                }
            }
        }
        Ok(out)
    }

    /// SHA-256 (hex) computed from the stored bytes of every blob, by key.
    pub(crate) fn computed_blob_hashes(&self) -> Result<Vec<(String, String, i64, String)>> {
        let Some(table) = self.table_name("blobs") else {
            return Ok(Vec::new());
        };
        let kc = self.col_expr(&schema::BLOBS, "key");
        let mc = self.col_expr(&schema::BLOBS, "mime");
        let dc = self.col_expr(&schema::BLOBS, "data");
        let sql = format!("SELECT {kc}, {mc}, {dc} FROM \"{table}\" ORDER BY {kc}");
        let mut st = self.conn.prepare(&sql)?;
        let mut rows = st.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            let key: String = r.get(0)?;
            let mime: String = r.get::<_, Option<String>>(1)?.unwrap_or_default();
            let (len, h) = match r.get_ref(2)? {
                ValueRef::Blob(b) | ValueRef::Text(b) => (b.len() as i64, hex(&Sha256::digest(b))),
                _ => (0, hex(&Sha256::digest([]))),
            };
            out.push((key, mime, len, h));
        }
        Ok(out)
    }

    /// A blob by key (`None` if absent). Accepts `blob:<key>` too.
    pub fn blob(&self, key: &str) -> Result<Option<Blob>> {
        let key = key.strip_prefix("blob:").unwrap_or(key);
        let Some(table) = self.table_name("blobs") else {
            return Ok(None);
        };
        let kc = self.col_expr(&schema::BLOBS, "key");
        let mc = self.col_expr(&schema::BLOBS, "mime");
        let dc = self.col_expr(&schema::BLOBS, "data");
        let sql = format!("SELECT {kc}, {mc}, {dc} FROM \"{table}\" WHERE {kc} = ?1");
        let mut st = self.conn.prepare(&sql)?;
        let mut rows = st.query([key])?;
        match rows.next()? {
            Some(r) => {
                let data = match r.get_ref(2)? {
                    ValueRef::Blob(b) | ValueRef::Text(b) => b.to_vec(),
                    _ => Vec::new(),
                };
                Ok(Some(Blob {
                    key: r.get(0)?,
                    mime: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    data,
                }))
            }
            None => Ok(None),
        }
    }

    /// Resolves an image reference (`blob:<key>`) to its bytes. URLs are
    /// not fetched: `Ok(None)` is returned for them.
    pub fn resolve_image(&self, reference: &str) -> Result<Option<Blob>> {
        match reference.strip_prefix("blob:") {
            Some(k) => self.blob(k),
            None => Ok(None),
        }
    }

    /// Image of a unit (page scan, frame, slide), if shipped in the file.
    pub fn unit_image(&self, unit: &Unit) -> Result<Option<Blob>> {
        match &unit.image {
            Some(r) => self.resolve_image(r),
            None => Ok(None),
        }
    }

    /// Provenance rows in dump order.
    pub fn provenance(&self) -> Result<Vec<Provenance>> {
        let cols: Vec<&str> = schema::PROVENANCE.columns.iter().map(|c| c.0).collect();
        Self::typed(
            self.rows(&schema::PROVENANCE, &cols, None, "at, stage, provider, model, detail, ms")?,
            "provenance",
        )
    }

    /// Declared extensions ordered by name.
    pub fn extensions(&self) -> Result<Vec<Extension>> {
        if !self.has_table("extensions") {
            return Ok(Vec::new());
        }
        Self::typed(
            self.rows(&schema::EXTENSIONS, &["name", "version", "required"], None, "name")?,
            "extension",
        )
    }

    /// True if the optional trigram index exists.
    pub fn has_trigram(&self) -> bool {
        self.info.tables.contains_key("fragments_fts_trigram")
    }

    /// Name of the FTS table (`fragments_fts`, or `fragmentos_fts` in 4.x).
    pub(crate) fn fts_table(&self) -> &'static str {
        match self.flavor {
            Flavor::V5 => "fragments_fts",
            Flavor::Legacy => "fragmentos_fts",
        }
    }
}

/// Lowercase hex.
pub(crate) fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}
