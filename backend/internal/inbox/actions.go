package inbox

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"creatoros/internal/crm"
	"creatoros/internal/model"
	"creatoros/internal/store"
)

const newDealTitle = "สร้างดีลใหม่" // default deal title; data text is Thai (src/lib/i18n/th.ts quote.newDeal)

// Longest accepted reply text (in characters).
const (
	MaxBrandReplyChars   = 5000
	MaxCommentReplyChars = 2000
)

// BrandExists reports whether a brand with this id exists.
func BrandExists(db *sql.DB, brandID int) (bool, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM brands WHERE id = ?`, brandID).Scan(&n)
	return n > 0, err
}

// MarkThreadRead marks every unread inbound message of a brand as read.
func MarkThreadRead(s *store.Store, brandID int) (int64, error) {
	if ok, err := BrandExists(s.DB, brandID); err != nil {
		return 0, err
	} else if !ok {
		return 0, crm.NotFound("brand", brandID)
	}
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

// SendBrandReply records a reply to a brand in its thread and on the brand timeline and returns the new message's id.
// (Nothing is sent from here: Gmail drafts and LINE messages are made by the web app.)
func SendBrandReply(s *store.Store, brandID int, body string) (messageID int, err error) {
	text := strings.TrimSpace(body)
	if text == "" {
		return 0, crm.ErrInvalid("the reply is empty")
	}
	if n := utf8.RuneCountInString(text); n > MaxBrandReplyChars {
		return 0, crm.ErrInvalid(fmt.Sprintf("the reply is too long (%d characters; the limit is %d)", n, MaxBrandReplyChars))
	}
	if ok, err := BrandExists(s.DB, brandID); err != nil {
		return 0, err
	} else if !ok {
		return 0, crm.NotFound("brand", brandID)
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	channel := "line"
	err = tx.QueryRow(`SELECT channel FROM brand_contacts WHERE brand_id = ? AND is_primary = 1 LIMIT 1`, brandID).Scan(&channel)
	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}
	at, err := nextThreadTime(s, tx, brandID, s.Today())
	if err != nil {
		return 0, err
	}
	res, err := tx.Exec(`INSERT INTO messages (brand_id, direction, channel, body, sent_at, read_at, brief_status) VALUES (?, 'out', ?, ?, ?, ?, 'none')`,
		brandID, channel, text, at, at)
	if err != nil {
		return 0, err
	}
	id64, _ := res.LastInsertId()
	summary := text
	if r := []rune(text); len(r) > 80 {
		summary = string(r[:80]) + "…"
	}
	if _, err := tx.Exec(`INSERT INTO activities (brand_id, type, channel, summary, occurred_at) VALUES (?, 'chat', ?, ?, ?)`, brandID, channel, summary, at); err != nil {
		return 0, err
	}
	return int(id64), tx.Commit()
}

// ConvertResult says what converting a brief did.
type ConvertResult struct {
	Converted bool   `json:"converted"`
	DealID    *int   `json:"dealId,omitempty"` // the new deal (or, when Converted is false because it already was, the existing one)
	Reason    string `json:"reason,omitempty"` // why nothing changed
}

// briefState explains why a message can't be acted on as a new brief.
func briefState(status string, dealID *int, messageID int) string {
	switch status {
	case "converted":
		if dealID != nil {
			return fmt.Sprintf("This brief was already turned into deal %d.", *dealID)
		}
		return "This brief was already turned into a deal."
	case "ignored":
		return "This brief was ignored earlier."
	default:
		return fmt.Sprintf("Message %d is not a detected brand brief.", messageID)
	}
}

// ConvertBrief turns a detected brief into a deal at the Brief stage. A message that is not a new brief
// (already converted, ignored, or not a brief at all) changes nothing and says why.
func ConvertBrief(s *store.Store, messageID int, title string, value float64) (ConvertResult, error) {
	if n := utf8.RuneCountInString(title); n > crm.MaxBrandName {
		return ConvertResult{}, crm.ErrInvalid(fmt.Sprintf("title is too long (%d characters; the limit is %d)", n, crm.MaxBrandName))
	}
	today := s.Today()
	tx, err := s.DB.Begin()
	if err != nil {
		return ConvertResult{}, err
	}
	defer tx.Rollback()
	var brandID int
	var channel, status string
	var readAt sql.NullString
	var existingDeal *int
	err = tx.QueryRow(`SELECT brand_id, channel, brief_status, read_at, deal_id FROM messages WHERE id = ?`, messageID).Scan(&brandID, &channel, &status, &readAt, &existingDeal)
	if err == sql.ErrNoRows {
		return ConvertResult{}, crm.NotFound("message", messageID)
	}
	if err != nil {
		return ConvertResult{}, err
	}
	if status != "new" {
		return ConvertResult{DealID: existingDeal, Reason: briefState(status, existingDeal, messageID)}, nil
	}
	// Re-read through the shared parser so the brief is decoded the same way as everywhere else.
	th, err := briefOf(tx, messageID)
	if err != nil {
		return ConvertResult{}, err
	}
	cards, err := rateCardTx(tx)
	if err != nil {
		return ConvertResult{}, err
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
		return ConvertResult{}, err
	}
	dealID, _ := res.LastInsertId()
	read := at
	if readAt.Valid {
		read = readAt.String
	}
	if _, err := tx.Exec(`UPDATE messages SET brief_status = 'converted', deal_id = ?, read_at = ? WHERE id = ?`, dealID, read, messageID); err != nil {
		return ConvertResult{}, err
	}
	if _, err := tx.Exec(`INSERT INTO activities (brand_id, deal_id, type, channel, summary, occurred_at) VALUES (?, ?, 'brief_received', ?, ?, ?)`,
		brandID, dealID, channel, fmt.Sprintf("ได้รับบรีฟ: %s", dealTitle), at); err != nil {
		return ConvertResult{}, err
	}
	id := int(dealID)
	return ConvertResult{Converted: true, DealID: &id}, tx.Commit()
}

// IgnoreResult says what dismissing a brief did.
type IgnoreResult struct {
	OK      bool   `json:"ok"`
	Ignored bool   `json:"ignored"`
	Reason  string `json:"reason,omitempty"` // why nothing changed
}

// IgnoreBrief dismisses a brief that is still waiting. A message that is not a new brief (already converted,
// already ignored, or not a brief at all) changes nothing and says why.
func IgnoreBrief(s *store.Store, messageID int) (IgnoreResult, error) {
	var status string
	var dealID *int
	err := s.DB.QueryRow(`SELECT brief_status, deal_id FROM messages WHERE id = ?`, messageID).Scan(&status, &dealID)
	if err == sql.ErrNoRows {
		return IgnoreResult{}, crm.NotFound("message", messageID)
	}
	if err != nil {
		return IgnoreResult{}, err
	}
	if status != "new" {
		reason := briefState(status, dealID, messageID)
		if status == "ignored" {
			reason = "This brief was already ignored."
		}
		return IgnoreResult{OK: true, Reason: reason}, nil
	}
	if _, err := s.DB.Exec(`UPDATE messages SET brief_status = 'ignored' WHERE id = ? AND brief_status = 'new'`, messageID); err != nil {
		return IgnoreResult{}, err
	}
	return IgnoreResult{OK: true, Ignored: true}, nil
}

// CommentReplyResult says what recording a reply did.
type CommentReplyResult struct {
	OK             bool   `json:"ok"`
	CommentID      int    `json:"commentId"`
	PreviousStatus string `json:"previousStatus"` // open, replied or hidden
	ReplyStatus    string `json:"replyStatus"`
}

// ReplyComment records the reply the creator wrote (it is posted on the platform by hand). Replying overwrites an
// earlier reply, and replying to a hidden comment brings it back as replied: writing a reply is the creator
// choosing to deal with that comment.
func ReplyComment(s *store.Store, commentID int, text string) (CommentReplyResult, error) {
	var previous string
	err := s.DB.QueryRow(`SELECT reply_status FROM comments WHERE id = ?`, commentID).Scan(&previous)
	if err == sql.ErrNoRows {
		return CommentReplyResult{}, crm.NotFound("comment", commentID)
	}
	if err != nil {
		return CommentReplyResult{}, err
	}
	var reply any
	if t := strings.TrimSpace(text); t != "" {
		if n := utf8.RuneCountInString(t); n > MaxCommentReplyChars {
			return CommentReplyResult{}, crm.ErrInvalid(fmt.Sprintf("the reply is too long (%d characters; the limit is %d)", n, MaxCommentReplyChars))
		}
		reply = t
	}
	if _, err := s.DB.Exec(`UPDATE comments SET reply_status = 'replied', reply_text = ?, replied_at = ? WHERE id = ?`, reply, s.Stamp(s.Today(), "10:00:00"), commentID); err != nil {
		return CommentReplyResult{}, err
	}
	return CommentReplyResult{OK: true, CommentID: commentID, PreviousStatus: previous, ReplyStatus: "replied"}, nil
}

// HideResult says what hiding a comment did.
type HideResult struct {
	OK             bool   `json:"ok"`
	CommentID      int    `json:"commentId"`
	PreviousStatus string `json:"previousStatus"`
}

func HideComment(s *store.Store, commentID int) (HideResult, error) {
	var previous string
	err := s.DB.QueryRow(`SELECT reply_status FROM comments WHERE id = ?`, commentID).Scan(&previous)
	if err == sql.ErrNoRows {
		return HideResult{}, crm.NotFound("comment", commentID)
	}
	if err != nil {
		return HideResult{}, err
	}
	if _, err := s.DB.Exec(`UPDATE comments SET reply_status = 'hidden' WHERE id = ?`, commentID); err != nil {
		return HideResult{}, err
	}
	return HideResult{OK: true, CommentID: commentID, PreviousStatus: previous}, nil
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
