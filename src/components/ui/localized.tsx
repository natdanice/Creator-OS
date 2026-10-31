"use client";
// Small labelled UI bits that need the current UI language.
import { Database } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Tier } from "@/crm/rules";

export function MockBadge() {
  const { t } = useI18n();
  return (
    <span title={t.app.mockBadgeTitle} className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
      <Database size={11} aria-hidden />
      {t.app.mockBadge}
    </span>
  );
}

const TIER_STYLE: Record<Tier, string> = {
  partner: "bg-ink text-white",
  repeat: "bg-accent-soft text-accent-strong",
  one_time: "bg-paper text-ink-2 border border-line",
  lead: "bg-white text-muted border border-dashed border-subtle",
};

export function TierBadge({ tier }: { tier: Tier }) {
  const { t } = useI18n();
  return (
    <span title={t.tierHelp[tier]} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TIER_STYLE[tier]}`}>
      {t.tiers[tier]}
    </span>
  );
}

export function PlatformTag({ id, short = false }: { id: string; short?: boolean }) {
  const { t } = useI18n();
  const name = t.platforms[id as "tiktok"] ?? id;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span className="h-2 w-2 rounded-full" style={{ background: `var(--color-${id})` }} aria-hidden />
      {short ? name.slice(0, 2) : name}
    </span>
  );
}
