package api_test

import (
	"strings"
	"testing"
)

func inboxServer(t *testing.T) (string, func(string)) {
	ts, exec := server(t, "")
	exec(`INSERT INTO rate_card (code, name, kind, description, price, includes) VALUES ('TT_VIDEO','TikTok video','single','',20000,'[]'),('IG_REEL','IG reel','single','',25000,'[]')`)
	exec(`INSERT INTO brand_contacts (brand_id, name, role, channel, handle, is_primary) VALUES (1,'Mint','PR','email','mint@glow.co',1)`)
	exec(`INSERT INTO messages (id, brand_id, direction, channel, body, sent_at, brief, brief_status) VALUES
		(1,1,'in','email','งบ 40k ทำ TikTok','2026-10-30T09:00:00','{"budget":40000,"platforms":["tiktok"],"timing":null,"product":"Serum X"}','new'),
		(2,1,'in','email','ขอบคุณ','2026-10-30T10:00:00',NULL,'none')`)
	return ts.URL, exec
}

func TestInboxThreadAndBadges(t *testing.T) {
	url, _ := inboxServer(t)
	_, m, raw := do(t, "GET", url+"/api/v1/inbox", "", "")
	c := m["counts"].(map[string]any)
	if c["unread"].(float64) != 2 || c["briefs"].(float64) != 1 {
		t.Fatalf("badges: %s", raw)
	}
	_, _, raw = do(t, "GET", url+"/api/v1/inbox/threads/1", "", "")
	for _, want := range []string{`"listPrice":20000`, `"name":"TikTok video"`, `"channel":"email"`} {
		if !strings.Contains(raw, want) {
			t.Errorf("thread missing %s: %s", want, raw)
		}
	}
}

func TestReplyAndMarkRead(t *testing.T) {
	url, _ := inboxServer(t)
	if code, _, _ := do(t, "POST", url+"/api/v1/inbox/threads/1/reply", `{"body":"   "}`, ""); code != 400 {
		t.Errorf("empty reply must be rejected: %d", code)
	}
	if code, _, _ := do(t, "POST", url+"/api/v1/inbox/threads/99/reply", `{"body":"hi"}`, ""); code != 404 {
		t.Errorf("unknown brand: %d", code)
	}
	if code, _, raw := do(t, "POST", url+"/api/v1/inbox/threads/1/reply", `{"body":"สวัสดีค่ะ"}`, ""); code != 200 {
		t.Fatalf("reply: %d %s", code, raw)
	}
	// A reply goes in the contact's channel at today's 10:00; the next one a minute after it.
	_, _, raw := do(t, "GET", url+"/api/v1/inbox/threads/1", "", "")
	if !strings.Contains(raw, `"body":"สวัสดีค่ะ"`) || !strings.Contains(raw, `"sentAt":"2026-10-31T10:00:00"`) || !strings.Contains(raw, `"channel":"email"`) {
		t.Errorf("first reply: %s", raw)
	}
	do(t, "POST", url+"/api/v1/inbox/threads/1/reply", `{"body":"ต่อค่ะ"}`, "")
	if _, _, raw = do(t, "GET", url+"/api/v1/inbox/threads/1", "", ""); !strings.Contains(raw, `"sentAt":"2026-10-31T10:01:00"`) {
		t.Errorf("second reply should be one minute later: %s", raw)
	}

	_, m, _ := do(t, "POST", url+"/api/v1/inbox/threads/1/read", "", "")
	if m["changed"].(float64) != 2 {
		t.Errorf("mark read: %v", m)
	}
	_, m, _ = do(t, "POST", url+"/api/v1/inbox/threads/1/read", "", "")
	if m["changed"].(float64) != 0 {
		t.Errorf("second mark read should change nothing: %v", m)
	}
}

func TestConvertBriefOnce(t *testing.T) {
	url, _ := inboxServer(t)
	_, m, raw := do(t, "POST", url+"/api/v1/messages/1/convert", `{"title":"","value":0}`, "")
	if m["converted"] != true {
		t.Fatalf("convert: %s", raw)
	}
	_, m, _ = do(t, "POST", url+"/api/v1/messages/1/convert", `{"title":"again","value":1}`, "")
	if m["converted"] != false {
		t.Errorf("a brief converts only once: %v", m)
	}
	// Title falls back to the product, value to the brief's budget.
	_, _, raw = do(t, "GET", url+"/api/v1/pipeline", "", "")
	if !strings.Contains(raw, `"title":"Serum X"`) || !strings.Contains(raw, `"value":40000`) {
		t.Errorf("deal not created from the brief: %s", raw)
	}
	_, _, raw = do(t, "GET", url+"/api/v1/inbox/threads/1", "", "")
	if !strings.Contains(raw, `"briefStatus":"converted"`) || !strings.Contains(raw, `"dealTitle":"Serum X"`) {
		t.Errorf("message not linked to the deal: %s", raw)
	}
}

func TestIgnoreBriefAndComments(t *testing.T) {
	url, exec := inboxServer(t)
	exec(`INSERT INTO pseudonyms (pseudo_id, handle_hash, first_seen_at) VALUES ('U1','h1','2026-10-01T00:00:00')`)
	exec(`INSERT INTO contents (id, platform_id, external_id, title, type, posted_at, product_category, is_sponsored) VALUES (1,'tiktok','x1','Clip','video','2026-10-20T10:00:00','tech',0)`)
	exec(`INSERT INTO comments (id, platform_id, content_id, author_pseudo_id, text, category, classifier, created_at) VALUES (1,'tiktok',1,'U1','ราคาเท่าไหร่','product_question','t','2026-10-30T10:00:00')`)
	do(t, "POST", url+"/api/v1/messages/1/ignore", "", "")
	if _, _, raw := do(t, "GET", url+"/api/v1/inbox/threads/1", "", ""); !strings.Contains(raw, `"briefStatus":"ignored"`) {
		t.Errorf("ignore: %s", raw)
	}
	_, m, _ := do(t, "GET", url+"/api/v1/inbox/comments", "", "")
	if m["total"].(float64) != 1 {
		t.Fatalf("queue: %v", m)
	}
	if code, _, _ := do(t, "POST", url+"/api/v1/comments/1/reply", `{"text":" ขอบคุณค่ะ "}`, ""); code != 200 {
		t.Fatalf("reply comment: %d", code)
	}
	if _, m, _ = do(t, "GET", url+"/api/v1/inbox/comments", "", ""); m["total"].(float64) != 0 {
		t.Errorf("replied comment should leave the open queue: %v", m)
	}
	if _, _, raw := do(t, "GET", url+"/api/v1/inbox/comments?status=replied", "", ""); !strings.Contains(raw, `"replyText":"ขอบคุณค่ะ"`) {
		t.Errorf("reply text not trimmed/stored: %s", raw)
	}
	if code, _, _ := do(t, "POST", url+"/api/v1/comments/404/hide", "", ""); code != 404 {
		t.Errorf("hiding an unknown comment: %d", code)
	}
}

func TestAutomationTaskFlow(t *testing.T) {
	url, exec := inboxServer(t)
	exec(`INSERT INTO automation_rules (id, name, trigger, channel, schedule, enabled) VALUES ('post_plus_7','+7 report','x','email','daily',1),('pq_spike','spike','x','internal','daily',1)`)
	exec(`UPDATE deals SET stage = 'posted' WHERE id = 1`)
	exec(`INSERT INTO tasks (id, rule_id, dedupe_key, title, reason, draft_message, channel, brand_id, deal_id, status, for_date, created_at) VALUES
		(1,'post_plus_7','k1','Report','why','draft','email',1,1,'open','2026-10-31','2026-10-31T10:00:00'),
		(2,'pq_spike','k2','Spike','why','draft','internal',NULL,NULL,'open','2026-10-31','2026-10-31T10:00:00')`)

	_, m, raw := do(t, "GET", url+"/api/v1/automation", "", "")
	if len(m["open"].([]any)) != 2 || len(m["rules"].([]any)) != 2 {
		t.Fatalf("overview: %s", raw)
	}
	if _, m, _ = do(t, "POST", url+"/api/v1/tasks/1/complete", `{"message":"final text"}`, ""); m["done"] != true || m["channel"] != "email" {
		t.Fatalf("complete: %v", m)
	}
	// Approving twice does nothing the second time.
	if _, m, _ = do(t, "POST", url+"/api/v1/tasks/1/complete", `{"message":"again"}`, ""); m["done"] != false {
		t.Errorf("second complete: %v", m)
	}
	// The +7 report moves the Posted deal on, and the message lands in the brand's thread.
	if _, _, raw = do(t, "GET", url+"/api/v1/pipeline", "", ""); !strings.Contains(raw, `"stage":"report_sent"`) {
		t.Errorf("deal did not move to report_sent: %s", raw)
	}
	if _, _, raw = do(t, "GET", url+"/api/v1/inbox/threads/1", "", ""); !strings.Contains(raw, `"body":"final text"`) || !strings.Contains(raw, `"taskId":1`) {
		t.Errorf("message not in thread: %s", raw)
	}
	// An internal task logs no message.
	do(t, "POST", url+"/api/v1/tasks/2/complete", `{"message":"ok"}`, "")
	do(t, "POST", url+"/api/v1/automation/rules/pq_spike/enabled", `{"enabled":false}`, "")
	if _, m, _ = do(t, "GET", url+"/api/v1/automation", "", ""); m["rules"].([]any)[1].(map[string]any)["enabled"] != false || len(m["done"].([]any)) != 2 {
		t.Errorf("after: %v", m)
	}
	if code, _, _ := do(t, "POST", url+"/api/v1/automation/rules/nope/enabled", `{"enabled":true}`, ""); code != 404 {
		t.Errorf("unknown rule: %d", code)
	}
	if code, _, _ := do(t, "POST", url+"/api/v1/automation/rules/pq_spike/enabled", `{}`, ""); code != 400 {
		t.Errorf("missing flag: %d", code)
	}
	do(t, "POST", url+"/api/v1/automation/reset", "", "")
	if _, m, _ = do(t, "GET", url+"/api/v1/automation", "", ""); len(m["done"].([]any)) != 0 {
		t.Errorf("reset: %v", m)
	}
}

func TestSettingsSaves(t *testing.T) {
	url, exec := inboxServer(t)
	exec(`INSERT INTO audience_snapshots (platform_id, month, followers) VALUES ('tiktok','2026-09',1000),('tiktok','2026-10',1200)`)
	read := func() map[string]any {
		_, m, _ := do(t, "GET", url+"/api/v1/settings", "", "")
		return m["settings"].(map[string]any)
	}
	if p := read()["profile"].(map[string]any); p["name"] != "Creator" {
		t.Errorf("default name: %v", p)
	}
	body := `{"name":" Nat ","tagline":"hi","handles":{"tiktok":"@nat","instagram":"","youtube":"Nat TV"},"followers":{"tiktok":"12,500","instagram":"","youtube":"300"}}`
	if code, _, raw := do(t, "PUT", url+"/api/v1/settings/profile", body, ""); code != 200 {
		t.Fatalf("save profile: %d %s", code, raw)
	}
	s := read()
	p := s["profile"].(map[string]any)
	h := p["handles"].(map[string]any)
	if p["name"] != "Nat" || h["tiktok"] != "@nat" || h["instagram"] != "" || h["youtube"] != "Nat TV" {
		t.Errorf("profile not saved: %v", p)
	}
	// 12,500 lands on the latest TikTok month; YouTube had no snapshot, so this month's gets created.
	f := s["latestFollowers"].(map[string]any)
	if f["tiktok"].(float64) != 12500 || f["youtube"].(float64) != 300 {
		t.Errorf("followers: %v", f)
	}
	if _, ok := f["instagram"]; ok {
		t.Errorf("empty follower input must not create a snapshot: %v", f)
	}
	// Prices: unknown codes, negatives and unchanged prices are ignored; decimals round.
	_, m, _ := do(t, "PUT", url+"/api/v1/settings/rates", `{"prices":{"TT_VIDEO":21000.4,"IG_REEL":25000,"NOPE":5,"BAD":-1}}`, "")
	if m["changed"].(float64) != 1 {
		t.Errorf("changed: %v", m)
	}
	_, _, raw := do(t, "GET", url+"/api/v1/settings", "", "")
	if !strings.Contains(raw, `"code":"TT_VIDEO"`) || !strings.Contains(raw, `"price":21000`) {
		t.Errorf("price not saved: %s", raw)
	}
	if code, _, _ := do(t, "PUT", url+"/api/v1/settings/rates", `{"prices":{"TT_VIDEO":-5}}`, ""); code != 200 {
		t.Errorf("negative price is ignored, not an error: %d", code)
	}
	if _, _, raw = do(t, "GET", url+"/api/v1/settings", "", ""); !strings.Contains(raw, `"price":21000`) {
		t.Errorf("negative price must not be saved: %s", raw)
	}
}
