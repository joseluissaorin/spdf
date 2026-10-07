package spdf

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Anchor is a JSON anchor (contract §3) kept as a generic object, so members
// this version does not know survive a round trip.
type Anchor map[string]any

// ParseAnchor parses anchor JSON.
func ParseAnchor(s string) (Anchor, error) {
	v, err := ParseJSON(s)
	if err != nil {
		return nil, err
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("anchor is not a JSON object")
	}
	return Anchor(m), nil
}

// Type returns the anchor type ("page", "time"…).
func (a Anchor) Type() string { s, _ := a["type"].(string); return s }

// Str returns a string member.
func (a Anchor) Str(k string) (string, bool) { s, ok := a[k].(string); return s, ok }

// Int returns an integer member.
func (a Anchor) Int(k string) (int64, bool) {
	switch t := a[k].(type) {
	case int64:
		return t, true
	case float64:
		if t == math.Trunc(t) {
			return int64(t), true
		}
	}
	return 0, false
}

// Num returns a numeric member as float64.
func (a Anchor) Num(k string) (float64, bool) { return asFloat(a[k]) }

// Path returns the "path" member as strings.
func (a Anchor) Path() ([]string, bool) {
	l, ok := a["path"].([]any)
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(l))
	for _, e := range l {
		s, ok := e.(string)
		if !ok {
			return nil, false
		}
		out = append(out, s)
	}
	return out, true
}

// Region is a rectangle in fractions (0–1) of the unit image.
type Region struct{ X, Y, W, H float64 }

// Region returns the "region" member.
func (a Anchor) Region() (Region, bool) {
	m, ok := a["region"].(map[string]any)
	if !ok {
		return Region{}, false
	}
	x, ok1 := asFloat(m["x"])
	y, ok2 := asFloat(m["y"])
	w, ok3 := asFloat(m["w"])
	h, ok4 := asFloat(m["h"])
	if !(ok1 && ok2 && ok3 && ok4) {
		return Region{}, false
	}
	return Region{x, y, w, h}, true
}

// Chars returns the "chars" member [start, end).
func (a Anchor) Chars() ([2]int64, bool) {
	l, ok := a["chars"].([]any)
	if !ok || len(l) != 2 {
		return [2]int64{}, false
	}
	s, ok1 := asInt(l[0])
	e, ok2 := asInt(l[1])
	return [2]int64{s, e}, ok1 && ok2
}

// CanonicalRef is a canonical reference (stephanus:514a).
type CanonicalRef struct {
	Scheme string `json:"scheme"`
	Ref    string `json:"ref"`
}

// Locator is the parsed fragment of an anchor URI (contract §3). Only the
// present members are set.
type Locator struct {
	P    *int64        `json:"p,omitempty"`
	PE   *int64        `json:"pe,omitempty"`
	F    *string       `json:"f,omitempty"`
	FE   *string       `json:"fe,omitempty"`
	T    []float64     `json:"t,omitempty"`
	S    []string      `json:"s,omitempty"`
	Para *int64        `json:"para,omitempty"`
	Sl   *int64        `json:"sl,omitempty"`
	Sh   *string       `json:"sh,omitempty"`
	Rows []int64       `json:"rows,omitempty"`
	V    []int64       `json:"v,omitempty"`
	Ref  *CanonicalRef `json:"ref,omitempty"`
	Char []int64       `json:"char,omitempty"`
	XYWH []float64     `json:"xywh,omitempty"`
}

func i64(v int64) *int64   { return &v }
func str(v string) *string { return &v }

// LocatorFromAnchor derives the locator of an anchor and an optional end
// anchor (for ranges), contract §3.
func LocatorFromAnchor(a, end Anchor) Locator {
	var l Locator
	typ := a.Type()
	switch typ {
	case "page":
		if p, ok := a.Int("physical"); ok {
			l.P = i64(p)
		}
		if f, ok := a.Str("printed"); ok {
			l.F = str(f)
		}
		if end != nil && end.Type() == "page" {
			if pe, ok := end.Int("physical"); ok && (l.P == nil || pe != *l.P) {
				l.PE = i64(pe)
			}
			if fe, ok := end.Str("printed"); ok && (l.F == nil || fe != *l.F) {
				l.FE = str(fe)
			}
		}
	case "time":
		t0, _ := a.Num("t0")
		t1, ok1 := a.Num("t1")
		if end != nil && end.Type() == "time" {
			t1, ok1 = end.Num("t1")
		}
		if ok1 {
			l.T = []float64{t0, t1}
		} else {
			l.T = []float64{t0}
		}
	case "section", "web":
		if p, ok := a.Path(); ok && len(p) > 0 {
			l.S = p
		}
		if n, ok := a.Int("paragraph"); ok {
			l.Para = i64(n)
		}
		if f, ok := a.Str("printed"); ok {
			l.F = str(f)
			if end != nil {
				if fe, ok := end.Str("printed"); ok && fe != f {
					l.FE = str(fe)
				}
			}
		}
	case "slide":
		n, _ := a.Int("n")
		l.Sl = i64(n)
	case "sheet":
		s, _ := a.Str("sheet")
		l.Sh = str(s)
		rf, _ := a.Int("row_from")
		rt, _ := a.Int("row_to")
		l.Rows = []int64{rf, rt}
	case "verse":
		lf, _ := a.Int("line_from")
		if lt, ok := a.Int("line_to"); ok && lt != lf {
			l.V = []int64{lf, lt}
		} else {
			l.V = []int64{lf}
		}
		if f, ok := a.Str("printed"); ok {
			l.F = str(f)
		}
	case "canonical":
		sc, _ := a.Str("scheme")
		rf, _ := a.Str("ref")
		l.Ref = &CanonicalRef{Scheme: sc, Ref: rf}
	}
	if c, ok := a.Chars(); ok {
		l.Char = []int64{c[0], c[1]}
	}
	if r, ok := a.Region(); ok {
		l.XYWH = []float64{r.X, r.Y, r.W, r.H}
	}
	return l
}

// PercentEncode encodes every byte except RFC 3986 unreserved characters,
// with uppercase hex.
func PercentEncode(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '.' || c == '_' || c == '~' {
			b.WriteByte(c)
		} else {
			b.WriteByte('%')
			b.WriteByte("0123456789ABCDEF"[c>>4])
			b.WriteByte("0123456789ABCDEF"[c&15])
		}
	}
	return b.String()
}

// percentDecode decodes %XX escapes; a stray '%' or invalid UTF-8 is an error.
func percentDecode(s string) (string, error) {
	if !strings.Contains(s, "%") {
		if !utf8.ValidString(s) {
			return "", fmt.Errorf("not UTF-8")
		}
		return s, nil
	}
	var b []byte
	for i := 0; i < len(s); i++ {
		if s[i] == '%' {
			if i+2 >= len(s) || !isHex(s[i+1]) || !isHex(s[i+2]) {
				return "", fmt.Errorf("bad percent-encoding")
			}
			v, _ := strconv.ParseUint(s[i+1:i+3], 16, 8)
			b = append(b, byte(v))
			i += 2
			continue
		}
		b = append(b, s[i])
	}
	if !utf8.Valid(b) {
		return "", fmt.Errorf("percent-encoding is not UTF-8")
	}
	return string(b), nil
}

func isHex(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

func roundTo(x float64, decimals int) float64 {
	r, _ := strconv.ParseFloat(strconv.FormatFloat(x, 'f', decimals, 64), 64)
	if r == 0 {
		return 0
	}
	return r
}

// DocRef returns the preferred document reference: sha256-<hex>.
func DocRef(sourceSHA256 string) string { return "sha256-" + strings.ToLower(sourceSHA256) }

// FormatURI builds the canonical anchor URI for a docref and a locator.
// docref is "sha256-<hex>" or a document id (percent-encoded here).
func FormatURI(docref string, l Locator) string {
	var parts []string
	add := func(k, v string) { parts = append(parts, k+"="+v) }
	if l.P != nil {
		add("p", strconv.FormatInt(*l.P, 10))
	}
	if l.PE != nil {
		add("pe", strconv.FormatInt(*l.PE, 10))
	}
	if l.F != nil {
		add("f", PercentEncode(*l.F))
	}
	if l.FE != nil {
		add("fe", PercentEncode(*l.FE))
	}
	if len(l.T) > 0 {
		ts := make([]string, len(l.T))
		for i, t := range l.T {
			ts[i] = FormatNumber(RoundFloat(t))
		}
		add("t", strings.Join(ts, ","))
	}
	if len(l.S) > 0 {
		es := make([]string, len(l.S))
		for i, e := range l.S {
			es[i] = PercentEncode(e)
		}
		add("s", strings.Join(es, "/"))
	}
	if l.Para != nil {
		add("para", strconv.FormatInt(*l.Para, 10))
	}
	if l.Sl != nil {
		add("sl", strconv.FormatInt(*l.Sl, 10))
	}
	if l.Sh != nil {
		add("sh", PercentEncode(*l.Sh))
	}
	if len(l.Rows) == 2 {
		add("rows", fmt.Sprintf("%d-%d", l.Rows[0], l.Rows[1]))
	}
	if len(l.V) > 0 {
		vs := make([]string, len(l.V))
		for i, x := range l.V {
			vs[i] = strconv.FormatInt(x, 10)
		}
		add("v", strings.Join(vs, "-"))
	}
	if l.Ref != nil {
		add("ref", PercentEncode(l.Ref.Scheme)+":"+PercentEncode(l.Ref.Ref))
	}
	if len(l.Char) == 2 {
		add("char", fmt.Sprintf("%d,%d", l.Char[0], l.Char[1]))
	}
	if len(l.XYWH) == 4 {
		vs := make([]string, 4)
		for i, v := range l.XYWH {
			vs[i] = FormatNumber(roundTo(v*100, 4))
		}
		add("xywh", "percent:"+strings.Join(vs, ","))
	}
	ref := docref
	if !shaRefRe.MatchString(docref) {
		ref = PercentEncode(docref)
	}
	if len(parts) == 0 {
		return "spdf:" + ref
	}
	return "spdf:" + ref + "#" + strings.Join(parts, "&")
}

// AnchorURI builds the canonical URI of an anchor (and optional end anchor).
func AnchorURI(docref string, a, end Anchor) string {
	return FormatURI(docref, LocatorFromAnchor(a, end))
}

var (
	shaRefRe = regexp.MustCompile(`^sha256-[0-9a-f]{64}$`)
	intRe    = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)
	decRe    = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?$`)
	clockRe  = regexp.MustCompile(`^(?:([0-9]+):)?([0-5]?[0-9]):([0-5][0-9](?:\.[0-9]+)?)$`)
)

func parseURIInt(s string) (int64, error) {
	if !intRe.MatchString(s) {
		return 0, fmt.Errorf("not an integer: %q", s)
	}
	return strconv.ParseInt(s, 10, 64)
}

func parseNPT(s string) (float64, error) {
	if decRe.MatchString(s) {
		return strconv.ParseFloat(s, 64)
	}
	m := clockRe.FindStringSubmatch(s)
	if m == nil {
		return 0, fmt.Errorf("bad time: %q", s)
	}
	var h int64
	if m[1] != "" {
		h, _ = strconv.ParseInt(m[1], 10, 64)
	}
	mi, _ := strconv.ParseInt(m[2], 10, 64)
	sec, _ := strconv.ParseFloat(m[3], 64)
	return RoundFloat(float64(h*3600+mi*60) + sec), nil
}

// ParseURI parses an anchor URI into its docref and locator (contract §3).
// Unknown parameters are ignored; malformed values are errors.
func ParseURI(uri string) (string, Locator, error) {
	var l Locator
	if !strings.HasPrefix(uri, "spdf:") {
		return "", l, fmt.Errorf("not an spdf: URI")
	}
	rest := uri[len("spdf:"):]
	rawRef, frag, _ := strings.Cut(rest, "#")
	if rawRef == "" {
		return "", l, fmt.Errorf("empty document reference")
	}
	docref, err := percentDecode(rawRef)
	if err != nil {
		return "", l, err
	}
	seen := map[string]bool{}
	for _, part := range strings.Split(frag, "&") {
		if part == "" {
			continue
		}
		k, v, eq := strings.Cut(part, "=")
		if !eq {
			return "", l, fmt.Errorf("parameter without value: %q", part)
		}
		if seen[k] {
			return "", l, fmt.Errorf("duplicate parameter %s", k)
		}
		seen[k] = true
		switch k {
		case "p", "pe", "para", "sl":
			n, err := parseURIInt(v)
			if err != nil {
				return "", l, err
			}
			if k != "para" && n < 1 {
				return "", l, fmt.Errorf("%s starts at 1", k)
			}
			switch k {
			case "p":
				l.P = i64(n)
			case "pe":
				l.PE = i64(n)
			case "para":
				l.Para = i64(n)
			case "sl":
				l.Sl = i64(n)
			}
		case "f", "fe", "sh":
			d, err := percentDecode(v)
			if err != nil {
				return "", l, err
			}
			switch k {
			case "f":
				l.F = str(d)
			case "fe":
				l.FE = str(d)
			case "sh":
				l.Sh = str(d)
			}
		case "t":
			v = strings.TrimPrefix(v, "npt:")
			var ts []float64
			for _, p := range strings.Split(v, ",") {
				x, err := parseNPT(p)
				if err != nil {
					return "", l, err
				}
				ts = append(ts, x)
			}
			if len(ts) > 2 || (len(ts) == 2 && ts[1] < ts[0]) {
				return "", l, fmt.Errorf("bad t")
			}
			l.T = ts
		case "s":
			var es []string
			for _, e := range strings.Split(v, "/") {
				d, err := percentDecode(e)
				if err != nil {
					return "", l, err
				}
				es = append(es, d)
			}
			l.S = es
		case "rows":
			a, b, ok := strings.Cut(v, "-")
			if !ok {
				return "", l, fmt.Errorf("rows needs a-b")
			}
			x, err1 := parseURIInt(a)
			y, err2 := parseURIInt(b)
			if err1 != nil || err2 != nil {
				return "", l, fmt.Errorf("bad rows")
			}
			l.Rows = []int64{x, y}
		case "v":
			ps := strings.Split(v, "-")
			if len(ps) > 2 {
				return "", l, fmt.Errorf("bad v")
			}
			var xs []int64
			for _, p := range ps {
				x, err := parseURIInt(p)
				if err != nil {
					return "", l, err
				}
				xs = append(xs, x)
			}
			l.V = xs
		case "ref":
			a, b, ok := strings.Cut(v, ":")
			if !ok || a == "" {
				return "", l, fmt.Errorf("ref needs scheme:ref")
			}
			sc, err1 := percentDecode(a)
			rf, err2 := percentDecode(b)
			if err1 != nil || err2 != nil {
				return "", l, fmt.Errorf("bad ref")
			}
			l.Ref = &CanonicalRef{Scheme: sc, Ref: rf}
		case "char":
			ps := strings.Split(v, ",")
			if len(ps) != 2 {
				return "", l, fmt.Errorf("char needs start,end")
			}
			a, err1 := parseURIInt(ps[0])
			b, err2 := parseURIInt(ps[1])
			if err1 != nil || err2 != nil {
				return "", l, fmt.Errorf("bad char")
			}
			if b < a {
				return "", l, fmt.Errorf("char end before start")
			}
			l.Char = []int64{a, b}
		case "xywh":
			if !strings.HasPrefix(v, "percent:") {
				return "", l, fmt.Errorf("xywh must use percent:")
			}
			ps := strings.Split(v[len("percent:"):], ",")
			if len(ps) != 4 {
				return "", l, fmt.Errorf("bad xywh")
			}
			vals := make([]float64, 4)
			for i, p := range ps {
				if !decRe.MatchString(p) {
					return "", l, fmt.Errorf("bad xywh")
				}
				x, _ := strconv.ParseFloat(p, 64)
				vals[i] = RoundFloat(x / 100)
			}
			l.XYWH = vals
		}
	}
	return docref, l, nil
}

func cutInts(s, sep string) (int64, int64, bool) {
	a, b, ok := strings.Cut(s, sep)
	if !ok {
		return 0, 0, false
	}
	x, err1 := strconv.ParseInt(a, 10, 64)
	y, err2 := strconv.ParseInt(b, 10, 64)
	return x, y, err1 == nil && err2 == nil
}

// Generic returns the locator as a generic JSON tree (only present members).
func (l Locator) Generic() map[string]any {
	m := map[string]any{}
	if l.P != nil {
		m["p"] = *l.P
	}
	if l.PE != nil {
		m["pe"] = *l.PE
	}
	if l.F != nil {
		m["f"] = *l.F
	}
	if l.FE != nil {
		m["fe"] = *l.FE
	}
	if len(l.T) > 0 {
		m["t"] = floatsAny(l.T)
	}
	if len(l.S) > 0 {
		s := make([]any, len(l.S))
		for i, e := range l.S {
			s[i] = e
		}
		m["s"] = s
	}
	if l.Para != nil {
		m["para"] = *l.Para
	}
	if l.Sl != nil {
		m["sl"] = *l.Sl
	}
	if l.Sh != nil {
		m["sh"] = *l.Sh
	}
	if len(l.Rows) > 0 {
		m["rows"] = intsAny(l.Rows)
	}
	if len(l.V) > 0 {
		m["v"] = intsAny(l.V)
	}
	if l.Ref != nil {
		m["ref"] = map[string]any{"scheme": l.Ref.Scheme, "ref": l.Ref.Ref}
	}
	if len(l.Char) > 0 {
		m["char"] = intsAny(l.Char)
	}
	if len(l.XYWH) > 0 {
		m["xywh"] = floatsAny(l.XYWH)
	}
	return m
}

// LocatorFromGeneric builds a Locator from its JSON form.
func LocatorFromGeneric(m map[string]any) Locator {
	var l Locator
	if v, ok := asInt(m["p"]); ok {
		l.P = i64(v)
	}
	if v, ok := asInt(m["pe"]); ok {
		l.PE = i64(v)
	}
	if v, ok := m["f"].(string); ok {
		l.F = str(v)
	}
	if v, ok := m["fe"].(string); ok {
		l.FE = str(v)
	}
	if v, ok := m["t"].([]any); ok {
		for _, e := range v {
			x, _ := asFloat(e)
			l.T = append(l.T, x)
		}
	}
	if v, ok := m["s"].([]any); ok {
		for _, e := range v {
			s, _ := e.(string)
			l.S = append(l.S, s)
		}
	}
	if v, ok := asInt(m["para"]); ok {
		l.Para = i64(v)
	}
	if v, ok := asInt(m["sl"]); ok {
		l.Sl = i64(v)
	}
	if v, ok := m["sh"].(string); ok {
		l.Sh = str(v)
	}
	l.Rows = intsFrom(m["rows"])
	l.V = intsFrom(m["v"])
	if r, ok := m["ref"].(map[string]any); ok {
		sc, _ := r["scheme"].(string)
		rf, _ := r["ref"].(string)
		l.Ref = &CanonicalRef{Scheme: sc, Ref: rf}
	}
	l.Char = intsFrom(m["char"])
	if v, ok := m["xywh"].([]any); ok {
		for _, e := range v {
			x, _ := asFloat(e)
			l.XYWH = append(l.XYWH, x)
		}
	}
	return l
}

func intsFrom(v any) []int64 {
	l, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]int64, 0, len(l))
	for _, e := range l {
		x, _ := asInt(e)
		out = append(out, x)
	}
	return out
}

func intsAny(v []int64) []any {
	out := make([]any, len(v))
	for i, x := range v {
		out[i] = x
	}
	return out
}

func floatsAny(v []float64) []any {
	out := make([]any, len(v))
	for i, x := range v {
		out[i] = x
	}
	return out
}
