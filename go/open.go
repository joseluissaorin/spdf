package spdf

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strconv"
	"strings"

	"modernc.org/sqlite"
)

// Options tunes how a file is opened. The zero value is safe.
type Options struct {
	// MaxBlobSize caps any single string or blob (SQLITE_LIMIT_LENGTH).
	// 0 means DefaultMaxBlobSize.
	MaxBlobSize int64
	// MaxDecompressedSize caps a gunzipped file. 0 means DefaultMaxDecompressedSize.
	MaxDecompressedSize int64
}

func (o *Options) maxBlob() int64 {
	if o == nil || o.MaxBlobSize <= 0 {
		return DefaultMaxBlobSize
	}
	return o.MaxBlobSize
}

func (o *Options) maxGunzip() int64 {
	if o == nil || o.MaxDecompressedSize <= 0 {
		return DefaultMaxDecompressedSize
	}
	return o.MaxDecompressedSize
}

// File is an open SPDF file (5.0 or legacy 4.x), read-only.
type File struct {
	db      *sql.DB
	conn    *sql.Conn
	path    string
	tmp     string
	legacy  bool
	version string // "5.0", "4.1", "4.0"
	gzipped bool
	opts    Options
	// columns present per physical table
	columns map[string]map[string]bool
	tables  map[string]bool
	// legacy blob keys (lazy)
	blobKeys map[string]bool
	// physical file path of the SQLite database (temp copy if gunzipped)
	physical string
	// user_version read from the header
	userVersion int64
	// problems tolerated when opened leniently (for validation)
	issues []*Error
}

var sqliteMagic = []byte("SQLite format 3\x00")

// tolerated legacy triggers (4.x keeps the FTS index in sync with them).
var legacyTriggers = map[string]bool{"fragmentos_ai": true, "fragmentos_ad": true, "fragmentos_au": true}

// Open opens an SPDF file safely. Gzip-wrapped files (legacy 4.x) are
// decompressed to a temporary file first.
func Open(path string, opts *Options) (*File, error) {
	return openPath(path, opts, false)
}

func openPath(path string, opts *Options, lenient bool) (*File, error) {
	var o Options
	if opts != nil {
		o = *opts
	}
	fh, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	head := make([]byte, 100)
	n, _ := io.ReadFull(fh, head)
	head = head[:n]
	gz := n >= 2 && head[0] == 0x1f && head[1] == 0x8b
	var tmp string
	switch {
	case gz:
		if _, err := fh.Seek(0, io.SeekStart); err != nil {
			return nil, err
		}
		if tmp, err = gunzipToTemp(fh, o.maxGunzip()); err != nil {
			return nil, err
		}
	case n < 100 || !bytes.Equal(head[:16], sqliteMagic):
		return nil, errf("E001", path, "not an SQLite database")
	case head[18] == 2 || head[19] == 2:
		// A database left in WAL mode cannot be opened read-only without its
		// -shm file: work on a copy with the header switched back to rollback mode.
		if _, err := fh.Seek(0, io.SeekStart); err != nil {
			return nil, err
		}
		if tmp, err = copyToTemp(fh, o.maxGunzip()); err != nil {
			return nil, err
		}
	}
	physical := path
	if tmp != "" {
		physical = tmp
	}
	f, err := openSQLiteMode(physical, path, &o, lenient)
	if err != nil {
		if tmp != "" {
			os.Remove(tmp)
		}
		return nil, err
	}
	f.tmp = tmp
	f.gzipped = gz
	return f, nil
}

// OpenBytes opens an SPDF held in memory (gzip-wrapped or not). The bytes are
// written to a temporary file that is removed on Close.
func OpenBytes(data []byte, opts *Options) (*File, error) {
	var o Options
	if opts != nil {
		o = *opts
	}
	var tmp string
	var err error
	gz := len(data) >= 2 && data[0] == 0x1f && data[1] == 0x8b
	if gz {
		tmp, err = gunzipToTemp(bytes.NewReader(data), o.maxGunzip())
	} else {
		if len(data) < 100 || !bytes.Equal(data[:16], sqliteMagic) {
			return nil, errf("E001", "", "not an SQLite database")
		}
		tmp, err = copyToTemp(bytes.NewReader(data), o.maxGunzip())
	}
	if err != nil {
		return nil, err
	}
	f, err := openSQLite(tmp, "", &o)
	if err != nil {
		os.Remove(tmp)
		return nil, err
	}
	f.tmp = tmp
	f.gzipped = gz
	return f, nil
}

func gunzipToTemp(r io.Reader, limit int64) (string, error) {
	zr, err := gzip.NewReader(bufio.NewReader(r))
	if err != nil {
		return "", errf("E001", "", "invalid gzip stream: %v", err)
	}
	defer zr.Close()
	return copyToTemp(zr, limit)
}

// copyToTemp copies r to a temporary file, checks the SQLite magic and
// switches a WAL header back to rollback-journal mode.
func copyToTemp(r io.Reader, limit int64) (string, error) {
	out, err := os.CreateTemp("", "spdf-*.sqlite")
	if err != nil {
		return "", err
	}
	name := out.Name()
	n, err := io.Copy(out, io.LimitReader(r, limit+1))
	if err == nil && n > limit {
		err = errf("E001", "", "decompressed size exceeds %d bytes", limit)
	}
	if err == nil {
		head := make([]byte, 100)
		if _, rerr := out.ReadAt(head, 0); rerr != nil || !bytes.Equal(head[:16], sqliteMagic) {
			err = errf("E001", "", "not an SQLite database")
		} else if head[18] == 2 || head[19] == 2 {
			_, err = out.WriteAt([]byte{1, 1}, 18)
		}
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(name)
		return "", err
	}
	return name, nil
}

func readOnlyDSN(path string) string {
	q := url.Values{}
	q.Set("mode", "ro")
	q.Set("_defensive", "1")
	q.Add("_pragma", "query_only(1)")
	q.Add("_pragma", "trusted_schema(0)")
	return "file:" + (&url.URL{Path: path}).EscapedPath() + "?" + q.Encode()
}

func openSQLite(physical, display string, o *Options) (*File, error) {
	return openSQLiteMode(physical, display, o, false)
}

func openSQLiteMode(physical, display string, o *Options, lenient bool) (*File, error) {
	db, err := sql.Open("sqlite", readOnlyDSN(physical))
	if err != nil {
		return nil, errf("E001", display, "cannot open: %v", err)
	}
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		db.Close()
		return nil, errf("E001", display, "cannot open: %v", err)
	}
	f := &File{db: db, conn: conn, path: display, opts: *o, physical: physical}
	issue := func(e *Error) error {
		if lenient {
			f.issues = append(f.issues, e)
			return nil
		}
		return e
	}
	fail := func(e error) (*File, error) {
		conn.Close()
		db.Close()
		return nil, e
	}
	// Cap strings and blobs (SQLITE_LIMIT_LENGTH = 0).
	if _, err := sqlite.Limit(conn, 0, int(min64(o.maxBlob(), 2147483647))); err != nil {
		return fail(err)
	}
	// Reading the schema fails on anything that is not a database.
	rows, err := conn.QueryContext(ctx, "SELECT type, name, tbl_name FROM sqlite_master")
	if err != nil {
		return fail(errf("E001", display, "not an SQLite database: %v", err))
	}
	type entry struct{ typ, name, tbl string }
	var entries []entry
	for rows.Next() {
		var e entry
		var tbl sql.NullString
		if err := rows.Scan(&e.typ, &e.name, &tbl); err != nil {
			rows.Close()
			return fail(errf("E001", display, "cannot read schema: %v", err))
		}
		e.tbl = tbl.String
		entries = append(entries, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fail(errf("E001", display, "cannot read schema: %v", err))
	}
	f.tables = map[string]bool{}
	for _, e := range entries {
		if e.typ == "table" {
			f.tables[e.name] = true
		}
	}
	// Version detection.
	var appID, userVersion int64
	if err := conn.QueryRowContext(ctx, "PRAGMA application_id").Scan(&appID); err != nil {
		return fail(errf("E001", display, "cannot read header: %v", err))
	}
	if err := conn.QueryRowContext(ctx, "PRAGMA user_version").Scan(&userVersion); err != nil {
		return fail(errf("E001", display, "cannot read header: %v", err))
	}
	f.userVersion = userVersion
	switch {
	case appID == ApplicationID && userVersion == UserVersion:
		f.version = "5.0"
	case appID == ApplicationID && userVersion >= 500 && userVersion < 600:
		f.version = fmt.Sprintf("5.%d", (userVersion-500)/10)
	case f.tables["spdf"] && f.tables["documentos"]:
		f.legacy = true
		var v sql.NullString
		_ = conn.QueryRowContext(ctx, "SELECT valor FROM spdf WHERE clave = 'spdf_version'").Scan(&v)
		switch {
		case v.Valid && v.String != "":
			f.version = v.String
		case userVersion == 400:
			f.version = "4.0"
		case userVersion == 410:
			f.version = "4.1"
		default:
			f.version = "4.1"
		}
		if !strings.HasPrefix(f.version, "4.") {
			return fail(errf("E002", display, "unknown legacy version %q", f.version))
		}
	case f.tables["spdf_meta"] && f.tables["documents"] && appID == 0 && userVersion == 0:
		return fail(errf("E002", display, "missing application_id and user_version"))
	default:
		return fail(errf("E002", display, "unknown application_id %d / user_version %d", appID, userVersion))
	}
	// Triggers and views.
	for _, e := range entries {
		if e.typ == "view" {
			if err := issue(errf("E020", e.name, "views are not allowed in an SPDF file")); err != nil {
				return fail(err)
			}
		}
		if e.typ == "trigger" && !(f.legacy && legacyTriggers[e.name]) {
			if err := issue(errf("E020", e.name, "triggers are not allowed in an SPDF file")); err != nil {
				return fail(err)
			}
		}
	}
	// Columns of every table we may read.
	f.columns = map[string]map[string]bool{}
	for t := range f.tables {
		if strings.HasPrefix(t, "sqlite_") || strings.Contains(t, "_fts") {
			continue
		}
		cols, err := tableColumns(ctx, conn, t)
		if err != nil {
			return fail(errf("E001", display, "cannot read table %s: %v", t, err))
		}
		f.columns[t] = cols
	}
	// Required extensions this implementation does not know.
	if !f.legacy && f.tables["extensions"] && f.columns["extensions"]["required"] {
		r, err := conn.QueryContext(ctx, "SELECT name FROM extensions WHERE required <> 0 ORDER BY name")
		if err == nil {
			var unknown []string
			for r.Next() {
				var name string
				if r.Scan(&name) == nil && !knownExtensions[name] {
					unknown = append(unknown, name)
				}
			}
			r.Close()
			for _, u := range unknown {
				if err := issue(errf("E060", u, "unknown required extension")); err != nil {
					return fail(err)
				}
			}
		}
	}
	return f, nil
}

// knownExtensions lists the extensions this implementation understands.
var knownExtensions = map[string]bool{}

func tableColumns(ctx context.Context, conn *sql.Conn, table string) (map[string]bool, error) {
	rows, err := conn.QueryContext(ctx, "SELECT name FROM pragma_table_info(?)", table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols := map[string]bool{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		cols[n] = true
	}
	return cols, rows.Err()
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

// Close releases the file (and removes the temporary copy, if any).
func (f *File) Close() error {
	if f == nil || f.db == nil {
		return nil
	}
	err := f.conn.Close()
	if e := f.db.Close(); err == nil {
		err = e
	}
	f.db = nil
	if f.tmp != "" {
		os.Remove(f.tmp)
	}
	return err
}

// Version returns the SPDF version of the file ("5.0", "4.1", "4.0").
func (f *File) Version() string { return f.version }

// IsLegacy reports whether the file uses the legacy 4.x (Spanish) schema.
func (f *File) IsLegacy() bool { return f.legacy }

// Gzipped reports whether the file was gzip-wrapped.
func (f *File) Gzipped() bool { return f.gzipped }

// Path returns the path the file was opened from.
func (f *File) Path() string { return f.path }

// DB exposes the underlying read-only connection for advanced queries.
func (f *File) DB() *sql.Conn { return f.conn }

func (f *File) ctx() context.Context { return context.Background() }

// physical table name for a 5.0 table.
func (f *File) table(t5 string) string {
	if f.legacy {
		if l, ok := legacyTable[t5]; ok {
			return l
		}
	}
	return t5
}

func (f *File) hasTable(t5 string) bool { return f.tables[f.table(t5)] }

// selectList builds the SELECT list for the given 5.0 columns of a 5.0
// table, mapping legacy names and substituting NULL for absent columns.
func (f *File) selectList(t5 string, cols []string) string {
	phys := f.table(t5)
	present := f.columns[phys]
	parts := make([]string, len(cols))
	for i, c := range cols {
		src := c
		if f.legacy {
			if m, ok := legacyColumns[t5]; ok {
				if l, ok := m[c]; ok {
					src = l
				}
			}
		}
		if src == "" || !present[src] {
			if f.legacy {
				if lit, ok := legacyDefaults[t5+"."+c]; ok {
					parts[i] = lit + " AS " + quoteIdent(c)
					continue
				}
			}
			parts[i] = "NULL AS " + quoteIdent(c)
			continue
		}
		parts[i] = quoteIdent(src) + " AS " + quoteIdent(c)
	}
	return strings.Join(parts, ", ")
}

func quoteIdent(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

// queryRows runs a SELECT over a 5.0 table with mapped columns and returns
// generic rows (column name → value: nil, int64, float64, string, []byte).
func (f *File) queryRows(t5 string, cols []string, tail string, args ...any) ([]map[string]any, error) {
	if !f.hasTable(t5) {
		return nil, nil
	}
	q := "SELECT " + f.selectList(t5, cols) + " FROM " + quoteIdent(f.table(t5))
	if tail != "" {
		q += " " + tail
	}
	rows, err := f.conn.QueryContext(f.ctx(), q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := make(map[string]any, len(cols))
		for i, c := range cols {
			m[c] = normalizeSQLValue(vals[i])
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func normalizeSQLValue(v any) any {
	switch t := v.(type) {
	case int:
		return int64(t)
	case int32:
		return int64(t)
	case float32:
		return float64(t)
	case bool:
		if t {
			return int64(1)
		}
		return int64(0)
	}
	return v
}

// orderBy returns an ORDER BY clause with the mapped column names.
func (f *File) col(t5, c string) string {
	if f.legacy {
		if m, ok := legacyColumns[t5]; ok {
			if l, ok := m[c]; ok && l != "" {
				return quoteIdent(l)
			}
		}
	}
	return quoteIdent(c)
}

func asString(v any) (string, bool) {
	switch t := v.(type) {
	case string:
		return t, true
	case []byte:
		return string(t), true
	}
	return "", false
}

func asInt(v any) (int64, bool) {
	switch t := v.(type) {
	case int64:
		return t, true
	case float64:
		if t == float64(int64(t)) {
			return int64(t), true
		}
	case string:
		i, err := strconv.ParseInt(t, 10, 64)
		if err == nil {
			return i, true
		}
	}
	return 0, false
}

func asBytes(v any) []byte {
	switch t := v.(type) {
	case []byte:
		return t
	case string:
		return []byte(t)
	}
	return nil
}

var errClosed = errors.New("spdf: file is closed")
