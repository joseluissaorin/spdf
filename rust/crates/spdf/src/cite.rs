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

use crate::anchor::{Anchor, AnchorKind};
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
    /// `es*` → Spanish, anything else → English.
    pub fn parse(s: &str) -> Self {
        if s.to_ascii_lowercase().starts_with("es") {
            Locale::Es
        } else {
            Locale::En
        }
    }
}

fn person_name(p: &Value) -> Option<String> {
    if let Some(l) = p.get("literal").and_then(Value::as_str) {
        if !l.trim().is_empty() {
            return Some(l.trim().to_string());
        }
    }
    if let Some(f) = p.get("family").and_then(Value::as_str) {
        if !f.trim().is_empty() {
            let particle = p
                .get("non-dropping-particle")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            return Some(match particle {
                Some(np) => format!("{np} {}", f.trim()),
                None => f.trim().to_string(),
            });
        }
    }
    p.get("given")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// True if a Spanish word starts with the sound /i/ (`i`, `í`, `hi`, `hí`
/// not followed by a vowel), which turns `y` into `e`.
fn starts_with_i_sound(word: &str) -> bool {
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

fn names(md: &Value, locale: Locale) -> String {
    let authors: Vec<String> = md
        .get("author")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(person_name).collect())
        .unwrap_or_default();
    match authors.len() {
        0 => {
            if let Some(s) = md.get("title-short").and_then(Value::as_str) {
                if !s.trim().is_empty() {
                    return s.trim().to_string();
                }
            }
            let t = md.get("title").and_then(Value::as_str).unwrap_or("");
            t.split(':').next().unwrap_or("").trim().to_string()
        }
        1 => authors[0].clone(),
        2 => match locale {
            Locale::Es => {
                let conj = if starts_with_i_sound(&authors[1]) { "e" } else { "y" };
                format!("{} {conj} {}", authors[0], authors[1])
            }
            Locale::En => format!("{} and {}", authors[0], authors[1]),
        },
        _ => format!("{} et al.", authors[0]),
    }
}

fn year(md: &Value, locale: Locale) -> String {
    let y = md
        .get("issued")
        .and_then(|i| i.get("date-parts"))
        .and_then(|dp| dp.get(0))
        .and_then(|p| p.get(0))
        .and_then(|y| match y {
            Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
            Value::String(s) => s.trim().parse().ok(),
            _ => None,
        });
    match y {
        Some(y) if y < 0 => match locale {
            Locale::Es => format!("{} a. C.", -y),
            Locale::En => format!("{} BC", -y),
        },
        Some(y) => y.to_string(),
        None => match locale {
            Locale::Es => "s. f.".to_string(),
            Locale::En => "n.d.".to_string(),
        },
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

fn folio(printed: &str, source: Option<&str>) -> String {
    if source == Some("inferred") {
        format!("[{printed}]")
    } else {
        printed.to_string()
    }
}

fn page_locator(
    printed: Option<&str>,
    source: Option<&str>,
    foliation: Option<&str>,
    end: Option<(Option<&str>, Option<&str>)>,
    locale: Locale,
) -> String {
    let Some(p) = printed else {
        return match locale {
            Locale::Es => "s. p.".into(),
            Locale::En => "n. pag.".into(),
        };
    };
    let (one, many) = match foliation {
        Some("leaf") => ("fol.", "fols."),
        Some("column") => ("col.", "cols."),
        _ => ("p.", "pp."),
    };
    let a = folio(p, source);
    if let Some((Some(ep), es)) = end {
        if ep != p {
            return format!("{many} {a}-{}", folio(ep, es));
        }
    }
    format!("{one} {a}")
}

/// The locator part of a citation (`p. 145`, `1:09:20`, `diap. 3`…), or
/// `None` for anchors without one (images).
pub fn locator(anchor: &Anchor, end: Option<&Anchor>, locale: Locale) -> Option<String> {
    let para = |n: u32| match locale {
        Locale::Es => format!("párr. {n}"),
        Locale::En => format!("para. {n}"),
    };
    Some(match &anchor.kind {
        AnchorKind::Page {
            printed,
            source,
            foliation,
            ..
        } => {
            let e = end.and_then(|e| match &e.kind {
                AnchorKind::Page {
                    printed, source, ..
                } => Some((printed.as_deref(), source.as_deref())),
                _ => None,
            });
            page_locator(printed.as_deref(), source.as_deref(), foliation.as_deref(), e, locale)
        }
        AnchorKind::Time { t0, .. } => {
            let mut s = format_time(*t0);
            if let Some(Anchor {
                kind: AnchorKind::Time { t0: e0, t1: e1, .. },
                ..
            }) = end
            {
                s.push('-');
                s.push_str(&format_time(e1.unwrap_or(*e0)));
            }
            s
        }
        AnchorKind::Section {
            path,
            paragraph,
            printed,
        } => section_locator(path, *paragraph, printed.as_deref(), end, locale, &para)?,
        AnchorKind::Web {
            path, paragraph, ..
        } => section_locator(path, *paragraph, None, end, locale, &para)?,
        AnchorKind::Slide { n } => match locale {
            Locale::Es => format!("diap. {n}"),
            Locale::En => format!("slide {n}"),
        },
        AnchorKind::Sheet {
            sheet,
            row_from,
            row_to,
        } => {
            let word = match locale {
                Locale::Es => "filas",
                Locale::En => "rows",
            };
            match (row_from, row_to) {
                (Some(a), Some(b)) => format!("{sheet}, {word} {a}-{b}"),
                (Some(a), None) => format!("{sheet}, {word} {a}-{a}"),
                _ => sheet.clone(),
            }
        }
        AnchorKind::Verse {
            line_from, line_to, ..
        } => match line_to {
            Some(b) if b != line_from => format!("vv. {line_from}-{b}"),
            _ => format!("v. {line_from}"),
        },
        AnchorKind::Canonical { reference, .. } => reference.clone(),
        AnchorKind::Image => return None,
    })
}

fn section_locator(
    path: &[String],
    paragraph: Option<u32>,
    printed: Option<&str>,
    end: Option<&Anchor>,
    locale: Locale,
    para: &dyn Fn(u32) -> String,
) -> Option<String> {
    if let Some(p) = printed {
        let e = end.and_then(|e| e.printed()).map(|ep| (Some(ep), None));
        return Some(page_locator(Some(p), None, None, e, locale));
    }
    let last = path.last().map(|s| s.trim()).filter(|s| !s.is_empty());
    match (last, paragraph) {
        (Some(l), Some(n)) => Some(format!("§ {l}, {}", para(n))),
        (Some(l), None) => Some(format!("§ {l}")),
        (None, Some(n)) => Some(para(n)),
        (None, None) => None,
    }
}

/// Short citation from CSL metadata: `(Names, Year[, locator])`.
pub fn cite_metadata(anchor: &Anchor, end: Option<&Anchor>, metadata: &Value, locale: Locale) -> String {
    let mut parts = vec![names(metadata, locale), year(metadata, locale)];
    if let Some(l) = locator(anchor, end, locale) {
        parts.push(l);
    }
    format!("({})", parts.join(", "))
}

/// Short citation of `anchor` in `document`.
pub fn cite(anchor: &Anchor, document: &Document, locale: Locale) -> String {
    cite_metadata(anchor, None, &document.metadata, locale)
}

/// Short citation of a range (`anchor` to `end`) in `document`.
pub fn cite_range(anchor: &Anchor, end: Option<&Anchor>, document: &Document, locale: Locale) -> String {
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
        assert_eq!(cite_metadata(&p, None, &md2, Locale::Es), "(Ramos e Iglesias, 2001, p. xiv)");
        assert_eq!(cite_metadata(&p, None, &md2, Locale::En), "(Ramos and Iglesias, 2001, p. xiv)");
        let md3 = json!({"title":"Obra: subtítulo","author":[{"family":"A"},{"family":"B"},{"literal":"C"}]});
        let t = a(json!({"type":"time","t0":4160.4,"t1":4175.5}));
        assert_eq!(cite_metadata(&t, None, &md3, Locale::Es), "(A et al., s. f., 1:09:20)");
        let md0 = json!({"title":"Obra: subtítulo","issued":{"date-parts":[[-350]]}});
        let i = a(json!({"type":"page","physical":21,"printed":"21","source":"inferred"}));
        let ie = a(json!({"type":"page","physical":22,"printed":"22","source":"inferred"}));
        assert_eq!(cite_metadata(&i, Some(&ie), &md0, Locale::En), "(Obra, 350 BC, pp. [21]-[22])");
        let leaf = a(json!({"type":"page","physical":5,"printed":"1r","foliation":"leaf"}));
        assert_eq!(locator(&leaf, None, Locale::Es).unwrap(), "fol. 1r");
        let none = a(json!({"type":"page","physical":5,"printed":null}));
        assert_eq!(locator(&none, None, Locale::Es).unwrap(), "s. p.");
        assert_eq!(locator(&none, None, Locale::En).unwrap(), "n. pag.");
        let sec = a(json!({"type":"section","path":["Cap. 3","3.2 El panóptico"],"paragraph":4}));
        assert_eq!(locator(&sec, None, Locale::Es).unwrap(), "§ 3.2 El panóptico, párr. 4");
        let t0 = a(json!({"type":"time","t0":42.9,"t1":50.0}));
        let t1 = a(json!({"type":"time","t0":60.0,"t1":65.2}));
        assert_eq!(locator(&t0, Some(&t1), Locale::En).unwrap(), "0:42-1:05");
        assert_eq!(locator(&a(json!({"type":"verse","line_from":1234,"line_to":1240})), None, Locale::Es).unwrap(), "vv. 1234-1240");
        assert_eq!(locator(&a(json!({"type":"slide","n":3})), None, Locale::En).unwrap(), "slide 3");
        assert_eq!(locator(&a(json!({"type":"sheet","sheet":"Data","row_from":4,"row_to":9})), None, Locale::Es).unwrap(), "Data, filas 4-9");
        assert!(starts_with_i_sound("Hidalgo"));
        assert!(!starts_with_i_sound("Hierro"));
        assert!(!starts_with_i_sound("Yuste"));
    }
}
