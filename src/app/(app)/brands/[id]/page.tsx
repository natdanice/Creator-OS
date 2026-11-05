/**
 * Brand 360 — CDP stage 4, the Single Customer Profile.
 * Joins deals + deliverables + linked content performance + invoices + activities.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { ArrowLeft, FileText, Sparkles } from "lucide-react";
import { getDb } from "@/db/client";
import { activities, invoices, rateCard } from "@/db/schema";
import { computeBrandStats } from "@/crm/brandStats";
import { contentPerformance, sponsoredContentIdsForDeals } from "@/crm/contentPerformance";
import { recommendNextOffer } from "@/crm/nextOffer";
import { getStoryDate } from "@/lib/queries/settings";
import { ButtonLink, Card, PageHeader, Pill, PlatformTag, StatStrip, StatTile, TierBadge } from "@/components/ui";
import { baht, num, pct } from "@/lib/format";
import { diffDays } from "@/lib/dates";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export default async function Brand360({ params }: { params: Promise<{ id: string }> }) {
  const { t, date, dateShort } = await getI18n();
  const { id } = await params;
  const db = getDb();
  const today = getStoryDate(db);
  const s = computeBrandStats(db, today).find((x) => x.brand.id === Number(id));
  if (!s) notFound();

  const dealIds = s.deals.map((d) => d.id);
  const perf = contentPerformance(db, sponsoredContentIdsForDeals(db, dealIds), today).sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1));
  const offer = recommendNextOffer(db, s, today, perf, undefined, t);
  const invs = dealIds.length ? db.select().from(invoices).where(inArray(invoices.dealId, dealIds)).all() : [];
  const acts = db.select().from(activities).where(eq(activities.brandId, s.brand.id)).orderBy(desc(activities.occurredAt)).all().filter((a) => a.occurredAt.slice(0, 10) <= today);
  const cards = db.select().from(rateCard).all();
  const cardName = (code: string) => cards.find((c) => c.code === code)?.name ?? code;
  const dealTitle = (dealId: number | null) => s.deals.find((d) => d.id === dealId)?.title ?? "";

  const kpis = [
    { label: t.brand360.kpiValueYear, value: baht(s.dealValueThisYear) },
    { label: t.brand360.kpiJobs, value: num(s.jobs) },
    { label: t.brand360.kpiAvg, value: s.jobs ? baht(s.avgDealSize) : t.common.none },
    { label: t.brand360.kpiLtv, value: baht(s.lifetimeValue) },
    { label: t.brand360.kpiDaysSince, value: s.daysSinceLastJob === null ? t.common.none : `${s.daysSinceLastJob} ${t.brand360.kpiDaysUnit}` },
  ];

  return (
    <>
      <Link href="/brands" className="no-print mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> {t.brands.title}
      </Link>
      <PageHeader
        title={s.brand.name}
        subtitle={[t.categories[s.brand.category], s.contact && `${t.brand360.contact}: ${s.contact.name} · ${s.contact.role} · ${t.channels[s.contact.channel]} ${s.contact.handle}`].filter(Boolean).join("  ·  ")}
        right={
          <div className="flex items-center gap-2">
            <TierBadge tier={s.tier} />
            {s.isSilent && <Pill tone="warn">{fmt(t.brands.silent, { n: s.daysSinceLastActivity! })}</Pill>}
          </div>
        }
      />
      {s.brand.notes && <p className="-mt-3 mb-5 text-sm text-ink-2">📝 {s.brand.notes}</p>}

      <StatStrip cols={5}>
        {kpis.map((k) => (
          <StatTile key={k.label} label={k.label} value={k.value} size="md" />
        ))}
      </StatStrip>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          className="border-accent/40 xl:col-span-1"
          title={
            <span className="flex items-center gap-2">
              <Sparkles size={16} className="text-accent" aria-hidden />
              {t.brand360.nextOffer}
            </span>
          }
        >
          <div className="font-heading text-lg font-medium">{offer.title}</div>
          <div className="mt-1 text-sm text-muted">{offer.codes.map(cardName).join(" + ")}</div>
          <div className="tabular mt-2 font-heading text-2xl font-semibold text-accent-strong">{baht(offer.price)}</div>
          <div className="mt-3 rounded-lg bg-paper p-3 text-sm">
            <div className="mb-1 text-xs font-medium text-muted">{t.brand360.nextOfferWhy}</div>
            {offer.reason}
          </div>
          <div className="mt-4">
            <ButtonLink href={`/brands/quotes/new?brand=${s.brand.id}&codes=${offer.codes.join(",")}`}>
              <FileText size={16} aria-hidden /> {t.brand360.nextOfferCta}
            </ButtonLink>
          </div>
        </Card>

        <Card title={t.brand360.performance} hint={t.brand360.performanceHint} className="xl:col-span-2" bodyClass="overflow-x-auto">
          {perf.length === 0 ? (
            <p className="p-5 text-sm text-muted">{t.brand360.noPosts}</p>
          ) : (
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-normal">{t.overview.title_col}</th>
                  <th className="py-2.5 text-right font-normal">{t.brand360.views7}</th>
                  <th className="py-2.5 text-right font-normal">{t.brand360.views30}</th>
                  <th className="py-2.5 text-right font-normal">{t.common.erShort}</th>
                  <th className="px-5 py-2.5 text-right font-normal">{t.brand360.pq}</th>
                </tr>
              </thead>
              <tbody>
                {perf.map((p) => (
                  <tr key={p.contentId} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5">
                      <div className="line-clamp-1 font-medium">{p.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-subtle">
                        <PlatformTag id={p.platformId} />
                        {date(p.postedAt)} · {dealTitle(p.dealId)}
                      </div>
                    </td>
                    <td className="tabular py-2.5 text-right">{p.d7 ? num(p.d7.views) : <span className="text-subtle">{t.common.notAvailable}</span>}</td>
                    <td className="tabular py-2.5 text-right">{p.d30 ? num(p.d30.views) : <span className="text-subtle">{t.common.notAvailable}</span>}</td>
                    <td className="tabular py-2.5 text-right">{pct(p.toDate.er)}</td>
                    <td className="tabular px-5 py-2.5 text-right">{p.productQuestionsToDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title={t.brand360.deals} bodyClass="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-normal">{t.brand360.dealCol}</th>
                  <th className="py-2.5 font-normal">{t.common.status}</th>
                  <th className="py-2.5 font-normal">{t.brand360.deliverables}</th>
                  <th className="py-2.5 text-right font-normal">{t.common.total}</th>
                  <th className="px-5 py-2.5 text-right font-normal">{t.brand360.report}</th>
                </tr>
              </thead>
              <tbody>
                {[...s.deals].reverse().map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5">
                      <div className="font-medium">{d.title}</div>
                      <div className="text-xs text-subtle">{d.postedAt ? `${t.common.postedAt} ${date(d.postedAt)}` : date(d.createdAt)}</div>
                    </td>
                    <td className="py-2.5">
                      <Pill tone={d.stage === "paid" ? "good" : d.stage === "invoiced" ? "warn" : "neutral"}>{t.stages[d.stage]}</Pill>
                    </td>
                    <td className="py-2.5 text-xs text-ink-2">{d.deliverables.map(cardName).join(", ")}</td>
                    <td className="tabular py-2.5 text-right">{baht(d.value)}</td>
                    <td className="px-5 py-2.5 text-right">
                      {d.postedAt ? (
                        <Link href={`/print/report/${d.id}`} className="text-xs font-medium text-accent-strong hover:underline">
                          {t.report.open}
                        </Link>
                      ) : (
                        <span className="text-xs text-subtle">{t.common.none}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title={t.brand360.invoices} bodyClass="overflow-x-auto">
            {invs.length === 0 ? (
              <p className="p-5 text-sm text-muted">{t.common.none}</p>
            ) : (
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2.5 font-normal">{t.brand360.invoiceNo}</th>
                    <th className="py-2.5 font-normal">{t.brand360.issued}</th>
                    <th className="py-2.5 font-normal">{t.brand360.due}</th>
                    <th className="py-2.5 text-right font-normal">{t.common.total}</th>
                    <th className="px-5 py-2.5 text-right font-normal">{t.common.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {invs.map((inv) => {
                    const paid = inv.paidAt && inv.paidAt <= today;
                    const late = diffDays(inv.dueAt, today);
                    return (
                      <tr key={inv.id} className="border-b border-line last:border-0">
                        <td className="px-5 py-2.5 font-medium">{inv.number}</td>
                        <td className="py-2.5">{date(inv.issuedAt)}</td>
                        <td className="py-2.5">{date(inv.dueAt)}</td>
                        <td className="tabular py-2.5 text-right">{baht(inv.amount)}</td>
                        <td className="px-5 py-2.5 text-right">
                          {paid ? (
                            <Pill tone="good">
                              {t.brand360.paid} {dateShort(inv.paidAt!)}
                            </Pill>
                          ) : late > 0 ? (
                            <Pill tone="bad">{fmt(t.brand360.overdue, { n: late })}</Pill>
                          ) : (
                            <Pill tone="warn">{t.brand360.unpaid}</Pill>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <Card title={t.brand360.timeline} bodyClass="max-h-[620px] overflow-y-auto p-5">
          <ol className="relative space-y-4 border-l border-line pl-5">
            {acts.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-accent ring-1 ring-line" aria-hidden />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="tabular">{date(a.occurredAt)}</span>
                  <Pill>{t.activityTypes[a.type]}</Pill>
                  <span>{t.channels[a.channel]}</span>
                </div>
                <p className="mt-1 text-sm">{a.summary}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
