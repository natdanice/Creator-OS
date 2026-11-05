import Link from "next/link";
import { Download } from "lucide-react";
import { getDb } from "@/db/client";
import { AGEING, financeData, INCOME_BUCKETS, type InvoiceStatus } from "@/crm/finance";
import { getStoryDate } from "@/lib/queries/settings";
import { Card, PageHeader, Pill, ShareBar, StatStrip, StatTile } from "@/components/ui";
import { MonthlyIncomeChart } from "@/components/charts/MonthlyIncomeChart";
import { MarkPaidButton } from "@/components/finance/MarkPaidButton";
import { baht, signedPct } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.finance.title };
}

const FILTERS = ["all", "unpaid", "overdue", "paid"] as const;
type Filter = (typeof FILTERS)[number];
const STATUS_TONE: Record<InvoiceStatus, "good" | "warn" | "bad"> = { paid: "good", due: "warn", overdue: "bad" };
const BUCKET_COLOR = { tiktok: "var(--color-tiktok)", instagram: "var(--color-instagram)", youtube: "var(--color-youtube)", addons: "var(--color-subtle)" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { t, date, dateShort } = await getI18n();
  const { f: raw } = await searchParams;
  const filter: Filter = FILTERS.includes(raw as Filter) ? (raw as Filter) : "all";
  const db = getDb();
  const today = getStoryDate(db);
  const d = financeData(db, today);
  const k = d.kpis;
  const change = k.incomePrevYtd ? k.incomeYtd / k.incomePrevYtd - 1 : null;
  const rows = d.rows.filter((r) => (filter === "all" ? true : filter === "unpaid" ? r.status !== "paid" : r.status === filter));
  const brandMax = d.byBrand[0]?.income ?? 1;
  const platformTotal = INCOME_BUCKETS.reduce((s, b) => s + d.byPlatform[b], 0) || 1;
  const unpaidTotal = AGEING.reduce((s, a) => s + d.ageing[a].amount, 0) || 1;

  const statusLabel = (r: (typeof d.rows)[number]) =>
    r.status === "paid" ? fmt(t.finance.statuses.paid, { date: dateShort(r.paidAt!) }) : r.status === "overdue" ? fmt(t.finance.statuses.overdue, { n: r.daysOverdue }) : t.finance.statuses.due;

  return (
    <>
      <PageHeader title={t.finance.title} subtitle={t.finance.subtitle} />

      <StatStrip>
        <StatTile label={t.finance.kpiIncome} hint={t.finance.kpiIncomeHint} value={baht(k.incomeYtd)} sub={change === null ? t.finance.kpiIncomeHint : fmt(t.finance.vsLastYear, { change: signedPct(change, 0) })} />
        <StatTile label={t.finance.kpiOutstanding} value={baht(k.outstanding)} sub={fmt(t.finance.invoicesN, { n: k.outstandingCount })} />
        <StatTile label={t.finance.kpiOverdue} value={baht(k.overdue)} tone={k.overdue ? "bad" : undefined} sub={fmt(t.finance.invoicesN, { n: k.overdueCount })} />
        <StatTile label={t.finance.kpiExpected} value={baht(k.expected)} sub={fmt(t.finance.dealsN, { n: k.expectedCount })} />
      </StatStrip>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={t.finance.monthly} hint={t.finance.monthlyHint} className="xl:col-span-2">
          <MonthlyIncomeChart data={d.monthly} />
          {k.avgDaysToPay !== null && <p className="mt-3 text-xs text-muted">{fmt(t.finance.avgDaysToPay, { n: Math.round(k.avgDaysToPay) })}</p>}
        </Card>
        <Card title={t.finance.ageing} hint={t.finance.ageingHint}>
          <div className="space-y-3">
            {AGEING.map((a) => (
              <ShareBar
                key={a}
                label={t.finance.ageingBuckets[a]}
                share={d.ageing[a].amount / unpaidTotal}
                value={d.ageing[a].n ? `${baht(d.ageing[a].amount)} · ${d.ageing[a].n}` : t.common.none}
                color={a === "notDue" ? "var(--color-subtle)" : a === "d1_30" ? "var(--color-warn)" : "var(--color-bad)"}
              />
            ))}
          </div>
          <h3 className="mt-6 text-sm font-medium">{t.finance.expectedTitle}</h3>
          <ul className="mt-2 divide-y divide-line text-sm">
            {d.expected.map((x) => (
              <li key={x.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  <Link href={`/brands/${x.brandId}`} className="font-medium hover:text-accent-strong">
                    {x.brandName}
                  </Link>
                  <span className="block truncate text-xs text-muted">
                    {x.title} · {t.stages[x.stage]}
                  </span>
                </span>
                <span className="tabular shrink-0">{baht(x.value)}</span>
              </li>
            ))}
            {d.expected.length === 0 && <li className="py-2 text-muted">{t.common.none}</li>}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={t.finance.byBrand} hint={t.finance.byBrandHint}>
          <div className="space-y-2.5">
            {d.byBrand.map((b) => (
              <ShareBar key={b.brandId} label={<Link href={`/brands/${b.brandId}`} className="hover:text-accent-strong">{b.brandName}</Link>} share={b.income / brandMax} value={baht(b.income)} />
            ))}
          </div>
        </Card>
        <Card title={t.finance.byPlatform} hint={t.finance.byPlatformHint}>
          <div className="space-y-2.5">
            {INCOME_BUCKETS.map((b) => (
              <ShareBar key={b} label={b === "addons" ? t.finance.addons : t.platforms[b]} share={d.byPlatform[b] / platformTotal} value={`${baht(d.byPlatform[b])} · ${Math.round((d.byPlatform[b] / platformTotal) * 100)}%`} color={BUCKET_COLOR[b]} />
            ))}
          </div>
        </Card>
        <Card title={t.finance.tax} bodyClass="p-0">
          <p className="px-5 pt-4 text-xs text-muted">{t.finance.taxHint}</p>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-normal">{t.finance.taxYear}</th>
                  <th className="py-2 text-right font-normal">{t.finance.gross}</th>
                  <th className="py-2 text-right font-normal">{t.finance.wht}</th>
                  <th className="px-5 py-2 text-right font-normal">{t.finance.net}</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {d.tax.map((x) => (
                  <tr key={x.year} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5">
                      <div>{x.year}</div>
                      <a href={`/api/finance/export?year=${x.year}`} className="inline-flex items-center gap-1 text-xs text-accent-strong hover:underline">
                        <Download size={11} aria-hidden /> {t.finance.exportCsv}
                      </a>
                    </td>
                    <td className="py-2.5 text-right">{baht(x.gross)}</td>
                    <td className="py-2.5 text-right text-muted">−{baht(x.wht)}</td>
                    <td className="px-5 py-2.5 text-right">{baht(x.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card
        className="mt-4"
        bodyClass="p-0"
        title={t.finance.invoices}
        right={
          <div className="flex rounded-lg border border-line bg-white p-0.5 text-xs" role="group">
            {FILTERS.map((f) => (
              <Link key={f} href={f === "all" ? "/finance" : `/finance?f=${f}`} className={`rounded-md px-2.5 py-1 ${f === filter ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"}`} aria-current={f === filter ? "true" : undefined}>
                {t.finance.filters[f]}
              </Link>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-normal">{t.finance.colNo}</th>
                <th className="py-2.5 font-normal">{t.finance.colBrand}</th>
                <th className="py-2.5 font-normal">{t.finance.colIssued}</th>
                <th className="py-2.5 font-normal">{t.finance.colDue}</th>
                <th className="py-2.5 text-right font-normal">{t.finance.colAmount}</th>
                <th className="py-2.5 pl-4 font-normal">{t.finance.colStatus}</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="tabular px-5 py-2.5">{r.number}</td>
                  <td className="py-2.5">
                    <Link href={`/brands/${r.brandId}`} className="font-medium hover:text-accent-strong">
                      {r.brandName}
                    </Link>
                    <div className="max-w-[260px] truncate text-xs text-muted">{r.dealTitle}</div>
                  </td>
                  <td className="tabular py-2.5 text-ink-2">{date(r.issuedAt)}</td>
                  <td className="tabular py-2.5 text-ink-2">{date(r.dueAt)}</td>
                  <td className="tabular py-2.5 text-right">{baht(r.amount)}</td>
                  <td className="py-2.5 pl-4">
                    <Pill tone={STATUS_TONE[r.status]}>{statusLabel(r)}</Pill>
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {r.status !== "paid" && (
                      <div className="flex items-center justify-end gap-3">
                        {r.status === "overdue" && (
                          <Link href="/automation" className="text-xs text-muted hover:text-ink">
                            {t.nav.automation}
                          </Link>
                        )}
                        <MarkPaidButton invoiceId={r.id} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted">
                    {t.finance.noInvoices}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
