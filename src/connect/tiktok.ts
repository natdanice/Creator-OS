/**
 * TikTok via Login Kit + Display API v2: your videos and their lifetime counts.
 * The Display API has no comments and no audience demographics — keep using the
 * TikTok Studio CSV export (Settings → Data Sources) for those.
 */
import type { RawAudienceSnapshot, RawContent } from "@/cdp/adapters/PlatformAdapter";
import { getJson } from "./http";
import { firstLine, guessTags, looksSponsored, toBangkok } from "./tags";
import type { Totals } from "./totals";

const API = "https://open.tiktokapis.com/v2";
const MAX_VIDEOS = 60;

type Video = { id: string; title?: string; video_description?: string; create_time: number; view_count?: number; like_count?: number; comment_count?: number; share_count?: number };

export async function fetchTikTok(token: string, month: string) {
  const auth = { Authorization: `Bearer ${token}` };
  const user = await getJson<{ data: { user: { follower_count?: number } } }>(`${API}/user/info/?fields=open_id,display_name,follower_count`, { headers: auth });
  const videos: Video[] = [];
  let cursor: number | undefined;
  while (videos.length < MAX_VIDEOS) {
    const r = await getJson<{ data: { videos: Video[]; cursor: number; has_more: boolean } }>(
      `${API}/video/list/?fields=id,title,video_description,create_time,view_count,like_count,comment_count,share_count`,
      { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }) },
    );
    videos.push(...r.data.videos);
    if (!r.data.has_more) break;
    cursor = r.data.cursor;
  }
  const contents: RawContent[] = videos.map((v) => {
    const text = v.title || v.video_description || "";
    return { externalId: v.id, title: firstLine(text), postedAt: toBangkok(v.create_time), isSponsored: looksSponsored(text), ...guessTags(text), tagsGuessed: true };
  });
  const posts = videos.map((v) => ({
    externalId: v.id,
    postedOn: toBangkok(v.create_time).slice(0, 10),
    totals: { views: v.view_count ?? 0, likes: v.like_count ?? 0, comments: v.comment_count ?? 0, shares: v.share_count ?? 0, saves: 0, profileViews: 0, newFollowers: 0 } satisfies Totals,
  }));
  const audience: RawAudienceSnapshot[] = [{ month, followers: user.data.user.follower_count ?? 0, age: {}, gender: {}, country: {} }];
  return { contents, posts, audience };
}
