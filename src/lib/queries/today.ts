/**
 * "Needs you today" — the Overview's action list, in priority order:
 * new briefs → overdue invoices → drafted automation tasks → run today's automations
 * → unread brand messages → comments waiting for a reply.
 * Returns raw values; the page renders them in the UI language.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { automationRuns, tasks, type BriefSignal } from "@/db/schema";
import { listInvoices, type InvoiceRow } from "@/crm/finance";
import { commentCountsByCategory, listThreads, NEEDS_REPLY } from "@/inbox/queries";

export type TodayAction =
  | { kind: "brief"; brandId: number; brandName: string; brief: BriefSignal | null }
  | { kind: "overdue"; invoice: InvoiceRow; taskId: number | null }
  | { kind: "task"; task: typeof tasks.$inferSelect }
  | { kind: "run" }
  | { kind: "unread"; n: number; brands: string[] }
  | { kind: "comments"; n: number; productQuestions: number };

const TASK_ORDER = ["post_plus_7", "post_plus_30", "brand_silent_120", "pq_spike"];

export function todayActions(db: DB, today: string): TodayAction[] {
  const out: TodayAction[] = [];
  const threads = listThreads(db, today);
  for (const th of threads.filter((x) => x.newBriefs > 0)) out.push({ kind: "brief", brandId: th.brandId, brandName: th.brandName, brief: th.last.brief });

  const open = db.select().from(tasks).where(eq(tasks.status, "open")).all();
  for (const inv of listInvoices(db, today).filter((r) => r.status === "overdue")) {
    const task = open.find((tk) => tk.ruleId === "invoice_overdue_30" && tk.dealId === inv.dealId);
    out.push({ kind: "overdue", invoice: inv, taskId: task?.id ?? null });
  }
  for (const task of open.filter((tk) => TASK_ORDER.includes(tk.ruleId)).sort((a, b) => TASK_ORDER.indexOf(a.ruleId) - TASK_ORDER.indexOf(b.ruleId) || a.id - b.id)) out.push({ kind: "task", task });

  const ranToday = db.select({ n: sql<number>`count(*)` }).from(automationRuns).where(and(eq(automationRuns.forDate, today))).get()!.n > 0;
  if (!ranToday) out.push({ kind: "run" });

  const unreadThreads = threads.filter((x) => x.unread > 0 && x.newBriefs === 0);
  const unread = unreadThreads.reduce((s, x) => s + x.unread, 0);
  if (unread) out.push({ kind: "unread", n: unread, brands: unreadThreads.map((x) => x.brandName) });

  const counts = commentCountsByCategory(db, today);
  const waiting = counts.filter((c) => NEEDS_REPLY.includes(c.category)).reduce((s, c) => s + c.n, 0);
  if (waiting) out.push({ kind: "comments", n: waiting, productQuestions: counts.find((c) => c.category === "product_question")?.n ?? 0 });
  return out;
}
