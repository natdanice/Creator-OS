// Package brand360 is the Single Customer Profile of a brand: post performance, the recommended
// next offer, invoices and the timeline (src/crm/contentPerformance.ts, nextOffer.ts).
package brand360

import (
	"database/sql"
	"encoding/json"
	"sort"

	"creatoros/internal/crm"
	"creatoros/internal/dates"
	"creatoros/internal/model"
	"creatoros/internal/store"
)

type Metrics struct {
	Views        int     `json:"views"`
	Likes        int     `json:"likes"`
	Comments     int     `json:"comments"`
	Shares       int     `json:"shares"`
	Saves        int     `json:"saves"`
	ProfileViews int     `json:"profileViews"`
	NewFollowers int     `json:"newFollowers"`
	ER           float64 `json:"er"`
}

func (m *Metrics) add(views, likes, comments, shares, saves, profileViews, newFollowers int) {
	m.Views += views
	m.Likes += likes
	m.Comments += comments
	m.Shares += shares
	m.Saves += saves
	m.ProfileViews += profileViews
	m.NewFollowers += newFollowers
}

func (m *Metrics) rate() { m.ER = crm.EngagementRate(m.Views, m.Likes, m.Comments, m.Shares, m.Saves) }

// Performance is one post's results. "+N days" = the N days starting on the posting day, and it is
// null until today is at least posted + N (the window is complete).
type Performance struct {
	ContentID              int      `json:"contentId"`
	PlatformID             string   `json:"platformId"`
	Title                  string   `json:"title"`
	Type                   string   `json:"type"`
	ProductCategory        string   `json:"productCategory"`
	PostedAt               string   `json:"postedAt"`
	DealID                 *int     `json:"dealId"`
	D7                     *Metrics `json:"d7"`
	D30                    *Metrics `json:"d30"`
	ToDate                 Metrics  `json:"toDate"`
	ProductQuestions7      int      `json:"productQuestions7"`
	ProductQuestions30     int      `json:"productQuestions30"`
	ProductQuestionsToDate int      `json:"productQuestionsToDate"`
}

func idList(ids []int) ([]any, string) {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args, store.Placeholders(len(ids))
}

// ContentPerformance computes performance for the given posts (people who withdrew consent never
// count towards product questions).
func ContentPerformance(db *sql.DB, contentIDs []int, today string) ([]Performance, error) {
	out := []Performance{}
	if len(contentIDs) == 0 {
		return out, nil
	}
	args, ph := idList(contentIDs)
	rows, err := db.Query(`SELECT id, platform_id, title, type, product_category, posted_at, deal_id FROM contents WHERE id IN (`+ph+`) ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p Performance
		if err := rows.Scan(&p.ContentID, &p.PlatformID, &p.Title, &p.Type, &p.ProductCategory, &p.PostedAt, &p.DealID); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	type row struct {
		date                                                           string
		views, likes, comments, shares, saves, profileViews, followers int
	}
	metrics := map[int][]row{}
	mrows, err := db.Query(`SELECT content_id, date, views, likes, comments, shares, saves, profile_views, new_followers FROM content_metrics_daily WHERE content_id IN (`+ph+`) AND date <= ?`, append(append([]any{}, args...), today)...)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var id int
		var r row
		if err := mrows.Scan(&id, &r.date, &r.views, &r.likes, &r.comments, &r.shares, &r.saves, &r.profileViews, &r.followers); err != nil {
			return nil, err
		}
		metrics[id] = append(metrics[id], r)
	}
	if err := mrows.Err(); err != nil {
		return nil, err
	}
	pq := map[int][]string{}
	crows, err := db.Query(`SELECT content_id, substr(created_at, 1, 10) FROM comments WHERE content_id IN (`+ph+`) AND category = 'product_question' AND redacted = 0`, args...)
	if err != nil {
		return nil, err
	}
	defer crows.Close()
	for crows.Next() {
		var id int
		var day string
		if err := crows.Scan(&id, &day); err != nil {
			return nil, err
		}
		if day <= today {
			pq[id] = append(pq[id], day)
		}
	}
	if err := crows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		p := &out[i]
		posted := p.PostedAt[:10]
		end7, end30 := dates.AddDays(posted, 6), dates.AddDays(posted, 29)
		var t7, t30, all Metrics
		for _, r := range metrics[p.ContentID] {
			if r.date <= end7 {
				t7.add(r.views, r.likes, r.comments, r.shares, r.saves, r.profileViews, r.followers)
			}
			if r.date <= end30 {
				t30.add(r.views, r.likes, r.comments, r.shares, r.saves, r.profileViews, r.followers)
			}
			all.add(r.views, r.likes, r.comments, r.shares, r.saves, r.profileViews, r.followers)
		}
		t7.rate()
		t30.rate()
		all.rate()
		if today >= dates.AddDays(posted, 7) {
			p.D7 = &t7
		}
		if today >= dates.AddDays(posted, 30) {
			p.D30 = &t30
		}
		p.ToDate = all
		for _, day := range pq[p.ContentID] {
			if day <= end7 {
				p.ProductQuestions7++
			}
			if day <= end30 {
				p.ProductQuestions30++
			}
			p.ProductQuestionsToDate++
		}
	}
	return out, nil
}

// SponsoredContentIDs are the posts linked to the given deals.
func SponsoredContentIDs(db *sql.DB, dealIDs []int) ([]int, error) {
	if len(dealIDs) == 0 {
		return []int{}, nil
	}
	args, ph := idList(dealIDs)
	rows, err := db.Query(`SELECT id FROM contents WHERE deal_id IN (`+ph+`) ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// SortNewestFirst orders posts by posting time, newest first.
func SortNewestFirst(p []Performance) {
	sort.SliceStable(p, func(i, j int) bool { return p[i].PostedAt > p[j].PostedAt })
}

func median(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := append([]float64{}, xs...)
	sort.Float64s(s)
	m := len(s) / 2
	if len(s)%2 == 1 {
		return s[m]
	}
	return (s[m-1] + s[m]) / 2
}

// CreatorSponsoredMedianER is the median engagement rate over all the creator's sponsored posts.
func CreatorSponsoredMedianER(db *sql.DB, today string) (float64, error) {
	rows, err := db.Query(`SELECT id FROM contents WHERE is_sponsored = 1 ORDER BY id`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	perf, err := ContentPerformance(db, ids, today)
	if err != nil {
		return 0, err
	}
	ers := make([]float64, len(perf))
	for i, p := range perf {
		ers[i] = p.ToDate.ER
	}
	return median(ers), nil
}

func jsonStrings(raw string) []string {
	var out []string
	_ = json.Unmarshal([]byte(raw), &out)
	return model.Strings(out)
}
