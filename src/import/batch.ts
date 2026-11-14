/**
 * One-stop import, end to end.
 *   analyze  → save the upload, read every table, recognise each one (built-in first, AI for the
 *              unsure ones), import the confident ones straight away, keep the rest waiting
 *   confirm  → import the waiting ones the way the creator confirmed (or skip them)
 * Uploads are kept in data/import/batches/<id>/ (git-ignored, this computer only) so a waiting
 * table can be imported later without uploading again; batches older than a day are removed.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DB } from "@/db/client";
import { aiAvailable, detectByAI } from "./claudeDetect";
import { detectAs, detectByRules, isWorkbookSheet } from "./detect";
import { loadTable } from "./load";
import { isSupported, readTables, sheetNamesOf } from "./read";
import { missingFields, type Detection, type Kind, type Plan, type PlanItem, type PlatformId, type Table } from "./types";

const ROOT = path.join(process.cwd(), "data", "import", "batches");
const dirOf = (id: string) => path.join(ROOT, id.replace(/[^a-z0-9-]/gi, ""));

/** Import order: posts must exist before their comments. */
const ORDER: Kind[] = ["creator_workbook", "posts", "account_daily", "audience_age", "audience_gender", "audience_country", "comments", "brands_deals", "unknown"];

function cleanup() {
  if (!fs.existsSync(ROOT)) return;
  for (const d of fs.readdirSync(ROOT)) {
    const p = path.join(ROOT, d);
    if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600_000) fs.rmSync(p, { recursive: true, force: true });
  }
}

interface Source {
  name: string;
  buf: Buffer;
}

function savedFiles(batchId: string): Source[] {
  const dir = dirOf(batchId);
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+__/.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((f) => ({ name: f.replace(/^\d+__/, ""), buf: fs.readFileSync(path.join(dir, f)) }));
}

/** Tables of all files; a file that is the creator's workbook becomes one whole-file table. */
async function tablesOf(files: Source[]): Promise<{ tables: Table[]; unreadable: PlanItem[] }> {
  const tables: Table[] = [];
  const unreadable: PlanItem[] = [];
  for (const [i, f] of files.entries()) {
    if (!isSupported(f.name)) {
      unreadable.push(item({ id: `${i}:`, file: f.name, fileIndex: i, sheet: null, headers: [], rows: [] }, unknown("This file type can't be read yet — use CSV, TSV or Excel (.xlsx)"), "skipped"));
      continue;
    }
    try {
      const sheets = await sheetNamesOf(f.name, f.buf);
      const workbook = sheets.some(isWorkbookSheet);
      if (workbook) tables.push({ id: `${i}:*`, file: f.name, fileIndex: i, sheet: null, headers: [], rows: [] });
      for (const t of await readTables(f.name, i, f.buf)) if (!(workbook && isWorkbookSheet(t.sheet))) tables.push(t);
    } catch (e) {
      unreadable.push(item({ id: `${i}:`, file: f.name, fileIndex: i, sheet: null, headers: [], rows: [] }, unknown(`Couldn't read the file: ${e instanceof Error ? e.message : e}`), "failed"));
    }
  }
  return { tables, unreadable };
}

const unknown = (reason: string): Detection => ({ kind: "unknown", platform: null, mapping: {}, confidence: "low", by: "rules", reason });

function item(t: Table, detection: Detection, status: PlanItem["status"], message = ""): PlanItem {
  return { tableId: t.id, file: t.file, sheet: t.sheet, rows: t.rows.length, headers: t.headers.slice(0, 30), detection, status, message };
}

async function detect(t: Table): Promise<Detection> {
  if (t.id.endsWith(":*")) return { kind: "creator_workbook", platform: null, mapping: {}, confidence: "high", by: "rules", reason: "Your Creator OS workbook (sheets like TikTok_Clips, IG_Posts)" };
  const rules = detectByRules(t);
  if (rules.confidence === "high" || !aiAvailable()) return rules;
  try {
    const ai = await detectByAI(t);
    if (!ai) return rules;
    // Prefer the AI when it's at least as sure, or when the rules found nothing.
    const rank = { high: 3, medium: 2, low: 1 };
    return rules.kind === "unknown" || rank[ai.confidence] >= rank[rules.confidence] ? ai : rules;
  } catch (e) {
    return { ...rules, reason: `${rules.reason} · AI unavailable: ${e instanceof Error ? e.message.slice(0, 120) : e}` };
  }
}

/** Import one table. A failure goes back to "waiting" with the reason, so the creator can change the choice. */
async function run(db: DB, t: Table, d: Detection, now: string, files: Source[]): Promise<Pick<PlanItem, "status" | "message">> {
  try {
    const r = await loadTable(db, t, d, now, files[t.fileIndex]?.buf);
    return { status: r.ok ? "imported" : "needs_you", message: r.message };
  } catch (e) {
    return { status: "needs_you", message: `Couldn't import: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const sortByOrder = <T extends { kind: Kind }>(xs: T[]) => [...xs].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

export async function analyze(db: DB, uploads: Source[], now: string): Promise<Plan> {
  cleanup();
  const batchId = randomUUID();
  const dir = dirOf(batchId);
  fs.mkdirSync(dir, { recursive: true });
  uploads.forEach((f, i) => fs.writeFileSync(path.join(dir, `${i}__${path.basename(f.name).replace(/[^\p{L}\p{N}._ -]/gu, "_")}`), f.buf));

  const { tables, unreadable } = await tablesOf(uploads);
  const detected = await Promise.all(tables.map(async (t) => ({ t, d: await detect(t), kind: "unknown" as Kind })));
  for (const x of detected) x.kind = x.d.kind;

  const items: PlanItem[] = [...unreadable];
  for (const { t, d } of sortByOrder(detected)) {
    const missing = missingFields(d.kind, d.mapping);
    const ready = d.confidence === "high" && d.kind !== "unknown" && !missing.length;
    if (missing.length && d.kind !== "unknown") {
      items.push({ ...item(t, d, "needs_you", "Which column is it?"), missing });
      continue;
    }
    if (!ready) {
      const why = d.kind === "unknown" ? "Not recognised — tell me what it is, or skip it" : !d.platform && d.kind !== "brands_deals" ? "Which platform is this from?" : "Not sure — please check";
      items.push(item(t, d, "needs_you", why));
      continue;
    }
    items.push({ ...item(t, d, "imported"), ...(await run(db, t, d, now, uploads)) });
  }
  const plan: Plan = { batchId, createdAt: now, aiAvailable: aiAvailable(), items };
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan));
  return plan;
}

export interface Decision {
  tableId: string;
  skip?: boolean;
  kind?: Kind;
  platform?: PlatformId | null;
  /** field → column the creator picked for fields that weren't found */
  mapping?: Record<string, string>;
}

export async function confirm(db: DB, batchId: string, decisions: Decision[], now: string): Promise<Plan> {
  const dir = dirOf(batchId);
  if (!fs.existsSync(path.join(dir, "plan.json"))) throw new Error("This upload has expired — upload the files again");
  const plan = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8")) as Plan;
  const files = savedFiles(batchId);
  const { tables } = await tablesOf(files);
  const todo = decisions
    .map((dec) => ({ dec, it: plan.items.find((i) => i.tableId === dec.tableId && i.status === "needs_you"), t: tables.find((t) => t.id === dec.tableId) }))
    .filter((x): x is { dec: Decision; it: PlanItem; t: Table } => !!x.it && !!x.t)
    .map((x) => {
      const kind = x.dec.kind ?? x.it.detection.kind;
      const platform = x.dec.platform !== undefined ? x.dec.platform : x.it.detection.platform;
      // Same kind as recognised → keep its column mapping (it may come from the AI); otherwise map for the new kind.
      const base: Detection = kind === x.it.detection.kind ? { ...x.it.detection, platform, confidence: "high", by: "you" } : detectAs(x.t, kind, platform);
      const picked = Object.fromEntries(Object.entries(x.dec.mapping ?? {}).filter(([, col]) => x.t.headers.includes(col)));
      const d: Detection = { ...base, mapping: { ...base.mapping, ...picked } };
      return { ...x, d, kind };
    });
  for (const { dec, it, t, d } of sortByOrder(todo)) {
    if (dec.skip || d.kind === "unknown") {
      Object.assign(it, { status: "skipped", message: "Skipped" });
      continue;
    }
    if (d.kind !== "brands_deals" && d.kind !== "creator_workbook" && !d.platform) {
      Object.assign(it, { detection: d, message: "Pick a platform first" });
      continue;
    }
    const missing = missingFields(d.kind, d.mapping);
    if (missing.length) {
      Object.assign(it, { detection: d, missing, message: "Which column is it?" });
      continue;
    }
    Object.assign(it, { detection: d, missing: undefined }, await run(db, t, d, now, files));
  }
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan));
  return plan;
}
