package spdf

import (
	"fmt"
	"math"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Cite returns the short author-date citation of an anchor (contract §10):
// "(Family, Year, locator)". end is the optional end anchor of a range;
// metadata is the CSL-JSON item; locale is "es" or "en" (others → "en").
func Cite(a, end Anchor, metadata map[string]any, locale string) string {
	es := locale == "es" || strings.HasPrefix(locale, "es-") || strings.HasPrefix(locale, "es_")
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

// startsWithI: the word begins with the sound /i/ (i, í, hi, hí) not
// followed by a vowel (so "Iglesias" and "Hidalgo" take "e", "Hierro" "y").
func startsWithI(s string) bool {
	rs := []rune(strings.ToLower(norm.NFC.String(s)))
	i := 0
	if len(rs) > 0 && rs[0] == 'h' {
		i = 1
	}
	if i >= len(rs) || (rs[i] != 'i' && rs[i] != 'í') {
		return false
	}
	if i+1 < len(rs) && isVowel(rs[i+1]) {
		return false
	}
	return true
}

func isVowel(r rune) bool {
	base := []rune(norm.NFD.String(string(unicode.ToLower(r))))
	if len(base) == 0 {
		return false
	}
	return strings.ContainsRune("aeiou", base[0])
}

func citeYear(md map[string]any, es bool) string {
	if issued, ok := md["issued"].(map[string]any); ok {
		if dp, ok := issued["date-parts"].([]any); ok && len(dp) > 0 {
			if first, ok := dp[0].([]any); ok && len(first) > 0 {
				if y, ok := asInt(first[0]); ok {
					if y < 0 {
						if es {
							return fmt.Sprintf("%d a. C.", -y)
						}
						return fmt.Sprintf("%d BC", -y)
					}
					return fmt.Sprintf("%d", y)
				} else if s, ok := first[0].(string); ok && s != "" {
					return s
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

// pageLocator renders a page-like locator (page anchors, or section/web/verse
// anchors carrying a printed folio).
func pageLocator(a, end Anchor, es bool) string {
	printed, ok := a.Str("printed")
	if !ok {
		if es {
			return "s. p."
		}
		return "n. pag."
	}
	fol, _ := a.Str("foliation")
	single, plural := "p.", "pp."
	switch fol {
	case "leaf":
		single, plural = "fol.", "fols."
	case "column":
		single, plural = "col.", "cols."
	}
	first := bracketIfInferred(a, printed)
	if end != nil {
		if ep, ok := end.Str("printed"); ok && ep != printed {
			return plural + " " + first + "-" + bracketIfInferred(end, ep)
		}
	}
	return single + " " + first
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
		path, _ := a.Path()
		para, hasPara := a.Int("paragraph")
		paraWord := "para."
		if es {
			paraWord = "párr."
		}
		if len(path) > 0 {
			s := "§ " + path[len(path)-1]
			if hasPara {
				s += fmt.Sprintf(", %s %d", paraWord, para)
			}
			return s
		}
		if hasPara {
			return fmt.Sprintf("%s %d", paraWord, para)
		}
		return ""
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
