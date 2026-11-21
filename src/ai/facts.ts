/**
 * The facts Ask AI is allowed to use, read straight from the database.
 * Both engines answer from this object only, so every answer is grounded in
 * real rows and can cite the page those rows come from.
 *
 * Privacy: aggregates and (fictional) brand names only — no comment text and
 * no audience pseudo IDs, because this object may be sent to an LLM.
 */
import type { DB } from "@/db/client";
import { computeBrandStats } from "@/crm/brandStats";
import { creatorSponsoredMedianEr, recommendNextOffer } from "@/crm/nextOffer";
import { financeData } from "@/crm/finance";
import { productQuestionSpikes, audienceAsOf, totalFollowers } from "@/cdp/segments";
import { audienceSegments } from "@/cdp/profiles";
import { overviewData, openTasks } from "@/lib/queries/overview";
import { listThreads } from "@/inbox/queries";
import { presentTask } from "@/automation/present";
import type { I18n } from "@/lib/i18n";

export type SourceId = string; // "brand:3", "finance", "overview", "audience", "inbox", "inbox:3", "automation"

export function sourceHref(id: SourceId): string | null {
  const [kind, arg] = id.split(":");
  switch (kind) {
    case "brand":
      return arg ? `/brands/${arg}` : "/brands";
    case "inbox":
      return arg ? `/inbox?thread=${arg}` : "/inbox";
    case "finance":
      return "/finance";
    case "overview":
      return "/";
    case "audience":
      return "/audience";
    case "automation":
      return "/automation";
    default:
      return null;
  }
}

export function gatherFacts(db: DB, today: string, i18n: I18n) {
  const stats = computeBrandStats(db, today);
  const medianEr = creatorSponsoredMedianEr(db, today);
  const brands = stats.map((s) => {
    const offer = s.jobs > 0 || s.openDeals > 0 ? recommendNextOffer(db, s, today, undefined, medianEr, i18n.t) : null;
    return {
      id: s.brand.id,
      name: s.brand.name,
      category: s.brand.category,
      tier: s.tier,
      valueThisYear: s.dealValueThisYear,
      lifetimeValue: s.lifetimeValue,
      jobs: s.jobs,
      paidDeals12m: s.paidInWindow,
      daysSinceLastJob: s.daysSinceLastJob,
      daysSinceLastContact: s.daysSinceLastActivity,
      silent: s.isSilent,
      openDeals: s.deals.filter((d) => d.stage !== "paid").map((d) => ({ title: d.title, stage: d.stage, value: d.value })),
      nextOffer: offer && { title: offer.title, price: offer.price, why: offer.reason },
    };
  });

  const fin = financeData(db, today);
  const ov = overviewData(db, today, 28);
  const aud = audienceAsOf(db, today);
  const seg = audienceSegments(db, today);
  const threads = listThreads(db, today);

  return {
    today,
    brands,
    unpaidInvoices: fin.rows
      .filter((r) => r.status !== "paid")
      .map((r) => ({ number: r.number, brandId: r.brandId, brand: r.brandName, deal: r.dealTitle, amount: r.amount, status: r.status, daysOverdue: r.daysOverdue, dueAt: r.dueAt })),
    finance: {
      incomeThisYear: fin.kpis.incomeYtd,
      incomeSamePeriodLastYear: fin.kpis.incomePrevYtd,
      outstanding: fin.kpis.outstanding,
      overdue: fin.kpis.overdue,
      avgDaysToPay: fin.kpis.avgDaysToPay,
      expectedFromWonDeals: fin.kpis.expected,
      expectedDeals: fin.expected.map((d) => ({ brand: d.brandName, deal: d.title, stage: d.stage, value: d.value })),
      topBrands12m: fin.byBrand.slice(0, 5).map((b) => ({ brandId: b.brandId, brand: b.brandName, income: b.income })),
      incomeByPlatform12m: Object.fromEntries(Object.entries(fin.byPlatform).map(([k, v]) => [k, Math.round(v)])),
      monthlyIncome: fin.monthly,
    },
    content: {
      window: ov.window,
      totals28d: { views: ov.kpis.views.total, newFollowers: ov.kpis.newFollowers.total, er: ov.kpis.er.total, productQuestions: ov.kpis.pq.total },
      // One entry per video: the same video on several platforms is added together.
      top: ov.top.slice(0, 5).map((c) => ({ title: c.title, platforms: c.posts.map((p) => p.platformId), viewsByPlatform: Object.fromEntries(c.posts.map((p) => [p.platformId, p.views])), type: c.type, views: c.views, er: c.er, sponsored: c.isSponsored })),
      bestTypeForFollowers: ov.insight.headline && ov.insight.headline.best ? { platform: ov.insight.headline.platformId, type: ov.insight.headline.best.type, followersPer1kViews: ov.insight.headline.best.fpk, liftVsPlatformAvg: ov.insight.headline.lift } : null,
    },
    productQuestions7d: productQuestionSpikes(db, today).map((s) => ({ category: s.category, recent: s.recent, ratioVsBaseline: Number.isFinite(s.ratio) ? s.ratio : null, isSpike: s.isSpike })),
    audience: {
      totalFollowers: totalFollowers(aud),
      platforms: aud.map((a) => ({ platform: a.platformId, followers: a.followers, topAge: a.topAge?.bucket ?? null, femalePct: a.femalePct, thailandPct: a.thPct })),
      segments90d: Object.fromEntries(seg.summaries.map((s) => [s.id, s.size])),
    },
    inbox: {
      unread: threads.reduce((s, t) => s + t.unread, 0),
      threads: threads
        .filter((t) => t.unread || t.newBriefs)
        .map((t) => ({ brandId: t.brandId, brand: t.brandName, unread: t.unread, newBrief: t.newBriefs > 0, lastMessage: t.last.body.slice(0, 160), brief: t.newBriefs ? t.last.brief : null })),
    },
    openTasks: openTasks(db).map((tk) => ({ title: presentTask(i18n, tk).title, rule: tk.ruleId, brandId: tk.brandId })),
  };
}

export type Facts = ReturnType<typeof gatherFacts>;
