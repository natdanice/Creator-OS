// Package config reads the API's settings from the environment, falling back to the project's
// .env.local so the Go API and the Next.js app share one settings file.
package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Addr      string // listen address, local only by default
	DBPath    string
	Live      bool   // APP_MODE=live: real Bangkok date, live database
	Token     string // API_TOKEN: when set, every request except /health must send "Authorization: Bearer <token>"
	StoryDate string // demo-mode "today" when app_settings has none
	Root      string // project root (the folder with package.json and drizzle/)
}

const DefaultStoryDate = "2026-10-31"

// ProjectRoot walks up from the working directory to the folder holding package.json and drizzle/.
func ProjectRoot() string {
	dir, _ := os.Getwd()
	for d := dir; ; d = filepath.Dir(d) {
		if exists(filepath.Join(d, "package.json")) && exists(filepath.Join(d, "drizzle")) {
			return d
		}
		if filepath.Dir(d) == d {
			return dir
		}
	}
}

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

// LoadEnvFile sets variables from a KEY=VALUE file without overriding the real environment.
// Inline comments ("KEY=value   # note") and surrounding quotes are removed.
func LoadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(strings.TrimPrefix(k, "export "))
		if i := strings.Index(v, " #"); i >= 0 {
			v = v[:i]
		}
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		if _, set := os.LookupEnv(k); !set && k != "" {
			os.Setenv(k, v)
		}
	}
}

func Load() Config {
	root := ProjectRoot()
	LoadEnvFile(filepath.Join(root, ".env.local"))
	live := os.Getenv("APP_MODE") == "live"
	db := os.Getenv("DATABASE_PATH")
	switch {
	case db == "" && live:
		db = filepath.Join(root, "data", "creator-os-live.db")
	case db == "":
		db = filepath.Join(root, "data", "creator-os.db")
	case !filepath.IsAbs(db):
		db = filepath.Join(root, db) // same meaning as for the Next.js app, which runs from the project root
	}
	host := getenv("API_HOST", "127.0.0.1")
	return Config{
		Addr:      host + ":" + getenv("API_PORT", "8080"),
		DBPath:    db,
		Live:      live,
		Token:     os.Getenv("API_TOKEN"),
		StoryDate: DefaultStoryDate,
		Root:      root,
	}
}

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
