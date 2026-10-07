//! Short author-date citation (contract §10).
//!
//! ```
//! use serde_json::json;
//! use spdf::{cite::cite_metadata, Anchor, Locale};
//! let md = json!({"type":"book","title":"Vigilar y castigar","author":[{"family":"Foucault","given":"Michel"}],
//!                 "issued":{"date-parts":[[1975]]}});
//! let a = Anchor::from_value(&json!({"type":"page","physical":150,"printed":"145"})).unwrap();
//! assert_eq!(cite_metadata(&a, None, &md, Locale::Es), "(Foucault, 1975, p. 145)");
//! ```

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::anchor::Anchor;
use crate::model::Document;

/// Citation language.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    /// Spanish.
    Es,
    /// English (also the fallback for other languages).
    #[default]
    En,
}

impl Locale {
    /// BCP 47 tag → locale: `es`, `es-ES`… → Spanish; anything else → English.
    pub fn parse(s: &str) -> Self {
        let primary = s.split(['-', '_']).next().unwrap_or("");
        if primary.eq_ignore_ascii_case("es") {
            Locale::Es
        } else {
            Locale::En
        }
    }
}

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

fn truthy_str<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    s(v, k).filter(|x| !x.is_empty())
}

fn person_name(p: &Value) -> String {
    if let Some(l) = truthy_str(p, "literal") {
        return l.to_string();
    }
    if let Some(f) = truthy_str(p, "family") {
        return match truthy_str(p, "non-dropping-particle") {
            Some(np) => format!("{np} {f}"),
            None => f.to_string(),
        };
    }
    s(p, "given").unwrap_or("").to_string()
}

/// True if a Spanish word starts with the sound /i/ (`i`, `í`, `hi`, `hí`
/// not followed by a vowel), which turns `y` into `e`.
pub fn starts_with_i_sound(word: &str) -> bool {
    let lower: Vec<char> = word.to_lowercase().chars().collect();
    let rest = match lower.as_slice() {
        ['h', 'i' | 'í', rest @ ..] => rest,
        ['i' | 'í', rest @ ..] => rest,
        _ => return false,
    };
    !matches!(
        rest.first(),
        Some('a' | 'e' | 'i' | 'o' | 'u' | 'á' | 'é' | 'í' | 'ó' | 'ú' | 'ü')
    )
}

fn short_title(md: &Value) -> String {
    if let Some(t) = truthy_str(md, "title-short") {
        return t.to_string();
    }
    s(md, "title")
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

fn names(md: &Value, es: bool) -> String {
    let authors: Vec<String> = md
        .get("author")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(person_name)
                .filter(|n| !n.is_empty())
                .collect()
        })
        .unwrap_or_default();
    match authors.len() {
        0 => short_title(md),
        1 => authors[0].clone(),
        2 => {
            let conj = if !es {
                "and"
            } else if starts_with_i_sound(&authors[1]) {
                "e"
            } else {
                "y"
            };
            format!("{} {conj} {}", authors[0], authors[1])
        }
        _ => format!("{} et al.", authors[0]),
    }
}

fn year(md: &Value, es: bool) -> String {
    let y = md
        .get("issued")
        .and_then(|i| i.get("date-parts"))
        .and_then(|dp| dp.get(0))
        .and_then(|p| p.get(0))
        .and_then(|y| match y {
            Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f.trunc() as i64)),
            Value::String(s) => s.trim().parse().ok(),
            _ => None,
        });
    match y {
        Some(y) if y > 0 => y.to_string(),
        Some(y) => {
            if es {
                format!("{} a. C.", -y)
            } else {
                format!("{} BC", -y)
            }
        }
        None => if es { "s. f." } else { "n.d." }.to_string(),
    }
}

/// `m:ss` under an hour, `h:mm:ss` from one hour, floor seconds.
pub fn format_time(seconds: f64) -> String {
    let s = if seconds.is_finite() && seconds > 0.0 {
        seconds.floor() as u64
    } else {
        0
    };
    let (h, m, x) = (s / 3600, (s % 3600) / 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{x:02}")
    } else {
        format!("{m}:{x:02}")
    }
}

fn printed_label(a: &Value) -> Option<String> {
    let p = match a.get("printed") {
        Some(Value::String(p)) => p.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => return None,
    };
    Some(if s(a, "source") == Some("inferred") {
        format!("[{p}]")
    } else {
        p
    })
}

/// Page locator (SPEC §18): an end without a printed folio never takes part
/// in a range; `s. p.` / `n. pag.` only when neither end has a folio.
fn page_locator(
    anchor: &Value,
    end: Option<&Value>,
    es: bool,
    single: &str,
    plural: &str,
) -> String {
    let mut ends = vec![anchor];
    if let Some(e) = end.filter(|e| e.get("type") == anchor.get("type")) {
        ends.push(e);
    }
    let with_folio: Vec<&Value> = ends
        .into_iter()
        .filter(|x| x.get("printed").map(|p| !p.is_null()).unwrap_or(false))
        .collect();
    let (Some(first), Some(last)) = (with_folio.first(), with_folio.last()) else {
        return if es { "s. p." } else { "n. pag." }.to_string();
    };
    let a = printed_label(first).unwrap_or_default();
    if with_folio.len() > 1 && last.get("printed") != first.get("printed") {
        return format!("{plural} {a}-{}", printed_label(last).unwrap_or_default());
    }
    format!("{single} {a}")
}

fn num_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::Number(n)) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => crate::canon::format_number(n.as_f64().unwrap_or(0.0)),
        },
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    }
}

/// The locator of an anchor given as JSON (`p. 145`, `1:09:20`, `diap. 3`…),
/// or `None` (images, empty sections).
pub fn locator_value(anchor: &Value, end: Option<&Value>, locale: Locale) -> Option<String> {
    let es = locale == Locale::Es;
    let t = s(anchor, "type")?;
    match t {
        "page" => {
            let (single, plural) = match s(anchor, "foliation").unwrap_or("page") {
                "leaf" => ("fol.", "fols."),
                "column" => ("col.", "cols."),
                _ => ("p.", "pp."),
            };
            Some(page_locator(anchor, end, es, single, plural))
        }
        "time" => {
            let t0 = anchor.get("t0").and_then(Value::as_f64).unwrap_or(0.0);
            let mut out = format_time(t0);
            if let Some(e) = end.filter(|e| s(e, "type") == Some("time")) {
                let t1 = e
                    .get("t1")
                    .and_then(Value::as_f64)
                    .or_else(|| e.get("t0").and_then(Value::as_f64))
                    .unwrap_or(0.0);
                out.push('-');
                out.push_str(&format_time(t1));
            }
            Some(out)
        }
        "section" | "web" => {
            if anchor.get("printed").map(|p| !p.is_null()).unwrap_or(false) {
                return Some(page_locator(anchor, end, es, "p.", "pp."));
            }
            let mut parts = Vec::new();
            if let Some(last) = anchor
                .get("path")
                .and_then(Value::as_array)
                .and_then(|p| p.last())
            {
                parts.push(format!("§ {}", last.as_str().unwrap_or("")));
            }
            if let Some(p) = anchor.get("paragraph").filter(|v| !v.is_null()) {
                parts.push(format!(
                    "{} {}",
                    if es { "párr." } else { "para." },
                    num_text(Some(p))
                ));
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(", "))
            }
        }
        "slide" => Some(format!(
            "{} {}",
            if es { "diap." } else { "slide" },
            num_text(anchor.get("n"))
        )),
        "sheet" => {
            let sheet = s(anchor, "sheet").unwrap_or("");
            let a = num_text(anchor.get("row_from"));
            let b = num_text(anchor.get("row_to"));
            Some(if a == b {
                format!("{sheet}, {} {a}", if es { "fila" } else { "row" })
            } else {
                format!("{sheet}, {} {a}-{b}", if es { "filas" } else { "rows" })
            })
        }
        "verse" => {
            let a = num_text(anchor.get("line_from"));
            match anchor.get("line_to").filter(|v| !v.is_null()) {
                Some(b) if num_text(Some(b)) != a => Some(format!("vv. {a}-{}", num_text(Some(b)))),
                _ => Some(format!("v. {a}")),
            }
        }
        "canonical" => Some(s(anchor, "ref").unwrap_or("").to_string()),
        _ => None,
    }
}

/// The locator part of a citation for a typed anchor.
pub fn locator(anchor: &Anchor, end: Option<&Anchor>, locale: Locale) -> Option<String> {
    let e = end.map(Anchor::to_value);
    locator_value(&anchor.to_value(), e.as_ref(), locale)
}

/// Short citation from CSL metadata and anchors given as JSON.
pub fn cite_value(anchor: &Value, end: Option<&Value>, metadata: &Value, locale: Locale) -> String {
    let es = locale == Locale::Es;
    let mut parts = vec![names(metadata, es), year(metadata, es)];
    if let Some(l) = locator_value(anchor, end.filter(|e| !e.is_null()), locale) {
        parts.push(l);
    }
    format!("({})", parts.join(", "))
}

/// Short citation from CSL metadata: `(Names, Year[, locator])`.
pub fn cite_metadata(
    anchor: &Anchor,
    end: Option<&Anchor>,
    metadata: &Value,
    locale: Locale,
) -> String {
    let e = end.map(Anchor::to_value);
    cite_value(&anchor.to_value(), e.as_ref(), metadata, locale)
}

/// Short citation of `anchor` in `document`.
pub fn cite(anchor: &Anchor, document: &Document, locale: Locale) -> String {
    cite_metadata(anchor, None, &document.metadata, locale)
}

/// Short citation of a range (`anchor` to `end`) in `document`.
pub fn cite_range(
    anchor: &Anchor,
    end: Option<&Anchor>,
    document: &Document,
    locale: Locale,
) -> String {
    cite_metadata(anchor, end, &document.metadata, locale)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn a(v: Value) -> Anchor {
        Anchor::from_value(&v).unwrap()
    }

    #[test]
    fn contract_examples() {
        let md2 = json!({"title":"X","author":[{"family":"Ramos"},{"family":"Iglesias"}],"issued":{"date-parts":[[2001]]}});
        let p = a(json!({"type":"page","physical":3,"printed":"xiv","roman":true}));
        assert_eq!(
            cite_metadata(&p, None, &md2, Locale::Es),
            "(Ramos e Iglesias, 2001, p. xiv)"
        );
        assert_eq!(
            cite_metadata(&p, None, &md2, Locale::En),
            "(Ramos and Iglesias, 2001, p. xiv)"
        );
        let md3 = json!({"title":"Obra: subtítulo","author":[{"family":"A"},{"family":"B"},{"literal":"C"}]});
        let t = a(json!({"type":"time","t0":4160.4,"t1":4175.5}));
        assert_eq!(
            cite_metadata(&t, None, &md3, Locale::Es),
            "(A et al., s. f., 1:09:20)"
        );
        let md0 = json!({"title":"Obra: subtítulo","issued":{"date-parts":[[-350]]}});
        let i = a(json!({"type":"page","physical":21,"printed":"21","source":"inferred"}));
        let ie = a(json!({"type":"page","physical":22,"printed":"22","source":"inferred"}));
        assert_eq!(
            cite_metadata(&i, Some(&ie), &md0, Locale::En),
            "(Obra, 350 BC, pp. [21]-[22])"
        );
        let leaf = a(json!({"type":"page","physical":5,"printed":"1r","foliation":"leaf"}));
        assert_eq!(locator(&leaf, None, Locale::Es).unwrap(), "fol. 1r");
        let none = a(json!({"type":"page","physical":5,"printed":null}));
        assert_eq!(locator(&none, None, Locale::Es).unwrap(), "s. p.");
        assert_eq!(locator(&none, None, Locale::En).unwrap(), "n. pag.");
        let sec = a(json!({"type":"section","path":["Cap. 3","3.2 El panóptico"],"paragraph":4}));
        assert_eq!(
            locator(&sec, None, Locale::Es).unwrap(),
            "§ 3.2 El panóptico, párr. 4"
        );
        let t0 = a(json!({"type":"time","t0":42.9,"t1":50.0}));
        let t1 = a(json!({"type":"time","t0":60.0,"t1":65.2}));
        assert_eq!(locator(&t0, Some(&t1), Locale::En).unwrap(), "0:42-1:05");
        assert_eq!(
            locator(
                &a(json!({"type":"verse","line_from":1234,"line_to":1240})),
                None,
                Locale::Es
            )
            .unwrap(),
            "vv. 1234-1240"
        );
        assert_eq!(
            locator(&a(json!({"type":"slide","n":3})), None, Locale::En).unwrap(),
            "slide 3"
        );
        assert_eq!(
            locator(
                &a(json!({"type":"sheet","sheet":"Data","row_from":4,"row_to":9})),
                None,
                Locale::Es
            )
            .unwrap(),
            "Data, filas 4-9"
        );
        assert!(starts_with_i_sound("Hidalgo"));
        assert!(!starts_with_i_sound("Hierro"));
        assert!(!starts_with_i_sound("Yuste"));
        assert_eq!(Locale::parse("es-ES"), Locale::Es);
        assert_eq!(Locale::parse("est"), Locale::En);
    }
}
