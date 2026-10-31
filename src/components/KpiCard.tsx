import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { Kpi, PlatformKey } from "@/lib/queries/overview";
import { PLATFORM_KEYS } from "@/lib/queries/overview";
import { t } from "@/lib/i18n";
import { signedPct } from "@/lib/format";

/** Stat tile: headline value, change vs previous period, per-platform split. */
export function KpiCard({ label, kpi, format, additive = true, hint }: { label: string; kpi: Kpi; format: (n: number) => string; additive?: boolean; hint?: string }) {
  const change = kpi.prev ? kpi.total / kpi.prev - 1 : 0;
  const up = change >= 0;
  const share = (p: PlatformKey) => (kpi.total ? kpi.byPlatform[p] / kpi.total : 0);
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="text-sm text-muted" title={hint}>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="tabular font-heading text-[28px] font-semibold leading-tight">{format(kpi.total)}</div>
        {kpi.prev > 0 && (
          <span className={`inline-flex items-center text-xs font-medium ${up ? "text-good" : "text-bad"}`} title={t.common.vsPrev}>
            {up ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}
            {signedPct(change)}
          </span>
        )}
      </div>
      {additive && (
        <div className="mt-3 flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
          {PLATFORM_KEYS.map((p) => (
            <div key={p} style={{ width: `${share(p) * 100}%`, background: `var(--color-${p})` }} className="h-full first:rounded-l-full last:rounded-r-full" />
          ))}
        </div>
      )}
      <dl className="mt-3 space-y-1">
        {PLATFORM_KEYS.map((p) => (
          <div key={p} className="flex items-center justify-between text-xs">
            <dt className="flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: `var(--color-${p})` }} aria-hidden />
              {t.platforms[p]}
            </dt>
            <dd className="tabular text-ink-2">{format(kpi.byPlatform[p])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
