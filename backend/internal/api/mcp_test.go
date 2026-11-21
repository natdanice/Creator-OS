package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"creatoros/internal/api"
	"creatoros/internal/testdb"
)

// mcpServer starts the API on a throwaway database with a little of everything in it. Write tools are on
// unless readOnly.
func mcpServer(t *testing.T, token string, readOnly bool) *httptest.Server {
	ts, _ := mcpServerDB(t, token, readOnly)
	return ts
}

// mcpServerDB is mcpServer plus a way to add more rows to its database.
func mcpServerDB(t *testing.T, token string, readOnly bool) (*httptest.Server, func(string, ...any)) {
	t.Helper()
	s := testdb.New(t)
	testdb.Exec(t, s, `INSERT INTO platforms (id, name, handle, color) VALUES ('tiktok','TikTok','@me','#000'),('instagram','Instagram','@me','#000'),('youtube','YouTube','@me','#000')`)
	testdb.Exec(t, s, `INSERT INTO brands (id, name, category, created_at) VALUES (1,'Glow','skincare','2026-01-01T09:00:00')`)
	testdb.Exec(t, s, `INSERT INTO deals (id, brand_id, title, stage, value, deliverables, created_at) VALUES (1,1,'Serum','brief',30000,'[]','2026-10-01T09:00:00')`)
	testdb.Exec(t, s, `INSERT INTO rate_card (code, name, kind, description, price, includes) VALUES ('TT_VIDEO','TikTok video','single','',20000,'[]')`)
	testdb.Exec(t, s, `INSERT INTO brand_contacts (brand_id, name, role, channel, handle, is_primary) VALUES (1,'Mint','PR','email','mint@glow.co',1)`)
	testdb.Exec(t, s, `INSERT INTO messages (id, brand_id, direction, channel, body, sent_at, brief, brief_status) VALUES
		(1,1,'in','email','budget 40k for TikTok','2026-10-30T09:00:00','{"budget":40000,"platforms":["tiktok"],"timing":null,"product":"Serum X"}','new'),
		(2,1,'in','email','thanks','2026-10-30T10:00:00',NULL,'none')`)
	testdb.Exec(t, s, `INSERT INTO pseudonyms (pseudo_id, handle_hash, first_seen_at) VALUES ('U1','h1','2026-10-01T00:00:00')`)
	testdb.Exec(t, s, `INSERT INTO contents (id, platform_id, external_id, title, type, posted_at, product_category, is_sponsored) VALUES (1,'tiktok','x1','Clip','video','2026-10-20T10:00:00','tech',0)`)
	testdb.Exec(t, s, `INSERT INTO comments (id, platform_id, content_id, author_pseudo_id, text, category, classifier, created_at) VALUES (1,'tiktok',1,'U1','how much?','product_question','t','2026-10-30T10:00:00'),(2,'tiktok',1,'U1','where to buy?','general_question','t','2026-10-30T11:00:00')`)
	testdb.Exec(t, s, `INSERT INTO automation_rules (id, name, trigger, channel, schedule, enabled) VALUES ('post_plus_7','+7 report','x','email','daily',1),('pq_spike','spike','x','internal','daily',1)`)
	testdb.Exec(t, s, `INSERT INTO tasks (id, rule_id, dedupe_key, title, reason, draft_message, channel, brand_id, deal_id, status, for_date, created_at) VALUES
		(1,'post_plus_7','k1','Report','why','draft','email',1,1,'open','2026-10-31','2026-10-31T10:00:00'),
		(2,'pq_spike','k2','Spike','why','draft','internal',NULL,NULL,'open','2026-10-31','2026-10-31T10:00:00')`)
	testdb.Exec(t, s, `INSERT INTO audience_snapshots (platform_id, month, followers) VALUES ('tiktok','2026-09',25354),('tiktok','2026-10',25348)`)
	ts := httptest.NewServer((&api.Server{Store: s, Token: token, MCPReadOnly: readOnly}).Handler())
	t.Cleanup(ts.Close)
	return ts, func(q string, args ...any) { testdb.Exec(t, s, q, args...) }
}

// rpc posts one JSON-RPC message and returns the HTTP status and the decoded reply.
func rpc(t *testing.T, ts *httptest.Server, token, msg string, hdr ...string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("POST", ts.URL+"/mcp", strings.NewReader(msg))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	return res.StatusCode, m
}

func toolNames(t *testing.T, ts *httptest.Server) map[string]map[string]any {
	t.Helper()
	code, m := rpc(t, ts, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if code != 200 {
		t.Fatalf("tools/list: %d", code)
	}
	out := map[string]map[string]any{}
	for _, x := range m["result"].(map[string]any)["tools"].([]any) {
		tool := x.(map[string]any)
		out[tool["name"].(string)] = tool
	}
	return out
}

func callTool(t *testing.T, ts *httptest.Server, name, args string) (text string, isErr bool, rpcErr any) {
	t.Helper()
	_, m := rpc(t, ts, "", `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"`+name+`","arguments":`+args+`}}`)
	if e, ok := m["error"]; ok {
		return "", false, e
	}
	r := m["result"].(map[string]any)
	return r["content"].([]any)[0].(map[string]any)["text"].(string), r["isError"] == true, nil
}

func TestMCPInitializeAndList(t *testing.T) {
	ts := mcpServer(t, "", false)
	code, m := rpc(t, ts, "", `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}`)
	res := m["result"].(map[string]any)
	if code != 200 || res["protocolVersion"] != "2025-03-26" || res["serverInfo"].(map[string]any)["name"] != "creator-os" {
		t.Fatalf("initialize: %d %v", code, m)
	}
	// An unknown version gets the server's latest.
	_, m = rpc(t, ts, "", `{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}`)
	if m["result"].(map[string]any)["protocolVersion"] != "2025-06-18" {
		t.Errorf("unknown version: %v", m)
	}
	if _, m = rpc(t, ts, "", `{"jsonrpc":"2.0","id":3,"method":"ping"}`); m["result"] == nil {
		t.Errorf("ping: %v", m)
	}
	if code, m = rpc(t, ts, "", `{"jsonrpc":"2.0","id":4,"method":"nope"}`); m["error"].(map[string]any)["code"].(float64) != -32601 {
		t.Errorf("unknown method: %v", m)
	}
	// A notification gets no body.
	if code, _ = rpc(t, ts, "", `{"jsonrpc":"2.0","method":"notifications/initialized"}`); code != 202 {
		t.Errorf("notification: %d", code)
	}
}

func TestMCPWriteToolsAreOnByDefaultAndCanBeHidden(t *testing.T) {
	all := toolNames(t, mcpServer(t, "", false))
	ro := toolNames(t, mcpServer(t, "", true))
	if len(all) != 32 || len(ro) != 17 {
		t.Fatalf("tools: default %d (want 32 = 17 read + 15 write), MCP_READ_ONLY %d (want 17)", len(all), len(ro))
	}
	writes := 0
	for name, tool := range all {
		ann := tool["annotations"].(map[string]any)
		if ann["readOnlyHint"] == true {
			if ro[name] == nil {
				t.Errorf("read tool %s missing in read-only mode", name)
			}
			continue
		}
		writes++
		if ro[name] != nil {
			t.Errorf("write tool %s must be hidden in read-only mode", name)
		}
		if _, ok := ann["destructiveHint"]; !ok || ann["idempotentHint"] == nil {
			t.Errorf("%s: write tools must say whether they are destructive and idempotent: %v", name, ann)
		}
		if tool["description"] == "" || tool["inputSchema"].(map[string]any)["type"] != "object" {
			t.Errorf("%s: missing description or schema", name)
		}
	}
	if writes != 15 {
		t.Errorf("write tools = %d, want 15", writes)
	}
	// Only additive tools may claim to be non-destructive.
	for _, n := range []string{"create_brand", "reply_to_brand", "convert_brief", "mark_thread_read"} {
		if all[n]["annotations"].(map[string]any)["destructiveHint"] != false {
			t.Errorf("%s only adds records", n)
		}
	}
	// Repeating a task approval changes nothing more (the task is no longer open), so it is idempotent; it still edits
	// the task and the deal, so it is not "additive".
	if ann := all["complete_task"]["annotations"].(map[string]any); ann["idempotentHint"] != true || ann["destructiveHint"] != true {
		t.Errorf("complete_task annotations: %v", ann)
	}
	for _, n := range []string{"reset_automation", "save_rates", "save_profile", "move_deal_stage", "dismiss_task", "hide_comment", "complete_task", "reply_to_comment", "ignore_brief"} {
		if all[n]["annotations"].(map[string]any)["destructiveHint"] != true {
			t.Errorf("%s changes or removes existing data: it must be flagged destructive", n)
		}
	}
	// Writes must tell the AI that nothing is sent.
	for _, n := range []string{"reply_to_brand", "reply_to_comment", "complete_task"} {
		if d := all[n]["description"].(string); !strings.Contains(d, "RECORD") && !strings.Contains(d, "Nothing is sent") {
			t.Errorf("%s must say it does not send anything: %q", n, d)
		}
	}
}

func TestMCPCallsRunTheRealEndpoints(t *testing.T) {
	ts := mcpServer(t, "", false)
	if text, isErr, e := callTool(t, ts, "get_context", `{}`); e != nil || isErr || !strings.Contains(text, `"mode": "demo"`) {
		t.Errorf("get_context: %q %v %v", text, isErr, e)
	}
	if text, isErr, _ := callTool(t, ts, "get_brand", `{"brand_id":1}`); isErr || !strings.Contains(text, "Glow") {
		t.Errorf("get_brand: %q %v", text, isErr)
	}
	if text, isErr, _ := callTool(t, ts, "list_brands", `{"q":"glow","tier":"lead"}`); isErr || !strings.Contains(text, "Glow") {
		t.Errorf("list_brands: %q %v", text, isErr)
	}
	if text, isErr, _ := callTool(t, ts, "get_overview", `{"range":7}`); isErr || !strings.Contains(text, `"range": 7`) {
		t.Errorf("get_overview: %q %v", text, isErr)
	}
	if text, isErr, _ := callTool(t, ts, "get_pipeline", `{}`); isErr || !strings.Contains(text, "Serum") {
		t.Errorf("get_pipeline: %q %v", text, isErr)
	}
}

func TestMCPBadArgumentsAreToolErrors(t *testing.T) {
	ts := mcpServer(t, "", false)
	for _, c := range []struct{ tool, args string }{
		{"get_brand", `{}`},
		{"get_brand", `{"brand_id":"1"}`},
		{"get_brand", `{"brand_id":1.5}`},
		{"get_brand", `{"brand_id":999}`}, // valid shape, no such brand: the API's 404
		{"get_overview", `{"range":13}`},
		{"list_brands", `{"tier":"gold"}`},
		{"export_income_csv", `{"year":"26"}`},
		{"list_segment_members", `{"segment_id":"superfans","limit":0}`},
		{"move_deal_stage", `{"deal_id":1,"stage":"bogus"}`},
		{"move_deal_stage", `{"deal_id":1}`},
		{"create_brand", `{"name":"  "}`},
		{"reply_to_brand", `{"brand_id":1,"body":"  "}`},
		{"reply_to_brand", `{"brand_id":999,"body":"hi"}`},
		{"set_automation_rule_enabled", `{"rule_id":"pq_spike"}`},
		{"set_automation_rule_enabled", `{"rule_id":"nope","enabled":true}`},
		{"complete_task", `{"task_id":1}`},
		{"reset_automation", `{}`},
		{"reset_automation", `{"confirm":false}`},
		{"save_rates", `{"prices":{}}`},
		{"save_rates", `{"prices":{"TT_VIDEO":-5}}`},
		{"save_profile", `{}`},
		{"save_profile", `{"handles":{"myspace":"@x"}}`},
		{"save_profile", `{"followers":{"tiktok":"lots"}}`},
		{"convert_brief", `{"message_id":1,"value":-1}`},
	} {
		text, isErr, e := callTool(t, ts, c.tool, c.args)
		if e != nil || !isErr || text == "" {
			t.Errorf("%s %s → isError=%v rpcErr=%v text=%q", c.tool, c.args, isErr, e, text)
		}
	}
	if _, _, e := callTool(t, ts, "no_such_tool", `{}`); e == nil {
		t.Error("unknown tool should be a protocol error")
	}
}

func TestMCPReadOnlyModeBlocksWrites(t *testing.T) {
	ro := mcpServer(t, "", true)
	if _, _, e := callTool(t, ro, "move_deal_stage", `{"deal_id":1,"stage":"quotation"}`); e == nil {
		t.Fatal("write tool must not run when MCP_READ_ONLY is on")
	}
	if text, _, _ := callTool(t, ro, "get_pipeline", `{}`); !strings.Contains(text, `"stage": "brief"`) {
		t.Errorf("deal must be untouched: %s", text)
	}
}

func TestMCPDealAndBrandWrites(t *testing.T) {
	on := mcpServer(t, "", false)
	if text, isErr, e := callTool(t, on, "move_deal_stage", `{"deal_id":1,"stage":"quotation"}`); e != nil || isErr || !strings.Contains(text, `"changed": true`) {
		t.Fatalf("move: %q %v %v", text, isErr, e)
	}
	if text, _, _ := callTool(t, on, "get_pipeline", `{}`); !strings.Contains(text, `"stage": "quotation"`) {
		t.Errorf("stage did not change: %s", text)
	}
	if text, isErr, _ := callTool(t, on, "create_brand", `{"name":"New Co","category":"tech"}`); isErr || !strings.Contains(text, `"id"`) {
		t.Errorf("create_brand: %q %v", text, isErr)
	}
	if text, _, _ := callTool(t, on, "list_brands", `{"q":"New Co"}`); !strings.Contains(text, "New Co") {
		t.Errorf("brand not created: %s", text)
	}
	callTool(t, on, "move_deal_stage", `{"deal_id":1,"stage":"invoiced"}`)
	_, m := rpc(t, on, "", `{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"get_finance","arguments":{}}}`)
	_ = m
	text, _, _ := callTool(t, on, "get_finance", `{}`)
	var f struct {
		Finance struct {
			Rows []struct {
				ID int `json:"id"`
			} `json:"rows"`
		} `json:"finance"`
	}
	_ = json.Unmarshal([]byte(text), &f)
	if len(f.Finance.Rows) != 1 {
		t.Fatalf("invoice not created: %s", text)
	}
	if text, isErr, _ := callTool(t, on, "mark_invoice_paid", `{"invoice_id":`+itoa(f.Finance.Rows[0].ID)+`}`); isErr || !strings.Contains(text, `"ok": true`) {
		t.Errorf("mark_invoice_paid: %q %v", text, isErr)
	}
}

func TestMCPInboxWrites(t *testing.T) {
	ts := mcpServer(t, "", false)
	if text, isErr, _ := callTool(t, ts, "reply_to_brand", `{"brand_id":1,"body":"Thanks, sending a quote"}`); isErr || !strings.Contains(text, `"ok": true`) {
		t.Fatalf("reply_to_brand: %q %v", text, isErr)
	}
	if text, _, _ := callTool(t, ts, "get_inbox_thread", `{"brand_id":1}`); !strings.Contains(text, "Thanks, sending a quote") {
		t.Errorf("reply not in the thread: %s", text)
	}
	if text, isErr, _ := callTool(t, ts, "mark_thread_read", `{"brand_id":1}`); isErr || !strings.Contains(text, `"changed": 2`) {
		t.Errorf("mark_thread_read: %q", text)
	}
	if text, isErr, _ := callTool(t, ts, "convert_brief", `{"message_id":1}`); isErr || !strings.Contains(text, `"converted": true`) {
		t.Fatalf("convert_brief: %q %v", text, isErr)
	}
	if text, _, _ := callTool(t, ts, "get_pipeline", `{}`); !strings.Contains(text, "Serum X") || !strings.Contains(text, "40000") {
		t.Errorf("deal from brief missing: %s", text)
	}
	if text, isErr, _ := callTool(t, ts, "ignore_brief", `{"message_id":1}`); isErr {
		t.Errorf("ignore_brief: %q", text)
	}
	if text, isErr, _ := callTool(t, ts, "reply_to_comment", `{"comment_id":1,"text":"about 20,000"}`); isErr || !strings.Contains(text, `"ok": true`) {
		t.Errorf("reply_to_comment: %q %v", text, isErr)
	}
	if text, _, _ := callTool(t, ts, "list_comments", `{"status":"replied"}`); !strings.Contains(text, "about 20,000") {
		t.Errorf("comment reply not stored: %s", text)
	}
	if text, isErr, _ := callTool(t, ts, "hide_comment", `{"comment_id":2}`); isErr {
		t.Errorf("hide_comment: %q", text)
	}
	if text, _, _ := callTool(t, ts, "list_comments", `{"status":"hidden"}`); !strings.Contains(text, "where to buy?") {
		t.Errorf("hidden comment: %s", text)
	}
}

func TestMCPAutomationWrites(t *testing.T) {
	ts := mcpServer(t, "", false)
	if text, isErr, _ := callTool(t, ts, "set_automation_rule_enabled", `{"rule_id":"pq_spike","enabled":false}`); isErr {
		t.Fatalf("set rule: %q", text)
	}
	if text, _, _ := callTool(t, ts, "get_automation", `{}`); !strings.Contains(text, `"enabled": false`) {
		t.Errorf("rule not switched off: %s", text)
	}
	if text, isErr, _ := callTool(t, ts, "complete_task", `{"task_id":1,"message":"final text"}`); isErr || !strings.Contains(text, `"done": true`) {
		t.Errorf("complete_task: %q %v", text, isErr)
	}
	if text, isErr, _ := callTool(t, ts, "dismiss_task", `{"task_id":2}`); isErr {
		t.Errorf("dismiss_task: %q", text)
	}
	if text, _, _ := callTool(t, ts, "get_automation", `{}`); strings.Contains(text, `"title": "Spike"`) && strings.Contains(text, `"status": "open"`) {
		t.Errorf("dismissed task is still open: %s", text)
	}
	// The destructive reset runs only with an explicit confirm=true.
	if _, isErr, _ := callTool(t, ts, "reset_automation", `{"confirm":false}`); !isErr {
		t.Error("reset without confirm must fail")
	}
	if text, isErr, _ := callTool(t, ts, "reset_automation", `{"confirm":true}`); isErr || !strings.Contains(text, `"ok": true`) {
		t.Errorf("reset_automation: %q %v", text, isErr)
	}
	if text, _, _ := callTool(t, ts, "get_automation", `{}`); strings.Contains(text, `"Report"`) {
		t.Errorf("tasks should be gone: %s", text)
	}
}

func TestMCPSettingsWrites(t *testing.T) {
	ts := mcpServer(t, "", false)
	if text, isErr, _ := callTool(t, ts, "save_rates", `{"prices":{"TT_VIDEO":25000}}`); isErr || !strings.Contains(text, `"changed": 1`) {
		t.Fatalf("save_rates: %q %v", text, isErr)
	}
	if text, _, _ := callTool(t, ts, "get_settings", `{}`); !strings.Contains(text, `"price": 25000`) {
		t.Errorf("price not saved: %s", text)
	}

	// A partial profile update keeps everything it doesn't mention.
	if _, isErr, _ := callTool(t, ts, "save_profile", `{"name":"Mint Creator","tagline":"cats and tech","handles":{"tiktok":"@mint","instagram":"@mint.ig"}}`); isErr {
		t.Fatal("first save_profile failed")
	}
	if text, isErr, _ := callTool(t, ts, "save_profile", `{"handles":{"tiktok":"@mint2"}}`); isErr || !strings.Contains(text, `"ok": true`) {
		t.Fatalf("partial save_profile: %q %v", text, isErr)
	}
	text, _, _ := callTool(t, ts, "get_settings", `{}`)
	var got struct {
		Settings struct {
			Profile struct {
				Name    string            `json:"name"`
				Tagline string            `json:"tagline"`
				Handles map[string]string `json:"handles"`
			} `json:"profile"`
		} `json:"settings"`
	}
	if err := json.Unmarshal([]byte(text), &got); err != nil {
		t.Fatal(err)
	}
	p := got.Settings.Profile
	if p.Name != "Mint Creator" || p.Tagline != "cats and tech" || p.Handles["tiktok"] != "@mint2" || p.Handles["instagram"] != "@mint.ig" {
		t.Errorf("partial update lost data: %+v", p)
	}
	if _, isErr, _ := callTool(t, ts, "save_profile", `{"followers":{"tiktok":12500}}`); isErr {
		t.Error("a numeric follower count should be accepted")
	}
}

func TestMCPAuthAndBrowserGuards(t *testing.T) {
	ts := mcpServer(t, "secret", true)
	list := `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
	if code, _ := rpc(t, ts, "", list); code != 401 {
		t.Errorf("no token: %d", code)
	}
	if code, _ := rpc(t, ts, "wrong", list); code != 401 {
		t.Errorf("wrong token: %d", code)
	}
	if code, m := rpc(t, ts, "secret", list); code != 200 || m["result"] == nil {
		t.Errorf("right token: %d %v", code, m)
	}
	// Even with the token, a page on another origin must be refused, and the body must be JSON.
	if code, _ := rpc(t, ts, "secret", list, "Origin", "https://evil.example"); code != 403 {
		t.Errorf("foreign origin: %d", code)
	}
	if code, _ := rpc(t, ts, "secret", list, "Origin", ts.URL); code != 200 {
		t.Errorf("same origin: %d", code)
	}
	if code, _ := rpc(t, ts, "secret", list, "Content-Type", "text/plain"); code != 415 {
		t.Errorf("non-JSON content type: %d", code)
	}
	res, err := http.Get(ts.URL + "/mcp")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Errorf("GET /mcp without token: %d", res.StatusCode)
	}
	req, _ := http.NewRequest("GET", ts.URL+"/mcp", nil)
	req.Header.Set("Authorization", "Bearer secret")
	res, _ = http.DefaultClient.Do(req)
	res.Body.Close()
	if res.StatusCode != 405 {
		t.Errorf("GET /mcp: %d", res.StatusCode)
	}
}

func TestMCPBatchRequestsAreRejected(t *testing.T) {
	ts := mcpServer(t, "", false)
	res, err := http.Post(ts.URL+"/mcp", "application/json", strings.NewReader(`[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"ping"}]`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode != 400 || out["error"].(map[string]any)["code"].(float64) != -32600 || !strings.Contains(out["error"].(map[string]any)["message"].(string), "one JSON-RPC message per request") {
		t.Errorf("batching was removed from MCP in 2025-06-18: %d %v", res.StatusCode, out)
	}
	// A single message still works.
	if code, m := rpc(t, ts, "", `{"jsonrpc":"2.0","id":1,"method":"ping"}`); code != 200 || m["result"] == nil {
		t.Errorf("ping: %d %v", code, m)
	}
}
