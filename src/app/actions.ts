"use server";
/**
 * All mutations. Timestamps use the simulated story date (or the date the user
 * picked on the Automation page), never the wall clock, so the demo stays coherent.
 */
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getDb, DB_PATH } from "@/db/client";
import { activities, DEAL_STAGES, deals, invoices, quoteItems, quotes, rateCard, tasks, type ActivityType, type DealStage } from "@/db/schema";
import { getStoryDate } from "@/lib/queries/settings";
import { addDays } from "@/lib/dates";
import { fmt, t } from "@/lib/i18n";
import { runAutomations, type RunResult } from "@/automation/engine";
import { ingest } from "@/cdp/ingest";
import { CsvAdapter } from "@/cdp/adapters/csv/CsvAdapter";
import type { PlatformId } from "@/cdp/adapters/PlatformAdapter";

function revalidateAll() {
  revalidatePath("/", "layout");
}

/* ───────── Pipeline ───────── */

const STAGE_ACTIVITY: Partial<Record<DealStage, ActivityType>> = {
  brief: "brief_received",
  quotation: "quote_sent",
  production: "draft_sent",
  posted: "posted",
  report_sent: "report_sent",
  invoiced: "invoiced",
  paid: "paid",
};

export async function moveDealStage(dealId: number, stage: DealStage) {
  if (!DEAL_STAGES.includes(stage)) return;
  const db = getDb();
  const today = getStoryDate(db);
  const deal = db.select().from(deals).where(eq(deals.id, dealId)).get();
  if (!deal || deal.stage === stage) return;
  const patch: Partial<typeof deals.$inferInsert> = { stage };
  if (stage === "posted" && !deal.postedAt) patch.postedAt = `${today}T19:00:00`;
  if (stage === "paid") patch.closedAt = `${today}T14:00:00`;
  if (stage !== "paid" && deal.closedAt) patch.closedAt = null;
  db.transaction((tx) => {
    tx.update(deals).set(patch).where(eq(deals.id, dealId)).run();
    const inv = tx.select().from(invoices).where(eq(invoices.dealId, dealId)).get();
    if ((stage === "invoiced" || stage === "paid") && !inv) {
      const n = tx.select({ n: sql<number>`count(*)` }).from(invoices).get()!.n + 1;
      tx.insert(invoices)
        .values({ dealId, number: `INV-${String(n).padStart(4, "0")}`, amount: deal.value, issuedAt: today, dueAt: addDays(today, 30), paidAt: stage === "paid" ? today : null })
        .run();
    } else if (stage === "paid" && inv && !inv.paidAt) {
      tx.update(invoices).set({ paidAt: today }).where(eq(invoices.id, inv.id)).run();
    }
    const type = STAGE_ACTIVITY[stage] ?? "note";
    tx.insert(activities)
      .values({ brandId: deal.brandId, dealId, type, channel: "system", summary: fmt(t.pipeline.moved, { deal: deal.title, stage: t.stages[stage] }), occurredAt: `${today}T12:00:00` })
      .run();
  });
  revalidateAll();
}

/* ───────── Quotes ───────── */

export async function createQuote(formData: FormData) {
  const db = getDb();
  const today = getStoryDate(db);
  const brandId = Number(formData.get("brandId"));
  const dealIdRaw = formData.get("dealId");
  const discountPct = Math.max(0, Math.min(50, Number(formData.get("discountPct") ?? 0)));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const cards = db.select().from(rateCard).all();
  const items = cards
    .map((c) => ({ card: c, qty: Number(formData.get(`qty_${c.code}`) ?? 0) }))
    .filter((i) => i.qty > 0);
  if (!brandId || items.length === 0) return;

  const gross = items.reduce((s, i) => s + i.card.price * i.qty, 0);
  const value = Math.round((gross * (100 - discountPct)) / 100);
  const deliverables = items.flatMap((i) => Array.from({ length: i.qty }, () => i.card.code));

  const quoteId = db.transaction((tx) => {
    let dealId = dealIdRaw ? Number(dealIdRaw) : null;
    if (dealId) {
      const d = tx.select().from(deals).where(and(eq(deals.id, dealId), eq(deals.brandId, brandId))).get();
      if (!d) dealId = null;
      else tx.update(deals).set({ value, deliverables, stage: ["lead", "brief"].includes(d.stage) ? "quotation" : d.stage }).where(eq(deals.id, dealId)).run();
    }
    if (!dealId) {
      const title = String(formData.get("dealTitle") ?? "").trim() || t.quote.newDeal;
      dealId = tx.insert(deals).values({ brandId, title, stage: "quotation", value, deliverables, createdAt: `${today}T09:00:00` }).returning({ id: deals.id }).get().id;
    }
    const n = tx.select({ n: sql<number>`count(*)` }).from(quotes).get()!.n + 1;
    const q = tx
      .insert(quotes)
      .values({ number: `QT-${today.slice(0, 4)}-${String(n).padStart(3, "0")}`, brandId, dealId, createdAt: today, validUntil: addDays(today, 14), discountPct, notes })
      .returning({ id: quotes.id })
      .get();
    tx.insert(quoteItems).values(items.map((i) => ({ quoteId: q.id, rateCardId: i.card.id, qty: i.qty, unitPrice: i.card.price }))).run();
    tx.insert(activities).values({ brandId, dealId, type: "quote_sent", channel: "system", summary: `${t.quote.printTitle} ${value.toLocaleString()} ${t.common.baht}`, occurredAt: `${today}T15:00:00` }).run();
    return q.id;
  });
  revalidateAll();
  redirect(`/print/quote/${quoteId}`);
}

/* ───────── Automation ───────── */

export async function runAutomationsAction(date: string): Promise<RunResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("bad date");
  const res = runAutomations(getDb(), date);
  revalidateAll();
  return res;
}

const DONE_ACTIVITY: Record<string, ActivityType | null> = {
  post_plus_7: "report_sent",
  post_plus_30: "report_sent",
  brand_silent_120: "chat",
  invoice_overdue_30: "note",
  pq_spike: null,
};

/** Human approves a drafted task (after editing/copying it) → mark done + log on the brand timeline. */
export async function completeTask(taskId: number, finalMessage: string) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task || task.status !== "open") return;
  const at = `${task.forDate}T10:30:00`;
  db.transaction((tx) => {
    tx.update(tasks).set({ status: "done", draftMessage: finalMessage, completedAt: at }).where(eq(tasks.id, taskId)).run();
    const type = DONE_ACTIVITY[task.ruleId];
    if (type && task.brandId) {
      tx.insert(activities)
        .values({ brandId: task.brandId, dealId: task.dealId, type, channel: task.channel === "internal" ? "system" : task.channel === "line" ? "line" : "email", summary: task.title, occurredAt: at })
        .run();
    }
    // Sending the +7 report moves a Posted deal forward in the pipeline.
    if (task.ruleId === "post_plus_7" && task.dealId) {
      tx.update(deals).set({ stage: "report_sent" }).where(and(eq(deals.id, task.dealId), eq(deals.stage, "posted"))).run();
    }
  });
  revalidateAll();
}

export async function dismissTask(taskId: number) {
  getDb().update(tasks).set({ status: "dismissed" }).where(eq(tasks.id, taskId)).run();
  revalidateAll();
}

export async function resetTasks() {
  const db = getDb();
  db.delete(tasks).run();
  db.run(sql`delete from automation_runs`);
  revalidateAll();
}

export async function toggleRule(ruleId: string, enabled: boolean) {
  const { automationRules } = await import("@/db/schema");
  getDb().update(automationRules).set({ enabled }).where(eq(automationRules.id, ruleId)).run();
  revalidateAll();
}

/* ───────── Data sources ───────── */

export interface ImportState {
  ok: boolean;
  message: string;
}

async function runCsvImport(platform: PlatformId, metricsCsv: string, commentsCsv?: string): Promise<ImportState> {
  const db = getDb();
  const today = getStoryDate(db);
  let adapter: CsvAdapter;
  try {
    adapter = new CsvAdapter(platform, metricsCsv, commentsCsv);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const { importRuns } = await import("@/db/schema");
    db.insert(importRuns).values({ platformId: platform, adapter: "csv", startedAt: `${today}T10:05:00`, finishedAt: `${today}T10:05:00`, status: "failed", message }).run();
    revalidateAll();
    return { ok: false, message: fmt(t.settings.importFail, { message }) };
  }
  const r = await ingest(db, adapter, `${today}T10:05:00`);
  revalidateAll();
  if (r.status === "failed") return { ok: false, message: fmt(t.settings.importFail, { message: r.message ?? "" }) };
  return { ok: true, message: fmt(t.settings.importOk, { platform: t.platforms[platform], contents: r.contents, metrics: r.metricRows, comments: r.comments }) };
}

export async function importCsvAction(_prev: ImportState | null, formData: FormData): Promise<ImportState> {
  const platform = String(formData.get("platform")) as PlatformId;
  const metrics = formData.get("metrics");
  const comments = formData.get("comments");
  if (!(metrics instanceof File) || metrics.size === 0) return { ok: false, message: fmt(t.settings.importFail, { message: t.settings.metricsCsv }) };
  const commentsText = comments instanceof File && comments.size > 0 ? await comments.text() : undefined;
  return runCsvImport(platform, await metrics.text(), commentsText);
}

export async function importSampleAction(_prev: ImportState | null, formData: FormData): Promise<ImportState> {
  const platform = String(formData.get("platform")) as PlatformId;
  const dir = path.join(process.cwd(), "data", "samples");
  const metrics = fs.readFileSync(path.join(dir, `${platform}_metrics.csv`), "utf8");
  const commentsFile = path.join(dir, `${platform}_comments.csv`);
  return runCsvImport(platform, metrics, fs.existsSync(commentsFile) ? fs.readFileSync(commentsFile, "utf8") : undefined);
}

/* ───────── Demo reset ───────── */

export async function resetDemoAction() {
  const { seedDatabase } = await import("@/seed/seedDatabase");
  const tmp = path.join(path.dirname(DB_PATH), "creator-os.next.db");
  await seedDatabase(tmp);
  // getDb() notices the new file (different inode) and reopens it.
  const g = globalThis as unknown as { __creatorDb?: unknown; __creatorSqlite?: { close(): void }; __creatorDbIno?: number };
  g.__creatorSqlite?.close();
  g.__creatorDb = undefined;
  g.__creatorDbIno = undefined;
  for (const f of ["-wal", "-shm"]) if (fs.existsSync(DB_PATH + f)) fs.rmSync(DB_PATH + f);
  fs.renameSync(tmp, DB_PATH);
  revalidateAll();
}
