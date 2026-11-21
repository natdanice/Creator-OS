package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"creatoros/internal/crm"
	"creatoros/internal/inbox"
)

var commentCategories = []string{"product_question", "content_request", "general_question", "praise", "spam"}

func (s *Server) routeInbox(mux *http.ServeMux) {
	s.reg(mux, "GET /api/v1/inbox", s.inboxSummary)
	s.reg(mux, "GET /api/v1/inbox/threads", s.inboxThreads)
	s.reg(mux, "GET /api/v1/inbox/threads/{id}", s.inboxThread)
	s.reg(mux, "POST /api/v1/inbox/threads/{id}/read", s.threadRead)
	s.reg(mux, "POST /api/v1/inbox/threads/{id}/reply", s.threadReply)
	s.reg(mux, "GET /api/v1/inbox/comments", s.inboxComments)
	s.reg(mux, "POST /api/v1/messages/{id}/convert", s.briefConvert)
	s.reg(mux, "POST /api/v1/messages/{id}/ignore", s.briefIgnore)
	s.reg(mux, "POST /api/v1/comments/{id}/reply", s.commentReply)
	s.reg(mux, "POST /api/v1/comments/{id}/hide", s.commentHide)
}

func needsReplyCount(counts []inbox.CategoryCount) int {
	n := 0
	for _, c := range counts {
		for _, cat := range inbox.NeedsReply {
			if c.Category == cat {
				n += c.N
			}
		}
	}
	return n
}

// inboxSummary is what the tab badges and the comment filter chips need.
func (s *Server) inboxSummary(w http.ResponseWriter, _ *http.Request) {
	t := s.Store.Today()
	c, err := inbox.InboxCounts(s.Store.DB)
	if err != nil {
		serverError(w, err)
		return
	}
	cc, err := inbox.CommentCountsByCategory(s.Store.DB, t)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"today": t, "counts": c, "needsReply": needsReplyCount(cc), "commentCounts": cc})
}

func (s *Server) inboxThreads(w http.ResponseWriter, _ *http.Request) {
	t := s.Store.Today()
	th, err := inbox.ListThreads(s.Store.DB, t)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"today": t, "threads": th})
}

func (s *Server) inboxThread(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	if !valid {
		fail(w, http.StatusBadRequest, "bad brand id")
		return
	}
	if exists, err := inbox.BrandExists(s.Store.DB, id); err != nil {
		serverError(w, err)
		return
	} else if !exists {
		writeError(w, crm.NotFound("brand", id))
		return
	}
	t := s.Store.Today()
	th, err := inbox.GetThread(s.Store.DB, id, t)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"today": t, "thread": th})
}

func (s *Server) inboxComments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := inbox.CommentFilter{Category: "needs_reply", Status: "open"}
	for _, c := range commentCategories {
		if q.Get("cat") == c {
			f.Category = c
		}
	}
	for _, st := range []string{"open", "replied", "hidden"} {
		if q.Get("status") == st {
			f.Status = st
		}
	}
	for _, p := range []string{"tiktok", "instagram", "youtube"} {
		if q.Get("platform") == p {
			f.Platform = p
		}
	}
	f.Limit, f.Offset = 40, 0
	if n, err := strconv.Atoi(q.Get("limit")); err == nil && n >= 1 && n <= 200 {
		f.Limit = n
	}
	if n, err := strconv.Atoi(q.Get("offset")); err == nil && n >= 0 {
		f.Offset = n
	}
	t := s.Store.Today()
	rows, total, err := inbox.CommentQueue(s.Store.DB, t, f)
	if err != nil {
		serverError(w, err)
		return
	}
	cc, err := inbox.CommentCountsByCategory(s.Store.DB, t)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{
		"today": t, "rows": rows, "total": total, "windowDays": inbox.CommentWindowDays, "counts": cc,
		"status": f.Status, "limit": f.Limit, "offset": f.Offset, "hasMore": f.Offset+len(rows) < total,
	})
}

func (s *Server) threadRead(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	if !valid {
		fail(w, http.StatusBadRequest, "bad brand id")
		return
	}
	n, err := inbox.MarkThreadRead(s.Store, id)
	if err != nil {
		writeError(w, err)
		return
	}
	ok(w, map[string]any{"changed": n})
}

func (s *Server) threadReply(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	var in struct {
		Body string `json:"body"`
	}
	if !valid || json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<18)).Decode(&in) != nil {
		fail(w, http.StatusBadRequest, "need a brand id and a JSON body {\"body\": ...}")
		return
	}
	messageID, err := inbox.SendBrandReply(s.Store, id, in.Body)
	if err != nil {
		writeError(w, err)
		return
	}
	ok(w, map[string]any{"ok": true, "messageId": messageID})
}

func (s *Server) briefConvert(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	var in struct {
		Title string  `json:"title"`
		Value float64 `json:"value"`
	}
	if !valid || json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in) != nil {
		fail(w, http.StatusBadRequest, "need a message id and a JSON body {\"title\", \"value\"}")
		return
	}
	res, err := inbox.ConvertBrief(s.Store, id, in.Title, in.Value)
	if err != nil {
		writeError(w, err)
		return
	}
	ok(w, res)
}

func (s *Server) briefIgnore(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	if !valid {
		fail(w, http.StatusBadRequest, "bad message id")
		return
	}
	res, err := inbox.IgnoreBrief(s.Store, id)
	if err != nil {
		writeError(w, err)
		return
	}
	ok(w, res)
}

func (s *Server) commentReply(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	var in struct {
		Text string `json:"text"`
	}
	if !valid || json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in) != nil {
		fail(w, http.StatusBadRequest, "need a comment id and a JSON body {\"text\": ...}")
		return
	}
	res, err := inbox.ReplyComment(s.Store, id, in.Text)
	if err != nil {
		writeError(w, err)
		return
	}
	ok(w, res)
}

func (s *Server) commentHide(w http.ResponseWriter, r *http.Request) {
	id, valid := idParam(r)
	if !valid {
		fail(w, http.StatusBadRequest, "bad comment id")
		return
	}
	res, err := inbox.HideComment(s.Store, id)
	if err != nil {
		writeError(w, err)
		return
	}
	ok(w, res)
}
