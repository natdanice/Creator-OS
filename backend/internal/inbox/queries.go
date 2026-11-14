// Package inbox holds the brand-thread and comment-queue reads and the inbox actions.
package inbox

import (
	"database/sql"
	"encoding/json"
	"sort"

	"creatoros/internal/dates"
	"creatoros/internal/model"
	"creatoros/internal/store"
)

type ThreadSummary struct {
	BrandID   int           `json:"brandId"`
	BrandName string        `json:"brandName"`
	Channel   string        `json:"channel"`
	Last      model.Message `json:"last"`
	Unread    int           `json:"unread"`
	NewBriefs int           `json:"newBriefs"`
}

// ListThreads returns one thread per brand: new briefs first, then unread, then most recent.
func ListThreads(db *sql.DB, today string) ([]ThreadSummary, error) {
	rows, err := db.Query(`
		SELECT m.id, m.brand_id, m.direction, m.channel, m.body, m.sent_at, m.read_at, m.brief, m.brief_status,
		       m.deal_id, m.task_id, m.external_id, b.name
		FROM messages m JOIN brands b ON b.id = m.brand_id
		WHERE substr(m.sent_at, 1, 10) <= ? ORDER BY m.sent_at DESC, m.id DESC`, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byBrand := map[int]*ThreadSummary{}
	var order []*ThreadSummary
	for rows.Next() {
		var m model.Message
		var name string
		var brief sql.NullString
		if err := rows.Scan(&m.ID, &m.BrandID, &m.Direction, &m.Channel, &m.Body, &m.SentAt, &m.ReadAt, &brief, &m.BriefStatus, &m.DealID, &m.TaskID, &m.ExternalID, &name); err != nil {
			return nil, err
		}
		if brief.Valid && brief.String != "" && brief.String != "null" {
			var b model.BriefSignal
			if json.Unmarshal([]byte(brief.String), &b) == nil {
				b.Platforms = model.Strings(b.Platforms)
				m.Brief = &b
			}
		}
		t := byBrand[m.BrandID]
		if t == nil {
			t = &ThreadSummary{BrandID: m.BrandID, BrandName: name, Channel: m.Channel, Last: m}
			byBrand[m.BrandID] = t
			order = append(order, t)
		}
		if m.Direction == "in" && m.ReadAt == nil {
			t.Unread++
		}
		if m.BriefStatus == "new" {
			t.NewBriefs++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(order, func(i, j int) bool {
		a, b := order[i], order[j]
		if a.NewBriefs != b.NewBriefs {
			return a.NewBriefs > b.NewBriefs
		}
		if (a.Unread > 0) != (b.Unread > 0) {
			return a.Unread > 0
		}
		return a.Last.SentAt > b.Last.SentAt
	})
	out := make([]ThreadSummary, len(order))
	for i, t := range order {
		out[i] = *t
	}
	return out, nil
}

// NeedsReply are the comment categories that usually deserve a reply.
var NeedsReply = []string{"product_question", "general_question", "content_request"}

const CommentWindowDays = 14

type CategoryCount struct {
	Category string `json:"category"`
	N        int    `json:"n"`
}

// CommentCountsByCategory counts open, consented comments from the last 14 days.
func CommentCountsByCategory(db *sql.DB, today string) ([]CategoryCount, error) {
	since := dates.AddDays(today, -(CommentWindowDays - 1))
	rows, err := db.Query(`
		SELECT category, COUNT(*) FROM comments
		WHERE redacted = 0 AND reply_status = 'open'
		  AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
		GROUP BY category ORDER BY category`, since, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CategoryCount{}
	for rows.Next() {
		var c CategoryCount
		if err := rows.Scan(&c.Category, &c.N); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Counts is what the tab badges show: inbound messages not yet read, and briefs waiting for a decision.
type Counts struct {
	Unread int `json:"unread"`
	Briefs int `json:"briefs"`
}

func InboxCounts(db *sql.DB) (Counts, error) {
	var c Counts
	err := db.QueryRow(`SELECT
		COALESCE(SUM(CASE WHEN direction = 'in' AND read_at IS NULL THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN brief_status = 'new' THEN 1 ELSE 0 END), 0) FROM messages`).Scan(&c.Unread, &c.Briefs)
	return c, err
}

// RateItem is a rate-card line a brief is priced from.
type RateItem struct {
	Code  string `json:"code"`
	Name  string `json:"name"`
	Price int    `json:"price"`
}

func RateCard(db *sql.DB) ([]RateItem, error) {
	rows, err := db.Query(`SELECT code, name, price FROM rate_card ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RateItem{}
	for rows.Next() {
		var r RateItem
		if err := rows.Scan(&r.Code, &r.Name, &r.Price); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GuessDeliverables are the rate-card codes a brief most likely needs, from the platforms it mentions.
func GuessDeliverables(platforms []string) []string {
	if len(platforms) == 3 {
		return []string{"BUNDLE_3P"}
	}
	code := map[string]string{"tiktok": "TT_VIDEO", "instagram": "IG_REEL", "youtube": "YT_INTEGRATION"}
	out := []string{}
	for _, p := range platforms {
		out = append(out, code[p])
	}
	if len(out) == 0 {
		return []string{"TT_VIDEO"}
	}
	return out
}

// BriefQuote is the detected brief plus what it would cost from the rate card.
type BriefQuote struct {
	model.BriefSignal
	Deliverables []RateItem `json:"deliverables"`
	ListPrice    int        `json:"listPrice"`
}

// ThreadMessage is one message with the deal it created (when it was converted).
type ThreadMessage struct {
	model.Message
	Brief     *BriefQuote `json:"brief"`
	DealTitle *string     `json:"dealTitle"`
	DealStage *string     `json:"dealStage"`
}

// Thread is everything the conversation view needs for one brand.
type Thread struct {
	Contact  *model.Contact  `json:"contact"`
	Messages []ThreadMessage `json:"messages"`
}

// GetThread returns a brand's messages up to `today`, oldest first.
func GetThread(db *sql.DB, brandID int, today string) (Thread, error) {
	cards, err := RateCard(db)
	if err != nil {
		return Thread{}, err
	}
	price := map[string]RateItem{}
	for _, c := range cards {
		price[c.Code] = c
	}
	rows, err := db.Query(`
		SELECT m.id, m.brand_id, m.direction, m.channel, m.body, m.sent_at, m.read_at, m.brief, m.brief_status,
		       m.deal_id, m.task_id, m.external_id, d.title, d.stage
		FROM messages m LEFT JOIN deals d ON d.id = m.deal_id
		WHERE m.brand_id = ? AND substr(m.sent_at, 1, 10) <= ? ORDER BY m.sent_at, m.id`, brandID, today)
	if err != nil {
		return Thread{}, err
	}
	defer rows.Close()
	t := Thread{Messages: []ThreadMessage{}}
	for rows.Next() {
		var m ThreadMessage
		var brief sql.NullString
		if err := rows.Scan(&m.ID, &m.BrandID, &m.Direction, &m.Channel, &m.Body, &m.SentAt, &m.ReadAt, &brief, &m.BriefStatus, &m.DealID, &m.TaskID, &m.ExternalID, &m.DealTitle, &m.DealStage); err != nil {
			return Thread{}, err
		}
		if brief.Valid && brief.String != "" && brief.String != "null" {
			var b model.BriefSignal
			if json.Unmarshal([]byte(brief.String), &b) == nil {
				b.Platforms = model.Strings(b.Platforms)
				q := &BriefQuote{BriefSignal: b, Deliverables: []RateItem{}}
				for _, code := range GuessDeliverables(b.Platforms) {
					item, ok := price[code]
					if !ok {
						item = RateItem{Code: code, Name: code}
					}
					q.Deliverables = append(q.Deliverables, item)
					q.ListPrice += item.Price
				}
				m.Brief = q
			}
		}
		t.Messages = append(t.Messages, m)
	}
	if err := rows.Err(); err != nil {
		return Thread{}, err
	}
	var c model.Contact
	err = db.QueryRow(`SELECT id, brand_id, name, role, channel, handle, is_primary FROM brand_contacts WHERE brand_id = ? AND is_primary = 1 LIMIT 1`, brandID).
		Scan(&c.ID, &c.BrandID, &c.Name, &c.Role, &c.Channel, &c.Handle, &c.IsPrimary)
	if err == nil {
		t.Contact = &c
	} else if err != sql.ErrNoRows {
		return Thread{}, err
	}
	return t, nil
}

// Comment is one audience comment in the triage queue.
type Comment struct {
	ID              int     `json:"id"`
	Text            string  `json:"text"`
	Category        string  `json:"category"`
	PlatformID      string  `json:"platformId"`
	Author          string  `json:"author"`
	CreatedAt       string  `json:"createdAt"`
	ReplyText       *string `json:"replyText"`
	ContentTitle    string  `json:"contentTitle"`
	ProductCategory string  `json:"productCategory"`
	IsSponsored     bool    `json:"isSponsored"`
}

type CommentFilter struct {
	Category string // a comment category, or "" / "needs_reply"
	Platform string
	Status   string // open | replied | hidden
	Limit    int
}

// CommentQueue lists comments to triage (people who withdrew consent never appear): product questions
// first, newest first within each category.
func CommentQueue(db *sql.DB, today string, f CommentFilter) ([]Comment, int, error) {
	since := dates.AddDays(today, -(CommentWindowDays - 1))
	cats := NeedsReply
	if f.Category != "" && f.Category != "needs_reply" {
		cats = []string{f.Category}
	}
	status := f.Status
	if status == "" {
		status = "open"
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 40
	}
	where := `c.redacted = 0 AND c.category IN (` + store.Placeholders(len(cats)) + `) AND c.reply_status = ?
		AND substr(c.created_at, 1, 10) >= ? AND substr(c.created_at, 1, 10) <= ?`
	args := []any{}
	for _, c := range cats {
		args = append(args, c)
	}
	args = append(args, status, since, today)
	if f.Platform != "" {
		where += ` AND c.platform_id = ?`
		args = append(args, f.Platform)
	}
	var total int
	if err := db.QueryRow(`SELECT COUNT(*) FROM comments c WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := db.Query(`
		SELECT c.id, c.text, c.category, c.platform_id, c.author_pseudo_id, c.created_at, c.reply_text,
		       ct.title, ct.product_category, ct.is_sponsored
		FROM comments c JOIN contents ct ON ct.id = c.content_id
		WHERE `+where+`
		ORDER BY CASE c.category WHEN 'product_question' THEN 0 WHEN 'general_question' THEN 1 ELSE 2 END, c.created_at DESC, c.id DESC
		LIMIT ?`, append(args, limit)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.Text, &c.Category, &c.PlatformID, &c.Author, &c.CreatedAt, &c.ReplyText, &c.ContentTitle, &c.ProductCategory, &c.IsSponsored); err != nil {
			return nil, 0, err
		}
		out = append(out, c)
	}
	return out, total, rows.Err()
}
