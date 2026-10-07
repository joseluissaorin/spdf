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
	"math"
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
	// newerMinor: a 5.x file newer than 5.0; codes a later minor may define
	// (E041, E032) become warnings (forward compatibility).
	newerMinor bool
}

func (v *validator) err(code, where, format string, a ...any) {
	if v.newerMinor && (code == "E041" || code == "E032") {
		v.warn(code, where, format, a...)
		return
	}
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

func (f *File) schemaObjects(types ...string) [][2]string {
	ph := strings.TrimSuffix(strings.Repeat("?,", len(types)), ",")
	args := make([]any, len(types))
	for i, t := range types {
		args[i] = t
	}
	rows, err := f.conn.QueryContext(f.ctx(), "SELECT name, type FROM sqlite_master WHERE type IN ("+ph+") ORDER BY name", args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out [][2]string
	for rows.Next() {
		var n, t string
		if rows.Scan(&n, &t) == nil {
			out = append(out, [2]string{n, t})
		}
	}
	return out
}

func (v *validator) run(f *File) {
	ctx := context.Background()
	v.res.Version = f.version
	if f.legacy {
		v.warn("W110", "", "legacy SPDF %s file", f.version)
		for _, t := range []string{"spdf", "documentos", "unidades", "fragmentos", "fragmentos_fts"} {
			if !f.tables[t] {
				v.err("E010", t, "missing legacy table %s", t)
			}
		}
		for _, o := range f.schemaObjects("trigger", "view") {
			if !(o[1] == "trigger" && legacyTriggers[o[0]]) {
				v.err("E020", o[0], "%s %s present", o[1], o[0])
			}
		}
		return
	}
	if f.gzipped {
		v.warn("E003", f.path, "SPDF 5.x files should not be gzip-wrapped")
	}
	if f.version != "5.0" {
		v.warn("W105", "user_version", "newer minor version %s", f.version)
		v.newerMinor = true
	}
	for _, o := range f.schemaObjects("trigger", "view") {
		v.err("E020", o[0], "%s %s present", o[1], o[0])
	}
	for _, name := range f.foreignVirtualTables() {
		v.err("E020", name, "virtual table %s present", name)
	}
	// Required tables and columns.
	present := map[string]map[string]bool{}
	for _, t := range requiredTables50 {
		if !f.tables[t] {
			v.err("E010", t, "missing table %s", t)
			continue
		}
		if t == "fragments_fts" {
			present[t] = map[string]bool{}
			continue
		}
		have := f.columns[t]
		present[t] = have
		for _, c := range tableColumns50[t] {
			if !have[c] {
				v.err("E011", t+"."+c, "missing column %s.%s", t, c)
			}
		}
	}
	has := func(t string, cols ...string) bool {
		p, ok := present[t]
		if !ok {
			return false
		}
		for _, c := range cols {
			if !p[c] {
				return false
			}
		}
		return true
	}
	meta := map[string]string{}
	if has("spdf_meta", "key", "value") {
		meta, _ = f.Meta()
		for _, k := range requiredMetaKeys {
			if _, ok := meta[k]; !ok {
				v.err("E012", k, "missing spdf_meta key %s", k)
			}
		}
		v.res.Profile = splitProfile(meta["profile"])
	}
	// Documents.
	var unitCount any
	nDocs := 0
	if has("documents", "id", "metadata") {
		cols := []string{"id", "metadata", "rights", "unit_count"}
		if !has("documents", "rights", "unit_count") {
			cols = []string{"id", "metadata"}
		}
		rows, err := f.queryRows("documents", cols, "")
		if err == nil {
			nDocs = len(rows)
			if nDocs != 1 {
				v.err("E013", "documents", "documents has %d rows", nDocs)
			} else {
				unitCount = rows[0]["unit_count"]
			}
			for _, r := range rows {
				id, _ := asString(r["id"])
				ms, _ := asString(r["metadata"])
				g, perr := ParseJSON(ms)
				if perr != nil || r["metadata"] == nil {
					v.err("E050", id, "metadata is not valid JSON")
				} else {
					m, ok := g.(map[string]any)
					_, okT := m["type"].(string)
					_, okTi := m["title"].(string)
					if !ok || !okT || !okTi {
						v.err("E051", id, "metadata needs a string type and title")
					}
				}
				if rs, ok := asString(r["rights"]); ok {
					if _, err := ParseJSON(rs); err != nil {
						v.err("E050", id, "rights is not valid JSON")
					}
				}
			}
		}
	}
	// Extensions.
	if has("extensions", "name", "required") {
		rows, err := f.conn.QueryContext(ctx, "SELECT name, required FROM extensions ORDER BY name")
		if err == nil {
			for rows.Next() {
				var name string
				var req any
				if rows.Scan(&name, &req) != nil {
					continue
				}
				if legacyTruthy(normalizeSQLValue(req)) && !knownExtensions[name] {
					v.err("E060", name, "unknown required extension %s", name)
				}
			}
			rows.Close()
		}
	}
	// Units, fragments, figures.
	texts := map[string]string{}
	hasTime := false
	if has("units", "id", "ord", "anchor", "text") {
		rows, err := f.queryRows("units", []string{"id", "ord", "anchor", "text"}, "ORDER BY ord, id")
		if err == nil {
			for i, r := range rows {
				ord, ok := asInt(r["ord"])
				if !ok || ord != int64(i+1) {
					v.err("E090", "units", "units.ord is not 1..N")
					break
				}
			}
			if nDocs == 1 && unitCount != nil {
				if uc, ok := asInt(unitCount); !ok || uc != int64(len(rows)) {
					v.warn("W102", "documents.unit_count", "unit_count %v but %d units", unitCount, len(rows))
				}
			}
			for _, r := range rows {
				id, _ := asString(r["id"])
				t, _ := asString(r["text"])
				texts[id] = t
				if a := v.checkAnchor(r["anchor"], "units/"+id, &t); a != nil && a.Type() == "time" {
					hasTime = true
				}
			}
		}
	}
	if has("fragments", "id", "unit", "anchor") {
		cols := []string{"id", "unit", "anchor", "anchor_end"}
		rows, err := f.queryRows("fragments", cols, "ORDER BY n")
		if err == nil {
			for _, r := range rows {
				id, _ := asString(r["id"])
				unit, _ := asString(r["unit"])
				var tp *string
				if t, ok := texts[unit]; ok {
					tp = &t
				}
				v.checkAnchor(r["anchor"], "fragments/"+id, tp)
				if r["anchor_end"] != nil {
					v.checkAnchor(r["anchor_end"], "fragments/"+id+"/anchor_end", nil)
				}
			}
		}
	}
	if has("figures", "id", "unit", "anchor") {
		rows, err := f.queryRows("figures", []string{"id", "unit", "anchor"}, "ORDER BY id")
		if err == nil {
			for _, r := range rows {
				id, _ := asString(r["id"])
				unit, _ := asString(r["unit"])
				var tp *string
				if t, ok := texts[unit]; ok {
					tp = &t
				}
				v.checkAnchor(r["anchor"], "figures/"+id, tp)
			}
		}
	}
	// Spaces and vectors.
	type spaceInfo struct {
		dims  int64
		dtype string
	}
	spaces := map[string]spaceInfo{}
	if has("spaces", "id", "dims", "dtype") {
		rows, err := f.queryRows("spaces", []string{"id", "dims", "dtype"}, "ORDER BY id")
		if err == nil {
			for _, r := range rows {
				id, _ := asString(r["id"])
				dims, _ := asInt(r["dims"])
				dt, _ := asString(r["dtype"])
				spaces[id] = spaceInfo{dims, dt}
				if DTypeSize(dt) == 0 {
					v.err("E032", id, "unknown dtype %q", dt)
				}
			}
		}
	}
	nVectors := 0
	if has("vectors", "target", "id", "space", "data") {
		rows, err := f.conn.QueryContext(ctx, "SELECT target, id, space, typeof(data), length(data) FROM vectors ORDER BY space, target, id")
		if err == nil {
			for rows.Next() {
				var target, id, space, typ any
				var n int64
				if rows.Scan(&target, &id, &space, &typ, &n) != nil {
					continue
				}
				nVectors++
				ss, _ := asString(space)
				ts, _ := asString(target)
				is, _ := asString(id)
				where := "vectors/" + ss + "/" + ts + "/" + is
				sp, ok := spaces[ss]
				if !ok {
					v.err("E031", where, "unknown space %s", ss)
					continue
				}
				size := DTypeSize(sp.dtype)
				if size == 0 {
					continue
				}
				if t, _ := asString(typ); t != "blob" || n != sp.dims*int64(size) {
					v.err("E030", where, "vector length %d != %d x %d", n, sp.dims, size)
				}
			}
			rows.Close()
		}
	}
	// FTS integrity on an in-memory copy.
	if f.tables["fragments_fts"] {
		if err := ftsIntegrity(f); err != nil {
			v.err("E070", "fragments_fts", "FTS index out of sync: %v", err)
		}
	}
	// Blobs.
	if has("blobs", "key", "sha256", "data") {
		rows, err := f.conn.QueryContext(ctx, "SELECT key, sha256, data FROM blobs ORDER BY key")
		if err == nil {
			for rows.Next() {
				var key, sum any
				var data []byte
				if rows.Scan(&key, &sum, &data) != nil {
					continue
				}
				h := sha256.Sum256(data)
				ks, _ := asString(key)
				if ss, _ := asString(sum); hex.EncodeToString(h[:]) != ss {
					v.err("E080", ks, "blob sha256 mismatch")
				}
			}
			rows.Close()
		}
	}
	// Integrity (§8).
	if want, ok := meta["content_sha256"]; ok && len(v.res.Errors) == 0 {
		got, err := f.ContentSHA256()
		if err != nil || got != want {
			v.err("E081", "spdf_meta.content_sha256", "content_sha256 does not match the canonical dump")
		} else if sig, ok := meta["signature"]; ok {
			if !verifySignature(want, sig, meta["signer"]) {
				v.err("E082", "spdf_meta.signature", "signature does not verify")
			}
		}
	}
	// Profile warnings.
	profile := map[string]bool{}
	for _, p := range v.res.Profile {
		profile[p] = true
	}
	if profile["semantic"] && nVectors == 0 {
		v.warn("W100", "", "profile semantic without vectors")
	}
	if profile["media"] && has("units", "anchor") && !hasTime {
		v.warn("W101", "", "profile media without time anchors")
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
// text is the NFC text of the anchor's unit, or nil if unknown.
func (v *validator) checkAnchor(raw any, where string, text *string) Anchor {
	s, ok := asString(raw)
	if !ok {
		v.err("E040", where, "anchor is not valid JSON")
		return nil
	}
	g, err := ParseJSON(s)
	if err != nil {
		v.err("E040", where, "anchor is not valid JSON")
		return nil
	}
	code, msg := CheckAnchor(g, text)
	if code != "" {
		v.err(code, where, "%s", msg)
		return nil
	}
	return Anchor(g.(map[string]any))
}

// CheckAnchor checks a parsed anchor (contract §3 and §12). It returns
// ("", "") when the anchor is valid, else the error code and a message.
// text, if not nil, is the unit text that "chars" must fit in.
func CheckAnchor(g any, text *string) (string, string) {
	m, ok := g.(map[string]any)
	if !ok {
		return "E040", "anchor is not an object"
	}
	a := Anchor(m)
	typ, ok := m["type"].(string)
	if !ok {
		return "E040", "anchor without type"
	}
	if !knownAnchorTypes[typ] {
		return "E041", fmt.Sprintf("unknown anchor type %q", typ)
	}
	if msg := anchorShapeError(a); msg != "" {
		return "E040", msg
	}
	if r, has := m["region"]; has {
		rm, ok := r.(map[string]any)
		if !ok || !isNum(rm["x"]) || !isNum(rm["y"]) || !isNum(rm["w"]) || !isNum(rm["h"]) {
			return "E040", "bad region"
		}
	}
	if c, has := m["chars"]; has {
		l, ok := c.([]any)
		if !ok || len(l) != 2 || !isInt(l[0]) || !isInt(l[1]) {
			return "E040", "bad chars"
		}
		if text != nil {
			n := int64(utf8.RuneCountInString(norm.NFC.String(*text)))
			s, e := intOf(l[0]), intOf(l[1])
			if !(0 <= s && s <= e && e <= n) {
				return "E042", fmt.Sprintf("chars [%d, %d] out of range (unit text has %d code points)", s, e, n)
			}
		}
	}
	return "", ""
}

// isInt: a JSON number with an integral value (10 and 10.0 are the same JSON value).
func isInt(v any) bool {
	switch t := v.(type) {
	case int64:
		return true
	case float64:
		return t == math.Trunc(t) && !math.IsInf(t, 0)
	}
	return false
}

func intOf(v any) int64 {
	switch t := v.(type) {
	case int64:
		return t
	case float64:
		return int64(t)
	}
	return 0
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
		if !isInt(a["physical"]) || intOf(a["physical"]) < 1 {
			return "page anchor needs integer physical >= 1"
		}
		pr, has := a["printed"]
		if !has || !(pr == nil || isStr(pr)) {
			return "page anchor needs printed (string or null)"
		}
	case "time":
		t0, ok0 := asFloat(a["t0"])
		t1, ok1 := asFloat(a["t1"])
		if !ok0 || !ok1 || !(0 <= t0 && t0 <= t1) {
			return "time anchor needs numeric 0 <= t0 <= t1"
		}
	case "section":
		if _, ok := a.Path(); !ok {
			return "section anchor needs path (string[])"
		}
	case "slide":
		if !isInt(a["n"]) || intOf(a["n"]) < 1 {
			return "slide anchor needs integer n >= 1"
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
	tables := []string{f.table("fragments_fts")}
	if f.tables["fragments_fts_trigram"] {
		tables = append(tables, "fragments_fts_trigram")
	}
	for _, t := range tables {
		q := quoteIdent(t)
		if _, err := conn.ExecContext(ctx, "INSERT INTO "+q+"("+q+", rank) VALUES ('integrity-check', 1)"); err != nil {
			return err
		}
	}
	return nil
}
