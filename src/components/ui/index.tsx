import Link from "next/link";
import { MockBadge } from "./localized";

export { MockBadge, PlatformTag, TierBadge } from "./localized";

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mb-2">
          <MockBadge />
        </div>
        <h1 className="text-2xl font-semibold md:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function Card({ id, title, hint, right, children, className = "", bodyClass = "p-5" }: { id?: string; title?: React.ReactNode; hint?: string; right?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section id={id} className={`rounded-xl border border-line bg-card ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-5 py-3.5">
          <div>
            {title && <h2 className="text-base font-medium">{title}</h2>}
            {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
          </div>
          {right}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "accent" }) {
  const cls = {
    neutral: "bg-paper text-ink-2",
    good: "bg-good-soft text-good",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
    accent: "bg-accent-soft text-accent-strong",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: "primary" | "ghost" }) {
  const cls = variant === "primary" ? "bg-accent text-white hover:bg-accent-strong" : "border border-line bg-white text-ink hover:bg-paper";
  return (
    <Link href={href} className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${cls}`}>
      {children}
    </Link>
  );
}

/** Headline number with a label and an optional one-line context. */
export function StatTile({ label, value, sub, hint, tone }: { label: string; value: string; sub?: React.ReactNode; hint?: string; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="text-sm text-muted" title={hint}>
        {label}
      </div>
      <div className={`tabular mt-1 font-heading text-[28px] font-semibold leading-tight ${tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Horizontal share bar: label, bar, value. `color` is a CSS color (series identity); text stays in ink tokens. */
export function ShareBar({ label, value, share, color = "var(--color-ink-2)" }: { label: React.ReactNode; value: string; share: number; color?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-xs">
      <div className="truncate text-ink-2">{label}</div>
      <div className="h-2 overflow-hidden rounded-full bg-paper" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, background: color }} />
      </div>
      <div className="tabular text-right text-ink">{value}</div>
    </div>
  );
}

export const btn = {
  primary: "inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-50",
  ghost: "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper disabled:opacity-50",
  input: "rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20",
};
