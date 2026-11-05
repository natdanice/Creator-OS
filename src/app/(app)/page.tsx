import Link from "next/link";
import { ArrowRight, Lightbulb } from "lucide-react";
import { getDb } from "@/db/client";
import { getStoryDate } from "@/lib/queries/settings";
import { overviewData } from "@/lib/queries/overview";
import { todayActions, type TodayAction } from "@/lib/queries/today";
import { MockBadge, Pill, PlatformTag } from "@/components/ui";
import { KpiCard } from "@/components/KpiCard";
import { DailyViewsChart } from "@/components/charts/DailyViewsChart";
import { baht, compactNum, num, pct } from "@/lib/format";
import { fmt, type I18n } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { presentTask } from "@/automation/present";
import { stamp } from "@/lib/clock";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.overview.title };
}

const RANGES = [7, 28, 90] as const;
const VISIBLE_ACTIONS = 6;

type Tone = "accent" | "bad" | "ink" | "calm";
const STRIPE: Record<Tone, string> = { accent: "var(--color-accent)", bad: "var(--color-bad)", ink: "var(--color-ink-2)", calm: "var(--color-subtle)" };

interface ActionView {
  key: string;
  tone: Tone;
  title: string;
  detail: string;
  cta: string;
  href: string;
}

function present(i18n: I18n, today: string, a: TodayAction): ActionView {
  const { t, date } = i18n;
  const x = t.overview.act;
  switch (a.kind) {
    case "brief": {
      const b = a.brief;
      const detail = b ? [b.budget && baht(b.budget), b.platforms.map((p) => t.platforms[p]).join(" + "), b.timing].filter(Boolean).join(" · ") : "";
      return { key: `brief-${a.brandId}`, tone: "accent", title: fmt(x.brief, { brand: a.brandName }), detail, cta: x.briefCta, href: `/inbox?thread=${a.brandId}` };
    }
    case "overdue":
      return {
        key: `inv-${a.invoice.id}`,
        tone: "bad",
        title: fmt(x.overdue, { brand: a.invoice.brandName, amount: baht(a.invoice.amount) }),
        detail: fmt(x.overdueDetail, { invoice: a.invoice.number, days: a.invoice.daysOverdue }),
        cta: a.taskId ? x.overdueCta : x.overdueCtaNoTask,
        href: a.taskId ? `/automation#task-${a.taskId}` : "/finance?f=overdue",
      };
    case "task": {
      const p = presentTask(i18n, a.task);
      return { key: `task-${a.task.id}`, tone: "ink", title: p.title, detail: p.reason, cta: x.taskCta, href: `/automation#task-${a.task.id}` };
    }
    case "run":
      return { key: "run", tone: "ink", title: x.run, detail: fmt(x.runDetail, { date: date(today) }), cta: x.runCta, href: "/automation" };
    case "unread":
      return { key: "unread", tone: "calm", title: fmt(x.unread, { n: a.n }), detail: a.brands.join(", "), cta: x.unreadCta, href: "/inbox" };
    case "comments":
      return { key: "comments", tone: "calm", title: fmt(x.comments, { n: a.n }), detail: fmt(x.commentsDetail, { pq: a.productQuestions }), cta: x.commentsCta, href: "/inbox?tab=comments" };
  }
}

function ActionCard({ a }: { a: ActionView }) {
  return (
    <li>
      <Link href={a.href} className="group flex h-full flex-col gap-2 rounded-xl border border-line bg-white p-4 shadow-[inset_3px_0_0_var(--stripe)] transition-colors hover:border-subtle" style={{ ["--stripe" as string]: STRIPE[a.tone] }}>
        <span className="font-medium leading-snug">{a.title}</span>
        {a.detail && <span className="line-clamp-2 text-xs text-muted">{a.detail}</span>}
        <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium text-accent-strong">
          {a.cta} <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </Link>
    </li>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const i18n = await getI18n();
  const { t, date, dateShort } = i18n;
  const { range: r } = await searchParams;
  const range = RANGES.includes(Number(r) as 7) ? Number(r) : 28;
  const db = getDb();
  const today = getStoryDate(db);
  const data = overviewData(db, today, range);
  const { headline, perPlatform } = data.insight;
  const actions = todayActions(db, today).map((a) => present(i18n, today, a));
  // Demo mode always reads 10:00; live mode follows the Bangkok clock.
  const hour = Number(stamp(today).slice(11, 13));
  const greeting = hour < 12 ? t.overview.greeting : hour < 17 ? t.overview.greetingAfternoon : t.overview.greetingEvening;
  const weekday = new Intl.DateTimeFormat(i18n.locale === "th" ? "th-TH" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${today}T00:00:00Z`));

  return (
    <>
      <header className="mb-8">
        <div className="mb-2">
          <MockBadge />
        </div>
        <p className="text-sm text-muted">
          {weekday} {date(today)}
        </p>
        <h1 className="mt-1 text-2xl font-medium md:text-[30px]">
          {greeting}
          <span className="text-muted"> · </span>
          {actions.length === 0 ? t.overview.allClear : actions.length === 1 ? t.overview.needsYouOne : fmt(t.overview.needsYou, { n: actions.length })}
        </h1>
      </header>

      {actions.length > 0 && (
        <section aria-labelledby="needs" className="mb-10">
          <h2 id="needs" className="mb-3 text-sm font-medium text-muted">
            {t.overview.needsTitle}
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {actions.slice(0, VISIBLE_ACTIONS).map((a) => (
              <ActionCard key={a.key} a={a} />
            ))}
          </ul>
          {actions.length > VISIBLE_ACTIONS && (
            <details className="group mt-3">
              <summary className="cursor-pointer list-none text-sm font-medium text-accent-strong hover:underline [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">{fmt(t.overview.showMore, { n: actions.length - VISIBLE_ACTIONS })}</span>
                <span className="hidden group-open:inline">{t.overview.showLess}</span>
              </summary>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {actions.slice(VISIBLE_ACTIONS).map((a) => (
                  <ActionCard key={a.key} a={a} />
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <section aria-labelledby="numbers" className="mb-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="numbers" className="text-lg font-medium">
              {t.overview.yourNumbers}
            </h2>
            <p className="text-xs text-muted">
              {dateShort(data.window.start)} – {dateShort(data.window.end)} · {t.common.vsPrev}
            </p>
          </div>
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
        </div>
        <div className="relative -mx-4 flex snap-x overflow-x-auto border-y border-line px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-4 [&>*+*]:border-l [&>*+*]:border-line">
          <KpiCard label={t.overview.kpiViews} kpi={data.kpis.views} format={compactNum} />
          <KpiCard label={t.overview.kpiFollowers} kpi={data.kpis.followers} format={num} />
          <KpiCard label={t.overview.kpiEr} kpi={data.kpis.er} format={(x) => pct(x, 2)} additive={false} />
          <KpiCard label={t.overview.kpiPq} kpi={data.kpis.pq} format={num} hint={t.overview.kpiPqHint} />
        </div>
      </section>

      <div className="mb-10 grid grid-cols-1 gap-10 xl:grid-cols-3 xl:gap-8">
        <section aria-labelledby="daily" className="min-w-0 xl:col-span-2">
          <h2 id="daily" className="text-lg font-medium">
            {t.overview.dailyViews}
          </h2>
          <p className="mb-2 text-xs text-muted">{t.overview.dailyViewsHint}</p>
          <DailyViewsChart data={data.series} />
        </section>

        <section aria-labelledby="insight" className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 id="insight" className="flex items-center gap-2 text-lg font-medium">
              <Lightbulb size={17} className="text-accent" aria-hidden />
              {t.overview.aiInsight}
            </h2>
            <Pill>{t.overview.aiInsightBadge}</Pill>
          </div>
          {headline ? (
            <p className="mt-3 text-sm leading-relaxed">
              {fmt(t.overview.insightFpv, {
                platform: t.platforms[headline.platformId],
                type: t.contentTypes[headline.best!.type],
                fpk: headline.best!.fpk.toFixed(1),
                x: headline.lift.toFixed(1),
              })}
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted">{t.overview.noData}</p>
          )}
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {perPlatform.map((p) => (
              <li key={p.platformId} className="flex items-center justify-between py-2 text-xs">
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
          <p className="mt-3 text-[11px] text-subtle">{t.overview.insightFpvFoot}</p>
        </section>
      </div>

      <section aria-labelledby="top">
        <h2 id="top" className="text-lg font-medium">
          {t.overview.topContent}
        </h2>
        <p className="mb-3 text-xs text-muted">{t.overview.topContentHint}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-2.5 pr-4 font-normal">{t.overview.title_col}</th>
                <th className="py-2.5 font-normal">{t.common.type}</th>
                <th className="py-2.5 text-right font-normal">{t.common.views}</th>
                <th className="py-2.5 text-right font-normal">{t.common.erShort}</th>
                <th className="py-2.5 pl-4 text-right font-normal">{t.common.newFollowers}</th>
              </tr>
            </thead>
            <tbody>
              {data.top.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-4">
                    <div className="line-clamp-1 font-medium">{c.title}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <PlatformTag id={c.platformId} />
                      <span className="text-xs text-subtle">{dateShort(c.postedAt)}</span>
                      {c.isSponsored && <Pill tone="accent">{t.common.sponsored}</Pill>}
                    </div>
                  </td>
                  <td className="py-2.5 text-ink-2">{t.contentTypes[c.type]}</td>
                  <td className="tabular py-2.5 text-right">{num(c.views)}</td>
                  <td className="tabular py-2.5 text-right">{pct(c.er)}</td>
                  <td className="tabular py-2.5 pl-4 text-right">{num(c.newFollowers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
