package cdp

import (
	"database/sql"
	"math"

	"creatoros/internal/dates"
	"creatoros/internal/model"
)

// Spike rule parameters (src/cdp/segments.ts): product questions in a category over the last 7 days
// vs the daily average of the 28 days before, flagged at 3x and at least 20 questions.
const (
	spikeRecentDays   = 7
	spikeBaselineDays = 28
	spikeRatio        = 3.0
	spikeMinRecent    = 20
)

type CategorySpike struct {
	Category       string  `json:"category"`
	Recent         int     `json:"recent"`
	Baseline       int     `json:"baseline"`
	RecentPerDay   float64 `json:"recentPerDay"`
	BaselinePerDay float64 `json:"baselinePerDay"`
	// Ratio is null when there was no baseline at all (an infinite jump).
	Ratio   *float64 `json:"ratio"`
	IsSpike bool     `json:"isSpike"`
}

// ProductQuestionSpikes reads comments through the consent filter (redacted people never count).
func ProductQuestionSpikes(db *sql.DB, today string) ([]CategorySpike, error) {
	recentStart := dates.AddDays(today, -(spikeRecentDays - 1))
	baseStart := dates.AddDays(recentStart, -spikeBaselineDays)
	rows, err := db.Query(`
		SELECT ct.product_category,
		       COALESCE(SUM(CASE WHEN substr(c.created_at, 1, 10) >= ? THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN substr(c.created_at, 1, 10) <  ? THEN 1 ELSE 0 END), 0)
		FROM comments c JOIN contents ct ON ct.id = c.content_id
		WHERE c.category = 'product_question' AND c.redacted = 0
		  AND substr(c.created_at, 1, 10) >= ? AND substr(c.created_at, 1, 10) <= ?
		GROUP BY ct.product_category`, recentStart, recentStart, baseStart, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type counts struct{ recent, baseline int }
	got := map[string]counts{}
	for rows.Next() {
		var cat string
		var c counts
		if err := rows.Scan(&cat, &c.recent, &c.baseline); err != nil {
			return nil, err
		}
		got[cat] = c
	}
	out := make([]CategorySpike, 0, len(model.ProductCategories))
	for _, cat := range model.ProductCategories {
		c := got[cat]
		s := CategorySpike{Category: cat, Recent: c.recent, Baseline: c.baseline}
		s.RecentPerDay = float64(c.recent) / spikeRecentDays
		s.BaselinePerDay = float64(c.baseline) / spikeBaselineDays
		ratio := math.Inf(1)
		switch {
		case s.BaselinePerDay > 0:
			ratio = s.RecentPerDay / s.BaselinePerDay
		case c.recent == 0:
			ratio = 0
		}
		if !math.IsInf(ratio, 0) {
			s.Ratio = &ratio
		}
		s.IsSpike = c.recent >= spikeMinRecent && ratio >= spikeRatio
		out = append(out, s)
	}
	return out, nil
}
