package spdf

import (
	"fmt"
	"sort"
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

// CitationKey builds a BibTeX key: first author family (ASCII, lowercase) +
// year, or the first word of the title.
func CitationKey(md map[string]any) string {
	base := ""
	if list, ok := md["author"].([]any); ok && len(list) > 0 {
		if m, ok := list[0].(map[string]any); ok {
			if s, ok := m["family"].(string); ok {
				base = s
			} else if s, ok := m["literal"].(string); ok {
				base = s
			}
		}
	}
	if base == "" {
		t, _ := md["title"].(string)
		base = t
	}
	key := asciiFold(base)
	if len(key) > 24 {
		key = key[:24]
	}
	if key == "" {
		key = "spdf"
	}
	if y := yearOf(md); y != "" {
		key += y
	}
	return key
}

func asciiFold(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		switch {
		case r == 'ß':
			b.WriteString("ss")
		case r == 'æ' || r == 'Æ':
			b.WriteString("ae")
		case r == 'ø' || r == 'Ø':
			b.WriteString("o")
		case r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r)):
			b.WriteRune(unicode.ToLower(r))
		case r == ' ' && b.Len() > 0:
			// first word only for titles
			return b.String()
		}
	}
	return b.String()
}

func yearOf(md map[string]any) string {
	if issued, ok := md["issued"].(map[string]any); ok {
		if dp, ok := issued["date-parts"].([]any); ok && len(dp) > 0 {
			if first, ok := dp[0].([]any); ok && len(first) > 0 {
				if y, ok := asInt(first[0]); ok {
					return fmt.Sprintf("%d", y)
				}
			}
		}
	}
	return ""
}

var bibtexTypes = map[string]string{
	"book": "book", "article-journal": "article", "article-magazine": "article",
	"article-newspaper": "article", "article": "article", "chapter": "incollection",
	"paper-conference": "inproceedings", "thesis": "phdthesis", "report": "techreport",
	"manuscript": "unpublished", "webpage": "misc", "post-weblog": "misc", "speech": "misc",
	"interview": "misc", "motion_picture": "misc", "song": "misc", "dataset": "misc",
	"graphic": "misc", "entry-encyclopedia": "inbook", "entry-dictionary": "inbook",
}

func bibEscape(s string) string {
	r := strings.NewReplacer(`\`, `\textbackslash{}`, `{`, `\{`, `}`, `\}`, `&`, `\&`, `%`, `\%`, `$`, `\$`, `#`, `\#`, `_`, `\_`)
	return r.Replace(s)
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
		if p, ok := m["non-dropping-particle"].(string); ok && p != "" {
			fam = p + " " + fam
		}
		given, _ := m["given"].(string)
		switch {
		case fam != "" && given != "":
			names = append(names, bibEscape(fam)+", "+bibEscape(given))
		case fam != "":
			names = append(names, bibEscape(fam))
		case given != "":
			names = append(names, bibEscape(given))
		}
	}
	return strings.Join(names, " and ")
}

// BibTeX renders a CSL-JSON item as a BibTeX entry.
func BibTeX(md map[string]any, key string) string {
	typ, _ := md["type"].(string)
	bt, ok := bibtexTypes[typ]
	if !ok {
		bt = "misc"
	}
	if key == "" {
		key = CitationKey(md)
	}
	fields := map[string]string{}
	str := func(k string) string { s, _ := md[k].(string); return s }
	if s := str("title"); s != "" {
		fields["title"] = "{" + bibEscape(s) + "}"
	}
	if s := bibNames(md["author"]); s != "" {
		fields["author"] = s
	}
	if s := bibNames(md["editor"]); s != "" {
		fields["editor"] = s
	}
	if s := bibNames(md["translator"]); s != "" {
		fields["translator"] = s
	}
	if y := yearOf(md); y != "" {
		fields["year"] = y
	}
	ct := str("container-title")
	switch bt {
	case "article":
		if ct != "" {
			fields["journal"] = bibEscape(ct)
		}
	case "incollection", "inproceedings", "inbook":
		if ct != "" {
			fields["booktitle"] = bibEscape(ct)
		}
	default:
		if ct != "" {
			fields["howpublished"] = bibEscape(ct)
		}
	}
	simple := map[string]string{
		"publisher": "publisher", "publisher-place": "address", "volume": "volume", "issue": "number",
		"page": "pages", "edition": "edition", "DOI": "doi", "ISBN": "isbn", "URL": "url",
		"language": "language", "abstract": "abstract", "collection-title": "series", "note": "note",
	}
	for csl, b := range simple {
		v := md[csl]
		var s string
		switch t := v.(type) {
		case string:
			s = t
		case int64:
			s = fmt.Sprintf("%d", t)
		case float64:
			s = FormatNumber(t)
		}
		if s == "" {
			continue
		}
		if b == "pages" {
			s = strings.ReplaceAll(s, "-", "--")
			s = strings.ReplaceAll(s, "----", "--")
		}
		if b == "url" || b == "doi" {
			fields[b] = s
		} else {
			fields[b] = bibEscape(s)
		}
	}
	if bt == "phdthesis" {
		if s := str("publisher"); s != "" {
			fields["school"] = bibEscape(s)
			delete(fields, "publisher")
		}
	}
	if bt == "techreport" {
		if s := str("publisher"); s != "" {
			fields["institution"] = bibEscape(s)
			delete(fields, "publisher")
		}
	}
	order := []string{"author", "editor", "translator", "title", "journal", "booktitle", "howpublished", "series", "edition",
		"volume", "number", "pages", "publisher", "school", "institution", "address", "year", "doi", "isbn", "url", "language", "abstract", "note"}
	var b strings.Builder
	fmt.Fprintf(&b, "@%s{%s,\n", bt, key)
	written := map[string]bool{}
	var lines []string
	for _, k := range order {
		if v, ok := fields[k]; ok {
			lines = append(lines, fmt.Sprintf("  %s = {%s}", k, v))
			written[k] = true
		}
	}
	var rest []string
	for k := range fields {
		if !written[k] {
			rest = append(rest, k)
		}
	}
	sort.Strings(rest)
	for _, k := range rest {
		lines = append(lines, fmt.Sprintf("  %s = {%s}", k, fields[k]))
	}
	b.WriteString(strings.Join(lines, ",\n"))
	b.WriteString("\n}\n")
	return b.String()
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
