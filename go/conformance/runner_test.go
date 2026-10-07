package conformance

import (
	"os"
	"path/filepath"
	"testing"
)

// TestConformance runs the whole suite in ../../conformance and fails on any
// failed case. Set SPDF_CONFORMANCE_OUT to also write the report there.
func TestConformance(t *testing.T) {
	dir := os.Getenv("SPDF_CONFORMANCE_DIR")
	if dir == "" {
		dir = filepath.Join("..", "..", "conformance")
	}
	rep, err := Run(dir)
	if err != nil {
		t.Fatal(err)
	}
	if out := os.Getenv("SPDF_CONFORMANCE_OUT"); out != "" {
		if err := os.WriteFile(out, append(rep.JSON(), '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range rep.Failed {
		t.Errorf("%s: %s", f.ID, f.Reason)
	}
	t.Logf("%d passed, %d failed, %d skipped", len(rep.Passed), len(rep.Failed), len(rep.Skipped))
}
