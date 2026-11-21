// Package settings holds the data behind the Settings page: the creator's profile, the rate card,
// import history and the audience consent summary. Connected accounts (OAuth tokens) stay in the web app.
package settings

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"creatoros/internal/crm"
	"creatoros/internal/model"
	"creatoros/internal/store"
)

type Platform struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Handle string `json:"handle"`
	Color  string `json:"color"`
}

type Profile struct {
	Name    string            `json:"name"`
	Tagline string            `json:"tagline"`
	Handles map[string]string `json:"handles"`
}

type RateCard struct {
	ID          int      `json:"id"`
	Code        string   `json:"code"`
	Name        string   `json:"name"`
	PlatformID  *string  `json:"platformId"`
	Kind        string   `json:"kind"`
	Description string   `json:"description"`
	Price       int      `json:"price"`
	Includes    []string `json:"includes"`
}

type ImportRun struct {
	ID                int     `json:"id"`
	PlatformID        string  `json:"platformId"`
	Adapter           string  `json:"adapter"`
	StartedAt         string  `json:"startedAt"`
	FinishedAt        *string `json:"finishedAt"`
	Status            string  `json:"status"`
	Contents          int     `json:"contents"`
	MetricRows        int     `json:"metricRows"`
	Comments          int     `json:"comments"`
	AudienceSnapshots int     `json:"audienceSnapshots"`
	Message           *string `json:"message"`
}

type ConsentRow struct {
	Purpose     string `json:"purpose"`
	LawfulBasis string `json:"lawfulBasis"`
	Status      string `json:"status"`
	N           int    `json:"n"`
}

type Data struct {
	Platforms        []Platform     `json:"platforms"`
	Profile          Profile        `json:"profile"`
	LatestFollowers  map[string]int `json:"latestFollowers"`
	RateCard         []RateCard     `json:"rateCard"`
	ImportRuns       []ImportRun    `json:"importRuns"`
	Consent          []ConsentRow   `json:"consent"`
	RedactedComments int            `json:"redactedComments"`
}

// LatestFollowers is the newest follower count per platform as of today (the newest audience snapshot in a month up to
// today's). It is the one source for "how many followers do I have": Settings, the Audience page and the MCP tools all use it.
func LatestFollowers(db *sql.DB, today string) (map[string]int, error) {
	out := map[string]int{}
	rows, err := db.Query(`
		SELECT s.platform_id, s.followers FROM audience_snapshots s
		WHERE s.month = (SELECT MAX(month) FROM audience_snapshots WHERE platform_id = s.platform_id AND month <= ?)
		ORDER BY s.platform_id, s.id`, today[:7])
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var platform string
		var f int
		if err := rows.Scan(&platform, &f); err != nil {
			return nil, err
		}
		out[platform] = f // if a month somehow has two snapshots, the later row wins
	}
	return out, rows.Err()
}

func setting(db *sql.DB, key string) string {
	var v string
	_ = db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, key).Scan(&v)
	return v
}

func Load(db *sql.DB, today string) (*Data, error) {
	d := &Data{Platforms: []Platform{}, LatestFollowers: map[string]int{}, RateCard: []RateCard{}, ImportRuns: []ImportRun{}, Consent: []ConsentRow{}}
	prow, err := db.Query(`SELECT id, name, handle, color FROM platforms ORDER BY rowid`)
	if err != nil {
		return nil, err
	}
	defer prow.Close()
	handles := map[string]string{}
	for prow.Next() {
		var p Platform
		if err := prow.Scan(&p.ID, &p.Name, &p.Handle, &p.Color); err != nil {
			return nil, err
		}
		d.Platforms = append(d.Platforms, p)
		if p.Handle != "—" {
			handles[p.ID] = p.Handle
		} else {
			handles[p.ID] = ""
		}
	}
	if err := prow.Err(); err != nil {
		return nil, err
	}
	latest, err := LatestFollowers(db, today)
	if err != nil {
		return nil, err
	}
	d.LatestFollowers = latest
	name := setting(db, "creator_name")
	if name == "" {
		name = "Creator"
	}
	d.Profile = Profile{Name: name, Tagline: setting(db, "creator_tagline"), Handles: handles}

	rrows, err := db.Query(`SELECT id, code, name, platform_id, kind, description, price, includes FROM rate_card ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rrows.Close()
	for rrows.Next() {
		var r RateCard
		var inc string
		if err := rrows.Scan(&r.ID, &r.Code, &r.Name, &r.PlatformID, &r.Kind, &r.Description, &r.Price, &inc); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(inc), &r.Includes)
		r.Includes = model.Strings(r.Includes)
		d.RateCard = append(d.RateCard, r)
	}
	if err := rrows.Err(); err != nil {
		return nil, err
	}

	irows, err := db.Query(`SELECT id, platform_id, adapter, started_at, finished_at, status, contents, metric_rows, comments, audience_snapshots, message FROM import_runs ORDER BY started_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer irows.Close()
	for irows.Next() {
		var r ImportRun
		if err := irows.Scan(&r.ID, &r.PlatformID, &r.Adapter, &r.StartedAt, &r.FinishedAt, &r.Status, &r.Contents, &r.MetricRows, &r.Comments, &r.AudienceSnapshots, &r.Message); err != nil {
			return nil, err
		}
		d.ImportRuns = append(d.ImportRuns, r)
	}
	if err := irows.Err(); err != nil {
		return nil, err
	}

	crows, err := db.Query(`SELECT purpose, lawful_basis, status, COUNT(*) FROM consents GROUP BY purpose, lawful_basis, status ORDER BY purpose, lawful_basis, status`)
	if err != nil {
		return nil, err
	}
	defer crows.Close()
	for crows.Next() {
		var c ConsentRow
		if err := crows.Scan(&c.Purpose, &c.LawfulBasis, &c.Status, &c.N); err != nil {
			return nil, err
		}
		d.Consent = append(d.Consent, c)
	}
	if err := crows.Err(); err != nil {
		return nil, err
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM comments WHERE redacted = 1`).Scan(&d.RedactedComments); err != nil {
		return nil, err
	}
	return d, nil
}

// MaxPrice is the largest price accepted for a rate-card item (baht).
const MaxPrice = 10_000_000

// RateChange is one price that was changed.
type RateChange struct {
	Code string `json:"code"`
	From int    `json:"from"`
	To   int    `json:"to"`
}

// SaveRates sets new prices by rate-card code. Money is whole baht, so everything is checked first and nothing is
// saved unless every entry is valid: codes must exist exactly as spelled in the rate card (case-sensitive), and
// prices must be whole numbers from 0 to MaxPrice. Returns the prices that actually changed.
func SaveRates(db *sql.DB, prices map[string]float64) ([]RateChange, error) {
	if len(prices) == 0 {
		return nil, crm.ErrInvalid("prices is empty: pass an object like {\"TT_VIDEO\": 20000}")
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.Query(`SELECT code, price FROM rate_card`)
	if err != nil {
		return nil, err
	}
	current := map[string]int{}
	var valid []string
	for rows.Next() {
		var c string
		var p int
		if err := rows.Scan(&c, &p); err != nil {
			rows.Close()
			return nil, err
		}
		current[c] = p
		valid = append(valid, c)
	}
	rows.Close()
	sort.Strings(valid)

	var unknown, bad []string
	codes := make([]string, 0, len(prices))
	for code := range prices {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	for _, code := range codes {
		raw := prices[code]
		if _, known := current[code]; !known {
			unknown = append(unknown, code)
		} else if math.IsNaN(raw) || math.IsInf(raw, 0) || raw != math.Trunc(raw) || raw < 0 || raw > MaxPrice {
			bad = append(bad, fmt.Sprintf("%s=%v", code, raw))
		}
	}
	if len(unknown) > 0 {
		return nil, crm.ErrInvalid(fmt.Sprintf("Unknown rate-card code(s): %s. Codes are case-sensitive; valid codes: %s", strings.Join(unknown, ", "), strings.Join(valid, ", ")))
	}
	if len(bad) > 0 {
		return nil, crm.ErrInvalid(fmt.Sprintf("Invalid price(s): %s. Prices are whole baht from 0 to %d.", strings.Join(bad, ", "), MaxPrice))
	}
	changes := []RateChange{}
	for _, code := range codes {
		price := int(prices[code])
		if price == current[code] {
			continue
		}
		if _, err := tx.Exec(`UPDATE rate_card SET price = ? WHERE code = ?`, price, code); err != nil {
			return nil, err
		}
		changes = append(changes, RateChange{Code: code, From: current[code], To: price})
	}
	return changes, tx.Commit()
}

type ProfileInput struct {
	Name      string            `json:"name"`
	Tagline   string            `json:"tagline"`
	Handles   map[string]string `json:"handles"`
	Followers map[string]string `json:"followers"` // typed as text: "12,500" works
}

func upsert(tx *sql.Tx, key, value string) error {
	_, err := tx.Exec(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

var followersRe = regexp.MustCompile(`^(\d{1,3}(,\d{3})+|\d+)$`)

// MaxFollowers is the largest follower count accepted.
const MaxFollowers = 2_000_000_000

// ParseFollowers reads a typed follower count: whole digits, optionally with thousands separators ("12500" or
// "12,500"). Empty means "not given" (0). Decimals, signs, letters and anything else are rejected, rather than
// having their digits glued together ("1.5" would otherwise become 15).
func ParseFollowers(txt string) (int, error) {
	txt = strings.TrimSpace(txt)
	if txt == "" {
		return 0, nil
	}
	if !followersRe.MatchString(txt) {
		return 0, fmt.Errorf("must be a whole number such as 12500 or 12,500 (got %q)", txt)
	}
	n, err := strconv.Atoi(strings.ReplaceAll(txt, ",", ""))
	if err != nil || n > MaxFollowers {
		return 0, fmt.Errorf("is too large (the limit is %d)", MaxFollowers)
	}
	return n, nil
}

// SaveProfile stores the creator's name, tagline and platform handles. A typed follower count goes
// on the platform's latest snapshot, or on this month's when there is none yet.
func SaveProfile(s *store.Store, in ProfileInput) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := upsert(tx, "creator_name", strings.TrimSpace(in.Name)); err != nil {
		return err
	}
	if err := upsert(tx, "creator_tagline", strings.TrimSpace(in.Tagline)); err != nil {
		return err
	}
	for _, p := range model.PlatformKeys {
		handle := strings.TrimSpace(in.Handles[p])
		if handle == "" {
			handle = "—"
		}
		if _, err := tx.Exec(`UPDATE platforms SET handle = ? WHERE id = ?`, handle, p); err != nil {
			return err
		}
		followers, err := ParseFollowers(in.Followers[p])
		if err != nil {
			return crm.ErrInvalid(fmt.Sprintf("followers.%s: %s", p, err.Error()))
		}
		if followers <= 0 {
			continue
		}
		var id int
		err = tx.QueryRow(`SELECT id FROM audience_snapshots WHERE platform_id = ? ORDER BY month DESC LIMIT 1`, p).Scan(&id)
		switch err {
		case nil:
			_, err = tx.Exec(`UPDATE audience_snapshots SET followers = ? WHERE id = ?`, followers, id)
		case sql.ErrNoRows:
			_, err = tx.Exec(`INSERT INTO audience_snapshots (platform_id, month, followers) VALUES (?, ?, ?)`, p, s.Today()[:7], followers)
		}
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
