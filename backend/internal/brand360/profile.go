package brand360

import (
	"database/sql"

	"creatoros/internal/crm"
)

type Invoice struct {
	ID       int     `json:"id"`
	DealID   int     `json:"dealId"`
	Number   string  `json:"number"`
	Amount   int     `json:"amount"`
	IssuedAt string  `json:"issuedAt"`
	DueAt    string  `json:"dueAt"`
	PaidAt   *string `json:"paidAt"`
}

type Activity struct {
	ID         int    `json:"id"`
	BrandID    int    `json:"brandId"`
	DealID     *int   `json:"dealId"`
	Type       string `json:"type"`
	Channel    string `json:"channel"`
	Summary    string `json:"summary"`
	OccurredAt string `json:"occurredAt"`
}

// RateName is a rate-card code with its display name.
type RateName struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type Profile struct {
	Stats       crm.BrandStats `json:"stats"`
	Performance []Performance  `json:"performance"`
	Offer       *Offer         `json:"offer"`
	Invoices    []Invoice      `json:"invoices"`
	Activities  []Activity     `json:"activities"`
	RateCard    []RateName     `json:"rateCard"`
}

// Get returns nil when there is no such brand.
func Get(db *sql.DB, brandID int, today string) (*Profile, error) {
	all, err := crm.ComputeBrandStats(db, today)
	if err != nil {
		return nil, err
	}
	var st *crm.BrandStats
	for i := range all {
		if all[i].Brand.ID == brandID {
			st = &all[i]
		}
	}
	if st == nil {
		return nil, nil
	}
	dealIDs := make([]int, len(st.Deals))
	for i, d := range st.Deals {
		dealIDs[i] = d.ID
	}
	ids, err := SponsoredContentIDs(db, dealIDs)
	if err != nil {
		return nil, err
	}
	perf, err := ContentPerformance(db, ids, today)
	if err != nil {
		return nil, err
	}
	SortNewestFirst(perf)
	offer, err := RecommendNextOffer(db, *st, today, perf)
	if err != nil {
		return nil, err
	}
	p := &Profile{Stats: *st, Performance: perf, Offer: offer, Invoices: []Invoice{}, Activities: []Activity{}, RateCard: []RateName{}}

	if len(dealIDs) > 0 {
		args, ph := idList(dealIDs)
		rows, err := db.Query(`SELECT id, deal_id, number, amount, issued_at, due_at, paid_at FROM invoices WHERE deal_id IN (`+ph+`) ORDER BY id`, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var i Invoice
			if err := rows.Scan(&i.ID, &i.DealID, &i.Number, &i.Amount, &i.IssuedAt, &i.DueAt, &i.PaidAt); err != nil {
				return nil, err
			}
			p.Invoices = append(p.Invoices, i)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	arows, err := db.Query(`SELECT id, brand_id, deal_id, type, channel, summary, occurred_at FROM activities WHERE brand_id = ? AND substr(occurred_at, 1, 10) <= ? ORDER BY occurred_at DESC, id DESC`, brandID, today)
	if err != nil {
		return nil, err
	}
	defer arows.Close()
	for arows.Next() {
		var a Activity
		if err := arows.Scan(&a.ID, &a.BrandID, &a.DealID, &a.Type, &a.Channel, &a.Summary, &a.OccurredAt); err != nil {
			return nil, err
		}
		p.Activities = append(p.Activities, a)
	}
	if err := arows.Err(); err != nil {
		return nil, err
	}
	crows, err := db.Query(`SELECT code, name FROM rate_card ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer crows.Close()
	for crows.Next() {
		var r RateName
		if err := crows.Scan(&r.Code, &r.Name); err != nil {
			return nil, err
		}
		p.RateCard = append(p.RateCard, r)
	}
	return p, crows.Err()
}
