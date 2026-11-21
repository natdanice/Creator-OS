package api_test

// One test per problem found by calling the MCP tools on live and demo data: data integrity (P0), responses an AI
// can't interpret (P1), read-side correctness (P2) and protocol polish (P3).

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

func mustJSON(t *testing.T, text string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(text), &m); err != nil {
		t.Fatalf("not JSON: %v\n%s", err, text)
	}
	return m
}

// ── P0 ──────────────────────────────────────────────────────────────────────

// P0-1: a deal and its invoice can't drift apart.
func TestMCPDealAndInvoiceCannotDrift(t *testing.T) {
	ts := mcpServer(t, "", false)
	call := func(name, args string) (string, bool) {
		text, isErr, e := callTool(t, ts, name, args)
		if e != nil {
			t.Fatalf("%s: protocol error %v", name, e)
		}
		return text, isErr
	}
	incomeYTD := func() float64 {
		text, _ := call("get_finance", `{}`)
		return mustJSON(t, text)["finance"].(map[string]any)["kpis"].(map[string]any)["incomeYtd"].(float64)
	}
	jobs := func() float64 {
		text, _ := call("get_brand", `{"brand_id":1}`)
		return mustJSON(t, text)["brand"].(map[string]any)["stats"].(map[string]any)["jobs"].(float64)
	}

	// Pay the deal through the pipeline: invoice is created and paid, income counts, the brand has a job.
	text, isErr := call("move_deal_stage", `{"deal_id":1,"stage":"paid"}`)
	if isErr || !strings.Contains(text, `"invoicePaid": "INV-0001"`) {
		t.Fatalf("pay: %q", text)
	}
	if incomeYTD() != 30000 || jobs() != 1 {
		t.Fatalf("after paying: income %v, jobs %v", incomeYTD(), jobs())
	}

	// Moving it back is refused, says why, and changes nothing: invoice stays paid, income and tier agree.
	for _, back := range []string{"invoiced", "posted", "production", "brief"} {
		text, isErr = call("move_deal_stage", `{"deal_id":1,"stage":"`+back+`"}`)
		if !isErr || !strings.Contains(text, "already paid") || !strings.Contains(text, "INV-0001") {
			t.Errorf("moving a paid deal back to %s: isError=%v %q", back, isErr, text)
		}
	}
	if text, _ := call("get_pipeline", `{}`); !strings.Contains(text, `"stage": "paid"`) {
		t.Errorf("a refused move must leave the deal paid: %s", text)
	}
	if incomeYTD() != 30000 || jobs() != 1 {
		t.Errorf("after refused moves: income %v, jobs %v", incomeYTD(), jobs())
	}
}

func TestMCPUnpaidInvoiceIsCancelledWhenTheDealMovesBack(t *testing.T) {
	ts := mcpServer(t, "", false)
	call := func(name, args string) string {
		text, isErr, e := callTool(t, ts, name, args)
		if e != nil || isErr {
			t.Fatalf("%s %s: %q %v %v", name, args, text, isErr, e)
		}
		return text
	}
	if text := call("move_deal_stage", `{"deal_id":1,"stage":"invoiced"}`); !strings.Contains(text, `"invoiceCreated": "INV-0001"`) {
		t.Fatalf("invoiced: %s", text)
	}
	outstanding := func() float64 {
		return mustJSON(t, call("get_finance", `{}`))["finance"].(map[string]any)["kpis"].(map[string]any)["outstanding"].(float64)
	}
	if outstanding() != 30000 {
		t.Fatalf("outstanding with an invoice = %v", outstanding())
	}
	text := call("move_deal_stage", `{"deal_id":1,"stage":"production"}`)
	if !strings.Contains(text, `"invoiceVoided": "INV-0001"`) {
		t.Errorf("the response must say the invoice was cancelled: %s", text)
	}
	if outstanding() != 0 {
		t.Errorf("a cancelled invoice must leave the receivables: %v", outstanding())
	}
	// Moving to the same stage says why nothing happened.
	if text := call("move_deal_stage", `{"deal_id":1,"stage":"production"}`); !strings.Contains(text, `"changed": false`) || !strings.Contains(text, "already at production") {
		t.Errorf("same-stage move: %s", text)
	}
}

// P0-2 / P0-3: profile followers and blank names.
func TestMCPProfileValidation(t *testing.T) {
	ts := mcpServer(t, "", false)
	call := func(args string) (string, bool) {
		text, isErr, e := callTool(t, ts, "save_profile", args)
		if e != nil {
			t.Fatalf("protocol error %v", e)
		}
		return text, isErr
	}
	profile := func() map[string]any {
		text, _, _ := callTool(t, ts, "get_settings", `{}`)
		return mustJSON(t, text)["settings"].(map[string]any)
	}
	if _, isErr := call(`{"name":"Mint","tagline":"t","handles":{"tiktok":"@mint"}}`); isErr {
		t.Fatal("setup failed")
	}
	// Followers: whole numbers only; 1.5 must not become 15.
	for _, bad := range []string{`{"followers":{"tiktok":1.5}}`, `{"followers":{"tiktok":"1.5"}}`, `{"followers":{"tiktok":0}}`, `{"followers":{"tiktok":-4}}`, `{"followers":{"tiktok":"abc"}}`, `{"followers":{"tiktok":"1,5"}}`, `{"followers":{"x":5}}`} {
		if text, isErr := call(bad); !isErr {
			t.Errorf("%s must be refused, got %q", bad, text)
		}
	}
	if f := profile()["latestFollowers"].(map[string]any); f["tiktok"].(float64) != 25348 {
		t.Errorf("refused counts must not be stored: %v", f)
	}
	if text, isErr := call(`{"followers":{"tiktok":"12,500"}}`); isErr || !strings.Contains(text, "followers.tiktok") {
		t.Errorf("12,500: %q", text)
	}
	if f := profile()["latestFollowers"].(map[string]any); f["tiktok"].(float64) != 12500 {
		t.Errorf("12,500 should be stored: %v", f)
	}
	if _, isErr := call(`{"followers":{"tiktok":13000}}`); isErr {
		t.Error("a whole number should be accepted")
	}

	// Blank name / handles are refused, not turned into "Creator" or "—".
	for _, bad := range []string{`{"name":""}`, `{"name":"   "}`, `{"handles":{"tiktok":""}}`, `{"handles":{"tiktok":"  "}}`} {
		if text, isErr := call(bad); !isErr || !strings.Contains(text, "blank") {
			t.Errorf("%s must be refused as blank: isError=%v %q", bad, isErr, text)
		}
	}
	p := profile()["profile"].(map[string]any)
	if p["name"] != "Mint" || p["handles"].(map[string]any)["tiktok"] != "@mint" {
		t.Errorf("refused edits must change nothing: %v", p)
	}
	// An empty tagline is allowed (it clears it), and the response says what changed.
	text, isErr := call(`{"tagline":""}`)
	if isErr {
		t.Fatalf("clearing the tagline: %q", text)
	}
	m := mustJSON(t, text)
	if ch := m["changed"].([]any); len(ch) != 1 || ch[0] != "tagline" {
		t.Errorf("changed = %v", m["changed"])
	}
	if text, _ := call(`{"name":"Mint"}`); !strings.Contains(text, `"unchanged": [`+"\n"+`    "name"`) {
		t.Errorf("setting the same name should be reported as unchanged: %s", text)
	}
}

// P0-4 / P0-5: create_brand doesn't guess, duplicate or accept absurd input.
func TestMCPCreateBrandValidation(t *testing.T) {
	ts := mcpServer(t, "", false)
	create := func(args string) (string, bool) {
		text, isErr, e := callTool(t, ts, "create_brand", args)
		if e != nil {
			t.Fatalf("protocol error %v", e)
		}
		return text, isErr
	}
	for _, c := range []struct{ args, want string }{
		{`{"name":"A"}`, "category is required"},
		{`{"name":"A","category":"cars"}`, "skincare, tech, food, home, fashion, music"},
		{`{"name":"A","category":"tech","contactName":"X","channel":"pigeon"}`, "line, email, ig_dm"},
		{`{"name":"A","category":"tech","handle":"@x"}`, "channel must be one of"},
		{`{"name":"` + strings.Repeat("x", 5000) + `","category":"tech"}`, "too long"},
		{`{"name":"A","category":"tech","website":"` + strings.Repeat("w", 300) + `"}`, "website is too long"},
		{`{"name":"A","category":"tech","unknownField":1}`, "Unknown argument"},
	} {
		if text, isErr := create(c.args); !isErr || !strings.Contains(text, c.want) {
			t.Errorf("%.60s… → isError=%v %q, want %q", c.args, isErr, text, c.want)
		}
	}

	// A brand with no contact details has no contact at all (not a "—" placeholder on LINE).
	text, isErr := create(`{"name":"Plain Co","category":"food"}`)
	if isErr {
		t.Fatalf("plain brand: %q", text)
	}
	id := int(mustJSON(t, text)["id"].(float64))
	brand, _, _ := callTool(t, ts, "get_brand", `{"brand_id":`+itoa(id)+`}`)
	if c := mustJSON(t, brand)["brand"].(map[string]any)["stats"].(map[string]any)["contact"]; c != nil {
		t.Errorf("no contact fields were given, but the brand has a contact: %v", c)
	}
	// With a contact, it is stored as given.
	text, _ = create(`{"name":"Mint Co","category":"tech","contactName":"Mint","channel":"email","handle":"m@x.co"}`)
	id2 := int(mustJSON(t, text)["id"].(float64))
	brand, _, _ = callTool(t, ts, "get_brand", `{"brand_id":`+itoa(id2)+`}`)
	c := mustJSON(t, brand)["brand"].(map[string]any)["stats"].(map[string]any)["contact"].(map[string]any)
	if c["channel"] != "email" || c["handle"] != "m@x.co" {
		t.Errorf("contact = %v", c)
	}

	// Duplicates (ignoring case and spaces) are refused and name the existing brand.
	for _, name := range []string{"plain co", "  PLAIN CO ", "Glow"} {
		text, isErr := create(`{"name":"` + name + `","category":"food"}`)
		if !isErr || !strings.Contains(text, "already exists") || !strings.Contains(text, "(id ") {
			t.Errorf("duplicate %q: isError=%v %q", name, isErr, text)
		}
	}
	list, _, _ := callTool(t, ts, "list_brands", `{"q":"plain"}`)
	if n := strings.Count(list, `"name": "Plain Co"`); n != 1 {
		t.Errorf("the brand must exist once, found %d", n)
	}
	// The schema documents the limits.
	tools := toolNames(t, ts)
	props := tools["create_brand"]["inputSchema"].(map[string]any)["properties"].(map[string]any)
	if props["name"].(map[string]any)["maxLength"].(float64) != 120 || props["channel"].(map[string]any)["enum"] == nil {
		t.Errorf("create_brand schema: %v", props)
	}
	req := tools["create_brand"]["inputSchema"].(map[string]any)["required"].([]any)
	if len(req) != 2 {
		t.Errorf("name and category are required: %v", req)
	}
}

// ── P1 ──────────────────────────────────────────────────────────────────────

// P1-6 and P1-10: unknown ids are errors that name what was looked up.
func TestMCPUnknownIdsAreSpecificErrors(t *testing.T) {
	ts := mcpServer(t, "", false)
	for _, c := range []struct{ tool, args, want string }{
		{"get_brand", `{"brand_id":999}`, "No brand with id 999"},
		{"get_inbox_thread", `{"brand_id":999}`, "No brand with id 999"},
		{"mark_thread_read", `{"brand_id":999}`, "No brand with id 999"},
		{"reply_to_brand", `{"brand_id":999,"body":"hi"}`, "No brand with id 999"},
		{"ignore_brief", `{"message_id":999}`, "No message with id 999"},
		{"convert_brief", `{"message_id":999}`, "No message with id 999"},
		{"dismiss_task", `{"task_id":999}`, "No task with id 999"},
		{"complete_task", `{"task_id":999,"message":"x"}`, "No task with id 999"},
		{"move_deal_stage", `{"deal_id":999,"stage":"paid"}`, "No deal with id 999"},
		{"mark_invoice_paid", `{"invoice_id":999}`, "No invoice with id 999"},
		{"hide_comment", `{"comment_id":999}`, "No comment with id 999"},
		{"reply_to_comment", `{"comment_id":999,"text":"x"}`, "No comment with id 999"},
		{"set_automation_rule_enabled", `{"rule_id":"nope","enabled":true}`, `No automation rule with id "nope"`},
		{"list_segment_members", `{"segment_id":"nope"}`, `No such segment "nope"`},
		{"get_audience_member", `{"pseudo_id":"U999"}`, `No audience member with id "U999"`},
	} {
		text, isErr, e := callTool(t, ts, c.tool, c.args)
		if e != nil || !isErr || !strings.Contains(text, c.want) {
			t.Errorf("%s %s → isError=%v %q, want %q", c.tool, c.args, isErr, text, c.want)
		}
		if strings.Contains(text, "Creator OS API") || strings.Contains(text, "not found") && !strings.Contains(text, "No ") {
			t.Errorf("%s: the error leaks the internal layer: %q", c.tool, text)
		}
	}
}

// P1-7: no-ops explain themselves.
func TestMCPNoOpsSayWhy(t *testing.T) {
	ts := mcpServer(t, "", false)
	call := func(name, args string) map[string]any {
		text, isErr, e := callTool(t, ts, name, args)
		if e != nil || isErr {
			t.Fatalf("%s %s: %q %v %v", name, args, text, isErr, e)
		}
		return mustJSON(t, text)
	}
	// Message 2 is not a brief at all.
	if m := call("ignore_brief", `{"message_id":2}`); m["ignored"] != false || !strings.Contains(m["reason"].(string), "not a detected brand brief") {
		t.Errorf("ignore a non-brief: %v", m)
	}
	if m := call("convert_brief", `{"message_id":2}`); m["converted"] != false || !strings.Contains(m["reason"].(string), "not a detected brand brief") {
		t.Errorf("convert a non-brief: %v", m)
	}
	// Convert once, then again: the second says why and points at the deal.
	first := call("convert_brief", `{"message_id":1}`)
	if first["converted"] != true || first["dealId"] == nil {
		t.Fatalf("convert: %v", first)
	}
	again := call("convert_brief", `{"message_id":1}`)
	if again["converted"] != false || again["dealId"] != first["dealId"] || !strings.Contains(again["reason"].(string), "already turned into deal") {
		t.Errorf("second convert: %v", again)
	}
	if m := call("ignore_brief", `{"message_id":1}`); m["ignored"] != false || !strings.Contains(m["reason"].(string), "already turned into deal") {
		t.Errorf("ignore a converted brief: %v", m)
	}
	// Tasks: dismiss twice, complete a dismissed one.
	if m := call("dismiss_task", `{"task_id":2}`); m["dismissed"] != true {
		t.Errorf("dismiss: %v", m)
	}
	if m := call("dismiss_task", `{"task_id":2}`); m["dismissed"] != false || !strings.Contains(m["reason"].(string), "already dismissed") {
		t.Errorf("dismiss twice: %v", m)
	}
	if m := call("complete_task", `{"task_id":2,"message":"late"}`); m["done"] != false || !strings.Contains(m["reason"].(string), "already dismissed") {
		t.Errorf("complete a dismissed task: %v", m)
	}
	// Paying twice.
	call("move_deal_stage", `{"deal_id":1,"stage":"invoiced"}`)
	invoiceID := mustJSON(t, textOf(t, ts, "get_finance", `{}`))["finance"].(map[string]any)["rows"].([]any)[0].(map[string]any)["id"]
	pay := `{"invoice_id":` + itoa(int(invoiceID.(float64))) + `}`
	if m := call("mark_invoice_paid", pay); m["alreadyPaid"] != false || m["ok"] != true {
		t.Errorf("first payment: %v", m)
	}
	if m := call("mark_invoice_paid", pay); m["alreadyPaid"] != true || m["ok"] != true {
		t.Errorf("paying twice must report alreadyPaid: %v", m)
	}
}

func textOf(t *testing.T, ts *httptest.Server, name, args string) string {
	t.Helper()
	text, isErr, e := callTool(t, ts, name, args)
	if e != nil || isErr {
		t.Fatalf("%s: %q %v %v", name, text, isErr, e)
	}
	return text
}

// P1-8: what was created comes back as an id.
func TestMCPWritesReturnTheIdsTheyCreate(t *testing.T) {
	ts, exec := mcpServerDB(t, "", false)
	call := func(name, args string) map[string]any {
		return mustJSON(t, textOf(t, ts, name, args))
	}
	if m := call("convert_brief", `{"message_id":1}`); m["dealId"] == nil || m["converted"] != true {
		t.Errorf("convert_brief: %v", m)
	} else if pipe := textOf(t, ts, "get_pipeline", `{}`); !strings.Contains(pipe, `"id": `+itoa(int(m["dealId"].(float64)))) {
		t.Errorf("dealId %v is not a deal in the pipeline", m["dealId"])
	}
	m := call("reply_to_brand", `{"brand_id":1,"body":"Thanks"}`)
	if m["messageId"] == nil {
		t.Fatalf("reply_to_brand: %v", m)
	}
	if thread := textOf(t, ts, "get_inbox_thread", `{"brand_id":1}`); !strings.Contains(thread, `"id": `+itoa(int(m["messageId"].(float64)))) {
		t.Errorf("messageId %v is not in the thread", m["messageId"])
	}
	if m := call("complete_task", `{"task_id":1,"message":"final"}`); m["messageId"] == nil || m["done"] != true {
		t.Errorf("complete_task: %v", m)
	}
	// An internal task records no message, so it has no messageId.
	if m := call("complete_task", `{"task_id":2,"message":"ok"}`); m["done"] != true || m["messageId"] != nil {
		t.Errorf("internal task: %v", m)
	}
	// Comment replies say which comment and what it was before (a hidden comment comes back as replied).
	exec(`UPDATE comments SET reply_status = 'hidden' WHERE id = 1`)
	if m := call("reply_to_comment", `{"comment_id":1,"text":"about 20,000"}`); m["commentId"].(float64) != 1 || m["previousStatus"] != "hidden" || m["replyStatus"] != "replied" {
		t.Errorf("reply_to_comment: %v", m)
	}
	if desc := toolNames(t, ts)["reply_to_comment"]["description"].(string); !strings.Contains(desc, "hidden") || !strings.Contains(desc, "overwrites") {
		t.Errorf("the tool must document that replying un-hides and overwrites: %q", desc)
	}
	// Reply length is capped (and the schema says so).
	if text, isErr, _ := callTool(t, ts, "reply_to_brand", `{"brand_id":1,"body":"`+strings.Repeat("a", 5001)+`"}`); !isErr || !strings.Contains(text, "too long") {
		t.Errorf("a 5001-character reply must be refused: %q", text)
	}
	if text, isErr, _ := callTool(t, ts, "reply_to_brand", `{"brand_id":1,"body":"`+strings.Repeat("a", 5000)+`"}`); isErr {
		t.Errorf("5000 characters is the limit and must be accepted: %q", text)
	}
	if props := toolNames(t, ts)["reply_to_brand"]["inputSchema"].(map[string]any)["properties"].(map[string]any); props["body"].(map[string]any)["maxLength"].(float64) != 5000 {
		t.Errorf("schema: %v", props)
	}
	// Reply text is stored as given (the web app escapes it when it renders).
	text := `<script>alert(1)</script>`
	callTool(t, ts, "reply_to_brand", `{"brand_id":1,"body":"`+text+`"}`)
	if thread := textOf(t, ts, "get_inbox_thread", `{"brand_id":1}`); !strings.Contains(thread, `\u003cscript\u003e`) && !strings.Contains(thread, text) {
		t.Errorf("reply text missing from the thread")
	}
}

// P1-9: save_rates is strict about codes and whole baht.
func TestMCPSaveRatesIsStrict(t *testing.T) {
	ts, exec := mcpServerDB(t, "", false)
	exec(`INSERT INTO rate_card (code, name, kind, description, price, includes) VALUES ('IG_REEL','IG reel','single','',25000,'[]')`)
	price := func(code string) string {
		return regexp.MustCompile(`"code": "` + code + `"[\s\S]*?"price": (\d+)`).FindStringSubmatch(textOf(t, ts, "get_settings", `{}`))[1]
	}
	for _, c := range []struct{ args, want string }{
		{`{"prices":{"tt_video":25000}}`, "Unknown rate-card code(s): tt_video"},
		{`{"prices":{"TT_VIDEO":25000,"NOPE":1,"ALSO_NOPE":2}}`, "ALSO_NOPE, NOPE"},
		{`{"prices":{"TT_VIDEO":25000}, "extra":1}`, "Unknown argument"},
		{`{"prices":{"TT_VIDEO":1234.56}}`, "whole number of baht"},
		{`{"prices":{"TT_VIDEO":1e15}}`, "whole number of baht"},
		{`{"prices":{"TT_VIDEO":-1}}`, "whole number of baht"},
		{`{"prices":{"TT_VIDEO":"20000"}}`, "whole number of baht"},
		{`{"prices":{}}`, "prices must be an object"},
	} {
		text, isErr, e := callTool(t, ts, "save_rates", c.args)
		if e != nil || !isErr || !strings.Contains(text, c.want) {
			t.Errorf("%s → isError=%v %q, want %q", c.args, isErr, text, c.want)
		}
	}
	// The unknown-code error lists what is valid.
	if text, _, _ := callTool(t, ts, "save_rates", `{"prices":{"tt_video":1}}`); !strings.Contains(text, "valid codes: IG_REEL, TT_VIDEO") {
		t.Errorf("the error must list the valid codes: %q", text)
	}
	// One bad entry saves nothing, even if the others were fine.
	callTool(t, ts, "save_rates", `{"prices":{"TT_VIDEO":99999,"NOPE":1}}`)
	if price("TT_VIDEO") != "20000" {
		t.Errorf("a refused save must change nothing, TT_VIDEO = %s", price("TT_VIDEO"))
	}
	m := mustJSON(t, textOf(t, ts, "save_rates", `{"prices":{"TT_VIDEO":22000,"IG_REEL":25000}}`))
	up := m["updated"].([]any)
	if m["changed"].(float64) != 1 || len(up) != 1 || up[0].(map[string]any)["code"] != "TT_VIDEO" || up[0].(map[string]any)["from"].(float64) != 20000 || up[0].(map[string]any)["to"].(float64) != 22000 {
		t.Errorf("save_rates result: %v", m)
	}
}

// ── P2 ──────────────────────────────────────────────────────────────────────

// P2-11: one source for the follower count.
func TestMCPFollowerCountsAgree(t *testing.T) {
	ts := mcpServer(t, "", false)
	settings := mustJSON(t, textOf(t, ts, "get_settings", `{}`))["settings"].(map[string]any)["latestFollowers"].(map[string]any)
	audience := mustJSON(t, textOf(t, ts, "get_audience", `{}`))["latestFollowers"].(map[string]any)
	if settings["tiktok"].(float64) != 25348 || audience["tiktok"].(float64) != 25348 {
		t.Errorf("settings %v vs audience %v: both must be the newest month's 25348, not September's 25354", settings, audience)
	}
	if desc := toolNames(t, ts)["get_audience"]["description"].(string); !strings.Contains(desc, "latestFollowers") || !strings.Contains(desc, "splitMonth") {
		t.Errorf("the tool must explain demographics.followers: %q", desc)
	}
}

// P2-12: jobs and lifetime value are money earned; a never-paid brand isn't offered a repeat.
func TestMCPNeverPaidBrandHasNoJobsOrRepeatOffer(t *testing.T) {
	ts := mcpServer(t, "", false)
	textOf(t, ts, "move_deal_stage", `{"deal_id":1,"stage":"production"}`)
	b := mustJSON(t, textOf(t, ts, "get_brand", `{"brand_id":1}`))["brand"].(map[string]any)
	st := b["stats"].(map[string]any)
	if st["tier"] != "lead" || st["jobs"].(float64) != 0 || st["lifetimeValue"].(float64) != 0 || st["avgDealSize"].(float64) != 0 {
		t.Errorf("a brand with only an unpaid deal in production: %v", st)
	}
	if st["dealValueThisYear"].(float64) != 30000 {
		t.Errorf("the committed value is still visible as dealValueThisYear: %v", st["dealValueThisYear"])
	}
	if rule := b["offer"].(map[string]any)["rule"]; rule == "repeat" {
		t.Errorf("a brand that has never paid must not get the repeat offer")
	}
	// Once it is paid it is a real job.
	textOf(t, ts, "move_deal_stage", `{"deal_id":1,"stage":"paid"}`)
	st = mustJSON(t, textOf(t, ts, "get_brand", `{"brand_id":1}`))["brand"].(map[string]any)["stats"].(map[string]any)
	if st["jobs"].(float64) != 1 || st["lifetimeValue"].(float64) != 30000 || st["tier"] != "one_time" {
		t.Errorf("after paying: %v", st)
	}
}

// P2-13: reaching Production is a stage change, not "draft sent".
func TestMCPProductionMoveIsLoggedAsStageChange(t *testing.T) {
	ts := mcpServer(t, "", false)
	textOf(t, ts, "move_deal_stage", `{"deal_id":1,"stage":"production"}`)
	brand := textOf(t, ts, "get_brand", `{"brand_id":1}`)
	if !strings.Contains(brand, `"type": "stage_change"`) || strings.Contains(brand, "draft_sent") {
		t.Errorf("timeline: %s", brand)
	}
}

// P2-14: ER is null with no views, the KPI says what it is, and data freshness is reported.
func TestMCPOverviewIsHonestAboutMissingData(t *testing.T) {
	ts, exec := mcpServerDB(t, "", false)
	overview := func() map[string]any {
		return mustJSON(t, textOf(t, ts, "get_overview", `{"range":28}`))["overview"].(map[string]any)
	}
	ov := overview()
	if ov["dataAsOf"] != nil || ov["lastImportAt"] != nil {
		t.Errorf("no data and no import yet: dataAsOf=%v lastImportAt=%v", ov["dataAsOf"], ov["lastImportAt"])
	}
	kp := ov["kpis"].(map[string]any)
	if _, old := kp["followers"]; old || kp["newFollowers"] == nil {
		t.Errorf("the gained-followers KPI is newFollowers, not followers: %v", kp)
	}
	er := kp["er"].(map[string]any)
	if er["total"] != nil || er["prev"] != nil || er["byPlatform"].(map[string]any)["tiktok"] != nil {
		t.Errorf("with no views the engagement rate is null, not 0: %v", er)
	}
	if desc := toolNames(t, ts)["get_overview"]["description"].(string); !strings.Contains(desc, "newFollowers") || !strings.Contains(desc, "dataAsOf") {
		t.Errorf("description: %q", desc)
	}

	// With data: a real rate, and the freshness fields name the dates.
	exec(`INSERT INTO content_metrics_daily (content_id, date, views, likes, comments, shares, saves, new_followers) VALUES (1,'2026-10-20',1000,60,20,10,10,7)`)
	exec(`INSERT INTO import_runs (platform_id, adapter, started_at, finished_at, status) VALUES ('tiktok','csv','2026-10-21T09:00:00','2026-10-21T09:00:05','success'),('tiktok','csv','2026-10-30T09:00:00','2026-10-30T09:00:05','failed')`)
	ov = overview()
	if ov["dataAsOf"] != "2026-10-20" || ov["lastImportAt"] != "2026-10-21T09:00:05+07:00" {
		t.Errorf("dataAsOf=%v lastImportAt=%v (a failed import doesn't count)", ov["dataAsOf"], ov["lastImportAt"])
	}
	kp = ov["kpis"].(map[string]any)
	if got := kp["er"].(map[string]any)["total"].(float64); got < 0.0999 || got > 0.1001 {
		t.Errorf("ER = %v, want 0.1", got)
	}
	if kp["newFollowers"].(map[string]any)["total"].(float64) != 7 {
		t.Errorf("newFollowers = %v", kp["newFollowers"])
	}
}

// P2-15: comments are paged, rows say their status.
func TestMCPCommentsArePaged(t *testing.T) {
	ts := mcpServer(t, "", false)
	page := func(args string) map[string]any { return mustJSON(t, textOf(t, ts, "list_comments", args)) }
	p1 := page(`{"limit":1}`)
	rows := p1["rows"].([]any)
	if len(rows) != 1 || p1["total"].(float64) != 2 || p1["hasMore"] != true || p1["limit"].(float64) != 1 || p1["offset"].(float64) != 0 {
		t.Fatalf("page 1: %v", p1)
	}
	if rows[0].(map[string]any)["status"] != "open" || rows[0].(map[string]any)["id"].(float64) != 1 {
		t.Errorf("rows carry a status, product questions first: %v", rows[0])
	}
	p2 := page(`{"limit":1,"offset":1}`)
	if r := p2["rows"].([]any); len(r) != 1 || r[0].(map[string]any)["id"].(float64) != 2 || p2["hasMore"] != false {
		t.Errorf("page 2: %v", p2)
	}
	if all := page(`{}`); len(all["rows"].([]any)) != 2 || all["status"] != "open" || all["limit"].(float64) != 40 {
		t.Errorf("defaults: %v", all)
	}
	for _, bad := range []string{`{"limit":0}`, `{"limit":201}`, `{"limit":1.5}`, `{"offset":-1}`, `{"cat":"nonsense"}`} {
		if text, isErr, _ := callTool(t, ts, "list_comments", bad); !isErr {
			t.Errorf("%s must be refused: %q", bad, text)
		}
	}
	textOf(t, ts, "hide_comment", `{"comment_id":1}`)
	if h := page(`{"status":"hidden"}`); h["total"].(float64) != 1 || h["rows"].([]any)[0].(map[string]any)["status"] != "hidden" {
		t.Errorf("hidden: %v", h)
	}
	if d := toolNames(t, ts)["list_comments"]["description"].(string); !strings.Contains(d, "open") || !strings.Contains(d, "hasMore") {
		t.Errorf("description must state the defaults and paging: %q", d)
	}
}

// P2-16: the pipeline description matches the order.
func TestMCPPipelineOrderIsDescribedHonestly(t *testing.T) {
	ts, exec := mcpServerDB(t, "", false)
	exec(`INSERT INTO deals (id, brand_id, title, stage, value, deliverables, created_at, posted_at, closed_at) VALUES (2,1,'Older paid','paid',1000,'[]','2026-01-01T09:00:00','2026-01-10T09:00:00','2026-02-01T09:00:00')`)
	pipe := mustJSON(t, textOf(t, ts, "get_pipeline", `{}`))["deals"].([]any)
	if pipe[0].(map[string]any)["id"].(float64) != 1 || pipe[0].(map[string]any)["date"] != "2026-10-01T09:00:00+07:00" {
		t.Errorf("most recent activity first: %v", pipe)
	}
	d := toolNames(t, ts)["get_pipeline"]["description"].(string)
	if strings.Contains(d, "newest first") || !strings.Contains(d, "most recent activity") {
		t.Errorf("description: %q", d)
	}
}

// ── P3 ──────────────────────────────────────────────────────────────────────

// P3-18: get_today doesn't point at an action no tool can do.
func TestMCPNeedsYouTodayHasNoWebOnlyAction(t *testing.T) {
	ts := mcpServer(t, "", false)
	rest, err := httpGetJSON(ts.URL + "/api/v1/today")
	if err != nil || !strings.Contains(rest, `"kind":"run"`) {
		t.Fatalf("the web app's list should offer to run the automations (no run today): %v %s", err, rest)
	}
	text := textOf(t, ts, "get_today", `{}`)
	if strings.Contains(text, `"run"`) {
		t.Errorf("get_today must not list the web-only run action: %s", text)
	}
	if !strings.Contains(mustJSON(t, text)["today"].(string), "2026") {
		t.Errorf("the rest of the answer is kept: %s", text)
	}
}

// P3-19 / P3-20: the schema's promises are enforced.
func TestMCPSchemasMatchWhatIsAccepted(t *testing.T) {
	ts := mcpServer(t, "", false)
	tools := toolNames(t, ts)
	for name, tool := range tools {
		if tool["inputSchema"].(map[string]any)["additionalProperties"] != false {
			t.Errorf("%s: schema should say additionalProperties false", name)
		}
		if text, isErr, _ := callTool(t, ts, name, `{"definitelyNotAnArgument":1}`); !isErr || !strings.Contains(text, "Unknown argument") {
			t.Errorf("%s accepted an undeclared argument: isError=%v %q", name, isErr, text)
		}
	}
	// A tool with no arguments says so.
	if text, _, _ := callTool(t, ts, "get_context", `{"x":1}`); !strings.Contains(text, "no arguments") {
		t.Errorf("get_context: %q", text)
	}
	// Integers are integers.
	year := tools["export_income_csv"]["inputSchema"].(map[string]any)["properties"].(map[string]any)["year"].(map[string]any)
	if year["type"] != "integer" {
		t.Errorf("year: %v", year)
	}
	if text, isErr, _ := callTool(t, ts, "export_income_csv", `{"year":2026}`); isErr || !strings.Contains(text, "invoice") && !strings.Contains(text, ",") && text == "" {
		t.Errorf("an integer year must work: %q %v", text, isErr)
	}
	for _, bad := range []string{`{"year":"2026"}`, `{"year":2026.5}`, `{"year":1999}`} {
		if _, isErr, _ := callTool(t, ts, "export_income_csv", bad); !isErr {
			t.Errorf("%s must be refused", bad)
		}
	}
	followers := tools["save_profile"]["inputSchema"].(map[string]any)["properties"].(map[string]any)["followers"].(map[string]any)["properties"].(map[string]any)["tiktok"].(map[string]any)
	if followers["type"] != "integer" {
		t.Errorf("followers should be an integer in the schema: %v", followers)
	}
	name := tools["save_profile"]["inputSchema"].(map[string]any)["properties"].(map[string]any)["name"].(map[string]any)
	if name["minLength"].(float64) != 1 {
		t.Errorf("a blank name is not allowed by the schema: %v", name)
	}
}

// P3-21: timestamps carry the Bangkok offset; plain dates are untouched.
var naive = regexp.MustCompile(`"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"`)

func TestMCPTimestampsHaveAnOffset(t *testing.T) {
	ts := mcpServer(t, "", false)
	for _, c := range []struct{ tool, args string }{
		{"get_inbox_thread", `{"brand_id":1}`}, {"get_pipeline", `{}`}, {"get_automation", `{}`}, {"list_comments", `{}`}, {"get_brand", `{"brand_id":1}`}, {"get_finance", `{}`},
	} {
		text := textOf(t, ts, c.tool, c.args)
		if naive.MatchString(text) {
			t.Errorf("%s still has a timestamp with no timezone: %s", c.tool, naive.FindString(text))
		}
	}
	thread := textOf(t, ts, "get_inbox_thread", `{"brand_id":1}`)
	if !strings.Contains(thread, `"sentAt": "2026-10-30T09:00:00+07:00"`) {
		t.Errorf("sentAt should be RFC 3339 with +07:00: %s", thread)
	}
	if today := mustJSON(t, textOf(t, ts, "get_context", `{}`))["today"]; today != "2026-10-31" {
		t.Errorf("a plain date must stay a plain date: %v", today)
	}
	if !strings.Contains(mcpInstructionsOf(t, ts), "Bangkok") {
		t.Error("the instructions should say timestamps are Bangkok time")
	}
}

func mcpInstructionsOf(t *testing.T, ts *httptest.Server) string {
	t.Helper()
	_, m := rpc(t, ts, "", `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`)
	return m["result"].(map[string]any)["instructions"].(string)
}

func httpGetJSON(url string) (string, error) {
	res, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	return string(b), err
}
