package spdf

import (
	"database/sql"
	"errors"
	"fmt"
)

// Typed reading of the 5.0 view (legacy files are mapped). The types are the
// same ones the Writer takes.

func (f *File) dumpObjects(key string) ([]map[string]any, error) {
	d, err := f.Dump()
	if err != nil {
		return nil, err
	}
	l, _ := d[key].([]any)
	out := make([]map[string]any, 0, len(l))
	for _, e := range l {
		if m, ok := e.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out, nil
}

// Units returns the citable units in order.
func (f *File) Units() ([]Unit, error) {
	rows, err := f.dumpObjects("units")
	if err != nil {
		return nil, err
	}
	out := make([]Unit, 0, len(rows))
	for _, u := range rows {
		unit := Unit{
			ID: reqStr(u["id"]), Anchor: anchorOf(u["anchor"]), Text: reqStr(u["text"]),
			Header: optStr(u["header"]), Footer: optStr(u["footer"]), Image: optStr(u["image"]),
			Thumbnail: optStr(u["thumbnail"]), Reader: reqStr(u["reader"]), Confidence: optFloat(u["confidence"]),
			Printed: optStr(u["printed"]), T0: optFloat(u["t0"]), T1: optFloat(u["t1"]), Words: u["words"],
			Notes: stringList(u["notes"]),
		}
		unit.Ord, _ = asInt(u["ord"])
		out = append(out, unit)
	}
	return out, nil
}

// Fragments returns the fragments in rowid order.
func (f *File) Fragments() ([]Fragment, error) {
	rows, err := f.dumpObjects("fragments")
	if err != nil {
		return nil, err
	}
	out := make([]Fragment, 0, len(rows))
	for _, r := range rows {
		fr := Fragment{ID: reqStr(r["id"]), Unit: reqStr(r["unit"]), Text: reqStr(r["text"]),
			Context: reqStr(r["context"]), Section: stringList(r["section"]), Anchor: anchorOf(r["anchor"]),
			AnchorEnd: anchorOf(r["anchor_end"]), SearchText: optStr(r["search_text"])}
		fr.N, _ = asInt(r["n"])
		fr.Ord, _ = asInt(r["ord"])
		out = append(out, fr)
	}
	return out, nil
}

// Sections returns the table of contents.
func (f *File) Sections() ([]Section, error) {
	rows, err := f.dumpObjects("sections")
	if err != nil {
		return nil, err
	}
	out := make([]Section, 0, len(rows))
	for _, s := range rows {
		sec := Section{ID: reqStr(s["id"]), Parent: optStr(s["parent"]), Title: reqStr(s["title"]),
			UnitFrom: reqStr(s["unit_from"]), UnitTo: optStr(s["unit_to"]), Summary: optStr(s["summary"])}
		sec.Level, _ = asInt(s["level"])
		out = append(out, sec)
	}
	return out, nil
}

// Figures returns the figures.
func (f *File) Figures() ([]Figure, error) {
	rows, err := f.dumpObjects("figures")
	if err != nil {
		return nil, err
	}
	out := make([]Figure, 0, len(rows))
	for _, g := range rows {
		out = append(out, Figure{ID: reqStr(g["id"]), Unit: reqStr(g["unit"]), Image: reqStr(g["image"]),
			Caption: optStr(g["caption"]), Description: optStr(g["description"]), Anchor: anchorOf(g["anchor"])})
	}
	return out, nil
}

// FragmentAnchors returns the anchor and end anchor of a fragment.
func (f *File) FragmentAnchors(id string) (Anchor, Anchor, error) {
	rows, err := f.queryRows("fragments", []string{"anchor", "anchor_end"}, "WHERE id = ?", id)
	if err != nil {
		return nil, nil, err
	}
	if len(rows) == 0 {
		return nil, nil, fmt.Errorf("spdf: no fragment %q", id)
	}
	a := f.anchorValue(rows[0]["anchor"])
	var end Anchor
	if rows[0]["anchor_end"] != nil {
		end = f.anchorValue(rows[0]["anchor_end"])
	}
	return a, end, nil
}

// Blob returns the MIME type and bytes of a blob ("blob:" prefix optional).
func (f *File) Blob(key string) (string, []byte, error) {
	if len(key) > 5 && key[:5] == "blob:" {
		key = key[5:]
	}
	var mime string
	var data []byte
	q := "SELECT " + f.selectList("blobs", []string{"mime", "data"}) + " FROM blobs WHERE " + f.col("blobs", "key") + " = ?"
	err := f.conn.QueryRowContext(f.ctx(), q, key).Scan(&mime, &data)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil, fmt.Errorf("spdf: no blob %q", key)
	}
	return mime, data, err
}

// AnchorURIOf returns the canonical URI of an anchor of this file.
func (f *File) AnchorURIOf(a, end Anchor) string { return AnchorURI(f.docRef(), a, end) }
