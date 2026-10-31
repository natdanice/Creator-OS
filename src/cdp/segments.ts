/**
 * CDP stage 3 — SEGMENT / ANALYTICS.
 * Reusable audience segments and signals computed from consented data only.
 * Consumed by the marketing/sales side (CRM, automations, Overview).
 */
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { audienceBreakdown, audienceSnapshots, comments, contents, platforms, PRODUCT_CATEGORIES, type ProductCategory } from "@/db/schema";
import { ANALYTICS_OK } from "./consent";
import { addDays, monthOf } from "@/lib/dates";

/** Spike rule parameters — documented here and shown on the Automation page. */
export const SPIKE = { recentDays: 7, baselineDays: 28, ratio: 3, minRecent: 20 } as const;

export interface CategorySpike {
  category: ProductCategory;
  recent: number; // product questions in the last 7 days
  baseline: number; // product questions in the 28 days before that
  recentPerDay: number;
  baselinePerDay: number;
  ratio: number;
  isSpike: boolean;
}

/** Segment: product-question comments per product category, recent window vs baseline. */
export function productQuestionSpikes(db: DB, today: string): CategorySpike[] {
  const recentStart = addDays(today, -(SPIKE.recentDays - 1));
  const baseStart = addDays(recentStart, -SPIKE.baselineDays);
  const day = sql<string>`substr(${comments.createdAt}, 1, 10)`;
  const rows = db
    .select({
      category: contents.productCategory,
      recent: sql<number>`sum(case when ${day} >= ${recentStart} then 1 else 0 end)`,
      baseline: sql<number>`sum(case when ${day} < ${recentStart} then 1 else 0 end)`,
    })
    .from(comments)
    .innerJoin(contents, eq(contents.id, comments.contentId))
    .where(and(eq(comments.category, "product_question"), ANALYTICS_OK, gte(day, baseStart), lte(day, today)))
    .groupBy(contents.productCategory)
    .all();
  return PRODUCT_CATEGORIES.map((category) => {
    const r = rows.find((x) => x.category === category);
    const recent = r?.recent ?? 0;
    const baseline = r?.baseline ?? 0;
    const recentPerDay = recent / SPIKE.recentDays;
    const baselinePerDay = baseline / SPIKE.baselineDays;
    const ratio = baselinePerDay > 0 ? recentPerDay / baselinePerDay : recent > 0 ? Infinity : 0;
    return { category, recent, baseline, recentPerDay, baselinePerDay, ratio, isSpike: recent >= SPIKE.minRecent && ratio >= SPIKE.ratio };
  });
}

export interface PlatformAudience {
  platformId: string;
  platformName: string;
  month: string;
  followers: number;
  topAge: { bucket: string; pct: number } | null;
  femalePct: number | null;
  thPct: number | null;
}

/** Latest monthly snapshot per platform as of `asOf`. */
export function audienceAsOf(db: DB, asOf: string): PlatformAudience[] {
  const month = monthOf(asOf);
  return db
    .select()
    .from(platforms)
    .all()
    .map((p) => {
      const snap = db
        .select()
        .from(audienceSnapshots)
        .where(and(eq(audienceSnapshots.platformId, p.id), lte(audienceSnapshots.month, month)))
        .orderBy(desc(audienceSnapshots.month))
        .get();
      if (!snap) return { platformId: p.id, platformName: p.name, month, followers: 0, topAge: null, femalePct: null, thPct: null };
      const bd = db.select().from(audienceBreakdown).where(eq(audienceBreakdown.snapshotId, snap.id)).all();
      const ages = bd.filter((b) => b.dimension === "age").sort((a, b) => b.pct - a.pct);
      return {
        platformId: p.id,
        platformName: p.name,
        month: snap.month,
        followers: snap.followers,
        topAge: ages[0] ? { bucket: ages[0].bucket, pct: ages[0].pct } : null,
        femalePct: bd.find((b) => b.dimension === "gender" && b.bucket === "female")?.pct ?? null,
        thPct: bd.find((b) => b.dimension === "country" && b.bucket === "TH")?.pct ?? null,
      };
    });
}

export function totalFollowers(aud: PlatformAudience[]) {
  return aud.reduce((s, a) => s + a.followers, 0);
}
