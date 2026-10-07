//! Bibliography export: CSL-JSON and BibTeX (contract §10).
//!
//! ```
//! use serde_json::json;
//! let md = json!({"type":"book","title":"Vigilar y castigar","author":[{"family":"Foucault","given":"Michel"}],
//!                 "issued":{"date-parts":[[1975]]},"publisher":"Siglo XXI","publisher-place":"México"});
//! let bib = spdf::export::bibtex_from_metadata("doc-1", &md);
//! assert!(bib.starts_with("@book{foucault1975vigilar,"));
//! assert!(bib.contains("  author = {Foucault, Michel},"));
//! ```

use serde_json::{Map, Value};

use crate::model::Document;

/// The CSL-JSON item of a document: the metadata with `id` set (if absent)
/// and the `spdf` extension object removed.
pub fn csl_item(doc: &Document) -> Value {
    let mut m = match &doc.metadata {
        Value::Object(m) => m.clone(),
        _ => Map::new(),
    };
    m.remove("spdf");
    m.entry("id").or_insert_with(|| Value::from(doc.id.clone()));
    Value::Object(m)
}

/// CSL-JSON for a document: an array with one item, ready for citeproc,
/// Zotero or Pandoc.
pub fn csl_json(doc: &Document) -> Value {
    Value::Array(vec![csl_item(doc)])
}

fn bib_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' | '%' | '$' | '#' | '_' => {
                out.push('\\');
                out.push(c);
            }
            '{' => out.push_str("\\{"),
            '}' => out.push_str("\\}"),
            '\\' => out.push_str("\\textbackslash{}"),
            '~' => out.push_str("\\textasciitilde{}"),
            '^' => out.push_str("\\textasciicircum{}"),
            '\n' | '\r' => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

fn bib_people(v: Option<&Value>) -> Option<String> {
    let arr = v?.as_array()?;
    let names: Vec<String> = arr
        .iter()
        .filter_map(|p| {
            if let Some(l) = p.get("literal").and_then(Value::as_str) {
                return Some(format!("{{{}}}", bib_escape(l)));
            }
            let fam = p.get("family").and_then(Value::as_str).unwrap_or("").trim();
            let particle = p
                .get("non-dropping-particle")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            let given = p.get("given").and_then(Value::as_str).unwrap_or("").trim();
            let fam = if particle.is_empty() {
                fam.to_string()
            } else {
                format!("{particle} {fam}")
            };
            match (fam.is_empty(), given.is_empty()) {
                (true, true) => None,
                (false, true) => Some(bib_escape(&fam)),
                (true, false) => Some(bib_escape(given)),
                (false, false) => Some(format!("{}, {}", bib_escape(&fam), bib_escape(given))),
            }
        })
        .collect();
    if names.is_empty() {
        None
    } else {
        Some(names.join(" and "))
    }
}

fn ascii_key(s: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    s.nfkd()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn entry_type(csl_type: &str) -> &'static str {
    match csl_type {
        "book" => "book",
        "article-journal" | "article-magazine" | "article-newspaper" | "article" => "article",
        "chapter" | "entry-encyclopedia" | "entry-dictionary" => "incollection",
        "paper-conference" => "inproceedings",
        "thesis" => "phdthesis",
        "report" => "techreport",
        "manuscript" => "unpublished",
        _ => "misc",
    }
}

/// BibTeX entry from CSL metadata. `fallback_id` is used for the key when
/// there is no author/year/title material.
pub fn bibtex_from_metadata(fallback_id: &str, md: &Value) -> String {
    let get = |k: &str| {
        md.get(k)
            .and_then(|v| match v {
                Value::String(s) => Some(s.trim().to_string()),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
            .filter(|s| !s.is_empty())
    };
    let csl_type = get("type").unwrap_or_else(|| "document".into());
    let et = entry_type(&csl_type);
    let year = md
        .get("issued")
        .and_then(|i| i.get("date-parts"))
        .and_then(|d| d.get(0))
        .and_then(|p| p.get(0))
        .and_then(|y| y.as_i64().or_else(|| y.as_str().and_then(|s| s.parse().ok())));
    let first_family = md
        .get("author")
        .and_then(|a| a.get(0))
        .and_then(|p| p.get("family").or_else(|| p.get("literal")))
        .and_then(Value::as_str)
        .map(|s| ascii_key(s.split_whitespace().last().unwrap_or(s)))
        .unwrap_or_default();
    let first_word = get("title")
        .map(|t| {
            t.split_whitespace()
                .map(ascii_key)
                .find(|w| w.len() > 3)
                .unwrap_or_else(|| t.split_whitespace().next().map(ascii_key).unwrap_or_default())
        })
        .unwrap_or_default();
    let mut key = format!(
        "{first_family}{}{first_word}",
        year.map(|y| y.to_string()).unwrap_or_default()
    );
    if key.is_empty() {
        key = ascii_key(fallback_id);
    }
    if key.is_empty() {
        key = "spdf".into();
    }
    let mut fields: Vec<(&str, String)> = Vec::new();
    if let Some(a) = bib_people(md.get("author")) {
        fields.push(("author", a));
    }
    if let Some(e) = bib_people(md.get("editor")) {
        fields.push(("editor", e));
    }
    if let Some(t) = bib_people(md.get("translator")) {
        fields.push(("translator", t));
    }
    if let Some(t) = get("title") {
        fields.push(("title", bib_escape(&t)));
    }
    if let Some(c) = get("container-title") {
        let k = if et == "article" { "journal" } else { "booktitle" };
        fields.push((k, bib_escape(&c)));
    }
    if let Some(y) = year {
        fields.push(("year", y.to_string()));
    }
    let simple: &[(&str, &str)] = &[
        ("publisher", if et == "techreport" { "institution" } else if et == "phdthesis" { "school" } else { "publisher" }),
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
    ];
    for (csl, bib) in simple {
        if let Some(v) = get(csl) {
            let v = if *csl == "page" { v.replace('-', "--") } else { v };
            let v = if matches!(*csl, "URL" | "DOI") { v } else { bib_escape(&v) };
            fields.push((bib, v));
        }
    }
    let mut out = format!("@{et}{{{key},\n");
    for (i, (k, v)) in fields.iter().enumerate() {
        out.push_str(&format!("  {k} = {{{v}}}"));
        out.push_str(if i + 1 < fields.len() { ",\n" } else { "\n" });
    }
    out.push_str("}\n");
    out
}

/// BibTeX entry for a document.
pub fn bibtex(doc: &Document) -> String {
    bibtex_from_metadata(&doc.id, &doc.metadata)
}
