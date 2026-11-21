package api

import (
	_ "embed"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
)

//go:embed docs.html
var docsHTML string

// doc describes one endpoint on the front page. Every registered route must have one (docs_test.go),
// so the page can never fall out of date.
type doc struct {
	Group   string `json:"group"`
	Summary string `json:"summary"`
	Query   string `json:"query,omitempty"` // example query string
	Body    string `json:"body,omitempty"`  // example JSON body
}

var docs = map[string]doc{
	"GET /api/v1/health":  {"System", "Is the API up? Returns the mode (demo or live) and the app's \"today\". The only endpoint that never needs the token.", "", ""},
	"GET /api/v1/context": {"System", "The \"today\" every screen uses: the real Bangkok date in live mode, the story date in demo.", "", ""},

	"GET /api/v1/overview":          {"Overview", "KPIs, daily series, top content, product-question spikes and insights for the last 7, 28 or 90 days, with the same video grouped across platforms. kpis.newFollowers is followers gained in the window; engagement rates are null where there were no views; dataAsOf and lastImportAt say how fresh the data is.", "range=28", ""},
	"GET /api/v1/today":             {"Overview", "\"Needs you today\": the ranked list of things to act on (briefs, overdue invoices, silent brands, comment spikes, drafted tasks).", "", ""},
	"GET /api/v1/brands":            {"CRM", "Brands with tier, deal value, silence and open deals. Filter with q (name), tier and category.", "tier=partner", ""},
	"POST /api/v1/brands":           {"CRM", "Add a brand. category is required and must be one of skincare, tech, food, home, fashion, music. A main contact is created only when contactName, contactRole or handle is given (then channel must be line, email or ig_dm). Names are unique ignoring case (409 with the existing id otherwise), and every text field has a length limit.", "", `{"name":"New Brand","category":"skincare","website":"","contactName":"Mint","contactRole":"PR","channel":"line","handle":"@mint"}`},
	"GET /api/v1/brands/{id}":       {"CRM", "Brand 360: stats, post performance, recommended next offer (rule + the numbers behind it), invoices and timeline.", "", ""},
	"GET /api/v1/pipeline":          {"CRM", "Every deal by stage, ordered by most recent activity: the closed date if it has one, else the posted date, else the created date (shown as date).", "", ""},
	"POST /api/v1/deals/{id}/stage": {"CRM", "Move a deal to another stage. The deal, its invoice, the finance numbers and the brand tier stay in agreement: reaching Invoiced or Paid creates the invoice (Paid also marks it paid), moving back before Invoiced cancels an unpaid invoice, and a deal whose invoice is already paid can't move back (409 with the reason). The reply lists invoiceCreated / invoicePaid / invoiceVoided, or a reason when nothing changed.", "", `{"stage":"quotation"}`},

	"GET /api/v1/finance":             {"Finance", "Income by month, receivables, overdue invoices, tax set-aside and income by platform.", "", ""},
	"GET /api/v1/finance/export":      {"Finance", "The year's invoices as a CSV for your accountant (opens in Excel with Thai text intact).", "year=2026", ""},
	"POST /api/v1/invoices/{id}/paid": {"Finance", "Mark an invoice paid. The deal moves to Paid too. An invoice that was already paid changes nothing and returns alreadyPaid: true.", "", ""},

	"GET /api/v1/inbox":                     {"Inbox", "Badge counts: unread messages, new briefs, comments that need a reply.", "", ""},
	"GET /api/v1/inbox/threads":             {"Inbox", "One conversation per brand: new briefs first, then unread, then most recent.", "", ""},
	"GET /api/v1/inbox/threads/{id}":        {"Inbox", "A brand's messages with the contact, each detected brief priced from the rate card, and the deal a brief became. {id} is the brand id.", "", ""},
	"POST /api/v1/inbox/threads/{id}/read":  {"Inbox", "Mark a brand's inbound messages as read.", "", ""},
	"POST /api/v1/inbox/threads/{id}/reply": {"Inbox", "Record your reply to a brand in its thread and on the brand timeline (max 5,000 characters); returns the new messageId. Nothing is sent: Gmail drafts and LINE sends are made by the web app.", "", `{"body":"สวัสดีค่ะ ขอบคุณที่ติดต่อมานะคะ"}`},
	"GET /api/v1/inbox/comments":            {"Inbox", "Audience comments to triage (last 14 days, people who withdrew consent excluded), product questions first. cat: needs_reply (default), product_question, content_request, general_question, praise or spam. status: open (default), replied or hidden. Paged with limit (1-200, default 40) and offset; the reply has total and hasMore, and each row has its status.", "cat=needs_reply&status=open&limit=40&offset=0", ""},
	"POST /api/v1/messages/{id}/convert":    {"Inbox", "Turn a detected brief into a deal at the Brief stage (title and value are optional; they default to the brief's product and budget). Returns the new dealId. A message that is not a new brief (already converted, ignored, or not a brief) changes nothing and returns converted: false with a reason.", "", `{"title":"","value":0}`},
	"POST /api/v1/messages/{id}/ignore":     {"Inbox", "Dismiss a detected brief. A message that is not a new brief changes nothing and returns ignored: false with a reason.", "", ""},
	"POST /api/v1/comments/{id}/reply":      {"Inbox", "Save the reply you wrote to a comment (max 2,000 characters; you post it on the platform yourself). Overwrites an earlier reply, and a hidden comment comes back as replied: the reply shows previousStatus.", "", `{"text":"ขอบคุณค่ะ"}`},
	"POST /api/v1/comments/{id}/hide":       {"Inbox", "Hide a comment from the queue. Returns its previousStatus.", "", ""},

	"GET /api/v1/audience":                       {"Audience", "Follower growth, latestFollowers (the current count per platform: the same number Settings shows), the demographic split for a month and platform (demographics.followers is the count in splitMonth, the month the split was measured), and every behavioural segment with its size.", "platform=tiktok", ""},
	"GET /api/v1/audience/segments/{id}/members": {"Audience", "The people in a segment, most active first. {id}: superfans, requesters, newcomers, contactable or askers_<category>.", "limit=30", ""},
	"GET /api/v1/audience/members/{id}":          {"Audience", "One person's profile (pseudonymous ID like U0001): consents, interests, platforms and comments.", "", ""},

	"GET /api/v1/automation":                     {"Automation", "Rules, open tasks, finished tasks and the last runs of the daily job.", "", ""},
	"POST /api/v1/automation/rules/{id}/enabled": {"Automation", "Turn a rule on or off.", "", `{"enabled":true}`},
	"POST /api/v1/automation/reset":              {"Automation", "Remove every task and the run history (the demo's start-over).", "", ""},
	"POST /api/v1/tasks/{id}/complete":           {"Automation", "Approve a drafted task with your final wording: it is logged on the brand timeline and in its Inbox thread (returns messageId). A task that is not open changes nothing and returns done: false with a reason.", "", `{"message":"final text"}`},
	"POST /api/v1/tasks/{id}/dismiss":            {"Automation", "Dismiss a drafted task. A task that is not open changes nothing and returns dismissed: false with a reason.", "", ""},

	"POST /mcp": {"MCP", "The MCP endpoint for AI apps (Streamable HTTP, JSON-RPC). Connect an AI with this URL; the section above has copy-paste setup. Try tools/list here.", "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`},

	"GET /api/v1/settings":         {"Settings", "Your profile, platform handles, latestFollowers (the same source as the Audience page), the rate card, import history and the audience consent summary.", "", ""},
	"PUT /api/v1/settings/rates":   {"Settings", "Change rate-card prices by code. Prices are whole baht from 0 to 10,000,000 and codes are case-sensitive: an unknown code or a bad price is a 400 that lists the valid codes, and nothing is saved. Returns the prices that changed.", "", `{"prices":{"TT_VIDEO":20000}}`},
	"PUT /api/v1/settings/profile": {"Settings", "Save your name, tagline and platform handles. A typed follower count (whole digits, thousands separators allowed, such as 12,500) goes on the platform's latest snapshot; decimals and anything else are a 400.", "", `{"name":"","tagline":"","handles":{"tiktok":"@me","instagram":"","youtube":""},"followers":{"tiktok":"","instagram":"","youtube":""}}`},
}

// docsPage is the API's front page: every endpoint, with a form to try it.
func (s *Server) docsPage(w http.ResponseWriter, r *http.Request) {
	type entry struct {
		Method string `json:"method"`
		Path   string `json:"path"`
		doc
	}
	var list []entry
	for _, pat := range s.routes {
		d, ok := docs[pat]
		if !ok {
			continue // the page itself
		}
		method, path, _ := strings.Cut(pat, " ")
		list = append(list, entry{method, path, d})
	}
	sort.SliceStable(list, func(i, j int) bool { return groupRank(list[i].Group) < groupRank(list[j].Group) })
	tools := make([]mcpTool, len(mcpTools))
	copy(tools, mcpTools)
	for i := range tools {
		if tools[i].Params == nil {
			tools[i].Params = []mcpParam{} // JSON [] not null, so the page can always count them
		}
	}
	raw, _ := json.Marshal(map[string]any{
		"endpoints":     list,
		"tokenRequired": s.Token != "",
		"mcp":           map[string]any{"write": !s.MCPReadOnly, "tools": tools},
	})
	page := strings.Replace(docsHTML, "/*DATA*/null", strings.ReplaceAll(string(raw), "</", `<\/`), 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(page))
}

var groupOrder = []string{"System", "Overview", "CRM", "Finance", "Inbox", "Audience", "Automation", "Settings", "MCP"}

func groupRank(g string) int {
	for i, x := range groupOrder {
		if x == g {
			return i
		}
	}
	return len(groupOrder)
}
