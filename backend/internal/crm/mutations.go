package crm

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"creatoros/internal/dates"
	"creatoros/internal/model"
	"creatoros/internal/store"
)

// ErrNotFound is returned when the deal / invoice doesn't exist.
var ErrNotFound = errors.New("not found")

// ErrInvalid is returned for input that can't be accepted (the message is safe to show).
type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

// Activity text is in Thai on purpose: it is data, shown on the brand timeline (src/lib/i18n/th.ts).
var thaiStages = map[string]string{
	"lead": "ลีด", "brief": "รับบรีฟ", "quotation": "เสนอราคา", "production": "ผลิตงาน",
	"posted": "โพสต์แล้ว", "report_sent": "ส่งรายงานแล้ว", "invoiced": "วางบิลแล้ว", "paid": "ชำระแล้ว",
}

var stageActivity = map[string]string{
	"brief": "brief_received", "quotation": "quote_sent", "production": "draft_sent", "posted": "posted",
	"report_sent": "report_sent", "invoiced": "invoiced", "paid": "paid",
}

func nextInvoiceNumber(tx *sql.Tx) (string, error) {
	var n int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM invoices`).Scan(&n); err != nil {
		return "", err
	}
	return fmt.Sprintf("INV-%04d", n+1), nil
}

// MoveDealStage moves a deal along the pipeline. It sets posted / closed dates, creates the invoice
// when the deal reaches Invoiced or Paid, and logs the move on the brand timeline. Moving a deal to
// the stage it is already in changes nothing (changed = false).
func MoveDealStage(s *store.Store, dealID int, stage string) (changed bool, err error) {
	if !ValidStage(stage) {
		return false, ErrInvalid("unknown stage")
	}
	today := s.Today()
	tx, err := s.DB.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	deal, err := GetDeal(tx, dealID)
	if err != nil {
		return false, err
	}
	if deal == nil {
		return false, ErrNotFound
	}
	if deal.Stage == stage {
		return false, nil
	}
	postedAt, closedAt := deal.PostedAt, deal.ClosedAt
	if stage == "posted" && postedAt == nil {
		v := s.Stamp(today, "19:00:00")
		postedAt = &v
	}
	if stage == "paid" {
		v := s.Stamp(today, "14:00:00")
		closedAt = &v
	} else if closedAt != nil {
		closedAt = nil
	}
	if _, err := tx.Exec(`UPDATE deals SET stage = ?, posted_at = ?, closed_at = ? WHERE id = ?`, stage, postedAt, closedAt, dealID); err != nil {
		return false, err
	}
	var invID int
	var paidAt sql.NullString
	err = tx.QueryRow(`SELECT id, paid_at FROM invoices WHERE deal_id = ? ORDER BY id LIMIT 1`, dealID).Scan(&invID, &paidAt)
	hasInvoice := err == nil
	if err != nil && err != sql.ErrNoRows {
		return false, err
	}
	switch {
	case (stage == "invoiced" || stage == "paid") && !hasInvoice:
		number, err := nextInvoiceNumber(tx)
		if err != nil {
			return false, err
		}
		var paid any
		if stage == "paid" {
			paid = today
		}
		if _, err := tx.Exec(`INSERT INTO invoices (deal_id, number, amount, issued_at, due_at, paid_at) VALUES (?, ?, ?, ?, ?, ?)`,
			dealID, number, deal.Value, today, dates.AddDays(today, 30), paid); err != nil {
			return false, err
		}
	case stage == "paid" && hasInvoice && !paidAt.Valid:
		if _, err := tx.Exec(`UPDATE invoices SET paid_at = ? WHERE id = ?`, today, invID); err != nil {
			return false, err
		}
	}
	typ := stageActivity[stage]
	if typ == "" {
		typ = "note"
	}
	summary := fmt.Sprintf("ย้าย “%s” ไป %s", deal.Title, thaiStages[stage])
	if _, err := tx.Exec(`INSERT INTO activities (brand_id, deal_id, type, channel, summary, occurred_at) VALUES (?, ?, ?, 'system', ?, ?)`,
		deal.BrandID, dealID, typ, summary, s.Stamp(today, "12:00:00")); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// MarkInvoicePaid pays an invoice. That is the same event as the deal reaching Paid, so the deal moves
// (and the timeline is logged) too. Paying an already-paid invoice does nothing.
func MarkInvoicePaid(s *store.Store, invoiceID int) error {
	var dealID int
	var paidAt sql.NullString
	err := s.DB.QueryRow(`SELECT deal_id, paid_at FROM invoices WHERE id = ?`, invoiceID).Scan(&dealID, &paidAt)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if paidAt.Valid {
		return nil
	}
	if _, err := MoveDealStage(s, dealID, "paid"); err != nil {
		return err
	}
	_, err = s.DB.Exec(`UPDATE invoices SET paid_at = ? WHERE id = ? AND paid_at IS NULL`, s.Today(), invoiceID)
	return err
}

type NewBrand struct {
	Name        string `json:"name"`
	Category    string `json:"category"`
	Website     string `json:"website"`
	ContactName string `json:"contactName"`
	ContactRole string `json:"contactRole"`
	Channel     string `json:"channel"`
	Handle      string `json:"handle"`
}

func oneOf(v string, allowed []string, fallback string) string {
	for _, a := range allowed {
		if a == v {
			return v
		}
	}
	return fallback
}

func orDash(v string) string {
	if v = strings.TrimSpace(v); v == "" {
		return "—"
	}
	return v
}

// CreateBrand adds a brand with its primary contact and a timeline note; returns the new id.
func CreateBrand(s *store.Store, in NewBrand) (int, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return 0, ErrInvalid("brand name is required")
	}
	today := s.Today()
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var website any
	if w := strings.TrimSpace(in.Website); w != "" {
		website = w
	}
	res, err := tx.Exec(`INSERT INTO brands (name, category, website, created_at) VALUES (?, ?, ?, ?)`,
		name, oneOf(in.Category, model.ProductCategories, "home"), website, s.Stamp(today, "10:00:00"))
	if err != nil {
		return 0, err
	}
	id64, _ := res.LastInsertId()
	id := int(id64)
	if _, err := tx.Exec(`INSERT INTO brand_contacts (brand_id, name, role, channel, handle, is_primary) VALUES (?, ?, ?, ?, ?, 1)`,
		id, orDash(in.ContactName), orDash(in.ContactRole), oneOf(in.Channel, []string{"line", "email", "ig_dm"}, "line"), orDash(in.Handle)); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`INSERT INTO activities (brand_id, type, channel, summary, occurred_at) VALUES (?, 'note', 'system', 'เพิ่มแบรนด์ใน Creator OS', ?)`,
		id, s.Stamp(today, "10:00:00")); err != nil {
		return 0, err
	}
	return id, tx.Commit()
}
