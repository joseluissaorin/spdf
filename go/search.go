package spdf

import (
	"encoding/binary"
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Hit is a search result (contract §6).
type Hit struct {
	// FragmentID is set for fragment results; ID and Target identify any result.
	FragmentID string   `json:"fragment_id,omitempty"`
	Target     string   `json:"target"`
	ID         string   `json:"id"`
	Score      float64  `json:"score"`
	Via        []string `json:"via"`
	Anchor     Anchor   `json:"anchor"`
	AnchorEnd  Anchor   `json:"anchor_end,omitempty"`
	AnchorURI  string   `json:"anchor_uri"`
	// N is the fragment rowid (or unit ord) used to break ties.
	N int64 `json:"-"`
}

// Generic returns the hit as the result item of the contract.
func (h Hit) Generic() map[string]any {
	m := map[string]any{
		"score":      h.Score,
		"via":        stringsAny(h.Via),
		"anchor":     map[string]any(h.Anchor),
		"anchor_uri": h.AnchorURI,
	}
	if h.Target == "fragment" || h.Target == "" {
		m["fragment_id"] = h.ID
	} else {
		m["target"] = h.Target
		m["id"] = h.ID
	}
	return m
}

func stringsAny(v []string) []any {
	out := make([]any, len(v))
	for i, s := range v {
		out[i] = s
	}
	return out
}

// LexicalQuery is the compiled form of a query (contract §6, steps 1-5).
type LexicalQuery struct {
	Terms   []string // as written (NFC)
	Phrases bool     // true if the terms are phrases (joined with AND)
	Match   string   // FTS5 MATCH expression; "" if there are no terms
}

var phraseClose = map[rune][]rune{'"': {'"'}, '“': {'”'}, '«': {'»'}, '„': {'“', '”'}}

func isWordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsMark(r) || unicode.IsNumber(r)
}

func wordsOf(rs []rune) []string {
	var out []string
	start := -1
	for i, r := range rs {
		if isWordRune(r) {
			if start < 0 {
				start = i
			}
		} else if start >= 0 {
			out = append(out, string(rs[start:i]))
			start = -1
		}
	}
	if start >= 0 {
		out = append(out, string(rs[start:]))
	}
	return out
}

func dedupKey(t string) string {
	d := norm.NFD.String(t)
	var b strings.Builder
	for _, r := range d {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		b.WriteRune(r)
	}
	return strings.ToLower(b.String())
}

// CompileLexical turns a user query into FTS5 terms (contract §6).
func CompileLexical(query string) LexicalQuery {
	rs := []rune(norm.NFC.String(query))
	var phrases []string
	var loose []rune // text outside phrases, phrase marks become separators
	for i := 0; i < len(rs); i++ {
		r := rs[i]
		closers, opens := phraseClose[r]
		if !opens {
			loose = append(loose, r)
			continue
		}
		end := -1
		for j := i + 1; j < len(rs); j++ {
			for _, c := range closers {
				if rs[j] == c {
					end = j
					break
				}
			}
			if end >= 0 {
				break
			}
		}
		if end < 0 {
			loose = append(loose, ' ')
			continue
		}
		phrases = append(phrases, strings.Join(wordsOf(rs[i+1:end]), " "))
		loose = append(loose, ' ')
		i = end
	}
	var terms []string
	isPhrase := false
	nonEmpty := []string{}
	for _, p := range phrases {
		if p != "" {
			nonEmpty = append(nonEmpty, p)
		}
	}
	if len(nonEmpty) > 0 {
		terms = nonEmpty
		isPhrase = true
	} else {
		terms = wordsOf(loose)
	}
	seen := map[string]bool{}
	var dedup []string
	for _, t := range terms {
		k := dedupKey(t)
		if seen[k] {
			continue
		}
		seen[k] = true
		dedup = append(dedup, t)
	}
	lq := LexicalQuery{Terms: dedup, Phrases: isPhrase}
	if len(dedup) == 0 {
		return lq
	}
	quoted := make([]string, len(dedup))
	for i, t := range dedup {
		quoted[i] = `"` + strings.ReplaceAll(t, `"`, `""`) + `"`
	}
	sep := " OR "
	if isPhrase {
		sep = " AND "
	}
	lq.Match = strings.Join(quoted, sep)
	return lq
}

var cjkRanges = [][2]rune{
	{0x2E80, 0x2FDF}, {0x3040, 0x30FF}, {0x3100, 0x312F}, {0x3130, 0x318F}, {0x31A0, 0x31FF},
	{0x3400, 0x4DBF}, {0x4E00, 0x9FFF}, {0xA960, 0xA97F}, {0xAC00, 0xD7AF}, {0xF900, 0xFAFF},
	{0xFF66, 0xFF9F}, {0x20000, 0x3FFFF},
}

func hasCJK(s string) bool {
	for _, r := range s {
		for _, rg := range cjkRanges {
			if r >= rg[0] && r <= rg[1] {
				return true
			}
		}
	}
	return false
}

// docRef returns the docref of the file's document ("sha256-<hex>", or the id).
func (f *File) docRef() string {
	var sha, id any
	q := "SELECT " + f.col("documents", "source_sha256") + ", id FROM " + quoteIdent(f.table("documents")) + " ORDER BY id LIMIT 1"
	if err := f.conn.QueryRowContext(f.ctx(), q).Scan(&sha, &id); err == nil {
		if s, ok := asString(sha); ok && s != "" {
			return DocRef(s)
		}
		if s, ok := asString(id); ok {
			return s
		}
	}
	return ""
}

func (f *File) ftsColumnCount(table string) int {
	var sqlText string
	if err := f.conn.QueryRowContext(f.ctx(), "SELECT sql FROM sqlite_master WHERE name = ?", table).Scan(&sqlText); err != nil {
		return 4
	}
	if strings.Contains(sqlText, "search_text") || strings.Contains(sqlText, "texto_busqueda") {
		return 4
	}
	return 3
}

// fragmentInfo loads id, anchor and anchor_end of fragments by n.
func (f *File) fragmentInfo(ns []int64) (map[int64][3]any, error) {
	out := map[int64][3]any{}
	if len(ns) == 0 {
		return out, nil
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(ns)), ",")
	args := make([]any, len(ns))
	for i, n := range ns {
		args[i] = n
	}
	rows, err := f.queryRows("fragments", []string{"n", "id", "anchor", "anchor_end"}, "WHERE "+f.col("fragments", "n")+" IN ("+ph+")", args...)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		n, _ := asInt(r["n"])
		out[n] = [3]any{r["id"], r["anchor"], r["anchor_end"]}
	}
	return out, nil
}

func (f *File) anchorValue(v any) Anchor {
	g := parseJSONColumn(v)
	if f.legacy {
		g = MapLegacyAnchor(g)
	}
	if m, ok := g.(map[string]any); ok {
		return Anchor(m)
	}
	return nil
}

func (f *File) fragmentHits(ns []int64, scores []float64, via string) ([]Hit, error) {
	info, err := f.fragmentInfo(ns)
	if err != nil {
		return nil, err
	}
	ref := f.docRef()
	hits := make([]Hit, 0, len(ns))
	for i, n := range ns {
		inf := info[n]
		id, _ := asString(inf[0])
		a := f.anchorValue(inf[1])
		var end Anchor
		if inf[2] != nil {
			end = f.anchorValue(inf[2])
		}
		hits = append(hits, Hit{
			FragmentID: id, Target: "fragment", ID: id, Score: scores[i], Via: []string{via},
			Anchor: a, AnchorEnd: end, AnchorURI: AnchorURI(ref, a, end), N: n,
		})
	}
	return hits, nil
}

// LexicalRoute reports how a compiled query is executed on this file:
// route "fts", "trigram" or "substring", and the FTS5 MATCH string ("" for
// the substring route or when there are no terms).
func (f *File) LexicalRoute(lq LexicalQuery, query string) (string, string) {
	if lq.Match == "" {
		return "fts", ""
	}
	if hasCJK(norm.NFC.String(query)) {
		all3 := true
		for _, t := range lq.Terms {
			if len([]rune(t)) < 3 {
				all3 = false
			}
		}
		if f.tables[f.table("fragments_fts")+"_trigram"] && all3 {
			return "trigram", lq.Match
		}
		return "substring", ""
	}
	return "fts", lq.Match
}

// SearchLexical runs the reference lexical search (contract §6).
func (f *File) SearchLexical(query string, limit int) ([]Hit, error) {
	if f.db == nil {
		return nil, errClosed
	}
	if limit <= 0 {
		limit = 10
	}
	lq := CompileLexical(query)
	if lq.Match == "" {
		return []Hit{}, nil
	}
	var ns []int64
	var scores []float64
	var err error
	route, match := f.LexicalRoute(lq, query)
	switch route {
	case "trigram":
		trigram := f.table("fragments_fts") + "_trigram"
		ns, scores, err = f.ftsQuery(trigram, "bm25("+quoteIdent(trigram)+")", match, limit)
	case "substring":
		ns, scores, err = f.substringQuery(lq, limit)
	default:
		fts := f.table("fragments_fts")
		weights := "1.0, 0.5, 0.5, 1.0"
		if f.ftsColumnCount(fts) == 3 {
			weights = "1.0, 0.5, 0.5"
		}
		ns, scores, err = f.ftsQuery(fts, "bm25("+quoteIdent(fts)+", "+weights+")", match, limit)
	}
	if err != nil {
		return nil, err
	}
	return f.fragmentHits(ns, scores, "lexical")
}

func (f *File) ftsQuery(table, rankExpr, match string, limit int) ([]int64, []float64, error) {
	q := fmt.Sprintf("SELECT rowid, %s AS r FROM %s WHERE %s MATCH ? ORDER BY r, rowid LIMIT ?", rankExpr, quoteIdent(table), quoteIdent(table))
	rows, err := f.conn.QueryContext(f.ctx(), q, match, limit)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var ns []int64
	var scores []float64
	for rows.Next() {
		var n int64
		var r float64
		if err := rows.Scan(&n, &r); err != nil {
			return nil, nil, err
		}
		ns = append(ns, n)
		scores = append(scores, -r)
	}
	return ns, scores, rows.Err()
}

func (f *File) substringQuery(lq LexicalQuery, limit int) ([]int64, []float64, error) {
	textCol := f.col("fragments", "text")
	var terms []string
	args := []any{}
	for _, t := range lq.Terms {
		terms = append(terms, "(instr("+textCol+", ?) > 0)")
		args = append(args, t)
	}
	cond := "hits > 0"
	if lq.Phrases {
		cond = fmt.Sprintf("hits = %d", len(lq.Terms))
	}
	q := fmt.Sprintf("SELECT n, hits FROM (SELECT %s AS n, %s AS hits FROM %s) WHERE %s ORDER BY hits DESC, n LIMIT ?",
		f.col("fragments", "n"), strings.Join(terms, " + "), quoteIdent(f.table("fragments")), cond)
	args = append(args, limit)
	rows, err := f.conn.QueryContext(f.ctx(), q, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var ns []int64
	var scores []float64
	for rows.Next() {
		var n, h int64
		if err := rows.Scan(&n, &h); err != nil {
			return nil, nil, err
		}
		ns = append(ns, n)
		scores = append(scores, float64(h))
	}
	return ns, scores, rows.Err()
}

// Space describes a vector space (spaces row).
type Space struct {
	ID            string
	Provider      string
	Model         string
	Version       *string
	Dims          int64
	DType         string
	Normalized    bool
	TruncatedFrom *int64
	Modalities    []string
	TaskPrefixes  map[string]any
	Created       *string
}

// Spaces lists the vector spaces of the file.
func (f *File) Spaces() ([]Space, error) {
	rows, err := f.queryRows("spaces", tableColumns50["spaces"], "ORDER BY "+f.col("spaces", "id"))
	if err != nil {
		return nil, err
	}
	out := make([]Space, 0, len(rows))
	for _, r := range rows {
		var s Space
		s.ID, _ = asString(r["id"])
		s.Provider, _ = asString(r["provider"])
		s.Model, _ = asString(r["model"])
		if v, ok := asString(r["version"]); ok {
			s.Version = &v
		}
		s.Dims, _ = asInt(r["dims"])
		s.DType, _ = asString(r["dtype"])
		if s.DType == "" {
			s.DType = "f32"
		}
		n, ok := asInt(r["normalized"])
		s.Normalized = !ok || n != 0
		if v, ok := asInt(r["truncated_from"]); ok {
			s.TruncatedFrom = &v
		}
		if l, ok := parseJSONColumn(r["modalities"]).([]any); ok {
			for _, e := range l {
				if m, ok := e.(string); ok {
					s.Modalities = append(s.Modalities, m)
				}
			}
		}
		if m, ok := parseJSONColumn(r["task_prefixes"]).(map[string]any); ok {
			s.TaskPrefixes = m
		}
		if v, ok := asString(r["created"]); ok {
			s.Created = &v
		}
		out = append(out, s)
	}
	return out, nil
}

// DTypeSize returns the byte size of a vector component, or 0 if unknown.
func DTypeSize(dtype string) int {
	switch dtype {
	case "f32":
		return 4
	case "f16":
		return 2
	case "i8":
		return 1
	}
	return 0
}

// DecodeVector converts a stored vector to float64 components.
func DecodeVector(data []byte, dtype string) ([]float64, error) {
	switch dtype {
	case "f32", "":
		if len(data)%4 != 0 {
			return nil, fmt.Errorf("f32 vector length %d not a multiple of 4", len(data))
		}
		out := make([]float64, len(data)/4)
		for i := range out {
			out[i] = float64(math.Float32frombits(binary.LittleEndian.Uint32(data[i*4:])))
		}
		return out, nil
	case "f16":
		if len(data)%2 != 0 {
			return nil, fmt.Errorf("f16 vector length %d not a multiple of 2", len(data))
		}
		out := make([]float64, len(data)/2)
		for i := range out {
			out[i] = HalfToFloat(binary.LittleEndian.Uint16(data[i*2:]))
		}
		return out, nil
	case "i8":
		out := make([]float64, len(data))
		for i, b := range data {
			out[i] = float64(int8(b)) / 127
		}
		return out, nil
	}
	return nil, fmt.Errorf("unknown dtype %q", dtype)
}

// HalfToFloat converts an IEEE 754 binary16 value to float64 (exactly).
func HalfToFloat(h uint16) float64 {
	sign := 1.0
	if h&0x8000 != 0 {
		sign = -1
	}
	exp := int((h >> 10) & 0x1f)
	frac := float64(h & 0x3ff)
	switch exp {
	case 0:
		return sign * frac * math.Pow(2, -24)
	case 31:
		if frac == 0 {
			return sign * math.Inf(1)
		}
		return math.NaN()
	}
	return sign * (1 + frac/1024) * math.Pow(2, float64(exp-15))
}

// EncodeVector encodes float32 components in the given dtype (quantizing
// for f16 and i8 with the rules of Quantize).
func EncodeVector(v []float32, dtype string) ([]byte, error) {
	f := make([]float64, len(v))
	for i, x := range v {
		f[i] = float64(x)
	}
	return Quantize(f, dtype)
}

// SearchVector runs brute-force similarity over the vectors of a space and
// target ("fragment" by default; also "unit" or "figure").
func (f *File) SearchVector(query []float64, space, target string, limit int) ([]Hit, error) {
	if f.db == nil {
		return nil, errClosed
	}
	if limit <= 0 {
		limit = 10
	}
	if target == "" {
		target = "fragment"
	}
	spaces, err := f.Spaces()
	if err != nil {
		return nil, err
	}
	var sp *Space
	for i := range spaces {
		if spaces[i].ID == space {
			sp = &spaces[i]
		}
	}
	if sp == nil {
		return nil, errf("E031", space, "unknown vector space")
	}
	if int64(len(query)) != sp.Dims {
		return nil, fmt.Errorf("spdf: query vector has %d dimensions, space %s has %d", len(query), space, sp.Dims)
	}
	storedTarget := target
	if f.legacy {
		for k, v := range legacyTargets {
			if v == target {
				storedTarget = k
			}
		}
	}
	rows, err := f.queryRows("vectors", []string{"id", "data"}, "WHERE "+f.col("vectors", "space")+" = ? AND "+f.col("vectors", "target")+" = ?", space, storedTarget)
	if err != nil {
		return nil, err
	}
	var qnorm float64
	for _, x := range query {
		qnorm += x * x
	}
	qnorm = math.Sqrt(qnorm)
	type scored struct {
		id    string
		score float64
	}
	var all []scored
	for _, r := range rows {
		id, _ := asString(r["id"])
		v, err := DecodeVector(asBytes(r["data"]), sp.DType)
		if err != nil {
			return nil, err
		}
		var dot, vn float64
		for i := 0; i < len(v) && i < len(query); i++ {
			dot += v[i] * query[i]
		}
		score := dot
		if !sp.Normalized {
			for _, x := range v {
				vn += x * x
			}
			vn = math.Sqrt(vn)
			if vn == 0 || qnorm == 0 {
				score = 0
			} else {
				score = dot / (vn * qnorm)
			}
		}
		all = append(all, scored{id, score})
	}
	// tie-break keys
	keys := map[string]int64{}
	switch target {
	case "fragment":
		fr, err := f.queryRows("fragments", []string{"n", "id"}, "")
		if err != nil {
			return nil, err
		}
		for _, r := range fr {
			id, _ := asString(r["id"])
			keys[id], _ = asInt(r["n"])
		}
	case "unit":
		us, err := f.queryRows("units", []string{"id", "ord"}, "ORDER BY "+f.col("units", "ord")+", "+f.col("units", "id"))
		if err != nil {
			return nil, err
		}
		for i, r := range us {
			id, _ := asString(r["id"])
			if f.legacy {
				keys[id] = int64(i + 1)
			} else {
				keys[id], _ = asInt(r["ord"])
			}
		}
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].score != all[j].score {
			return all[i].score > all[j].score
		}
		if target == "figure" {
			return all[i].id < all[j].id
		}
		ki, kj := keys[all[i].id], keys[all[j].id]
		if ki != kj {
			return ki < kj
		}
		return all[i].id < all[j].id
	})
	if len(all) > limit {
		all = all[:limit]
	}
	if target == "fragment" {
		ns := make([]int64, len(all))
		scores := make([]float64, len(all))
		for i, s := range all {
			ns[i] = keys[s.id]
			scores[i] = s.score
		}
		return f.fragmentHits(ns, scores, "vector")
	}
	return f.otherHits(target, all2(all, func(s scored) (string, float64) { return s.id, s.score }), keys)
}

func all2[T any](in []T, f func(T) (string, float64)) [][2]any {
	out := make([][2]any, len(in))
	for i, e := range in {
		id, s := f(e)
		out[i] = [2]any{id, s}
	}
	return out
}

func (f *File) otherHits(target string, items [][2]any, keys map[string]int64) ([]Hit, error) {
	t5 := "units"
	if target == "figure" {
		t5 = "figures"
	}
	ref := f.docRef()
	hits := make([]Hit, 0, len(items))
	for _, it := range items {
		id := it[0].(string)
		rows, err := f.queryRows(t5, []string{"anchor"}, "WHERE id = ?", id)
		if err != nil {
			return nil, err
		}
		var a Anchor
		if len(rows) > 0 {
			a = f.anchorValue(rows[0]["anchor"])
		}
		hits = append(hits, Hit{Target: target, ID: id, Score: it[1].(float64), Via: []string{"vector"},
			Anchor: a, AnchorURI: AnchorURI(ref, a, nil), N: keys[id]})
	}
	return hits, nil
}

// SearchHybrid fuses lexical and vector results with reciprocal rank fusion
// (k = 10), each list to depth max(limit, 50).
func (f *File) SearchHybrid(query string, vector []float64, space string, limit int) ([]Hit, error) {
	if limit <= 0 {
		limit = 10
	}
	depth := limit
	if depth < 50 {
		depth = 50
	}
	lex, err := f.SearchLexical(query, depth)
	if err != nil {
		return nil, err
	}
	var vec []Hit
	if vector != nil && space != "" {
		if vec, err = f.SearchVector(vector, space, "fragment", depth); err != nil {
			return nil, err
		}
	}
	return FuseRRF(lex, vec, 10, limit), nil
}

// FuseRRF fuses two ranked fragment lists: score = Σ 1/(k + rank).
func FuseRRF(lex, vec []Hit, k float64, limit int) []Hit {
	type acc struct {
		hit   Hit
		score float64
		via   []string
	}
	m := map[string]*acc{}
	var order []string
	add := func(list []Hit, via string) {
		for i, h := range list {
			a, ok := m[h.ID]
			if !ok {
				a = &acc{hit: h}
				m[h.ID] = a
				order = append(order, h.ID)
			}
			a.score += 1 / (k + float64(i+1))
			a.via = append(a.via, via)
		}
	}
	add(lex, "lexical")
	add(vec, "vector")
	out := make([]Hit, 0, len(order))
	for _, id := range order {
		a := m[id]
		h := a.hit
		h.Score = a.score
		h.Via = a.via
		out = append(out, h)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].N < out[j].N
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}
