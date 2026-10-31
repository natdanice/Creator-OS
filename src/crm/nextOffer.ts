/**
 * "Recommended next offer" — rule-based, first match wins. Each rule returns a
 * rate-card package and a human-readable reason with the numbers behind it.
 *
 *  1. Lead (never won)          → TT_VIDEO starter      (low-risk entry)
 *  2. Silent ≥ 120 days         → their last package    (re-engage with audience growth)
 *  3. Partner                   → RETAINER_Q            (lock in recurring revenue)
 *  4. Single-platform buyer whose sponsored ER ≥ creator's sponsored median → BUNDLE_3P
 *  5. ≥ 8 product questions per sponsored post → YT_DEDICATED
 *  6. Otherwise                 → last package + ADDON_USAGE
 */
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { contentMetricsDaily, contents, rateCard } from "@/db/schema";
import { audienceAsOf, totalFollowers } from "@/cdp/segments";
import { dataT, fmt, type Dict } from "@/lib/i18n";
import { baht, compactNum, num, pct, signedPct } from "@/lib/format";
import { DELIVERABLE_PLATFORM } from "./deliverables";
import { TIER_WINDOW_DAYS } from "./rules";
import { addDays } from "@/lib/dates";
import type { BrandStats } from "./brandStats";
import { contentPerformance, sponsoredContentIdsForDeals, type ContentPerformance } from "./contentPerformance";

export interface NextOffer {
  rule: "starter" | "reengage" | "retainer" | "bundle" | "dedicated" | "repeat";
  title: string;
  codes: string[];
  price: number;
  reason: string;
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function creatorSponsoredMedianEr(db: DB, today: string) {
  const ids = db.select({ id: contents.id }).from(contents).where(eq(contents.isSponsored, true)).all().map((r) => r.id);
  return median(contentPerformance(db, ids, today).map((p) => p.toDate.er));
}

function categoryAvgViews(db: DB, category: string) {
  const rows = db
    .select({ id: contents.id, views: sql<number>`sum(${contentMetricsDaily.views})` })
    .from(contents)
    .innerJoin(contentMetricsDaily, eq(contentMetricsDaily.contentId, contents.id))
    .where(eq(contents.productCategory, category as never))
    .groupBy(contents.id)
    .all();
  return rows.length ? rows.reduce((s, r) => s + r.views, 0) / rows.length : 0;
}

/** `t` picks the language of the title/reason: UI language on Brand 360, Thai (`dataT`) inside drafts. */
export function recommendNextOffer(db: DB, stats: BrandStats, today: string, perf?: ContentPerformance[], medianEr?: number, t: Dict = dataT): NextOffer {
  const cards = db.select().from(rateCard).all();
  const card = (code: string) => cards.find((c) => c.code === code)!;
  const pkgName = (codes: string[]) => codes.map((c) => card(c).name).join(" + ");
  const priceOf = (codes: string[]) => codes.reduce((s, c) => s + card(c).price, 0);
  const won = stats.deals.filter((d) => d.postedAt).sort((a, b) => (a.postedAt! < b.postedAt! ? -1 : 1));
  const last = won.at(-1);
  const lastCodes = last ? last.deliverables.filter((c) => card(c).kind !== "addon") : [];
  perf ??= contentPerformance(db, sponsoredContentIdsForDeals(db, stats.deals.map((d) => d.id)), today);

  const make = (rule: NextOffer["rule"], codes: string[], title: string, reason: string): NextOffer => ({ rule, codes, title, price: priceOf(codes), reason });

  // 1. Lead
  if (stats.jobs === 0) {
    return make(
      "starter",
      ["TT_VIDEO"],
      fmt(t.offers.starter, { pkg: card("TT_VIDEO").name }),
      fmt(t.offers.starterWhy, { category: t.categories[stats.brand.category], views: compactNum(categoryAvgViews(db, stats.brand.category)) }),
    );
  }

  // 2. Silent
  if (stats.isSilent && last) {
    const lastPerf = perf.filter((p) => p.dealId === last.id);
    const views = lastPerf.reduce((s, p) => s + (p.d30?.views ?? p.toDate.views), 0);
    const then = totalFollowers(audienceAsOf(db, last.postedAt!));
    const now = totalFollowers(audienceAsOf(db, today));
    return make(
      "reengage",
      lastCodes,
      fmt(t.offers.reengage, { pkg: pkgName(lastCodes) }),
      fmt(t.offers.reengageWhy, { days: stats.daysSinceLastActivity!, pkg: pkgName(lastCodes), views: num(views), growth: signedPct(then ? now / then - 1 : 0) }),
    );
  }

  // 3. Partner
  if (stats.tier === "partner") {
    const windowStart = addDays(today, -(TIER_WINDOW_DAYS - 1));
    const paidValue = stats.deals
      .filter((d) => d.stage === "paid" && d.closedAt && d.closedAt.slice(0, 10) >= windowStart && d.closedAt.slice(0, 10) <= today)
      .reduce((s, d) => s + d.value, 0);
    return make("retainer", ["RETAINER_Q"], t.offers.retainer, fmt(t.offers.retainerWhy, { n: stats.paidInWindow, value: baht(paidValue) }));
  }

  // 4. Single-platform buyer with strong ER
  const boughtPlatforms = new Set(
    stats.deals.flatMap((d) => d.deliverables.flatMap((c) => (card(c).includes.length ? card(c).includes : [c])).map((c) => DELIVERABLE_PLATFORM[c]).filter(Boolean)),
  );
  const brandEr = perf.length ? perf.reduce((s, p) => s + p.toDate.er, 0) / perf.length : 0;
  medianEr ??= creatorSponsoredMedianEr(db, today);
  if (boughtPlatforms.size === 1 && brandEr >= medianEr && perf.length) {
    const platform = t.platforms[[...boughtPlatforms][0] as "tiktok"];
    return make("bundle", ["BUNDLE_3P"], t.offers.bundle, fmt(t.offers.bundleWhy, { platform, er: pct(brandEr), median: pct(medianEr) }));
  }

  // 5. Lots of product questions
  const pqPerPost = perf.length ? perf.reduce((s, p) => s + p.productQuestionsToDate, 0) / perf.length : 0;
  if (pqPerPost >= 8 && !lastCodes.includes("YT_DEDICATED")) {
    return make("dedicated", ["YT_DEDICATED"], t.offers.dedicated, fmt(t.offers.dedicatedWhy, { n: pqPerPost.toFixed(1) }));
  }

  // 6. Repeat + usage rights
  const codes = [...(lastCodes.length ? lastCodes : ["TT_VIDEO"]), "ADDON_USAGE"];
  return make("repeat", codes, t.offers.repeat, fmt(t.offers.repeatWhy, { pkg: pkgName(lastCodes.length ? lastCodes : ["TT_VIDEO"]) }));
}
