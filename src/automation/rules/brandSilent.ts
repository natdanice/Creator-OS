/**
 * brand_silent_120 — brand has ≥ 1 won deal, no open deal, and no activity for ≥ 120 days
 * (see crm/rules.ts). Drafts a re-engagement message with the latest audience stats.
 * Dedupe: brand + date of last activity (fires once per silence period, not daily).
 */
import { audienceAsOf, totalFollowers } from "@/cdp/segments";
import { recommendNextOffer } from "@/crm/nextOffer";
import { dateTh, num, baht, signedPct } from "@/lib/format";
import { fmt, t } from "@/lib/i18n";
import type { AutomationRule, TaskDraft } from "../types";

export const brandSilent: AutomationRule = {
  id: "brand_silent_120",
  evaluate(ctx): TaskDraft[] {
    const nowAud = audienceAsOf(ctx.db, ctx.today);
    const total = totalFollowers(nowAud);
    const biggest = [...nowAud].sort((a, b) => b.followers - a.followers)[0];
    return ctx.stats
      .filter((s) => s.isSilent)
      .map((s) => {
        const lastDeal = s.deals.filter((d) => d.postedAt).sort((a, b) => (a.postedAt! < b.postedAt! ? -1 : 1)).at(-1)!;
        const then = totalFollowers(audienceAsOf(ctx.db, s.lastJobAt ?? ctx.today));
        const growth = signedPct(then ? total / then - 1 : 0);
        const offer = recommendNextOffer(ctx.db, s, ctx.today, undefined, ctx.medianEr);
        const lines = nowAud.map((a) => fmt(t.templates.silentLine, { platform: a.platformName, followers: num(a.followers) })).join("\n");
        return {
          dedupeKey: `brand_silent_120:${s.brand.id}:${s.lastActivityAt!.slice(0, 10)}`,
          title: fmt(t.ruleTitles.brand_silent_120, { brand: s.brand.name, days: s.daysSinceLastActivity! }),
          reason: fmt(t.ruleReasons.brand_silent_120, { last: dateTh(s.lastActivityAt!), days: s.daysSinceLastActivity! }),
          draftMessage: fmt(t.templates.silent, {
            greeting: fmt(t.templates.greeting, { contact: s.contact?.name ?? s.brand.name }),
            deal: lastDeal.title,
            lines,
            total: num(total),
            growth,
            age: biggest?.topAge ? `${biggest.topAge.bucket} ปี (${biggest.topAge.pct}%)` : "-",
            category: t.categories[s.brand.category],
            offer: offer.title,
            price: baht(offer.price),
          }),
          brandId: s.brand.id,
          link: `/brands/${s.brand.id}`,
        };
      });
  },
};
