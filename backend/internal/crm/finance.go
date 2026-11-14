package crm

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"creatoros/internal/dates"
)

// Finance rollups from invoices (src/crm/finance.ts).
//
//	Income      = invoice amounts by paid_at (cash basis).
//	Outstanding = unpaid invoices. Overdue = unpaid and past due_at.
//	Expected    = won deals not yet invoiced (Production -> Report sent).
//	By platform = each invoice split across its deliverables by rate-card price.
//	Tax         = an ESTIMATE only: Thai companies usually withhold 3% on service fees.
const WHTRate = 0.03

var IncomeBuckets = []string{"tiktok", "instagram", "youtube", "addons"}
var Ageing = []string{"notDue", "d1_30", "d31_60", "d61"}

type InvoiceRow struct {
	ID          int     `json:"id"`
	DealID      int     `json:"dealId"`
	Number      string  `json:"number"`
	Amount      int     `json:"amount"`
	IssuedAt    string  `json:"issuedAt"`
	DueAt       string  `json:"dueAt"`
	PaidAt      *string `json:"paidAt"`
	DealTitle   string  `json:"dealTitle"`
	DealStage   string  `json:"dealStage"`
	BrandID     int     `json:"brandId"`
	BrandName   string  `json:"brandName"`
	Status      string  `json:"status"` // paid | due | overdue
	DaysOverdue int     `json:"daysOverdue"`
}

func ListInvoices(db *sql.DB, today string) ([]InvoiceRow, error) {
	rows, err := db.Query(`
		SELECT i.id, i.deal_id, i.number, i.amount, i.issued_at, i.due_at, i.paid_at, d.title, d.stage, b.id, b.name
		FROM invoices i JOIN deals d ON d.id = i.deal_id JOIN brands b ON b.id = d.brand_id
		WHERE i.issued_at <= ? ORDER BY i.id`, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvoiceRow{}
	for rows.Next() {
		var r InvoiceRow
		if err := rows.Scan(&r.ID, &r.DealID, &r.Number, &r.Amount, &r.IssuedAt, &r.DueAt, &r.PaidAt, &r.DealTitle, &r.DealStage, &r.BrandID, &r.BrandName); err != nil {
			return nil, err
		}
		paid := r.PaidAt != nil && *r.PaidAt <= today
		if !paid {
			r.PaidAt = nil
			if d := dates.DiffDays(r.DueAt, today); d > 0 {
				r.DaysOverdue = d
			}
		}
		switch {
		case paid:
			r.Status = "paid"
		case r.DaysOverdue > 0:
			r.Status = "overdue"
		default:
			r.Status = "due"
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Newest first, then by number (descending).
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].IssuedAt != out[j].IssuedAt {
			return out[i].IssuedAt > out[j].IssuedAt
		}
		return out[i].Number > out[j].Number
	})
	return out, nil
}

func ageingOf(r InvoiceRow) string {
	switch {
	case r.DaysOverdue <= 0:
		return "notDue"
	case r.DaysOverdue <= 30:
		return "d1_30"
	case r.DaysOverdue <= 60:
		return "d31_60"
	}
	return "d61"
}

type RateCard struct {
	Code     string
	Platform string // "" = multi-platform / add-on
	Kind     string
	Price    int
	Includes []string
}

func ListRateCard(db *sql.DB) ([]RateCard, error) {
	rows, err := db.Query(`SELECT code, platform_id, kind, price, includes FROM rate_card ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RateCard
	for rows.Next() {
		var c RateCard
		var p sql.NullString
		var inc string
		if err := rows.Scan(&c.Code, &p, &c.Kind, &c.Price, &inc); err != nil {
			return nil, err
		}
		c.Platform = p.String
		_ = json.Unmarshal([]byte(inc), &c.Includes)
		out = append(out, c)
	}
	return out, rows.Err()
}

// PlatformWeights is the share of a deal's value that belongs to each platform / add-ons, from
// rate-card prices. Bundles expand to their parts.
func PlatformWeights(deliverables []string, cards []RateCard) map[string]float64 {
	find := func(code string) *RateCard {
		for i := range cards {
			if cards[i].Code == code {
				return &cards[i]
			}
		}
		return nil
	}
	w := map[string]float64{}
	for _, b := range IncomeBuckets {
		w[b] = 0
	}
	for _, code := range deliverables {
		card := find(code)
		if card == nil {
			continue
		}
		switch {
		case card.Kind == "addon":
			w["addons"] += float64(card.Price)
		case card.Platform != "":
			w[card.Platform] += float64(card.Price)
		default:
			type part struct {
				p        float64
				platform string
			}
			var parts []part
			sum := 0.0
			for _, c := range card.Includes {
				x := find(c)
				p, pl := 0.0, ""
				if x != nil {
					p, pl = float64(x.Price), x.Platform
				}
				parts = append(parts, part{p, pl})
				sum += p
			}
			if sum == 0 {
				sum = 1
			}
			for _, x := range parts {
				if _, ok := w[x.platform]; ok {
					w[x.platform] += float64(card.Price) * x.p / sum
				}
			}
		}
	}
	total := 0.0
	for _, b := range IncomeBuckets {
		total += w[b]
	}
	if total == 0 {
		total = 1
	}
	out := map[string]float64{}
	for _, b := range IncomeBuckets {
		out[b] = w[b] / total
	}
	return out
}

type FinanceKpis struct {
	IncomeYTD        int      `json:"incomeYtd"`
	IncomePrevYTD    int      `json:"incomePrevYtd"`
	Outstanding      int      `json:"outstanding"`
	OutstandingCount int      `json:"outstandingCount"`
	Overdue          int      `json:"overdue"`
	OverdueCount     int      `json:"overdueCount"`
	AvgDaysToPay     *float64 `json:"avgDaysToPay"`
	Expected         int      `json:"expected"`
	ExpectedCount    int      `json:"expectedCount"`
}
type ExpectedDeal struct {
	ID        int    `json:"id"`
	Title     string `json:"title"`
	Stage     string `json:"stage"`
	Value     int    `json:"value"`
	BrandID   int    `json:"brandId"`
	BrandName string `json:"brandName"`
}
type MonthIncome struct {
	Month  string `json:"month"`
	Income int    `json:"income"`
}
type BrandIncome struct {
	BrandID   int    `json:"brandId"`
	BrandName string `json:"brandName"`
	Income    int    `json:"income"`
	Invoices  int    `json:"invoices"`
}
type AgeBucket struct {
	N      int `json:"n"`
	Amount int `json:"amount"`
}
type TaxYear struct {
	Year     string `json:"year"`
	Gross    int    `json:"gross"`
	WHT      int    `json:"wht"`
	Net      int    `json:"net"`
	Invoices int    `json:"invoices"`
}
type FinanceData struct {
	Rows       []InvoiceRow         `json:"rows"`
	Kpis       FinanceKpis          `json:"kpis"`
	Expected   []ExpectedDeal       `json:"expected"`
	Monthly    []MonthIncome        `json:"monthly"`
	ByBrand    []BrandIncome        `json:"byBrand"`
	ByPlatform map[string]float64   `json:"byPlatform"`
	Ageing     map[string]AgeBucket `json:"ageing"`
	Tax        []TaxYear            `json:"tax"`
}

func sumAmount(xs []InvoiceRow) int {
	n := 0
	for _, r := range xs {
		n += r.Amount
	}
	return n
}

func FinanceFor(db *sql.DB, today string) (*FinanceData, error) {
	rows, err := ListInvoices(db, today)
	if err != nil {
		return nil, err
	}
	year := today[:4]
	prevYear := fmt.Sprint(atoi(year) - 1)
	lastYearSameDay := prevYear + today[4:]
	var paid, unpaid []InvoiceRow
	for _, r := range rows {
		if r.Status == "paid" {
			paid = append(paid, r)
		} else {
			unpaid = append(unpaid, r)
		}
	}
	filter := func(xs []InvoiceRow, keep func(InvoiceRow) bool) []InvoiceRow {
		var out []InvoiceRow
		for _, r := range xs {
			if keep(r) {
				out = append(out, r)
			}
		}
		return out
	}
	startsWith := func(r InvoiceRow, p string) bool { return strings.HasPrefix(*r.PaidAt, p) }

	d := &FinanceData{Rows: rows}
	k := &d.Kpis
	k.IncomeYTD = sumAmount(filter(paid, func(r InvoiceRow) bool { return startsWith(r, year) }))
	k.IncomePrevYTD = sumAmount(filter(paid, func(r InvoiceRow) bool { return startsWith(r, prevYear) && *r.PaidAt <= lastYearSameDay }))
	k.Outstanding, k.OutstandingCount = sumAmount(unpaid), len(unpaid)
	overdue := filter(unpaid, func(r InvoiceRow) bool { return r.Status == "overdue" })
	k.Overdue, k.OverdueCount = sumAmount(overdue), len(overdue)

	yearAgo := dates.AddDays(today, -364)
	paid12 := filter(paid, func(r InvoiceRow) bool { return *r.PaidAt >= yearAgo })
	if len(paid12) > 0 {
		total := 0
		for _, r := range paid12 {
			total += dates.DiffDays(r.IssuedAt, *r.PaidAt)
		}
		avg := float64(total) / float64(len(paid12))
		k.AvgDaysToPay = &avg
	}

	// Expected: won deals not yet invoiced.
	type dealRow struct {
		id, brandID, value                 int
		title, stage, createdAt, brandName string
		deliverables                       []string
	}
	drows, err := db.Query(`SELECT d.id, d.brand_id, d.value, d.title, d.stage, d.created_at, b.name, d.deliverables FROM deals d JOIN brands b ON b.id = d.brand_id ORDER BY d.id`)
	if err != nil {
		return nil, err
	}
	var allDeals []dealRow
	dealByID := map[int]dealRow{}
	for drows.Next() {
		var r dealRow
		var raw string
		if err := drows.Scan(&r.id, &r.brandID, &r.value, &r.title, &r.stage, &r.createdAt, &r.brandName, &raw); err != nil {
			drows.Close()
			return nil, err
		}
		_ = json.Unmarshal([]byte(raw), &r.deliverables)
		allDeals = append(allDeals, r)
		dealByID[r.id] = r
	}
	drows.Close()
	invoiced := map[int]bool{}
	for _, r := range rows {
		invoiced[r.DealID] = true
	}
	d.Expected = []ExpectedDeal{}
	for _, r := range allDeals {
		if dates.Day(r.createdAt) <= today && StageAtLeast(r.stage, "production") && !StageAtLeast(r.stage, "invoiced") && !invoiced[r.id] {
			d.Expected = append(d.Expected, ExpectedDeal{r.id, r.title, r.stage, r.value, r.brandID, r.brandName})
			k.Expected += r.value
		}
	}
	k.ExpectedCount = len(d.Expected)

	// Monthly cash received, last 12 months.
	thisMonth := dates.MonthOf(today)
	for i := 0; i < 12; i++ {
		m := dates.AddMonths(thisMonth, i-11)
		d.Monthly = append(d.Monthly, MonthIncome{m, sumAmount(filter(paid, func(r InvoiceRow) bool { return startsWith(r, m) }))})
	}

	// Income by brand (12 months), in order of first payment seen, then by income.
	d.ByBrand = []BrandIncome{}
	pos := map[int]int{}
	for _, r := range paid12 {
		i, ok := pos[r.BrandID]
		if !ok {
			i = len(d.ByBrand)
			pos[r.BrandID] = i
			d.ByBrand = append(d.ByBrand, BrandIncome{BrandID: r.BrandID, BrandName: r.BrandName})
		}
		d.ByBrand[i].Income += r.Amount
		d.ByBrand[i].Invoices++
	}
	sort.SliceStable(d.ByBrand, func(i, j int) bool { return d.ByBrand[i].Income > d.ByBrand[j].Income })

	// Income by platform (12 months).
	cards, err := ListRateCard(db)
	if err != nil {
		return nil, err
	}
	d.ByPlatform = map[string]float64{}
	for _, b := range IncomeBuckets {
		d.ByPlatform[b] = 0
	}
	for _, r := range paid12 {
		w := PlatformWeights(dealByID[r.DealID].deliverables, cards)
		for _, b := range IncomeBuckets {
			d.ByPlatform[b] += float64(r.Amount) * w[b]
		}
	}

	d.Ageing = map[string]AgeBucket{}
	for _, a := range Ageing {
		d.Ageing[a] = AgeBucket{}
	}
	for _, r := range unpaid {
		a := d.Ageing[ageingOf(r)]
		a.N++
		a.Amount += r.Amount
		d.Ageing[ageingOf(r)] = a
	}

	// Tax estimate per year, newest first.
	seen := map[string]bool{}
	var years []string
	for _, r := range paid {
		if y := (*r.PaidAt)[:4]; !seen[y] {
			seen[y] = true
			years = append(years, y)
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(years)))
	d.Tax = []TaxYear{}
	for _, y := range years {
		in := filter(paid, func(r InvoiceRow) bool { return startsWith(r, y) })
		gross := sumAmount(in)
		d.Tax = append(d.Tax, TaxYear{y, gross, jsRound(float64(gross) * WHTRate), jsRound(float64(gross) * (1 - WHTRate)), len(in)})
	}
	return d, nil
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		n = n*10 + int(c-'0')
	}
	return n
}

// InvoicesCSV is the per-year export for the accountant (UTF-8 with a BOM so Excel opens Thai text).
func InvoicesCSV(rows []InvoiceRow, year string) string {
	esc := func(v string) string {
		if strings.ContainsAny(v, "\",\n") {
			return `"` + strings.ReplaceAll(v, `"`, `""`) + `"`
		}
		return v
	}
	var paid []InvoiceRow
	for _, r := range rows {
		if r.PaidAt != nil && strings.HasPrefix(*r.PaidAt, year) {
			paid = append(paid, r)
		}
	}
	sort.SliceStable(paid, func(i, j int) bool { return *paid[i].PaidAt < *paid[j].PaidAt })
	lines := []string{"invoice,brand,deal,issued,due,paid,amount_thb,wht_3pct_est,net_thb"}
	for _, r := range paid {
		lines = append(lines, strings.Join([]string{
			esc(r.Number), esc(r.BrandName), esc(r.DealTitle), r.IssuedAt, r.DueAt, *r.PaidAt,
			fmt.Sprint(r.Amount), fmt.Sprint(jsRound(float64(r.Amount) * WHTRate)), fmt.Sprint(jsRound(float64(r.Amount) * (1 - WHTRate))),
		}, ","))
	}
	return "\xef\xbb\xbf" + strings.Join(lines, "\n") + "\n"
}
