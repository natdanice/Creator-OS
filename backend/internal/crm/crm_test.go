package crm_test

import (
	"errors"
	"testing"

	"creatoros/internal/crm"
	"creatoros/internal/store"
	"creatoros/internal/testdb"
)

func seed(t *testing.T) *store.Store {
	s := testdb.New(t)
	testdb.Exec(t, s, `INSERT INTO platforms (id, name, handle, color) VALUES ('tiktok','TikTok','@me','#000')`)
	testdb.Exec(t, s, `INSERT INTO brands (id, name, category, created_at) VALUES (1,'Glow','skincare','2025-01-01T09:00:00'), (2,'Solo','tech','2025-01-01T09:00:00')`)
	testdb.Exec(t, s, `INSERT INTO brand_contacts (brand_id, name, role, channel, handle, is_primary) VALUES (1,'A','PM','email','a@glow.co',1)`)
	// Glow: three paid deals in the last 12 months -> Partner. Solo: one old paid deal -> Lead (outside the window).
	for i, closed := range []string{"2026-03-01", "2026-06-01", "2026-09-01"} {
		testdb.Exec(t, s, `INSERT INTO deals (brand_id, title, stage, value, deliverables, created_at, posted_at, closed_at) VALUES (1, ?, 'paid', 10000, '["TT_VIDEO"]', ?, ?, ?)`,
			"Deal"+string(rune('A'+i)), closed+"T09:00:00", closed+"T19:00:00", closed+"T14:00:00")
	}
	testdb.Exec(t, s, `INSERT INTO deals (brand_id, title, stage, value, deliverables, created_at, posted_at, closed_at) VALUES (2,'Old','paid',5000,'[]','2024-01-01T09:00:00','2024-01-05T09:00:00','2024-02-01T09:00:00')`)
	testdb.Exec(t, s, `INSERT INTO deals (id, brand_id, title, stage, value, deliverables, created_at) VALUES (10, 2, 'Brief in', 'brief', 20000, '[]', '2026-10-20T09:00:00')`)
	return s
}

func TestBrandTiersAndFilters(t *testing.T) {
	s := seed(t)
	stats, err := crm.ComputeBrandStats(s.DB, "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	tiers := map[string]string{}
	for _, b := range stats {
		tiers[b.Brand.Name] = b.Tier
	}
	if tiers["Glow"] != "partner" || tiers["Solo"] != "lead" {
		t.Errorf("tiers = %v", tiers)
	}
	if got := crm.TierCounts(stats); got["partner"] != 1 || got["lead"] != 1 || got["repeat"] != 0 {
		t.Errorf("counts = %v", got)
	}
	if rows := crm.FilterBrands(stats, "GLO", "", ""); len(rows) != 1 || rows[0].Brand.Name != "Glow" {
		t.Errorf("search = %+v", rows)
	}
	if rows := crm.FilterBrands(stats, "", "", ""); rows[0].Brand.Name != "Glow" {
		t.Errorf("partners sort first, got %s", rows[0].Brand.Name)
	}
	if got := stats[0].Deals; len(got) != 3 || got[0].Deliverables[0] != "TT_VIDEO" {
		t.Errorf("deals = %+v", got)
	}
	if stats[1].Contact != nil {
		t.Errorf("Solo has no contact")
	}
}

func TestMoveDealStage(t *testing.T) {
	s := seed(t)
	changed, err := crm.MoveDealStage(s, 10, "invoiced")
	if err != nil || !changed {
		t.Fatalf("move: %v %v", changed, err)
	}
	var num, due string
	var paid *string
	if err := s.DB.QueryRow(`SELECT number, due_at, paid_at FROM invoices WHERE deal_id = 10`).Scan(&num, &due, &paid); err != nil {
		t.Fatal(err)
	}
	if num != "INV-0001" || due != "2026-11-30" || paid != nil {
		t.Errorf("invoice = %s due %s paid %v", num, due, paid)
	}
	var act, summary string
	_ = s.DB.QueryRow(`SELECT type, summary FROM activities WHERE deal_id = 10`).Scan(&act, &summary)
	if act != "invoiced" || summary != "ย้าย “Brief in” ไป วางบิลแล้ว" {
		t.Errorf("activity = %s / %s", act, summary)
	}

	// Paying through the pipeline pays the existing invoice and closes the deal.
	if _, err := crm.MoveDealStage(s, 10, "paid"); err != nil {
		t.Fatal(err)
	}
	var closed, paidAt string
	_ = s.DB.QueryRow(`SELECT closed_at FROM deals WHERE id = 10`).Scan(&closed)
	_ = s.DB.QueryRow(`SELECT paid_at FROM invoices WHERE deal_id = 10`).Scan(&paidAt)
	if closed != "2026-10-31T14:00:00" || paidAt != "2026-10-31" {
		t.Errorf("closed %s, invoice paid %s", closed, paidAt)
	}
	// Moving back clears the closing date.
	if _, err := crm.MoveDealStage(s, 10, "posted"); err != nil {
		t.Fatal(err)
	}
	var c *string
	var posted string
	_ = s.DB.QueryRow(`SELECT closed_at, posted_at FROM deals WHERE id = 10`).Scan(&c, &posted)
	if c != nil || posted != "2026-10-31T19:00:00" {
		t.Errorf("after moving back: closed %v posted %s", c, posted)
	}

	if changed, _ := crm.MoveDealStage(s, 10, "posted"); changed {
		t.Error("moving to the same stage should change nothing")
	}
	if _, err := crm.MoveDealStage(s, 10, "nonsense"); err == nil {
		t.Error("unknown stage must be rejected")
	} else if _, ok := err.(crm.ErrInvalid); !ok {
		t.Errorf("want ErrInvalid, got %T", err)
	}
	if _, err := crm.MoveDealStage(s, 999, "paid"); !errors.Is(err, crm.ErrNotFound) {
		t.Errorf("unknown deal: %v", err)
	}
}

func TestMarkInvoicePaid(t *testing.T) {
	s := seed(t)
	testdb.Exec(t, s, `INSERT INTO invoices (id, deal_id, number, amount, issued_at, due_at) VALUES (1, 10, 'INV-0001', 20000, '2026-10-01', '2026-10-31')`)
	if err := crm.MarkInvoicePaid(s, 1); err != nil {
		t.Fatal(err)
	}
	var stage, paid string
	_ = s.DB.QueryRow(`SELECT stage FROM deals WHERE id = 10`).Scan(&stage)
	_ = s.DB.QueryRow(`SELECT paid_at FROM invoices WHERE id = 1`).Scan(&paid)
	if stage != "paid" || paid != "2026-10-31" {
		t.Errorf("deal %s, invoice paid %s", stage, paid)
	}
	var n int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM activities WHERE deal_id = 10`).Scan(&n)
	if err := crm.MarkInvoicePaid(s, 1); err != nil { // paying twice is a no-op
		t.Fatal(err)
	}
	var n2 int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM activities WHERE deal_id = 10`).Scan(&n2)
	if n != 1 || n2 != 1 {
		t.Errorf("timeline entries %d then %d, want 1 and 1", n, n2)
	}
	if err := crm.MarkInvoicePaid(s, 77); !errors.Is(err, crm.ErrNotFound) {
		t.Errorf("unknown invoice: %v", err)
	}
}

func TestFinanceCashBasisAndOverdue(t *testing.T) {
	s := seed(t)
	testdb.Exec(t, s, `INSERT INTO invoices (deal_id, number, amount, issued_at, due_at, paid_at) VALUES
		(1,'INV-1',10000,'2026-03-05','2026-04-04','2026-03-20'),
		(2,'INV-2',10000,'2026-06-05','2026-07-05',NULL),
		(3,'INV-3',10000,'2026-10-25','2026-11-24',NULL)`)
	f, err := crm.FinanceFor(s.DB, "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	k := f.Kpis
	if k.IncomeYTD != 10000 || k.Outstanding != 20000 || k.Overdue != 10000 || k.OverdueCount != 1 || k.OutstandingCount != 2 {
		t.Errorf("kpis = %+v", k)
	}
	if k.AvgDaysToPay == nil || *k.AvgDaysToPay != 15 {
		t.Errorf("avg days to pay = %v", k.AvgDaysToPay)
	}
	if f.Ageing["d61"].N != 1 || f.Ageing["notDue"].N != 1 { // INV-2 is 118 days late, INV-3 not due yet
		t.Errorf("ageing = %+v", f.Ageing)
	}
	if len(f.Tax) != 1 || f.Tax[0].WHT != 300 || f.Tax[0].Net != 9700 {
		t.Errorf("tax = %+v", f.Tax)
	}
	if len(f.Monthly) != 12 || f.Monthly[11].Month != "2026-10" {
		t.Errorf("monthly = %+v", f.Monthly)
	}
	// Invoices dated in the future are not known yet.
	early, _ := crm.FinanceFor(s.DB, "2026-03-10")
	if len(early.Rows) != 1 {
		t.Errorf("rows on 2026-03-10 = %d", len(early.Rows))
	}
}

func TestCreateBrand(t *testing.T) {
	s := seed(t)
	if _, err := crm.CreateBrand(s, crm.NewBrand{Name: "  "}); err == nil {
		t.Error("blank name must be rejected")
	}
	id, err := crm.CreateBrand(s, crm.NewBrand{Name: " Fresh ", Category: "bogus", Channel: "fax", Website: " fresh.co "})
	if err != nil {
		t.Fatal(err)
	}
	var name, cat, site, channel, handle string
	_ = s.DB.QueryRow(`SELECT name, category, website FROM brands WHERE id = ?`, id).Scan(&name, &cat, &site)
	_ = s.DB.QueryRow(`SELECT channel, handle FROM brand_contacts WHERE brand_id = ? AND is_primary = 1`, id).Scan(&channel, &handle)
	if name != "Fresh" || cat != "home" || site != "fresh.co" || channel != "line" || handle != "—" {
		t.Errorf("brand = %q %q %q %q %q", name, cat, site, channel, handle)
	}
}
