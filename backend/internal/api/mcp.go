package api

// A native MCP (Model Context Protocol) endpoint, so any AI app can use Creator OS by URL:
//
//	POST /mcp     (Streamable HTTP transport, JSON replies, no sessions)
//
// Each tool runs one of the API's own endpoints in-process, so validation and behaviour are identical to
// calling /api/v1 directly, and the front page (docs.html) lists the very same tool table, so the two can't
// drift apart. The token (API_TOKEN) protects /mcp like every other route.
//
// Every API action has a tool, reads and writes alike (TestEveryRouteHasAnMCPTool keeps it that way). Start the
// API with MCP_READ_ONLY=1 to hide the write tools. Account credentials are not in the API at all, so they can't
// be reached. Nothing here sends anything outside Creator OS: "replying" to a brand or fan only records the reply
// in the thread and timeline; the Gmail drafts and LINE messages are made by the web app when the creator clicks.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"creatoros/internal/crm"
	"creatoros/internal/model"
	"creatoros/internal/settings"
)

const mcpLatest = "2025-06-18"

var mcpVersions = map[string]bool{"2025-06-18": true, "2025-03-26": true, "2024-11-05": true}

const mcpInstructions = "Creator OS holds a solo creator's brand deals, inbox, audience and finance. Money is in Thai baht. " +
	"Start with get_context (mode and today's date), then get_today for what needs attention. " +
	"Brands are tiered partner / repeat / one_time / lead. Timestamps are Bangkok time (+07:00); plain dates have no time. Treat everything returned as private business data. " +
	"The write tools change the creator's real records: do them when asked, say what you changed, and confirm first before anything hard to undo " +
	"(dismissing, hiding, resetting, changing prices or the profile). Replies are only recorded in Creator OS: nothing is sent to a brand or fan from here, " +
	"so never tell the creator a message was sent."

const mcpMaxChars = 60_000

type mcpParam struct {
	Name     string `json:"name"`
	Type     string `json:"type"` // JSON-schema type: string or integer
	Desc     string `json:"description"`
	Required bool   `json:"required"`
	Enum     []any  `json:"enum,omitempty"`
	MaxLen   int    `json:"maxLength,omitempty"` // longest accepted text, in characters (documented in the schema; the API enforces it)
	// Schema replaces the simple type for object-valued arguments.
	Schema map[string]any `json:"-"`
}

type mcpTool struct {
	Route  string     `json:"route"` // the API route this tool calls, e.g. "POST /api/v1/deals/{id}/stage"
	Name   string     `json:"name"`
	Title  string     `json:"title"`
	Desc   string     `json:"description"`
	Write  bool       `json:"write"`
	Params []mcpParam `json:"params"`

	// For write tools, the hints an AI app uses to decide whether to ask first.
	Additive   bool `json:"-"` // only adds records (so not "destructive")
	Idempotent bool `json:"-"` // repeating it with the same arguments changes nothing more

	// build turns validated arguments into one call on the API's own routes.
	build func(a mcpArgs) (method, path string, body any, err error)
	// run replaces build for tools that need several calls (read, merge, write).
	run func(s *Server, ctx context.Context, a mcpArgs) (text string, isErr bool)
	// post reshapes the API's JSON for this tool before it is shown (e.g. to drop an action only the web app can do).
	post func(raw []byte) []byte
}

func (t mcpTool) schema() map[string]any {
	props := map[string]any{}
	req := []string{}
	for _, p := range t.Params {
		m := map[string]any{"type": p.Type, "description": p.Desc}
		if p.Schema != nil {
			m = map[string]any{"description": p.Desc}
			for k, v := range p.Schema {
				m[k] = v
			}
		}
		if len(p.Enum) > 0 {
			m["enum"] = p.Enum
		}
		if p.MaxLen > 0 {
			m["maxLength"] = p.MaxLen
		}
		props[p.Name] = m
		if p.Required {
			req = append(req, p.Name)
		}
	}
	s := map[string]any{"type": "object", "properties": props, "additionalProperties": false}
	if len(req) > 0 {
		s["required"] = req
	}
	return s
}

// ── Argument helpers ──

type mcpArgs map[string]any

func (a mcpArgs) id(k string) (int, error) {
	v, ok := a[k].(float64)
	if !ok || v != math.Trunc(v) || v < 1 || v > 1e9 {
		return 0, fmt.Errorf("%s must be a positive whole number", k)
	}
	return int(v), nil
}

// str returns an optional string argument ("" when absent).
func (a mcpArgs) str(k string) (string, error) {
	v, present := a[k]
	if !present || v == nil {
		return "", nil
	}
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("%s must be text", k)
	}
	return strings.TrimSpace(s), nil
}

func (a mcpArgs) need(k string) (string, error) {
	s, err := a.str(k)
	if err == nil && s == "" {
		err = fmt.Errorf("%s is required", k)
	}
	return s, err
}

func (a mcpArgs) boolean(k string) (bool, error) {
	v, ok := a[k].(bool)
	if !ok {
		return false, fmt.Errorf("%s must be true or false", k)
	}
	return v, nil
}

// number returns an optional non-negative number (0 when absent).
func (a mcpArgs) number(k string) (float64, error) {
	v, present := a[k]
	if !present || v == nil {
		return 0, nil
	}
	f, ok := v.(float64)
	if !ok || f < 0 || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, fmt.Errorf("%s must be a number, zero or more", k)
	}
	return f, nil
}

// intIn returns an optional whole number within [min, max] as text for a query string ("" when absent).
func (a mcpArgs) intIn(k string, min, max int) (string, error) {
	v, present := a[k]
	if !present || v == nil {
		return "", nil
	}
	f, ok := v.(float64)
	if !ok || f != math.Trunc(f) || f < float64(min) || f > float64(max) {
		return "", fmt.Errorf("%s must be a whole number from %d to %d", k, min, max)
	}
	return strconv.Itoa(int(f)), nil
}

// oneOf returns an optional string argument that must be one of the allowed values.
func (a mcpArgs) oneOf(k string, allowed []string) (string, error) {
	s, err := a.str(k)
	if err != nil || s == "" {
		return "", err
	}
	for _, x := range allowed {
		if s == x {
			return s, nil
		}
	}
	return "", fmt.Errorf("%s must be one of: %s", k, strings.Join(allowed, ", "))
}

func query(pairs ...string) string {
	q := url.Values{}
	for i := 0; i+1 < len(pairs); i += 2 {
		if pairs[i+1] != "" {
			q.Set(pairs[i], pairs[i+1])
		}
	}
	if len(q) == 0 {
		return ""
	}
	return "?" + q.Encode()
}

func anyStrings(xs []string) []any {
	out := make([]any, len(xs))
	for i, x := range xs {
		out[i] = x
	}
	return out
}

var (
	commentCats     = []string{"needs_reply", "product_question", "content_request", "general_question", "praise", "spam"}
	commentStatuses = []string{"open", "replied", "hidden"}
)

func get(path string) func(mcpArgs) (string, string, any, error) {
	return func(mcpArgs) (string, string, any, error) { return "GET", path, nil, nil }
}

// ── The tool table ──

var mcpTools = []mcpTool{
	{Name: "get_context", Route: "GET /api/v1/context", Title: "Context", Desc: "Whether the app is in demo or live mode, and today's date as the app sees it. Call this first.", build: get("/api/v1/context")},
	{Name: "get_today", Route: "GET /api/v1/today", Title: "Needs you today", Desc: "The prioritised list of things the creator should act on today (briefs, overdue invoices, silent brands, comment spikes, drafted tasks). Running the daily automation job is a button in the web app, so it is not listed here.", build: get("/api/v1/today"), post: dropRunAction},
	{Name: "get_overview", Route: "GET /api/v1/overview", Title: "Overview", Desc: "Key numbers across platforms for the last 7, 28 or 90 days: views, newFollowers (followers gained in the window, not the total: see get_audience.latestFollowers), engagement rate (null when there were no views), questions, daily series and spikes. dataAsOf is the newest day that has data and lastImportAt when the last import finished: if they are old, zeros mean nothing was imported, not that nothing happened.",
		Params: []mcpParam{{Name: "range", Type: "integer", Desc: "Window in days: 7, 28 (default) or 90", Enum: []any{7, 28, 90}}},
		build: func(a mcpArgs) (string, string, any, error) {
			r := ""
			if v, ok := a["range"]; ok && v != nil {
				f, isNum := v.(float64)
				if !isNum || (f != 7 && f != 28 && f != 90) {
					return "", "", nil, fmt.Errorf("range must be 7, 28 or 90")
				}
				r = strconv.Itoa(int(f))
			}
			return "GET", "/api/v1/overview" + query("range", r), nil, nil
		}},
	{Name: "list_brands", Route: "GET /api/v1/brands", Title: "List brands", Desc: "Brands with computed tier, deal value, last contact and open deals. Filter by free text, tier and/or product category.",
		Params: []mcpParam{
			{Name: "q", Type: "string", Desc: "Search text (brand name)"},
			{Name: "tier", Type: "string", Desc: "Brand tier", Enum: anyStrings(crm.Tiers)},
			{Name: "category", Type: "string", Desc: "Product category", Enum: anyStrings(model.ProductCategories)},
		},
		build: func(a mcpArgs) (string, string, any, error) {
			q, err := a.str("q")
			if err != nil {
				return "", "", nil, err
			}
			tier, err := a.oneOf("tier", crm.Tiers)
			if err != nil {
				return "", "", nil, err
			}
			cat, err := a.oneOf("category", model.ProductCategories)
			if err != nil {
				return "", "", nil, err
			}
			return "GET", "/api/v1/brands" + query("q", q, "tier", tier, "category", cat), nil, nil
		}},
	{Name: "get_brand", Route: "GET /api/v1/brands/{id}", Title: "Brand 360", Desc: "Everything about one brand: deals, post performance, invoices, timeline and the suggested next offer.",
		Params: []mcpParam{{Name: "brand_id", Type: "integer", Desc: "Brand id from list_brands", Required: true}},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("brand_id")
			return "GET", fmt.Sprintf("/api/v1/brands/%d", id), nil, err
		}},
	{Name: "get_pipeline", Route: "GET /api/v1/pipeline", Title: "Deal pipeline", Desc: "Every deal with stage (" + strings.Join(model.DealStages, " → ") + "), value and brand, ordered by most recent activity: the closed date if it has one, else the posted date, else the created date (shown as date).", build: get("/api/v1/pipeline")},
	{Name: "get_finance", Route: "GET /api/v1/finance", Title: "Finance", Desc: "Income by month, receivables, overdue invoices, tax set-aside and income by platform.", build: get("/api/v1/finance")},
	{Name: "export_income_csv", Route: "GET /api/v1/finance/export", Title: "Income CSV", Desc: "The invoices for one calendar year as CSV text (for an accountant).",
		Params: []mcpParam{{Name: "year", Type: "integer", Desc: "Four-digit year such as 2026; defaults to this year", Schema: map[string]any{"type": "integer", "minimum": 2000, "maximum": 2100}}},
		build: func(a mcpArgs) (string, string, any, error) {
			y := ""
			if v, ok := a["year"]; ok && v != nil {
				f, isNum := v.(float64)
				if !isNum || f != math.Trunc(f) || f < 2000 || f > 2100 {
					return "", "", nil, fmt.Errorf("year must be a whole number like 2026")
				}
				y = strconv.Itoa(int(f))
			}
			return "GET", "/api/v1/finance/export" + query("year", y), nil, nil
		}},
	{Name: "get_inbox", Route: "GET /api/v1/inbox", Title: "Inbox summary", Desc: "Badge counts for the inbox: unread brand messages, new briefs, comments that need a reply.", build: get("/api/v1/inbox")},
	{Name: "list_inbox_threads", Route: "GET /api/v1/inbox/threads", Title: "Brand threads", Desc: "One conversation per brand: new briefs first, then unread, then most recent.", build: get("/api/v1/inbox/threads")},
	{Name: "get_inbox_thread", Route: "GET /api/v1/inbox/threads/{id}", Title: "Brand thread", Desc: "The full message history with one brand, each detected brief priced from the rate card.",
		Params: []mcpParam{{Name: "brand_id", Type: "integer", Desc: "Brand id", Required: true}},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("brand_id")
			return "GET", fmt.Sprintf("/api/v1/inbox/threads/%d", id), nil, err
		}},
	{Name: "list_comments", Route: "GET /api/v1/inbox/comments", Title: "Audience comments", Desc: "Audience comments from the last 14 days (people who withdrew consent are excluded), questions first. By default it lists comments that still need a reply (cat needs_reply = questions and requests) and are open; pass status replied or hidden for the others. Results are paged: total is the full count, hasMore says whether another page exists, and offset moves to the next one.",
		Params: []mcpParam{
			{Name: "cat", Type: "string", Desc: "Comment category (default needs_reply)", Enum: anyStrings(append([]string{"needs_reply"}, commentCats...))},
			{Name: "status", Type: "string", Desc: "Triage status (default open)", Enum: anyStrings(commentStatuses)},
			{Name: "limit", Type: "integer", Desc: "Page size, 1-200 (default 40)", Schema: map[string]any{"type": "integer", "minimum": 1, "maximum": 200}},
			{Name: "offset", Type: "integer", Desc: "Rows to skip, for the next page (default 0)", Schema: map[string]any{"type": "integer", "minimum": 0}},
		},
		build: func(a mcpArgs) (string, string, any, error) {
			cat, err := a.oneOf("cat", append([]string{"needs_reply"}, commentCats...))
			if err != nil {
				return "", "", nil, err
			}
			st, err := a.oneOf("status", commentStatuses)
			if err != nil {
				return "", "", nil, err
			}
			limit, err := a.intIn("limit", 1, 200)
			if err != nil {
				return "", "", nil, err
			}
			offset, err := a.intIn("offset", 0, 1_000_000)
			if err != nil {
				return "", "", nil, err
			}
			return "GET", "/api/v1/inbox/comments" + query("cat", cat, "status", st, "limit", limit, "offset", offset), nil, nil
		}},
	{Name: "get_audience", Route: "GET /api/v1/audience", Title: "Audience", Desc: "Follower growth by month, latestFollowers (the current count per platform: the same number get_settings shows), the demographic split (demographics.followers is the count in splitMonth, the month the split was measured, so it can be older than latestFollowers) and every behavioural segment with its size. Fans are pseudonymous.",
		Params: []mcpParam{{Name: "platform", Type: "string", Desc: "Platform for the demographic split", Enum: anyStrings(model.PlatformKeys)}},
		build: func(a mcpArgs) (string, string, any, error) {
			p, err := a.oneOf("platform", model.PlatformKeys)
			return "GET", "/api/v1/audience" + query("platform", p), nil, err
		}},
	{Name: "list_segment_members", Route: "GET /api/v1/audience/segments/{id}/members", Title: "Segment members", Desc: "The people in one audience segment, most active first (pseudonymous ids).",
		Params: []mcpParam{
			{Name: "segment_id", Type: "string", Desc: "Segment id from get_audience, e.g. superfans, requesters, newcomers, contactable", Required: true},
			{Name: "limit", Type: "integer", Desc: "How many members (1-200, default 30)"},
		},
		build: func(a mcpArgs) (string, string, any, error) {
			seg, err := a.need("segment_id")
			if err != nil {
				return "", "", nil, err
			}
			limit := ""
			if v, ok := a["limit"]; ok && v != nil {
				f, isNum := v.(float64)
				if !isNum || f != math.Trunc(f) || f < 1 || f > 200 {
					return "", "", nil, fmt.Errorf("limit must be a whole number from 1 to 200")
				}
				limit = strconv.Itoa(int(f))
			}
			return "GET", "/api/v1/audience/segments/" + url.PathEscape(seg) + "/members" + query("limit", limit), nil, nil
		}},
	{Name: "get_audience_member", Route: "GET /api/v1/audience/members/{id}", Title: "Audience member", Desc: "One person's pseudonymous profile (id like U0001): consents, interests, platforms and comments.",
		Params: []mcpParam{{Name: "pseudo_id", Type: "string", Desc: "Pseudonymous id from list_segment_members", Required: true}},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.need("pseudo_id")
			return "GET", "/api/v1/audience/members/" + url.PathEscape(id), nil, err
		}},
	{Name: "get_automation", Route: "GET /api/v1/automation", Title: "Automation", Desc: "Automation rules (on or off) and the tasks they drafted for the creator to approve.", build: get("/api/v1/automation")},
	{Name: "get_settings", Route: "GET /api/v1/settings", Title: "Settings", Desc: "The creator's profile, platform handles, rate card and import history (read only; no account credentials).", build: get("/api/v1/settings")},

	// Write tools: on by default; MCP_READ_ONLY=1 hides them. They change the creator's real records, but nothing is
	// sent to a brand or fan from here.
	{Name: "create_brand", Route: "POST /api/v1/brands", Title: "Add brand", Write: true, Additive: true,
		Desc: "Add a new brand. The category is required. A main contact is created only when contactName, contactRole or handle is given (and then channel is required); otherwise the brand has no contact. Brand names are unique, ignoring case: a duplicate is refused and the error names the existing brand.",
		Params: []mcpParam{
			{Name: "name", Type: "string", Desc: "Brand name", Required: true, MaxLen: crm.MaxBrandName},
			{Name: "category", Type: "string", Desc: "Product category", Required: true, Enum: anyStrings(model.ProductCategories)},
			{Name: "website", Type: "string", Desc: "Website", MaxLen: crm.MaxBrandWebsite},
			{Name: "contactName", Type: "string", Desc: "Main contact's name", MaxLen: crm.MaxContactName},
			{Name: "contactRole", Type: "string", Desc: "Main contact's role", MaxLen: crm.MaxContactRole},
			{Name: "channel", Type: "string", Desc: "How the contact is reached (required when a contact is given)", Enum: anyStrings(crm.ContactChannels)},
			{Name: "handle", Type: "string", Desc: "Contact's handle or address on that channel", MaxLen: crm.MaxHandle},
		},
		build: func(a mcpArgs) (string, string, any, error) {
			body := map[string]string{}
			name, err := a.need("name")
			if err != nil {
				return "", "", nil, err
			}
			body["name"] = name
			category, err := a.need("category")
			if err != nil {
				return "", "", nil, err
			}
			if category, err = a.oneOf("category", model.ProductCategories); err != nil {
				return "", "", nil, err
			}
			body["category"] = category
			channel, err := a.oneOf("channel", crm.ContactChannels)
			if err != nil {
				return "", "", nil, err
			}
			body["channel"] = channel
			for _, k := range []string{"website", "contactName", "contactRole", "handle"} {
				v, err := a.str(k)
				if err != nil {
					return "", "", nil, err
				}
				body[k] = v
			}
			return "POST", "/api/v1/brands", body, nil
		}},
	{Name: "move_deal_stage", Route: "POST /api/v1/deals/{id}/stage", Title: "Move deal stage", Write: true, Idempotent: true,
		Desc: "Move a deal to another pipeline stage. The deal, its invoice, the finance numbers and the brand tier always agree: reaching invoiced or paid creates the invoice (paid also marks it paid); moving back before invoiced cancels an unpaid invoice; a deal whose invoice is already paid can't move back at all (the move is refused and says why). The result lists invoiceCreated, invoicePaid or invoiceVoided when that happened, and a reason when nothing changed.",
		Params: []mcpParam{
			{Name: "deal_id", Type: "integer", Desc: "Deal id from get_pipeline", Required: true},
			{Name: "stage", Type: "string", Desc: "New stage", Required: true, Enum: anyStrings(model.DealStages)},
		},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("deal_id")
			if err != nil {
				return "", "", nil, err
			}
			stage, err := a.oneOf("stage", model.DealStages)
			if err == nil && stage == "" {
				err = fmt.Errorf("stage is required")
			}
			return "POST", fmt.Sprintf("/api/v1/deals/%d/stage", id), map[string]string{"stage": stage}, err
		}},
	{Name: "mark_invoice_paid", Route: "POST /api/v1/invoices/{id}/paid", Title: "Mark invoice paid", Write: true, Idempotent: true,
		Desc:   "Record that an invoice was paid (the deal moves to paid too). Only when the creator confirms the money arrived. Paying an invoice that was already paid changes nothing and returns alreadyPaid: true.",
		Params: []mcpParam{{Name: "invoice_id", Type: "integer", Desc: "Invoice id from get_finance", Required: true}},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("invoice_id")
			return "POST", fmt.Sprintf("/api/v1/invoices/%d/paid", id), nil, err
		}},

	// Inbox. These only RECORD things in Creator OS; nothing is sent to a brand or fan from here.
	{Name: "mark_thread_read", Route: "POST /api/v1/inbox/threads/{id}/read", Title: "Mark thread read", Desc: "Mark a brand's inbound messages as read. Returns how many changed.", Write: true, Additive: true, Idempotent: true,
		Params: []mcpParam{{Name: "brand_id", Type: "integer", Desc: "Brand id", Required: true}},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("brand_id")
			return "POST", fmt.Sprintf("/api/v1/inbox/threads/%d/read", id), nil, err
		}},
	{Name: "reply_to_brand", Route: "POST /api/v1/inbox/threads/{id}/reply", Title: "Record reply to brand", Write: true, Additive: true,
		Desc: "Record a reply to a brand in its inbox thread and on the brand's timeline; returns the new messageId. This only RECORDS it in Creator OS: nothing is sent to the brand. The creator sends it from the web app (Gmail draft or LINE).",
		Params: []mcpParam{
			{Name: "brand_id", Type: "integer", Desc: "Brand id", Required: true},
			{Name: "body", Type: "string", Desc: "The reply text", Required: true, MaxLen: 5000},
		},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("brand_id")
			if err != nil {
				return "", "", nil, err
			}
			body, err := a.need("body")
			return "POST", fmt.Sprintf("/api/v1/inbox/threads/%d/reply", id), map[string]string{"body": body}, err
		}},
	{Name: "convert_brief", Route: "POST /api/v1/messages/{id}/convert", Title: "Turn brief into deal", Write: true, Additive: true, Idempotent: true,
		Desc: "Turn a detected brand brief (a message with briefStatus new, see get_inbox_thread) into a deal at the brief stage; returns the new dealId. Title and value default to the brief's product and budget. If the message is not a new brief (already converted, ignored, or not a brief) nothing changes: converted is false and reason says why.",
		Params: []mcpParam{
			{Name: "message_id", Type: "integer", Desc: "Message id of the brief", Required: true},
			{Name: "title", Type: "string", Desc: "Deal title (optional)", MaxLen: crm.MaxBrandName},
			{Name: "value", Type: "number", Desc: "Deal value in baht (optional)", Schema: map[string]any{"type": "number", "minimum": 0}},
		},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("message_id")
			if err != nil {
				return "", "", nil, err
			}
			title, err := a.str("title")
			if err != nil {
				return "", "", nil, err
			}
			value, err := a.number("value")
			return "POST", fmt.Sprintf("/api/v1/messages/%d/convert", id), map[string]any{"title": title, "value": value}, err
		}},
	{Name: "ignore_brief", Route: "POST /api/v1/messages/{id}/ignore", Title: "Dismiss brief", Write: true, Idempotent: true,
		Desc:   "Dismiss a detected brand brief so it stops showing as new. Confirm with the creator first. If the message is not a new brief (already converted or ignored, or not a brief) nothing changes: ignored is false and reason says why.",
		Params: []mcpParam{{Name: "message_id", Type: "integer", Desc: "Message id of the brief", Required: true}},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("message_id")
			return "POST", fmt.Sprintf("/api/v1/messages/%d/ignore", id), nil, err
		}},
	{Name: "reply_to_comment", Route: "POST /api/v1/comments/{id}/reply", Title: "Record comment reply", Write: true, Idempotent: true,
		Desc: "Save a reply to an audience comment and mark it replied. This only RECORDS it in Creator OS: the creator posts it on the platform themselves. A second reply overwrites the first, and replying to a hidden comment brings it back as replied (the result shows previousStatus): writing a reply is the creator choosing to deal with that comment.",
		Params: []mcpParam{
			{Name: "comment_id", Type: "integer", Desc: "Comment id from list_comments", Required: true},
			{Name: "text", Type: "string", Desc: "The reply text", Required: true, MaxLen: 2000},
		},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("comment_id")
			if err != nil {
				return "", "", nil, err
			}
			text, err := a.need("text")
			return "POST", fmt.Sprintf("/api/v1/comments/%d/reply", id), map[string]string{"text": text}, err
		}},
	{Name: "hide_comment", Route: "POST /api/v1/comments/{id}/hide", Title: "Hide comment", Desc: "Hide an audience comment from the triage queue. Confirm with the creator first. Returns the comment's previousStatus.", Write: true, Idempotent: true,
		Params: []mcpParam{{Name: "comment_id", Type: "integer", Desc: "Comment id from list_comments", Required: true}},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("comment_id")
			return "POST", fmt.Sprintf("/api/v1/comments/%d/hide", id), nil, err
		}},

	// Automation.
	{Name: "set_automation_rule_enabled", Route: "POST /api/v1/automation/rules/{id}/enabled", Title: "Turn automation rule on/off", Desc: "Turn one automation rule on or off. Rule ids are in get_automation.", Write: true, Idempotent: true,
		Params: []mcpParam{
			{Name: "rule_id", Type: "string", Desc: "Rule id from get_automation", Required: true},
			{Name: "enabled", Type: "boolean", Desc: "true = on, false = off", Required: true},
		},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.need("rule_id")
			if err != nil {
				return "", "", nil, err
			}
			on, err := a.boolean("enabled")
			return "POST", "/api/v1/automation/rules/" + url.PathEscape(id) + "/enabled", map[string]bool{"enabled": on}, err
		}},
	{Name: "complete_task", Route: "POST /api/v1/tasks/{id}/complete", Title: "Approve drafted task", Write: true, Idempotent: true,
		Desc: "Approve a drafted automation task with its final wording: the task is done, the message is recorded on the brand timeline and in its inbox thread (returns messageId), and a +7-day report moves a posted deal on. Nothing is sent to the brand; the creator sends it from the web app. Start from the task's drafted text in get_automation. A task that is not open changes nothing: done is false and reason says why.",
		Params: []mcpParam{
			{Name: "task_id", Type: "integer", Desc: "Task id from get_automation", Required: true},
			{Name: "message", Type: "string", Desc: "The final message text", Required: true, MaxLen: 5000},
		},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("task_id")
			if err != nil {
				return "", "", nil, err
			}
			msg, err := a.need("message")
			return "POST", fmt.Sprintf("/api/v1/tasks/%d/complete", id), map[string]string{"message": msg}, err
		}},
	{Name: "dismiss_task", Route: "POST /api/v1/tasks/{id}/dismiss", Title: "Dismiss drafted task", Desc: "Dismiss a drafted automation task. Confirm with the creator first. A task that is not open changes nothing: dismissed is false and reason says why.", Write: true, Idempotent: true,
		Params: []mcpParam{{Name: "task_id", Type: "integer", Desc: "Task id from get_automation", Required: true}},
		build: func(a mcpArgs) (string, string, any, error) {
			id, err := a.id("task_id")
			return "POST", fmt.Sprintf("/api/v1/tasks/%d/dismiss", id), nil, err
		}},
	{Name: "reset_automation", Route: "POST /api/v1/automation/reset", Title: "Reset automation", Write: true, Idempotent: true,
		Desc:   "DELETES every automation task and the run history (the demo's start-over). Only when the creator explicitly asks, and pass confirm=true.",
		Params: []mcpParam{{Name: "confirm", Type: "boolean", Desc: "Must be true", Required: true}},
		build: func(a mcpArgs) (string, string, any, error) {
			ok, err := a.boolean("confirm")
			if err == nil && !ok {
				err = fmt.Errorf("reset_automation deletes every task and the run history: pass confirm=true only if the creator asked for it")
			}
			return "POST", "/api/v1/automation/reset", nil, err
		}},

	// Settings.
	{Name: "save_rates", Route: "PUT /api/v1/settings/rates", Title: "Change rate card", Write: true, Idempotent: true,
		Desc: "Change rate-card prices by code, in whole baht from 0 to 10,000,000, e.g. {\"TT_VIDEO\": 20000}. Codes are case-sensitive and listed in get_settings (rateCard[].code). Nothing is saved unless every code and price is valid: an unknown code or a decimal price is refused, with the valid codes listed. Returns the prices that changed. Confirm the new prices with the creator first.",
		Params: []mcpParam{{Name: "prices", Type: "object", Desc: "Map of rate-card code to new price in whole baht", Required: true,
			Schema: map[string]any{"type": "object", "minProperties": 1, "additionalProperties": map[string]any{"type": "integer", "minimum": 0, "maximum": 10_000_000}}}},
		build: func(a mcpArgs) (string, string, any, error) {
			raw, ok := a["prices"].(map[string]any)
			if !ok || len(raw) == 0 {
				return "", "", nil, fmt.Errorf("prices must be an object like {\"TT_VIDEO\": 20000}")
			}
			prices := map[string]float64{}
			for code, v := range raw {
				f, isNum := v.(float64)
				if !isNum || f != math.Trunc(f) || f < 0 || f > 10_000_000 {
					return "", "", nil, fmt.Errorf("price for %s must be a whole number of baht from 0 to 10,000,000", code)
				}
				prices[code] = f
			}
			return "PUT", "/api/v1/settings/rates", map[string]any{"prices": prices}, nil
		}},
	{Name: "save_profile", Route: "PUT /api/v1/settings/profile", Title: "Update profile", Write: true, Idempotent: true,
		Desc: "Update the creator's profile. Send only what should change: everything you leave out keeps its current value (the result lists what changed). The name and handles can't be blank (a blank is refused, not treated as a reset); an empty tagline clears the tagline. Follower counts are whole numbers and are recorded on that platform's latest snapshot.",
		Params: []mcpParam{
			{Name: "name", Type: "string", Desc: "Creator name (not blank)", MaxLen: 120, Schema: map[string]any{"type": "string", "minLength": 1, "maxLength": 120}},
			{Name: "tagline", Type: "string", Desc: "Tagline (empty clears it)", MaxLen: 200},
			{Name: "handles", Type: "object", Desc: "Platform handles to change, e.g. {\"tiktok\": \"@me\"}; none can be blank",
				Schema: map[string]any{"type": "object", "properties": map[string]any{
					"tiktok": map[string]any{"type": "string", "minLength": 1, "maxLength": 120}, "instagram": map[string]any{"type": "string", "minLength": 1, "maxLength": 120}, "youtube": map[string]any{"type": "string", "minLength": 1, "maxLength": 120}}, "additionalProperties": false}},
			{Name: "followers", Type: "object", Desc: "Current follower counts to record, e.g. {\"tiktok\": 12500}",
				Schema: map[string]any{"type": "object", "properties": map[string]any{
					"tiktok": map[string]any{"type": "integer", "minimum": 1}, "instagram": map[string]any{"type": "integer", "minimum": 1}, "youtube": map[string]any{"type": "integer", "minimum": 1}}, "additionalProperties": false}},
		},
		run: runSaveProfile},
}

// annotations are the hints an AI app uses to decide whether to ask the user before calling a tool.
func (t mcpTool) annotations() map[string]any {
	if !t.Write {
		return map[string]any{"readOnlyHint": true, "openWorldHint": false}
	}
	return map[string]any{"readOnlyHint": false, "destructiveHint": !t.Additive, "idempotentHint": t.Idempotent, "openWorldHint": false}
}

// mcpEnabled is the tools this server exposes right now.
func (s *Server) mcpEnabled() []mcpTool {
	var out []mcpTool
	for _, t := range mcpTools {
		if !t.Write || !s.MCPReadOnly {
			out = append(out, t)
		}
	}
	return out
}

// ── JSON-RPC over HTTP ──

type rpcMsg struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

func rpcResult(id json.RawMessage, result any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
}

func rpcError(id json.RawMessage, code int, msg string) map[string]any {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": msg}}
}

func (s *Server) mcp(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, http.StatusUnsupportedMediaType, "send Content-Type: application/json")
		return
	}
	// A browser page on another site must not be able to drive the API (DNS rebinding / cross-site posts).
	if o := r.Header.Get("Origin"); o != "" {
		if u, err := url.Parse(o); err != nil || u.Host != r.Host {
			fail(w, http.StatusForbidden, "origin not allowed")
			return
		}
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		fail(w, http.StatusBadRequest, "request too large or unreadable")
		return
	}
	raw = bytes.TrimSpace(raw)

	if len(raw) > 0 && raw[0] == '[' {
		// JSON-RPC batching was removed from MCP in the 2025-06-18 revision: one message per request.
		send(w, http.StatusBadRequest, rpcError(nil, -32600, "batch requests are not supported: send one JSON-RPC message per request"))
		return
	}
	resp, ok := s.mcpHandle(r.Context(), raw)
	if !ok {
		w.WriteHeader(http.StatusAccepted) // a notification: nothing to answer
		return
	}
	send(w, http.StatusOK, resp)
}

// mcpHandle answers one JSON-RPC message; ok is false when there is nothing to send back.
func (s *Server) mcpHandle(ctx context.Context, raw []byte) (any, bool) {
	var m rpcMsg
	if err := json.Unmarshal(raw, &m); err != nil {
		return rpcError(nil, -32700, "parse error"), true
	}
	if m.Method == "" || len(m.ID) == 0 {
		return nil, false // a response from the client, or a notification such as notifications/initialized
	}
	switch m.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(m.Params, &p)
		version := mcpLatest
		if mcpVersions[p.ProtocolVersion] {
			version = p.ProtocolVersion
		}
		return rpcResult(m.ID, map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": "creator-os", "title": "Creator OS", "version": "0.1.0"},
			"instructions":    mcpInstructions,
		}), true
	case "ping":
		return rpcResult(m.ID, map[string]any{}), true
	case "tools/list":
		tools := []map[string]any{}
		for _, t := range s.mcpEnabled() {
			tools = append(tools, map[string]any{
				"name": t.Name, "title": t.Title, "description": t.Desc, "inputSchema": t.schema(),
				"annotations": t.annotations(),
			})
		}
		return rpcResult(m.ID, map[string]any{"tools": tools}), true
	case "tools/call":
		var p struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if json.Unmarshal(m.Params, &p) != nil || p.Name == "" {
			return rpcError(m.ID, -32602, "tools/call needs {name, arguments}"), true
		}
		for _, t := range s.mcpEnabled() {
			if t.Name == p.Name {
				text, isErr := s.mcpRun(ctx, t, mcpArgs(p.Arguments))
				return rpcResult(m.ID, map[string]any{"isError": isErr, "content": []map[string]any{{"type": "text", "text": text}}}), true
			}
		}
		return rpcError(m.ID, -32602, "unknown tool: "+p.Name), true
	default:
		return rpcError(m.ID, -32601, "method not found: "+m.Method), true
	}
}

// callInner calls one of the API's own routes in-process and returns the status and body.
func (s *Server) callInner(ctx context.Context, method, path string, body any) (int, []byte) {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, path, rd)
	if err != nil {
		return http.StatusBadRequest, []byte(`{"error":"could not build the request"}`)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	s.inner.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}

// naiveTimestamp matches a whole JSON string that is a date-time with no timezone, e.g. "2026-11-21T10:41:32".
var naiveTimestamp = regexp.MustCompile(`"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"`)

// bangkokOffset is appended to timestamps: the app stores Bangkok wall-clock times without an offset, and an AI
// reading "10:41:32" has no way to know which zone that is. (Plain dates are left alone.)
const bangkokOffset = "+07:00"

// mcpResult turns an API response into tool output. Errors become isError results carrying just the message (no
// internal prefix); JSON gets RFC 3339 timestamps and is indented; very long output is cut.
func mcpResult(code int, raw []byte, post func([]byte) []byte) (text string, isErr bool) {
	if code >= 400 {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &e) == nil && e.Error != "" {
			return e.Error, true
		}
		return fmt.Sprintf("The request failed (HTTP %d)", code), true
	}
	if post != nil {
		raw = post(raw)
	}
	out := string(raw)
	if json.Valid(raw) {
		out = naiveTimestamp.ReplaceAllString(out, `"$1`+bangkokOffset+`"`)
		var pretty bytes.Buffer
		if json.Indent(&pretty, []byte(out), "", "  ") == nil {
			out = pretty.String()
		}
	}
	if len(out) > mcpMaxChars {
		out = strings.ToValidUTF8(out[:mcpMaxChars], "") + fmt.Sprintf("\n… [truncated: %d more characters. Ask for something narrower.]", len(out)-mcpMaxChars)
	}
	return out, false
}

// dropRunAction removes the "run today's automations" item from Needs-you-today: that job is a button in the web
// app, and there is no MCP tool that could do it.
func dropRunAction(raw []byte) []byte {
	var top map[string]json.RawMessage
	var actions []json.RawMessage
	if json.Unmarshal(raw, &top) != nil || json.Unmarshal(top["actions"], &actions) != nil {
		return raw
	}
	kept := make([]json.RawMessage, 0, len(actions))
	for _, a := range actions {
		var k struct {
			Kind string `json:"kind"`
		}
		if json.Unmarshal(a, &k) != nil || k.Kind != "run" {
			kept = append(kept, a)
		}
	}
	top["actions"], _ = json.Marshal(kept)
	out, err := json.Marshal(top)
	if err != nil {
		return raw
	}
	return out
}

// unknownArgs lists arguments the tool doesn't have (the schema says additionalProperties: false, so it is enforced).
func unknownArgs(t mcpTool, args mcpArgs) []string {
	known := map[string]bool{}
	for _, p := range t.Params {
		known[p.Name] = true
	}
	var bad []string
	for k := range args {
		if !known[k] {
			bad = append(bad, k)
		}
	}
	sort.Strings(bad)
	return bad
}

// mcpRun executes a tool by calling the API's own route(s) in-process.
func (s *Server) mcpRun(ctx context.Context, t mcpTool, args mcpArgs) (text string, isErr bool) {
	if args == nil {
		args = mcpArgs{}
	}
	if bad := unknownArgs(t, args); len(bad) > 0 {
		var names []string
		for _, p := range t.Params {
			names = append(names, p.Name)
		}
		accepts := "no arguments"
		if len(names) > 0 {
			accepts = strings.Join(names, ", ")
		}
		return fmt.Sprintf("Unknown argument(s) for %s: %s. It accepts: %s.", t.Name, strings.Join(bad, ", "), accepts), true
	}
	if t.Write {
		log.Printf("mcp write: %s %v", t.Name, args)
	}
	if t.run != nil {
		return t.run(s, ctx, args)
	}
	method, path, body, err := t.build(args)
	if err != nil {
		return err.Error(), true
	}
	code, raw := s.callInner(ctx, method, path, body)
	return mcpResult(code, raw, t.post)
}

// runSaveProfile merges the given fields into the current profile, because the API replaces the whole
// profile and an AI changing one handle must not blank the name and the other handles. Blank names and handles
// are refused (the API would turn a blank name into "Creator" and blank handles into "—").
func runSaveProfile(s *Server, ctx context.Context, a mcpArgs) (string, bool) {
	name, err := a.str("name")
	if err != nil {
		return err.Error(), true
	}
	tagline, err := a.str("tagline")
	if err != nil {
		return err.Error(), true
	}
	_, hasName := a["name"]
	_, hasTagline := a["tagline"]
	handlesIn, hasHandles := a["handles"].(map[string]any)
	followersIn, hasFollowers := a["followers"].(map[string]any)
	if !hasName && !hasTagline && !hasHandles && !hasFollowers {
		return "nothing to change: pass name, tagline, handles and/or followers", true
	}
	if hasName && name == "" {
		return "name can't be blank: pass the new name, or leave name out to keep the current one", true
	}
	if utf8.RuneCountInString(name) > 120 || utf8.RuneCountInString(tagline) > 200 {
		return "name can be at most 120 characters and tagline at most 200", true
	}

	code, raw := s.callInner(ctx, "GET", "/api/v1/settings", nil)
	if code != http.StatusOK {
		return mcpResult(code, raw, nil)
	}
	var cur struct {
		Settings struct {
			Profile struct {
				Name    string            `json:"name"`
				Tagline string            `json:"tagline"`
				Handles map[string]string `json:"handles"`
			} `json:"profile"`
		} `json:"settings"`
	}
	if json.Unmarshal(raw, &cur) != nil {
		return "could not read the current profile", true
	}
	now := cur.Settings.Profile
	in := map[string]any{"name": now.Name, "tagline": now.Tagline}
	changed, unchanged := []string{}, []string{}
	note := func(field string, differs bool) {
		if differs {
			changed = append(changed, field)
		} else {
			unchanged = append(unchanged, field)
		}
	}
	if hasName {
		note("name", name != now.Name)
		in["name"] = name
	}
	if hasTagline {
		note("tagline", tagline != now.Tagline)
		in["tagline"] = tagline
	}
	handles := map[string]string{}
	for _, p := range model.PlatformKeys {
		handles[p] = now.Handles[p]
	}
	if hasHandles {
		keys := make([]string, 0, len(handlesIn))
		for k := range handlesIn {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			str, isStr := handlesIn[k].(string)
			str = strings.TrimSpace(str)
			if _, known := handles[k]; !known || !isStr {
				return fmt.Sprintf("handles.%s: use tiktok, instagram or youtube with a text value", k), true
			}
			if str == "" {
				return fmt.Sprintf("handles.%s can't be blank: pass the handle, or leave it out to keep the current one", k), true
			}
			if utf8.RuneCountInString(str) > 120 {
				return fmt.Sprintf("handles.%s is too long (the limit is 120 characters)", k), true
			}
			note("handles."+k, str != handles[k])
			handles[k] = str
		}
	}
	in["handles"] = handles
	followers := map[string]string{}
	if hasFollowers {
		keys := make([]string, 0, len(followersIn))
		for k := range followersIn {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			known := false
			for _, p := range model.PlatformKeys {
				known = known || p == k
			}
			if !known {
				return fmt.Sprintf("followers.%s: use tiktok, instagram or youtube", k), true
			}
			switch x := followersIn[k].(type) {
			case float64: // JSON numbers: must be whole and positive
				if x != math.Trunc(x) || x < 1 || x > settings.MaxFollowers {
					return fmt.Sprintf("followers.%s must be a whole number of at least 1 (got %v)", k, x), true
				}
				followers[k] = strconv.FormatFloat(x, 'f', -1, 64)
			case string: // "12,500" is accepted; the API rejects decimals and anything else
				followers[k] = x
			default:
				return fmt.Sprintf("followers.%s must be a whole number", k), true
			}
			changed = append(changed, "followers."+k)
		}
	}
	in["followers"] = followers

	code, raw = s.callInner(ctx, "PUT", "/api/v1/settings/profile", in)
	if code >= 400 {
		return mcpResult(code, raw, nil)
	}
	out, _ := json.Marshal(map[string]any{
		"ok": true, "changed": changed, "unchanged": unchanged,
		"profile": map[string]any{"name": in["name"], "tagline": in["tagline"], "handles": handles},
	})
	return mcpResult(http.StatusOK, out, nil)
}

// mcpMethodNotAllowed answers GET /mcp: this server has no streaming channel, only POST.
func mcpMethodNotAllowed(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Allow", "POST")
	fail(w, http.StatusMethodNotAllowed, "this is an MCP endpoint: POST JSON-RPC messages to it (see the front page)")
}
