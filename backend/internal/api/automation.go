package api

import (
	"encoding/json"
	"net/http"

	"creatoros/internal/automation"
)

func (s *Server) routeAutomation(mux *http.ServeMux) {
	s.reg(mux, "GET /api/v1/automation", s.automationOverview)
	s.reg(mux, "POST /api/v1/automation/rules/{id}/enabled", s.ruleEnabled)
	s.reg(mux, "POST /api/v1/automation/reset", s.automationReset)
	s.reg(mux, "POST /api/v1/tasks/{id}/complete", s.taskComplete)
	s.reg(mux, "POST /api/v1/tasks/{id}/dismiss", s.taskDismiss)
}

func (s *Server) automationOverview(w http.ResponseWriter, _ *http.Request) {
	db := s.Store.DB
	rules, err := automation.Rules(db)
	if err != nil {
		serverError(w, err)
		return
	}
	open, err := automation.OpenTasks(db)
	if err != nil {
		serverError(w, err)
		return
	}
	done, err := automation.ClosedTasks(db)
	if err != nil {
		serverError(w, err)
		return
	}
	runs, err := automation.RecentRuns(db, 8)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"today": s.Store.Today(), "rules": rules, "open": open, "done": done, "runs": runs})
}

func (s *Server) ruleEnabled(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Enabled *bool `json:"enabled"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&in) != nil || in.Enabled == nil {
		fail(w, http.StatusBadRequest, "need a JSON body {\"enabled\": true|false}")
		return
	}
	if err := automation.SetRuleEnabled(s.Store.DB, r.PathValue("id"), *in.Enabled); err != nil {
		writeError(w, err)
		return
	}
	ok(w, map[string]any{"ok": true})
}

func (s *Server) automationReset(w http.ResponseWriter, _ *http.Request) {
	if err := automation.Reset(s.Store.DB); err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"ok": true})
}

func (s *Server) taskComplete(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	var in struct {
		Message string `json:"message"`
	}
	if !valid || json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<18)).Decode(&in) != nil {
		fail(w, http.StatusBadRequest, "need a task id and a JSON body {\"message\": ...}")
		return
	}
	res, err := automation.Complete(s.Store, id, in.Message)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, res)
}

func (s *Server) taskDismiss(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	if !valid {
		fail(w, http.StatusBadRequest, "bad task id")
		return
	}
	if err := automation.Dismiss(s.Store.DB, id); err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"ok": true})
}
