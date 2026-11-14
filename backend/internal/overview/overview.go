// Package overview computes the Overview page's numbers (src/lib/queries/overview.ts): KPIs with a
// previous-period comparison, daily views per platform, top content grouped by video, and the
// rule-based insight. Every figure comes from database rows at request time.
package overview

import (
	"database/sql"
	"sort"
	"strconv"
	"strings"

	"creatoros/internal/cdp"
	"creatoros/internal/crm"
	"creatoros/internal/dates"
	"creatoros/internal/model"
	"creatoros/internal/store"
)

type metrics struct {
	Platform                                            string
	Views, Likes, Comments, Shares, Saves, NewFollowers int
}

// Kpi is a total, the previous period's total, and the split by platform.
type Kpi struct {
	Total      float64            `json:"total"`
	Prev       float64            `json:"prev"`
	ByPlatform map[string]float64 `json:"byPlatform"`
}

type Window struct {
	Start     string `json:"start"`
	End       string `json:"end"`
	PrevStart string `json:"prevStart"`
	PrevEnd   string `json:"prevEnd"`
}

type SeriesDay map[string]any

type TopPost struct {
	ID       int    `json:"id"`
	Platform string `json:"platformId"`
	Views    int    `json:"views"`
}

type TopContent struct {
	Key          string    `json:"key"`
	Title        string    `json:"title"`
	Titles       []string  `json:"titles"`
	Type         string    `json:"type"`
	IsSponsored  bool      `json:"isSponsored"`
	PostedAt     string    `json:"postedAt"`
	Posts        []TopPost `json:"posts"`
	Views        int       `json:"views"`
	NewFollowers int       `json:"newFollowers"`
	ER           float64   `json:"er"`
}

type TypeLift struct {
	Type  string  `json:"type"`
	Posts int     `json:"posts"`
	FPK   float64 `json:"fpk"`
}
type PlatformInsight struct {
	PlatformID string     `json:"platformId"`
	Avg        float64    `json:"avg"`
	Types      []TypeLift `json:"types"`
	Best       *TypeLift  `json:"best,omitempty"`
	Lift       float64    `json:"lift"`
}
type Insight struct {
	PerPlatform []PlatformInsight `json:"perPlatform"`
	Headline    *PlatformInsight  `json:"headline"`
}

type Data struct {
	Window Window `json:"window"`
	Kpis   struct {
		Views     Kpi `json:"views"`
		Followers Kpi `json:"followers"`
		ER        Kpi `json:"er"`
		PQ        Kpi `json:"pq"`
	} `json:"kpis"`
	Series []SeriesDay  `json:"series"`
	Top    []TopContent `json:"top"`
	Pieces struct {
		Videos int `json:"videos"`
		Posts  int `json:"posts"`
	} `json:"pieces"`
	Insight Insight             `json:"insight"`
	Spikes  []cdp.CategorySpike `json:"spikes"`
}

// postTotals sums the per-post daily metrics by platform.
func postTotals(db *sql.DB, start, end string) ([]metrics, error) {
	rows, err := db.Query(`
		SELECT c.platform_id, COALESCE(SUM(m.views),0), COALESCE(SUM(m.likes),0), COALESCE(SUM(m.comments),0),
		       COALESCE(SUM(m.shares),0), COALESCE(SUM(m.saves),0), COALESCE(SUM(m.new_followers),0)
		FROM content_metrics_daily m JOIN contents c ON c.id = m.content_id
		WHERE m.date >= ? AND m.date <= ? GROUP BY c.platform_id ORDER BY c.platform_id`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []metrics
	for rows.Next() {
		var m metrics
		if err := rows.Scan(&m.Platform, &m.Views, &m.Likes, &m.Comments, &m.Shares, &m.Saves, &m.NewFollowers); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// metricTotals are per-platform totals. Where account-level daily data exists (e.g. TikTok Studio's
// overview), it wins over summed posts.
func metricTotals(db *sql.DB, start, end string) ([]metrics, error) {
	fromPosts, err := postTotals(db, start, end)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`
		SELECT platform_id, COALESCE(SUM(views),0), COALESCE(SUM(likes),0), COALESCE(SUM(comments),0),
		       COALESCE(SUM(shares),0), COALESCE(SUM(new_followers),0)
		FROM account_daily WHERE date >= ? AND date <= ? GROUP BY platform_id ORDER BY platform_id`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var acct []metrics
	for rows.Next() {
		var m metrics
		if err := rows.Scan(&m.Platform, &m.Views, &m.Likes, &m.Comments, &m.Shares, &m.NewFollowers); err != nil {
			return nil, err
		}
		acct = append(acct, m)
	}
	has := map[string]bool{}
	for _, a := range acct {
		has[a.Platform] = true
	}
	var out []metrics
	for _, p := range fromPosts {
		if !has[p.Platform] {
			out = append(out, p)
		}
	}
	for _, a := range acct {
		for _, p := range fromPosts {
			if p.Platform == a.Platform {
				a.Saves = p.Saves
			}
		}
		out = append(out, a)
	}
	return out, nil
}

func pqCounts(db *sql.DB, start, end string) (map[string]int, error) {
	rows, err := db.Query(`
		SELECT platform_id, COUNT(*) FROM comments
		WHERE category = 'product_question' AND redacted = 0
		  AND substr(created_at,1,10) >= ? AND substr(created_at,1,10) <= ? GROUP BY platform_id`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var p string
		var n int
		if err := rows.Scan(&p, &n); err != nil {
			return nil, err
		}
		out[p] = n
	}
	return out, rows.Err()
}

func er(rows []metrics) float64 {
	var a metrics
	for _, r := range rows {
		a.Views += r.Views
		a.Likes += r.Likes
		a.Comments += r.Comments
		a.Shares += r.Shares
		a.Saves += r.Saves
	}
	return crm.EngagementRate(a.Views, a.Likes, a.Comments, a.Shares, a.Saves)
}

func kpiOf(cur, prev []metrics, pick func(metrics) int) Kpi {
	k := Kpi{ByPlatform: map[string]float64{}}
	for _, p := range model.PlatformKeys {
		k.ByPlatform[p] = 0
	}
	for _, r := range cur {
		k.Total += float64(pick(r))
		k.ByPlatform[r.Platform] += float64(pick(r))
	}
	for _, r := range prev {
		k.Prev += float64(pick(r))
	}
	return k
}

// Compute builds the Overview for the `rng` days ending on `today`.
func Compute(db *sql.DB, today string, rng int) (*Data, error) {
	start, end := dates.WindowEnding(today, rng)
	prevEnd := dates.AddDays(start, -1)
	prevStart := dates.AddDays(prevEnd, -(rng - 1))
	cur, err := metricTotals(db, start, end)
	if err != nil {
		return nil, err
	}
	prev, err := metricTotals(db, prevStart, prevEnd)
	if err != nil {
		return nil, err
	}
	d := &Data{Window: Window{start, end, prevStart, prevEnd}}
	d.Kpis.Views = kpiOf(cur, prev, func(m metrics) int { return m.Views })
	d.Kpis.Followers = kpiOf(cur, prev, func(m metrics) int { return m.NewFollowers })
	d.Kpis.ER = Kpi{Total: er(cur), Prev: er(prev), ByPlatform: map[string]float64{}}
	for _, p := range model.PlatformKeys {
		var mine []metrics
		for _, r := range cur {
			if r.Platform == p {
				mine = append(mine, r)
			}
		}
		d.Kpis.ER.ByPlatform[p] = er(mine)
	}
	pqCur, err := pqCounts(db, start, end)
	if err != nil {
		return nil, err
	}
	pqPrev, err := pqCounts(db, prevStart, prevEnd)
	if err != nil {
		return nil, err
	}
	d.Kpis.PQ = Kpi{ByPlatform: map[string]float64{}}
	for _, p := range model.PlatformKeys {
		d.Kpis.PQ.ByPlatform[p] = float64(pqCur[p])
	}
	for _, n := range pqCur {
		d.Kpis.PQ.Total += float64(n)
	}
	for _, n := range pqPrev {
		d.Kpis.PQ.Prev += float64(n)
	}

	if d.Series, err = dailySeries(db, start, end); err != nil {
		return nil, err
	}
	posts, err := windowPosts(db, start, end)
	if err != nil {
		return nil, err
	}
	if d.Top, d.Pieces.Videos, d.Pieces.Posts, err = topContent(db, posts, 8); err != nil {
		return nil, err
	}
	if d.Insight, err = insightData(db, start, end); err != nil {
		return nil, err
	}
	all, err := cdp.ProductQuestionSpikes(db, today)
	if err != nil {
		return nil, err
	}
	d.Spikes = []cdp.CategorySpike{}
	for _, s := range all {
		if s.IsSpike {
			d.Spikes = append(d.Spikes, s)
		}
	}
	return d, nil
}

// dailySeries is views per day per platform. A platform with account-level data in the window uses it.
func dailySeries(db *sql.DB, start, end string) ([]SeriesDay, error) {
	posts := map[string]int{}
	rows, err := db.Query(`
		SELECT m.date, c.platform_id, SUM(m.views) FROM content_metrics_daily m
		JOIN contents c ON c.id = m.content_id WHERE m.date >= ? AND m.date <= ? GROUP BY m.date, c.platform_id`, start, end)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var date, p string
		var v int
		if err := rows.Scan(&date, &p, &v); err != nil {
			rows.Close()
			return nil, err
		}
		posts[date+"|"+p] = v
	}
	rows.Close()
	acct := map[string]int{}
	hasAcct := map[string]bool{}
	rows, err = db.Query(`SELECT date, platform_id, views FROM account_daily WHERE date >= ? AND date <= ?`, start, end)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var date, p string
		var v int
		if err := rows.Scan(&date, &p, &v); err != nil {
			rows.Close()
			return nil, err
		}
		acct[date+"|"+p] = v
		hasAcct[p] = true
	}
	rows.Close()
	var out []SeriesDay
	for _, date := range dates.DaysBetween(start, end) {
		row := SeriesDay{"date": date}
		for _, p := range model.PlatformKeys {
			if hasAcct[p] {
				row[p] = acct[date+"|"+p]
			} else {
				row[p] = posts[date+"|"+p]
			}
		}
		out = append(out, row)
	}
	return out, nil
}

type postRow struct {
	ID          int
	Title       string
	Platform    string
	Type        string
	IsSponsored bool
	PostedAt    string
	metrics
}

func windowPosts(db *sql.DB, start, end string) ([]postRow, error) {
	rows, err := db.Query(`
		SELECT c.id, c.title, c.platform_id, c.type, c.is_sponsored, c.posted_at,
		       SUM(m.views), SUM(m.likes), SUM(m.comments), SUM(m.shares), SUM(m.saves), SUM(m.new_followers)
		FROM content_metrics_daily m JOIN contents c ON c.id = m.content_id
		WHERE m.date >= ? AND m.date <= ? GROUP BY c.id ORDER BY c.id`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []postRow
	for rows.Next() {
		var r postRow
		if err := rows.Scan(&r.ID, &r.Title, &r.Platform, &r.Type, &r.IsSponsored, &r.PostedAt, &r.Views, &r.Likes, &r.Comments, &r.Shares, &r.Saves, &r.NewFollowers); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// topContent groups the window's posts into videos (the same video on several platforms is one
// piece), adds up their numbers and ranks by total views. Members with no activity in the window
// still show, with 0 views, so a video stays complete.
func topContent(db *sql.DB, rows []postRow, limit int) ([]TopContent, int, int, error) {
	byID := map[int]postRow{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	all, err := cdp.ContentGroups(db)
	if err != nil {
		return nil, 0, 0, err
	}
	var groups [][]int
	var missing []int
	for _, g := range all {
		in := false
		for _, id := range g {
			if _, ok := byID[id]; ok {
				in = true
			}
		}
		if !in {
			continue
		}
		groups = append(groups, g)
		for _, id := range g {
			if _, ok := byID[id]; !ok {
				missing = append(missing, id)
			}
		}
	}
	if len(missing) > 0 {
		q := `SELECT id, title, platform_id, type, is_sponsored, posted_at FROM contents WHERE id IN (` + store.Placeholders(len(missing)) + `)`
		args := make([]any, len(missing))
		for i, id := range missing {
			args[i] = id
		}
		mr, err := db.Query(q, args...)
		if err != nil {
			return nil, 0, 0, err
		}
		for mr.Next() {
			var r postRow
			if err := mr.Scan(&r.ID, &r.Title, &r.Platform, &r.Type, &r.IsSponsored, &r.PostedAt); err != nil {
				mr.Close()
				return nil, 0, 0, err
			}
			byID[r.ID] = r
		}
		mr.Close()
	}
	var top []TopContent
	nPosts := 0
	for _, g := range groups {
		nPosts += len(g)
		members := make([]postRow, len(g))
		for i, id := range g {
			members[i] = byID[id]
		}
		sort.SliceStable(members, func(i, j int) bool {
			if members[i].Views != members[j].Views {
				return members[i].Views > members[j].Views
			}
			return members[i].PostedAt < members[j].PostedAt
		})
		first := members[0]
		var sum metrics
		keys := make([]string, len(members))
		c := TopContent{Titles: []string{}, Posts: []TopPost{}}
		for i, m := range members {
			sum.Views += m.Views
			sum.Likes += m.Likes
			sum.Comments += m.Comments
			sum.Shares += m.Shares
			sum.Saves += m.Saves
			sum.NewFollowers += m.NewFollowers
			keys[i] = strconv.Itoa(m.ID)
			c.Titles = append(c.Titles, m.Title)
			c.Posts = append(c.Posts, TopPost{m.ID, m.Platform, m.Views})
			c.IsSponsored = c.IsSponsored || m.IsSponsored
			if m.PostedAt < first.PostedAt {
				first = m
			}
		}
		c.Key = strings.Join(keys, "-")
		c.Title, c.Type, c.PostedAt = members[0].Title, members[0].Type, first.PostedAt
		c.Views, c.NewFollowers = sum.Views, sum.NewFollowers
		c.ER = crm.EngagementRate(sum.Views, sum.Likes, sum.Comments, sum.Shares, sum.Saves)
		top = append(top, c)
	}
	sort.SliceStable(top, func(i, j int) bool { return top[i].Views > top[j].Views })
	if len(top) > limit {
		top = top[:limit]
	}
	if top == nil {
		top = []TopContent{}
	}
	return top, len(groups), nPosts, nil
}

// insightData: for each platform, followers gained per 1,000 views by content type within the window
// (types with at least 3 posts). The headline is the platform/type with the largest lift over that
// platform's average.
func insightData(db *sql.DB, start, end string) (Insight, error) {
	rows, err := db.Query(`
		SELECT c.platform_id, c.type, COUNT(DISTINCT c.id), SUM(m.views), SUM(m.new_followers)
		FROM content_metrics_daily m JOIN contents c ON c.id = m.content_id
		WHERE m.date >= ? AND m.date <= ? GROUP BY c.platform_id, c.type ORDER BY c.platform_id, c.type`, start, end)
	if err != nil {
		return Insight{}, err
	}
	defer rows.Close()
	type row struct {
		platform, typ           string
		posts, views, followers int
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.platform, &r.typ, &r.posts, &r.views, &r.followers); err != nil {
			return Insight{}, err
		}
		all = append(all, r)
	}
	in := Insight{PerPlatform: []PlatformInsight{}}
	for _, p := range model.PlatformKeys {
		views, followers := 0, 0
		var types []TypeLift
		for _, r := range all {
			if r.platform != p {
				continue
			}
			views += r.views
			followers += r.followers
		}
		avg := 0.0
		if views > 0 {
			avg = float64(followers) / float64(views) * 1000
		}
		for _, r := range all {
			// no per-post follower data -> no claim
			if r.platform == p && r.posts >= 3 && r.views > 0 && r.followers > 0 {
				types = append(types, TypeLift{r.typ, r.posts, float64(r.followers) / float64(r.views) * 1000})
			}
		}
		sort.SliceStable(types, func(i, j int) bool { return types[i].FPK > types[j].FPK })
		pi := PlatformInsight{PlatformID: p, Avg: avg, Types: append([]TypeLift{}, types...)}
		if len(types) > 0 {
			best := types[0]
			pi.Best = &best
			if avg > 0 {
				pi.Lift = best.FPK / avg
			}
		}
		in.PerPlatform = append(in.PerPlatform, pi)
	}
	var withBest []PlatformInsight
	for _, p := range in.PerPlatform {
		if p.Best != nil {
			withBest = append(withBest, p)
		}
	}
	sort.SliceStable(withBest, func(i, j int) bool { return withBest[i].Lift > withBest[j].Lift })
	if len(withBest) > 0 {
		h := withBest[0]
		in.Headline = &h
	}
	return in, nil
}
