package cdp

import (
	"reflect"
	"testing"
)

func p(id int, platform, title, at string) PostRef { return PostRef{id, platform, title, at} }

// Real-looking captions: Instagram posts first with a long caption, TikTok later with a short label.
func TestGroupsSameVideoAcrossPlatforms(t *testing.T) {
	posts := []PostRef{
		p(1, "instagram", "มา Unbox LAVA GENIE กันคับบ🎸", "2026-08-21T00:23:00"),
		p(2, "tiktok", "Unbox LAVA GENIE", "2026-08-21T14:26:00"),
		p(3, "instagram", "ใครกำลังอยากได้เปียโนไฟฟ้าดีๆ สักตัว ลองไปดูที่ @ctmusicshop", "2026-02-12T01:05:00"),
		p(4, "tiktok", "เปียโนไฟฟ้าดีๆ สักตัว (CT Music Shop)", "2026-02-12T16:08:00"),
		p(5, "tiktok", "Reply @delkamtui: 6/8 vs 4/4", "2026-02-25T23:48:00"),
	}
	got := GroupCrossPosts(posts, nil)
	want := [][]int{{1, 2}, {3, 4}, {5}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("groups = %v, want %v", got, want)
	}
}

// A recurring series ("… ราคาไม่ถึงพัน คุ้มไหม?") is not one video: the template alone must not match.
func TestSeriesTemplateDoesNotMatch(t *testing.T) {
	posts := []PostRef{
		p(1, "youtube", "ซอสพริก ราคาไม่ถึงพัน คุ้มไหม?", "2026-07-11T17:00:00"),
		p(2, "tiktok", "กราโนล่า ราคาไม่ถึงพัน คุ้มไหม?", "2026-07-13T20:15:00"),
		p(3, "instagram", "คีย์บอร์ด ราคาไม่ถึงพัน คุ้มไหม?", "2026-07-14T10:00:00"),
		p(4, "tiktok", "หูฟัง ราคาไม่ถึงพัน คุ้มไหม?", "2026-07-20T10:00:00"),
		// A template only counts as "common" once it appears in more than a handful of posts.
		p(5, "youtube", "เมาส์ ราคาไม่ถึงพัน คุ้มไหม?", "2026-08-01T10:00:00"),
		p(6, "tiktok", "ลำโพง ราคาไม่ถึงพัน คุ้มไหม?", "2026-08-09T10:00:00"),
	}
	for _, g := range GroupCrossPosts(posts, nil) {
		if len(g) != 1 {
			t.Errorf("series posts were grouped: %v", g)
		}
	}
}

func TestAtMostOnePostPerPlatformAndTimeLimit(t *testing.T) {
	same := "Glowberry Skin × มอยส์เจอไรเซอร์ผิวแพ้ง่าย"
	posts := []PostRef{
		p(1, "tiktok", same, "2026-10-01T10:00:00"),
		p(2, "tiktok", same, "2026-10-01T11:00:00"), // same platform: never grouped with 1
		p(3, "instagram", same, "2026-10-01T12:00:00"),
		p(4, "youtube", same, "2026-10-09T12:00:00"), // more than 72 hours later
	}
	got := GroupCrossPosts(posts, nil)
	for _, g := range got {
		seen := map[string]bool{}
		for _, id := range g {
			pl := posts[id-1].Platform
			if seen[pl] {
				t.Errorf("two %s posts in one group: %v", pl, g)
			}
			seen[pl] = true
		}
		for _, id := range g {
			if id == 4 && len(g) > 1 {
				t.Errorf("post 4 is too far in time but was grouped: %v", g)
			}
		}
	}
}

func TestPublisherJobsAreAlwaysOneVideo(t *testing.T) {
	posts := []PostRef{
		p(1, "tiktok", "completely different caption", "2026-10-01T10:00:00"),
		p(2, "instagram", "nothing alike at all here", "2026-10-05T10:00:00"),
	}
	got := GroupCrossPosts(posts, [][2]int{{1, 2}})
	if !reflect.DeepEqual(got, [][]int{{1, 2}}) {
		t.Errorf("groups = %v", got)
	}
}

func TestOverlapIsSymmetricEnough(t *testing.T) {
	one := func(bigram) float64 { return 1 }
	if got := captionOverlap("Unbox LAVA GENIE", "มา Unbox LAVA GENIE กันคับบ🎸", one); got < 0.99 {
		t.Errorf("short label inside long caption should overlap fully, got %.2f", got)
	}
	if got := captionOverlap("a", "b", one); got != 0 {
		t.Errorf("too short = %.2f", got)
	}
}
