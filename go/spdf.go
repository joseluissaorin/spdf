// Package spdf reads, validates, searches and writes SPDF files (Semantic
// Processed Document Format): documents that have been read once and can be
// cited forever, because every passage carries its exact anchor.
//
// An SPDF 5.0 file is an uncompressed SQLite 3 database. This package also
// reads the legacy 4.0 and 4.1 files written by Scholaris (Spanish schema,
// usually gzip-wrapped) and presents them through the 5.0 view.
//
// The implementation is pure Go (modernc.org/sqlite, no cgo), so it
// cross-compiles to every platform Go supports.
//
// Opening is always defensive: read-only, query_only, trusted_schema=OFF,
// SQLITE_DBCONFIG_DEFENSIVE, no extensions, and files carrying triggers or
// views (other than the three tolerated legacy FTS triggers) are refused.
package spdf

import (
	"fmt"
	"strings"
)

// Library and format constants.
const (
	// Version is the version of this library.
	Version = "0.1.0"
	// ImplName identifies this implementation in conformance reports.
	ImplName = "spdf-go"
	// FormatVersion is the SPDF version written by Writer.
	FormatVersion = "5.0"
	// ApplicationID is PRAGMA application_id of an SPDF file (0x53504446, "SPDF").
	ApplicationID = 1397769286
	// UserVersion is PRAGMA user_version of an SPDF 5.0 file.
	UserVersion = 500
	// DefaultMaxBlobSize is the default cap for any single string or blob (512 MiB).
	DefaultMaxBlobSize = 512 << 20
	// DefaultMaxDecompressedSize caps the size of a gunzipped legacy file (4 GiB).
	DefaultMaxDecompressedSize = 4 << 30
)

// Error is an SPDF error with a validation code (E001, E020…).
type Error struct {
	Code    string
	Message string
	Where   string
}

func (e *Error) Error() string {
	if e.Where != "" {
		return fmt.Sprintf("%s: %s (%s)", e.Code, e.Message, e.Where)
	}
	return e.Code + ": " + e.Message
}

func errf(code, where, format string, a ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, a...), Where: where}
}

// Profiles defined by the specification.
var knownProfiles = map[string]bool{"core": true, "semantic": true, "media": true, "full": true}

// Kinds of document (documents.kind).
var knownKinds = map[string]bool{
	"pdf": true, "scanned_pdf": true, "photos": true, "image": true, "audio": true,
	"video": true, "document": true, "epub": true, "slides": true, "sheet": true, "web": true,
}

// Anchor types known in 5.0.
var knownAnchorTypes = map[string]bool{
	"page": true, "time": true, "section": true, "slide": true, "sheet": true,
	"web": true, "image": true, "verse": true, "canonical": true,
}

func splitProfile(s string) []string {
	out := []string{}
	for _, p := range strings.Fields(s) {
		out = append(out, p)
	}
	return out
}
