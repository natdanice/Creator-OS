import Link from "next/link";
import { ArrowRight, Lightbulb, ListChecks } from "lucide-react";
import { getDb } from "@/db/client";
import { getStoryDate } from "@/lib/queries/settings";
import { openTasks, overviewData } from "@/lib/queries/overview";
import { Card, PageHeader, Pill, PlatformTag } from "@/components/ui";
import { KpiCard } from "@/components/KpiCard";
import { DailyViewsChart } from "@/components/charts/DailyViewsChart";
import { compactNum, dateThShort, num, pct } from "@/lib/format";
import { fmt, t } from "@/lib/i18n";

export const metadata = { title: t.overview.title };

const RANGES = [7, 28, 90] as const;

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range: r } = await searchParams;
  const range = RANGES.includes(Number(r) as 7) ? Number(r) : 28;
  const db = getDb();
  const today = getStoryDate(db);
  const data = overviewData(db, today, range);
  const tasks = openTasks(db, 5);
  const { headline, perPlatform } = data.insight;

  return (
    <>
      <PageHeader
        title={t.overview.title}
        subtitle={`${t.overview.subtitle} · ${dateThShort(data.window.start)} – ${dateThShort(data.window.end)}`}
        right={
          <div className="flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label={t.overview.range}>
            {RANGES.map((n) => (
              <Link
                key={n}
                href={`/?range=${n}`}
                className={`rounded-md px-3 py-1.5 text-sm ${n === range ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"}`}
                aria-current={n === range ? "true" : undefined}
              >
                {fmt(t.overview.rangeDays, { n })}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t.overview.kpiViews} kpi={data.kpis.views} format={compactNum} />
        <KpiCard label={t.overview.kpiFollowers} kpi={data.kpis.followers} format={num} />
        <KpiCard label={t.overview.kpiEr} kpi={data.kpis.er} format={(x) => pct(x, 2)} additive={false} />
        <KpiCard label={t.overview.kpiPq} kpi={data.kpis.pq} format={num} hint={t.overview.kpiPqHint} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={t.overview.dailyViews} hint={t.overview.dailyViewsHint} className="xl:col-span-2">
          <DailyViewsChart data={data.series} />
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <Lightbulb size={16} className="text-accent" aria-hidden />
              {t.overview.aiInsight}
            </span>
          }
          right={<Pill>{t.overview.aiInsightBadge}</Pill>}
        >
          {headline ? (
            <p className="text-sm leading-relaxed">
              {fmt(t.overview.insightFpv, {
                platform: t.platforms[headline.platformId],
                type: t.contentTypes[headline.best!.type],
                fpk: headline.best!.fpk.toFixed(1),
                x: headline.lift.toFixed(1),
              })}
            </p>
          ) : (
            <p className="text-sm text-muted">{t.overview.noData}</p>
          )}
          <ul className="mt-4 space-y-2">
            {perPlatform.map((p) => (
              <li key={p.platformId} className="flex items-center justify-between text-xs">
                <PlatformTag id={p.platformId} />
                <span className="text-muted">
                  {p.best ? (
                    <>
                      {t.contentTypes[p.best.type]} <span className="tabular text-ink">{p.best.fpk.toFixed(1)}</span> / 1k · avg <span className="tabular">{p.avg.toFixed(1)}</span>
                    </>
                  ) : (
                    t.common.none
                  )}
                </span>
              </li>
            ))}
          </ul>
          {data.spikes.map((s) => (
            <p key={s.category} className="mt-4 rounded-lg bg-accent-soft p-3 text-sm text-accent-strong">
              {fmt(t.overview.insightSpike, { category: t.categories[s.category], ratio: s.ratio.toFixed(1) })}
            </p>
          ))}
          <p className="mt-4 text-[11px] text-subtle">{t.overview.insightFpvFoot}</p>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={t.overview.topContent} hint={t.overview.topContentHint} className="xl:col-span-2" bodyClass="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-normal">{t.overview.title_col}</th>
                <th className="py-2.5 font-normal">{t.common.type}</th>
                <th className="py-2.5 text-right font-normal">{t.common.views}</th>
                <th className="py-2.5 text-right font-normal">{t.common.erShort}</th>
                <th className="px-5 py-2.5 text-right font-normal">{t.common.newFollowers}</th>
              </tr>
            </thead>
            <tbody>
              {data.top.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5">
                    <div className="line-clamp-1 font-medium">{c.title}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <PlatformTag id={c.platformId} />
                      <span className="text-xs text-subtle">{dateThShort(c.postedAt)}</span>
                      {c.isSponsored && <Pill tone="accent">{t.common.sponsored}</Pill>}
                    </div>
                  </td>
                  <td className="py-2.5 text-ink-2">{t.contentTypes[c.type]}</td>
                  <td className="tabular py-2.5 text-right">{num(c.views)}</td>
                  <td className="tabular py-2.5 text-right">{pct(c.er)}</td>
                  <td className="tabular px-5 py-2.5 text-right">{num(c.newFollowers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <ListChecks size={16} className="text-accent" aria-hidden />
              {t.overview.todayTasks}
            </span>
          }
          right={
            <Link href="/automation" className="text-xs text-muted hover:text-ink">
              {t.overview.viewAll}
            </Link>
          }
        >
          {tasks.length === 0 ? (
            <div className="text-sm text-muted">
              <p>{t.overview.todayTasksEmpty}</p>
              <Link href="/automation" className="mt-3 inline-flex items-center gap-1 font-medium text-accent-strong hover:underline">
                {t.overview.goAutomation} <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {tasks.map((tk) => (
                <li key={tk.id}>
                  <Link href={`/automation#task-${tk.id}`} className="block rounded-lg border border-line p-3 hover:bg-paper">
                    <div className="text-sm font-medium leading-snug">{tk.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <Pill tone={tk.channel === "internal" ? "neutral" : "accent"}>{t.channels[tk.channel]}</Pill>
                      <span className="line-clamp-1">{tk.reason}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
