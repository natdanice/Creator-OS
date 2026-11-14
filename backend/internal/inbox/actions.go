package inbox

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"creatoros/internal/crm"
	"creatoros/internal/model"
	"creatoros/internal/store"
)

const newDealTitle = "สร้างดีลใหม่" // default deal title; data text is Thai (src/lib/i18n/th.ts quote.newDeal)

// MarkThreadRead marks every unread inbound message of a brand as read.
func MarkThreadRead(s *store.Store, brandID int) (int64, error) {
	res, err := s.DB.Exec(`UPDATE messages SET read_at = ? WHERE brand_id = ? AND direction = 'in' AND read_at IS NULL`,
		s.Stamp(s.Today(), "10:00:00"), brandID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// nextThreadTime is the next timestamp in a thread: the simulated 10:00 (or the real clock),
// or one minute after the thread's latest message.
func nextThreadTime(s *store.Store, tx *sql.Tx, brandID int, today string) (string, error) {
	var last sql.NullString
	if err := tx.QueryRow(`SELECT MAX(sent_at) FROM messages WHERE brand_id = ?`, brandID).Scan(&last); err != nil {
		return "", err
	}
	base := s.Stamp(today, "10:00:00")
	if !last.Valid || last.String < base {
		return base, nil
	}
	t, err := time.Parse("2006-01-02T15:04:05", last.String[:min(19, len(last.String))])
	if err != nil {
		return base, nil
	}
	return t.Add(time.Minute).Format("2006-01-02T15:04:05"), nil
}

// SendBrandReply records a reply to a brand in its thread and on the brand timeline.
// (Nothing is sent from here: Gmail drafts and LINE messages are made by the web app.)
func SendBrandReply(s *store.Store, brandID int, body string) error {
	text := strings.TrimSpace(body)
	if text == "" {
		return crm.ErrInvalid("the reply is empty")
	}
	var exists int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM brands WHERE id = ?`, brandID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return crm.ErrNotFound
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	channel := "line"
	err = tx.QueryRow(`SELECT channel FROM brand_contacts WHERE brand_id = ? AND is_primary = 1 LIMIT 1`, brandID).Scan(&channel)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	at, err := nextThreadTime(s, tx, brandID, s.Today())
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO messages (brand_id, direction, channel, body, sent_at, read_at, brief_status) VALUES (?, 'out', ?, ?, ?, ?, 'none')`,
		brandID, channel, text, at, at); err != nil {
		return err
	}
	summary := text
	if r := []rune(text); len(r) > 80 {
		summary = string(r[:80]) + "…"
	}
	if _, err := tx.Exec(`INSERT INTO activities (brand_id, type, channel, summary, occurred_at) VALUES (?, 'chat', ?, ?, ?)`, brandID, channel, summary, at); err != nil {
		return err
	}
	return tx.Commit()
}

// ConvertBrief turns a detected brief into a deal at the Brief stage. A brief that was already
// handled does nothing (converted = false).
func ConvertBrief(s *store.Store, messageID int, title string, value float64) (converted bool, err error) {
	today := s.Today()
	tx, err := s.DB.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var brandID int
	var channel, status string
	var readAt sql.NullString
	err = tx.QueryRow(`SELECT brand_id, channel, brief_status, read_at FROM messages WHERE id = ?`, messageID).Scan(&brandID, &channel, &status, &readAt)
	if err == sql.ErrNoRows || (err == nil && status != "new") {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	// Re-read through the shared parser so the brief is decoded the same way as everywhere else.
	th, err := briefOf(tx, messageID)
	if err != nil {
		return false, err
	}
	cards, err := rateCardTx(tx)
	if err != nil {
		return false, err
	}
	var platforms []string
	var product *string
	var budget *int
	if th != nil {
		platforms, product, budget = th.Platforms, th.Product, th.Budget
	}
	list := 0
	for _, code := range GuessDeliverables(platforms) {
		list += cards[code]
	}
	dealTitle := strings.TrimSpace(title)
	if dealTitle == "" && product != nil && *product != "" {
		dealTitle = *product
	}
	if dealTitle == "" {
		dealTitle = newDealTitle
	}
	dealValue := list
	if budget != nil {
		dealValue = *budget
	}
	if value > 0 && value == value { // a positive number
		dealValue = crm.JSRound(value)
	}
	at := s.Stamp(today, "10:00:00")
	res, err := tx.Exec(`INSERT INTO deals (brand_id, title, stage, value, deliverables, created_at) VALUES (?, ?, 'brief', ?, ?, ?)`,
		brandID, dealTitle, dealValue, jsonList(GuessDeliverables(platforms)), at)
	if err != nil {
		return false, err
	}
	dealID, _ := res.LastInsertId()
	read := at
	if readAt.Valid {
		read = readAt.String
	}
	if _, err := tx.Exec(`UPDATE messages SET brief_status = 'converted', deal_id = ?, read_at = ? WHERE id = ?`, dealID, read, messageID); err != nil {
		return false, err
	}
	if _, err := tx.Exec(`INSERT INTO activities (brand_id, deal_id, type, channel, summary, occurred_at) VALUES (?, ?, 'brief_received', ?, ?, ?)`,
		brandID, dealID, channel, fmt.Sprintf("ได้รับบรีฟ: %s", dealTitle), at); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// IgnoreBrief dismisses a brief that is still waiting.
func IgnoreBrief(s *store.Store, messageID int) error {
	_, err := s.DB.Exec(`UPDATE messages SET brief_status = 'ignored' WHERE id = ? AND brief_status = 'new'`, messageID)
	return err
}

// ReplyComment records the reply the creator wrote (it is posted on the platform by hand).
func ReplyComment(s *store.Store, commentID int, text string) error {
	var reply any
	if t := strings.TrimSpace(text); t != "" {
		reply = t
	}
	res, err := s.DB.Exec(`UPDATE comments SET reply_status = 'replied', reply_text = ?, replied_at = ? WHERE id = ?`, reply, s.Stamp(s.Today(), "10:00:00"), commentID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return crm.ErrNotFound
	}
	return nil
}

func HideComment(s *store.Store, commentID int) error {
	res, err := s.DB.Exec(`UPDATE comments SET reply_status = 'hidden' WHERE id = ?`, commentID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return crm.ErrNotFound
	}
	return nil
}

func rateCardTx(tx *sql.Tx) (map[string]int, error) {
	rows, err := tx.Query(`SELECT code, price FROM rate_card`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var c string
		var p int
		if err := rows.Scan(&c, &p); err != nil {
			return nil, err
		}
		out[c] = p
	}
	return out, rows.Err()
}

func briefOf(tx *sql.Tx, messageID int) (*model.BriefSignal, error) {
	var raw sql.NullString
	if err := tx.QueryRow(`SELECT brief FROM messages WHERE id = ?`, messageID).Scan(&raw); err != nil {
		return nil, err
	}
	if !raw.Valid || raw.String == "" || raw.String == "null" {
		return nil, nil
	}
	var b model.BriefSignal
	if json.Unmarshal([]byte(raw.String), &b) != nil {
		return nil, nil
	}
	b.Platforms = model.Strings(b.Platforms)
	return &b, nil
}

func jsonList(v []string) string {
	b, _ := json.Marshal(v)
	return string(b)
}
