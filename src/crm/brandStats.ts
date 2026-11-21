/**
 * Brand-level rollups computed from deals + activities, relative to a given "today".
 * Used by the brand list, Brand 360, next-offer rules and automations so every
 * screen agrees on the same numbers. Definitions live in ./rules.ts.
 */
import type { DB } from "@/db/client";
import { activities, brandContacts, brands, deals } from "@/db/schema";
import { addDays, diffDays } from "@/lib/dates";
import { SILENT_DAYS, TIER_WINDOW_DAYS, isOpen, isWon, tierFor, type Tier } from "./rules";

export type Deal = typeof deals.$inferSelect;
export type Brand = typeof brands.$inferSelect;

export interface BrandStats {
  brand: Brand;
  contact: typeof brandContacts.$inferSelect | null;
  tier: Tier;
  paidInWindow: number;
  dealValueThisYear: number;
  jobs: number;
  lifetimeValue: number;
  avgDealSize: number;
  lastJobAt: string | null;
  daysSinceLastJob: number | null;
  lastActivityAt: string | null;
  daysSinceLastActivity: number | null;
  openDeals: number;
  isSilent: boolean;
  deals: Deal[];
}

/** Deals as they were known on `today` (created on or before it). */
function dealsAsOf(all: Deal[], today: string) {
  return all.filter((d) => d.createdAt.slice(0, 10) <= today);
}

export function computeBrandStats(db: DB, today: string): BrandStats[] {
  const allBrands = db.select().from(brands).all();
  const allDeals = dealsAsOf(db.select().from(deals).all(), today);
  const allActs = db.select({ brandId: activities.brandId, at: activities.occurredAt }).from(activities).all();
  const contacts = db.select().from(brandContacts).all();
  const windowStart = addDays(today, -(TIER_WINDOW_DAYS - 1));
  const year = today.slice(0, 4);

  return allBrands.map((brand) => {
    const ds = allDeals.filter((d) => d.brandId === brand.id);
    const paidInWindow = ds.filter((d) => d.stage === "paid" && d.closedAt && d.closedAt.slice(0, 10) >= windowStart && d.closedAt.slice(0, 10) <= today).length;
    const won = ds.filter((d) => isWon(d.stage)); // committed (Production or later), paid or not
    const paid = ds.filter((d) => d.stage === "paid"); // jobs and lifetime value are money actually earned
    const lifetimeValue = paid.reduce((s, d) => s + d.value, 0);
    const dealValueThisYear = won.filter((d) => d.createdAt.startsWith(year)).reduce((s, d) => s + d.value, 0);
    const posted = ds.map((d) => d.postedAt).filter((p): p is string => !!p && p.slice(0, 10) <= today).sort();
    const lastJobAt = posted.at(-1) ?? null;
    const acts = allActs.filter((a) => a.brandId === brand.id && a.at.slice(0, 10) <= today).map((a) => a.at).sort();
    const lastActivityAt = acts.at(-1) ?? null;
    const daysSinceLastActivity = lastActivityAt ? diffDays(lastActivityAt, today) : null;
    const openDeals = ds.filter((d) => isOpen(d.stage)).length;
    return {
      brand,
      contact: contacts.find((c) => c.brandId === brand.id && c.isPrimary) ?? null,
      tier: tierFor(paidInWindow),
      paidInWindow,
      dealValueThisYear,
      jobs: paid.length,
      lifetimeValue,
      avgDealSize: paid.length ? Math.round(lifetimeValue / paid.length) : 0,
      lastJobAt,
      daysSinceLastJob: lastJobAt ? diffDays(lastJobAt, today) : null,
      lastActivityAt,
      daysSinceLastActivity,
      openDeals,
      isSilent: won.length > 0 && openDeals === 0 && daysSinceLastActivity !== null && daysSinceLastActivity >= SILENT_DAYS,
      deals: ds,
    };
  });
}
