package spdf

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Metadata returns the document metadata as a CSL-JSON item (legacy files are
// mapped to CSL).
func (f *File) Metadata() (map[string]any, error) {
	doc, err := f.documentRow()
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return nil, errf("E013", "documents", "no document")
	}
	m, _ := doc["metadata"].(map[string]any)
	if m == nil {
		m = map[string]any{}
	}
	return m, nil
}

// DocumentInfo returns the document row as a generic object (5.0 view).
func (f *File) DocumentInfo() (map[string]any, error) { return f.documentRow() }

// CSLItem returns a CSL-JSON item ready for citeproc: the metadata without
// the "spdf" extension, with "id" set to the citation key unless present.
func CSLItem(metadata map[string]any, id string) map[string]any {
	out := map[string]any{}
	for k, v := range metadata {
		if k == "spdf" {
			continue
		}
		out[k] = v
	}
	if _, ok := out["id"]; !ok && id != "" {
		out["id"] = id
	}
	return out
}

// ExportCSL returns the document as a CSL-JSON array (one item), serialized.
func (f *File) ExportCSL() ([]byte, error) {
	md, err := f.Metadata()
	if err != nil {
		return nil, err
	}
	item := CSLItem(md, CitationKey(md))
	return CompactJSON([]any{item}), nil
}

// CitationKey builds the BibTeX key of SPEC §19 (RFC 0002): the first
// author's family (or literal), else the first word of the title, folded to
// ASCII letters and lowercased ("anon" if nothing is left), plus the first
// year of issued (or "nd"): cervantessaavedra1605, lazarillo1554, hookend.
func CitationKey(md map[string]any) string {
	base := ""
	if list, ok := md["author"].([]any); ok && len(list) > 0 {
		if m, ok := list[0].(map[string]any); ok {
			name, _ := m["family"].(string)
			if name == "" {
				name, _ = m["literal"].(string)
			}
			base = asciiLetters(name)
		}
	}
	if base == "" {
		t, _ := md["title"].(string)
		if words := strings.Fields(t); len(words) > 0 {
			base = asciiLetters(words[0])
		}
	}
	if base == "" {
		base = "anon"
	}
	if y := yearOf(md); y != "" {
		return base + y
	}
	return base + "nd"
}

// asciiLetters: NFKD, keep only ASCII letters, lowercase.
func asciiLetters(s string) string {
	var b strings.Builder
	for _, r := range norm.NFKD.String(s) {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') {
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

func yearOf(md map[string]any) string {
	if issued, ok := md["issued"].(map[string]any); ok {
		if dp, ok := issued["date-parts"].([]any); ok && len(dp) > 0 {
			if first, ok := dp[0].([]any); ok && len(first) > 0 {
				switch y := first[0].(type) {
				case int64:
					return fmt.Sprintf("%d", y)
				case float64:
					if y == float64(int64(y)) {
						return fmt.Sprintf("%d", int64(y))
					}
				case string:
					if n, err := strconv.ParseInt(strings.TrimSpace(y), 10, 64); err == nil {
						return fmt.Sprintf("%d", n)
					}
				}
			}
		}
	}
	return ""
}

var bibtexTypes = map[string]string{
	"book": "book", "article-journal": "article", "article-magazine": "article",
	"article-newspaper": "article", "chapter": "incollection", "paper-conference": "inproceedings",
	"thesis": "phdthesis", "report": "techreport",
}

// bibEscape escapes \, { and } (the rest of UTF-8 stays as it is).
func bibEscape(s string) string {
	r := strings.NewReplacer(`\`, `\textbackslash{}`, `{`, `\{`, `}`, `\}`)
	return r.Replace(s)
}

// protectTitle braces every word the source capitalizes, so styles cannot lowercase it.
func protectTitle(t string) string {
	var b strings.Builder
	word := []rune{}
	flush := func() {
		if len(word) == 0 {
			return
		}
		w := string(word)
		upper := false
		for _, r := range word {
			if unicode.IsUpper(r) {
				upper = true
				break
			}
		}
		if upper {
			b.WriteString("{" + bibEscape(w) + "}")
		} else {
			b.WriteString(bibEscape(w))
		}
		word = word[:0]
	}
	for _, r := range t {
		if unicode.IsSpace(r) {
			flush()
			b.WriteRune(r)
		} else {
			word = append(word, r)
		}
	}
	flush()
	return b.String()
}

func bibNames(v any) string {
	list, ok := v.([]any)
	if !ok {
		return ""
	}
	var names []string
	for _, e := range list {
		m, ok := e.(map[string]any)
		if !ok {
			continue
		}
		if lit, ok := m["literal"].(string); ok && lit != "" {
			names = append(names, "{"+bibEscape(lit)+"}")
			continue
		}
		fam, _ := m["family"].(string)
		if p, ok := m["non-dropping-particle"].(string); ok && p != "" && fam != "" {
			fam = p + " " + fam
		}
		given, _ := m["given"].(string)
		switch {
		case fam != "" && given != "":
			names = append(names, bibEscape(fam)+", "+bibEscape(given))
		case fam != "":
			names = append(names, "{"+bibEscape(fam)+"}")
		case given != "":
			names = append(names, "{"+bibEscape(given)+"}")
		}
	}
	return strings.Join(names, " and ")
}

// BibTeXFields returns the entry type and the field map of a CSL-JSON item
// (SPEC §19): what BibTeX writes, before layout.
func BibTeXFields(md map[string]any) (string, [][2]string) {
	typ, _ := md["type"].(string)
	bt, ok := bibtexTypes[typ]
	if !ok {
		bt = "misc"
	}
	var fields [][2]string
	if s := bibNames(md["author"]); s != "" {
		fields = append(fields, [2]string{"author", s})
	}
	if s := bibNames(md["editor"]); s != "" {
		fields = append(fields, [2]string{"editor", s})
	}
	if t, ok := md["title"].(string); ok && t != "" {
		fields = append(fields, [2]string{"title", protectTitle(t)})
	}
	if y := yearOf(md); y != "" {
		fields = append(fields, [2]string{"year", y})
	}
	if ct, ok := md["container-title"].(string); ok && ct != "" {
		k := "booktitle"
		if bt == "article" {
			k = "journal"
		}
		fields = append(fields, [2]string{k, protectTitle(ct)})
	}
	simple := [][2]string{
		{"publisher", "publisher"}, {"publisher-place", "address"}, {"collection-title", "series"},
		{"volume", "volume"}, {"issue", "number"}, {"page", "pages"}, {"edition", "edition"},
		{"DOI", "doi"}, {"ISBN", "isbn"}, {"URL", "url"}, {"language", "language"}, {"note", "note"},
	}
	for _, p := range simple {
		var s string
		switch t := md[p[0]].(type) {
		case string:
			s = t
		case int64:
			s = fmt.Sprintf("%d", t)
		case float64:
			s = FormatNumber(t)
		}
		if s != "" {
			fields = append(fields, [2]string{p[1], bibEscape(s)})
		}
	}
	return bt, fields
}

// BibTeX renders a CSL-JSON item as a BibTeX entry (SPEC §19).
func BibTeX(md map[string]any, key string) string {
	if key == "" {
		key = CitationKey(md)
	}
	bt, fields := BibTeXFields(md)
	lines := make([]string, len(fields))
	for i, f := range fields {
		lines[i] = fmt.Sprintf("  %s = {%s}", f[0], f[1])
	}
	return "@" + bt + "{" + key + ",\n" + strings.Join(lines, ",\n") + "\n}\n"
}

// ExportBibTeX returns the document as a BibTeX entry.
func (f *File) ExportBibTeX() (string, error) {
	md, err := f.Metadata()
	if err != nil {
		return "", err
	}
	return BibTeX(md, CitationKey(md)), nil
}

// Cite cites an anchor of this file (contract §10).
func (f *File) Cite(a, end Anchor, locale string) (string, error) {
	md, err := f.Metadata()
	if err != nil {
		return "", err
	}
	return Cite(a, end, md, locale), nil
}
