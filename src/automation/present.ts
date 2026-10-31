/**
 * Renders a task's title/reason in the UI language from the raw `vars` the rule stored.
 * (The drafted message itself stays in the data language, Thai.)
 */
import type { tasks } from "@/db/schema";
import { fmt, type I18n } from "@/lib/i18n";
import { baht } from "@/lib/format";

type Task = Pick<typeof tasks.$inferSelect, "ruleId" | "title" | "reason" | "vars">;
type RuleId = "post_plus_7" | "post_plus_30" | "brand_silent_120" | "invoice_overdue_30" | "pq_spike";

const DATE_KEYS = new Set(["posted", "last", "due"]);

function localVars(i18n: I18n, vars: Record<string, string | number>) {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (DATE_KEYS.has(k)) out[k] = i18n.date(String(v));
    else if (k === "amount") out[k] = baht(Number(v));
    else if (k === "category") out[k] = i18n.t.categories[v as "tech"] ?? v;
    else out[k] = v;
  }
  return out;
}

export function presentTask(i18n: I18n, task: Task) {
  const id = task.ruleId as RuleId;
  if (!task.vars || !(id in i18n.t.ruleTitles)) return { title: task.title, reason: task.reason };
  const v = localVars(i18n, task.vars);
  return { title: fmt(i18n.t.ruleTitles[id], v), reason: fmt(i18n.t.ruleReasons[id], v) };
}

export function ruleName(i18n: I18n, ruleId: string, fallback: string) {
  return i18n.t.ruleMeta[ruleId as RuleId]?.name ?? fallback;
}
