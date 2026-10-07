package spdf

import (
	"encoding/base64"
	"fmt"
	"math"
	"os"
	"sort"
)

// A "source" is a full dump (contract §11): the canonical dump plus vector
// values (vectors.<space>.items = [{target, id, values}]) and blob bytes
// (blobs[].data_base64). WriteSource rebuilds the SPDF 5.0 file it describes.

func optStr(v any) *string {
	if s, ok := v.(string); ok {
		return &s
	}
	return nil
}

func optFloat(v any) *float64 {
	if f, ok := asFloat(v); ok {
		return &f
	}
	return nil
}

func optInt(v any) *int64 {
	if i, ok := asInt(v); ok {
		return &i
	}
	return nil
}

func reqStr(v any) string { s, _ := v.(string); return s }

func objList(v any) []map[string]any {
	l, _ := v.([]any)
	out := make([]map[string]any, 0, len(l))
	for _, e := range l {
		if m, ok := e.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func anchorOf(v any) Anchor {
	if m, ok := v.(map[string]any); ok {
		return Anchor(m)
	}
	return nil
}

func stringList(v any) []string {
	l, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(l))
	for _, e := range l {
		s, _ := e.(string)
		out = append(out, s)
	}
	return out
}

// ReadSource reads a source JSON file.
func ReadSource(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	g, err := ParseJSON(string(data))
	if err != nil {
		return nil, err
	}
	m, ok := g.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("source is not a JSON object")
	}
	return m, nil
}

// PackVector encodes source vector values in a dtype: f32/f16 values must be
// exactly representable, i8 values are the stored integers (−127…127).
func PackVector(values []any, dtype string) ([]byte, error) {
	switch dtype {
	case "i8":
		out := make([]byte, len(values))
		for i, v := range values {
			n, ok := v.(int64)
			if !ok || n < -127 || n > 127 {
				return nil, fmt.Errorf("i8 values are integers in [-127, 127], got %v", v)
			}
			out[i] = byte(int8(n))
		}
		return out, nil
	case "f16", "f32", "":
		fs := make([]float32, len(values))
		for i, v := range values {
			f, ok := asFloat(v)
			if !ok {
				return nil, fmt.Errorf("vector value %v is not a number", v)
			}
			fs[i] = float32(f)
			if float64(fs[i]) != f && !math.IsNaN(f) {
				return nil, fmt.Errorf("%s value %v is not exactly representable", dtype, v)
			}
		}
		return EncodeVector(fs, dtype)
	}
	return nil, fmt.Errorf("unknown dtype %q", dtype)
}

// WriteSource builds an SPDF 5.0 file at path from a source (full dump).
func WriteSource(source map[string]any, path string) error {
	fts, _ := source["fts"].(map[string]any)
	trigram, _ := fts["trigram"].(bool)
	w, err := Create(path, &WriterOptions{Exact: true, Trigram: trigram})
	if err != nil {
		return err
	}
	fail := func(err error) error {
		w.Abort()
		return err
	}
	if meta, ok := source["meta"].(map[string]any); ok {
		for k, v := range meta {
			s, _ := v.(string)
			w.SetMeta(k, s)
		}
	}
	doc, _ := source["document"].(map[string]any)
	if doc == nil {
		return fail(fmt.Errorf("source without document"))
	}
	md, _ := doc["metadata"].(map[string]any)
	rights, _ := doc["rights"].(map[string]any)
	d := Document{
		ID: reqStr(doc["id"]), Kind: reqStr(doc["kind"]), Metadata: md,
		SourceSHA256: reqStr(doc["source_sha256"]), SourceRef: optStr(doc["source_ref"]),
		Mime: reqStr(doc["mime"]), Duration: optFloat(doc["duration"]),
		Created: reqStr(doc["created"]), Updated: reqStr(doc["updated"]),
		Title: optStr(doc["title"]), Authors: optStr(doc["authors"]), Year: optInt(doc["year"]),
		Language: optStr(doc["language"]), Rights: rights,
	}
	d.Bytes, _ = asInt(doc["bytes"])
	d.UnitCount, _ = asInt(doc["unit_count"])
	if err := w.SetDocument(d); err != nil {
		return fail(err)
	}
	for _, u := range objList(source["units"]) {
		unit := Unit{
			ID: reqStr(u["id"]), Anchor: anchorOf(u["anchor"]), Text: reqStr(u["text"]),
			Header: optStr(u["header"]), Footer: optStr(u["footer"]), Image: optStr(u["image"]),
			Thumbnail: optStr(u["thumbnail"]), Reader: reqStr(u["reader"]), Confidence: optFloat(u["confidence"]),
			Printed: optStr(u["printed"]), T0: optFloat(u["t0"]), T1: optFloat(u["t1"]), Words: u["words"],
		}
		unit.Ord, _ = asInt(u["ord"])
		if u["notes"] != nil {
			unit.Notes = stringList(u["notes"])
			if unit.Notes == nil {
				unit.Notes = []string{}
			}
		}
		if err := w.AddUnit(unit); err != nil {
			return fail(err)
		}
	}
	for _, s := range objList(source["sections"]) {
		sec := Section{ID: reqStr(s["id"]), Parent: optStr(s["parent"]), Title: reqStr(s["title"]),
			UnitFrom: reqStr(s["unit_from"]), UnitTo: optStr(s["unit_to"]), Summary: optStr(s["summary"])}
		sec.Level, _ = asInt(s["level"])
		if err := w.AddSection(sec); err != nil {
			return fail(err)
		}
	}
	for _, f := range objList(source["fragments"]) {
		fr := Fragment{ID: reqStr(f["id"]), Unit: reqStr(f["unit"]), Text: reqStr(f["text"]),
			Context: reqStr(f["context"]), Anchor: anchorOf(f["anchor"]), AnchorEnd: anchorOf(f["anchor_end"]),
			SearchText: optStr(f["search_text"])}
		fr.N, _ = asInt(f["n"])
		fr.Ord, _ = asInt(f["ord"])
		if f["section"] != nil {
			fr.Section = stringList(f["section"])
			if fr.Section == nil {
				fr.Section = []string{}
			}
		}
		if err := w.AddFragment(fr); err != nil {
			return fail(err)
		}
	}
	for _, g := range objList(source["figures"]) {
		fg := Figure{ID: reqStr(g["id"]), Unit: reqStr(g["unit"]), Image: reqStr(g["image"]),
			Caption: optStr(g["caption"]), Description: optStr(g["description"]), Anchor: anchorOf(g["anchor"])}
		if err := w.AddFigure(fg); err != nil {
			return fail(err)
		}
	}
	dtypes := map[string]string{}
	for _, s := range objList(source["spaces"]) {
		sp := SpaceDef{ID: reqStr(s["id"]), Provider: reqStr(s["provider"]), Model: reqStr(s["model"]),
			Version: optStr(s["version"]), DType: reqStr(s["dtype"]), TruncatedFrom: optInt(s["truncated_from"]),
			Created: optStr(s["created"]), ModalitiesJSON: s["modalities"]}
		sp.Dims, _ = asInt(s["dims"])
		if n, ok := asInt(s["normalized"]); ok {
			b := n != 0
			sp.Normalized = &b
		}
		if tp, ok := s["task_prefixes"].(map[string]any); ok {
			sp.TaskPrefixes = tp
		}
		dtypes[sp.ID] = sp.DType
		if err := w.AddSpace(sp); err != nil {
			return fail(err)
		}
	}
	if vecs, ok := source["vectors"].(map[string]any); ok {
		spaces := make([]string, 0, len(vecs))
		for k := range vecs {
			spaces = append(spaces, k)
		}
		sort.Strings(spaces)
		for _, space := range spaces {
			v, _ := vecs[space].(map[string]any)
			for _, it := range objList(v["items"]) {
				values, _ := it["values"].([]any)
				data, err := PackVector(values, dtypes[space])
				if err != nil {
					return fail(err)
				}
				if err := w.AddVectorRaw(reqStr(it["target"]), reqStr(it["id"]), space, data); err != nil {
					return fail(err)
				}
			}
		}
	}
	for _, b := range objList(source["blobs"]) {
		data, err := base64.StdEncoding.DecodeString(reqStr(b["data_base64"]))
		if err != nil {
			return fail(fmt.Errorf("blob %v: %w", b["key"], err))
		}
		if err := w.AddBlob(reqStr(b["key"]), reqStr(b["mime"]), data); err != nil {
			return fail(err)
		}
	}
	for _, p := range objList(source["provenance"]) {
		e := ProvenanceEntry{Stage: reqStr(p["stage"]), Provider: optStr(p["provider"]), Model: optStr(p["model"]),
			Detail: p["detail"], MS: optInt(p["ms"]), At: reqStr(p["at"])}
		if err := w.AddProvenance(e); err != nil {
			return fail(err)
		}
	}
	for _, e := range objList(source["extensions"]) {
		req, _ := asInt(e["required"])
		if err := w.AddExtension(reqStr(e["name"]), reqStr(e["version"]), req != 0); err != nil {
			return fail(err)
		}
	}
	return w.Close()
}

// StripSource returns the expected dump of a source: without vector values
// and blob bytes.
func StripSource(source map[string]any) map[string]any {
	g, _ := ParseJSON(string(CompactJSON(source)))
	d := g.(map[string]any)
	if vecs, ok := d["vectors"].(map[string]any); ok {
		for _, v := range vecs {
			if m, ok := v.(map[string]any); ok {
				delete(m, "items")
			}
		}
	}
	for _, b := range objList(d["blobs"]) {
		delete(b, "data_base64")
	}
	return d
}
