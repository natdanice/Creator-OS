// Package store opens the SQLite database and owns "what day is it" and timestamps.
// The schema belongs to the Drizzle migrations in /drizzle (npm run migrate / seed / setup:live);
// the Go API only reads and writes rows, it never changes tables.
package store

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"creatoros/internal/config"
)

type Store struct {
	DB   *sql.DB
	Live bool
	// DemoToday is used in demo mode when app_settings has no story_date.
	DemoToday string
}

// Open opens an existing database. WAL + a busy timeout let it share the file with the Next.js app;
// write transactions start IMMEDIATE so two writers queue instead of failing.
func Open(path string, live bool, demoToday string) (*Store, error) {
	if _, err := os.Stat(path); err != nil {
		hint := "Run `npm run seed` first."
		if live {
			hint = "Run `npm run setup:live` first."
		}
		return nil, fmt.Errorf("database not found at %s. %s", path, hint)
	}
	q := url.Values{}
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "foreign_keys(1)")
	q.Set("_txlock", "immediate")
	db, err := sql.Open("sqlite", "file:"+strings.ReplaceAll(path, "?", "%3F")+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return &Store{DB: db, Live: live, DemoToday: demoToday}, nil
}

func FromConfig(c config.Config) (*Store, error) { return Open(c.DBPath, c.Live, c.StoryDate) }

func (s *Store) Close() error { return s.DB.Close() }

// Bangkok has no daylight saving, so a fixed +7 offset is exact.
var bangkok = time.FixedZone("Asia/Bangkok", 7*3600)

const tsLayout = "2006-01-02T15:04:05"

// Now is overridable in tests.
var Now = time.Now

func BangkokNow() string   { return Now().In(bangkok).Format(tsLayout) }
func BangkokToday() string { return BangkokNow()[:10] }

// Today is "today" for every screen: the real Bangkok date in live mode, otherwise the story date
// the seed stored (src/lib/queries/settings.ts).
func (s *Store) Today() string {
	if s.Live {
		return BangkokToday()
	}
	var v string
	if err := s.DB.QueryRow(`SELECT value FROM app_settings WHERE key = 'story_date'`).Scan(&v); err == nil && v != "" {
		return v
	}
	return s.DemoToday
}

// Stamp is the timestamp for something happening on `day`: the real clock in live mode when `day`
// is today, otherwise `day` at demoTime (src/lib/clock.ts).
func (s *Store) Stamp(day, demoTime string) string {
	if s.Live && day == BangkokToday() {
		return BangkokNow()
	}
	return day + "T" + demoTime
}

// Placeholders returns "?,?,?" for n values.
func Placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}
