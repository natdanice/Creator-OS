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
import { activities, brandContacts, comments, DEAL_STAGES, deals, invoices, messages, quoteItems, quotes, rateCard, tasks, type ActivityType, type DealStage } from "@/db/schema";
import { getStoryDate } from "@/lib/queries/settings";
import { addDays } from "@/lib/dates";
import { cookies } from "next/headers";
import { asLocale, dataT, fmt, LOCALE_COOKIE } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { runAutomations, type RunResult } from "@/automation/engine";
import { ingest } from "@/cdp/ingest";
import { CsvAdapter } from "@/cdp/adapters/csv/CsvAdapter";
import type { PlatformId } from "@/cdp/adapters/PlatformAdapter";
import { cancelJob, createJob, publishDue, publishJob, type CreateResult } from "@/publish/service";
import type { ComposeDraft } from "@/publish/types";
import { guessDeliverables } from "@/inbox/briefDetector";
import { gatherFacts } from "@/ai/facts";
import { getAssistant, RuleAssistant, type Answer, type ChatTurn } from "@/ai";

function revalidateAll() {
  revalidatePath("/", "layout");
}

/* ───────── UI language ───────── */

export async function setLocaleAction(locale: string) {
  const store = await cookies();
  store.set(LOCALE_COOKIE, asLocale(locale), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidateAll();
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
      .values({ brandId: deal.brandId, dealId, type, channel: "system", summary: fmt(dataT.pipeline.moved, { deal: deal.title, stage: dataT.stages[stage] }), occurredAt: `${today}T12:00:00` })
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
      const title = String(formData.get("dealTitle") ?? "").trim() || dataT.quote.newDeal;
      dealId = tx.insert(deals).values({ brandId, title, stage: "quotation", value, deliverables, createdAt: `${today}T09:00:00` }).returning({ id: deals.id }).get().id;
    }
    const n = tx.select({ n: sql<number>`count(*)` }).from(quotes).get()!.n + 1;
    const q = tx
      .insert(quotes)
      .values({ number: `QT-${today.slice(0, 4)}-${String(n).padStart(3, "0")}`, brandId, dealId, createdAt: today, validUntil: addDays(today, 14), discountPct, notes })
      .returning({ id: quotes.id })
      .get();
    tx.insert(quoteItems).values(items.map((i) => ({ quoteId: q.id, rateCardId: i.card.id, qty: i.qty, unitPrice: i.card.price }))).run();
    tx.insert(activities).values({ brandId, dealId, type: "quote_sent", channel: "system", summary: `${dataT.quote.printTitle} ${value.toLocaleString()} ${dataT.common.baht}`, occurredAt: `${today}T15:00:00` }).run();
    return q.id;
  });
  revalidateAll();
  redirect(`/print/quote/${quoteId}`);
}

/* ───────── Automation ───────── */

export async function runAutomationsAction(date: string): Promise<RunResult & { published: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("bad date");
  const db = getDb();
  // The 10:00 cron first publishes scheduled posts that are due, then evaluates the rules.
  const published = await publishDue(db, date);
  const res = runAutomations(db, date);
  revalidateAll();
  return { ...res, published };
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
    // Approved drafts to a brand also land in that brand's Inbox thread.
    if (task.brandId && task.channel !== "internal") {
      tx.insert(messages).values({ brandId: task.brandId, direction: "out", channel: task.channel, body: finalMessage, sentAt: at, readAt: at, taskId: task.id, dealId: task.dealId }).run();
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

/* ───────── Inbox ───────── */

/** Next timestamp in a thread: the simulated 10:00, or just after the thread's latest message. */
function nextThreadTime(brandId: number, today: string) {
  const last = getDb().select({ at: sql<string>`max(${messages.sentAt})` }).from(messages).where(eq(messages.brandId, brandId)).get()?.at;
  const base = `${today}T10:00:00`;
  if (!last || last < base) return base;
  const d = new Date(last + "Z");
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  return d.toISOString().slice(0, 19);
}

export async function markThreadRead(brandId: number) {
  const db = getDb();
  const today = getStoryDate(db);
  const res = db
    .update(messages)
    .set({ readAt: `${today}T10:00:00` })
    .where(and(eq(messages.brandId, brandId), eq(messages.direction, "in"), sql`${messages.readAt} is null`))
    .run();
  if (res.changes) revalidateAll();
}

export async function sendBrandReply(brandId: number, body: string) {
  const text = body.trim();
  if (!text) return;
  const db = getDb();
  const today = getStoryDate(db);
  const contact = db.select().from(brandContacts).where(and(eq(brandContacts.brandId, brandId), eq(brandContacts.isPrimary, true))).get();
  const channel = contact?.channel ?? "line";
  const at = nextThreadTime(brandId, today);
  db.transaction((tx) => {
    tx.insert(messages).values({ brandId, direction: "out", channel, body: text, sentAt: at, readAt: at }).run();
    tx.insert(activities).values({ brandId, type: "chat", channel, summary: text.length > 80 ? text.slice(0, 80) + "…" : text, occurredAt: at }).run();
  });
  revalidateAll();
}

/** Turn a detected brief into a deal at the Brief stage. */
export async function convertBrief(messageId: number, title: string, value: number) {
  const db = getDb();
  const today = getStoryDate(db);
  const msg = db.select().from(messages).where(eq(messages.id, messageId)).get();
  if (!msg || msg.briefStatus !== "new") return;
  const cards = db.select().from(rateCard).all();
  const deliverables = guessDeliverables(msg.brief?.platforms ?? []);
  const listPrice = deliverables.reduce((sum, c) => sum + (cards.find((x) => x.code === c)?.price ?? 0), 0);
  const dealTitle = title.trim() || msg.brief?.product || dataT.quote.newDeal;
  const dealValue = Number.isFinite(value) && value > 0 ? Math.round(value) : (msg.brief?.budget ?? listPrice);
  db.transaction((tx) => {
    const deal = tx.insert(deals).values({ brandId: msg.brandId, title: dealTitle, stage: "brief", value: dealValue, deliverables, createdAt: `${today}T10:00:00` }).returning({ id: deals.id }).get();
    tx.update(messages).set({ briefStatus: "converted", dealId: deal.id, readAt: msg.readAt ?? `${today}T10:00:00` }).where(eq(messages.id, messageId)).run();
    tx.insert(activities).values({ brandId: msg.brandId, dealId: deal.id, type: "brief_received", channel: msg.channel, summary: `ได้รับบรีฟ: ${dealTitle}`, occurredAt: `${today}T10:00:00` }).run();
  });
  revalidateAll();
}

export async function ignoreBrief(messageId: number) {
  getDb().update(messages).set({ briefStatus: "ignored" }).where(and(eq(messages.id, messageId), eq(messages.briefStatus, "new"))).run();
  revalidateAll();
}

export async function replyComment(commentId: number, text: string) {
  const db = getDb();
  db.update(comments).set({ replyStatus: "replied", replyText: text.trim() || null, repliedAt: `${getStoryDate(db)}T10:00:00` }).where(eq(comments.id, commentId)).run();
  revalidateAll();
}

export async function hideComment(commentId: number) {
  getDb().update(comments).set({ replyStatus: "hidden" }).where(eq(comments.id, commentId)).run();
  revalidateAll();
}

/* ───────── Finance ───────── */

export async function markInvoicePaid(invoiceId: number) {
  const db = getDb();
  const inv = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  if (!inv || inv.paidAt) return;
  // Paying the invoice is the same event as the deal reaching Paid (logs the timeline too).
  await moveDealStage(inv.dealId, "paid");
  db.update(invoices).set({ paidAt: getStoryDate(db) }).where(and(eq(invoices.id, invoiceId), sql`${invoices.paidAt} is null`)).run();
  revalidateAll();
}

/* ───────── Ask AI ───────── */

export async function askAiAction(question: string, history: ChatTurn[]): Promise<Answer & { fallback?: boolean }> {
  const q = question.trim().slice(0, 500);
  const i18n = await getI18n();
  const db = getDb();
  const facts = gatherFacts(db, getStoryDate(db), i18n);
  const assistant = getAssistant();
  try {
    return await assistant.answer(q, facts, i18n, history.slice(-6));
  } catch (e) {
    if (assistant.engine === "rules") throw e;
    console.error("Ask AI: Claude failed, answering offline:", e instanceof Error ? e.message : e);
    return { ...(await new RuleAssistant().answer(q, facts, i18n)), fallback: true };
  }
}

/* ───────── Publisher ───────── */

/** Simulated "now" for publishing = the story date at the 10:00 cron time. */
async function publishNow() {
  return `${getStoryDate(getDb())}T10:00:00`;
}

export async function publishPostAction(draft: ComposeDraft): Promise<CreateResult> {
  const res = await createJob(getDb(), draft, await publishNow());
  revalidateAll();
  return res;
}

export async function publishJobNowAction(jobId: number) {
  await publishJob(getDb(), jobId, await publishNow());
  revalidateAll();
}

export async function cancelJobAction(jobId: number) {
  cancelJob(getDb(), jobId);
  revalidateAll();
}

/* ───────── Data sources ───────── */

export interface ImportState {
  ok: boolean;
  message: string;
}

async function runCsvImport(platform: PlatformId, metricsCsv: string, commentsCsv?: string): Promise<ImportState> {
  const { t } = await getI18n();
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
  const { t } = await getI18n();
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
