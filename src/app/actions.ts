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
import { activities, brandContacts, brands, DEAL_STAGES, deals, PROVIDERS, quoteItems, quotes, rateCard, type DealStage, type Provider } from "@/db/schema";
import { getStoryDate } from "@/lib/queries/settings";
import { addDays } from "@/lib/dates";
import { stamp } from "@/lib/clock";
import { cookies } from "next/headers";
import { asLocale, dataT, fmt, LOCALE_COOKIE } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { runAutomations, type RunResult } from "@/automation/engine";
import { ingest } from "@/cdp/ingest";
import { CsvAdapter } from "@/cdp/adapters/csv/CsvAdapter";
import type { PlatformId } from "@/cdp/adapters/PlatformAdapter";
import { cancelJob, createJob, publishDue, publishJob, retryJob, type CreateResult } from "@/publish/service";
import type { ComposeDraft } from "@/publish/types";
import { gatherFacts } from "@/ai/facts";
import { getAssistant, RuleAssistant, type Answer, type ChatTurn } from "@/ai";
import { IS_LIVE } from "@/lib/config";
import { accessToken, disconnect, getConnection } from "@/connect/store";
import { syncProvider } from "@/connect/sync";
import { createGmailDraft } from "@/connect/gmail";
import { isLineUserId, pushLine } from "@/connect/line";
import { completeTaskApi, convertBriefApi, dismissTaskApi, createBrand, hideCommentApi, ignoreBriefApi, markRead, moveDeal, payInvoice, replyCommentApi, replyToBrand, resetAutomation, saveProfileApi, saveRatesApi, setRuleEnabled } from "@/lib/api";

function revalidateAll() {
  revalidatePath("/", "layout");
}

/* ───────── Login ───────── */

export async function loginAction(formData: FormData) {
  const { createSession, passwordMatches, SESSION_COOKIE, SESSION_DAYS } = await import("@/lib/auth");
  const raw = String(formData.get("next") ?? "/");
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  if (!(await passwordMatches(String(formData.get("password") ?? "")))) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSession(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86_400 });
  redirect(next);
}

export async function logoutAction() {
  const { SESSION_COOKIE } = await import("@/lib/auth");
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/* ───────── UI language ───────── */

export async function setLocaleAction(locale: string) {
  const store = await cookies();
  store.set(LOCALE_COOKIE, asLocale(locale), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidateAll();
}

/* ───────── Pipeline ───────── */

/** The Go API owns this write: it moves the deal, creates the invoice and logs the brand timeline. */
export async function moveDealStage(dealId: number, stage: DealStage) {
  if (!DEAL_STAGES.includes(stage)) return;
  await moveDeal(dealId, stage);
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
      dealId = tx.insert(deals).values({ brandId, title, stage: "quotation", value, deliverables, createdAt: stamp(today, "09:00:00") }).returning({ id: deals.id }).get().id;
    }
    const n = tx.select({ n: sql<number>`count(*)` }).from(quotes).get()!.n + 1;
    const q = tx
      .insert(quotes)
      .values({ number: `QT-${today.slice(0, 4)}-${String(n).padStart(3, "0")}`, brandId, dealId, createdAt: today, validUntil: addDays(today, 14), discountPct, notes })
      .returning({ id: quotes.id })
      .get();
    tx.insert(quoteItems).values(items.map((i) => ({ quoteId: q.id, rateCardId: i.card.id, qty: i.qty, unitPrice: i.card.price }))).run();
    tx.insert(activities).values({ brandId, dealId, type: "quote_sent", channel: "system", summary: `${dataT.quote.printTitle} ${value.toLocaleString()} ${dataT.common.baht}`, occurredAt: stamp(today, "15:00:00") }).run();
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

/** Human approves a drafted task (after editing/copying it) → mark done + log on the brand timeline. */
export async function completeTask(taskId: number, finalMessage: string) {
  const r = await completeTaskApi(taskId, finalMessage);
  // With Gmail connected, an approved email also becomes a Gmail draft (still not sent).
  if (r.done && r.channel === "email" && r.brandId) await gmailDraftFor(r.brandId, r.title, finalMessage).catch((e) => console.error("Gmail draft:", e));
  revalidateAll();
}

export async function dismissTask(taskId: number) {
  await dismissTaskApi(taskId);
  revalidateAll();
}

export async function resetTasks() {
  await resetAutomation();
  revalidateAll();
}

export async function toggleRule(ruleId: string, enabled: boolean) {
  await setRuleEnabled(ruleId, enabled);
  revalidateAll();
}

/* ───────── Inbox ───────── */

export async function markThreadRead(brandId: number) {
  const { changed } = await markRead(brandId);
  if (changed) revalidateAll();
}

export async function sendBrandReply(brandId: number, body: string) {
  if (!body.trim()) return;
  await replyToBrand(brandId, body);
  revalidateAll();
}

/** Turn a detected brief into a deal at the Brief stage. */
export async function convertBrief(messageId: number, title: string, value: number) {
  await convertBriefApi(messageId, title, Number.isFinite(value) ? value : 0);
  revalidateAll();
}

export async function ignoreBrief(messageId: number) {
  await ignoreBriefApi(messageId);
  revalidateAll();
}

export async function replyComment(commentId: number, text: string) {
  await replyCommentApi(commentId, text);
  revalidateAll();
}

export async function hideComment(commentId: number) {
  await hideCommentApi(commentId);
  revalidateAll();
}

/* ───────── Connected accounts ───────── */

async function gmailDraftFor(brandId: number, subject: string, body: string) {
  const db = getDb();
  if (!getConnection(db, "google")) return false;
  const contact = db.select().from(brandContacts).where(and(eq(brandContacts.brandId, brandId), eq(brandContacts.isPrimary, true))).get();
  if (contact?.channel !== "email" || !contact.handle.includes("@")) return false;
  await createGmailDraft(await accessToken(db, "google"), contact.handle, subject, body);
  return true;
}

export async function saveGmailDraftAction(brandId: number, text: string): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const brand = db.select().from(brands).where(eq(brands.id, brandId)).get();
  try {
    return { ok: await gmailDraftFor(brandId, brand ? `${brand.name}` : "Creator OS", text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Really sends on LINE (only when the creator clicks), then records it like "Mark as sent". */
export async function sendLineReplyAction(brandId: number, text: string): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const contact = db.select().from(brandContacts).where(and(eq(brandContacts.brandId, brandId), eq(brandContacts.isPrimary, true))).get();
  if (!contact || contact.channel !== "line" || !isLineUserId(contact.handle)) return { ok: false, error: "This brand has no LINE chat" };
  try {
    await pushLine(contact.handle, text.trim());
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  await sendBrandReply(brandId, text);
  return { ok: true };
}

export async function syncNowAction(provider: string): Promise<string> {
  if (!IS_LIVE || !PROVIDERS.includes(provider as Provider)) return "unavailable";
  const res = await syncProvider(getDb(), provider as Provider);
  revalidateAll();
  return res;
}

export async function disconnectAction(provider: string) {
  if (!PROVIDERS.includes(provider as Provider)) return;
  disconnect(getDb(), provider as Provider);
  revalidateAll();
}

/* ───────── Brands & rate card ───────── */

/** Adds a brand through the Go API, then opens its page. */
export async function createBrandAction(formData: FormData) {
  const field = (k: string) => String(formData.get(k) ?? "");
  const name = field("name").trim();
  if (!name) return;
  const { id } = await createBrand({ name, category: field("category"), website: field("website"), contactName: field("contactName"), contactRole: field("contactRole"), channel: field("channel"), handle: field("handle") });
  revalidateAll();
  redirect(`/brands/${id}`);
}

export async function saveRatesAction(formData: FormData) {
  const prices: Record<string, number> = {};
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("price_")) continue;
    const price = Number(raw);
    if (Number.isFinite(price)) prices[key.slice(6)] = price;
  }
  await saveRatesApi(prices);
  revalidateAll();
}

/* ───────── Your profile & CRM import ───────── */

export async function saveProfileAction(formData: FormData) {
  const text = (k: string) => String(formData.get(k) ?? "");
  const platforms = ["tiktok", "instagram", "youtube"];
  await saveProfileApi({
    name: text("name"),
    tagline: text("tagline"),
    handles: Object.fromEntries(platforms.map((p) => [p, text(`handle_${p}`)])),
    followers: Object.fromEntries(platforms.map((p) => [p, text(`followers_${p}`)])),
  });
  revalidateAll();
}

export async function importCrmAction(_prev: ImportState | null, formData: FormData): Promise<ImportState> {
  const { importCrm } = await import("@/crm/importCrm");
  const { t } = await getI18n();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: fmt(t.settings.importFail, { message: "CSV" }) };
  try {
    const db = getDb();
    const r = importCrm(db, await file.text(), getStoryDate(db));
    revalidateAll();
    const msg = fmt(t.crmImport.done, { brands: r.brands, deals: r.deals, invoices: r.invoices, skipped: r.skipped });
    return { ok: r.errors.length === 0, message: r.errors.length ? `${msg} · ${r.errors.slice(0, 5).join(" · ")}` : msg };
  } catch (e) {
    return { ok: false, message: fmt(t.settings.importFail, { message: e instanceof Error ? e.message : String(e) }) };
  }
}

export async function importWorkbookAction(_prev: ImportState | null, formData: FormData): Promise<ImportState> {
  const { importWorkbook } = await import("@/cdp/adapters/workbook/importWorkbook");
  const { t } = await getI18n();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, message: t.workbook.files };
  const db = getDb();
  const now = stamp(getStoryDate(db));
  let posts = 0,
    days = 0,
    months = 0;
  const brandsAdded: string[] = [];
  try {
    for (const f of files) {
      const r = await importWorkbook(db, await f.arrayBuffer(), now);
      posts += Object.values(r.posts).reduce((a, b) => a + (b ?? 0), 0);
      days += r.accountDays;
      months += r.audienceMonths;
      brandsAdded.push(...r.brandsAdded);
    }
  } catch (e) {
    return { ok: false, message: fmt(t.settings.importFail, { message: e instanceof Error ? e.message : String(e) }) };
  }
  revalidateAll();
  const msg = fmt(t.workbook.done, { posts, days, months });
  return { ok: true, message: brandsAdded.length ? `${msg} · ${fmt(t.workbook.brands, { list: brandsAdded.join(", ") })}` : msg };
}

/* ───────── Finance ───────── */

/** Paying an invoice is the same event as the deal reaching Paid: the Go API does both and logs the timeline. */
export async function markInvoicePaid(invoiceId: number) {
  await payInvoice(invoiceId);
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

/** "Now" for publishing: the real Bangkok time in live mode, the story date at the 10:00 cron time in demo mode. */
async function publishNow() {
  return stamp(getStoryDate(getDb()));
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

export async function retryJobAction(jobId: number) {
  await retryJob(getDb(), jobId, await publishNow());
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
    db.insert(importRuns).values({ platformId: platform, adapter: "csv", startedAt: stamp(today, "10:05:00"), finishedAt: stamp(today, "10:05:00"), status: "failed", message }).run();
    revalidateAll();
    return { ok: false, message: fmt(t.settings.importFail, { message }) };
  }
  const r = await ingest(db, adapter, stamp(today, "10:05:00"));
  revalidateAll();
  if (r.status === "failed") return { ok: false, message: fmt(t.settings.importFail, { message: r.message ?? "" }) };
  return { ok: true, message: fmt(t.settings.importOk, { platform: t.platforms[platform], contents: r.contents, metrics: r.metricRows, comments: r.comments }) };
}

export async function importCsvAction(_prev: ImportState | null, formData: FormData): Promise<ImportState> {
  const { t } = await getI18n();
  const platform = String(formData.get("platform")) as PlatformId;
  const metrics = formData.get("metrics");
  const comments = formData.get("comments");
  if (!(metrics instanceof File) || metrics.size === 0) return { ok: false, message: t.settings.chooseFileFirst };
  if (/\.xlsx?$/i.test(metrics.name)) return { ok: false, message: t.settings.excelHint };
  const commentsText = comments instanceof File && comments.size > 0 ? await comments.text() : undefined;
  return runCsvImport(platform, await metrics.text(), commentsText);
}

export async function importSampleAction(_prev: ImportState | null, formData: FormData): Promise<ImportState> {
  if (IS_LIVE) return { ok: false, message: "Sample files are only available in demo mode" };
  const platform = String(formData.get("platform")) as PlatformId;
  const dir = path.join(process.cwd(), "data", "samples");
  const metrics = fs.readFileSync(path.join(dir, `${platform}_metrics.csv`), "utf8");
  const commentsFile = path.join(dir, `${platform}_comments.csv`);
  return runCsvImport(platform, metrics, fs.existsSync(commentsFile) ? fs.readFileSync(commentsFile, "utf8") : undefined);
}

/* ───────── Demo reset ───────── */

export async function resetDemoAction() {
  if (IS_LIVE) return; // never wipe real data
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
