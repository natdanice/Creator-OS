// Package automation holds the automation page's data and the actions a creator takes on drafted
// tasks. The rules that CREATE tasks (post reports, silent brands, overdue invoices, question
// spikes) still run in the web app, which owns the Thai message templates; everything after a task
// exists is handled here.
package automation

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"creatoros/internal/crm"
	"creatoros/internal/model"
	"creatoros/internal/store"
)

type Rule struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Trigger   string  `json:"trigger"`
	Channel   string  `json:"channel"`
	Schedule  string  `json:"schedule"`
	Enabled   bool    `json:"enabled"`
	LastRunAt *string `json:"lastRunAt"`
}

func Rules(db *sql.DB) ([]Rule, error) {
	rows, err := db.Query(`SELECT id, name, trigger, channel, schedule, enabled, last_run_at FROM automation_rules ORDER BY rowid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Rule{}
	for rows.Next() {
		var r Rule
		if err := rows.Scan(&r.ID, &r.Name, &r.Trigger, &r.Channel, &r.Schedule, &r.Enabled, &r.LastRunAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

const taskCols = `id, rule_id, dedupe_key, title, reason, draft_message, channel, brand_id, deal_id, link, vars, status, for_date, created_at, completed_at`

func scanTasks(rows *sql.Rows) ([]model.Task, error) {
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

// OpenTasks are waiting for the creator: newest run first.
func OpenTasks(db *sql.DB) ([]model.Task, error) {
	rows, err := db.Query(`SELECT ` + taskCols + ` FROM tasks WHERE status = 'open' ORDER BY for_date DESC, id`)
	if err != nil {
		return nil, err
	}
	return scanTasks(rows)
}

// ClosedTasks are the done and dismissed ones, most recently completed first.
func ClosedTasks(db *sql.DB) ([]model.Task, error) {
	rows, err := db.Query(`SELECT ` + taskCols + ` FROM tasks WHERE status <> 'open' ORDER BY completed_at DESC, id`)
	if err != nil {
		return nil, err
	}
	return scanTasks(rows)
}

type Run struct {
	ID      int             `json:"id"`
	ForDate string          `json:"forDate"`
	RanAt   string          `json:"ranAt"`
	Created int             `json:"created"`
	Skipped int             `json:"skipped"`
	Detail  json.RawMessage `json:"detail"`
}

// RecentRuns are the last runs of the daily job, newest first.
func RecentRuns(db *sql.DB, limit int) ([]Run, error) {
	rows, err := db.Query(`SELECT id, for_date, ran_at, created, skipped, detail FROM automation_runs ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Run{}
	for rows.Next() {
		var r Run
		var detail string
		if err := rows.Scan(&r.ID, &r.ForDate, &r.RanAt, &r.Created, &r.Skipped, &detail); err != nil {
			return nil, err
		}
		if json.Valid([]byte(detail)) {
			r.Detail = json.RawMessage(detail)
		} else {
			r.Detail = json.RawMessage("{}")
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func SetRuleEnabled(db *sql.DB, id string, enabled bool) error {
	res, err := db.Exec(`UPDATE automation_rules SET enabled = ? WHERE id = ?`, enabled, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return crm.NotFoundMsg(fmt.Sprintf("No automation rule with id %q", id))
	}
	return nil
}

// DismissResult says what dismissing a task did.
type DismissResult struct {
	OK        bool   `json:"ok"`
	Dismissed bool   `json:"dismissed"`
	Reason    string `json:"reason,omitempty"` // why nothing changed
}

// Dismiss closes an open task without doing it. A task that is already done or dismissed changes nothing and says so.
func Dismiss(db *sql.DB, taskID int) (DismissResult, error) {
	var status string
	err := db.QueryRow(`SELECT status FROM tasks WHERE id = ?`, taskID).Scan(&status)
	if err == sql.ErrNoRows {
		return DismissResult{}, crm.NotFound("task", taskID)
	}
	if err != nil {
		return DismissResult{}, err
	}
	if status != "open" {
		return DismissResult{OK: true, Reason: fmt.Sprintf("Task %d is already %s.", taskID, status)}, nil
	}
	if _, err := db.Exec(`UPDATE tasks SET status = 'dismissed' WHERE id = ? AND status = 'open'`, taskID); err != nil {
		return DismissResult{}, err
	}
	return DismissResult{OK: true, Dismissed: true}, nil
}

// Reset removes every task and the run history (the demo's "start over").
func Reset(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM tasks`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM automation_runs`); err != nil {
		return err
	}
	return tx.Commit()
}

// What logging a finished task adds to the brand timeline, by rule. "" = nothing.
var doneActivity = map[string]string{
	"post_plus_7": "report_sent", "post_plus_30": "report_sent", "brand_silent_120": "chat",
	"invoice_overdue_30": "note", "pq_spike": "",
}

// Completed describes a task that was just approved, so the caller can make follow-ups (a Gmail draft).
type Completed struct {
	Done      bool   `json:"done"`
	Title     string `json:"title"`
	Channel   string `json:"channel"`
	BrandID   *int   `json:"brandId"`
	Body      string `json:"body"`
	MessageID *int   `json:"messageId"`        // the message recorded in the brand's thread, if the task had a brand and a channel
	Reason    string `json:"reason,omitempty"` // why nothing changed (Done is false)
}

// Complete is the human approving a drafted task (after editing it): the task is done, the message
// is logged on the brand timeline and in its Inbox thread, and a +7 report moves a Posted deal on.
// A task that is not open does nothing (Done = false).
func Complete(s *store.Store, taskID int, finalMessage string) (Completed, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return Completed{}, err
	}
	defer tx.Rollback()
	var ruleID, title, channel, forDate, status string
	var brandID, dealID *int
	err = tx.QueryRow(`SELECT rule_id, title, channel, for_date, status, brand_id, deal_id FROM tasks WHERE id = ?`, taskID).
		Scan(&ruleID, &title, &channel, &forDate, &status, &brandID, &dealID)
	if err == sql.ErrNoRows {
		return Completed{}, crm.NotFound("task", taskID)
	}
	if err != nil {
		return Completed{}, err
	}
	if status != "open" {
		return Completed{Title: title, Channel: channel, BrandID: brandID, Reason: fmt.Sprintf("Task %d is already %s, so nothing was changed.", taskID, status)}, nil
	}
	at := s.Stamp(forDate, "10:30:00")
	if _, err := tx.Exec(`UPDATE tasks SET status = 'done', draft_message = ?, completed_at = ? WHERE id = ?`, finalMessage, at, taskID); err != nil {
		return Completed{}, err
	}
	if typ := doneActivity[ruleID]; typ != "" && brandID != nil {
		ch := "email"
		switch channel {
		case "internal":
			ch = "system"
		case "line":
			ch = "line"
		}
		if _, err := tx.Exec(`INSERT INTO activities (brand_id, deal_id, type, channel, summary, occurred_at) VALUES (?, ?, ?, ?, ?, ?)`, *brandID, dealID, typ, ch, title, at); err != nil {
			return Completed{}, err
		}
	}
	var messageID *int
	if brandID != nil && channel != "internal" {
		res, err := tx.Exec(`INSERT INTO messages (brand_id, direction, channel, body, sent_at, read_at, task_id, deal_id, brief_status) VALUES (?, 'out', ?, ?, ?, ?, ?, ?, 'none')`,
			*brandID, channel, finalMessage, at, at, taskID, dealID)
		if err != nil {
			return Completed{}, err
		}
		id64, _ := res.LastInsertId()
		id := int(id64)
		messageID = &id
	}
	if ruleID == "post_plus_7" && dealID != nil {
		if _, err := tx.Exec(`UPDATE deals SET stage = 'report_sent' WHERE id = ? AND stage = 'posted'`, *dealID); err != nil {
			return Completed{}, err
		}
	}
	return Completed{Done: true, Title: title, Channel: channel, BrandID: brandID, Body: finalMessage, MessageID: messageID}, tx.Commit()
}
