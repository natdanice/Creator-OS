/**
 * Rules engine. `runAutomations(today)` simulates the daily 10:00 cron for a date.
 * Every enabled rule produces TaskDrafts; each becomes an *open* Task with a drafted
 * message. Nothing is sent — a human approves each task (human-in-the-loop).
 * Idempotent: tasks are keyed by `dedupe_key`, so re-running a date creates nothing new.
 */
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { automationRules, automationRuns, tasks } from "@/db/schema";
import { stamp } from "@/lib/clock";
import { computeBrandStats } from "@/crm/brandStats";
import { creatorSponsoredMedianEr } from "@/crm/nextOffer";
import type { AutomationRule } from "./types";
import { postPlus7, postPlus30 } from "./rules/postReport";
import { brandSilent } from "./rules/brandSilent";
import { invoiceOverdue } from "./rules/invoiceOverdue";
import { pqSpike } from "./rules/pqSpike";

export const RULES: AutomationRule[] = [postPlus7, postPlus30, brandSilent, invoiceOverdue, pqSpike];

export interface RunResult {
  forDate: string;
  created: number;
  skipped: number;
  detail: Record<string, { created: number; skipped: number }>;
}

export function runAutomations(db: DB, today: string): RunResult {
  const enabled = new Map(db.select().from(automationRules).all().map((r) => [r.id, r]));
  const ctx = { db, today, stats: computeBrandStats(db, today), medianEr: creatorSponsoredMedianEr(db, today) };
  const ranAt = stamp(today);
  const detail: RunResult["detail"] = {};
  let created = 0;
  let skipped = 0;

  for (const rule of RULES) {
    const cfg = enabled.get(rule.id);
    if (!cfg?.enabled) continue;
    const drafts = rule.evaluate(ctx);
    const d = (detail[rule.id] = { created: 0, skipped: 0 });
    for (const draft of drafts) {
      const res = db
        .insert(tasks)
        .values({ ...draft, ruleId: rule.id, channel: cfg.channel, status: "open", forDate: today, createdAt: ranAt })
        .onConflictDoNothing({ target: tasks.dedupeKey })
        .run();
      if (res.changes) d.created++;
      else d.skipped++;
    }
    created += d.created;
    skipped += d.skipped;
    db.update(automationRules).set({ lastRunAt: ranAt }).where(eq(automationRules.id, rule.id)).run();
  }
  db.insert(automationRuns).values({ forDate: today, ranAt, created, skipped, detail }).run();
  return { forDate: today, created, skipped, detail };
}
