package api

import (
	"net/http"
	"strconv"

	"creatoros/internal/audience"
	"creatoros/internal/cdp"
	"creatoros/internal/model"
)

func (s *Server) routeAudience(mux *http.ServeMux) {
	s.reg(mux, "GET /api/v1/audience", s.audienceOverview)
	s.reg(mux, "GET /api/v1/audience/segments/{id}/members", s.segmentMembers)
	s.reg(mux, "GET /api/v1/audience/members/{id}", s.audienceMember)
}

// audienceOverview is the whole Audience page except the open segment and the open profile.
// month / platform default like the page: the newest month, TikTok.
func (s *Server) audienceOverview(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	t := s.Store.Today()
	db := s.Store.DB
	months, err := audience.AvailableMonths(db, t)
	if err != nil {
		serverError(w, err)
		return
	}
	month := ""
	if len(months) > 0 {
		month = months[0]
	}
	for _, m := range months {
		if m == q.Get("month") {
			month = m
		}
	}
	platform := "tiktok"
	for _, p := range model.PlatformKeys {
		if p == q.Get("platform") {
			platform = p
		}
	}
	series, err := audience.FollowerSeries(db, t)
	if err != nil {
		serverError(w, err)
		return
	}
	var splitMonth *string
	var demo *audience.Demographics
	if month != "" {
		sm, err := audience.LatestSplitMonth(db, platform, month)
		if err != nil {
			serverError(w, err)
			return
		}
		if sm != "" {
			splitMonth = &sm
			if demo, err = audience.DemographicsOf(db, sm, platform); err != nil {
				serverError(w, err)
				return
			}
		}
	}
	seg, err := audience.ComputeSegments(db, t)
	if err != nil {
		serverError(w, err)
		return
	}
	spikes, err := cdp.ProductQuestionSpikes(db, t)
	if err != nil {
		serverError(w, err)
		return
	}
	spiking := []string{}
	for _, sp := range spikes {
		if sp.IsSpike {
			spiking = append(spiking, "askers_"+sp.Category)
		}
	}
	ok(w, map[string]any{
		"today": t, "months": months, "month": nilIfEmpty(month), "platform": platform,
		"series": series, "splitMonth": splitMonth, "demographics": demo,
		"segments": seg, "spikingSegments": spiking,
	})
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *Server) segmentMembers(w http.ResponseWriter, r *http.Request) {
	t := s.Store.Today()
	seg, err := audience.ComputeSegments(s.Store.DB, t)
	if err != nil {
		serverError(w, err)
		return
	}
	id := r.PathValue("id")
	if !seg.Has(id) {
		fail(w, http.StatusNotFound, "no such segment")
		return
	}
	limit := 30
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 && n <= 500 {
		limit = n
	}
	total, rows := seg.Members(id, limit)
	ok(w, map[string]any{"today": t, "id": id, "total": total, "rows": rows})
}

func (s *Server) audienceMember(w http.ResponseWriter, r *http.Request) {
	t := s.Store.Today()
	p, err := audience.GetProfile(s.Store.DB, r.PathValue("id"), t)
	if err != nil {
		serverError(w, err)
		return
	}
	if p == nil {
		fail(w, http.StatusNotFound, "no such person")
		return
	}
	ok(w, map[string]any{"today": t, "profile": p})
}
