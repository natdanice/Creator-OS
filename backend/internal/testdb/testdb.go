// Package testdb builds a throwaway database from the project's own Drizzle migrations
// (/drizzle/*.sql), so tests run against the real schema.
package testdb

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"creatoros/internal/config"
	"creatoros/internal/store"
)

// New returns an empty, migrated database in demo mode with "today" = 2026-10-31.
func New(t testing.TB) *store.Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	// Create the file by opening through the driver, then apply migrations.
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := store.Open(path, false, "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	files, _ := filepath.Glob(filepath.Join(config.ProjectRoot(), "drizzle", "0*.sql"))
	sort.Strings(files)
	if len(files) == 0 {
		t.Fatal("no drizzle migrations found")
	}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, stmt := range strings.Split(string(b), "--> statement-breakpoint") {
			if strings.TrimSpace(stmt) == "" {
				continue
			}
			if _, err := s.DB.Exec(stmt); err != nil {
				t.Fatalf("%s: %v\n%s", filepath.Base(f), err, stmt)
			}
		}
	}
	return s
}

// Exec runs a statement and fails the test on error.
func Exec(t testing.TB, s *store.Store, q string, args ...any) {
	t.Helper()
	if _, err := s.DB.Exec(q, args...); err != nil {
		t.Fatalf("%v\n%s", err, q)
	}
}
