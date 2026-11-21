package crm

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"creatoros/internal/dates"
	"creatoros/internal/model"
	"creatoros/internal/store"
)

// ErrNotFound is what every "no such thing" error matches (errors.Is). Use NotFound for a message that names the thing.
var ErrNotFound = errors.New("not found")

type notFoundError struct{ msg string }

func (e notFoundError) Error() string        { return e.msg }
func (e notFoundError) Is(target error) bool { return target == ErrNotFound }

// NotFound is "No <thing> with id N": a 404 that tells the caller what was looked up.
func NotFound(thing string, id any) error {
	return notFoundError{fmt.Sprintf("No %s with id %v", thing, id)}
}

// NotFoundMsg is a 404 with a custom message.
func NotFoundMsg(msg string) error { return notFoundError{msg} }

// ErrInvalid is returned for input that can't be accepted (the message is safe to show).
type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

// ErrConflict is returned when the request is fine but the current data doesn't allow it (the message is safe to show).
type ErrConflict string

func (e ErrConflict) Error() string { return string(e) }

// Activity text is in Thai on purpose: it is data, shown on the brand timeline (src/lib/i18n/th.ts).
var thaiStages = map[string]string{
	"lead": "ลีด", "brief": "รับบรีฟ", "quotation": "เสนอราคา", "production": "ผลิตงาน",
	"posted": "โพสต์แล้ว", "report_sent": "ส่งรายงานแล้ว", "invoiced": "วางบิลแล้ว", "paid": "ชำระแล้ว",
}

// What a move to each stage logs on the brand timeline. Reaching Production is not "a draft was sent", so it
// is a plain stage change.
var stageActivity = map[string]string{
	"brief": "brief_received", "quotation": "quote_sent", "production": "stage_change", "posted": "posted",
	"report_sent": "report_sent", "invoiced": "invoiced", "paid": "paid",
}

// nextInvoiceNumber is one more than the highest INV-NNNN so far. (Not COUNT+1: a voided invoice leaves a gap,
// and the next number must not collide with one that exists.)
func nextInvoiceNumber(tx *sql.Tx) (string, error) {
	var n int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(CAST(SUBSTR(number, 5) AS INTEGER)), 0) FROM invoices WHERE number LIKE 'INV-%'`).Scan(&n); err != nil {
		return "", err
	}
	return fmt.Sprintf("INV-%04d", n+1), nil
}

// MoveResult says what a stage move did.
type MoveResult struct {
	Changed        bool    `json:"changed"`
	InvoiceCreated *string `json:"invoiceCreated,omitempty"` // invoice number, when the move created one
	InvoicePaid    *string `json:"invoicePaid,omitempty"`    // invoice number, when the move marked one paid
	InvoiceVoided  *string `json:"invoiceVoided,omitempty"`  // invoice number, when the move cancelled an unpaid one
	Reason         string  `json:"reason,omitempty"`         // why nothing changed
}

// MoveDealStage moves a deal along the pipeline. The deal, its invoice, the finance numbers and the brand tier
// are kept in agreement by one rule: an invoice exists only while the deal is at Invoiced or Paid, and it is
// paid only while the deal is Paid.
//
//   - Reaching Invoiced or Paid creates the invoice; reaching Paid marks it paid.
//   - Moving back before Invoiced cancels (deletes) the invoice if it is unpaid.
//   - A deal whose invoice is already paid can't move back at all (that would rewrite recorded income and
//     silently change the brand's tier): the move is refused with the reason.
//
// Moving a deal to the stage it is already in changes nothing (Changed = false, with a Reason).
func MoveDealStage(s *store.Store, dealID int, stage string) (MoveResult, error) {
	if !ValidStage(stage) {
		return MoveResult{}, ErrInvalid(fmt.Sprintf("unknown stage %q: use one of %s", stage, strings.Join(model.DealStages, ", ")))
	}
	today := s.Today()
	tx, err := s.DB.Begin()
	if err != nil {
		return MoveResult{}, err
	}
	defer tx.Rollback()
	deal, err := GetDeal(tx, dealID)
	if err != nil {
		return MoveResult{}, err
	}
	if deal == nil {
		return MoveResult{}, NotFound("deal", dealID)
	}
	if deal.Stage == stage {
		return MoveResult{Reason: "the deal is already at " + stage}, nil
	}
	var invID int
	var invNumber string
	var paidAt sql.NullString
	err = tx.QueryRow(`SELECT id, number, paid_at FROM invoices WHERE deal_id = ? ORDER BY id LIMIT 1`, dealID).Scan(&invID, &invNumber, &paidAt)
	hasInvoice := err == nil
	if err != nil && err != sql.ErrNoRows {
		return MoveResult{}, err
	}
	if hasInvoice && paidAt.Valid && stage != "paid" {
		return MoveResult{}, ErrConflict(fmt.Sprintf("Invoice %s for this deal is already paid, so the deal can't move back to %s. It stays Paid so the income and the brand's tier stay correct.", invNumber, stage))
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
		return MoveResult{}, err
	}

	res := MoveResult{Changed: true}
	switch {
	case (stage == "invoiced" || stage == "paid") && !hasInvoice:
		number, err := nextInvoiceNumber(tx)
		if err != nil {
			return MoveResult{}, err
		}
		var paid any
		if stage == "paid" {
			paid = today
		}
		if _, err := tx.Exec(`INSERT INTO invoices (deal_id, number, amount, issued_at, due_at, paid_at) VALUES (?, ?, ?, ?, ?, ?)`,
			dealID, number, deal.Value, today, dates.AddDays(today, 30), paid); err != nil {
			return MoveResult{}, err
		}
		res.InvoiceCreated = &number
		if stage == "paid" {
			res.InvoicePaid = &number
		}
	case stage == "paid" && hasInvoice && !paidAt.Valid:
		if _, err := tx.Exec(`UPDATE invoices SET paid_at = ? WHERE id = ?`, today, invID); err != nil {
			return MoveResult{}, err
		}
		res.InvoicePaid = &invNumber
	case hasInvoice && !paidAt.Valid && stageIndex(stage) < stageIndex("invoiced"):
		// Back before Invoiced: the unpaid invoice no longer describes the deal, so it is cancelled.
		if _, err := tx.Exec(`DELETE FROM invoices WHERE id = ?`, invID); err != nil {
			return MoveResult{}, err
		}
		res.InvoiceVoided = &invNumber
	}
	typ := stageActivity[stage]
	if typ == "" {
		typ = "note"
	}
	summary := fmt.Sprintf("ย้าย “%s” ไป %s", deal.Title, thaiStages[stage])
	if res.InvoiceVoided != nil {
		summary += fmt.Sprintf(" (ยกเลิกใบวางบิล %s)", *res.InvoiceVoided)
	}
	if _, err := tx.Exec(`INSERT INTO activities (brand_id, deal_id, type, channel, summary, occurred_at) VALUES (?, ?, ?, 'system', ?, ?)`,
		deal.BrandID, dealID, typ, summary, s.Stamp(today, "12:00:00")); err != nil {
		return MoveResult{}, err
	}
	return res, tx.Commit()
}

// PaidResult says what marking an invoice paid did.
type PaidResult struct {
	OK          bool   `json:"ok"`
	AlreadyPaid bool   `json:"alreadyPaid"`
	Number      string `json:"number"`
}

// MarkInvoicePaid pays an invoice. That is the same event as the deal reaching Paid, so the deal moves
// (and the timeline is logged) too. Paying an already-paid invoice does nothing (AlreadyPaid = true).
func MarkInvoicePaid(s *store.Store, invoiceID int) (PaidResult, error) {
	var dealID int
	var number string
	var paidAt sql.NullString
	err := s.DB.QueryRow(`SELECT deal_id, number, paid_at FROM invoices WHERE id = ?`, invoiceID).Scan(&dealID, &number, &paidAt)
	if err == sql.ErrNoRows {
		return PaidResult{}, NotFound("invoice", invoiceID)
	}
	if err != nil {
		return PaidResult{}, err
	}
	if paidAt.Valid {
		return PaidResult{OK: true, AlreadyPaid: true, Number: number}, nil
	}
	if _, err := MoveDealStage(s, dealID, "paid"); err != nil {
		return PaidResult{}, err
	}
	if _, err := s.DB.Exec(`UPDATE invoices SET paid_at = ? WHERE id = ? AND paid_at IS NULL`, s.Today(), invoiceID); err != nil {
		return PaidResult{}, err
	}
	return PaidResult{OK: true, Number: number}, nil
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

// Longest accepted text per field (in characters).
const (
	MaxBrandName    = 120
	MaxBrandWebsite = 200
	MaxContactName  = 120
	MaxContactRole  = 80
	MaxHandle       = 120
)

// ContactChannels are the ways a brand contact can be reached.
var ContactChannels = []string{"line", "email", "ig_dm"}

func orDash(v string) string {
	if v = strings.TrimSpace(v); v == "" {
		return "—"
	}
	return v
}

func inList(v string, allowed []string) bool {
	for _, a := range allowed {
		if a == v {
			return true
		}
	}
	return false
}

func tooLong(field, v string, max int) error {
	if n := utf8.RuneCountInString(v); n > max {
		return ErrInvalid(fmt.Sprintf("%s is too long (%d characters; the limit is %d)", field, n, max))
	}
	return nil
}

// CreateBrand adds a brand, an optional primary contact and a timeline note; returns the new id.
//
// Nothing is guessed: the category must be one of ProductCategories; a contact is only created when at least one of
// contactName / contactRole / handle is given (and then channel must be one of ContactChannels); names are unique
// ignoring case and surrounding spaces; and every text field has a length limit.
func CreateBrand(s *store.Store, in NewBrand) (int, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return 0, ErrInvalid("brand name is required")
	}
	category := strings.TrimSpace(in.Category)
	if !inList(category, model.ProductCategories) {
		return 0, ErrInvalid(fmt.Sprintf("category must be one of: %s", strings.Join(model.ProductCategories, ", ")))
	}
	website, contactName, contactRole, handle := strings.TrimSpace(in.Website), strings.TrimSpace(in.ContactName), strings.TrimSpace(in.ContactRole), strings.TrimSpace(in.Handle)
	for _, c := range []struct {
		field, v string
		max      int
	}{{"name", name, MaxBrandName}, {"website", website, MaxBrandWebsite}, {"contactName", contactName, MaxContactName}, {"contactRole", contactRole, MaxContactRole}, {"handle", handle, MaxHandle}} {
		if err := tooLong(c.field, c.v, c.max); err != nil {
			return 0, err
		}
	}
	hasContact := contactName != "" || contactRole != "" || handle != ""
	channel := strings.TrimSpace(in.Channel)
	if hasContact && !inList(channel, ContactChannels) {
		return 0, ErrInvalid(fmt.Sprintf("channel must be one of: %s (it says how the contact is reached)", strings.Join(ContactChannels, ", ")))
	}

	today := s.Today()
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var existingID int
	var existingName string
	err = tx.QueryRow(`SELECT id, name FROM brands WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1`, name).Scan(&existingID, &existingName)
	if err == nil {
		return 0, ErrConflict(fmt.Sprintf("A brand named %q already exists (id %d). Use that one, or pick a different name.", existingName, existingID))
	}
	if err != sql.ErrNoRows {
		return 0, err
	}
	var site any
	if website != "" {
		site = website
	}
	res, err := tx.Exec(`INSERT INTO brands (name, category, website, created_at) VALUES (?, ?, ?, ?)`, name, category, site, s.Stamp(today, "10:00:00"))
	if err != nil {
		return 0, err
	}
	id64, _ := res.LastInsertId()
	id := int(id64)
	if hasContact {
		if _, err := tx.Exec(`INSERT INTO brand_contacts (brand_id, name, role, channel, handle, is_primary) VALUES (?, ?, ?, ?, ?, 1)`,
			id, orDash(contactName), orDash(contactRole), channel, orDash(handle)); err != nil {
			return 0, err
		}
	}
	if _, err := tx.Exec(`INSERT INTO activities (brand_id, type, channel, summary, occurred_at) VALUES (?, 'note', 'system', 'เพิ่มแบรนด์ใน Creator OS', ?)`,
		id, s.Stamp(today, "10:00:00")); err != nil {
		return 0, err
	}
	return id, tx.Commit()
}
