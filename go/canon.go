package spdf

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Canonical JSON (§5 of the contract): object keys sorted, floats rounded to six
// decimals and written in the shortest round-trip form (ECMAScript style, so
// 1.0 is written as 1), no insignificant whitespace, strings escaped only where
// JSON requires it. Values are the generic tree produced by ParseJSON:
// nil, bool, int64, float64, string, []any and map[string]any.

// CanonicalJSON serializes v canonically.
func CanonicalJSON(v any) []byte {
	var b bytes.Buffer
	writeCanon(&b, v, true)
	return b.Bytes()
}

// CompactJSON serializes v like CanonicalJSON but without rounding numbers
// (shortest round-trip form). Writers use it to store JSON columns.
func CompactJSON(v any) []byte {
	var b bytes.Buffer
	writeCanon(&b, v, false)
	return b.Bytes()
}

// RoundFloat rounds x to six decimals, correctly rounded from its exact
// binary value.
func RoundFloat(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	r, _ := strconv.ParseFloat(strconv.FormatFloat(x, 'f', 6, 64), 64)
	if r == 0 {
		return 0 // no negative zero
	}
	return r
}

// FormatNumber writes a float in the canonical (ECMAScript shortest) form.
func FormatNumber(x float64) string {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return "null"
	}
	if x == 0 {
		return "0"
	}
	if x == math.Trunc(x) && math.Abs(x) < 1e21 {
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	abs := math.Abs(x)
	if abs >= 1e21 || abs < 1e-6 {
		s := strconv.FormatFloat(x, 'e', -1, 64)
		// Go: 1e+21, 1.5e-07 → ECMAScript: 1e+21, 1.5e-7
		mant, exp, _ := strings.Cut(s, "e")
		sign := exp[0]
		exp = strings.TrimLeft(exp[1:], "0")
		if exp == "" {
			exp = "0"
		}
		return mant + "e" + string(sign) + exp
	}
	return strconv.FormatFloat(x, 'f', -1, 64)
}

func writeCanon(b *bytes.Buffer, v any, round bool) {
	rf := func(x float64) float64 {
		if round {
			return RoundFloat(x)
		}
		return x
	}
	switch t := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if t {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case int64:
		b.WriteString(strconv.FormatInt(t, 10))
	case int:
		b.WriteString(strconv.Itoa(t))
	case float64:
		b.WriteString(FormatNumber(rf(t)))
	case float32:
		b.WriteString(FormatNumber(rf(float64(t))))
	case string:
		writeString(b, t)
	case []any:
		b.WriteByte('[')
		for i, e := range t {
			if i > 0 {
				b.WriteByte(',')
			}
			writeCanon(b, e, round)
		}
		b.WriteByte(']')
	case []string:
		b.WriteByte('[')
		for i, e := range t {
			if i > 0 {
				b.WriteByte(',')
			}
			writeString(b, e)
		}
		b.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sortKeysUTF16(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeString(b, k)
			b.WriteByte(':')
			writeCanon(b, t[k], round)
		}
		b.WriteByte('}')
	default:
		// Fall back to encoding/json for anything else, then re-canonicalize.
		raw, err := json.Marshal(t)
		if err != nil {
			b.WriteString("null")
			return
		}
		g, err := ParseJSON(string(raw))
		if err != nil {
			b.WriteString("null")
			return
		}
		writeCanon(b, g, round)
	}
}

const hexDigits = "0123456789abcdef"

func writeString(b *bytes.Buffer, s string) {
	b.WriteByte('"')
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			switch c {
			case '"':
				b.WriteString(`\"`)
			case '\\':
				b.WriteString(`\\`)
			case '\b':
				b.WriteString(`\b`)
			case '\f':
				b.WriteString(`\f`)
			case '\n':
				b.WriteString(`\n`)
			case '\r':
				b.WriteString(`\r`)
			case '\t':
				b.WriteString(`\t`)
			default:
				if c < 0x20 {
					b.WriteString(`\u00`)
					b.WriteByte(hexDigits[c>>4])
					b.WriteByte(hexDigits[c&0xf])
				} else {
					b.WriteByte(c)
				}
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			b.WriteString(`�`)
		} else {
			b.WriteString(s[i : i+size])
		}
		i += size
	}
	b.WriteByte('"')
}

// sortKeysUTF16 sorts object keys by UTF-16 code units (RFC 8785).
func sortKeysUTF16(keys []string) {
	sort.Slice(keys, func(i, j int) bool { return lessUTF16(keys[i], keys[j]) })
}

func lessUTF16(a, b string) bool {
	ua, ub := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			return ua[i] < ub[i]
		}
	}
	return len(ua) < len(ub)
}

// ParseJSON parses JSON text into the generic tree used by the canonical
// encoder: integers without fraction or exponent become int64, every other
// number float64.
func ParseJSON(s string) (any, error) {
	dec := json.NewDecoder(strings.NewReader(s))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	// Anything after the value other than whitespace is an error.
	if _, err := dec.Token(); err != io.EOF {
		return nil, fmt.Errorf("trailing data after JSON value")
	}
	return normalizeNumbers(v), nil
}

func normalizeNumbers(v any) any {
	switch t := v.(type) {
	case json.Number:
		s := string(t)
		if !strings.ContainsAny(s, ".eE") {
			if i, err := strconv.ParseInt(s, 10, 64); err == nil {
				return i
			}
		}
		f, _ := strconv.ParseFloat(s, 64)
		return f
	case []any:
		for i := range t {
			t[i] = normalizeNumbers(t[i])
		}
		return t
	case map[string]any:
		for k, e := range t {
			t[k] = normalizeNumbers(e)
		}
		return t
	}
	return v
}

// ToGeneric converts any Go value to the generic tree via encoding/json.
func ToGeneric(v any) (any, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return ParseJSON(string(raw))
}

// JSONEqual compares two generic trees structurally; numbers compare as
// float64 after six-decimal rounding, so 1 and 1.0 are equal.
func JSONEqual(a, b any) bool {
	return jsonDiff(a, b, "") == ""
}

// JSONDiff returns the first difference between two generic trees as a
// JSON-pointer-like path with both values, or "" when they are equal.
func JSONDiff(a, b any) string { return jsonDiff(a, b, "") }

func asFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case int64:
		return float64(t), true
	case int:
		return float64(t), true
	case float64:
		return t, true
	case float32:
		return float64(t), true
	}
	return 0, false
}

func jsonDiff(a, b any, path string) string {
	if fa, ok := asFloat(a); ok {
		fb, ok2 := asFloat(b)
		if !ok2 || RoundFloat(fa) != RoundFloat(fb) {
			return fmt.Sprintf("%s: %s != %s", orRoot(path), CanonicalJSON(a), CanonicalJSON(b))
		}
		return ""
	}
	switch ta := a.(type) {
	case nil:
		if b != nil {
			return fmt.Sprintf("%s: null != %s", orRoot(path), CanonicalJSON(b))
		}
		return ""
	case bool:
		if tb, ok := b.(bool); !ok || tb != ta {
			return fmt.Sprintf("%s: %v != %s", orRoot(path), ta, CanonicalJSON(b))
		}
		return ""
	case string:
		if tb, ok := b.(string); !ok || tb != ta {
			return fmt.Sprintf("%s: %s != %s", orRoot(path), CanonicalJSON(a), truncate(string(CanonicalJSON(b)), 200))
		}
		return ""
	case []any:
		tb, ok := b.([]any)
		if !ok {
			return fmt.Sprintf("%s: array != %s", orRoot(path), truncate(string(CanonicalJSON(b)), 200))
		}
		if len(ta) != len(tb) {
			return fmt.Sprintf("%s: length %d != %d", orRoot(path), len(ta), len(tb))
		}
		for i := range ta {
			if d := jsonDiff(ta[i], tb[i], fmt.Sprintf("%s/%d", path, i)); d != "" {
				return d
			}
		}
		return ""
	case map[string]any:
		tb, ok := b.(map[string]any)
		if !ok {
			return fmt.Sprintf("%s: object != %s", orRoot(path), truncate(string(CanonicalJSON(b)), 200))
		}
		keys := map[string]bool{}
		for k := range ta {
			keys[k] = true
		}
		for k := range tb {
			keys[k] = true
		}
		sorted := make([]string, 0, len(keys))
		for k := range keys {
			sorted = append(sorted, k)
		}
		sort.Strings(sorted)
		for _, k := range sorted {
			va, oka := ta[k]
			vb, okb := tb[k]
			if !oka {
				return fmt.Sprintf("%s/%s: missing != %s", path, k, truncate(string(CanonicalJSON(vb)), 200))
			}
			if !okb {
				return fmt.Sprintf("%s/%s: %s != missing", path, k, truncate(string(CanonicalJSON(va)), 200))
			}
			if d := jsonDiff(va, vb, path+"/"+k); d != "" {
				return d
			}
		}
		return ""
	}
	// Other Go types: compare canonical encodings.
	if !bytes.Equal(CanonicalJSON(a), CanonicalJSON(b)) {
		return fmt.Sprintf("%s: %s != %s", orRoot(path), CanonicalJSON(a), CanonicalJSON(b))
	}
	return ""
}

func orRoot(p string) string {
	if p == "" {
		return "/"
	}
	return p
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
