package spdf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"
)

// Document is the documents row of a file.
type Document struct {
	ID           string
	Kind         string
	Metadata     map[string]any // CSL-JSON item + "spdf" extension
	SourceSHA256 string
	SourceRef    *string
	Mime         string
	Bytes        int64
	UnitCount    int64 // 0: computed from the units written
	Duration     *float64
	Created      string // ISO 8601; "" = now
	Updated      string // "" = Created
	Title        *string
	Authors      *string
	Year         *int64
	Language     *string
	Rights       map[string]any
}

// Unit is a citable unit (page, time span, slide…).
type Unit struct {
	ID         string
	Ord        int64 // 0: next ordinal
	Anchor     Anchor
	Text       string
	Notes      []string
	Header     *string
	Footer     *string
	Image      *string
	Thumbnail  *string
	Reader     string
	Confidence *float64 // nil = 1
	Printed    *string
	T0, T1     *float64
	Words      any
}

// Section is an entry of the table of contents.
type Section struct {
	ID       string
	Parent   *string
	Level    int64
	Title    string
	UnitFrom string
	UnitTo   *string
	Summary  *string
}

// Fragment is a searchable, citable passage.
type Fragment struct {
	N          int64 // 0: next rowid
	ID         string
	Unit       string
	Ord        int64 // 0: next ordinal
	Text       string
	Context    string
	Section    []string
	Anchor     Anchor
	AnchorEnd  Anchor
	SearchText *string
}

// Figure is a figure of a unit.
type Figure struct {
	ID          string
	Unit        string
	Image       string
	Caption     *string
	Description *string
	Anchor      Anchor
}

// SpaceDef declares a vector space.
type SpaceDef struct {
	ID            string
	Provider      string
	Model         string
	Version       *string
	Dims          int64
	DType         string // f32 (default) | f16 | i8
	Normalized    *bool  // nil = true
	TruncatedFrom *int64
	Modalities    []string
	TaskPrefixes  map[string]any
	Created       *string
}

// ProvenanceEntry records a processing stage.
type ProvenanceEntry struct {
	Stage    string
	Provider *string
	Model    *string
	Detail   any
	MS       *int64
	At       string
}

// WriterOptions configures a Writer.
type WriterOptions struct {
	// Generator for spdf_meta.generator; default "spdf-go/<Version>".
	Generator string
	// Trigram adds the optional CJK index.
	Trigram bool
}

// Writer builds an SPDF 5.0 file. Rows are written to a temporary file that
// replaces the destination on Close.
type Writer struct {
	db       *sql.DB
	conn     *sql.Conn
	tx       *sql.Tx
	path     string
	tmp      string
	opts     WriterOptions
	meta     map[string]string
	docID    string
	docSet   bool
	doc      Document
	nextUnit int64
	nextFrag int64
	nextN    int64
	units    int64
	vectors  int64
	hasTime  bool
	spaces   map[string]SpaceDef
	err      error
}

// Create starts a new SPDF 5.0 file at path.
func Create(path string, opts *WriterOptions) (*Writer, error) {
	var o WriterOptions
	if opts != nil {
		o = *opts
	}
	if o.Generator == "" {
		o.Generator = ImplName + "/" + Version
	}
	dir := filepath.Dir(path)
	tf, err := os.CreateTemp(dir, ".spdf-writer-*.tmp")
	if err != nil {
		return nil, err
	}
	tmp := tf.Name()
	tf.Close()
	os.Remove(tmp)
	db, err := sql.Open("sqlite", "file:"+tmp+"?_pragma=journal_mode(DELETE)&_pragma=trusted_schema(0)&_defensive=1")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		db.Close()
		return nil, err
	}
	w := &Writer{db: db, conn: conn, path: path, tmp: tmp, opts: o, meta: map[string]string{}, spaces: map[string]SpaceDef{}}
	stmts := []string{
		"PRAGMA page_size = 4096",
		fmt.Sprintf("PRAGMA application_id = %d", ApplicationID),
		fmt.Sprintf("PRAGMA user_version = %d", UserVersion),
	}
	for _, s := range stmts {
		if _, err := conn.ExecContext(ctx, s); err != nil {
			w.Abort()
			return nil, err
		}
	}
	for _, s := range splitSQL(Schema50) {
		if _, err := conn.ExecContext(ctx, s); err != nil {
			w.Abort()
			return nil, fmt.Errorf("schema: %w", err)
		}
	}
	if o.Trigram {
		if _, err := conn.ExecContext(ctx, SchemaTrigram); err != nil {
			w.Abort()
			return nil, err
		}
	}
	if w.tx, err = conn.BeginTx(ctx, nil); err != nil {
		w.Abort()
		return nil, err
	}
	return w, nil
}

func splitSQL(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ";\n") {
		if strings.TrimSpace(p) != "" {
			out = append(out, strings.TrimSpace(p))
		}
	}
	return out
}

func (w *Writer) exec(q string, args ...any) error {
	if w.err != nil {
		return w.err
	}
	if w.tx == nil {
		return errors.New("spdf: writer is closed")
	}
	_, err := w.tx.Exec(q, args...)
	if err != nil {
		w.err = err
	}
	return err
}

func jsonText(v any) any {
	if v == nil {
		return nil
	}
	switch t := v.(type) {
	case Anchor:
		if t == nil {
			return nil
		}
		return string(CompactJSON(map[string]any(t)))
	case map[string]any:
		if t == nil {
			return nil
		}
	case []string:
		if t == nil {
			return nil
		}
	}
	return string(CompactJSON(v))
}

func nullable[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

// SetMeta sets a spdf_meta key (overrides the defaults written on Close).
func (w *Writer) SetMeta(key, value string) { w.meta[key] = value }

// SetDocument writes the documents row. It must be called once.
func (w *Writer) SetDocument(d Document) error {
	if w.docSet {
		return errors.New("spdf: document already set")
	}
	if d.ID == "" || d.Kind == "" || d.Mime == "" || d.SourceSHA256 == "" {
		return errors.New("spdf: document needs id, kind, mime and source_sha256")
	}
	if d.Metadata == nil {
		d.Metadata = map[string]any{}
	}
	if d.Created == "" {
		d.Created = time.Now().UTC().Format("2006-01-02T15:04:05Z")
	}
	if d.Updated == "" {
		d.Updated = d.Created
	}
	w.doc = d
	w.docID = d.ID
	w.docSet = true
	return nil
}

func (w *Writer) needDoc() error {
	if !w.docSet {
		return errors.New("spdf: SetDocument must be called first")
	}
	return nil
}

// AddUnit writes a unit.
func (w *Writer) AddUnit(u Unit) error {
	if err := w.needDoc(); err != nil {
		return err
	}
	if u.Ord == 0 {
		u.Ord = w.nextUnit + 1
	}
	if u.Ord > w.nextUnit {
		w.nextUnit = u.Ord
	}
	if u.Anchor == nil {
		return fmt.Errorf("spdf: unit %s without anchor", u.ID)
	}
	if u.Anchor.Type() == "time" {
		w.hasTime = true
	}
	conf := 1.0
	if u.Confidence != nil {
		conf = *u.Confidence
	}
	var notes any
	if u.Notes != nil {
		notes = jsonText(u.Notes)
	}
	var words any
	if u.Words != nil {
		if s, ok := u.Words.(string); ok {
			words = s
		} else {
			words = jsonText(u.Words)
		}
	}
	w.units++
	return w.exec(`INSERT INTO units (id, document, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, w.docID, u.Ord, jsonText(u.Anchor), norm.NFC.String(u.Text), notes, nullable(u.Header), nullable(u.Footer),
		nullable(u.Image), nullable(u.Thumbnail), u.Reader, conf, nullable(u.Printed), nullable(u.T0), nullable(u.T1), words)
}

// AddSection writes a section.
func (w *Writer) AddSection(s Section) error {
	if err := w.needDoc(); err != nil {
		return err
	}
	return w.exec(`INSERT INTO sections (id, document, parent, level, title, unit_from, unit_to, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		s.ID, w.docID, nullable(s.Parent), s.Level, s.Title, s.UnitFrom, nullable(s.UnitTo), nullable(s.Summary))
}

// AddFragment writes a fragment (the FTS index is rebuilt on Close).
func (w *Writer) AddFragment(fr Fragment) error {
	if err := w.needDoc(); err != nil {
		return err
	}
	if fr.N == 0 {
		fr.N = w.nextN + 1
	}
	if fr.N > w.nextN {
		w.nextN = fr.N
	}
	if fr.Ord == 0 {
		fr.Ord = w.nextFrag + 1
	}
	if fr.Ord > w.nextFrag {
		w.nextFrag = fr.Ord
	}
	if fr.Anchor == nil {
		return fmt.Errorf("spdf: fragment %s without anchor", fr.ID)
	}
	var section any
	if fr.Section != nil {
		section = jsonText(fr.Section)
	}
	var end any
	if fr.AnchorEnd != nil {
		end = jsonText(fr.AnchorEnd)
	}
	return w.exec(`INSERT INTO fragments (n, id, document, unit, ord, text, context, section, anchor, anchor_end, search_text)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		fr.N, fr.ID, w.docID, fr.Unit, fr.Ord, norm.NFC.String(fr.Text), fr.Context, section, jsonText(fr.Anchor), end, nullable(fr.SearchText))
}

// AddFigure writes a figure.
func (w *Writer) AddFigure(fg Figure) error {
	if err := w.needDoc(); err != nil {
		return err
	}
	return w.exec(`INSERT INTO figures (id, document, unit, image, caption, description, anchor) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		fg.ID, w.docID, fg.Unit, fg.Image, nullable(fg.Caption), nullable(fg.Description), jsonText(fg.Anchor))
}

// AddSpace declares a vector space.
func (w *Writer) AddSpace(s SpaceDef) error {
	if s.DType == "" {
		s.DType = "f32"
	}
	if DTypeSize(s.DType) == 0 {
		return fmt.Errorf("spdf: unknown dtype %q", s.DType)
	}
	norm := int64(1)
	if s.Normalized != nil && !*s.Normalized {
		norm = 0
	}
	mods := s.Modalities
	if mods == nil {
		mods = []string{"text"}
	}
	var tp any
	if s.TaskPrefixes != nil {
		tp = jsonText(s.TaskPrefixes)
	}
	w.spaces[s.ID] = s
	return w.exec(`INSERT INTO spaces (id, provider, model, version, dims, dtype, normalized, truncated_from, modalities, task_prefixes, created)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.ID, s.Provider, s.Model, nullable(s.Version), s.Dims, s.DType, norm, nullable(s.TruncatedFrom), jsonText(mods), tp, nullable(s.Created))
}

// AddVectorRaw stores an already encoded vector.
func (w *Writer) AddVectorRaw(target, id, space string, data []byte) error {
	if err := w.needDoc(); err != nil {
		return err
	}
	if s, ok := w.spaces[space]; ok {
		if int64(len(data)) != s.Dims*int64(DTypeSize(s.DType)) {
			return fmt.Errorf("spdf: vector %s/%s has %d bytes, space %s needs %d", target, id, len(data), space, s.Dims*int64(DTypeSize(s.DType)))
		}
	} else {
		return fmt.Errorf("spdf: unknown space %q (call AddSpace first)", space)
	}
	w.vectors++
	return w.exec(`INSERT INTO vectors (target, id, space, document, data) VALUES (?, ?, ?, ?, ?)`, target, id, space, w.docID, data)
}

// AddVector encodes v in the space dtype (quantizing f16/i8) and stores it.
func (w *Writer) AddVector(target, id, space string, v []float32) error {
	s, ok := w.spaces[space]
	if !ok {
		return fmt.Errorf("spdf: unknown space %q (call AddSpace first)", space)
	}
	data, err := EncodeVector(v, s.DType)
	if err != nil {
		return err
	}
	return w.AddVectorRaw(target, id, space, data)
}

// AddBlob stores a binary object; reference it as "blob:<key>".
func (w *Writer) AddBlob(key, mime string, data []byte) error {
	sum := sha256.Sum256(data)
	if data == nil {
		data = []byte{}
	}
	return w.exec(`INSERT INTO blobs (key, mime, sha256, data) VALUES (?, ?, ?, ?)`, key, mime, hex.EncodeToString(sum[:]), data)
}

// AddProvenance records a processing stage.
func (w *Writer) AddProvenance(p ProvenanceEntry) error {
	if err := w.needDoc(); err != nil {
		return err
	}
	var detail any
	if p.Detail != nil {
		if s, ok := p.Detail.(string); ok {
			detail = s
		} else {
			detail = jsonText(p.Detail)
		}
	}
	return w.exec(`INSERT INTO provenance (document, stage, provider, model, detail, ms, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		w.docID, p.Stage, nullable(p.Provider), nullable(p.Model), detail, nullable(p.MS), p.At)
}

// AddExtension declares an extension (its x_<vendor>_<name> tables are the
// caller's business, through Exec).
func (w *Writer) AddExtension(name, version string, required bool) error {
	r := 0
	if required {
		r = 1
	}
	return w.exec(`INSERT INTO extensions (name, version, required) VALUES (?, ?, ?)`, name, version, r)
}

// Exec runs arbitrary SQL inside the writer transaction (extension tables).
func (w *Writer) Exec(q string, args ...any) error { return w.exec(q, args...) }

// Abort discards the file being written.
func (w *Writer) Abort() {
	if w.tx != nil {
		w.tx.Rollback()
		w.tx = nil
	}
	if w.conn != nil {
		w.conn.Close()
		w.conn = nil
	}
	if w.db != nil {
		w.db.Close()
		w.db = nil
	}
	os.Remove(w.tmp)
	os.Remove(w.tmp + "-journal")
}

func (w *Writer) defaultProfile() string {
	p := []string{"core"}
	if w.vectors > 0 {
		p = append(p, "semantic")
	}
	if w.hasTime {
		p = append(p, "media")
	}
	return strings.Join(p, " ")
}

// Close finalizes the file: writes the document and spdf_meta, rebuilds the
// FTS index, VACUUMs, and moves the file into place.
func (w *Writer) Close() error {
	if w.tx == nil {
		return errors.New("spdf: writer is closed")
	}
	if w.err != nil {
		err := w.err
		w.Abort()
		return err
	}
	if !w.docSet {
		w.Abort()
		return errors.New("spdf: no document")
	}
	d := w.doc
	if d.UnitCount == 0 {
		d.UnitCount = w.units
	}
	var rights any
	if d.Rights != nil {
		rights = jsonText(d.Rights)
	}
	if err := w.exec(`INSERT INTO documents (id, kind, metadata, source_sha256, source_ref, mime, bytes, unit_count, duration, created, updated, title, authors, year, language, rights)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		d.ID, d.Kind, jsonText(d.Metadata), strings.ToLower(d.SourceSHA256), nullable(d.SourceRef), d.Mime, d.Bytes, d.UnitCount,
		nullable(d.Duration), d.Created, d.Updated, nullable(d.Title), nullable(d.Authors), nullable(d.Year), nullable(d.Language), rights); err != nil {
		w.Abort()
		return err
	}
	meta := map[string]string{
		"spdf_version": FormatVersion,
		"profile":      w.defaultProfile(),
		"created":      d.Created,
		"generator":    w.opts.Generator,
		"document_id":  d.ID,
	}
	for k, v := range w.meta {
		meta[k] = v
	}
	keys := make([]string, 0, len(meta))
	for k := range meta {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if err := w.exec(`INSERT INTO spdf_meta (key, value) VALUES (?, ?)`, k, meta[k]); err != nil {
			w.Abort()
			return err
		}
	}
	if err := w.exec(`INSERT INTO fragments_fts(fragments_fts) VALUES ('rebuild')`); err != nil {
		w.Abort()
		return err
	}
	if w.opts.Trigram {
		if err := w.exec(`INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES ('rebuild')`); err != nil {
			w.Abort()
			return err
		}
	}
	if err := w.tx.Commit(); err != nil {
		w.tx = nil
		w.Abort()
		return err
	}
	w.tx = nil
	ctx := context.Background()
	for _, s := range []string{"INSERT INTO fragments_fts(fragments_fts) VALUES ('optimize')", "VACUUM"} {
		if _, err := w.conn.ExecContext(ctx, s); err != nil {
			w.Abort()
			return err
		}
	}
	w.conn.Close()
	w.conn = nil
	w.db.Close()
	w.db = nil
	if err := os.Rename(w.tmp, w.path); err != nil {
		os.Remove(w.tmp)
		return err
	}
	return nil
}
