// Package conformance runs the SPDF conformance suite (conformance/ in the
// repository) against the Go implementation and builds the report of
// contract §11: {"impl","version","passed","failed","skipped"}.
package conformance

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"

	spdf "github.com/joseluissaorin/spdf/go"
)

// Failure is a failed case.
type Failure struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

// Report is the runner output.
type Report struct {
	Impl    string    `json:"impl"`
	Version string    `json:"version"`
	Passed  []string  `json:"passed"`
	Failed  []Failure `json:"failed"`
	Skipped []Failure `json:"skipped"`
}

// Generic returns the report as a generic JSON tree.
func (r Report) Generic() map[string]any {
	passed := make([]any, len(r.Passed))
	for i, p := range r.Passed {
		passed[i] = p
	}
	fl := func(l []Failure) []any {
		out := make([]any, len(l))
		for i, f := range l {
			out[i] = map[string]any{"id": f.ID, "reason": f.Reason}
		}
		return out
	}
	return map[string]any{"impl": r.Impl, "version": r.Version, "passed": passed, "failed": fl(r.Failed), "skipped": fl(r.Skipped)}
}

// JSON serializes the report (keys sorted, one line).
func (r Report) JSON() []byte { return spdf.CompactJSON(r.Generic()) }

const tolerance = 1e-6

// Run executes every case in dir/cases (discovered by listing the folder).
func Run(dir string) (Report, error) {
	rep := Report{Impl: spdf.ImplName, Version: spdf.Version, Passed: []string{}, Failed: []Failure{}, Skipped: []Failure{}}
	files, err := filepath.Glob(filepath.Join(dir, "cases", "*.json"))
	if err != nil {
		return rep, err
	}
	if len(files) == 0 {
		return rep, fmt.Errorf("no cases in %s", filepath.Join(dir, "cases"))
	}
	sort.Strings(files)
	for _, p := range files {
		id := strings.TrimSuffix(filepath.Base(p), ".json")
		reason := runFile(dir, p, &id)
		if reason == "" {
			rep.Passed = append(rep.Passed, id)
		} else {
			rep.Failed = append(rep.Failed, Failure{ID: id, Reason: reason})
		}
	}
	return rep, nil
}

func runFile(dir, path string, id *string) (reason string) {
	defer func() {
		if r := recover(); r != nil {
			reason = fmt.Sprintf("panic: %v", r)
		}
	}()
	data, err := os.ReadFile(path)
	if err != nil {
		return err.Error()
	}
	g, err := spdf.ParseJSON(string(data))
	if err != nil {
		return "invalid case JSON: " + err.Error()
	}
	c, _ := g.(map[string]any)
	if s, ok := c["id"].(string); ok {
		*id = s
	}
	kind, _ := c["kind"].(string)
	in, _ := c["input"].(map[string]any)
	exp, _ := c["expect"].(map[string]any)
	return RunCase(dir, kind, in, exp)
}

func str(v any) string { s, _ := v.(string); return s }

func anchorOf(v any) spdf.Anchor {
	if m, ok := v.(map[string]any); ok {
		return spdf.Anchor(m)
	}
	return nil
}

func readJSON(path string) (any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return spdf.ParseJSON(string(data))
}

func toFloats(v any) []float64 {
	l, _ := v.([]any)
	out := make([]float64, len(l))
	for i, e := range l {
		switch t := e.(type) {
		case int64:
			out[i] = float64(t)
		case float64:
			out[i] = t
		}
	}
	return out
}

// RunCase runs one case and returns "" when it passes, else the reason.
func RunCase(dir, kind string, in, exp map[string]any) string {
	switch kind {
	case "dump", "legacy_dump":
		f, err := spdf.Open(filepath.Join(dir, str(in["file"])), nil)
		if err != nil {
			return "open: " + err.Error()
		}
		defer f.Close()
		d, err := f.Dump()
		if err != nil {
			return "dump: " + err.Error()
		}
		want, err := readJSON(filepath.Join(dir, str(exp["dump"])))
		if err != nil {
			return "expected dump: " + err.Error()
		}
		got, _ := spdf.ParseJSON(string(spdf.CanonicalJSON(d)))
		if diff := spdf.JSONDiff(got, want); diff != "" {
			return "dump differs at " + diff
		}
		h, err := f.ContentSHA256()
		if err != nil {
			return "content_sha256: " + err.Error()
		}
		if h != str(exp["content_sha256"]) {
			return "content_sha256 " + h + " != " + str(exp["content_sha256"])
		}
		return ""
	case "roundtrip":
		src, err := spdf.ReadSource(filepath.Join(dir, str(in["source"])))
		if err != nil {
			return "source: " + err.Error()
		}
		tmp, err := os.MkdirTemp("", "spdf-roundtrip-")
		if err != nil {
			return err.Error()
		}
		defer os.RemoveAll(tmp)
		out := filepath.Join(tmp, "x.spdf")
		if err := spdf.WriteSource(src, out); err != nil {
			return "write: " + err.Error()
		}
		f, err := spdf.Open(out, nil)
		if err != nil {
			return "reopen: " + err.Error()
		}
		defer f.Close()
		d, err := f.Dump()
		if err != nil {
			return "dump: " + err.Error()
		}
		want, err := readJSON(filepath.Join(dir, str(exp["dump"])))
		if err != nil {
			return "expected dump: " + err.Error()
		}
		got, _ := spdf.ParseJSON(string(spdf.CanonicalJSON(d)))
		if diff := spdf.JSONDiff(got, want); diff != "" {
			return "roundtrip dump differs at " + diff
		}
		return ""
	case "validate":
		r := spdf.Validate(filepath.Join(dir, str(in["file"])), nil)
		var version any = r.Version
		if r.Version == "" {
			version = nil
		}
		got := map[string]any{"valid": r.Valid, "version": version,
			"errors": stringsAny(r.ErrorCodes()), "warnings": stringsAny(r.WarningCodes())}
		want := map[string]any{"valid": exp["valid"], "version": exp["version"],
			"errors": sortedStrings(exp["errors"]), "warnings": sortedStrings(exp["warnings"])}
		if diff := spdf.JSONDiff(got, want); diff != "" {
			return fmt.Sprintf("got %s (%s)", spdf.CompactJSON(got), diff)
		}
		return ""
	case "search_lexical", "search_vector", "search_hybrid":
		f, err := spdf.Open(filepath.Join(dir, str(in["file"])), nil)
		if err != nil {
			return "open: " + err.Error()
		}
		defer f.Close()
		limit := 10
		if l, ok := in["limit"].(int64); ok {
			limit = int(l)
		}
		var hits []spdf.Hit
		switch kind {
		case "search_lexical":
			lq := spdf.CompileLexical(str(in["query"]))
			route, match := f.LexicalRoute(lq, str(in["query"]))
			var wantMatch any = exp["match"]
			var gotMatch any = match
			if match == "" {
				gotMatch = nil
			}
			if route != str(exp["route"]) || !spdf.JSONEqual(gotMatch, wantMatch) {
				return fmt.Sprintf("route/match %s/%v != %v/%v", route, gotMatch, exp["route"], wantMatch)
			}
			hits, err = f.SearchLexical(str(in["query"]), limit)
		case "search_vector":
			target := str(in["target"])
			hits, err = f.SearchVector(toFloats(in["query_vector"]), str(in["space"]), target, limit)
		default:
			hits, err = f.SearchHybrid(str(in["query"]), toFloats(in["query_vector"]), str(in["space"]), limit)
		}
		if err != nil {
			return "search: " + err.Error()
		}
		return compareResults(hits, exp["results"], kind != "search_vector")
	case "anchor_uri":
		if _, ok := in["anchor"]; ok {
			docref := str(in["docref"])
			u := spdf.AnchorURI(docref, anchorOf(in["anchor"]), anchorOf(in["anchor_end"]))
			if u != str(exp["uri"]) {
				return "format gives " + u
			}
			ref, loc, err := spdf.ParseURI(u)
			if err != nil {
				return "parse: " + err.Error()
			}
			got := map[string]any{"docref": ref, "locator": loc.Generic()}
			want := map[string]any{"docref": docref, "locator": exp["locator"]}
			if diff := spdf.JSONDiff(got, want); diff != "" {
				return "parse differs at " + diff
			}
			if spdf.FormatURI(ref, loc) != u {
				return "no round trip"
			}
			return ""
		}
		if e, _ := exp["error"].(bool); e {
			if _, _, err := spdf.ParseURI(str(in["uri"])); err == nil {
				return "accepted an invalid URI"
			}
			return ""
		}
		ref, loc, err := spdf.ParseURI(str(in["uri"]))
		if err != nil {
			return "parse: " + err.Error()
		}
		got := map[string]any{"docref": ref, "locator": loc.Generic()}
		want := map[string]any{"docref": exp["docref"], "locator": exp["locator"]}
		if diff := spdf.JSONDiff(got, want); diff != "" {
			return "parse differs at " + diff
		}
		if c := spdf.FormatURI(ref, loc); c != str(exp["canonical"]) {
			return "canonical form " + c
		}
		return ""
	case "cite":
		md, _ := in["metadata"].(map[string]any)
		t := spdf.Cite(anchorOf(in["anchor"]), anchorOf(in["anchor_end"]), md, str(in["locale"]))
		if t != str(exp["text"]) {
			return fmt.Sprintf("got %q", t)
		}
		return ""
	}
	return "unknown kind " + kind
}

func stringsAny(l []string) []any {
	out := make([]any, len(l))
	for i, s := range l {
		out[i] = s
	}
	return out
}

func sortedStrings(v any) []any {
	l, _ := v.([]any)
	set := map[string]bool{}
	for _, e := range l {
		if s, ok := e.(string); ok {
			set[s] = true
		}
	}
	out := make([]string, 0, len(set))
	for s := range set {
		out = append(out, s)
	}
	sort.Strings(out)
	return stringsAny(out)
}

func compareResults(hits []spdf.Hit, expected any, withVia bool) string {
	exp, _ := expected.([]any)
	gotIDs := make([]string, len(hits))
	for i, h := range hits {
		gotIDs[i] = h.ID
	}
	wantIDs := make([]string, len(exp))
	for i, e := range exp {
		wantIDs[i] = str(e.(map[string]any)["fragment_id"])
	}
	if strings.Join(gotIDs, ",") != strings.Join(wantIDs, ",") {
		return fmt.Sprintf("order %v != %v", gotIDs, wantIDs)
	}
	for i, e := range exp {
		em := e.(map[string]any)
		h := hits[i]
		ws, _ := em["score"].(float64)
		if wi, ok := em["score"].(int64); ok {
			ws = float64(wi)
		}
		if math.Abs(h.Score-ws) > tolerance {
			return fmt.Sprintf("%s: score %v != %v", h.ID, h.Score, ws)
		}
		if h.AnchorURI != str(em["anchor_uri"]) {
			return fmt.Sprintf("%s: anchor_uri %s != %s", h.ID, h.AnchorURI, str(em["anchor_uri"]))
		}
		if v, ok := em["via"]; ok && withVia {
			if !spdf.JSONEqual(stringsAny(h.Via), v) {
				return fmt.Sprintf("%s: via %v != %v", h.ID, h.Via, v)
			}
		}
	}
	return ""
}
