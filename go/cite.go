package spdf

import (
	"fmt"
	"math"
	"strings"
)

// Cite returns the short author-date citation of an anchor (contract §10):
// "(Family, Year, locator)". end is the optional end anchor of a range;
// metadata is the CSL-JSON item; locale is "es" or "en" (others → "en").
func Cite(a, end Anchor, metadata map[string]any, locale string) string {
	lang, _, _ := strings.Cut(locale, "-")
	es := strings.ToLower(lang) == "es"
	parts := []string{citeNames(metadata, es), citeYear(metadata, es)}
	if loc := citeLocator(a, end, es); loc != "" {
		parts = append(parts, loc)
	}
	return "(" + strings.Join(parts, ", ") + ")"
}

func cslName(v any) string {
	m, ok := v.(map[string]any)
	if !ok {
		if s, ok := v.(string); ok {
			return s
		}
		return ""
	}
	if lit, ok := m["literal"].(string); ok && lit != "" {
		return lit
	}
	if fam, ok := m["family"].(string); ok && fam != "" {
		if p, ok := m["non-dropping-particle"].(string); ok && p != "" {
			return p + " " + fam
		}
		return fam
	}
	if g, ok := m["given"].(string); ok {
		return g
	}
	return ""
}

func citeNames(md map[string]any, es bool) string {
	var names []string
	if list, ok := md["author"].([]any); ok {
		for _, a := range list {
			if n := cslName(a); n != "" {
				names = append(names, n)
			}
		}
	}
	switch {
	case len(names) == 1:
		return names[0]
	case len(names) == 2:
		if es {
			conj := "y"
			if startsWithI(names[1]) {
				conj = "e"
			}
			return names[0] + " " + conj + " " + names[1]
		}
		return names[0] + " and " + names[1]
	case len(names) >= 3:
		return names[0] + " et al."
	}
	if ts, ok := md["title-short"].(string); ok && ts != "" {
		return ts
	}
	t, _ := md["title"].(string)
	if i := strings.Index(t, ":"); i >= 0 {
		t = t[:i]
	}
	return strings.TrimSpace(t)
}

// startsWithI: the name begins with the sound /i/ (i, í, hi, hí) not
// followed by a vowel ("Iglesias", "Hidalgo" take "e"; "Hierro" takes "y").
func startsWithI(s string) bool {
	low := []rune(strings.ToLower(s))
	var rest []rune
	switch {
	case len(low) >= 2 && low[0] == 'h' && (low[1] == 'i' || low[1] == 'í'):
		rest = low[2:]
	case len(low) >= 1 && (low[0] == 'i' || low[0] == 'í'):
		rest = low[1:]
	default:
		return false
	}
	return !(len(rest) > 0 && strings.ContainsRune("aeiouáéíóúü", rest[0]))
}

func citeYear(md map[string]any, es bool) string {
	if issued, ok := md["issued"].(map[string]any); ok {
		if dp, ok := issued["date-parts"].([]any); ok && len(dp) > 0 {
			if first, ok := dp[0].([]any); ok && len(first) > 0 {
				y, ok := asInt(first[0])
				if !ok {
					if f, isF := first[0].(float64); isF {
						y, ok = int64(f), true
					}
				}
				if ok {
					if y > 0 {
						return fmt.Sprintf("%d", y)
					}
					if es {
						return fmt.Sprintf("%d a. C.", -y)
					}
					return fmt.Sprintf("%d BC", -y)
				}
			}
		}
	}
	if es {
		return "s. f."
	}
	return "n.d."
}

func bracketIfInferred(a Anchor, printed string) string {
	if s, _ := a.Str("source"); s == "inferred" {
		return "[" + printed + "]"
	}
	return printed
}

var (
	singleLabel = map[string]string{"page": "p.", "leaf": "fol.", "column": "col."}
	pluralLabel = map[string]string{"page": "pp.", "leaf": "fols.", "column": "cols."}
)

// foliation of an end: page anchors carry it (default page); section and web
// anchors count as pages.
func foliation(a Anchor) string {
	if a.Type() == "page" {
		if f, ok := a.Str("foliation"); ok && singleLabel[f] != "" {
			return f
		}
	}
	return "page"
}

// pageLocator renders a page-like locator (SPEC §18.1): ends without a
// printed folio never take part in a range ("p. 211", never "pp. s. p.-211"),
// and every label comes from the foliation of the end(s) actually printed
// ("fol. Ir", "p. xiv-fol. 1r").
func pageLocator(a, end Anchor, es bool) string {
	ends := []Anchor{a}
	if end != nil && end.Type() == a.Type() {
		ends = append(ends, end)
	}
	var withFolio []Anchor
	for _, x := range ends {
		if _, ok := x.Str("printed"); ok {
			withFolio = append(withFolio, x)
		}
	}
	if len(withFolio) == 0 {
		if es {
			return "s. p."
		}
		return "n. pag."
	}
	first, last := withFolio[0], withFolio[len(withFolio)-1]
	fp, _ := first.Str("printed")
	lp, _ := last.Str("printed")
	f1, f2 := foliation(first), foliation(last)
	if len(withFolio) == 1 || lp == fp {
		return singleLabel[f1] + " " + bracketIfInferred(first, fp)
	}
	if f1 == f2 {
		return pluralLabel[f1] + " " + bracketIfInferred(first, fp) + "-" + bracketIfInferred(last, lp)
	}
	return singleLabel[f1] + " " + bracketIfInferred(first, fp) + "-" + singleLabel[f2] + " " + bracketIfInferred(last, lp)
}

func clock(t float64) string {
	s := int64(math.Floor(t))
	if s < 0 {
		s = 0
	}
	h, m, sec := s/3600, (s%3600)/60, s%60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, sec)
	}
	return fmt.Sprintf("%d:%02d", m, sec)
}

func citeLocator(a, end Anchor, es bool) string {
	switch a.Type() {
	case "page":
		return pageLocator(a, end, es)
	case "time":
		t0, ok := a.Num("t0")
		if !ok {
			return ""
		}
		if end != nil && end.Type() == "time" {
			if t1, ok := end.Num("t1"); ok {
				return clock(t0) + "-" + clock(t1)
			}
		}
		return clock(t0)
	case "section", "web":
		if _, ok := a.Str("printed"); ok {
			return pageLocator(a, end, es)
		}
		var parts []string
		if path, ok := a.Path(); ok && len(path) > 0 {
			parts = append(parts, "§ "+path[len(path)-1])
		}
		if para, ok := a["paragraph"]; ok && para != nil {
			word := "para. "
			if es {
				word = "párr. "
			}
			parts = append(parts, word+string(CanonicalJSON(para)))
		}
		return strings.Join(parts, ", ")
	case "slide":
		n, ok := a.Int("n")
		if !ok {
			return ""
		}
		if es {
			return fmt.Sprintf("diap. %d", n)
		}
		return fmt.Sprintf("slide %d", n)
	case "sheet":
		sheet, _ := a.Str("sheet")
		rf, ok1 := a.Int("row_from")
		rt, ok2 := a.Int("row_to")
		word := "rows"
		if es {
			word = "filas"
		}
		if ok1 && ok2 && rf == rt {
			if es {
				return fmt.Sprintf("%s, fila %d", sheet, rf)
			}
			return fmt.Sprintf("%s, row %d", sheet, rf)
		}
		if ok1 && ok2 {
			return fmt.Sprintf("%s, %s %d-%d", sheet, word, rf, rt)
		}
		return sheet
	case "verse":
		lf, ok := a.Int("line_from")
		if !ok {
			return ""
		}
		if lt, ok := a.Int("line_to"); ok && lt != lf {
			return fmt.Sprintf("vv. %d-%d", lf, lt)
		}
		return fmt.Sprintf("v. %d", lf)
	case "canonical":
		r, _ := a.Str("ref")
		return r
	}
	return ""
}
