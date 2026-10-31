/**
 * post_plus_7  — a sponsored post went live exactly 7 days ago  → draft the +7 performance report.
 * post_plus_30 — a sponsored post went live exactly 30 days ago → draft the +30 report + follow-up proposal.
 * One task per deal (a deal's deliverables are posted together). Dedupe: rule + deal.
 */
import { and, eq, sql } from "drizzle-orm";
import { contents, deals } from "@/db/schema";
import { contentPerformance, type ContentPerformance, type MetricTotals } from "@/crm/contentPerformance";
import { recommendNextOffer } from "@/crm/nextOffer";
import { engagementRate } from "@/crm/rules";
import { addDays } from "@/lib/dates";
import { baht, dateTh, num, pct } from "@/lib/format";
// Drafts go to Thai brands, so they are written in the data language.
import { dataT as t, fmt } from "@/lib/i18n";
import { APP_URL } from "@/lib/config";
import type { AutomationRule, RuleContext, TaskDraft } from "../types";

function sum(perf: ContentPerformance[], pick: (p: ContentPerformance) => MetricTotals | null) {
  const tot = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, newFollowers: 0 };
  for (const p of perf) {
    const m = pick(p);
    if (!m) continue;
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += m[k];
  }
  return { ...tot, er: engagementRate(tot) };
}

function makeRule(id: "post_plus_7" | "post_plus_30", days: 7 | 30): AutomationRule {
  return {
    id,
    evaluate(ctx: RuleContext): TaskDraft[] {
      const postedOn = addDays(ctx.today, -days);
      const dealIds = [
        ...new Set(
          ctx.db
            .select({ dealId: contents.dealId })
            .from(contents)
            .where(and(eq(contents.isSponsored, true), sql`substr(${contents.postedAt}, 1, 10) = ${postedOn}`))
            .all()
            .map((r) => r.dealId)
            .filter((x): x is number => x !== null),
        ),
      ];
      return dealIds.map((dealId) => {
        const deal = ctx.db.select().from(deals).where(eq(deals.id, dealId)).get()!;
        const stats = ctx.stats.find((s) => s.brand.id === deal.brandId)!;
        const ids = ctx.db.select({ id: contents.id }).from(contents).where(eq(contents.dealId, dealId)).all().map((r) => r.id);
        const perf = contentPerformance(ctx.db, ids, ctx.today);
        const pick = (p: ContentPerformance) => (days === 7 ? p.d7 : p.d30);
        const total = sum(perf, pick);
        const pq = perf.reduce((s, p) => s + (days === 7 ? p.productQuestions7 : p.productQuestions30), 0);
        const lines = perf
          .map((p) => {
            const m = pick(p);
            return m ? fmt(t.templates.reportLine, { platform: t.platforms[p.platformId as "tiktok"], views: num(m.views), er: pct(m.er), followers: num(m.newFollowers) }) : null;
          })
          .filter(Boolean)
          .join("\n");
        const link = `/print/report/${dealId}`;
        const publicLink = `${APP_URL}${link}`;
        const greeting = fmt(t.templates.greeting, { contact: stats.contact?.name ?? stats.brand.name });
        const vars = { greeting, deal: deal.title, lines, views: num(total.views), er: pct(total.er), pq, link: publicLink };
        let draftMessage: string;
        if (days === 7) {
          draftMessage = fmt(t.templates.report7, vars);
        } else {
          const offer = recommendNextOffer(ctx.db, stats, ctx.today, undefined, ctx.medianEr);
          draftMessage = fmt(t.templates.report30, { ...vars, offer: offer.title, price: baht(offer.price), why: offer.reason });
        }
        return {
          dedupeKey: `${id}:deal:${dealId}`,
          title: fmt(t.ruleTitles[id], { brand: stats.brand.name }),
          reason: fmt(t.ruleReasons[id], { deal: deal.title, posted: dateTh(postedOn) }),
          vars: { brand: stats.brand.name, deal: deal.title, posted: postedOn },
          draftMessage,
          brandId: deal.brandId,
          dealId,
          link,
        };
      });
    },
  };
}

export const postPlus7 = makeRule("post_plus_7", 7);
export const postPlus30 = makeRule("post_plus_30", 30);
