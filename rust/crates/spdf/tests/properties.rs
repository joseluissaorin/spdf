//! Property tests: offsets over emoji, combining marks and CJK; anchor URI
//! round trips; canonical JSON; vector encodings.

use proptest::prelude::*;
use serde_json::{json, Value};
use spdf::anchor::{AnchorUri, Locator};
use spdf::{canon, text, vector, Dtype};

/// Characters that make offsets interesting.
fn tricky_char() -> impl Strategy<Value = char> {
    prop_oneof![
        prop::char::range('a', 'z'),
        Just('é'),
        Just('ñ'),
        Just('\u{0301}'), // combining acute
        Just('\u{0308}'), // combining diaeresis
        Just('🙂'),
        Just('👩'),
        Just('\u{200D}'), // ZWJ
        Just('🏽'),       // skin tone modifier
        Just('漢'),
        Just('字'),
        Just('ア'),
        Just('한'),
        Just('ſ'),
        Just('\u{FB01}'), // ﬁ
        Just(' '),
        Just('/'),
        Just('%'),
        Just('&'),
        Just('#'),
        Just('='),
        Just(':'),
        Just(','),
        Just('-'),
        Just('"'),
        any::<char>(),
    ]
}

fn tricky_string(max: usize) -> impl Strategy<Value = String> {
    prop::collection::vec(tricky_char(), 0..max).prop_map(|v| v.into_iter().collect())
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn offsets_round_trip(s in tricky_string(40)) {
        let n = text::cp_len(&s);
        for k in 0..=n {
            let b = text::cp_to_byte(&s, k).unwrap();
            prop_assert_eq!(text::byte_to_cp(&s, b), Some(k));
            let u = text::cp_to_utf16(&s, k).unwrap();
            prop_assert_eq!(text::utf16_to_cp(&s, u), Some(k));
            let left = text::cp_slice(&s, 0, k).unwrap();
            let right = text::cp_slice(&s, k, n).unwrap();
            prop_assert_eq!(format!("{left}{right}"), s.clone());
        }
        prop_assert_eq!(text::cp_to_byte(&s, n + 1), None);
        let utf16_len: usize = s.encode_utf16().count();
        prop_assert_eq!(text::cp_to_utf16(&s, n), Some(utf16_len));
    }

    #[test]
    fn nfc_is_idempotent_and_offsets_stay_valid(s in tricky_string(40)) {
        let a = text::nfc(&s);
        prop_assert_eq!(text::nfc(&a), a.clone());
        prop_assert!(text::is_nfc_str(&a));
        prop_assert!(text::cp_len(&a) <= text::cp_len(&s));
    }

    #[test]
    fn query_parsing_never_panics(q in tricky_string(30)) {
        let p = text::ParsedQuery::parse(&q);
        if let Some(m) = p.fts_match() {
            prop_assert!(m.starts_with('"') && m.ends_with('"'));
        }
        for t in &p.terms {
            prop_assert!(!t.is_empty());
        }
    }

    #[test]
    fn page_uri_round_trip(
        doc in tricky_string(12).prop_filter("non-empty", |s| !s.is_empty()),
        physical in 1u32..100_000,
        printed in proptest::option::of(tricky_string(8)),
        end in proptest::option::of((1u32..100_000, proptest::option::of(tricky_string(6)))),
        chars in proptest::option::of((0u64..10_000, 0u64..10_000)),
        region in proptest::option::of((0u32..=10_000, 0u32..=10_000, 0u32..=10_000, 0u32..=10_000)),
    ) {
        let mut a = json!({"type":"page","physical":physical,"printed":printed});
        if let Some((x, y)) = chars {
            a["chars"] = json!([x.min(y), x.max(y)]);
        }
        if let Some((x, y, w, h)) = region {
            a["region"] = json!({"x": x as f64 / 10_000.0, "y": y as f64 / 10_000.0, "w": w as f64 / 10_000.0, "h": h as f64 / 10_000.0});
        }
        let e = end.map(|(p, f)| json!({"type":"page","physical":p,"printed":f}));
        check_round_trip(&doc, &a, e.as_ref())?;
    }

    #[test]
    fn section_and_time_uri_round_trip(
        doc in "[a-z0-9-]{1,12}",
        path in prop::collection::vec(tricky_string(10), 0..4),
        paragraph in proptest::option::of(0u32..1000),
        t0 in 0u32..10_000_000,
        dt in 0u32..1_000_000,
    ) {
        let s = json!({"type":"section","path":path,"paragraph":paragraph});
        check_round_trip(&doc, &s, None)?;
        let t = json!({"type":"time","t0": t0 as f64 / 1000.0, "t1": (t0 + dt) as f64 / 1000.0});
        check_round_trip(&doc, &t, None)?;
    }

    #[test]
    fn other_uri_round_trip(
        doc in "sha256-[0-9a-f]{64}",
        n in 1u32..1000,
        sheet in tricky_string(10),
        rows in (0u32..1000, 0u32..1000),
        verse in (1u32..100_000, proptest::option::of(1u32..100_000)),
        scheme in "[a-z]{1,10}",
        reference in tricky_string(10),
    ) {
        check_round_trip(&doc, &json!({"type":"slide","n":n}), None)?;
        check_round_trip(&doc, &json!({"type":"sheet","sheet":sheet,"row_from":rows.0,"row_to":rows.1}), None)?;
        check_round_trip(&doc, &json!({"type":"verse","line_from":verse.0,"line_to":verse.1}), None)?;
        check_round_trip(&doc, &json!({"type":"canonical","scheme":scheme,"ref":reference}), None)?;
    }

    #[test]
    fn canonical_json_is_idempotent(
        keys in prop::collection::vec(tricky_string(6), 0..6),
        nums in prop::collection::vec(-1e9f64..1e9, 0..6),
        s in tricky_string(20),
    ) {
        let mut obj = serde_json::Map::new();
        for (i, k) in keys.iter().enumerate() {
            obj.insert(k.clone(), json!(nums.get(i).copied().unwrap_or(0.5)));
        }
        obj.insert("s".into(), Value::from(s));
        obj.insert("arr".into(), json!(nums));
        let v = Value::Object(obj);
        let c1 = canon::to_string(&v);
        let back: Value = serde_json::from_str(&c1).unwrap();
        prop_assert_eq!(canon::to_string(&back), c1.clone());
        prop_assert_eq!(canon::to_string(&canon::normalize(&v)), c1);
    }

    #[test]
    fn vectors_round_trip(v in prop::collection::vec(-1.0f32..1.0, 1..64)) {
        for d in [Dtype::F32, Dtype::F16, Dtype::I8] {
            let bytes = vector::encode(&v, d);
            prop_assert_eq!(bytes.len(), v.len() * d.size());
            let back = vector::decode(&bytes, d, v.len()).unwrap();
            let tol = match d { Dtype::F32 => 0.0, Dtype::F16 => 1e-3, Dtype::I8 => 0.5 / 127.0 + 1e-6 };
            for (a, b) in v.iter().zip(&back) {
                prop_assert!((a - b).abs() <= tol, "{:?}: {} vs {}", d, a, b);
            }
        }
    }
}

fn check_round_trip(doc: &str, anchor: &Value, end: Option<&Value>) -> Result<(), TestCaseError> {
    let uri = spdf::format_uri(doc, anchor, end).map_err(|e| TestCaseError::fail(e.to_string()))?;
    let parsed = AnchorUri::parse(&uri).map_err(|e| TestCaseError::fail(format!("{uri}: {e}")))?;
    prop_assert_eq!(&parsed.docref, doc);
    // format ∘ parse is the identity on canonical URIs.
    prop_assert_eq!(parsed.to_string(), uri.clone());
    // parse ∘ format gives back the locator of the anchor (numbers canonical).
    let expected = Locator::from_anchor_value(anchor, end);
    let a = canon::normalize(&serde_json::to_value(&parsed.locator).unwrap());
    let mut b = canon::normalize(&serde_json::to_value(&expected).unwrap());
    // xywh travels as percent with 4 decimals: compare after the same rounding.
    if let Some(r) = b.get_mut("xywh") {
        if let Some(arr) = r.as_array_mut() {
            for x in arr.iter_mut() {
                let f = x.as_f64().unwrap_or(0.0);
                let pct: f64 = format!("{:.4}", f * 100.0).parse().unwrap_or(0.0);
                *x = canon::normalize(&json!(canon::round6(pct / 100.0)));
            }
        }
    }
    prop_assert!(canon::equal(&a, &b), "{} → {} vs {}", uri, a, b);
    Ok(())
}
