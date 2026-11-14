// Package model holds the rows the API returns. JSON names are camelCase, the same shape the
// Next.js pages already use for these objects (the Drizzle row types).
package model

type Brand struct {
	ID        int     `json:"id"`
	Name      string  `json:"name"`
	Category  string  `json:"category"`
	Website   *string `json:"website"`
	Notes     *string `json:"notes"`
	CreatedAt string  `json:"createdAt"`
}

type Contact struct {
	ID        int    `json:"id"`
	BrandID   int    `json:"brandId"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	Channel   string `json:"channel"`
	Handle    string `json:"handle"`
	IsPrimary bool   `json:"isPrimary"`
}

type Deal struct {
	ID           int      `json:"id"`
	BrandID      int      `json:"brandId"`
	Title        string   `json:"title"`
	Stage        string   `json:"stage"`
	Value        int      `json:"value"`
	Currency     string   `json:"currency"`
	Deliverables []string `json:"deliverables"`
	CreatedAt    string   `json:"createdAt"`
	PostedAt     *string  `json:"postedAt"`
	ClosedAt     *string  `json:"closedAt"`
}

// BriefSignal is the detected brief on an inbound message.
type BriefSignal struct {
	Budget    *int     `json:"budget"`
	Platforms []string `json:"platforms"`
	Timing    *string  `json:"timing"`
	Product   *string  `json:"product"`
}

type Message struct {
	ID          int          `json:"id"`
	BrandID     int          `json:"brandId"`
	Direction   string       `json:"direction"`
	Channel     string       `json:"channel"`
	Body        string       `json:"body"`
	SentAt      string       `json:"sentAt"`
	ReadAt      *string      `json:"readAt"`
	Brief       *BriefSignal `json:"brief"`
	BriefStatus string       `json:"briefStatus"`
	DealID      *int         `json:"dealId"`
	TaskID      *int         `json:"taskId"`
	ExternalID  *string      `json:"externalId"`
}

type Task struct {
	ID           int            `json:"id"`
	RuleID       string         `json:"ruleId"`
	DedupeKey    string         `json:"dedupeKey"`
	Title        string         `json:"title"`
	Reason       string         `json:"reason"`
	DraftMessage string         `json:"draftMessage"`
	Channel      string         `json:"channel"`
	BrandID      *int           `json:"brandId"`
	DealID       *int           `json:"dealId"`
	Link         *string        `json:"link"`
	Vars         map[string]any `json:"vars"`
	Status       string         `json:"status"`
	ForDate      string         `json:"forDate"`
	CreatedAt    string         `json:"createdAt"`
	CompletedAt  *string        `json:"completedAt"`
}

// Lists that are empty must be [] in JSON, never null.
func Strings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

var DealStages = []string{"lead", "brief", "quotation", "production", "posted", "report_sent", "invoiced", "paid"}
var ProductCategories = []string{"skincare", "tech", "food", "home", "fashion", "music"}
var PlatformKeys = []string{"tiktok", "instagram", "youtube"}
