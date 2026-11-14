package crm

import (
	"database/sql"
	"sort"

	"creatoros/internal/dates"
	"creatoros/internal/model"
)

// BrandStats are brand-level rollups relative to a given "today". The brand list, pipeline, next-offer
// rules and automations all use these, so every screen agrees (src/crm/brandStats.ts).
type BrandStats struct {
	Brand                 model.Brand    `json:"brand"`
	Contact               *model.Contact `json:"contact"`
	Tier                  string         `json:"tier"`
	PaidInWindow          int            `json:"paidInWindow"`
	DealValueThisYear     int            `json:"dealValueThisYear"`
	Jobs                  int            `json:"jobs"`
	LifetimeValue         int            `json:"lifetimeValue"`
	AvgDealSize           int            `json:"avgDealSize"`
	LastJobAt             *string        `json:"lastJobAt"`
	DaysSinceLastJob      *int           `json:"daysSinceLastJob"`
	LastActivityAt        *string        `json:"lastActivityAt"`
	DaysSinceLastActivity *int           `json:"daysSinceLastActivity"`
	OpenDeals             int            `json:"openDeals"`
	IsSilent              bool           `json:"isSilent"`
	Deals                 []model.Deal   `json:"deals"`
}

func ComputeBrandStats(db *sql.DB, today string) ([]BrandStats, error) {
	brands, err := ListBrands(db)
	if err != nil {
		return nil, err
	}
	allDeals, err := ListDeals(db)
	if err != nil {
		return nil, err
	}
	contacts, err := ListContacts(db)
	if err != nil {
		return nil, err
	}
	// Latest activity per brand, only up to today.
	lastAct := map[int]string{}
	rows, err := db.Query(`SELECT brand_id, MAX(occurred_at) FROM activities WHERE substr(occurred_at, 1, 10) <= ? GROUP BY brand_id`, today)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int
		var at string
		if err := rows.Scan(&id, &at); err != nil {
			rows.Close()
			return nil, err
		}
		lastAct[id] = at
	}
	rows.Close()

	windowStart := dates.AddDays(today, -(TierWindowDays - 1))
	year := today[:4]
	out := make([]BrandStats, 0, len(brands))
	for _, b := range brands {
		ds := []model.Deal{}
		for _, d := range allDeals { // deals as they were known on `today`
			if d.BrandID == b.ID && dates.Day(d.CreatedAt) <= today {
				ds = append(ds, d)
			}
		}
		s := BrandStats{Brand: b, Deals: ds}
		for _, c := range contacts {
			if c.BrandID == b.ID && c.IsPrimary {
				c := c
				s.Contact = &c
				break
			}
		}
		var lastJob string
		for _, d := range ds {
			if d.Stage == "paid" && d.ClosedAt != nil {
				if day := dates.Day(*d.ClosedAt); day >= windowStart && day <= today {
					s.PaidInWindow++
				}
			}
			if IsWon(d.Stage) {
				s.Jobs++
				s.LifetimeValue += d.Value
				if len(d.CreatedAt) >= 4 && d.CreatedAt[:4] == year {
					s.DealValueThisYear += d.Value
				}
			}
			if IsOpen(d.Stage) {
				s.OpenDeals++
			}
			if d.PostedAt != nil && dates.Day(*d.PostedAt) <= today && *d.PostedAt > lastJob {
				lastJob = *d.PostedAt
			}
		}
		s.Tier = TierFor(s.PaidInWindow)
		if s.Jobs > 0 {
			s.AvgDealSize = jsRound(float64(s.LifetimeValue) / float64(s.Jobs))
		}
		if lastJob != "" {
			days := dates.DiffDays(lastJob, today)
			s.LastJobAt, s.DaysSinceLastJob = &lastJob, &days
		}
		if at, ok := lastAct[b.ID]; ok {
			days := dates.DiffDays(at, today)
			s.LastActivityAt, s.DaysSinceLastActivity = &at, &days
		}
		s.IsSilent = s.Jobs > 0 && s.OpenDeals == 0 && s.DaysSinceLastActivity != nil && *s.DaysSinceLastActivity >= SilentDays
		out = append(out, s)
	}
	return out, nil
}

// FilterBrands applies the brand list's search / tier / category filters and sorts by tier, then by
// this year's deal value (the same order as the page).
func FilterBrands(all []BrandStats, q, tier, category string) []BrandStats {
	rows := []BrandStats{}
	for _, s := range all {
		if q != "" && !containsFold(s.Brand.Name, q) {
			continue
		}
		if tier != "" && s.Tier != tier {
			continue
		}
		if category != "" && s.Brand.Category != category {
			continue
		}
		rows = append(rows, s)
	}
	idx := func(t string) int {
		for i, x := range Tiers {
			if x == t {
				return i
			}
		}
		return len(Tiers)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if a, b := idx(rows[i].Tier), idx(rows[j].Tier); a != b {
			return a < b
		}
		return rows[i].DealValueThisYear > rows[j].DealValueThisYear
	})
	return rows
}

func TierCounts(all []BrandStats) map[string]int {
	out := map[string]int{}
	for _, t := range Tiers {
		out[t] = 0
	}
	for _, s := range all {
		out[s.Tier]++
	}
	return out
}
