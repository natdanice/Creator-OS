import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { comments, contentMetricsDaily, contents, platforms, tasks } from "@/db/schema";
import { ANALYTICS_OK } from "@/cdp/consent";
import { productQuestionSpikes } from "@/cdp/segments";
import { engagementRate } from "@/crm/rules";
import { addDays, daysBetween, windowEnding } from "@/lib/dates";

export type PlatformKey = "tiktok" | "instagram" | "youtube";
export const PLATFORM_KEYS: PlatformKey[] = ["tiktok", "instagram", "youtube"];

export interface Kpi {
  total: number;
  prev: number;
  byPlatform: Record<PlatformKey, number>;
}

function metricTotals(db: DB, start: string, end: string) {
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
  const series = daysBetween(start, end).map((date) => {
    const row: Record<string, number | string> = { date };
    for (const p of PLATFORM_KEYS) row[p] = daily.find((d) => d.date === date && d.platformId === p)?.views ?? 0;
    return row as { date: string } & Record<PlatformKey, number>;
  });

  // Top content in the window
  const top = db
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
    .orderBy(desc(sql`sum(${contentMetricsDaily.views})`))
    .limit(8)
    .all()
    .map((r) => ({ ...r, er: engagementRate(r) }));

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
    insight: insightData(db, start, end),
    spikes: productQuestionSpikes(db, today).filter((s) => s.isSpike),
  };
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
      .filter((r) => r.posts >= 3 && r.views > 0)
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
