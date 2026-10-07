//! Bibliography export (SPEC §19): CSL-JSON and BibTeX.
//!
//! * CSL-JSON: the metadata item without the `spdf` member, `id` = BibTeX key;
//!   [`csl_citation_item`] adds the CSL `locator` and `label` of an anchor.
//! * BibTeX: entry type from the CSL type, key = first author's family name
//!   (or first word of the title) folded to ASCII letters, plus the year (or
//!   `nd`); several documents with the same key get `a`, `b`, `c`…
//!
//! ```
//! use serde_json::json;
//! let md = json!({"type":"book","title":"Vigilar y castigar","author":[{"family":"Foucault","given":"Michel"}],
//!                 "issued":{"date-parts":[[1975]]},"publisher":"Siglo XXI","publisher-place":"México"});
//! let bib = spdf::export::csl_to_bibtex(&md, None);
//! assert!(bib.starts_with("@book{foucault1975,"));
//! assert!(bib.contains("  author = {Foucault, Michel},"));
//! assert!(bib.contains("  title = {{Vigilar} y castigar},"));
//! ```

use serde_json::{Map, Value};
use unicode_general_category::{get_general_category, GeneralCategory};
use unicode_normalization::char::canonical_combining_class;
use unicode_normalization::UnicodeNormalization;

use crate::anchor::Anchor;
use crate::cite::format_time;
use crate::model::Document;

const BIBTEX_TYPES: &[(&str, &str)] = &[
    ("book", "book"),
    ("article-journal", "article"),
    ("article-magazine", "article"),
    ("article-newspaper", "article"),
    ("chapter", "incollection"),
    ("paper-conference", "inproceedings"),
    ("thesis", "phdthesis"),
    ("report", "techreport"),
];

const SIMPLE_FIELDS: &[(&str, &str)] = &[
    ("publisher", "publisher"),
    ("publisher-place", "address"),
    ("collection-title", "series"),
    ("volume", "volume"),
    ("issue", "number"),
    ("page", "pages"),
    ("edition", "edition"),
    ("DOI", "doi"),
    ("ISBN", "isbn"),
    ("URL", "url"),
    ("language", "language"),
    ("note", "note"),
];

fn ascii_letters(s: &str) -> String {
    s.nfkd()
        .filter(|c| canonical_combining_class(*c) == 0)
        .filter(char::is_ascii_alphabetic)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn year_of(item: &Value) -> Option<String> {
    let y = item.get("issued")?.get("date-parts")?.get(0)?.get(0)?;
    match y {
        Value::Number(n) => n
            .as_i64()
            .or_else(|| {
                n.as_f64()
                    .filter(|f| f.is_finite())
                    .map(|f| f.trunc() as i64)
            })
            .map(|y| y.to_string()),
        Value::String(s) => {
            let t = s.trim();
            let digits = t.strip_prefix('-').unwrap_or(t);
            if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
                t.parse::<i64>().ok().map(|v| v.to_string())
            } else {
                None
            }
        }
        _ => None,
    }
}

fn value_text(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) if s.is_empty() => None,
        Value::String(s) => Some(s.clone()),
        Value::Array(a) if a.is_empty() => None,
        other => Some(other.to_string()),
    }
}

fn truthy_str(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// The base export key of a CSL item (SPEC §19.1): first author's family,
/// literal or given name folded to ASCII letters; else the first word of
/// `title-short` or `title`; else `anon`; then the year or `nd`:
/// `cervantessaavedra1605`, `lazarillo1554`, `anonnd`.
pub fn bibtex_key(item: &Value) -> String {
    let mut base = String::new();
    if let Some(a) = item
        .get("author")
        .and_then(|a| a.get(0))
        .filter(|a| a.is_object())
    {
        let name = truthy_str(a.get("family"))
            .or_else(|| truthy_str(a.get("literal")))
            .or_else(|| truthy_str(a.get("given")))
            .unwrap_or_default();
        base = ascii_letters(&name);
    }
    if base.is_empty() {
        let title = truthy_str(item.get("title-short"))
            .or_else(|| truthy_str(item.get("title")))
            .unwrap_or_default();
        base = title
            .split_whitespace()
            .next()
            .map(ascii_letters)
            .unwrap_or_default();
    }
    if base.is_empty() {
        base = "anon".into();
    }
    base + &year_of(item).unwrap_or_else(|| "nd".into())
}

fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\textbackslash{}"),
            '{' => out.push_str("\\{"),
            '}' => out.push_str("\\}"),
            c => out.push(c),
        }
    }
    out
}

/// Escapes and braces every word the source capitalizes.
fn protect_title(title: &str) -> String {
    fn flush(token: &mut String, out: &mut String) {
        if token.is_empty() {
            return;
        }
        let e = escape(token);
        if token
            .chars()
            .any(|c| get_general_category(c) == GeneralCategory::UppercaseLetter)
        {
            out.push('{');
            out.push_str(&e);
            out.push('}');
        } else {
            out.push_str(&e);
        }
        token.clear();
    }
    let mut out = String::new();
    let mut token = String::new();
    for c in title.chars() {
        if c.is_whitespace() {
            flush(&mut token, &mut out);
            out.push(c);
        } else {
            token.push(c);
        }
    }
    flush(&mut token, &mut out);
    out
}

fn names(people: Option<&Value>) -> Option<String> {
    let arr = people?.as_array()?;
    let mut out = Vec::new();
    for p in arr.iter().filter(|p| p.is_object()) {
        if let Some(l) = truthy_str(p.get("literal")) {
            out.push(format!("{{{}}}", escape(&l)));
            continue;
        }
        let mut family = truthy_str(p.get("family")).unwrap_or_default();
        let particle = truthy_str(p.get("non-dropping-particle")).unwrap_or_default();
        if !particle.is_empty() && !family.is_empty() {
            family = format!("{particle} {family}");
        }
        let given = truthy_str(p.get("given")).unwrap_or_default();
        if !family.is_empty() && !given.is_empty() {
            out.push(format!("{}, {}", escape(&family), escape(&given)));
        } else if !family.is_empty() || !given.is_empty() {
            let one = if family.is_empty() { &given } else { &family };
            out.push(format!("{{{}}}", escape(one)));
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out.join(" and "))
    }
}

/// Converts one CSL-JSON item into a BibTeX entry; `key` defaults to [`bibtex_key`].
pub fn csl_to_bibtex(item: &Value, key: Option<&str>) -> String {
    let csl_type = item.get("type").and_then(Value::as_str).unwrap_or("");
    let entry = BIBTEX_TYPES
        .iter()
        .find(|(c, _)| *c == csl_type)
        .map(|(_, b)| *b)
        .unwrap_or("misc");
    let mut fields: Vec<(&str, String)> = Vec::new();
    if let Some(a) = names(item.get("author")) {
        fields.push(("author", a));
    }
    if let Some(e) = names(item.get("editor")) {
        fields.push(("editor", e));
    }
    if let Some(t) = item.get("title").and_then(value_text) {
        fields.push(("title", protect_title(&t)));
    }
    if let Some(y) = year_of(item) {
        fields.push(("year", y));
    }
    if let Some(c) = item.get("container-title").and_then(value_text) {
        let field = if entry == "article" {
            "journal"
        } else {
            "booktitle"
        };
        fields.push((field, protect_title(&c)));
    }
    for (csl, bib) in SIMPLE_FIELDS {
        if let Some(v) = item.get(*csl).and_then(value_text) {
            fields.push((bib, escape(&v)));
        }
    }
    let k = key.map(str::to_string).unwrap_or_else(|| bibtex_key(item));
    let body: Vec<String> = fields
        .iter()
        .map(|(n, v)| format!("  {n} = {{{v}}}"))
        .collect();
    format!("@{entry}{{{k},\n{}\n}}\n", body.join(",\n"))
}

fn suffix(n: usize) -> String {
    let mut letters = Vec::new();
    let mut n = n + 1;
    while n > 0 {
        let r = (n - 1) % 26;
        n = (n - 1) / 26;
        letters.push((b'a' + r as u8) as char);
    }
    letters.iter().rev().collect()
}

/// Keys of several items, disambiguated with `a`, `b`, `c`… when they collide.
pub fn bibtex_keys(items: &[Value]) -> Vec<String> {
    let bases: Vec<String> = items.iter().map(bibtex_key).collect();
    let mut counts = std::collections::HashMap::new();
    for b in &bases {
        *counts.entry(b.clone()).or_insert(0usize) += 1;
    }
    let mut seen = std::collections::HashMap::new();
    bases
        .into_iter()
        .map(|b| {
            if counts[&b] == 1 {
                return b;
            }
            let n = seen.entry(b.clone()).or_insert(0usize);
            let k = format!("{b}{}", suffix(*n));
            *n += 1;
            k
        })
        .collect()
}

fn csl_item_raw(doc: &Document) -> Value {
    let mut m = match &doc.metadata {
        Value::Object(m) => m.clone(),
        _ => Map::new(),
    };
    m.remove("spdf");
    Value::Object(m)
}

/// The CSL-JSON item of a document (`spdf` member removed, `id` = BibTeX key).
pub fn csl_item(doc: &Document) -> Value {
    csl_json_many(std::slice::from_ref(doc))
        .as_array()
        .and_then(|a| a.first().cloned())
        .unwrap_or(Value::Null)
}

/// CSL-JSON for a document: an array with one item.
pub fn csl_json(doc: &Document) -> Value {
    csl_json_many(std::slice::from_ref(doc))
}

/// CSL-JSON array for several documents (keys disambiguated).
pub fn csl_json_many(docs: &[Document]) -> Value {
    let mut items: Vec<Value> = docs.iter().map(csl_item_raw).collect();
    let keys = bibtex_keys(&items);
    for (it, k) in items.iter_mut().zip(keys) {
        if let Value::Object(m) = it {
            m.insert("id".into(), Value::from(k));
        }
    }
    Value::Array(items)
}

/// The CSL-JSON export of several documents (SPEC §19.2). With an anchor and
/// exactly one document, the item also carries the CSL `label` and
/// `locator` of the passage.
pub fn export_csl(docs: &[Document], anchor: Option<&Value>, end: Option<&Value>) -> Value {
    let mut v = csl_json_many(docs);
    if let (Some(a), Some(arr)) = (anchor, v.as_array_mut()) {
        if arr.len() == 1 {
            if let (Some((label, locator)), Value::Object(m)) =
                (csl_locator_value(a, end), &mut arr[0])
            {
                m.insert("label".into(), Value::from(label));
                m.insert("locator".into(), Value::from(locator));
            }
        }
    }
    v
}

/// BibTeX entry of a document.
pub fn bibtex(doc: &Document) -> String {
    bibtex_many(std::slice::from_ref(doc))
}

/// BibTeX entries of several documents (keys disambiguated), separated by a blank line.
pub fn bibtex_many(docs: &[Document]) -> String {
    let items: Vec<Value> = docs.iter().map(csl_item_raw).collect();
    let keys = bibtex_keys(&items);
    items
        .iter()
        .zip(keys)
        .map(|(it, k)| csl_to_bibtex(it, Some(&k)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn folio(a: &Value) -> Option<String> {
    let p = match a.get("printed")? {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return None,
    };
    Some(
        if a.get("source").and_then(Value::as_str) == Some("inferred") {
            format!("[{p}]")
        } else {
            p
        },
    )
}

fn num_text(v: &Value) -> String {
    match v {
        Value::Number(n) => n
            .as_i64()
            .map(|i| i.to_string())
            .unwrap_or_else(|| crate::canon::format_number(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn range_text(from: &Value, to: Option<&Value>) -> String {
    match to {
        Some(to) if to != from => format!("{}-{}", num_text(from), num_text(to)),
        _ => num_text(from),
    }
}

/// The CSL `(label, locator)` of an anchor given as JSON (`("page", "145-146")`).
pub fn csl_locator_value(a: &Value, end: Option<&Value>) -> Option<(String, String)> {
    let t = a.get("type").and_then(Value::as_str)?;
    let printed = a.get("printed").map(|p| !p.is_null()).unwrap_or(false);
    if t == "page" || (matches!(t, "section" | "web") && printed) {
        let start = folio(a)?;
        let mut label = "page";
        if t == "page" {
            label = match a.get("foliation").and_then(Value::as_str).unwrap_or("page") {
                "leaf" => "folio",
                "column" => "column",
                _ => "page",
            };
        }
        if let Some(e) = end {
            let ep = e.get("printed").filter(|p| !p.is_null());
            if e.get("type").and_then(Value::as_str) == Some(t)
                && ep.is_some()
                && ep != a.get("printed")
            {
                return Some((
                    label.into(),
                    format!("{start}-{}", folio(e).unwrap_or_default()),
                ));
            }
        }
        return Some((label.into(), start));
    }
    match t {
        "time" => {
            let t0 = a.get("t0")?.as_f64()?;
            let mut loc = format_time(t0);
            if let Some(e) = end.filter(|e| e.get("type").and_then(Value::as_str) == Some("time")) {
                if let Some(t1) = e.get("t1").and_then(Value::as_f64) {
                    loc.push('-');
                    loc.push_str(&format_time(t1));
                }
            }
            Some(("timestamp".into(), loc))
        }
        "section" | "web" => {
            if let Some(p) = a.get("paragraph").filter(|p| !p.is_null()) {
                return Some(("paragraph".into(), num_text(p)));
            }
            let last = a.get("path")?.as_array()?.last()?;
            Some(("section".into(), last.as_str().unwrap_or("").to_string()))
        }
        "verse" => {
            let lf = a.get("line_from").filter(|v| !v.is_null())?;
            let lt = a.get("line_to").filter(|v| !v.is_null());
            Some(("verse".into(), range_text(lf, lt)))
        }
        "canonical" => Some((
            "section".into(),
            num_text(a.get("ref").filter(|v| !v.is_null())?),
        )),
        "sheet" => {
            let rf = a.get("row_from").filter(|v| !v.is_null())?;
            let rt = a.get("row_to").filter(|v| !v.is_null());
            Some(("line".into(), range_text(rf, rt)))
        }
        _ => None,
    }
}

/// The CSL `(label, locator)` of a typed anchor.
pub fn csl_locator(anchor: &Anchor, end: Option<&Anchor>) -> Option<(String, String)> {
    let e = end.map(Anchor::to_value);
    csl_locator_value(&anchor.to_value(), e.as_ref())
}

/// CSL-JSON item of the document plus `locator` and `label` for an anchor,
/// ready for a CSL processor.
pub fn csl_citation_item(doc: &Document, anchor: Option<&Anchor>, end: Option<&Anchor>) -> Value {
    let mut item = csl_item(doc);
    if let (Some(a), Value::Object(m)) = (anchor, &mut item) {
        if let Some((label, locator)) = csl_locator(a, end) {
            m.insert("label".into(), Value::from(label));
            m.insert("locator".into(), Value::from(locator));
        }
    }
    item
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keys_and_escapes() {
        assert_eq!(
            bibtex_key(
                &json!({"author":[{"family":"Cervantes Saavedra"}],"issued":{"date-parts":[[1605]]}})
            ),
            "cervantessaavedra1605"
        );
        assert_eq!(
            bibtex_key(&json!({"title":"Lazarillo de Tormes","issued":{"date-parts":[["1554"]]}})),
            "lazarillo1554"
        );
        assert_eq!(
            bibtex_key(&json!({"author":[{"family":"Hooke"}]})),
            "hookend"
        );
        assert_eq!(
            bibtex_key(&json!({"author":[{"family":"Núñez"}]})),
            "nuneznd"
        );
        let items = vec![
            json!({"author":[{"family":"A"}]}),
            json!({"author":[{"family":"A"}]}),
            json!({"author":[{"family":"B"}]}),
        ];
        assert_eq!(bibtex_keys(&items), vec!["anda", "andb", "bnd"]);
        let b = csl_to_bibtex(
            &json!({"type":"chapter","title":"De {x} y \\ z","container-title":"Obras","page":"1-2"}),
            Some("k"),
        );
        assert_eq!(
            b,
            "@incollection{k,\n  title = {{De} \\{x\\} y \\textbackslash{} z},\n  booktitle = {{Obras}},\n  pages = {1-2}\n}\n"
        );
        assert_eq!(suffix(0), "a");
        assert_eq!(suffix(26), "aa");
    }

    #[test]
    fn locators() {
        let p = json!({"type":"page","physical":3,"printed":"21","source":"inferred"});
        let e = json!({"type":"page","physical":4,"printed":"22"});
        assert_eq!(
            csl_locator_value(&p, Some(&e)),
            Some(("page".into(), "[21]-22".into()))
        );
        let t = json!({"type":"time","t0":4160.0,"t1":4170.0});
        assert_eq!(
            csl_locator_value(&t, None),
            Some(("timestamp".into(), "1:09:20".into()))
        );
        assert_eq!(
            csl_locator_value(&json!({"type":"slide","n":3}), None),
            None
        );
    }
}
