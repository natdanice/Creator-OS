// Package cdp holds the customer-data-platform logic: cross-post grouping and audience segments.
package cdp

import (
	"database/sql"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf16"
)

// Cross-post matching: the same video posted on several platforms becomes one "content group".
// A port of src/cdp/crossPost.ts; read that file for the reasoning behind the numbers.
//
// Two posts on different platforms are the same piece of content when they were made in one
// Publisher job, or went up within MaxGapHours of each other AND their captions overlap enough AND
// share something specific (rare character pairs such as a song or product name), or are near-identical.
// A group holds at most one post per platform. Best matches are taken first.
const (
	MaxGapHours   = 72
	minSimClose   = 0.35
	closeHours    = 36
	minSim        = 0.8
	minRareShared = 3
	rareMax       = 4
	nearSame      = 0.85
)

type PostRef struct {
	ID       int
	Platform string
	Title    string
	PostedAt string // YYYY-MM-DDTHH:mm:ss
}

var nonWord = regexp.MustCompile(`[^\p{L}\p{N}\p{M}]+`)

// normalize keeps letters, digits and Thai vowel / tone marks only.
func normalize(s string) string { return nonWord.ReplaceAllString(strings.ToLower(s), "") }

type bigram [2]uint16

// bigrams are the distinct UTF-16 character pairs of a caption, in order of first appearance
// (JavaScript slices strings by UTF-16 unit, so this matches the web app exactly).
func bigrams(text string) []bigram {
	u := utf16.Encode([]rune(normalize(text)))
	seen := map[bigram]bool{}
	var out []bigram
	for i := 0; i+1 < len(u); i++ {
		b := bigram{u[i], u[i+1]}
		if !seen[b] {
			seen[b] = true
			out = append(out, b)
		}
	}
	return out
}

type weightFn func(bigram) float64

func captionOverlap(a, b string, w weightFn) float64 {
	A, B := bigrams(a), bigrams(b)
	if len(A) < 2 || len(B) < 2 {
		return 0
	}
	inB := map[bigram]bool{}
	for _, x := range B {
		inB[x] = true
	}
	total := func(S []bigram) float64 {
		n := 0.0
		for _, x := range S {
			n += w(x)
		}
		return n
	}
	shared := 0.0
	for _, x := range A {
		if inB[x] {
			shared += w(x)
		}
	}
	return shared / math.Min(total(A), total(B))
}

func documentFrequency(titles []string) map[bigram]int {
	df := map[bigram]int{}
	for _, t := range titles {
		for _, x := range bigrams(t) {
			df[x]++
		}
	}
	return df
}

// rarity weighs a character pair by ln(1 + posts / posts containing it).
func rarity(n int, df map[bigram]int) weightFn {
	return func(x bigram) float64 {
		d := df[x]
		if d == 0 {
			d = 1
		}
		return math.Log(1 + float64(n)/float64(d))
	}
}

func rareShared(a, b string, df map[bigram]int) int {
	inB := map[bigram]bool{}
	for _, x := range bigrams(b) {
		inB[x] = true
	}
	n := 0
	for _, x := range bigrams(a) {
		if inB[x] && df[x] <= rareMax {
			n++
		}
	}
	return n
}

func hoursApart(a, b string) float64 {
	const l = "2006-01-02T15:04:05"
	ta, _ := time.Parse(l, a)
	tb, _ := time.Parse(l, b)
	return math.Abs(ta.Sub(tb).Hours())
}

// GroupCrossPosts groups posts into pieces of content. Every post appears in exactly one group
// (alone if it has no twin). sameJob = pairs known to be one piece (Publisher jobs).
func GroupCrossPosts(posts []PostRef, sameJob [][2]int) [][]int {
	type group struct{ ids []int }
	groupOf := make(map[int]*group, len(posts))
	platformOf := make(map[int]string, len(posts))
	for _, p := range posts {
		groupOf[p.ID] = &group{ids: []int{p.ID}}
		platformOf[p.ID] = p.Platform
	}
	join := func(a, b int) {
		ga, gb := groupOf[a], groupOf[b]
		if ga == nil || gb == nil || ga == gb {
			return
		}
		have := map[string]bool{}
		for _, id := range ga.ids {
			have[platformOf[id]] = true
		}
		for _, id := range gb.ids {
			if have[platformOf[id]] {
				return // one post per platform
			}
		}
		ga.ids = append(ga.ids, gb.ids...)
		for _, id := range gb.ids {
			groupOf[id] = ga
		}
	}
	for _, pr := range sameJob {
		join(pr[0], pr[1])
	}

	titles := make([]string, len(posts))
	for i, p := range posts {
		titles[i] = p.Title
	}
	df := documentFrequency(titles)
	weight := rarity(len(posts), df)

	sorted := append([]PostRef(nil), posts...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].PostedAt < sorted[j].PostedAt })
	type cand struct {
		a, b     int
		sim, gap float64
	}
	var cands []cand
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			a, b := sorted[i], sorted[j]
			gap := hoursApart(a.PostedAt, b.PostedAt)
			if gap > MaxGapHours {
				break // sorted by time: nothing later can be closer
			}
			if a.Platform == b.Platform {
				continue
			}
			sim := captionOverlap(a.Title, b.Title, weight)
			need := minSim
			if gap <= closeHours {
				need = minSimClose
			}
			if sim < need {
				continue
			}
			sameText := normalize(a.Title) == normalize(b.Title) || (sim >= nearSame && gap <= closeHours)
			if sameText || rareShared(a.Title, b.Title, df) >= minRareShared {
				cands = append(cands, cand{a.ID, b.ID, sim, gap})
			}
		}
	}
	sort.SliceStable(cands, func(i, j int) bool {
		if cands[i].sim != cands[j].sim {
			return cands[i].sim > cands[j].sim
		}
		return cands[i].gap < cands[j].gap
	})
	for _, c := range cands {
		join(c.a, c.b)
	}

	// Groups in the order of their first post.
	var out [][]int
	emitted := map[*group]bool{}
	for _, p := range posts {
		if g := groupOf[p.ID]; !emitted[g] {
			emitted[g] = true
			out = append(out, g.ids)
		}
	}
	return out
}

// ContentGroups groups every post in the database.
func ContentGroups(db *sql.DB) ([][]int, error) {
	rows, err := db.Query(`SELECT id, platform_id, title, posted_at FROM contents ORDER BY id`)
	if err != nil {
		return nil, err
	}
	var posts []PostRef
	for rows.Next() {
		var p PostRef
		if err := rows.Scan(&p.ID, &p.Platform, &p.Title, &p.PostedAt); err != nil {
			rows.Close()
			return nil, err
		}
		posts = append(posts, p)
	}
	rows.Close()

	prows, err := db.Query(`SELECT job_id, content_id FROM publications WHERE content_id IS NOT NULL ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	byJob := map[int][]int{}
	var jobs []int
	for prows.Next() {
		var job, content int
		if err := prows.Scan(&job, &content); err != nil {
			return nil, err
		}
		if _, ok := byJob[job]; !ok {
			jobs = append(jobs, job)
		}
		byJob[job] = append(byJob[job], content)
	}
	var sameJob [][2]int
	for _, j := range jobs {
		ids := byJob[j]
		for _, id := range ids[1:] {
			sameJob = append(sameJob, [2]int{ids[0], id})
		}
	}
	return GroupCrossPosts(posts, sameJob), nil
}
