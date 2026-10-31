/**
 * pq_spike — product-question comments in a product category over the last 7 days,
 * per day, are ≥ 2× the daily average of the previous 28 days (and ≥ 15 in total).
 * Parameters: cdp/segments.ts → SPIKE. Internal alert listing brands to pitch.
 * Dedupe: category + ISO week.
 */
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { comments, contents } from "@/db/schema";
import { ANALYTICS_OK } from "@/cdp/consent";
import { productQuestionSpikes, SPIKE } from "@/cdp/segments";
import { TIERS } from "@/crm/rules";
import { addDays, isoWeekKey } from "@/lib/dates";
import { fmt, t } from "@/lib/i18n";
import type { AutomationRule, TaskDraft } from "../types";

export const pqSpike: AutomationRule = {
  id: "pq_spike",
  evaluate(ctx): TaskDraft[] {
    const recentStart = addDays(ctx.today, -(SPIKE.recentDays - 1));
    return productQuestionSpikes(ctx.db, ctx.today)
      .filter((s) => s.isSpike)
      .map((s) => {
        const day = sql<string>`substr(${comments.createdAt}, 1, 10)`;
        const examples = ctx.db
          .select({ text: comments.text, who: comments.authorPseudoId })
          .from(comments)
          .innerJoin(contents, eq(contents.id, comments.contentId))
          .where(and(eq(contents.productCategory, s.category), eq(comments.category, "product_question"), ANALYTICS_OK, gte(day, recentStart), lte(day, ctx.today)))
          .orderBy(desc(comments.createdAt))
          .limit(4)
          .all()
          .map((c) => `• ${c.who}: “${c.text}”`)
          .join("\n");
        const brands = ctx.stats
          .filter((b) => b.brand.category === s.category)
          .sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier))
          .map((b) =>
            fmt(t.templates.spikeBrand, {
              brand: b.brand.name,
              tier: t.tiers[b.tier],
              extra: b.isSilent ? ` · ${fmt(t.brands.silent, { n: b.daysSinceLastActivity! })}` : b.openDeals ? ` · ${b.openDeals} ${t.brands.colOpen}` : "",
            }),
          )
          .join("\n");
        const ratio = s.ratio.toFixed(1);
        const category = t.categories[s.category];
        return {
          dedupeKey: `pq_spike:${s.category}:${isoWeekKey(ctx.today)}`,
          title: fmt(t.ruleTitles.pq_spike, { category }),
          reason: fmt(t.ruleReasons.pq_spike, { recent: s.recent, recentPerDay: s.recentPerDay.toFixed(1), baselinePerDay: s.baselinePerDay.toFixed(1), ratio }),
          draftMessage: fmt(t.templates.spike, { category, ratio, recent: s.recent, examples, brands }),
          link: `/brands?category=${s.category}`,
        };
      });
  },
};
