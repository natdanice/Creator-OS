// Package today builds the Overview's "Needs you today" list, in priority order:
// new briefs, overdue invoices, drafted automation tasks, "run today's automations",
// unread brand messages, comments waiting for a reply (src/lib/queries/today.ts).
package today

import (
	"database/sql"
	"encoding/json"
	"sort"

	"creatoros/internal/crm"
	"creatoros/internal/inbox"
	"creatoros/internal/model"
)

var taskOrder = []string{"post_plus_7", "post_plus_30", "brand_silent_120", "pq_spike"}

func rank(rule string) int {
	for i, r := range taskOrder {
		if r == rule {
			return i
		}
	}
	return -1
}

// Actions are returned as raw values; the page renders them in the UI language.
// Each item has a "kind": brief | overdue | task | run | unread | comments.
func Actions(db *sql.DB, today string) ([]any, error) {
	out := []any{}
	threads, err := inbox.ListThreads(db, today)
	if err != nil {
		return nil, err
	}
	for _, t := range threads {
		if t.NewBriefs > 0 {
			out = append(out, map[string]any{"kind": "brief", "brandId": t.BrandID, "brandName": t.BrandName, "brief": t.Last.Brief})
		}
	}

	open, err := OpenTasks(db)
	if err != nil {
		return nil, err
	}
	invoices, err := crm.ListInvoices(db, today)
	if err != nil {
		return nil, err
	}
	for _, inv := range invoices {
		if inv.Status != "overdue" {
			continue
		}
		var taskID *int
		for _, tk := range open {
			if tk.RuleID == "invoice_overdue_30" && tk.DealID != nil && *tk.DealID == inv.DealID {
				id := tk.ID
				taskID = &id
				break
			}
		}
		out = append(out, map[string]any{"kind": "overdue", "invoice": inv, "taskId": taskID})
	}
	var ranked []model.Task
	for _, tk := range open {
		if rank(tk.RuleID) >= 0 {
			ranked = append(ranked, tk)
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if a, b := rank(ranked[i].RuleID), rank(ranked[j].RuleID); a != b {
			return a < b
		}
		return ranked[i].ID < ranked[j].ID
	})
	for _, tk := range ranked {
		out = append(out, map[string]any{"kind": "task", "task": tk})
	}

	var ran int
	if err := db.QueryRow(`SELECT COUNT(*) FROM automation_runs WHERE for_date = ?`, today).Scan(&ran); err != nil {
		return nil, err
	}
	if ran == 0 {
		out = append(out, map[string]any{"kind": "run"})
	}

	unread, names := 0, []string{}
	for _, t := range threads {
		if t.Unread > 0 && t.NewBriefs == 0 {
			unread += t.Unread
			names = append(names, t.BrandName)
		}
	}
	if unread > 0 {
		out = append(out, map[string]any{"kind": "unread", "n": unread, "brands": names})
	}

	counts, err := inbox.CommentCountsByCategory(db, today)
	if err != nil {
		return nil, err
	}
	waiting, pq := 0, 0
	for _, c := range counts {
		for _, cat := range inbox.NeedsReply {
			if c.Category == cat {
				waiting += c.N
			}
		}
		if c.Category == "product_question" {
			pq = c.N
		}
	}
	if waiting > 0 {
		out = append(out, map[string]any{"kind": "comments", "n": waiting, "productQuestions": pq})
	}
	return out, nil
}

// OpenTasks are the drafted automation tasks still waiting for the creator.
func OpenTasks(db *sql.DB) ([]model.Task, error) {
	rows, err := db.Query(`
		SELECT id, rule_id, dedupe_key, title, reason, draft_message, channel, brand_id, deal_id, link, vars, status, for_date, created_at, completed_at
		FROM tasks WHERE status = 'open' ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Task{}
	for rows.Next() {
		var t model.Task
		var vars sql.NullString
		if err := rows.Scan(&t.ID, &t.RuleID, &t.DedupeKey, &t.Title, &t.Reason, &t.DraftMessage, &t.Channel, &t.BrandID, &t.DealID, &t.Link, &vars, &t.Status, &t.ForDate, &t.CreatedAt, &t.CompletedAt); err != nil {
			return nil, err
		}
		if vars.Valid && vars.String != "" {
			_ = json.Unmarshal([]byte(vars.String), &t.Vars)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
