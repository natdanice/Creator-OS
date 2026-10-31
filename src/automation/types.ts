import type { DB } from "@/db/client";
import type { BrandStats } from "@/crm/brandStats";

export interface RuleContext {
  db: DB;
  /** Simulated "today" (the cron runs at 10:00 of this date). */
  today: string;
  stats: BrandStats[];
  medianEr: number;
}

/** What a rule produces. Always a DRAFT — nothing is ever sent automatically. */
export interface TaskDraft {
  dedupeKey: string;
  title: string;
  reason: string;
  draftMessage: string;
  brandId?: number | null;
  dealId?: number | null;
  link?: string | null;
  /** Raw values behind title/reason so the UI can re-render them in any language. */
  vars?: Record<string, string | number>;
}

export interface AutomationRule {
  id: string;
  evaluate(ctx: RuleContext): TaskDraft[];
}
