// Package crm holds the business rules: brand tiers, won/open deals, finance rollups.
// Definitions are the same as src/crm/rules.ts.
//
//	TIERS (computed, never stored): count deals that reached Paid with closed_at inside the 365 days
//	ending today. Partner >= 3, Repeat = 2, One-time = 1, Lead = 0.
//	WON deal = stage Production or later. Silent = a won deal, no open deal, no activity for 120+ days.
package crm

import "creatoros/internal/model"

const (
	TierWindowDays = 365
	SilentDays     = 120
)

var Tiers = []string{"partner", "repeat", "one_time", "lead"}

func TierFor(paidInWindow int) string {
	switch {
	case paidInWindow >= 3:
		return "partner"
	case paidInWindow == 2:
		return "repeat"
	case paidInWindow == 1:
		return "one_time"
	}
	return "lead"
}

func stageIndex(stage string) int {
	for i, s := range model.DealStages {
		if s == stage {
			return i
		}
	}
	return -1
}

func ValidStage(stage string) bool { return stageIndex(stage) >= 0 }
func StageAtLeast(stage, min string) bool {
	return stageIndex(stage) >= stageIndex(min)
}
func IsWon(stage string) bool  { return StageAtLeast(stage, "production") }
func IsOpen(stage string) bool { return stage != "paid" }

// EngagementRate = (likes + comments + shares + saves) / views.
func EngagementRate(views, likes, comments, shares, saves int) float64 {
	if views <= 0 {
		return 0
	}
	return float64(likes+comments+shares+saves) / float64(views)
}
