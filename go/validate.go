package spdf

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// Issue is a validation error or warning.
type Issue struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Where   string `json:"where"`
}

// ValidationResult is the result of Validate (contract §12).
type ValidationResult struct {
	Valid    bool     `json:"valid"`
	Version  string   `json:"version"`
	Profile  []string `json:"profile"`
	Errors   []Issue  `json:"errors"`
	Warnings []Issue  `json:"warnings"`
}

// Generic returns the result as a generic JSON tree.
func (r ValidationResult) Generic() map[string]any {
	issues := func(l []Issue) []any {
		out := make([]any, len(l))
		for i, e := range l {
			out[i] = map[string]any{"code": e.Code, "message": e.Message, "where": e.Where}
		}
		return out
	}
	var version any = r.Version
	if r.Version == "" {
		version = nil
	}
	return map[string]any{"valid": r.Valid, "version": version, "profile": stringsAny(r.Profile),
		"errors": issues(r.Errors), "warnings": issues(r.Warnings)}
}

// ErrorCodes returns the error codes (sorted, unique).
func (r ValidationResult) ErrorCodes() []string { return codes(r.Errors) }

// WarningCodes returns the warning codes (sorted, unique).
func (r ValidationResult) WarningCodes() []string { return codes(r.Warnings) }

func codes(l []Issue) []string {
	seen := map[string]bool{}
	var out []string
	for _, e := range l {
		if !seen[e.Code] {
			seen[e.Code] = true
			out = append(out, e.Code)
		}
	}
	sort.Strings(out)
	return out
}

type validator struct {
	res ValidationResult
}

func (v *validator) err(code, where, format string, a ...any) {
	v.res.Errors = append(v.res.Errors, Issue{code, fmt.Sprintf(format, a...), where})
}

func (v *validator) warn(code, where, format string, a ...any) {
	v.res.Warnings = append(v.res.Warnings, Issue{code, fmt.Sprintf(format, a...), where})
}

// Validate checks a file against the specification and reports every problem
// found, in the order of contract §12.
func Validate(path string, opts *Options) ValidationResult {
	v := &validator{res: ValidationResult{Profile: []string{}, Errors: []Issue{}, Warnings: []Issue{}}}
	f, err := openPath(path, opts, true)
	if err != nil {
		var se *Error
		if errors.As(err, &se) {
			v.err(se.Code, se.Where, "%s", se.Message)
		} else if os.IsNotExist(err) {
			v.err("E001", path, "%v", err)
		} else {
			v.err("E001", path, "%v", err)
		}
		v.res.Valid = false
		return v.res
	}
	defer f.Close()
	v.run(f)
	v.res.Valid = len(v.res.Errors) == 0
	return v.res
}

func (v *validator) run(f *File) {
	ctx := context.Background()
	v.res.Version = f.version
	if f.gzipped && !f.legacy {
		v.warn("E003", f.path, "SPDF 5.x files must not be gzip-wrapped")
	}
	for _, e := range f.issues {
		if e.Code == "E020" {
			v.err(e.Code, e.Where, "%s", e.Message)
		}
	}
	// Required tables and columns.
	missingTable := map[string]bool{}
	for _, t := range requiredTables50 {
		if f.legacy && t == "extensions" {
			continue
		}
		if !f.hasTable(t) {
			missingTable[t] = true
			v.err("E010", t, "missing required table %s", f.table(t))
		}
	}
	for _, t := range requiredTables50 {
		cols, ok := tableColumns50[t]
		if !ok || missingTable[t] || (f.legacy && t == "extensions") {
			continue
		}
		present := f.columns[f.table(t)]
		for _, c := range cols {
			name := c
			if f.legacy {
				l := legacyColumns[t][c]
				if l == "" {
					continue // not part of 4.x
				}
				if (t == "units" && c == "words") || (t == "fragments" && c == "search_text") {
					if f.version == "4.0" {
						continue
					}
				}
				name = l
			}
			if !present[name] {
				v.err("E011", t+"."+c, "missing required column %s.%s", f.table(t), name)
			}
		}
	}
	// spdf_meta keys.
	meta, _ := f.Meta()
	if !f.legacy && !missingTable["spdf_meta"] {
		for _, k := range requiredMetaKeys {
			if _, ok := meta[k]; !ok {
				v.err("E012", k, "missing spdf_meta key %s", k)
			}
		}
	}
	if p, ok := meta["profile"]; ok {
		v.res.Profile = splitProfile(p)
	}
	// Exactly one document.
	var docMeta map[string]any
	var docKind string
	var unitCount int64 = -1
	if !missingTable["documents"] {
		rows, err := f.queryRows("documents", []string{"id", "kind", "metadata", "rights", "unit_count"}, "ORDER BY "+f.col("documents", "id"))
		if err == nil {
			if len(rows) != 1 {
				v.err("E013", "documents", "documents must hold exactly one row, found %d", len(rows))
			}
			if len(rows) > 0 {
				r := rows[0]
				docKind, _ = asString(r["kind"])
				unitCount, _ = asInt(r["unit_count"])
				ms, _ := asString(r["metadata"])
				g, perr := ParseJSON(ms)
				if perr != nil {
					v.err("E050", "documents.metadata", "invalid metadata JSON: %v", perr)
				} else if m, ok := g.(map[string]any); !ok {
					v.err("E050", "documents.metadata", "metadata is not a JSON object")
				} else {
					if f.legacy {
						m = MapLegacyMetadata(m, docKind).(map[string]any)
					}
					docMeta = m
					t, ok1 := m["type"].(string)
					ti, ok2 := m["title"].(string)
					if !ok1 || !ok2 || t == "" || ti == "" {
						v.err("E051", "documents.metadata", "metadata is not CSL-like (needs string type and title)")
					}
				}
				if rs, ok := asString(r["rights"]); ok {
					if g, err := ParseJSON(rs); err != nil {
						v.err("E050", "documents.rights", "invalid rights JSON: %v", err)
					} else if _, ok := g.(map[string]any); !ok {
						v.err("E050", "documents.rights", "rights is not a JSON object")
					}
				}
			}
		}
	}
	_ = docMeta
	// Extensions.
	for _, e := range f.issues {
		if e.Code == "E060" {
			v.err(e.Code, e.Where, "%s", e.Message)
		}
	}
	// units.ord contiguous from 1.
	unitTexts := map[string]string{}
	nUnits := 0
	hasTime := false
	if !missingTable["units"] {
		rows, err := f.queryRows("units", []string{"id", "ord", "anchor", "text"}, "ORDER BY "+f.col("units", "ord")+", "+f.col("units", "id"))
		if err == nil {
			nUnits = len(rows)
			if !f.legacy {
				for i, r := range rows {
					ord, ok := asInt(r["ord"])
					if !ok || ord != int64(i+1) {
						id, _ := asString(r["id"])
						v.err("E090", "units."+id, "units.ord not contiguous from 1 (expected %d)", i+1)
						break
					}
				}
			}
			for _, r := range rows {
				id, _ := asString(r["id"])
				t, _ := asString(r["text"])
				unitTexts[id] = t
			}
			for _, r := range rows {
				id, _ := asString(r["id"])
				a := v.checkAnchor(f, r["anchor"], "units."+id+".anchor", unitTexts[id], true)
				if a != nil && a.Type() == "time" {
					hasTime = true
				}
			}
		}
	}
	if !missingTable["fragments"] {
		rows, err := f.queryRows("fragments", []string{"id", "unit", "anchor", "anchor_end"}, "ORDER BY "+f.col("fragments", "n"))
		if err == nil {
			for _, r := range rows {
				id, _ := asString(r["id"])
				unit, _ := asString(r["unit"])
				text, known := unitTexts[unit]
				v.checkAnchor(f, r["anchor"], "fragments."+id+".anchor", text, known)
				if r["anchor_end"] != nil {
					v.checkAnchor(f, r["anchor_end"], "fragments."+id+".anchor_end", "", false)
				}
			}
		}
	}
	if !missingTable["figures"] {
		rows, err := f.queryRows("figures", []string{"id", "unit", "anchor"}, "ORDER BY "+f.col("figures", "id"))
		if err == nil {
			for _, r := range rows {
				id, _ := asString(r["id"])
				unit, _ := asString(r["unit"])
				text, known := unitTexts[unit]
				v.checkAnchor(f, r["anchor"], "figures."+id+".anchor", text, known)
			}
		}
	}
	// Spaces and vectors.
	nVectors := 0
	if !missingTable["spaces"] && !missingTable["vectors"] {
		spaces, err := f.Spaces()
		if err == nil {
			byID := map[string]Space{}
			for _, s := range spaces {
				byID[s.ID] = s
				if DTypeSize(s.DType) == 0 {
					v.err("E032", "spaces."+s.ID, "unknown dtype %q", s.DType)
				}
			}
			rows, err := f.conn.QueryContext(ctx, "SELECT "+f.selectList("vectors", []string{"target", "id", "space"})+", length("+f.col("vectors", "data")+") FROM "+
				quoteIdent(f.table("vectors"))+" ORDER BY "+f.col("vectors", "space")+", "+f.col("vectors", "target")+", "+f.col("vectors", "id"))
			if err == nil {
				for rows.Next() {
					var target, id, space string
					var n int64
					if rows.Scan(&target, &id, &space, &n) != nil {
						continue
					}
					nVectors++
					where := "vectors." + target + "." + id + "." + space
					s, ok := byID[space]
					if !ok {
						v.err("E031", where, "vector space %q unknown", space)
						continue
					}
					size := DTypeSize(s.DType)
					if size == 0 {
						continue
					}
					if n != s.Dims*int64(size) {
						v.err("E030", where, "vector length %d != dims %d × %d", n, s.Dims, size)
					}
				}
				rows.Close()
			}
		}
	}
	// FTS integrity on an in-memory copy.
	if !missingTable["fragments_fts"] && !missingTable["fragments"] {
		if err := ftsIntegrity(f); err != nil {
			v.err("E070", f.table("fragments_fts"), "FTS index out of sync: %v", err)
		}
	}
	// Blobs.
	if !f.legacy && !missingTable["blobs"] {
		rows, err := f.conn.QueryContext(ctx, "SELECT key, sha256, data FROM blobs ORDER BY key")
		if err == nil {
			for rows.Next() {
				var key, sum string
				var data []byte
				if rows.Scan(&key, &sum, &data) != nil {
					continue
				}
				h := sha256.Sum256(data)
				if !strings.EqualFold(hex.EncodeToString(h[:]), sum) {
					v.err("E080", "blobs."+key, "blob sha256 mismatch")
				}
			}
			rows.Close()
		}
	}
	// Integrity (§8).
	if want, ok := meta["content_sha256"]; ok && !f.legacy {
		got, err := f.ContentSHA256()
		if err != nil || !strings.EqualFold(got, want) {
			v.err("E081", "spdf_meta.content_sha256", "content_sha256 mismatch")
		} else if sig, ok := meta["signature"]; ok {
			if !verifySignature(got, sig, meta["signer"]) {
				v.err("E082", "spdf_meta.signature", "bad signature")
			}
		}
	} else if _, ok := meta["signature"]; ok && !f.legacy {
		v.err("E082", "spdf_meta.signature", "signature without content_sha256")
	}
	// Profile warnings.
	profile := map[string]bool{}
	for _, p := range v.res.Profile {
		profile[p] = true
	}
	if profile["semantic"] && nVectors == 0 {
		v.warn("W100", "vectors", "profile 'semantic' without vectors")
	}
	if profile["media"] && !hasTime {
		v.warn("W101", "units", "profile 'media' without time anchors")
	}
	if unitCount >= 0 && !missingTable["units"] && unitCount != int64(nUnits) {
		v.warn("W102", "documents.unit_count", "unit_count %d != %d units", unitCount, nUnits)
	}
	if !f.legacy && f.userVersion > UserVersion {
		v.warn("W105", "user_version", "newer minor version %s", f.version)
	}
	if f.legacy {
		v.warn("W110", "", "legacy SPDF %s file", f.version)
	}
}

func verifySignature(hexHash, sig, signer string) bool {
	if !strings.HasPrefix(signer, "ed25519:") {
		return false
	}
	pub, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(signer, "ed25519:"))
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return false
	}
	s, err := base64.StdEncoding.DecodeString(sig)
	if err != nil || len(s) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pub), []byte("spdf-content-sha256:"+strings.ToLower(hexHash)), s)
}

// checkAnchor reports E040/E041/E042 for one anchor and returns it if valid.
func (v *validator) checkAnchor(f *File, raw any, where, unitText string, knowText bool) Anchor {
	s, ok := asString(raw)
	if !ok {
		v.err("E040", where, "anchor is not text")
		return nil
	}
	g, err := ParseJSON(s)
	if err != nil {
		v.err("E040", where, "invalid anchor JSON: %v", err)
		return nil
	}
	if f.legacy {
		g = MapLegacyAnchor(g)
	}
	m, ok := g.(map[string]any)
	if !ok {
		v.err("E040", where, "anchor is not a JSON object")
		return nil
	}
	a := Anchor(m)
	typ, ok := m["type"].(string)
	if !ok {
		v.err("E040", where, "anchor without type")
		return nil
	}
	if !knownAnchorTypes[typ] {
		v.err("E041", where, "unknown anchor type %q", typ)
		return nil
	}
	if msg := anchorShapeError(a); msg != "" {
		v.err("E040", where, "%s", msg)
		return nil
	}
	if c, has := m["chars"]; has {
		cs, ok := a.Chars()
		if !ok {
			v.err("E040", where, "chars must be [start, end]")
			return nil
		}
		_ = c
		if knowText {
			n := int64(utf8.RuneCountInString(norm.NFC.String(unitText)))
			if cs[0] < 0 || cs[1] < cs[0] || cs[1] > n {
				v.err("E042", where, "chars [%d, %d] out of range (unit has %d code points)", cs[0], cs[1], n)
			}
		} else if cs[0] < 0 || cs[1] < cs[0] {
			v.err("E042", where, "chars [%d, %d] out of range", cs[0], cs[1])
		}
	}
	return a
}

func isInt(v any) bool {
	_, ok := v.(int64)
	return ok
}

func isNum(v any) bool {
	_, ok := asFloat(v)
	return ok
}

func isStr(v any) bool {
	_, ok := v.(string)
	return ok
}

// anchorShapeError checks the required members of each anchor type.
func anchorShapeError(a Anchor) string {
	switch a.Type() {
	case "page":
		p, ok := a["physical"].(int64)
		if !ok || p < 1 {
			return "page anchor needs integer physical >= 1"
		}
		pr, has := a["printed"]
		if !has || !(pr == nil || isStr(pr)) {
			return "page anchor needs printed (string or null)"
		}
	case "time":
		if !isNum(a["t0"]) || !isNum(a["t1"]) {
			return "time anchor needs numeric t0 and t1"
		}
	case "section":
		if _, ok := a.Path(); !ok {
			return "section anchor needs path (string[])"
		}
	case "slide":
		if !isInt(a["n"]) {
			return "slide anchor needs integer n"
		}
	case "sheet":
		if !isStr(a["sheet"]) || !isInt(a["row_from"]) || !isInt(a["row_to"]) {
			return "sheet anchor needs sheet, row_from and row_to"
		}
	case "web":
		if !isStr(a["url"]) {
			return "web anchor needs url"
		}
	case "verse":
		if !isInt(a["line_from"]) {
			return "verse anchor needs integer line_from"
		}
	case "canonical":
		if !isStr(a["scheme"]) || !isStr(a["ref"]) {
			return "canonical anchor needs scheme and ref"
		}
	}
	return ""
}

// ftsIntegrity runs FTS5 'integrity-check' (rank 1: also against the content
// table) on an in-memory copy, since the command is a write.
func ftsIntegrity(f *File) error {
	data, err := os.ReadFile(f.physical)
	if err != nil {
		return err
	}
	db, err := sql.Open("sqlite", "file::memory:?_defensive=1&_pragma=trusted_schema(0)")
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	err = conn.Raw(func(dc any) error {
		d, ok := dc.(interface{ Deserialize([]byte) error })
		if !ok {
			return fmt.Errorf("driver cannot deserialize")
		}
		return d.Deserialize(data)
	})
	if err != nil {
		return err
	}
	fts := quoteIdent(f.table("fragments_fts"))
	_, err = conn.ExecContext(ctx, "INSERT INTO "+fts+"("+fts+", rank) VALUES ('integrity-check', 1)")
	return err
}
