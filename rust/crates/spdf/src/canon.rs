//! Canonical JSON (contract §5).
//!
//! The canonical form is what makes dumps comparable byte for byte across
//! implementations:
//!
//! * object keys sorted by UTF-16 code units (RFC 8785), no insignificant whitespace;
//! * strings as UTF-8, escaping only `"`, `\` and control characters
//!   (`\b \t \n \f \r`, the rest as `\u00xx`), as RFC 8785 does;
//! * every non-integer number rounded to 6 decimals and then printed in the
//!   shortest form that round-trips, the ECMAScript way (`1.0` → `1`,
//!   `0.970000` → `0.97`, `-0` → `0`, exponent only below `1e-6` or from `1e21`).
//!
//! ```
//! use serde_json::json;
//! let v = json!({"b": 1.0, "a": [0.1234567, "ñ"]});
//! assert_eq!(spdf::canon::to_string(&v), r#"{"a":[0.123457,"ñ"],"b":1}"#);
//! ```

use serde_json::{Map, Number, Value};

/// Rounds to 6 decimal places, half to even on the exact binary value (the
/// same result as Python's `round(x, 6)`).
pub fn round6(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let s = format!("{x:.6}");
    let v: f64 = s.parse().unwrap_or(x);
    if v == 0.0 {
        0.0
    } else {
        v
    }
}

/// Formats a finite `f64` as ECMAScript's `Number.prototype.toString` does.
/// Non-finite values (which JSON cannot hold) are printed as `null`.
pub fn format_number(x: f64) -> String {
    if !x.is_finite() {
        return "null".to_string();
    }
    if x == 0.0 {
        return "0".to_string();
    }
    // Shortest round-trip digits in scientific notation, e.g. "1.2345e-7".
    let sci = format!("{:e}", x.abs());
    let (mant, exp) = sci.split_once('e').unwrap_or((sci.as_str(), "0"));
    let exp: i32 = exp.parse().unwrap_or(0);
    let digits: String = mant.chars().filter(|c| c.is_ascii_digit()).collect();
    let k = digits.len() as i32;
    let n = exp + 1; // value = 0.d1d2...dk × 10^n
    let mut out = String::new();
    if x < 0.0 {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        let e = n - 1;
        out.push(if e < 0 { '-' } else { '+' });
        out.push_str(&e.abs().to_string());
    }
    out
}

/// Formats a JSON number canonically.
pub fn format_json_number(n: &Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    format_number(round6(n.as_f64().unwrap_or(0.0)))
}

/// Compares two strings by UTF-16 code units (JCS key order).
pub fn utf16_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn escape_into(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{0c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write_value(v: &Value, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&format_json_number(n)),
        Value::String(s) => escape_into(s, out),
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(x, out);
            }
            out.push(']');
        }
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort_by(|a, b| utf16_cmp(a, b));
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                escape_into(k, out);
                out.push(':');
                write_value(&m[k.as_str()], out);
            }
            out.push('}');
        }
    }
}

/// Serializes a JSON value in canonical form.
pub fn to_string(v: &Value) -> String {
    let mut out = String::new();
    write_value(v, &mut out);
    out
}

/// Returns a copy of `v` with every float rounded to 6 decimals and objects
/// re-inserted in sorted key order, so that `serde_json` output of the result
/// matches [`to_string`] modulo number formatting.
pub fn normalize(v: &Value) -> Value {
    match v {
        Value::Number(n) if n.as_i64().is_none() && n.as_u64().is_none() => {
            let x = round6(n.as_f64().unwrap_or(0.0));
            if x.fract() == 0.0 && x.abs() < 9.007_199_254_740_992e15 {
                Value::Number(Number::from(x as i64))
            } else {
                Number::from_f64(x)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            }
        }
        Value::Array(a) => Value::Array(a.iter().map(normalize).collect()),
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort_by(|a, b| utf16_cmp(a, b));
            let mut out = Map::new();
            for k in keys {
                out.insert(k.clone(), normalize(&m[k.as_str()]));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

/// Canonical equality: two values are equal if their canonical forms are.
pub fn equal(a: &Value, b: &Value) -> bool {
    to_string(a) == to_string(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_like_ecmascript() {
        let cases = [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (0.97, "0.97"),
            (4160.0, "4160"),
            (4175.5, "4175.5"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (1e-7, "1e-7"),
            (0.000001, "0.000001"),
            (-1.5, "-1.5"),
            (123456.789, "123456.789"),
        ];
        for (x, s) in cases {
            assert_eq!(format_number(x), s, "{x}");
        }
    }

    #[test]
    fn rounding() {
        assert_eq!(round6(0.1234567), 0.123457);
        assert_eq!(round6(0.0078125), 0.007812); // exact tie, half to even
        assert_eq!(round6(0.0234375), 0.023438);
        assert_eq!(round6(-0.0000001), 0.0);
        assert_eq!(format_number(round6(1.0000004)), "1");
        assert_eq!(to_string(&json!(0.30000000000000004)), "0.3");
    }

    #[test]
    fn strings_and_keys() {
        let v = json!({"z": "a\"b\\c\n\u{1}", "a": null, "é": true});
        assert_eq!(
            to_string(&v),
            "{\"a\":null,\"z\":\"a\\\"b\\\\c\\n\\u0001\",\"é\":true}"
        );
    }
}
