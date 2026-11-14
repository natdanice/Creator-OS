package api

import "sort"

// sortDealsNewestFirst orders the pipeline by date, newest first.
func sortDealsNewestFirst(d []pipelineDeal) {
	sort.SliceStable(d, func(i, j int) bool { return d[i].Date > d[j].Date })
}
