import Link from "next/link";
import { Database } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Tier } from "@/crm/rules";

export function MockBadge() {
  return (
    <span title={t.app.mockBadgeTitle} className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
      <Database size={11} aria-hidden />
      {t.app.mockBadge}
    </span>
  );
}

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

export function Card({ title, hint, right, children, className = "", bodyClass = "p-5" }: { title?: React.ReactNode; hint?: string; right?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-card ${className}`}>
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

const TIER_STYLE: Record<Tier, string> = {
  partner: "bg-ink text-white",
  repeat: "bg-accent-soft text-accent-strong",
  one_time: "bg-paper text-ink-2 border border-line",
  lead: "bg-white text-muted border border-dashed border-subtle",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span title={t.tierHelp[tier]} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TIER_STYLE[tier]}`}>
      {t.tiers[tier]}
    </span>
  );
}

export function PlatformTag({ id, short = false }: { id: string; short?: boolean }) {
  const name = t.platforms[id as "tiktok"] ?? id;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span className="h-2 w-2 rounded-full" style={{ background: `var(--color-${id})` }} aria-hidden />
      {short ? name.slice(0, 2) : name}
    </span>
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

export const btn = {
  primary: "inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-50",
  ghost: "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper disabled:opacity-50",
  input: "rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20",
};
