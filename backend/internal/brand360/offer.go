package brand360

import (
	"database/sql"
	"sort"

	"creatoros/internal/crm"
	"creatoros/internal/dates"
	"creatoros/internal/model"
)

// Offer is the "recommended next offer": first matching rule wins. The numbers behind the reason are
// in Vars; the web app writes the title and reason in the reader's language (src/crm/presentOffer.ts).
//
//  1. starter   never won                       → TT_VIDEO (low-risk entry)
//  2. reengage  silent 120+ days                → their last package
//  3. retainer  partner                         → RETAINER_Q
//  4. bundle    one platform bought, ER ≥ the creator's sponsored median → BUNDLE_3P
//  5. dedicated 8+ product questions per post   → YT_DEDICATED
//  6. repeat    otherwise                       → last package + usage rights
type Offer struct {
	Rule  string         `json:"rule"`
	Codes []string       `json:"codes"`
	Price int            `json:"price"`
	Vars  map[string]any `json:"vars"`
}

type card struct {
	Code, Name, Kind string
	Price            int
	Includes         []string
}

func loadCards(db *sql.DB) (map[string]card, error) {
	rows, err := db.Query(`SELECT code, name, kind, price, includes FROM rate_card`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]card{}
	for rows.Next() {
		var c card
		var inc string
		if err := rows.Scan(&c.Code, &c.Name, &c.Kind, &c.Price, &inc); err != nil {
			return nil, err
		}
		c.Includes = jsonStrings(inc)
		out[c.Code] = c
	}
	return out, rows.Err()
}

// The platform a content-producing rate-card code is published on.
var deliverablePlatform = map[string]string{"TT_VIDEO": "tiktok", "IG_REEL": "instagram", "YT_INTEGRATION": "youtube", "YT_DEDICATED": "youtube"}

// followersAsOf is the total of each platform's latest snapshot up to the month of asOf.
func followersAsOf(db *sql.DB, asOf string) (int, error) {
	var total sql.NullInt64
	err := db.QueryRow(`
		SELECT SUM(f) FROM (
		  SELECT (SELECT followers FROM audience_snapshots s WHERE s.platform_id = p.id AND s.month <= ? ORDER BY s.month DESC LIMIT 1) AS f
		  FROM platforms p)`, asOf[:7]).Scan(&total)
	return int(total.Int64), err
}

func categoryAvgViews(db *sql.DB, category string) (float64, error) {
	rows, err := db.Query(`
		SELECT SUM(m.views) FROM contents c JOIN content_metrics_daily m ON m.content_id = c.id
		WHERE c.product_category = ? GROUP BY c.id`, category)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n, sum := 0, 0
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return 0, err
		}
		n++
		sum += v
	}
	if n == 0 {
		return 0, rows.Err()
	}
	return float64(sum) / float64(n), rows.Err()
}

// RecommendNextOffer picks the offer for one brand. perf is the brand's sponsored post performance.
func RecommendNextOffer(db *sql.DB, st crm.BrandStats, today string, perf []Performance) (*Offer, error) {
	cards, err := loadCards(db)
	if err != nil {
		return nil, err
	}
	names := func(codes []string) string {
		out := ""
		for i, c := range codes {
			if i > 0 {
				out += " + "
			}
			out += cards[c].Name
		}
		return out
	}
	price := func(codes []string) int {
		t := 0
		for _, c := range codes {
			t += cards[c].Price
		}
		return t
	}
	make := func(rule string, codes []string, vars map[string]any) *Offer {
		return &Offer{Rule: rule, Codes: codes, Price: price(codes), Vars: vars}
	}

	var won []model.Deal
	for _, d := range st.Deals {
		if d.PostedAt != nil {
			won = append(won, d)
		}
	}
	sort.SliceStable(won, func(i, j int) bool { return *won[i].PostedAt < *won[j].PostedAt })
	var last *model.Deal
	lastCodes := []string{}
	if len(won) > 0 {
		last = &won[len(won)-1]
		for _, c := range last.Deliverables {
			if cards[c].Kind != "addon" {
				lastCodes = append(lastCodes, c)
			}
		}
	}

	if st.Jobs == 0 {
		avg, err := categoryAvgViews(db, st.Brand.Category)
		if err != nil {
			return nil, err
		}
		return make("starter", []string{"TT_VIDEO"}, map[string]any{"pkg": cards["TT_VIDEO"].Name, "category": st.Brand.Category, "avgViews": avg}), nil
	}

	if st.IsSilent && last != nil {
		views := 0
		for _, p := range perf {
			if p.DealID != nil && *p.DealID == last.ID {
				if p.D30 != nil {
					views += p.D30.Views
				} else {
					views += p.ToDate.Views
				}
			}
		}
		then, err := followersAsOf(db, *last.PostedAt)
		if err != nil {
			return nil, err
		}
		now, err := followersAsOf(db, today)
		if err != nil {
			return nil, err
		}
		growth := 0.0
		if then != 0 {
			growth = float64(now)/float64(then) - 1
		}
		days := 0
		if st.DaysSinceLastActivity != nil {
			days = *st.DaysSinceLastActivity
		}
		return make("reengage", lastCodes, map[string]any{"pkg": names(lastCodes), "days": days, "views": views, "growth": growth}), nil
	}

	if st.Tier == "partner" {
		windowStart := dates.AddDays(today, -(crm.TierWindowDays - 1))
		paid := 0
		for _, d := range st.Deals {
			if d.Stage == "paid" && d.ClosedAt != nil && (*d.ClosedAt)[:10] >= windowStart && (*d.ClosedAt)[:10] <= today {
				paid += d.Value
			}
		}
		return make("retainer", []string{"RETAINER_Q"}, map[string]any{"n": st.PaidInWindow, "value": paid}), nil
	}

	bought := map[string]bool{}
	for _, d := range st.Deals {
		for _, code := range d.Deliverables {
			parts := cards[code].Includes
			if len(parts) == 0 {
				parts = []string{code}
			}
			for _, c := range parts {
				if p := deliverablePlatform[c]; p != "" {
					bought[p] = true
				}
			}
		}
	}
	brandER := 0.0
	if len(perf) > 0 {
		for _, p := range perf {
			brandER += p.ToDate.ER
		}
		brandER /= float64(len(perf))
	}
	median, err := CreatorSponsoredMedianER(db, today)
	if err != nil {
		return nil, err
	}
	if len(bought) == 1 && brandER >= median && len(perf) > 0 {
		platform := ""
		for p := range bought {
			platform = p
		}
		return make("bundle", []string{"BUNDLE_3P"}, map[string]any{"platform": platform, "er": brandER, "median": median}), nil
	}

	pqPerPost := 0.0
	if len(perf) > 0 {
		for _, p := range perf {
			pqPerPost += float64(p.ProductQuestionsToDate)
		}
		pqPerPost /= float64(len(perf))
	}
	hasDedicated := false
	for _, c := range lastCodes {
		if c == "YT_DEDICATED" {
			hasDedicated = true
		}
	}
	if pqPerPost >= 8 && !hasDedicated {
		return make("dedicated", []string{"YT_DEDICATED"}, map[string]any{"n": pqPerPost}), nil
	}

	base := lastCodes
	if len(base) == 0 {
		base = []string{"TT_VIDEO"}
	}
	codes := append(append([]string{}, base...), "ADDON_USAGE")
	return make("repeat", codes, map[string]any{"pkg": names(base)}), nil
}
