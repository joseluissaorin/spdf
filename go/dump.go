package spdf

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"regexp"
	"sort"
)

// JSON-in-TEXT columns of each table: parsed in the dump.
var jsonColumns = map[string]map[string]bool{
	"documents":  {"metadata": true, "rights": true},
	"units":      {"anchor": true, "notes": true, "words": true},
	"fragments":  {"section": true, "anchor": true, "anchor_end": true},
	"figures":    {"anchor": true},
	"spaces":     {"modalities": true, "task_prefixes": true},
	"provenance": {"detail": true},
}

// Columns left out of each dump array (the document id is implied).
var dumpOmit = map[string]bool{"document": true}

// Legacy spdf_meta keys renamed in the 5.0 view.
var legacyMetaKeys = map[string]string{"creado": "created", "generador": "generator"}

func parseJSONColumn(v any) any {
	s, ok := asString(v)
	if !ok {
		return v
	}
	g, err := ParseJSON(s)
	if err != nil {
		return s
	}
	return g
}

// rowsForDump reads a table, parses JSON columns and applies the legacy
// mapping, returning dump-ready objects.
func (f *File) rowsForDump(t5 string, order string) ([]any, error) {
	cols := tableColumns50[t5]
	rows, err := f.queryRows(t5, cols, order)
	if err != nil {
		return nil, err
	}
	out := make([]any, 0, len(rows))
	for _, r := range rows {
		obj := map[string]any{}
		for _, c := range cols {
			if dumpOmit[c] {
				continue
			}
			v := r[c]
			if jsonColumns[t5][c] {
				v = parseJSONColumn(v)
				if f.legacy && (c == "anchor" || c == "anchor_end") {
					v = MapLegacyAnchor(v)
				}
			}
			if s, ok := v.([]byte); ok {
				v = string(s)
			}
			obj[c] = v
		}
		out = append(out, obj)
	}
	return out, nil
}

// Meta returns the spdf_meta key/value pairs.
func (f *File) Meta() (map[string]string, error) {
	rows, err := f.queryRows("spdf_meta", []string{"key", "value"}, "")
	if err != nil {
		return nil, err
	}
	m := map[string]string{}
	for _, r := range rows {
		k, _ := asString(r["key"])
		v, _ := asString(r["value"])
		if f.legacy {
			if mk, ok := legacyMetaKeys[k]; ok {
				k = mk
			}
		}
		m[k] = v
	}
	return m, nil
}

// documentRow returns the (single) document as a dump object.
func (f *File) documentRow() (map[string]any, error) {
	rows, err := f.rowsForDump("documents", "ORDER BY "+f.col("documents", "id")+" LIMIT 1")
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	doc := rows[0].(map[string]any)
	if f.legacy {
		legacyKind, _ := doc["kind"].(string)
		if m, ok := legacyKinds[legacyKind]; ok {
			doc["kind"] = m
		}
		doc["metadata"] = MapLegacyMetadata(doc["metadata"], legacyKind)
		keys, err := f.legacyBlobKeys()
		if err != nil {
			return nil, err
		}
		doc["source_ref"] = legacyRef(doc["source_ref"], keys, false)
	}
	return doc, nil
}

// Dump returns the canonical 5.0 view of the file (contract §5) as a generic
// JSON tree. Serialize it with CanonicalJSON.
func (f *File) Dump() (map[string]any, error) {
	if f.db == nil {
		return nil, errClosed
	}
	meta, err := f.Meta()
	if err != nil {
		return nil, err
	}
	version := f.version
	if v, ok := meta["spdf_version"]; ok && v != "" {
		version = v
	}
	out := map[string]any{"spdf_version": version}
	if f.legacy {
		out["legacy"] = true
	}
	mm := map[string]any{}
	for k, v := range meta {
		mm[k] = v
	}
	out["meta"] = mm

	doc, err := f.documentRow()
	if err != nil {
		return nil, err
	}
	if doc == nil {
		out["document"] = nil
	} else {
		out["document"] = doc
	}

	for _, t := range []string{"units", "sections", "fragments", "figures", "spaces"} {
		if out[t], err = f.tableView(t); err != nil {
			return nil, err
		}
	}

	vecs, err := f.vectorDigests()
	if err != nil {
		return nil, err
	}
	out["vectors"] = vecs

	blobs, err := f.blobList()
	if err != nil {
		return nil, err
	}
	out["blobs"] = blobs

	prov, err := f.rowsForDump("provenance", "")
	if err != nil {
		return nil, err
	}
	sortProvenance(prov)
	out["provenance"] = prov
	out["fts"] = f.ftsInfo()

	exts := []any{}
	if !f.legacy && f.hasTable("extensions") {
		if exts, err = f.rowsForDump("extensions", "ORDER BY name"); err != nil {
			return nil, err
		}
	}
	out["extensions"] = exts
	for _, k := range []string{"units", "sections", "fragments", "figures", "spaces", "provenance"} {
		if out[k] == nil || len(out[k].([]any)) == 0 {
			out[k] = []any{}
		}
	}
	return out, nil
}

// DumpJSON returns the canonical dump serialized as canonical JSON.
func (f *File) DumpJSON() ([]byte, error) {
	d, err := f.Dump()
	if err != nil {
		return nil, err
	}
	return CanonicalJSON(d), nil
}

// vectorDigests: per space, the count and SHA-256 of the concatenated data
// blobs ordered by (target, id).
func (f *File) vectorDigests() (map[string]any, error) {
	out := map[string]any{}
	if !f.hasTable("vectors") {
		return out, nil
	}
	rows, err := f.conn.QueryContext(f.ctx(), "SELECT "+f.selectList("vectors", []string{"space", "data"})+
		" FROM "+quoteIdent(f.table("vectors"))+" ORDER BY "+f.col("vectors", "space")+", "+f.col("vectors", "target")+", "+f.col("vectors", "id"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type acc struct {
		n int64
		h hashWriter
	}
	accs := map[string]*acc{}
	var order []string
	for rows.Next() {
		var space string
		var data []byte
		if err := rows.Scan(&space, &data); err != nil {
			return nil, err
		}
		a, ok := accs[space]
		if !ok {
			a = &acc{h: newHash()}
			accs[space] = a
			order = append(order, space)
		}
		a.n++
		a.h.Write(data)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Strings(order)
	for _, s := range order {
		out[s] = map[string]any{"count": accs[s].n, "sha256": hex.EncodeToString(accs[s].h.Sum(nil))}
	}
	return out, nil
}

type hashWriter interface {
	Write([]byte) (int, error)
	Sum([]byte) []byte
}

func newHash() hashWriter { return sha256.New() }

func (f *File) blobList() ([]any, error) {
	out := []any{}
	if !f.hasTable("blobs") {
		return out, nil
	}
	rows, err := f.conn.QueryContext(f.ctx(), "SELECT "+f.selectList("blobs", []string{"key", "mime", "data"})+
		" FROM blobs ORDER BY "+f.col("blobs", "key"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key, mime string
		var data []byte
		if err := rows.Scan(&key, &mime, &data); err != nil {
			return nil, err
		}
		sum := sha256.Sum256(data)
		out = append(out, map[string]any{"key": key, "mime": mime, "bytes": int64(len(data)), "sha256": hex.EncodeToString(sum[:])})
	}
	return out, rows.Err()
}

// ftsInfo reports the tokenizer of the lexical index and whether the
// optional trigram index exists.
func (f *File) ftsInfo() map[string]any {
	info := map[string]any{"tokenizer": nil, "trigram": f.tables["fragments_fts_trigram"]}
	var sqlText sql.NullString
	err := f.conn.QueryRowContext(f.ctx(), "SELECT sql FROM sqlite_master WHERE name = ?", f.table("fragments_fts")).Scan(&sqlText)
	if err == nil && sqlText.Valid {
		if m := tokenizeRe.FindStringSubmatch(sqlText.String); m != nil {
			info["tokenizer"] = m[2]
		} else {
			info["tokenizer"] = "unicode61"
		}
	}
	return info
}

var tokenizeRe = regexp.MustCompile(`(?i)tokenize\s*=\s*(['"])(.*?)['"]`)

// legacyBlobKeys returns the set of blob keys of a legacy file (cached).
func (f *File) legacyBlobKeys() (map[string]bool, error) {
	if f.blobKeys != nil {
		return f.blobKeys, nil
	}
	keys := map[string]bool{}
	if f.hasTable("blobs") {
		rows, err := f.conn.QueryContext(f.ctx(), "SELECT clave FROM blobs")
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var k string
			if err := rows.Scan(&k); err != nil {
				return nil, err
			}
			keys[k] = true
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	f.blobKeys = keys
	return keys, nil
}

// legacyRef maps a legacy storage reference: ” → null (kept as ” when
// keepEmpty), a blob key → 'blob:<key>', anything else verbatim.
func legacyRef(v any, keys map[string]bool, keepEmpty bool) any {
	s, ok := asString(v)
	if !ok {
		return v
	}
	if s == "" {
		if keepEmpty {
			return ""
		}
		return nil
	}
	if keys[s] {
		return "blob:" + s
	}
	return s
}

// ContentSHA256 computes the integrity hash of §8: SHA-256 over the canonical
// dump with meta.content_sha256, meta.signature and meta.signer removed.
func (f *File) ContentSHA256() (string, error) {
	d, err := f.Dump()
	if err != nil {
		return "", err
	}
	if m, ok := d["meta"].(map[string]any); ok {
		delete(m, "content_sha256")
		delete(m, "signature")
		delete(m, "signer")
	}
	sum := sha256.Sum256(CanonicalJSON(d))
	return hex.EncodeToString(sum[:]), nil
}

// sortProvenance orders provenance entries by the UTF-8 bytes of their JCS
// serialization (contract §5, draft 1.1).
func sortProvenance(entries []any) {
	keys := make([]string, len(entries))
	for i, e := range entries {
		keys[i] = string(CanonicalJSON(e))
	}
	idx := make([]int, len(entries))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return keys[idx[a]] < keys[idx[b]] })
	sorted := make([]any, len(entries))
	for i, j := range idx {
		sorted[i] = entries[j]
	}
	copy(entries, sorted)
}

// tableView returns one array of the dump (units, sections, fragments,
// figures or spaces) in the 5.0 view, without computing the rest.
func (f *File) tableView(t string) ([]any, error) {
	switch t {
	case "units":
		units, err := f.rowsForDump("units", "ORDER BY "+f.col("units", "ord")+", "+f.col("units", "id"))
		if err != nil || !f.legacy {
			return units, err
		}
		keys, err := f.legacyBlobKeys()
		if err != nil {
			return nil, err
		}
		for i, u := range units {
			um := u.(map[string]any)
			um["ord"] = int64(i + 1)
			um["image"] = legacyRef(um["image"], keys, false)
			um["thumbnail"] = legacyRef(um["thumbnail"], keys, false)
		}
		return units, nil
	case "sections":
		return f.rowsForDump("sections", "ORDER BY "+f.col("sections", "id"))
	case "fragments":
		return f.rowsForDump("fragments", "ORDER BY "+f.col("fragments", "n"))
	case "figures":
		figures, err := f.rowsForDump("figures", "ORDER BY "+f.col("figures", "id"))
		if err != nil || !f.legacy {
			return figures, err
		}
		keys, err := f.legacyBlobKeys()
		if err != nil {
			return nil, err
		}
		for _, fg := range figures {
			fm := fg.(map[string]any)
			fm["image"] = legacyRef(fm["image"], keys, true)
		}
		return figures, nil
	case "spaces":
		spaces, err := f.rowsForDump("spaces", "ORDER BY "+f.col("spaces", "id"))
		if err != nil || !f.legacy {
			return spaces, err
		}
		for _, sp := range spaces {
			sm := sp.(map[string]any)
			if l, ok := sm["modalities"].([]any); ok {
				for i, e := range l {
					if s, ok := e.(string); ok {
						if mm, ok := legacyModalities[s]; ok {
							l[i] = mm
						}
					}
				}
			}
		}
		return spaces, nil
	}
	return nil, fmt.Errorf("spdf: no table view %q", t)
}
