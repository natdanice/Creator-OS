/**
 * Converts lifetime totals (Instagram, TikTok) into the daily deltas the CDP stores.
 *   first time a post is seen → its totals so far land on the posting day
 *   afterwards               → delta(today) = totals now − totals at the start of today
 * Re-syncing the same day overwrites today's delta with a bigger one, never double counts.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { metricTotals } from "@/db/schema";
import type { PlatformId, RawMetricDaily } from "@/cdp/adapters/PlatformAdapter";

export type Totals = Omit<RawMetricDaily, "contentExternalId" | "date">;
const KEYS: (keyof Totals)[] = ["views", "likes", "comments", "shares", "saves", "profileViews", "newFollowers"];

export function totalsToDeltas(db: DB, platform: PlatformId, today: string, posts: { externalId: string; postedOn: string; totals: Totals }[]): RawMetricDaily[] {
  const out: RawMetricDaily[] = [];
  for (const p of posts) {
    const row = db.select().from(metricTotals).where(and(eq(metricTotals.platformId, platform), eq(metricTotals.externalId, p.externalId))).get();
    const now = p.totals as Record<string, number>;
    if (!row) {
      const postedToday = p.postedOn >= today;
      out.push({ contentExternalId: p.externalId, date: postedToday ? today : p.postedOn, ...p.totals });
      const baseline = postedToday ? Object.fromEntries(KEYS.map((k) => [k, 0])) : now;
      db.insert(metricTotals).values({ platformId: platform, externalId: p.externalId, baselineDate: today, baseline, latest: now }).run();
      continue;
    }
    const baseline = row.baselineDate === today ? row.baseline : row.latest;
    const delta = Object.fromEntries(KEYS.map((k) => [k, Math.max(0, (now[k] ?? 0) - (baseline[k] ?? 0))])) as Totals;
    out.push({ contentExternalId: p.externalId, date: today, ...delta });
    db.update(metricTotals)
      .set({ baselineDate: today, baseline, latest: now })
      .where(and(eq(metricTotals.platformId, platform), eq(metricTotals.externalId, p.externalId)))
      .run();
  }
  return out;
}
