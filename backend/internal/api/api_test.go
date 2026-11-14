package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"creatoros/internal/api"
	"creatoros/internal/testdb"
)

func server(t *testing.T, token string) (*httptest.Server, func(string)) {
	s := testdb.New(t)
	testdb.Exec(t, s, `INSERT INTO platforms (id, name, handle, color) VALUES ('tiktok','TikTok','@me','#000'),('instagram','Instagram','@me','#000'),('youtube','YouTube','@me','#000')`)
	testdb.Exec(t, s, `INSERT INTO brands (id, name, category, created_at) VALUES (1,'Glow','skincare','2026-01-01T09:00:00')`)
	testdb.Exec(t, s, `INSERT INTO deals (id, brand_id, title, stage, value, deliverables, created_at) VALUES (1,1,'Serum','brief',30000,'[]','2026-10-01T09:00:00')`)
	ts := httptest.NewServer((&api.Server{Store: s, Token: token}).Handler())
	t.Cleanup(ts.Close)
	return ts, func(q string) { testdb.Exec(t, s, q) }
}

func do(t *testing.T, method, url, body, token string) (int, map[string]any, string) {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var raw strings.Builder
	buf := make([]byte, 4096)
	for {
		n, e := res.Body.Read(buf)
		raw.Write(buf[:n])
		if e != nil {
			break
		}
	}
	var m map[string]any
	_ = json.Unmarshal([]byte(raw.String()), &m)
	return res.StatusCode, m, raw.String()
}

func TestAuthToken(t *testing.T) {
	ts, _ := server(t, "secret")
	if code, _, _ := do(t, "GET", ts.URL+"/api/v1/brands", "", ""); code != 401 {
		t.Errorf("no token: %d", code)
	}
	if code, _, _ := do(t, "GET", ts.URL+"/api/v1/brands", "", "wrong"); code != 401 {
		t.Errorf("wrong token: %d", code)
	}
	if code, _, _ := do(t, "GET", ts.URL+"/api/v1/brands", "", "secret"); code != 200 {
		t.Errorf("right token: %d", code)
	}
	if code, m, _ := do(t, "GET", ts.URL+"/api/v1/health", "", ""); code != 200 || m["mode"] != "demo" {
		t.Errorf("health is open: %d %v", code, m)
	}
	if code, _, _ := do(t, "POST", ts.URL+"/api/v1/deals/1/stage", `{"stage":"paid"}`, ""); code != 401 {
		t.Errorf("writes need the token too: %d", code)
	}
}

func TestEmptyListsAreArraysNotNull(t *testing.T) {
	ts, _ := server(t, "")
	for _, path := range []string{"/api/v1/overview", "/api/v1/today", "/api/v1/finance", "/api/v1/pipeline", "/api/v1/brands"} {
		code, _, raw := do(t, "GET", ts.URL+path, "", "")
		if code != 200 {
			t.Errorf("%s: %d %s", path, code, raw)
		}
		for _, bad := range []string{`"top":null`, `"series":null`, `"rows":null`, `"spikes":null`, `"deals":null`, `"expected":null`, `"actions":null`, `"byBrand":null`, `"tax":null`} {
			if strings.Contains(raw, bad) {
				t.Errorf("%s contains %s", path, bad)
			}
		}
	}
}

func TestStageAndPaymentFlow(t *testing.T) {
	ts, _ := server(t, "")
	if code, m, _ := do(t, "POST", ts.URL+"/api/v1/deals/1/stage", `{"stage":"invoiced"}`, ""); code != 200 || m["changed"] != true {
		t.Fatalf("move: %d %v", code, m)
	}
	_, f, _ := do(t, "GET", ts.URL+"/api/v1/finance", "", "")
	rows := f["finance"].(map[string]any)["rows"].([]any)
	if len(rows) != 1 {
		t.Fatalf("invoices = %d", len(rows))
	}
	id := int(rows[0].(map[string]any)["id"].(float64))
	if code, _, _ := do(t, "POST", ts.URL+"/api/v1/invoices/"+itoa(id)+"/paid", "", ""); code != 200 {
		t.Fatalf("pay: %d", code)
	}
	_, f, _ = do(t, "GET", ts.URL+"/api/v1/finance", "", "")
	if got := f["finance"].(map[string]any)["kpis"].(map[string]any)["incomeYtd"].(float64); got != 30000 {
		t.Errorf("income = %v", got)
	}
	_, p, _ := do(t, "GET", ts.URL+"/api/v1/pipeline", "", "")
	deal := p["deals"].([]any)[0].(map[string]any)
	if deal["stage"] != "paid" || deal["tier"] != "one_time" {
		t.Errorf("pipeline deal = %v", deal)
	}
}

func TestBadRequests(t *testing.T) {
	ts, _ := server(t, "")
	cases := []struct {
		method, path, body string
		want               int
	}{
		{"POST", "/api/v1/deals/1/stage", `{"stage":"bogus"}`, 400},
		{"POST", "/api/v1/deals/1/stage", `not json`, 400},
		{"POST", "/api/v1/deals/abc/stage", `{"stage":"paid"}`, 400},
		{"POST", "/api/v1/deals/999/stage", `{"stage":"paid"}`, 404},
		{"POST", "/api/v1/invoices/999/paid", ``, 404},
		{"POST", "/api/v1/brands", `{"name":""}`, 400},
		{"GET", "/api/v1/finance/export?year=abcd", ``, 400},
		{"GET", "/api/v1/nothing", ``, 404},
		{"DELETE", "/api/v1/brands", ``, 404},
	}
	for _, c := range cases {
		if code, _, raw := do(t, c.method, ts.URL+c.path, c.body, ""); code != c.want {
			t.Errorf("%s %s %q → %d (%s), want %d", c.method, c.path, c.body, code, raw, c.want)
		}
	}
	if code, m, _ := do(t, "POST", ts.URL+"/api/v1/brands", `{"name":"New Co"}`, ""); code != 201 || m["id"] == nil {
		t.Errorf("create brand: %d %v", code, m)
	}
}

func TestOverviewRangeAndExport(t *testing.T) {
	ts, _ := server(t, "")
	_, m, _ := do(t, "GET", ts.URL+"/api/v1/overview?range=90", "", "")
	if m["range"].(float64) != 90 {
		t.Errorf("range = %v", m["range"])
	}
	_, m, _ = do(t, "GET", ts.URL+"/api/v1/overview?range=13", "", "")
	if m["range"].(float64) != 28 {
		t.Errorf("unsupported ranges fall back to 28, got %v", m["range"])
	}
	res, err := http.Get(ts.URL + "/api/v1/finance/export?year=2026")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Errorf("content-type = %s", ct)
	}
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }
