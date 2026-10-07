//! Text helpers: NFC, code-point offsets and the reference query normalization.
//!
//! SPDF offsets (`chars` in anchors) count **Unicode code points over NFC
//! text**, end exclusive. These helpers convert between code points, UTF-8
//! byte offsets (Rust, C) and UTF-16 code units (JavaScript, Swift, Java, C#).
//!
//! ```
//! use spdf::text;
//! let s = "año 🙂 終";
//! assert_eq!(text::cp_len(s), 7);
//! assert_eq!(text::cp_slice(s, 4, 5), Some("🙂"));
//! assert_eq!(text::cp_to_utf16(s, 5), Some(6));
//! ```

use unicode_general_category::{get_general_category, GeneralCategory as G};
use unicode_normalization::{is_nfc, UnicodeNormalization};

/// Returns the NFC form of `s`.
pub fn nfc(s: &str) -> String {
    if is_nfc(s) {
        s.to_string()
    } else {
        s.nfc().collect()
    }
}

/// True if `s` is already in NFC.
pub fn is_nfc_str(s: &str) -> bool {
    is_nfc(s)
}

/// Length of `s` in code points.
pub fn cp_len(s: &str) -> usize {
    s.chars().count()
}

/// UTF-8 byte offset of code point `cp`, or `None` if out of range
/// (`cp == cp_len(s)` maps to `s.len()`).
pub fn cp_to_byte(s: &str, cp: usize) -> Option<usize> {
    if cp == 0 {
        return Some(0);
    }
    let mut count = 0;
    for (i, _) in s.char_indices() {
        if count == cp {
            return Some(i);
        }
        count += 1;
    }
    if count == cp {
        Some(s.len())
    } else {
        None
    }
}

/// Code-point offset of UTF-8 byte offset `byte`, or `None` if it is not a
/// character boundary or is out of range.
pub fn byte_to_cp(s: &str, byte: usize) -> Option<usize> {
    if byte > s.len() || !s.is_char_boundary(byte) {
        return None;
    }
    Some(s[..byte].chars().count())
}

/// UTF-16 offset of code point `cp`.
pub fn cp_to_utf16(s: &str, cp: usize) -> Option<usize> {
    let b = cp_to_byte(s, cp)?;
    Some(s[..b].chars().map(char::len_utf16).sum())
}

/// Code-point offset of UTF-16 offset `u`, or `None` if it falls inside a
/// surrogate pair or out of range.
pub fn utf16_to_cp(s: &str, u: usize) -> Option<usize> {
    let mut acc = 0;
    for (n, c) in s.chars().enumerate() {
        if acc == u {
            return Some(n);
        }
        acc += c.len_utf16();
        if acc > u {
            return None;
        }
    }
    if acc == u {
        Some(cp_len(s))
    } else {
        None
    }
}

/// Slice of `s` between code points `start` (inclusive) and `end` (exclusive).
pub fn cp_slice(s: &str, start: usize, end: usize) -> Option<&str> {
    if start > end {
        return None;
    }
    let a = cp_to_byte(s, start)?;
    let b = cp_to_byte(s, end)?;
    Some(&s[a..b])
}

/// True for characters of general category M (Mn, Mc, Me).
pub fn is_mark(c: char) -> bool {
    matches!(
        get_general_category(c),
        G::NonspacingMark | G::SpacingMark | G::EnclosingMark
    )
}

/// True for letters (L*) and numbers (N*).
pub fn is_letter_or_digit(c: char) -> bool {
    matches!(
        get_general_category(c),
        G::UppercaseLetter
            | G::LowercaseLetter
            | G::TitlecaseLetter
            | G::ModifierLetter
            | G::OtherLetter
            | G::DecimalNumber
            | G::LetterNumber
            | G::OtherNumber
    )
}

/// Reference query normalization (§6): NFKD, drop marks (category M), full
/// Unicode case folding.
///
/// ```
/// assert_eq!(spdf::text::normalize_query("Canción STRAẞE"), "cancion strasse");
/// ```
pub fn normalize_query(q: &str) -> String {
    let stripped: String = q.nfkd().filter(|c| !is_mark(*c)).collect();
    caseless::default_case_fold_str(&stripped)
}

fn fts_string(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Builds the reference FTS5 `MATCH` expression for a user query (§6), or
/// `None` if the query has nothing to search for.
///
/// Quoted phrases stay phrases and, when present, are used alone, joined with
/// `AND`; otherwise every letter/digit run becomes a quoted term and terms are
/// joined with `OR`. An unmatched quote is treated as a separator.
///
/// ```
/// use spdf::text::fts_query;
/// assert_eq!(fts_query("El Panóptico, vigilar").as_deref(), Some(r#""el" OR "panoptico" OR "vigilar""#));
/// assert_eq!(fts_query(r#"vigilar "la sociedad disciplinaria""#).as_deref(), Some(r#""la sociedad disciplinaria""#));
/// assert_eq!(fts_query(" ,; "), None);
/// ```
pub fn fts_query(q: &str) -> Option<String> {
    let norm = normalize_query(q);
    let mut phrases = Vec::new();
    let mut rest = String::new();
    let mut chunks = norm.split('"').peekable();
    let mut inside = false;
    while let Some(chunk) = chunks.next() {
        let closed = chunks.peek().is_some();
        if inside && closed {
            let words: Vec<&str> = chunk
                .split(|c: char| !is_letter_or_digit(c))
                .filter(|w| !w.is_empty())
                .collect();
            if !words.is_empty() {
                phrases.push(words.join(" "));
            }
        } else {
            rest.push(' ');
            rest.push_str(chunk);
        }
        inside = !inside;
    }
    if !phrases.is_empty() {
        let parts: Vec<String> = phrases.iter().map(|p| fts_string(p)).collect();
        return Some(parts.join(" AND "));
    }
    let terms: Vec<String> = rest
        .split(|c: char| !is_letter_or_digit(c))
        .filter(|w| !w.is_empty())
        .map(fts_string)
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" OR "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offsets_with_emoji_combining_cjk() {
        let s = "e\u{301}👩‍👩‍👧漢字";
        assert_eq!(cp_len(s), 9);
        assert_eq!(cp_slice(s, 0, 2), Some("e\u{301}"));
        assert_eq!(cp_slice(s, 7, 9), Some("漢字"));
        assert_eq!(cp_to_utf16(s, 9), Some(2 + 8 + 2));
        assert_eq!(utf16_to_cp(s, 3), None); // inside a surrogate pair
        assert_eq!(nfc("e\u{301}"), "é");
        assert_eq!(cp_slice(s, 3, 2), None);
        assert_eq!(cp_to_byte(s, 10), None);
    }

    #[test]
    fn query_normalization() {
        assert_eq!(normalize_query("ÁRBOL"), "arbol");
        assert_eq!(normalize_query("ﬁn"), "fin");
        assert_eq!(fts_query("\"unclosed phrase"), Some("\"unclosed\" OR \"phrase\"".into()));
        assert_eq!(fts_query("a \"b c\" d \"e\""), Some("\"b c\" AND \"e\"".into()));
        assert_eq!(fts_query("漢字"), Some("\"漢字\"".into()));
    }
}
