package crm

import (
	"math"
	"strings"
)

// jsRound is JavaScript's Math.round: halves go up.
func jsRound(x float64) int { return int(math.Floor(x + 0.5)) }

// JSRound is exported for packages that must match the web app's rounding.
func JSRound(x float64) int { return jsRound(x) }

func containsFold(s, sub string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(sub))
}
