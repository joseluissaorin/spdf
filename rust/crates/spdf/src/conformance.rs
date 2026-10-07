//! Conformance runner (contract §11, `conformance/README.md`).
//!
//! Discovers every `cases/*.json` under a conformance directory, runs it and
//! reports `{"impl","version","passed","failed","skipped"}`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::anchor::{AnchorUri, Locator};
use crate::canon;
use crate::cite::{cite_value, Locale};
use crate::error::Result;
use crate::integrity::content_sha256_of_dump;
use crate::model::{SearchHit, Target};
use crate::reader::{OpenOptions, Spdf};
use crate::text::ParsedQuery;
use crate::writer::Writer;

/// A failed case.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Failure {
    /// Case id.
    pub id: String,
    /// Why it failed.
    pub reason: String,
}

/// The runner report.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Report {
    /// Implementation name.
    #[serde(rename = "impl")]
    pub implementation: String,
    /// Implementation version.
    pub version: String,
    /// Ids of passed cases.
    pub passed: Vec<String>,
    /// Failed cases.
    pub failed: Vec<Failure>,
    /// Skipped cases (none: this implementation claims every kind).
    pub skipped: Vec<Failure>,
}

type CaseResult = std::result::Result<(), String>;

fn read_json(path: &Path) -> std::result::Result<Value, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("bad JSON in {}: {e}", path.display()))
}

fn s<'a>(v: &'a Value, k: &str) -> std::result::Result<&'a str, String> {
    v.get(k)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing string `{k}`"))
}

fn open_opts() -> OpenOptions {
    OpenOptions {
        ignore_required_extensions: true,
        ..Default::default()
    }
}

fn open(dir: &Path, rel: &str) -> std::result::Result<Spdf, String> {
    Spdf::open_with(dir.join(rel), &open_opts()).map_err(|e| format!("open {rel}: {e}"))
}

/// First difference between two JSON values (canonical comparison), as a path.
pub fn first_difference(a: &Value, b: &Value, path: &str) -> Option<String> {
    if canon::equal(a, b) {
        return None;
    }
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let mut keys: Vec<&String> = x.keys().chain(y.keys()).collect();
            keys.sort();
            keys.dedup();
            for k in keys {
                let p = format!("{path}.{k}");
                match (x.get(k), y.get(k)) {
                    (Some(u), Some(v)) => {
                        if let Some(d) = first_difference(u, v, &p) {
                            return Some(d);
                        }
                    }
                    (None, _) => return Some(format!("{p} missing in ours")),
                    (_, None) => return Some(format!("{p} unexpected in ours")),
                }
            }
            Some(path.to_string())
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{path}: {} items, expected {}", x.len(), y.len()));
            }
            for (i, (u, v)) in x.iter().zip(y).enumerate() {
                if let Some(d) = first_difference(u, v, &format!("{path}[{i}]")) {
                    return Some(d);
                }
            }
            Some(path.to_string())
        }
        _ => {
            let mut ours = canon::to_string(a);
            let mut theirs = canon::to_string(b);
            ours.truncate(120);
            theirs.truncate(120);
            Some(format!("{path}: got {ours}, expected {theirs}"))
        }
    }
}

fn compare_dump(ours: &Value, expect: &Value, sha: Option<&str>) -> CaseResult {
    if let Some(d) = first_difference(ours, expect, "dump") {
        return Err(d);
    }
    if let Some(sha) = sha {
        let got = content_sha256_of_dump(ours);
        if got != sha {
            return Err(format!("content_sha256 {got}, expected {sha}"));
        }
    }
    Ok(())
}

fn run_dump(dir: &Path, case: &Value) -> CaseResult {
    let input = &case["input"];
    let expect = &case["expect"];
    let doc = open(dir, s(input, "file")?)?;
    let ours = doc.dump().map_err(|e| format!("dump: {e}"))?;
    let exp = read_json(&dir.join(s(expect, "dump")?))?;
    compare_dump(
        &ours,
        &exp,
        expect.get("content_sha256").and_then(Value::as_str),
    )
}

fn run_roundtrip(dir: &Path, case: &Value) -> CaseResult {
    let src = read_json(&dir.join(s(&case["input"], "source")?))?;
    let mut w = Writer::from_dump(&src).map_err(|e| format!("writer: {e}"))?;
    let bytes = w.to_bytes().map_err(|e| format!("write: {e}"))?;
    let doc = Spdf::from_bytes(&bytes, &open_opts()).map_err(|e| format!("reopen: {e}"))?;
    let ours = doc.dump().map_err(|e| format!("dump: {e}"))?;
    let exp = read_json(&dir.join(s(&case["expect"], "dump")?))?;
    compare_dump(&ours, &exp, None)
}

fn run_validate(dir: &Path, case: &Value) -> CaseResult {
    let r = crate::validate::validate(dir.join(s(&case["input"], "file")?));
    let e = &case["expect"];
    let got = json!({
        "valid": r.valid,
        "version": r.version,
        "errors": r.error_codes(),
        "warnings": r.warning_codes(),
    });
    let mut exp = json!({
        "valid": e["valid"],
        "version": e["version"],
        "errors": e["errors"],
        "warnings": e["warnings"],
    });
    for k in ["errors", "warnings"] {
        if let Some(a) = exp[k].as_array() {
            let mut v: Vec<String> = a
                .iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect();
            v.sort();
            v.dedup();
            exp[k] = json!(v);
        }
    }
    match first_difference(&got, &exp, "report") {
        None => Ok(()),
        Some(d) => Err(format!(
            "{d}; messages: {}",
            r.errors
                .iter()
                .map(|i| format!("{} {}", i.code, i.message))
                .collect::<Vec<_>>()
                .join(" | ")
        )),
    }
}

fn compare_results(ours: &[SearchHit], expect: &Value, with_via: bool) -> CaseResult {
    let exp = expect
        .get("results")
        .and_then(Value::as_array)
        .ok_or("expect.results missing")?;
    let ours_v: Vec<Value> = ours
        .iter()
        .map(|h| serde_json::to_value(h).unwrap_or(Value::Null))
        .collect();
    let id_of = |r: &Value| -> Option<String> {
        ["fragment_id", "unit_id", "figure_id"]
            .iter()
            .find_map(|k| {
                r.get(*k)
                    .and_then(Value::as_str)
                    .map(|v| format!("{k}={v}"))
            })
    };
    let ids: Vec<String> = ours_v.iter().filter_map(id_of).collect();
    let exp_ids: Vec<String> = exp.iter().filter_map(id_of).collect();
    if ids != exp_ids {
        return Err(format!("ids {ids:?}, expected {exp_ids:?}"));
    }
    for (h, e) in ours.iter().zip(exp) {
        let es = e["score"].as_f64().unwrap_or(f64::NAN);
        let diff = (h.score - es).abs();
        if diff.is_nan() || diff > 1e-6 {
            return Err(format!(
                "{}: score {}, expected {es}",
                h.fragment_id, h.score
            ));
        }
        let eu = e["anchor_uri"].as_str().unwrap_or("");
        if h.anchor_uri != eu {
            return Err(format!(
                "{}: anchor_uri {}, expected {eu}",
                h.fragment_id, h.anchor_uri
            ));
        }
        if with_via {
            let ev: Vec<&str> = e["via"]
                .as_array()
                .map(|a| a.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            if h.via != ev {
                return Err(format!(
                    "{}: via {:?}, expected {ev:?}",
                    h.fragment_id, h.via
                ));
            }
        }
    }
    Ok(())
}

fn limit_of(input: &Value) -> usize {
    input.get("limit").and_then(Value::as_u64).unwrap_or(10) as usize
}

fn vector_of(input: &Value) -> std::result::Result<Vec<f32>, String> {
    input
        .get("query_vector")
        .and_then(Value::as_array)
        .ok_or("missing query_vector")?
        .iter()
        .map(|x| {
            x.as_f64()
                .map(|f| f as f32)
                .ok_or_else(|| "non-numeric component".to_string())
        })
        .collect()
}

fn run_search_lexical(dir: &Path, case: &Value) -> CaseResult {
    let input = &case["input"];
    let doc = open(dir, s(input, "file")?)?;
    let query = s(input, "query")?;
    let hits = doc
        .search_lexical(query, limit_of(input))
        .map_err(|e| format!("search: {e}"))?;
    compare_results(&hits, &case["expect"], true)?;
    let (route, m) = doc.lexical_plan(query);
    if let Some(er) = case["expect"].get("route").and_then(Value::as_str) {
        if route != er {
            return Err(format!("route {route}, expected {er}"));
        }
    }
    if let Some(em) = case["expect"].get("match") {
        let got = m.map(Value::from).unwrap_or(Value::Null);
        if &got != em {
            return Err(format!("match {got}, expected {em}"));
        }
    }
    Ok(())
}

fn run_search_vector(dir: &Path, case: &Value) -> CaseResult {
    let input = &case["input"];
    let doc = open(dir, s(input, "file")?)?;
    let target = input
        .get("target")
        .and_then(Value::as_str)
        .map(|t| Target::parse(t).ok_or(format!("bad target {t}")))
        .transpose()?
        .unwrap_or_default();
    let hits = doc
        .search_vector(
            s(input, "space")?,
            &vector_of(input)?,
            target,
            limit_of(input),
        )
        .map_err(|e| format!("search: {e}"))?;
    compare_results(&hits, &case["expect"], false)
}

fn run_search_hybrid(dir: &Path, case: &Value) -> CaseResult {
    let input = &case["input"];
    let doc = open(dir, s(input, "file")?)?;
    let hits = doc
        .search_hybrid(
            s(input, "query")?,
            &vector_of(input)?,
            s(input, "space")?,
            limit_of(input),
        )
        .map_err(|e| format!("search: {e}"))?;
    compare_results(&hits, &case["expect"], true)
}

fn parsed_value(u: &AnchorUri) -> Value {
    json!({"docref": u.docref, "locator": serde_json::to_value(&u.locator).unwrap_or(Value::Null)})
}

fn run_anchor_uri(case: &Value) -> CaseResult {
    let input = &case["input"];
    let expect = &case["expect"];
    if expect.get("error").and_then(Value::as_bool) == Some(true) {
        return match AnchorUri::parse(s(input, "uri")?) {
            Ok(u) => Err(format!("accepted an invalid URI: {}", parsed_value(&u))),
            Err(_) => Ok(()),
        };
    }
    if let Some(uri) = input.get("uri").and_then(Value::as_str) {
        let u = AnchorUri::parse(uri).map_err(|e| format!("parse: {e}"))?;
        let want = json!({"docref": expect["docref"], "locator": expect["locator"]});
        if let Some(d) = first_difference(&parsed_value(&u), &want, "parsed") {
            return Err(d);
        }
        let canonical = s(expect, "canonical")?;
        let back = u.to_string();
        if back != canonical {
            return Err(format!("format(parse) = {back}, expected {canonical}"));
        }
        return Ok(());
    }
    let docref = s(input, "docref")?;
    let end = input.get("anchor_end").filter(|v| !v.is_null());
    let uri = crate::anchor::format_uri(docref, &input["anchor"], end)
        .map_err(|e| format!("format: {e}"))?;
    let want_uri = s(expect, "uri")?;
    if uri != want_uri {
        return Err(format!("uri {uri}, expected {want_uri}"));
    }
    let u = AnchorUri::parse(&uri).map_err(|e| format!("parse: {e}"))?;
    let want = json!({"docref": docref, "locator": expect["locator"]});
    if let Some(d) = first_difference(&parsed_value(&u), &want, "parsed") {
        return Err(d);
    }
    // format(locator) from the expected locator, too.
    let l: Locator =
        serde_json::from_value(expect["locator"].clone()).map_err(|e| format!("locator: {e}"))?;
    let again = AnchorUri {
        docref: docref.to_string(),
        locator: l,
    }
    .to_string();
    if again != want_uri {
        return Err(format!("format(locator) = {again}, expected {want_uri}"));
    }
    Ok(())
}

fn run_cite(case: &Value) -> CaseResult {
    let input = &case["input"];
    let locale = Locale::parse(input.get("locale").and_then(Value::as_str).unwrap_or("en"));
    let end = input.get("anchor_end").filter(|v| !v.is_null());
    let got = cite_value(&input["anchor"], end, &input["metadata"], locale);
    let want = s(&case["expect"], "text")?;
    if got == want {
        Ok(())
    } else {
        Err(format!("{got:?}, expected {want:?}"))
    }
}

fn run_quantize(case: &Value) -> CaseResult {
    let input = &case["input"];
    let dtype = s(input, "dtype")?;
    let values: Vec<f64> = input["values"]
        .as_array()
        .ok_or("missing values")?
        .iter()
        .map(|x| x.as_f64().ok_or_else(|| "non-numeric value".to_string()))
        .collect::<std::result::Result<_, _>>()?;
    let got = crate::model::Dtype::parse(dtype)
        .ok_or_else(|| crate::Error::Vector(format!("unknown dtype {dtype}")))
        .and_then(|d| crate::vector::quantize(&values, d));
    let expect = &case["expect"];
    if expect.get("error").and_then(Value::as_bool) == Some(true) {
        return match got {
            Ok(b) => Err(format!("accepted, produced {}", crate::reader::hex(&b))),
            Err(_) => Ok(()),
        };
    }
    let want = s(expect, "hex")?;
    match got {
        Ok(b) if crate::reader::hex(&b) == want => Ok(()),
        Ok(b) => Err(format!("hex {}, expected {want}", crate::reader::hex(&b))),
        Err(e) => Err(format!("error: {e}")),
    }
}

fn run_locate(dir: &Path, case: &Value) -> CaseResult {
    let input = &case["input"];
    let doc = open(dir, s(input, "file")?)?;
    let got = match doc.locate(s(input, "reference")?) {
        Ok(l) => serde_json::to_value(l).map_err(|e| e.to_string())?,
        Err(e) => return Err(format!("locate: {e}")),
    };
    match first_difference(&got, &case["expect"], "locate") {
        None => Ok(()),
        Some(d) => Err(d),
    }
}

fn run_cite_passage(dir: &Path, case: &Value) -> CaseResult {
    let input = &case["input"];
    let doc = open(dir, s(input, "file")?)?;
    let locale = Locale::parse(input.get("locale").and_then(Value::as_str).unwrap_or("en"));
    let c = doc
        .cite_passage(s(input, "fragment")?, s(input, "quote")?, locale)
        .map_err(|e| format!("cite_passage: {e}"))?;
    let (want_text, want_uri) = (s(&case["expect"], "text")?, s(&case["expect"], "uri")?);
    if c.text != want_text {
        return Err(format!("text {:?}, expected {want_text:?}", c.text));
    }
    if c.uri != want_uri {
        return Err(format!("uri {}, expected {want_uri}", c.uri));
    }
    Ok(())
}

fn documents(
    dir: &Path,
    input: &Value,
) -> std::result::Result<Vec<crate::model::Document>, String> {
    input
        .get("files")
        .and_then(Value::as_array)
        .ok_or("missing files")?
        .iter()
        .map(|f| {
            let rel = f.as_str().ok_or("file is not a string")?;
            open(dir, rel)?
                .document()
                .map_err(|e| format!("{rel}: {e}"))
        })
        .collect()
}

fn run_export_csl(dir: &Path, case: &Value) -> CaseResult {
    let input = &case["input"];
    let docs = documents(dir, input)?;
    let anchor = input.get("anchor").filter(|v| !v.is_null());
    let end = input.get("anchor_end").filter(|v| !v.is_null());
    let got = crate::export::export_csl(&docs, anchor, end);
    match first_difference(&got, &case["expect"]["items"], "items") {
        None => Ok(()),
        Some(d) => Err(d),
    }
}

fn bib_lines(text: &str) -> Vec<String> {
    text.replace("\r\n", "\n")
        .split('\n')
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

fn run_export_bibtex(dir: &Path, case: &Value) -> CaseResult {
    let docs = documents(dir, &case["input"])?;
    let got = bib_lines(&crate::export::bibtex_many(&docs));
    let want = bib_lines(s(&case["expect"], "text")?);
    if got == want {
        return Ok(());
    }
    let i = got
        .iter()
        .zip(&want)
        .position(|(a, b)| a != b)
        .unwrap_or(got.len().min(want.len()));
    Err(format!(
        "line {}: got {:?}, expected {:?}",
        i + 1,
        got.get(i),
        want.get(i)
    ))
}

fn run_export_structure(dir: &Path, case: &Value) -> CaseResult {
    let input = &case["input"];
    let doc = open(dir, s(input, "file")?)?;
    let got =
        crate::interop::page_structure(&doc, s(input, "format")?).map_err(|e| e.to_string())?;
    match first_difference(&got, &case["expect"], "structure") {
        None => Ok(()),
        Some(d) => Err(d),
    }
}

/// Runs one case (parsed JSON) against the conformance directory `dir`.
pub fn run_case(dir: &Path, case: &Value) -> CaseResult {
    let kind = s(case, "kind")?;
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match kind {
        "dump" | "legacy_dump" => run_dump(dir, case),
        "roundtrip" => run_roundtrip(dir, case),
        "validate" => run_validate(dir, case),
        "search_lexical" => run_search_lexical(dir, case),
        "search_vector" => run_search_vector(dir, case),
        "search_hybrid" => run_search_hybrid(dir, case),
        "anchor_uri" => run_anchor_uri(case),
        "cite" => run_cite(case),
        "quantize" => run_quantize(case),
        "locate" => run_locate(dir, case),
        "cite_passage" => run_cite_passage(dir, case),
        "export_csl" => run_export_csl(dir, case),
        "export_bibtex" => run_export_bibtex(dir, case),
        "export_structure" => run_export_structure(dir, case),
        other => Err(format!("unknown case kind `{other}`")),
    }));
    r.unwrap_or_else(|_| Err("panicked".into()))
}

/// Lists `cases/*.json` in name order.
pub fn case_files(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir.join("cases"))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    files.sort();
    Ok(files)
}

/// Runs every case in `dir/cases` (optionally only ids containing `filter`).
pub fn run_dir(dir: impl AsRef<Path>, filter: Option<&str>) -> Result<Report> {
    let dir = dir.as_ref();
    let mut report = Report {
        implementation: "spdf (Rust reference)".into(),
        version: crate::VERSION.into(),
        passed: Vec::new(),
        failed: Vec::new(),
        skipped: Vec::new(),
    };
    for path in case_files(dir)? {
        let fallback = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let case = match read_json(&path) {
            Ok(c) => c,
            Err(e) => {
                report.failed.push(Failure {
                    id: fallback,
                    reason: e,
                });
                continue;
            }
        };
        let id = case
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or(fallback);
        if let Some(f) = filter {
            if !id.contains(f) {
                continue;
            }
        }
        match run_case(dir, &case) {
            Ok(()) => report.passed.push(id),
            Err(reason) => report.failed.push(Failure { id, reason }),
        }
    }
    Ok(report)
}

impl Spdf {
    /// The route (`fts`, `trigram`, `substring`) and FTS5 `MATCH` string the
    /// reference lexical search uses for `query` on this file.
    pub fn lexical_plan(&self, query: &str) -> (&'static str, Option<String>) {
        let q = ParsedQuery::parse(query);
        let m = q.fts_match();
        if m.is_none() {
            return ("fts", None);
        }
        if q.cjk {
            if self.has_trigram() && q.terms.iter().all(|t| t.chars().count() >= 3) {
                return ("trigram", m);
            }
            return ("substring", None);
        }
        ("fts", m)
    }
}
