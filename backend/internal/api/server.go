// Package api is the HTTP layer: JSON endpoints under /api/v1 for the Next.js frontend.
package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"creatoros/internal/brand360"
	"creatoros/internal/cdp"
	"creatoros/internal/crm"
	"creatoros/internal/model"
	"creatoros/internal/overview"
	"creatoros/internal/store"
	"creatoros/internal/today"
)

type Server struct {
	Store *store.Store
	Token string // when set, required on every request except /api/v1/health

	MCPReadOnly bool // MCP_READ_ONLY=1: hide the write tools on /mcp (they are on by default)

	inner http.Handler // the routes without auth/logging, for the MCP tools to call in-process

	routes []string // every registered "METHOD /path", for the docs page and its test
}

// reg registers a route and remembers it.
func (s *Server) reg(mux *http.ServeMux, pattern string, h http.HandlerFunc) {
	s.routes = append(s.routes, pattern)
	mux.HandleFunc(pattern, h)
}

func (s *Server) Handler() http.Handler {
	s.routes = nil
	mux := http.NewServeMux()
	s.reg(mux, "GET /api/v1/health", s.health)
	s.reg(mux, "GET /api/v1/context", s.context)
	s.reg(mux, "GET /api/v1/overview", s.overview)
	s.reg(mux, "GET /api/v1/today", s.todayActions)
	s.reg(mux, "GET /api/v1/brands", s.brands)
	s.reg(mux, "POST /api/v1/brands", s.createBrand)
	s.reg(mux, "GET /api/v1/brands/{id}", s.brand)
	s.reg(mux, "GET /api/v1/pipeline", s.pipeline)
	s.reg(mux, "POST /api/v1/deals/{id}/stage", s.moveStage)
	s.reg(mux, "GET /api/v1/finance", s.finance)
	s.reg(mux, "GET /api/v1/finance/export", s.financeExport)
	s.reg(mux, "POST /api/v1/invoices/{id}/paid", s.markPaid)
	s.routeInbox(mux)
	s.routeAudience(mux)
	s.routeAutomation(mux)
	s.routeSettings(mux)
	s.reg(mux, "POST /mcp", s.mcp)
	mux.HandleFunc("GET /mcp", mcpMethodNotAllowed)
	s.reg(mux, "GET /{$}", s.docsPage)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { fail(w, http.StatusNotFound, "no such endpoint") })
	s.inner = mux
	return s.logged(s.authed(mux))
}

func (s *Server) authed(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.Token != "" && r.URL.Path != "/api/v1/health" && !(r.Method == http.MethodGet && r.URL.Path == "/") {
			got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if subtle.ConstantTimeCompare([]byte(got), []byte(s.Token)) != 1 {
				fail(w, http.StatusUnauthorized, "missing or wrong API token")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (w *statusWriter) WriteHeader(c int) { w.code = c; w.ResponseWriter.WriteHeader(c) }

func (s *Server) logged(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: 200}
		next.ServeHTTP(sw, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.RequestURI(), sw.code, time.Since(start).Round(time.Millisecond))
	})
}

func send(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func ok(w http.ResponseWriter, v any) { send(w, http.StatusOK, v) }

func fail(w http.ResponseWriter, status int, msg string) {
	send(w, status, map[string]string{"error": msg})
}

// serverError hides internal details from the client but logs them.
func serverError(w http.ResponseWriter, err error) {
	log.Printf("error: %v", err)
	fail(w, http.StatusInternalServerError, "internal error")
}

// writeError maps domain errors to HTTP statuses.
func writeError(w http.ResponseWriter, err error) {
	var invalid crm.ErrInvalid
	var conflict crm.ErrConflict
	switch {
	case errors.Is(err, crm.ErrNotFound):
		fail(w, http.StatusNotFound, err.Error()) // "No brand with id 9": says what was looked up
	case errors.As(err, &invalid):
		fail(w, http.StatusBadRequest, invalid.Error())
	case errors.As(err, &conflict):
		fail(w, http.StatusConflict, conflict.Error())
	default:
		serverError(w, err)
	}
}

func idParam(r *http.Request) (int, bool) {
	id, err := strconv.Atoi(r.PathValue("id"))
	return id, err == nil && id > 0
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	if err := s.Store.DB.Ping(); err != nil {
		fail(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	ok(w, map[string]any{"ok": true, "mode": mode(s.Store.Live), "today": s.Store.Today()})
}

func mode(live bool) string {
	if live {
		return "live"
	}
	return "demo"
}

func (s *Server) context(w http.ResponseWriter, _ *http.Request) {
	ok(w, map[string]any{"today": s.Store.Today(), "mode": mode(s.Store.Live)})
}

func (s *Server) overview(w http.ResponseWriter, r *http.Request) {
	rng := 28
	if n, err := strconv.Atoi(r.URL.Query().Get("range")); err == nil && (n == 7 || n == 28 || n == 90) {
		rng = n
	}
	t := s.Store.Today()
	d, err := overview.Compute(s.Store.DB, t, rng)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"today": t, "range": rng, "overview": d})
}

func (s *Server) todayActions(w http.ResponseWriter, _ *http.Request) {
	t := s.Store.Today()
	a, err := today.Actions(s.Store.DB, t)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"today": t, "actions": a})
}

func (s *Server) brands(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	t := s.Store.Today()
	all, err := crm.ComputeBrandStats(s.Store.DB, t)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{
		"today":      t,
		"tierCounts": crm.TierCounts(all),
		"rows":       crm.FilterBrands(all, q.Get("q"), q.Get("tier"), q.Get("category")),
	})
}

func (s *Server) createBrand(w http.ResponseWriter, r *http.Request) {
	var in crm.NewBrand
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	id, err := crm.CreateBrand(s.Store, in)
	if err != nil {
		writeError(w, err)
		return
	}
	send(w, http.StatusCreated, map[string]any{"id": id})
}

// brand is Brand 360: one brand with its deals, post performance, next offer, invoices and timeline.
func (s *Server) brand(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	if !valid {
		fail(w, http.StatusBadRequest, "bad brand id")
		return
	}
	t := s.Store.Today()
	p, err := brand360.Get(s.Store.DB, id, t)
	if err != nil {
		serverError(w, err)
		return
	}
	if p == nil {
		writeError(w, crm.NotFound("brand", id))
		return
	}
	ok(w, map[string]any{"today": t, "brand": p})
}

type pipelineDeal struct {
	ID        int    `json:"id"`
	Title     string `json:"title"`
	BrandID   int    `json:"brandId"`
	BrandName string `json:"brandName"`
	Tier      string `json:"tier"`
	Stage     string `json:"stage"`
	Value     int    `json:"value"`
	Date      string `json:"date"`
}

func (s *Server) pipeline(w http.ResponseWriter, _ *http.Request) {
	t := s.Store.Today()
	stats, err := crm.ComputeBrandStats(s.Store.DB, t)
	if err != nil {
		serverError(w, err)
		return
	}
	deals := []pipelineDeal{}
	for _, st := range stats {
		for _, d := range st.Deals {
			date := d.CreatedAt
			if d.PostedAt != nil {
				date = *d.PostedAt
			}
			if d.ClosedAt != nil {
				date = *d.ClosedAt
			}
			deals = append(deals, pipelineDeal{d.ID, d.Title, st.Brand.ID, st.Brand.Name, st.Tier, d.Stage, d.Value, date})
		}
	}
	sortDealsNewestFirst(deals)
	ok(w, map[string]any{"today": t, "stages": model.DealStages, "deals": deals})
}

func (s *Server) moveStage(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	var in struct {
		Stage string `json:"stage"`
	}
	if !valid || json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in) != nil {
		fail(w, http.StatusBadRequest, "need a deal id and a JSON body {\"stage\": ...}")
		return
	}
	res, err := crm.MoveDealStage(s.Store, id, in.Stage)
	if err != nil {
		writeError(w, err)
		return
	}
	ok(w, res)
}

func (s *Server) finance(w http.ResponseWriter, _ *http.Request) {
	t := s.Store.Today()
	d, err := crm.FinanceFor(s.Store.DB, t)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"today": t, "finance": d})
}

func (s *Server) financeExport(w http.ResponseWriter, r *http.Request) {
	t := s.Store.Today()
	year := r.URL.Query().Get("year")
	if len(year) != 4 {
		year = t[:4]
	}
	if _, err := strconv.Atoi(year); err != nil {
		fail(w, http.StatusBadRequest, "year must be like 2026")
		return
	}
	rows, err := crm.ListInvoices(s.Store.DB, t)
	if err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="creator-os-income-`+year+`.csv"`)
	_, _ = w.Write([]byte(crm.InvoicesCSV(rows, year)))
}

func (s *Server) markPaid(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	if !valid {
		fail(w, http.StatusBadRequest, "bad invoice id")
		return
	}
	res, err := crm.MarkInvoicePaid(s.Store, id)
	if err != nil {
		writeError(w, err)
		return
	}
	ok(w, res)
}

var _ = cdp.MaxGapHours // the grouping rules are used through overview
