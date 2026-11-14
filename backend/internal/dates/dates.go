// Package dates holds pure date-string helpers. Everything is done in UTC on "YYYY-MM-DD" strings,
// so results never depend on the machine's timezone (same as src/lib/dates.ts).
package dates

import (
	"math"
	"strconv"
	"strings"
	"time"
)

const layout = "2006-01-02"

// ToDate parses the date part of "YYYY-MM-DD" or a timestamp. A bad value gives the zero time.
func ToDate(d string) time.Time {
	if len(d) > 10 {
		d = d[:10]
	}
	t, _ := time.Parse(layout, d)
	return t
}

func AddDays(d string, n int) string { return ToDate(d).AddDate(0, 0, n).Format(layout) }

// DiffDays is the whole number of days from a to b (b - a). Only the date parts are used.
func DiffDays(a, b string) int {
	return int(math.Round(ToDate(b).Sub(ToDate(a)).Hours() / 24))
}

func Day(ts string) string {
	if len(ts) > 10 {
		return ts[:10]
	}
	return ts
}

func MonthOf(d string) string {
	if len(d) > 7 {
		return d[:7]
	}
	return d
}

// AddMonths shifts a "YYYY-MM" month by n months.
func AddMonths(month string, n int) string {
	y, _ := strconv.Atoi(month[:4])
	m, _ := strconv.Atoi(strings.TrimLeft(month[5:7], "0"))
	idx := y*12 + (m - 1) + n
	return strconv.Itoa(idx/12) + "-" + pad2(idx%12+1)
}

// DaysBetween lists every day from start to end, inclusive.
func DaysBetween(start, end string) []string {
	var out []string
	for d := start; d <= end; d = AddDays(d, 1) {
		out = append(out, d)
	}
	return out
}

// WindowEnding is the window of n days ending on (and including) end.
func WindowEnding(end string, n int) (start, last string) { return AddDays(end, -(n - 1)), end }

func pad2(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}
