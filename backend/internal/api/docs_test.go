package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"creatoros/internal/testdb"
)

// Every route must be described on the front page, and the page must not describe routes that don't exist.
func TestEveryRouteIsDocumented(t *testing.T) {
	s := &Server{Store: testdb.New(t)}
	s.Handler()
	registered := map[string]bool{}
	for _, r := range s.routes {
		if r == "GET /{$}" {
			continue
		}
		registered[r] = true
		if _, ok := docs[r]; !ok {
			t.Errorf("route %q has no entry in docs.go", r)
		}
	}
	for r := range docs {
		if !registered[r] {
			t.Errorf("docs.go describes %q but no such route is registered", r)
		}
	}
}

func TestFrontPage(t *testing.T) {
	s := &Server{Store: testdb.New(t), Token: "secret"}
	h := s.Handler()

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	body := rec.Body.String()
	if rec.Code != 200 || !strings.Contains(body, "Creator OS API") || strings.Contains(body, "/*DATA*/null") {
		t.Fatalf("front page: %d, data not injected", rec.Code)
	}
	if !strings.Contains(body, `"tokenRequired":true`) || !strings.Contains(body, "/api/v1/brands/{id}") {
		t.Errorf("page data missing")
	}
	// The "Connect your AI" section reads the MCP tool table from the page data; its lists must be arrays.
	if !strings.Contains(body, `"name":"get_brand"`) || strings.Contains(body, `"params":null`) || !strings.Contains(body, `"write":false`) {
		t.Errorf("MCP tool data missing or has null lists")
	}
	// The page is open (it holds no data), the data behind it is not.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/brands", nil))
	if rec.Code != 401 {
		t.Errorf("data must still need the token: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/nope", nil))
	if rec.Code != 401 && rec.Code != 404 {
		t.Errorf("unknown path: %d", rec.Code)
	}
}
