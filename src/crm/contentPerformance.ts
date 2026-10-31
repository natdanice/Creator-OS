/**
 * Post-level performance used by Brand 360, the report generator and automations.
 * "+N days" = cumulative metrics for the N days starting on the posting day
 * (day 0 … day N−1). It is only "complete" once today ≥ posted + N.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { comments, contentMetricsDaily, contents } from "@/db/schema";
import { ANALYTICS_OK } from "@/cdp/consent";
import { addDays } from "@/lib/dates";
import { engagementRate } from "./rules";

export interface MetricTotals {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  profileViews: number;
  newFollowers: number;
  er: number;
}

export interface ContentPerformance {
  contentId: number;
  platformId: string;
  title: string;
  type: string;
  productCategory: string;
  postedAt: string;
  dealId: number | null;
  d7: MetricTotals | null; // null until complete
  d30: MetricTotals | null;
  toDate: MetricTotals;
  productQuestions7: number;
  productQuestions30: number;
  productQuestionsToDate: number;
}

const zero = (): MetricTotals => ({ views: 0, likes: 0, comments: 0, shares: 0, saves: 0, profileViews: 0, newFollowers: 0, er: 0 });

export function contentPerformance(db: DB, contentIds: number[], today: string): ContentPerformance[] {
  if (contentIds.length === 0) return [];
  const posts = db.select().from(contents).where(inArray(contents.id, contentIds)).all();
  const rows = db
    .select()
    .from(contentMetricsDaily)
    .where(and(inArray(contentMetricsDaily.contentId, contentIds), lte(contentMetricsDaily.date, today)))
    .all();
  const pq = db
    .select({ contentId: comments.contentId, day: sql<string>`substr(${comments.createdAt}, 1, 10)` })
    .from(comments)
    .where(and(inArray(comments.contentId, contentIds), eq(comments.category, "product_question"), ANALYTICS_OK))
    .all();

  return posts.map((p) => {
    const posted = p.postedAt.slice(0, 10);
    const end7 = addDays(posted, 6);
    const end30 = addDays(posted, 29);
    const t7 = zero();
    const t30 = zero();
    const tAll = zero();
    for (const r of rows) {
      if (r.contentId !== p.id) continue;
      for (const [tot, ok] of [
        [t7, r.date <= end7],
        [t30, r.date <= end30],
        [tAll, true],
      ] as const) {
        if (!ok) continue;
        tot.views += r.views;
        tot.likes += r.likes;
        tot.comments += r.comments;
        tot.shares += r.shares;
        tot.saves += r.saves;
        tot.profileViews += r.profileViews;
        tot.newFollowers += r.newFollowers;
      }
    }
    for (const t of [t7, t30, tAll]) t.er = engagementRate(t);
    const mine = pq.filter((c) => c.contentId === p.id && c.day <= today);
    return {
      contentId: p.id,
      platformId: p.platformId,
      title: p.title,
      type: p.type,
      productCategory: p.productCategory,
      postedAt: p.postedAt,
      dealId: p.dealId,
      d7: today >= addDays(posted, 7) ? t7 : null,
      d30: today >= addDays(posted, 30) ? t30 : null,
      toDate: tAll,
      productQuestions7: mine.filter((c) => c.day <= end7).length,
      productQuestions30: mine.filter((c) => c.day <= end30).length,
      productQuestionsToDate: mine.length,
    };
  });
}

export function sponsoredContentIdsForDeals(db: DB, dealIds: number[]): number[] {
  if (dealIds.length === 0) return [];
  return db
    .select({ id: contents.id })
    .from(contents)
    .where(inArray(contents.dealId, dealIds))
    .all()
    .map((r) => r.id);
}
