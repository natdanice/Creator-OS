// Package audience holds the audience side of the CDP: follower growth, demographics, behavioural
// segments and the single profile of one pseudonymous person (src/cdp/profiles.ts).
//
// Only consented data is used: a person who withdrew analytics consent has no comments here, and
// their profile says so. Real handles never exist in the database, the pseudo ID is the identifier.
package audience

import (
	"database/sql"
	"sort"
	"strings"

	"creatoros/internal/dates"
	"creatoros/internal/model"
)

const (
	SegmentWindowDays  = 90
	SuperfanMinComment = 5
	NewDays            = 30
)

// ── Followers and demographics ──

// FollowerSeries is followers per platform per month (the growth chart), oldest month first.
func FollowerSeries(db *sql.DB, today string) ([]map[string]any, error) {
	rows, err := db.Query(`SELECT month, platform_id, followers FROM audience_snapshots WHERE month <= ? ORDER BY month, id`, today[:7])
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var month, platform string
		var followers int
		if err := rows.Scan(&month, &platform, &followers); err != nil {
			return nil, err
		}
		if len(out) == 0 || out[len(out)-1]["month"] != month {
			out = append(out, map[string]any{"month": month})
		}
		out[len(out)-1][platform] = followers
	}
	return out, rows.Err()
}

// AvailableMonths are the months that have a snapshot, newest first.
func AvailableMonths(db *sql.DB, today string) ([]string, error) {
	rows, err := db.Query(`SELECT DISTINCT month FROM audience_snapshots WHERE month <= ? ORDER BY month DESC`, today[:7])
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// LatestSplitMonth is the latest month <= month that has a demographic split for the platform
// (imports often give a split for only one month). Empty when there is none.
func LatestSplitMonth(db *sql.DB, platform, month string) (string, error) {
	var m string
	err := db.QueryRow(`
		SELECT s.month FROM audience_snapshots s JOIN audience_breakdown b ON b.snapshot_id = s.id
		WHERE s.platform_id = ? AND s.month <= ? ORDER BY s.month DESC LIMIT 1`, platform, month).Scan(&m)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return m, err
}

type Share struct {
	Bucket string  `json:"bucket"`
	Pct    float64 `json:"pct"`
}

type Demographics struct {
	PlatformID string  `json:"platformId"`
	Followers  int     `json:"followers"`
	Age        []Share `json:"age"`
	Gender     []Share `json:"gender"`
	Country    []Share `json:"country"`
}

// DemographicsOf is the split of one month for one platform; nil when that month has no snapshot.
func DemographicsOf(db *sql.DB, month, platform string) (*Demographics, error) {
	var id int
	d := Demographics{PlatformID: platform, Age: []Share{}, Gender: []Share{}, Country: []Share{}}
	err := db.QueryRow(`SELECT id, followers FROM audience_snapshots WHERE month = ? AND platform_id = ?`, month, platform).Scan(&id, &d.Followers)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`SELECT dimension, bucket, pct FROM audience_breakdown WHERE snapshot_id = ? ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var dim string
		var s Share
		if err := rows.Scan(&dim, &s.Bucket, &s.Pct); err != nil {
			return nil, err
		}
		switch dim {
		case "age":
			d.Age = append(d.Age, s)
		case "gender":
			d.Gender = append(d.Gender, s)
		case "country":
			d.Country = append(d.Country, s)
		}
	}
	return &d, rows.Err()
}

// ── Segments ──

type person struct {
	id          string
	n, spam, pq int
	requests    int
	platforms   string
	lastAt      string
	firstSeenAt string
	marketing   int
}

func peopleInWindow(db *sql.DB, today string) ([]person, error) {
	since := dates.AddDays(today, -(SegmentWindowDays - 1))
	rows, err := db.Query(`
		SELECT c.author_pseudo_id, COUNT(*),
		       SUM(CASE WHEN c.category = 'spam' THEN 1 ELSE 0 END),
		       SUM(CASE WHEN c.category = 'product_question' THEN 1 ELSE 0 END),
		       SUM(CASE WHEN c.category = 'content_request' THEN 1 ELSE 0 END),
		       group_concat(DISTINCT c.platform_id), MAX(c.created_at), p.first_seen_at,
		       (SELECT COUNT(*) FROM consents k WHERE k.subject_pseudo_id = c.author_pseudo_id AND k.purpose = 'marketing' AND k.status = 'active')
		FROM comments c JOIN pseudonyms p ON p.pseudo_id = c.author_pseudo_id
		WHERE c.redacted = 0 AND substr(c.created_at, 1, 10) >= ? AND substr(c.created_at, 1, 10) <= ?
		GROUP BY c.author_pseudo_id ORDER BY c.author_pseudo_id`, since, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []person
	for rows.Next() {
		var p person
		if err := rows.Scan(&p.id, &p.n, &p.spam, &p.pq, &p.requests, &p.platforms, &p.lastAt, &p.firstSeenAt, &p.marketing); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type SegmentSummary struct {
	ID          string `json:"id"`
	Size        int    `json:"size"`
	Contactable int    `json:"contactable"`
}

type Segments struct {
	ActivePeople int              `json:"activePeople"`
	ExcludedSpam int              `json:"excludedSpam"`
	Summaries    []SegmentSummary `json:"summaries"`

	members map[string]map[string]bool
	byID    map[string]person
	order   []person
}

// ComputeSegments builds every segment. Mostly-spam accounts are left out of all of them.
func ComputeSegments(db *sql.DB, today string) (*Segments, error) {
	people, err := peopleInWindow(db, today)
	if err != nil {
		return nil, err
	}
	var real []person
	for _, p := range people {
		if p.spam*2 < p.n {
			real = append(real, p)
		}
	}
	since := dates.AddDays(today, -(SegmentWindowDays - 1))
	rows, err := db.Query(`
		SELECT DISTINCT c.author_pseudo_id, ct.product_category FROM comments c JOIN contents ct ON ct.id = c.content_id
		WHERE c.redacted = 0 AND c.category = 'product_question' AND substr(c.created_at, 1, 10) >= ? AND substr(c.created_at, 1, 10) <= ?`, since, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	newSince := dates.AddDays(today, -(NewDays - 1))
	ids := []string{"superfans", "requesters", "newcomers", "contactable"}
	members := map[string]map[string]bool{}
	for _, id := range ids {
		members[id] = map[string]bool{}
	}
	for _, c := range model.ProductCategories {
		ids = append(ids, "askers_"+c)
		members["askers_"+c] = map[string]bool{}
	}
	byID := map[string]person{}
	for _, p := range real {
		byID[p.id] = p
		if p.n-p.spam >= SuperfanMinComment {
			members["superfans"][p.id] = true
		}
		if p.requests > 0 {
			members["requesters"][p.id] = true
		}
		if p.firstSeenAt[:10] >= newSince {
			members["newcomers"][p.id] = true
		}
		if p.marketing > 0 {
			members["contactable"][p.id] = true
		}
	}
	for rows.Next() {
		var id, cat string
		if err := rows.Scan(&id, &cat); err != nil {
			return nil, err
		}
		if _, ok := byID[id]; ok {
			if set, ok := members["askers_"+cat]; ok {
				set[id] = true
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	s := &Segments{ActivePeople: len(real), ExcludedSpam: len(people) - len(real), Summaries: []SegmentSummary{}, members: members, byID: byID, order: real}
	for _, id := range ids {
		sum := SegmentSummary{ID: id, Size: len(members[id])}
		for pid := range members[id] {
			if byID[pid].marketing > 0 {
				sum.Contactable++
			}
		}
		s.Summaries = append(s.Summaries, sum)
	}
	return s, nil
}

func (s *Segments) Has(id string) bool { _, ok := s.members[id]; return ok }

type Member struct {
	PseudoID         string   `json:"pseudoId"`
	Comments         int      `json:"comments"`
	ProductQuestions int      `json:"productQuestions"`
	Platforms        []string `json:"platforms"`
	LastAt           string   `json:"lastAt"`
	Contactable      bool     `json:"contactable"`
}

// Members lists a segment's people, most active first (then most recent).
func (s *Segments) Members(id string, limit int) (int, []Member) {
	set, ok := s.members[id]
	if !ok {
		return 0, []Member{}
	}
	var ps []person
	for _, p := range s.order { // keep the query's order so ties stay stable
		if set[p.id] {
			ps = append(ps, p)
		}
	}
	sort.SliceStable(ps, func(i, j int) bool {
		if ps[i].n != ps[j].n {
			return ps[i].n > ps[j].n
		}
		return ps[i].lastAt > ps[j].lastAt
	})
	if limit > 0 && len(ps) > limit {
		ps = ps[:limit]
	}
	out := make([]Member, len(ps))
	for i, p := range ps {
		out[i] = Member{p.id, p.n, p.pq, strings.Split(p.platforms, ","), p.lastAt, p.marketing > 0}
	}
	return len(set), out
}

// ── One person ──

type Consent struct {
	ID              int     `json:"id"`
	SubjectPseudoID string  `json:"subjectPseudoId"`
	Purpose         string  `json:"purpose"`
	LawfulBasis     string  `json:"lawfulBasis"`
	Status          string  `json:"status"`
	Source          string  `json:"source"`
	GrantedAt       string  `json:"grantedAt"`
	WithdrawnAt     *string `json:"withdrawnAt"`
}

type Interest struct {
	Category string `json:"category"`
	N        int    `json:"n"`
}

type PlatformCount struct {
	PlatformID string `json:"platformId"`
	N          int    `json:"n"`
}

type ProfileComment struct {
	ID              int    `json:"id"`
	Text            string `json:"text"`
	Category        string `json:"category"`
	PlatformID      string `json:"platformId"`
	CreatedAt       string `json:"createdAt"`
	ContentTitle    string `json:"contentTitle"`
	ProductCategory string `json:"productCategory"`
}

type Profile struct {
	PseudoID    string           `json:"pseudoId"`
	FirstSeenAt string           `json:"firstSeenAt"`
	Withdrawn   bool             `json:"withdrawn"`
	Consents    []Consent        `json:"consents"`
	Totals      map[string]int   `json:"totals"`
	Interests   []Interest       `json:"interests"`
	Platforms   []PlatformCount  `json:"platforms"`
	LastAt      *string          `json:"lastAt"`
	Comments    []ProfileComment `json:"comments"`
}

var commentCategories = []string{"product_question", "content_request", "general_question", "praise", "spam"}

// GetProfile is the single customer profile of one pseudonymous person; nil when nobody has that ID.
func GetProfile(db *sql.DB, pseudoID, today string) (*Profile, error) {
	p := Profile{PseudoID: pseudoID, Consents: []Consent{}, Interests: []Interest{}, Platforms: []PlatformCount{}, Comments: []ProfileComment{}, Totals: map[string]int{}}
	for _, c := range commentCategories {
		p.Totals[c] = 0
	}
	err := db.QueryRow(`SELECT first_seen_at FROM pseudonyms WHERE pseudo_id = ?`, pseudoID).Scan(&p.FirstSeenAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	crows, err := db.Query(`SELECT id, subject_pseudo_id, purpose, lawful_basis, status, source, granted_at, withdrawn_at FROM consents WHERE subject_pseudo_id = ? ORDER BY granted_at, id`, pseudoID)
	if err != nil {
		return nil, err
	}
	defer crows.Close()
	for crows.Next() {
		var c Consent
		if err := crows.Scan(&c.ID, &c.SubjectPseudoID, &c.Purpose, &c.LawfulBasis, &c.Status, &c.Source, &c.GrantedAt, &c.WithdrawnAt); err != nil {
			return nil, err
		}
		if c.Purpose == "analytics" && c.Status == "withdrawn" {
			p.Withdrawn = true
		}
		p.Consents = append(p.Consents, c)
	}
	if err := crows.Err(); err != nil {
		return nil, err
	}
	if p.Withdrawn {
		return &p, nil
	}
	rows, err := db.Query(`
		SELECT c.id, c.text, c.category, c.platform_id, c.created_at, ct.title, ct.product_category
		FROM comments c JOIN contents ct ON ct.id = c.content_id
		WHERE c.author_pseudo_id = ? AND c.redacted = 0 AND substr(c.created_at, 1, 10) <= ?
		ORDER BY c.created_at DESC, c.id DESC`, pseudoID, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	interest := map[string]int{}
	var interestOrder []string
	plats := map[string]int{}
	var platOrder []string
	for rows.Next() {
		var c ProfileComment
		if err := rows.Scan(&c.ID, &c.Text, &c.Category, &c.PlatformID, &c.CreatedAt, &c.ContentTitle, &c.ProductCategory); err != nil {
			return nil, err
		}
		p.Comments = append(p.Comments, c)
		p.Totals[c.Category]++
		if c.Category != "spam" {
			if _, seen := interest[c.ProductCategory]; !seen {
				interestOrder = append(interestOrder, c.ProductCategory)
			}
			interest[c.ProductCategory]++
		}
		if _, seen := plats[c.PlatformID]; !seen {
			platOrder = append(platOrder, c.PlatformID)
		}
		plats[c.PlatformID]++
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, c := range interestOrder {
		p.Interests = append(p.Interests, Interest{c, interest[c]})
	}
	sort.SliceStable(p.Interests, func(i, j int) bool { return p.Interests[i].N > p.Interests[j].N })
	for _, c := range platOrder {
		p.Platforms = append(p.Platforms, PlatformCount{c, plats[c]})
	}
	sort.SliceStable(p.Platforms, func(i, j int) bool { return p.Platforms[i].N > p.Platforms[j].N })
	if len(p.Comments) > 0 {
		p.LastAt = &p.Comments[0].CreatedAt
	}
	return &p, nil
}
