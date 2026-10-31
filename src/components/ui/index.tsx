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
