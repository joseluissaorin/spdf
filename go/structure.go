package spdf

import (
	"encoding/xml"
	"fmt"
	"io"
	"regexp"
	"strings"
)

// Structural exports (SPEC §19.4): ALTO 4, a minimal TEI and a IIIF
// Presentation 3 manifest. They never invent data: no coordinates, no folio
// for an unnumbered page, inferred folios in brackets (and absent from ALTO,
// which only records printed numbers).

func xmlEscape(s string) string {
	var b strings.Builder
	xml.EscapeText(&b, []byte(s))
	return b.String()
}

var blankLineRe = regexp.MustCompile(`\n\s*\n`)

// paragraphs splits a unit text into paragraphs (blank lines) of lines.
func paragraphs(text string) [][]string {
	var out [][]string
	for _, p := range blankLineRe.Split(text, -1) {
		var lines []string
		for _, l := range strings.Split(p, "\n") {
			if t := strings.TrimSpace(l); t != "" {
				lines = append(lines, t)
			}
		}
		if len(lines) > 0 {
			out = append(out, lines)
		}
	}
	return out
}

// folioN is the folio as cited, without label: "ii", "[iv]", "1r"; "" and
// false when the page is unnumbered.
func folioN(a Anchor) (string, bool) {
	p, ok := a.Str("printed")
	if !ok {
		return "", false
	}
	if s, _ := a.Str("source"); s == "inferred" {
		return "[" + p + "]", true
	}
	return p, true
}

// ExportALTO writes ALTO 4: one Page per page unit (PHYSICAL_IMG_NR, and
// PRINTED_IMG_NR for read folios), one TextBlock per paragraph and one
// TextLine per line.
func (f *File) ExportALTO() (string, error) {
	doc, err := f.documentRow()
	if err != nil {
		return "", err
	}
	units, err := f.Units()
	if err != nil {
		return "", err
	}
	id, _ := doc["id"].(string)
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<alto xmlns="http://www.loc.gov/standards/alto/ns-v4#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.loc.gov/standards/alto/ns-v4# http://www.loc.gov/standards/alto/v4/alto-4-4.xsd" SCHEMAVERSION="4.4">` + "\n")
	b.WriteString("  <Description>\n    <MeasurementUnit>pixel</MeasurementUnit>\n")
	fmt.Fprintf(&b, "    <sourceImageInformation><fileName>%s</fileName></sourceImageInformation>\n", xmlEscape(id))
	b.WriteString("  </Description>\n  <Layout>\n")
	i := 0
	for _, u := range units {
		if u.Anchor.Type() != "page" {
			continue
		}
		i++
		printed := ""
		if p, ok := u.Anchor.Str("printed"); ok {
			if s, _ := u.Anchor.Str("source"); s != "inferred" {
				printed = fmt.Sprintf(` PRINTED_IMG_NR="%s"`, xmlEscape(p))
			}
		}
		phys, _ := u.Anchor.Int("physical")
		fmt.Fprintf(&b, "    <Page ID=\"P%d\" PHYSICAL_IMG_NR=\"%d\"%s>\n", i, phys, printed)
		fmt.Fprintf(&b, "      <PrintSpace ID=\"P%d_PS\">\n", i)
		for bi, lines := range paragraphs(u.Text) {
			fmt.Fprintf(&b, "        <TextBlock ID=\"P%d_B%d\">\n", i, bi+1)
			for li, line := range lines {
				fmt.Fprintf(&b, "          <TextLine ID=\"P%d_B%d_L%d\"><String CONTENT=\"%s\"/></TextLine>\n", i, bi+1, li+1, xmlEscape(line))
			}
			b.WriteString("        </TextBlock>\n")
		}
		b.WriteString("      </PrintSpace>\n    </Page>\n")
	}
	b.WriteString("  </Layout>\n</alto>\n")
	return b.String(), nil
}

func cslNames(v any) []string {
	list, _ := v.([]any)
	var out []string
	for _, e := range list {
		m, ok := e.(map[string]any)
		if !ok {
			continue
		}
		if lit, ok := m["literal"].(string); ok && lit != "" {
			out = append(out, lit)
			continue
		}
		var parts []string
		for _, k := range []string{"given", "non-dropping-particle", "family"} {
			if s, ok := m[k].(string); ok && s != "" {
				parts = append(parts, s)
			}
		}
		if len(parts) > 0 {
			out = append(out, strings.Join(parts, " "))
		}
	}
	return out
}

var turnRe = regexp.MustCompile(`^\*\*([^*]+):\*\*\s*(.*)$`)

// ExportTEI writes a minimal TEI: the header from the metadata, <pb n facs>
// before each page, paragraphs, verse (<lg>/<l n>), speaker turns (<u who>)
// and notes (<note place="foot">).
func (f *File) ExportTEI() (string, error) {
	doc, err := f.documentRow()
	if err != nil {
		return "", err
	}
	units, err := f.Units()
	if err != nil {
		return "", err
	}
	md, _ := doc["metadata"].(map[string]any)
	title, _ := md["title"].(string)
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	if lang, ok := doc["language"].(string); ok && lang != "" {
		fmt.Fprintf(&b, "<TEI xmlns=\"http://www.tei-c.org/ns/1.0\" xml:lang=\"%s\">\n", xmlEscape(lang))
	} else {
		b.WriteString("<TEI xmlns=\"http://www.tei-c.org/ns/1.0\">\n")
	}
	b.WriteString("  <teiHeader>\n    <fileDesc>\n      <titleStmt>\n")
	fmt.Fprintf(&b, "        <title>%s</title>\n", xmlEscape(title))
	for _, a := range cslNames(md["author"]) {
		fmt.Fprintf(&b, "        <author>%s</author>\n", xmlEscape(a))
	}
	for _, e := range cslNames(md["editor"]) {
		fmt.Fprintf(&b, "        <editor>%s</editor>\n", xmlEscape(e))
	}
	b.WriteString("      </titleStmt>\n      <publicationStmt>\n")
	rights, _ := doc["rights"].(map[string]any)
	lic, _ := rights["license"].(string)
	holder, _ := rights["holder"].(string)
	note, _ := rights["note"].(string)
	if lic != "" || holder != "" || note != "" {
		b.WriteString("        <availability>\n")
		if lic != "" {
			fmt.Fprintf(&b, "          <licence target=\"%s\"/>\n", xmlEscape(lic))
		}
		if holder != "" {
			fmt.Fprintf(&b, "          <p>%s</p>\n", xmlEscape(holder))
		}
		if note != "" {
			fmt.Fprintf(&b, "          <p>%s</p>\n", xmlEscape(note))
		}
		b.WriteString("        </availability>\n")
	} else {
		b.WriteString("        <p>Unknown</p>\n")
	}
	b.WriteString("      </publicationStmt>\n      <sourceDesc>\n        <biblStruct>\n          <monogr>\n")
	for _, a := range cslNames(md["author"]) {
		fmt.Fprintf(&b, "            <author>%s</author>\n", xmlEscape(a))
	}
	fmt.Fprintf(&b, "            <title>%s</title>\n", xmlEscape(title))
	b.WriteString("            <imprint>")
	if s, ok := md["publisher-place"].(string); ok && s != "" {
		fmt.Fprintf(&b, "<pubPlace>%s</pubPlace>", xmlEscape(s))
	}
	if s, ok := md["publisher"].(string); ok && s != "" {
		fmt.Fprintf(&b, "<publisher>%s</publisher>", xmlEscape(s))
	}
	if y := yearOf(md); y != "" {
		fmt.Fprintf(&b, "<date when=\"%s\">%s</date>", y, y)
	}
	b.WriteString("</imprint>\n          </monogr>\n        </biblStruct>\n      </sourceDesc>\n    </fileDesc>\n  </teiHeader>\n")
	b.WriteString("  <text>\n    <body>\n")
	for _, u := range units {
		a := u.Anchor
		if a.Type() == "page" {
			b.WriteString("      <pb")
			if n, ok := folioN(a); ok {
				fmt.Fprintf(&b, " n=\"%s\"", xmlEscape(n))
			}
			if u.Image != nil {
				fmt.Fprintf(&b, " facs=\"%s\"", xmlEscape(*u.Image))
			}
			b.WriteString("/>\n")
		}
		if a.Type() == "verse" {
			from, ok := a.Int("line_from")
			if !ok {
				from = 1
			}
			b.WriteString("      <lg>\n")
			n := from
			for _, l := range strings.Split(u.Text, "\n") {
				if strings.TrimSpace(l) == "" {
					continue
				}
				fmt.Fprintf(&b, "        <l n=\"%d\">%s</l>\n", n, xmlEscape(strings.TrimSpace(l)))
				n++
			}
			b.WriteString("      </lg>\n")
		} else {
			speaker, _ := a.Str("speaker")
			for _, lines := range paragraphs(u.Text) {
				text := strings.Join(lines, " ")
				if m := turnRe.FindStringSubmatch(text); m != nil {
					fmt.Fprintf(&b, "      <u who=\"%s\">%s</u>\n", xmlEscape(m[1]), xmlEscape(m[2]))
				} else if a.Type() == "time" && speaker != "" {
					fmt.Fprintf(&b, "      <u who=\"%s\">%s</u>\n", xmlEscape(speaker), xmlEscape(text))
				} else {
					fmt.Fprintf(&b, "      <p>%s</p>\n", xmlEscape(text))
				}
			}
		}
		for _, n := range u.Notes {
			fmt.Fprintf(&b, "      <note place=\"foot\">%s</note>\n", xmlEscape(n))
		}
	}
	b.WriteString("    </body>\n  </text>\n</TEI>\n")
	return b.String(), nil
}

// ExportIIIF builds a IIIF Presentation 3 manifest: one canvas per unit
// (label = the folio of page units; unnumbered pages have none), the unit
// image as painting annotation and the text as supplementing annotation;
// audio and video as one time-based canvas with a range per unit. base is
// the prefix of the ids (default "spdf:<docref>").
func (f *File) ExportIIIF(base string) (map[string]any, error) {
	doc, err := f.documentRow()
	if err != nil {
		return nil, err
	}
	units, err := f.Units()
	if err != nil {
		return nil, err
	}
	if base == "" {
		base = "spdf:" + f.docRef()
	}
	md, _ := doc["metadata"].(map[string]any)
	lang, _ := doc["language"].(string)
	if lang == "" {
		lang = "none"
	}
	title, _ := md["title"].(string)
	if title == "" {
		title, _ = doc["id"].(string)
	}
	manifest := map[string]any{
		"@context": "http://iiif.io/api/presentation/3/context.json",
		"id":       base + "/manifest",
		"type":     "Manifest",
		"label":    map[string]any{lang: []any{title}},
	}
	timed := len(units) > 0
	for _, u := range units {
		if u.Anchor.Type() != "time" {
			timed = false
		}
	}
	textAnno := func(id, target, text string) map[string]any {
		return map[string]any{"id": id, "type": "Annotation", "motivation": "supplementing",
			"body": map[string]any{"type": "TextualBody", "value": text, "format": "text/plain"}, "target": target}
	}
	if timed {
		canvas := base + "/canvas/1"
		var duration any = doc["duration"]
		if duration == nil {
			duration = units[len(units)-1].Anchor["t1"]
		}
		media := []any{}
		if ref, ok := doc["source_ref"].(string); ok && ref != "" {
			typ := "Sound"
			if doc["kind"] == "video" {
				typ = "Video"
			}
			media = append(media, map[string]any{"id": canvas + "/media", "type": "Annotation", "motivation": "painting", "target": canvas,
				"body": map[string]any{"id": ref, "type": typ, "format": doc["mime"]}})
		}
		texts := []any{}
		ranges := []any{}
		for i, u := range units {
			t0, _ := u.Anchor.Num("t0")
			t1, _ := u.Anchor.Num("t1")
			frag := fmt.Sprintf("%s#t=%s,%s", canvas, FormatNumber(RoundFloat(t0)), FormatNumber(RoundFloat(t1)))
			texts = append(texts, textAnno(fmt.Sprintf("%s/text/%d", canvas, i+1), frag, u.Text))
			ranges = append(ranges, map[string]any{"id": fmt.Sprintf("%s/range/%d", base, i+1), "type": "Range",
				"items": []any{map[string]any{"id": frag, "type": "Canvas"}}})
		}
		manifest["items"] = []any{map[string]any{
			"id": canvas, "type": "Canvas", "duration": duration,
			"items":       []any{map[string]any{"id": canvas + "/page", "type": "AnnotationPage", "items": media}},
			"annotations": []any{map[string]any{"id": canvas + "/text", "type": "AnnotationPage", "items": texts}},
		}}
		manifest["structures"] = ranges
		return manifest, nil
	}
	items := []any{}
	index := map[string]int{}
	for i, u := range units {
		index[u.ID] = i + 1
		canvas := fmt.Sprintf("%s/canvas/%d", base, i+1)
		c := map[string]any{"id": canvas, "type": "Canvas"}
		if u.Anchor.Type() == "page" {
			if n, ok := folioN(u.Anchor); ok {
				c["label"] = map[string]any{"none": []any{n}}
			}
		} else if sl, ok := u.Anchor.Int("n"); ok && u.Anchor.Type() == "slide" {
			c["label"] = map[string]any{"none": []any{fmt.Sprintf("%d", sl)}}
		} else {
			c["label"] = map[string]any{"none": []any{fmt.Sprintf("%d", u.Ord)}}
		}
		if u.Image != nil {
			c["items"] = []any{map[string]any{"id": canvas + "/page", "type": "AnnotationPage", "items": []any{
				map[string]any{"id": canvas + "/image", "type": "Annotation", "motivation": "painting", "target": canvas,
					"body": map[string]any{"id": *u.Image, "type": "Image"}}}}}
		} else {
			c["items"] = []any{}
		}
		if u.Text != "" {
			c["annotations"] = []any{map[string]any{"id": canvas + "/text", "type": "AnnotationPage",
				"items": []any{textAnno(canvas+"/text/1", canvas, u.Text)}}}
		}
		items = append(items, c)
	}
	manifest["items"] = items
	sections, err := f.Sections()
	if err != nil {
		return nil, err
	}
	if len(sections) > 0 {
		var structures []any
		for _, s := range sections {
			from := index[s.UnitFrom]
			if from == 0 {
				from = 1
			}
			to := from
			if s.UnitTo != nil {
				if k, ok := index[*s.UnitTo]; ok {
					to = k
				}
			}
			var its []any
			for k := from; k <= to; k++ {
				its = append(its, map[string]any{"id": fmt.Sprintf("%s/canvas/%d", base, k), "type": "Canvas"})
			}
			structures = append(structures, map[string]any{"id": base + "/range/" + s.ID, "type": "Range",
				"label": map[string]any{"none": []any{s.Title}}, "items": its})
		}
		manifest["structures"] = structures
	}
	return manifest, nil
}

// PageSequence reads back the page sequence of the ALTO, TEI or IIIF export
// of this file (what the conformance suite compares, SPEC §19.4): ALTO
// {physical, printed} per Page, TEI {n} per pb, IIIF {label} per page canvas.
// It parses the exported documents themselves.
func (f *File) PageSequence(format string) ([]map[string]any, error) {
	out := []map[string]any{}
	switch format {
	case "alto", "tei":
		var text string
		var err error
		if format == "alto" {
			text, err = f.ExportALTO()
		} else {
			text, err = f.ExportTEI()
		}
		if err != nil {
			return nil, err
		}
		dec := xml.NewDecoder(strings.NewReader(text))
		for {
			tok, err := dec.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, fmt.Errorf("spdf: the %s export is not well-formed XML: %w", format, err)
			}
			se, ok := tok.(xml.StartElement)
			if !ok {
				continue
			}
			attr := func(name string) (string, bool) {
				for _, a := range se.Attr {
					if a.Name.Local == name {
						return a.Value, true
					}
				}
				return "", false
			}
			switch {
			case format == "alto" && se.Name.Local == "Page":
				phys, _ := attr("PHYSICAL_IMG_NR")
				var n int64
				fmt.Sscanf(phys, "%d", &n)
				var printed any
				if p, ok := attr("PRINTED_IMG_NR"); ok {
					printed = p
				}
				out = append(out, map[string]any{"physical": n, "printed": printed})
			case format == "tei" && se.Name.Local == "pb":
				var n any
				if v, ok := attr("n"); ok {
					n = v
				}
				out = append(out, map[string]any{"n": n})
			}
		}
		return out, nil
	case "iiif":
		m, err := f.ExportIIIF("")
		if err != nil {
			return nil, err
		}
		// Round-trip through JSON, as a consumer of the manifest would.
		g, err := ParseJSON(string(CompactJSON(m)))
		if err != nil {
			return nil, err
		}
		units, err := f.Units()
		if err != nil {
			return nil, err
		}
		items, _ := g.(map[string]any)["items"].([]any)
		for i, it := range items {
			if i >= len(units) || units[i].Anchor.Type() != "page" {
				continue
			}
			var label any
			if c, ok := it.(map[string]any); ok {
				if l, ok := c["label"].(map[string]any); ok {
					if none, ok := l["none"].([]any); ok && len(none) > 0 {
						label = none[0]
					}
				}
			}
			out = append(out, map[string]any{"label": label})
		}
		return out, nil
	}
	return nil, errf("E000", format, "unknown structure format %q", format)
}
