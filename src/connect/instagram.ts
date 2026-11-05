/**
 * Instagram via the Instagram API with Instagram Login (Business/Creator accounts).
 * Media insights are lifetime totals → converted to daily deltas by sync (totals.ts).
 * Follower demographics need ≥ 100 followers; missing data is skipped, not fatal.
 */
import type { RawAudienceSnapshot, RawComment, RawContent } from "@/cdp/adapters/PlatformAdapter";
import { getJson } from "./http";
import { firstLine, guessTags, looksSponsored, toBangkok } from "./tags";
import type { Totals } from "./totals";

const G = "https://graph.instagram.com";
const MAX_MEDIA = 50;

type Media = { id: string; caption?: string; media_type: string; media_product_type?: string; timestamp: string; like_count?: number; comments_count?: number };

export async function fetchInstagram(token: string, month: string) {
  const q = (path: string, params: Record<string, string> = {}) => getJson<Record<string, unknown>>(`${G}/${path}?${new URLSearchParams({ ...params, access_token: token })}`);
  const me = (await q("me", { fields: "user_id,username,followers_count" })) as { followers_count?: number };
  const media = ((await q("me/media", { fields: "id,caption,media_type,media_product_type,timestamp,like_count,comments_count", limit: String(MAX_MEDIA) })).data ?? []) as Media[];

  const contents: RawContent[] = [];
  const posts: { externalId: string; postedOn: string; totals: Totals }[] = [];
  const comments: RawComment[] = [];
  for (const m of media) {
    const caption = m.caption ?? "";
    const postedAt = toBangkok(m.timestamp);
    contents.push({ externalId: m.id, title: firstLine(caption), postedAt, isSponsored: looksSponsored(caption), ...guessTags(caption) });
    const ins = (await q(`${m.id}/insights`, { metric: "views,likes,comments,shares,saved,profile_visits,follows" }).catch(() =>
      // Not every metric exists for every media type; fall back to the common ones.
      q(`${m.id}/insights`, { metric: "views,likes,comments,shares,saved" }).catch(() => ({ data: [] })),
    )) as { data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] };
    const v = (name: string) => ins.data?.find((d) => d.name === name);
    const val = (name: string) => v(name)?.total_value?.value ?? v(name)?.values?.[0]?.value ?? 0;
    posts.push({
      externalId: m.id,
      postedOn: postedAt.slice(0, 10),
      totals: { views: val("views"), likes: val("likes") || (m.like_count ?? 0), comments: val("comments") || (m.comments_count ?? 0), shares: val("shares"), saves: val("saved"), profileViews: val("profile_visits"), newFollowers: val("follows") },
    });
    if ((m.comments_count ?? 0) > 0) {
      const cs = ((await q(`${m.id}/comments`, { fields: "id,text,username,timestamp", limit: "50" }).catch(() => ({ data: [] }))).data ?? []) as { text: string; username?: string; id: string; timestamp: string }[];
      for (const c of cs) comments.push({ contentExternalId: m.id, authorHandle: c.username ?? `ig:${c.id}`, text: c.text, createdAt: toBangkok(c.timestamp) });
    }
  }

  const breakdown = async (by: "age" | "gender" | "country") => {
    const r = (await q("me/insights", { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: by }).catch(() => ({ data: [] }))) as {
      data?: { total_value?: { breakdowns?: { results?: { dimension_values: string[]; value: number }[] }[] } }[];
    };
    const rows = r.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    const total = rows.reduce((s, x) => s + x.value, 0) || 1;
    const out: Record<string, number> = {};
    for (const x of rows) {
      let k = x.dimension_values[0];
      if (by === "gender") k = k === "F" ? "female" : k === "M" ? "male" : "other";
      if (by === "age" && /^(45|55|65)/.test(k)) k = "45+";
      if (by === "country" && !["TH", "LA", "MY", "US"].includes(k)) k = "other";
      out[k] = (out[k] ?? 0) + (x.value / total) * 100;
    }
    return out;
  };
  const audience: RawAudienceSnapshot[] = [{ month, followers: me.followers_count ?? 0, age: await breakdown("age"), gender: await breakdown("gender"), country: await breakdown("country") }];
  return { contents, posts, comments, audience };
}
