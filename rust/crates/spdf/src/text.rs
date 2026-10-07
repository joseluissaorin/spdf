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

/// Key used to deduplicate query terms: `lower(remove_Mn(NFD(term)))`.
pub fn dedup_key(term: &str) -> String {
    let stripped: String = term
        .nfd()
        .filter(|c| get_general_category(*c) != G::NonspacingMark)
        .collect();
    stripped.to_lowercase()
}

/// True for code points that send a query through the CJK route (§6.7).
pub fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x2E80..=0x2FDF
        | 0x3040..=0x30FF
        | 0x3100..=0x312F
        | 0x3130..=0x318F
        | 0x31A0..=0x31FF
        | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF
        | 0xA960..=0xA97F
        | 0xAC00..=0xD7AF
        | 0xF900..=0xFAFF
        | 0xFF66..=0xFF9F
        | 0x20000..=0x3FFFF)
}

/// True for characters of general category L, M or N (word characters of
/// the reference query parser).
pub fn is_word_char(c: char) -> bool {
    is_letter_or_digit(c) || is_mark(c)
}

fn words(s: &str) -> Vec<String> {
    s.split(|c: char| !is_word_char(c))
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// A user query parsed with the reference algorithm (§6).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedQuery {
    /// The terms, deduplicated, as written (NFC).
    pub terms: Vec<String>,
    /// True if the terms are quoted phrases (joined with `AND`).
    pub phrases: bool,
    /// True if the query contains CJK code points.
    pub cjk: bool,
}

impl ParsedQuery {
    /// Parses a query: NFC, phrases between `"…"`, `“…”`, `«…»`, `„…“`/`„…”`
    /// (an unmatched opening mark is a separator), words = runs of L/M/N; if
    /// there are phrases only the phrases count. Duplicates are removed by
    /// [`dedup_key`].
    ///
    /// ```
    /// use spdf::text::ParsedQuery;
    /// let q = ParsedQuery::parse("vigilar «la sociedad disciplinaria» y castigar");
    /// assert_eq!(q.terms, vec!["la sociedad disciplinaria"]);
    /// assert!(q.phrases);
    /// let q = ParsedQuery::parse("Panóptico panoptico, VIGILAR");
    /// assert_eq!(q.terms, vec!["Panóptico", "VIGILAR"]);
    /// ```
    pub fn parse(query: &str) -> Self {
        let q = nfc(query);
        let chars: Vec<char> = q.chars().collect();
        let mut loose = String::new();
        let mut phrases: Vec<String> = Vec::new();
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            let closers: &[char] = match c {
                '"' => &['"'],
                '\u{201C}' => &['\u{201D}'],
                '\u{00AB}' => &['\u{00BB}'],
                '\u{201E}' => &['\u{201C}', '\u{201D}'],
                _ => &[],
            };
            if !closers.is_empty() {
                if let Some(off) = chars[i + 1..].iter().position(|x| closers.contains(x)) {
                    let inner: String = chars[i + 1..i + 1 + off].iter().collect();
                    let w = words(&inner);
                    if !w.is_empty() {
                        phrases.push(w.join(" "));
                    }
                    i += off + 2;
                    continue;
                }
                loose.push(' ');
                i += 1;
                continue;
            }
            loose.push(c);
            i += 1;
        }
        let (raw, is_phrases) = if phrases.is_empty() {
            (words(&loose), false)
        } else {
            (phrases, true)
        };
        let mut seen = std::collections::HashSet::new();
        let terms = raw
            .into_iter()
            .filter(|t| seen.insert(dedup_key(t)))
            .collect();
        ParsedQuery {
            terms,
            phrases: is_phrases,
            cjk: q.chars().any(is_cjk),
        }
    }

    /// The FTS5 `MATCH` expression, or `None` if there are no terms.
    pub fn fts_match(&self) -> Option<String> {
        if self.terms.is_empty() {
            return None;
        }
        let parts: Vec<String> = self.terms.iter().map(|t| fts_string(t)).collect();
        Some(parts.join(if self.phrases { " AND " } else { " OR " }))
    }
}

/// Quotes a string as an FTS5 string literal.
pub fn fts_string(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Builds the reference FTS5 `MATCH` expression for a user query (§6), or
/// `None` if the query has nothing to search for.
///
/// ```
/// use spdf::text::fts_query;
/// assert_eq!(fts_query("El Panóptico, vigilar").as_deref(), Some(r#""El" OR "Panóptico" OR "vigilar""#));
/// assert_eq!(fts_query(r#"vigilar "la sociedad disciplinaria""#).as_deref(), Some(r#""la sociedad disciplinaria""#));
/// assert_eq!(fts_query(" ,; "), None);
/// ```
pub fn fts_query(q: &str) -> Option<String> {
    ParsedQuery::parse(q).fts_match()
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
    fn query_parsing() {
        assert_eq!(fts_query("\"unclosed phrase"), Some("\"unclosed\" OR \"phrase\"".into()));
        assert_eq!(fts_query("a \"b c\" d \"e\""), Some("\"b c\" AND \"e\"".into()));
        assert_eq!(fts_query("„uno dos“ x"), Some("\"uno dos\"".into()));
        assert_eq!(fts_query("“” solo"), Some("\"solo\"".into()));
        assert_eq!(fts_query("Straße ﬁn"), Some("\"Straße\" OR \"ﬁn\"".into()));
        let q = ParsedQuery::parse("漢字");
        assert!(q.cjk);
        assert_eq!(q.fts_match(), Some("\"漢字\"".into()));
        assert_eq!(dedup_key("Árbol"), "arbol");
    }
}
