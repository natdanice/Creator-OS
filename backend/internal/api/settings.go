package api

import (
	"encoding/json"
	"net/http"

	"creatoros/internal/settings"
)

func (s *Server) routeSettings(mux *http.ServeMux) {
	s.reg(mux, "GET /api/v1/settings", s.settingsData)
	s.reg(mux, "PUT /api/v1/settings/rates", s.saveRates)
	s.reg(mux, "PUT /api/v1/settings/profile", s.saveProfile)
}

func (s *Server) settingsData(w http.ResponseWriter, _ *http.Request) {
	d, err := settings.Load(s.Store.DB)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"today": s.Store.Today(), "settings": d})
}

func (s *Server) saveRates(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Prices map[string]float64 `json:"prices"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in) != nil || in.Prices == nil {
		fail(w, http.StatusBadRequest, "need a JSON body {\"prices\": {\"CODE\": 12000}}")
		return
	}
	n, err := settings.SaveRates(s.Store.DB, in.Prices)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"changed": n})
}

func (s *Server) saveProfile(w http.ResponseWriter, r *http.Request) {
	var in settings.ProfileInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in) != nil {
		fail(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if err := settings.SaveProfile(s.Store, in); err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"ok": true})
}
