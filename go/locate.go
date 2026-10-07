package spdf

import (
	"sort"
	"strings"
)

// LocateResult is the resolution of an anchor URI or a .spdf URL with a
// fragment against a file (SPEC §5.4).
type LocateResult struct {
	// Document is false when the reference designates another document.
	Document bool
	// Units are the ids of the designated units, in reading order.
	Units []string
	// Fragments are the ids of the designated fragments, in rowid order.
	Fragments []string
	// Char is the code-point range of the reference, if any.
	Char []int64
	// XYWH is the region of the reference (fractions), if any.
	XYWH []float64
}

// Generic returns the result as {document, units, fragments, char, xywh}.
func (r LocateResult) Generic() map[string]any {
	units := stringsAny(r.Units)
	frags := stringsAny(r.Fragments)
	var char, xywh any
	if r.Char != nil {
		char = intsAny(r.Char)
	}
	if r.XYWH != nil {
		xywh = floatsAny(r.XYWH)
	}
	return map[string]any{"document": r.Document, "units": units, "fragments": frags, "char": char, "xywh": xywh}
}

// locateRules is the order in which locator members decide the resolution.
var locateRules = []string{"p", "f", "t", "sl", "v", "ref", "s", "sh"}

func (l Locator) has(rule string) bool {
	switch rule {
	case "p":
		return l.P != nil
	case "f":
		return l.F != nil
	case "t":
		return len(l.T) > 0
	case "sl":
		return l.Sl != nil
	case "v":
		return len(l.V) > 0
	case "ref":
		return l.Ref != nil
	case "s":
		return l.S != nil
	case "sh":
		return l.Sh != nil
	}
	return false
}

func numEq(a any, b float64) bool {
	x, ok := asFloat(a)
	return ok && x == b
}

// anchorMatches is the predicate of SPEC §5.4 for one rule. printed, when
// not nil, replaces the anchor's printed folio (units.printed).
func anchorMatches(rule string, l Locator, a map[string]any, printed any) bool {
	if a == nil {
		return false
	}
	t, _ := a["type"].(string)
	switch rule {
	case "p":
		pe := *l.P
		if l.PE != nil {
			pe = *l.PE
		}
		if t != "page" || !isInt(a["physical"]) {
			return false
		}
		ph := intOf(a["physical"])
		return *l.P <= ph && ph <= pe
	case "f":
		p := printed
		if p == nil {
			p = a["printed"]
		}
		s, ok := p.(string)
		return ok && s == *l.F
	case "t":
		x := l.T[0]
		t0, ok0 := asFloat(a["t0"])
		t1, ok1 := asFloat(a["t1"])
		return t == "time" && ok0 && ok1 && t0 <= x && x < t1
	case "sl":
		return t == "slide" && numEq(a["n"], float64(*l.Sl))
	case "v":
		x := float64(l.V[0])
		if t != "verse" || !isInt(a["line_from"]) {
			return false
		}
		lf, _ := asFloat(a["line_from"])
		lt := lf
		if a["line_to"] != nil {
			v, ok := asFloat(a["line_to"])
			if !ok {
				return false
			}
			lt = v
		}
		return lf <= x && x <= lt
	case "ref":
		sc, ok1 := a["scheme"].(string)
		rf, ok2 := a["ref"].(string)
		return t == "canonical" && ok1 && ok2 && sc == l.Ref.Scheme && rf == l.Ref.Ref
	case "s":
		if t != "section" && t != "web" {
			return false
		}
		path, ok := a["path"].([]any)
		if !ok {
			return false
		}
		want := stringsAny(l.S)
		if l.Para != nil {
			return JSONEqual(path, want) && numEq(a["paragraph"], float64(*l.Para))
		}
		if len(path) < len(want) {
			return false
		}
		return JSONEqual(path[:len(want)], want)
	case "sh":
		sh, ok := a["sheet"].(string)
		if t != "sheet" || !ok || sh != *l.Sh {
			return false
		}
		if len(l.Rows) > 0 {
			x := float64(l.Rows[0])
			if !isInt(a["row_from"]) || !isInt(a["row_to"]) {
				return false
			}
			rf, _ := asFloat(a["row_from"])
			rt, _ := asFloat(a["row_to"])
			return rf <= x && x <= rt
		}
		return true
	}
	return false
}

// Locate resolves an anchor URI (spdf:…) or the URL of a .spdf with a
// fragment against this file (SPEC §5.4).
func (f *File) Locate(reference string) (LocateResult, error) {
	empty := LocateResult{Document: false, Units: []string{}, Fragments: []string{}}
	doc, err := f.documentRow()
	if err != nil {
		return empty, err
	}
	var l Locator
	if strings.HasPrefix(reference, "spdf:") {
		docref, loc, err := ParseURI(reference)
		if err != nil {
			return empty, err
		}
		sha, _ := doc["source_sha256"].(string)
		id, _ := doc["id"].(string)
		if docref != "sha256-"+sha && docref != id {
			return empty, nil
		}
		l = loc
	} else if _, frag, ok := strings.Cut(reference, "#"); ok && frag != "" {
		_, loc, err := ParseURI("spdf:x#" + frag)
		if err != nil {
			return empty, err
		}
		l = loc
	}
	out := LocateResult{Document: true, Units: []string{}, Fragments: []string{}, Char: l.Char, XYWH: l.XYWH}
	rule := ""
	for _, r := range locateRules {
		if l.has(r) {
			rule = r
			break
		}
	}
	if rule == "" {
		return out, nil
	}
	units, err := f.tableView("units")
	if err != nil {
		return out, err
	}
	frags, err := f.tableView("fragments")
	if err != nil {
		return out, err
	}
	order := map[string]int64{}
	var ids []string
	var timed []map[string]any
	for _, u := range units {
		um := u.(map[string]any)
		id, _ := um["id"].(string)
		order[id], _ = asInt(um["ord"])
		a, _ := um["anchor"].(map[string]any)
		if a != nil && a["type"] == "time" {
			timed = append(timed, um)
		}
		var printed any
		if rule == "f" {
			printed = um["printed"]
		}
		if anchorMatches(rule, l, a, printed) {
			ids = append(ids, id)
		}
	}
	if rule == "t" && len(ids) == 0 && len(timed) > 0 {
		last := timed[len(timed)-1]
		a := last["anchor"].(map[string]any)
		if t1, ok := asFloat(a["t1"]); ok && t1 == l.T[0] {
			id, _ := last["id"].(string)
			ids = []string{id}
		}
	}
	var matched []map[string]any
	for _, fr := range frags {
		fm := fr.(map[string]any)
		a, _ := fm["anchor"].(map[string]any)
		if anchorMatches(rule, l, a, nil) {
			matched = append(matched, fm)
		}
	}
	if len(ids) == 0 && len(matched) > 0 {
		seen := map[string]bool{}
		for _, fm := range matched {
			u, _ := fm["unit"].(string)
			if !seen[u] {
				seen[u] = true
				ids = append(ids, u)
			}
		}
		sort.SliceStable(ids, func(i, j int) bool { return order[ids[i]] < order[ids[j]] })
	}
	if len(l.Char) == 2 {
		c, d := l.Char[0], l.Char[1]
		inUnits := map[string]bool{}
		for _, id := range ids {
			inUnits[id] = true
		}
		var kept []map[string]any
		for _, fm := range matched {
			u, _ := fm["unit"].(string)
			a, _ := fm["anchor"].(map[string]any)
			if !inUnits[u] || a == nil {
				continue
			}
			ch, ok := Anchor(a).Chars()
			if !ok {
				continue
			}
			lo, hi := ch[0], ch[1]
			if c < d {
				if lo < d && c < hi {
					kept = append(kept, fm)
				}
			} else if lo <= c && c < hi {
				kept = append(kept, fm)
			}
		}
		matched = kept
	}
	if ids != nil {
		out.Units = ids
	}
	for _, fm := range matched {
		id, _ := fm["id"].(string)
		out.Fragments = append(out.Fragments, id)
	}
	return out, nil
}
