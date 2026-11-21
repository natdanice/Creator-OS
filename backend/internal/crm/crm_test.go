package crm_test

import (
	"errors"
	"fmt"
	"strings"
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
	res, err := crm.MoveDealStage(s, 10, "invoiced")
	if err != nil || !res.Changed || res.InvoiceCreated == nil || *res.InvoiceCreated != "INV-0001" {
		t.Fatalf("move: %+v %v", res, err)
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
	if res, err = crm.MoveDealStage(s, 10, "paid"); err != nil || res.InvoicePaid == nil {
		t.Fatalf("pay: %+v %v", res, err)
	}
	var closed, paidAt string
	_ = s.DB.QueryRow(`SELECT closed_at FROM deals WHERE id = 10`).Scan(&closed)
	_ = s.DB.QueryRow(`SELECT paid_at FROM invoices WHERE deal_id = 10`).Scan(&paidAt)
	if closed != "2026-10-31T14:00:00" || paidAt != "2026-10-31" {
		t.Errorf("closed %s, invoice paid %s", closed, paidAt)
	}

	// A paid deal can't move back: that would rewrite income and silently change the brand's tier.
	for _, back := range []string{"invoiced", "posted", "brief"} {
		_, err := crm.MoveDealStage(s, 10, back)
		var c crm.ErrConflict
		if !errors.As(err, &c) || !strings.Contains(err.Error(), "INV-0001") {
			t.Errorf("moving a paid deal back to %s must be refused with the invoice named, got %v", back, err)
		}
	}
	var stage string
	_ = s.DB.QueryRow(`SELECT stage FROM deals WHERE id = 10`).Scan(&stage)
	_ = s.DB.QueryRow(`SELECT paid_at FROM invoices WHERE deal_id = 10`).Scan(&paidAt)
	if stage != "paid" || paidAt != "2026-10-31" {
		t.Errorf("a refused move must change nothing: stage %s, invoice paid %s", stage, paidAt)
	}

	if res, _ := crm.MoveDealStage(s, 10, "paid"); res.Changed || res.Reason == "" {
		t.Errorf("moving to the same stage should change nothing and say why: %+v", res)
	}
	if _, err := crm.MoveDealStage(s, 10, "nonsense"); err == nil {
		t.Error("unknown stage must be rejected")
	} else if _, ok := err.(crm.ErrInvalid); !ok {
		t.Errorf("want ErrInvalid, got %T", err)
	}
	if _, err := crm.MoveDealStage(s, 999, "paid"); !errors.Is(err, crm.ErrNotFound) || err.Error() != "No deal with id 999" {
		t.Errorf("unknown deal: %v", err)
	}
}

// The deal, its invoice, the finance numbers and the brand tier must always agree.
func TestStageAndInvoiceStayInStep(t *testing.T) {
	s := seed(t)
	count := func(q string) (n int) { _ = s.DB.QueryRow(q).Scan(&n); return }
	today := "2026-10-31"

	// Invoiced -> back before Invoiced: the unpaid invoice is cancelled and says so.
	if _, err := crm.MoveDealStage(s, 10, "invoiced"); err != nil {
		t.Fatal(err)
	}
	res, err := crm.MoveDealStage(s, 10, "production")
	if err != nil || res.InvoiceVoided == nil || *res.InvoiceVoided != "INV-0001" {
		t.Fatalf("back to production: %+v %v", res, err)
	}
	if n := count(`SELECT COUNT(*) FROM invoices WHERE deal_id = 10`); n != 0 {
		t.Errorf("the unpaid invoice should be gone, found %d", n)
	}
	f, _ := crm.FinanceFor(s.DB, today)
	if f.Kpis.Outstanding != 0 {
		t.Errorf("a cancelled invoice must not count as outstanding: %+v", f.Kpis)
	}
	// Invoiced -> Posted keeps working both ways; and invoice numbers never collide after a gap.
	crm.MoveDealStage(s, 10, "invoiced")
	var num string
	_ = s.DB.QueryRow(`SELECT number FROM invoices WHERE deal_id = 10`).Scan(&num)
	if num != "INV-0001" {
		t.Errorf("number after a void = %s (the gap is reused only because nothing else holds it)", num)
	}
	testdb.Exec(t, s, `INSERT INTO invoices (deal_id, number, amount, issued_at, due_at) VALUES (1, 'INV-0007', 1, '2026-01-01', '2026-02-01')`)
	crm.MoveDealStage(s, 10, "brief") // voids INV-0001
	crm.MoveDealStage(s, 10, "invoiced")
	_ = s.DB.QueryRow(`SELECT number FROM invoices WHERE deal_id = 10`).Scan(&num)
	if num != "INV-0008" {
		t.Errorf("next number must follow the highest (INV-0007), got %s", num)
	}

	// Paid -> pipeline, income and tier stay in agreement.
	crm.MoveDealStage(s, 10, "paid")
	f, _ = crm.FinanceFor(s.DB, today)
	stats, _ := crm.ComputeBrandStats(s.DB, today)
	solo := stats[1]
	if f.Kpis.IncomeYTD != 20000 || solo.Tier != "one_time" || solo.PaidInWindow != 1 {
		t.Errorf("income %d, tier %s, paid in window %d", f.Kpis.IncomeYTD, solo.Tier, solo.PaidInWindow)
	}
}

func TestJobsAndLifetimeValueCountOnlyPaidDeals(t *testing.T) {
	s := seed(t)
	// Solo already has one old paid deal (5,000) and an open brief. Add a deal in production: committed, not paid.
	testdb.Exec(t, s, `INSERT INTO deals (id, brand_id, title, stage, value, deliverables, created_at) VALUES (11, 2, 'In production', 'production', 18000, '[]', '2026-10-25T09:00:00')`)
	stats, _ := crm.ComputeBrandStats(s.DB, "2026-10-31")
	solo := stats[1]
	if solo.Jobs != 1 || solo.LifetimeValue != 5000 || solo.AvgDealSize != 5000 {
		t.Errorf("jobs/LTV/avg must count paid deals only: %d / %d / %d", solo.Jobs, solo.LifetimeValue, solo.AvgDealSize)
	}
	if solo.DealValueThisYear != 18000 {
		t.Errorf("committed value still shows in dealValueThisYear: %d", solo.DealValueThisYear)
	}
	// A brand that has never been paid has no jobs and no lifetime value, even with work in production.
	testdb.Exec(t, s, `INSERT INTO brands (id, name, category, created_at) VALUES (3,'Newbie','food','2026-10-01T09:00:00')`)
	testdb.Exec(t, s, `INSERT INTO deals (id, brand_id, title, stage, value, deliverables, created_at) VALUES (12, 3, 'First job', 'production', 18000, '[]', '2026-10-25T09:00:00')`)
	stats, _ = crm.ComputeBrandStats(s.DB, "2026-10-31")
	n := stats[2]
	if n.Tier != "lead" || n.Jobs != 0 || n.LifetimeValue != 0 || n.AvgDealSize != 0 {
		t.Errorf("never-paid brand: tier %s, jobs %d, LTV %d", n.Tier, n.Jobs, n.LifetimeValue)
	}
}

func TestMarkInvoicePaid(t *testing.T) {
	s := seed(t)
	testdb.Exec(t, s, `INSERT INTO invoices (id, deal_id, number, amount, issued_at, due_at) VALUES (1, 10, 'INV-0001', 20000, '2026-10-01', '2026-10-31')`)
	res, err := crm.MarkInvoicePaid(s, 1)
	if err != nil || !res.OK || res.AlreadyPaid || res.Number != "INV-0001" {
		t.Fatalf("pay: %+v %v", res, err)
	}
	var stage, paid string
	_ = s.DB.QueryRow(`SELECT stage FROM deals WHERE id = 10`).Scan(&stage)
	_ = s.DB.QueryRow(`SELECT paid_at FROM invoices WHERE id = 1`).Scan(&paid)
	if stage != "paid" || paid != "2026-10-31" {
		t.Errorf("deal %s, invoice paid %s", stage, paid)
	}
	var n int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM activities WHERE deal_id = 10`).Scan(&n)
	res, err = crm.MarkInvoicePaid(s, 1) // paying twice is a no-op that says so
	if err != nil || !res.AlreadyPaid {
		t.Fatalf("paying twice: %+v %v", res, err)
	}
	var n2 int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM activities WHERE deal_id = 10`).Scan(&n2)
	if n != 1 || n2 != 1 {
		t.Errorf("timeline entries %d then %d, want 1 and 1", n, n2)
	}
	if _, err := crm.MarkInvoicePaid(s, 77); !errors.Is(err, crm.ErrNotFound) || err.Error() != "No invoice with id 77" {
		t.Errorf("unknown invoice: %v", err)
	}
}

func TestProductionMoveIsAStageChangeNotADraft(t *testing.T) {
	s := seed(t)
	crm.MoveDealStage(s, 10, "production")
	var typ string
	_ = s.DB.QueryRow(`SELECT type FROM activities WHERE deal_id = 10`).Scan(&typ)
	if typ != "stage_change" {
		t.Errorf("a move to production logs %q, want stage_change (not draft_sent)", typ)
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
	count := func(q string, args ...any) (n int) { _ = s.DB.QueryRow(q, args...).Scan(&n); return }

	// A brand with no contact details gets no placeholder contact.
	id, err := crm.CreateBrand(s, crm.NewBrand{Name: " Fresh ", Category: "food", Website: " fresh.co ", Channel: "line"})
	if err != nil {
		t.Fatal(err)
	}
	var name, cat, site string
	_ = s.DB.QueryRow(`SELECT name, category, website FROM brands WHERE id = ?`, id).Scan(&name, &cat, &site)
	if name != "Fresh" || cat != "food" || site != "fresh.co" {
		t.Errorf("brand = %q %q %q", name, cat, site)
	}
	if n := count(`SELECT COUNT(*) FROM brand_contacts WHERE brand_id = ?`, id); n != 0 {
		t.Errorf("no contact fields given, but %d contact rows were created", n)
	}
	stats, _ := crm.ComputeBrandStats(s.DB, "2026-10-31")
	if got := stats[len(stats)-1]; got.Brand.ID != id || got.Contact != nil {
		t.Errorf("the brand should have a null contact: %+v", got.Contact)
	}

	// With contact details, the contact is real and the channel is validated, not guessed.
	id2, err := crm.CreateBrand(s, crm.NewBrand{Name: "Mint Co", Category: "tech", ContactName: "Mint", Channel: "email", Handle: "mint@co.th"})
	if err != nil {
		t.Fatal(err)
	}
	var ch, handle, role string
	_ = s.DB.QueryRow(`SELECT channel, handle, role FROM brand_contacts WHERE brand_id = ? AND is_primary = 1`, id2).Scan(&ch, &handle, &role)
	if ch != "email" || handle != "mint@co.th" || role != "—" {
		t.Errorf("contact = %q %q %q", ch, handle, role)
	}

	long := strings.Repeat("x", 5000)
	for _, c := range []struct {
		why string
		in  crm.NewBrand
		msg string
	}{
		{"blank name", crm.NewBrand{Name: "  ", Category: "tech"}, "name is required"},
		{"missing category", crm.NewBrand{Name: "A1"}, "category must be one of"},
		{"invalid category", crm.NewBrand{Name: "A2", Category: "cars"}, "skincare, tech, food, home, fashion, music"},
		{"unknown channel", crm.NewBrand{Name: "A3", Category: "tech", ContactName: "X", Channel: "pigeon"}, "channel must be one of: line, email, ig_dm"},
		{"contact without channel", crm.NewBrand{Name: "A4", Category: "tech", Handle: "@x"}, "channel must be one of"},
		{"name too long", crm.NewBrand{Name: long, Category: "tech"}, "name is too long"},
		{"website too long", crm.NewBrand{Name: "A5", Category: "tech", Website: long}, "website is too long"},
		{"handle too long", crm.NewBrand{Name: "A6", Category: "tech", Handle: long, Channel: "line"}, "handle is too long"},
	} {
		_, err := crm.CreateBrand(s, c.in)
		var inv crm.ErrInvalid
		if !errors.As(err, &inv) || !strings.Contains(err.Error(), c.msg) {
			t.Errorf("%s: got %v, want an ErrInvalid containing %q", c.why, err, c.msg)
		}
	}
	if n := count(`SELECT COUNT(*) FROM brands`); n != 4 {
		t.Errorf("rejected brands must not be saved: %d brands", n)
	}

	// Names are unique ignoring case and surrounding spaces; the error names the existing brand.
	_, err = crm.CreateBrand(s, crm.NewBrand{Name: "  fresh  ", Category: "food"})
	var conflict crm.ErrConflict
	if !errors.As(err, &conflict) || !strings.Contains(err.Error(), fmt.Sprintf("(id %d)", id)) {
		t.Errorf("duplicate name: %v", err)
	}
	if _, err := crm.CreateBrand(s, crm.NewBrand{Name: "GLOW", Category: "skincare"}); !errors.As(err, &conflict) {
		t.Errorf("duplicate of a seeded brand: %v", err)
	}
}
