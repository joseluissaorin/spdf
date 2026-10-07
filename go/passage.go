package spdf

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// Passage is the citation of a quotation (SPEC §18.2).
type Passage struct {
	// Text is the short citation, e.g. "(Hooke, 1665, p. 211)".
	Text string
	// URI is the anchor URI of the quotation.
	URI string
	// Anchor and AnchorEnd are what was cited (AnchorEnd only for a
	// quotation that spans the two units of a crossing fragment).
	Anchor, AnchorEnd Anchor
}

func runeIndex(s, sub string) int {
	i := strings.Index(s, sub)
	if i < 0 {
		return -1
	}
	return utf8.RuneCountInString(s[:i])
}

func runeSlice(s string, from, to int64) string {
	r := []rune(s)
	if from < 0 {
		from = 0
	}
	if to > int64(len(r)) {
		to = int64(len(r))
	}
	if from > to {
		return ""
	}
	return string(r[from:to])
}

func stripIdentity(a any) Anchor {
	m, _ := identity(a).(map[string]any)
	return Anchor(m)
}

// CitePassage cites a quotation taken from a fragment by the unit it lies
// in, never by the start anchor of its fragment (SPEC §18.2): the start unit
// (with chars) if the quotation is in the fragment's part of it, the end
// unit if it is in the final part, or the range of both if it spans them.
func (f *File) CitePassage(fragmentID, quote, locale string) (Passage, error) {
	doc, err := f.documentRow()
	if err != nil {
		return Passage{}, err
	}
	units, err := f.tableView("units")
	if err != nil {
		return Passage{}, err
	}
	frags, err := f.tableView("fragments")
	if err != nil {
		return Passage{}, err
	}
	var fr map[string]any
	for _, x := range frags {
		if m := x.(map[string]any); m["id"] == fragmentID {
			fr = m
		}
	}
	if fr == nil {
		return Passage{}, fmt.Errorf("spdf: no fragment %q", fragmentID)
	}
	var uas []unitAnchor
	texts := map[string]string{}
	anchors := map[string]any{}
	for _, u := range units {
		um := u.(map[string]any)
		id, _ := um["id"].(string)
		uas = append(uas, unitAnchor{id, um["anchor"]})
		texts[id], _ = um["text"].(string)
		anchors[id] = um["anchor"]
	}
	q := norm.NFC.String(quote)
	qn := int64(utf8.RuneCountInString(q))
	u1, _ := fr["unit"].(string)
	t1 := texts[u1]
	c1 := [2]int64{0, int64(utf8.RuneCountInString(t1))}
	if ch, ok := Anchor(asMap(fr["anchor"])).Chars(); ok {
		c1 = ch
	}
	seg1 := runeSlice(t1, c1[0], c1[1])
	u2 := endUnit(uas, u1, fr["anchor_end"])
	var seg2 string
	var c2 [2]int64
	if u2 != nil {
		t2 := texts[u2.id]
		c2 = [2]int64{0, int64(utf8.RuneCountInString(t2))}
		if ch, ok := Anchor(asMap(fr["anchor_end"])).Chars(); ok {
			c2 = ch
		}
		seg2 = runeSlice(t2, c2[0], c2[1])
	}
	var a, end Anchor
	text, _ := fr["text"].(string)
	switch {
	case strings.Contains(seg1, q):
		i := int64(runeIndex(seg1, q)) + c1[0]
		a = stripIdentity(anchors[u1])
		a["chars"] = []any{i, i + qn}
	case u2 != nil && strings.Contains(seg2, q):
		i := int64(runeIndex(seg2, q)) + c2[0]
		a = stripIdentity(u2.anchor)
		a["chars"] = []any{i, i + qn}
	case u2 != nil && strings.Contains(text, q):
		a = stripIdentity(anchors[u1])
		end = stripIdentity(u2.anchor)
	default:
		return Passage{}, fmt.Errorf("spdf: the quote is not in fragment %q", fragmentID)
	}
	md, _ := doc["metadata"].(map[string]any)
	sha, _ := doc["source_sha256"].(string)
	return Passage{Text: Cite(a, end, md, locale), URI: AnchorURI("sha256-"+sha, a, end), Anchor: a, AnchorEnd: end}, nil
}
