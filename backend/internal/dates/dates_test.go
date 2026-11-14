package dates

import "testing"

func TestHelpers(t *testing.T) {
	if got := AddDays("2026-10-31", 1); got != "2026-11-01" {
		t.Errorf("AddDays = %s", got)
	}
	if got := AddDays("2026-03-01", -1); got != "2026-02-28" {
		t.Errorf("AddDays = %s", got)
	}
	if got := DiffDays("2026-10-01T09:00:00", "2026-10-31"); got != 30 {
		t.Errorf("DiffDays = %d", got)
	}
	if got := AddMonths("2026-01", -2); got != "2025-11" {
		t.Errorf("AddMonths = %s", got)
	}
	if got := AddMonths("2026-11", 14); got != "2028-01" {
		t.Errorf("AddMonths = %s", got)
	}
	if got := DaysBetween("2026-02-27", "2026-03-01"); len(got) != 3 || got[2] != "2026-03-01" {
		t.Errorf("DaysBetween = %v", got)
	}
	if s, e := WindowEnding("2026-10-31", 7); s != "2026-10-25" || e != "2026-10-31" {
		t.Errorf("WindowEnding = %s %s", s, e)
	}
}
