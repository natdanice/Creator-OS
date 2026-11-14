import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { accountDaily, comments, contentMetricsDaily, contents, platforms, tasks } from "@/db/schema";
import { ANALYTICS_OK } from "@/cdp/consent";
import { productQuestionSpikes } from "@/cdp/segments";
import { contentGroups } from "@/cdp/crossPost";
import { engagementRate } from "@/crm/rules";
import { addDays, daysBetween, windowEnding } from "@/lib/dates";

export type PlatformKey = "tiktok" | "instagram" | "youtube";
export const PLATFORM_KEYS: PlatformKey[] = ["tiktok", "instagram", "youtube"];

export interface Kpi {
  total: number;
  prev: number;
  byPlatform: Record<PlatformKey, number>;
}

/** Per-platform totals. Where account-level daily data exists (e.g. TikTok Studio overview), it wins over summed posts. */
function metricTotals(db: DB, start: string, end: string) {
  const fromPosts = postTotals(db, start, end);
  const acct = db
    .select({
      platformId: accountDaily.platformId,
      views: sql<number>`coalesce(sum(${accountDaily.views}), 0)`,
      likes: sql<number>`coalesce(sum(${accountDaily.likes}), 0)`,
      comments: sql<number>`coalesce(sum(${accountDaily.comments}), 0)`,
      shares: sql<number>`coalesce(sum(${accountDaily.shares}), 0)`,
      newFollowers: sql<number>`coalesce(sum(${accountDaily.newFollowers}), 0)`,
    })
    .from(accountDaily)
    .where(and(gte(accountDaily.date, start), lte(accountDaily.date, end)))
    .groupBy(accountDaily.platformId)
    .all();
  const out = fromPosts.filter((r) => !acct.some((a) => a.platformId === r.platformId));
  for (const a of acct) out.push({ ...a, saves: fromPosts.find((r) => r.platformId === a.platformId)?.saves ?? 0 });
  return out;
}

function postTotals(db: DB, start: string, end: string) {
  return db
    .select({
      platformId: contents.platformId,
      views: sql<number>`coalesce(sum(${contentMetricsDaily.views}), 0)`,
      likes: sql<number>`coalesce(sum(${contentMetricsDaily.likes}), 0)`,
      comments: sql<number>`coalesce(sum(${contentMetricsDaily.comments}), 0)`,
      shares: sql<number>`coalesce(sum(${contentMetricsDaily.shares}), 0)`,
      saves: sql<number>`coalesce(sum(${contentMetricsDaily.saves}), 0)`,
      newFollowers: sql<number>`coalesce(sum(${contentMetricsDaily.newFollowers}), 0)`,
    })
    .from(contentMetricsDaily)
    .innerJoin(contents, eq(contents.id, contentMetricsDaily.contentId))
    .where(and(gte(contentMetricsDaily.date, start), lte(contentMetricsDaily.date, end)))
    .groupBy(contents.platformId)
    .all();
}

function pqCounts(db: DB, start: string, end: string) {
  const day = sql<string>`substr(${comments.createdAt}, 1, 10)`;
  return db
    .select({ platformId: comments.platformId, n: sql<number>`count(*)` })
    .from(comments)
    .where(and(eq(comments.category, "product_question"), ANALYTICS_OK, gte(day, start), lte(day, end)))
    .groupBy(comments.platformId)
    .all();
}

function toKpi(cur: { platformId: string; v: number }[], prev: { platformId: string; v: number }[]): Kpi {
  const byPlatform = Object.fromEntries(PLATFORM_KEYS.map((p) => [p, cur.find((r) => r.platformId === p)?.v ?? 0])) as Record<PlatformKey, number>;
  return { total: cur.reduce((s, r) => s + r.v, 0), prev: prev.reduce((s, r) => s + r.v, 0), byPlatform };
}

export function overviewData(db: DB, today: string, range: number) {
  const { start, end } = windowEnding(today, range);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(range - 1));
  const cur = metricTotals(db, start, end);
  const prev = metricTotals(db, prevStart, prevEnd);

  const kpiOf = (pick: (r: (typeof cur)[number]) => number) =>
    toKpi(
      cur.map((r) => ({ platformId: r.platformId, v: pick(r) })),
      prev.map((r) => ({ platformId: r.platformId, v: pick(r) })),
    );
  const erRow = (rows: typeof cur) =>
    engagementRate(rows.reduce((a, r) => ({ views: a.views + r.views, likes: a.likes + r.likes, comments: a.comments + r.comments, shares: a.shares + r.shares, saves: a.saves + r.saves }), { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 }));
  const er: Kpi = {
    total: erRow(cur),
    prev: erRow(prev),
    byPlatform: Object.fromEntries(PLATFORM_KEYS.map((p) => [p, erRow(cur.filter((r) => r.platformId === p))])) as Record<PlatformKey, number>,
  };
  const pqCur = pqCounts(db, start, end);
  const pqPrev = pqCounts(db, prevStart, prevEnd);

  // Daily views per platform
  const daily = db
    .select({ date: contentMetricsDaily.date, platformId: contents.platformId, views: sql<number>`sum(${contentMetricsDaily.views})` })
    .from(contentMetricsDaily)
    .innerJoin(contents, eq(contents.id, contentMetricsDaily.contentId))
    .where(and(gte(contentMetricsDaily.date, start), lte(contentMetricsDaily.date, end)))
    .groupBy(contentMetricsDaily.date, contents.platformId)
    .all();
  const acctDaily = db
    .select({ date: accountDaily.date, platformId: accountDaily.platformId, views: accountDaily.views })
    .from(accountDaily)
    .where(and(gte(accountDaily.date, start), lte(accountDaily.date, end)))
    .all();
  const acctPlatforms = new Set(acctDaily.map((r) => r.platformId));
  const series = daysBetween(start, end).map((date) => {
    const row: Record<string, number | string> = { date };
    for (const p of PLATFORM_KEYS)
      row[p] = (acctPlatforms.has(p) ? acctDaily.find((d) => d.date === date && d.platformId === p) : daily.find((d) => d.date === date && d.platformId === p))?.views ?? 0;
    return row as { date: string } & Record<PlatformKey, number>;
  });

  // Top content in the window: one row per video, with its posts on every platform added together
  const posts = db
    .select({
      id: contents.id,
      title: contents.title,
      platformId: contents.platformId,
      type: contents.type,
      isSponsored: contents.isSponsored,
      dealId: contents.dealId,
      postedAt: contents.postedAt,
      views: sql<number>`sum(${contentMetricsDaily.views})`,
      likes: sql<number>`sum(${contentMetricsDaily.likes})`,
      comments: sql<number>`sum(${contentMetricsDaily.comments})`,
      shares: sql<number>`sum(${contentMetricsDaily.shares})`,
      saves: sql<number>`sum(${contentMetricsDaily.saves})`,
      newFollowers: sql<number>`sum(${contentMetricsDaily.newFollowers})`,
    })
    .from(contentMetricsDaily)
    .innerJoin(contents, eq(contents.id, contentMetricsDaily.contentId))
    .where(and(gte(contentMetricsDaily.date, start), lte(contentMetricsDaily.date, end)))
    .groupBy(contents.id)
    .all();
  const { top, pieces } = topContent(db, posts);

  return {
    window: { start, end, prevStart, prevEnd },
    kpis: {
      views: kpiOf((r) => r.views),
      followers: kpiOf((r) => r.newFollowers),
      er,
      pq: toKpi(
        pqCur.map((r) => ({ platformId: r.platformId, v: r.n })),
        pqPrev.map((r) => ({ platformId: r.platformId, v: r.n })),
      ),
    },
    series,
    top,
    pieces,
    insight: insightData(db, start, end),
    spikes: productQuestionSpikes(db, today).filter((s) => s.isSpike),
  };
}

type PostRow = {
  id: number;
  title: string;
  platformId: string;
  type: (typeof contents.$inferSelect)["type"];
  isSponsored: boolean;
  dealId: number | null;
  postedAt: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  newFollowers: number;
};

export interface TopContent {
  key: string;
  /** Caption of the post with the most views. */
  title: string;
  /** Every platform's caption, for the tooltip. */
  titles: string[];
  type: PostRow["type"];
  isSponsored: boolean;
  postedAt: string; // first post
  posts: { id: number; platformId: PlatformKey; views: number }[]; // most views first
  views: number;
  newFollowers: number;
  er: number;
}

/**
 * Groups the window's posts into videos (src/cdp/crossPost.ts: the same video on several platforms
 * is one piece), adds up their numbers and ranks by total views. Members of a video whose post had
 * no activity in the window still show, with 0 views, so the video stays complete.
 */
function topContent(db: DB, rows: PostRow[], limit = 8): { top: TopContent[]; pieces: { videos: number; posts: number } } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const groups = contentGroups(db).filter((g) => g.some((id) => byId.has(id)));
  const missing = groups.flat().filter((id) => !byId.has(id));
  if (missing.length) {
    for (const c of db.select().from(contents).where(inArray(contents.id, missing)).all()) {
      byId.set(c.id, { ...c, views: 0, likes: 0, comments: 0, shares: 0, saves: 0, newFollowers: 0 });
    }
  }
  const top = groups
    .map((g): TopContent => {
      const members = g.map((id) => byId.get(id)!).sort((a, b) => b.views - a.views || a.postedAt.localeCompare(b.postedAt));
      const sum = (k: "views" | "likes" | "comments" | "shares" | "saves" | "newFollowers") => members.reduce((n, m) => n + (m[k] ?? 0), 0);
      const first = [...members].sort((a, b) => a.postedAt.localeCompare(b.postedAt))[0];
      return {
        key: members.map((m) => m.id).join("-"),
        title: members[0].title,
        titles: members.map((m) => m.title),
        type: members[0].type,
        isSponsored: members.some((m) => m.isSponsored),
        postedAt: first.postedAt,
        posts: members.map((m) => ({ id: m.id, platformId: m.platformId as PlatformKey, views: m.views })),
        views: sum("views"),
        newFollowers: sum("newFollowers"),
        er: engagementRate({ views: sum("views"), likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), saves: sum("saves") }),
      };
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
  return { top, pieces: { videos: groups.length, posts: groups.flat().length } };
}

/**
 * AI Insight (rule-based): for each platform, followers gained per 1,000 views by
 * content type within the window (types with ≥ 3 posts). Headline = the
 * platform/type with the largest lift over that platform's average.
 */
export function insightData(db: DB, start: string, end: string) {
  const rows = db
    .select({
      platformId: contents.platformId,
      type: contents.type,
      posts: sql<number>`count(distinct ${contents.id})`,
      views: sql<number>`sum(${contentMetricsDaily.views})`,
      followers: sql<number>`sum(${contentMetricsDaily.newFollowers})`,
    })
    .from(contentMetricsDaily)
    .innerJoin(contents, eq(contents.id, contentMetricsDaily.contentId))
    .where(and(gte(contentMetricsDaily.date, start), lte(contentMetricsDaily.date, end)))
    .groupBy(contents.platformId, contents.type)
    .all();
  const perPlatform = PLATFORM_KEYS.map((p) => {
    const mine = rows.filter((r) => r.platformId === p);
    const views = mine.reduce((s, r) => s + r.views, 0);
    const followers = mine.reduce((s, r) => s + r.followers, 0);
    const avg = views ? (followers / views) * 1000 : 0;
    const types = mine
      .filter((r) => r.posts >= 3 && r.views > 0 && r.followers > 0) // no per-post follower data → no claim
      .map((r) => ({ type: r.type, posts: r.posts, fpk: (r.followers / r.views) * 1000 }))
      .sort((a, b) => b.fpk - a.fpk);
    const best = types[0];
    return { platformId: p, avg, types, best, lift: best && avg ? best.fpk / avg : 0 };
  });
  const headline = [...perPlatform].filter((p) => p.best).sort((a, b) => b.lift - a.lift)[0] ?? null;
  return { perPlatform, headline };
}

export function openTasks(db: DB, limit?: number) {
  const q = db.select().from(tasks).where(eq(tasks.status, "open")).orderBy(desc(tasks.forDate), tasks.id);
  return limit ? q.limit(limit).all() : q.all();
}

export function platformList(db: DB) {
  return db.select().from(platforms).all();
}
