import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { Kpi, PlatformKey, RateKpi } from "@/lib/queries/overview";
import { PLATFORM_KEYS } from "@/lib/queries/overview";
import { getI18n } from "@/lib/i18n/server";
import { signedPct } from "@/lib/format";

/** One figure in the Overview strip: value, change vs previous period, thin per-platform split. No box: the strip draws the dividers. */
export async function KpiCard({ label, kpi, format, additive = true, hint }: { label: string; kpi: Kpi | RateKpi; format: (n: number) => string; additive?: boolean; hint?: string }) {
  const { t } = await getI18n();
  const show = (n: number | null) => (n === null ? t.common.none : format(n)); // a ratio with no views is "—", not 0
  const change = kpi.prev && kpi.total !== null ? kpi.total / kpi.prev - 1 : 0;
  const up = change >= 0;
  const share = (p: PlatformKey) => (kpi.total ? (kpi.byPlatform[p] ?? 0) / kpi.total : 0);
  return (
    <div className="min-w-[72%] snap-start px-5 py-4 first:pl-0 sm:min-w-0 md:px-6">
      <div className="text-sm text-muted" title={hint}>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="tabular font-heading text-[28px] font-medium leading-tight">{show(kpi.total)}</div>
        {kpi.prev !== null && kpi.prev > 0 && kpi.total !== null && (
          <span className={`inline-flex items-center text-xs font-medium ${up ? "text-good" : "text-bad"}`} title={t.common.vsPrev}>
            {up ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}
            {signedPct(change)}
          </span>
        )}
      </div>
      {additive ? (
        <div className="mt-3 flex h-1 gap-[2px] overflow-hidden rounded-full" aria-hidden>
          {PLATFORM_KEYS.map((p) => (
            <div key={p} style={{ width: `${share(p) * 100}%`, background: `var(--color-${p})` }} className="h-full" />
          ))}
        </div>
      ) : (
        <div className="mt-3 h-1" aria-hidden />
      )}
      <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {PLATFORM_KEYS.map((p) => (
          <div key={p} className="flex items-center gap-1">
            <dt className="flex items-center gap-1 text-muted">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(--color-${p})` }} aria-hidden />
              <span className="sr-only">{t.platforms[p]}</span>
            </dt>
            <dd className="tabular text-ink-2">{show(kpi.byPlatform[p])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
