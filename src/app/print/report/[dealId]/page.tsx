/**
 * Performance report for one deal: metrics at +7 and +30 days after posting,
 * plus product-question comments on those posts. Every figure comes from
 * content_metrics_daily / comments rows via crm/contentPerformance.ts.
 */
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { brands, comments, deals } from "@/db/schema";
import { ANALYTICS_OK } from "@/cdp/consent";
import { contentPerformance, sponsoredContentIdsForDeals, type ContentPerformance, type MetricTotals } from "@/crm/contentPerformance";
import { engagementRate } from "@/crm/rules";
import { getStoryDate } from "@/lib/queries/settings";
import { PrintFooter, PrintHeader } from "@/components/PrintHeader";
import { PlatformTag } from "@/components/ui";
import { addDays } from "@/lib/dates";
import { num, pct } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.report.title };
}

function totals(rows: (MetricTotals | null)[]): MetricTotals {
  const s = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, profileViews: 0, newFollowers: 0, er: 0 };
  for (const r of rows) if (r) for (const k of Object.keys(s) as (keyof MetricTotals)[]) if (k !== "er") s[k] += r[k];
  return { ...s, er: engagementRate(s) };
}

async function Section({ title, days, perf, posted, today }: { title: string; days: 7 | 30; perf: ContentPerformance[]; posted: string; today: string }) {
  const { t, date } = await getI18n();
  const pick = (p: ContentPerformance) => (days === 7 ? p.d7 : p.d30);
  const ready = perf.every((p) => pick(p));
  const tot = totals(perf.map(pick));
  const pq = perf.reduce((s, p) => s + (days === 7 ? p.productQuestions7 : p.productQuestions30), 0);
  const cols: { key: keyof MetricTotals; label: string; fmt: (n: number) => string }[] = [
    { key: "views", label: t.common.views, fmt: num },
    { key: "likes", label: t.common.likes, fmt: num },
    { key: "comments", label: t.common.comments, fmt: num },
    { key: "shares", label: t.common.shares, fmt: num },
    { key: "saves", label: t.common.saves, fmt: num },
    { key: "er", label: t.common.erShort, fmt: (x) => pct(x, 2) },
    { key: "newFollowers", label: t.common.newFollowers, fmt: num },
  ];
  return (
    <section className="mb-8 break-inside-avoid">
      <h2 className="mb-3 text-lg font-medium">{title}</h2>
      {!ready ? (
        <p className="rounded-lg bg-paper p-4 text-sm text-muted">{fmt(t.report.pending, { n: days, date: date(addDays(posted, days)) })}</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-line p-3">
              <div className="text-xs text-muted">{t.common.views}</div>
              <div className="tabular font-heading text-2xl font-semibold">{num(tot.views)}</div>
            </div>
            <div className="rounded-lg border border-line p-3">
              <div className="text-xs text-muted">{t.common.er}</div>
              <div className="tabular font-heading text-2xl font-semibold">{pct(tot.er, 2)}</div>
            </div>
            <div className="rounded-lg border border-accent/40 bg-accent-soft/40 p-3">
              <div className="text-xs text-muted">{t.report.pqTitle}</div>
              <div className="tabular font-heading text-2xl font-semibold text-accent-strong">{num(pq)}</div>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink text-left text-xs text-muted">
                <th className="py-2 font-normal">{t.common.platform}</th>
                {cols.map((c) => (
                  <th key={c.key} className="py-2 text-right font-normal">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {perf.map((p) => (
                <tr key={p.contentId} className="border-b border-line">
                  <td className="py-2">
                    <PlatformTag id={p.platformId} />
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className="py-2 text-right">
                      {c.fmt(pick(p)![c.key])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-2">{t.common.total}</td>
                {cols.map((c) => (
                  <td key={c.key} className="py-2 text-right">
                    {c.fmt(tot[c.key])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export default async function ReportPrint({ params }: { params: Promise<{ dealId: string }> }) {
  const { t, date, dateShort } = await getI18n();
  const { dealId } = await params;
  const db = getDb();
  const today = getStoryDate(db);
  const deal = db.select().from(deals).where(eq(deals.id, Number(dealId))).get();
  if (!deal || !deal.postedAt) notFound();
  const brand = db.select().from(brands).where(eq(brands.id, deal.brandId)).get()!;
  const ids = sponsoredContentIdsForDeals(db, [deal.id]);
  const perf = contentPerformance(db, ids, today);
  const posted = deal.postedAt.slice(0, 10);
  const examples = ids.length
    ? db
        .select({ text: comments.text, who: comments.authorPseudoId, at: comments.createdAt })
        .from(comments)
        .where(and(inArray(comments.contentId, ids), eq(comments.category, "product_question"), ANALYTICS_OK))
        .orderBy(desc(comments.createdAt))
        .limit(6)
        .all()
        .filter((c) => c.at.slice(0, 10) <= today)
    : [];

  return (
    <article>
      <PrintHeader
        title={t.report.title}
        right={
          <dl className="space-y-0.5">
            <div>
              <dt className="inline text-muted">{t.report.for} </dt>
              <dd className="inline font-medium">{brand.name}</dd>
            </div>
            <div>
              <dt className="inline text-muted">{t.report.campaign} </dt>
              <dd className="inline">{deal.title}</dd>
            </div>
            <div>
              <dt className="inline text-muted">{t.report.posted} </dt>
              <dd className="inline">{date(posted)}</dd>
            </div>
          </dl>
        }
      />
      <ul className="mb-8 space-y-1 text-sm">
        {perf.map((p) => (
          <li key={p.contentId} className="flex items-center gap-3">
            <PlatformTag id={p.platformId} />
            <span>{p.title}</span>
          </li>
        ))}
      </ul>
      <Section title={t.report.at7} days={7} perf={perf} posted={posted} today={today} />
      <Section title={t.report.at30} days={30} perf={perf} posted={posted} today={today} />
      <section className="break-inside-avoid">
        <h2 className="text-lg font-medium">{t.report.pqTitle}</h2>
        <p className="mb-3 text-xs text-muted">{t.report.pqHint}</p>
        <ul className="space-y-1.5 text-sm">
          {examples.map((c, i) => (
            <li key={i} className="rounded-lg bg-paper px-3 py-2">
              <span className="text-xs text-muted">{c.who} · </span>“{c.text}”
            </li>
          ))}
        </ul>
      </section>
      <PrintFooter />
    </article>
  );
}
