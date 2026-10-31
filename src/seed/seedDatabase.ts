import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { count } from "drizzle-orm";
import { openDb, type DB } from "@/db/client";
import * as s from "@/db/schema";
import { STORY_DATE, HISTORY_DAYS } from "@/lib/config";
import { addDays } from "@/lib/dates";
import { createRng } from "@/lib/rng";
import { generateMockData, type SponsoredSlot } from "@/cdp/adapters/mock/generator";
import { MockAdapter } from "@/cdp/adapters/mock/MockAdapter";
import { ingest } from "@/cdp/ingest";
import { applyConsent, withdrawConsent } from "@/cdp/consent";
import { AUTOMATION_RULES, BRANDS, DEALS, DELIVERABLE_PLATFORM, PLATFORMS, RATE_CARD, type DealSpec } from "./fixtures";

const STAGE_INDEX = Object.fromEntries(s.DEAL_STAGES.map((st, i) => [st, i])) as Record<s.DealStage, number>;
const atStage = (d: DealSpec, st: s.DealStage) => STAGE_INDEX[d.stage] >= STAGE_INDEX[st];
const ago = (n: number, time = "10:00:00") => `${addDays(STORY_DATE, -n)}T${time}`;

export interface SeedReport {
  file: string;
  counts: Record<string, number>;
  classifierAgreement: number;
}

/** Builds a fresh database at `file` (overwriting it) and fills it with the story. */
export async function seedDatabase(file: string): Promise<SeedReport> {
  for (const f of [file, file + "-wal", file + "-shm"]) if (fs.existsSync(f)) fs.rmSync(f);
  // Uploaded publisher media belongs to the old database.
  fs.rmSync(path.join(path.dirname(file), "uploads"), { recursive: true, force: true });
  const { db, sqlite } = openDb(file);
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const rng = createRng(Number(process.env.SEED ?? 42));

  // Reference data
  db.insert(s.platforms).values(PLATFORMS.map((p) => ({ ...p }))).run();
  db.insert(s.rateCard).values(RATE_CARD).run();
  db.insert(s.automationRules).values(AUTOMATION_RULES.map((r) => ({ ...r, schedule: "ทุกวัน 10:00", enabled: true }))).run();
  db.insert(s.appSettings).values([{ key: "story_date", value: STORY_DATE }]).run();

  // CRM story
  const price = Object.fromEntries(RATE_CARD.map((r) => [r.code, r.price]));
  const brandId: Record<string, number> = {};
  const brandByKey = Object.fromEntries(BRANDS.map((b) => [b.key, b]));
  for (const b of BRANDS) {
    const row = db
      .insert(s.brands)
      .values({ name: b.name, category: b.category, website: `${b.name.toLowerCase().replace(/[^a-z]+/g, "")}.example`, notes: b.notes ?? null, createdAt: ago(b.createdDaysAgo) })
      .returning({ id: s.brands.id })
      .get();
    brandId[b.key] = row.id;
    db.insert(s.brandContacts)
      .values({
        brandId: row.id,
        name: b.contact.name,
        role: b.contact.role,
        channel: b.contact.channel,
        handle: b.contact.channel === "email" ? `contact@${b.key}.example` : `@${b.key}-mkt`,
        isPrimary: true,
      })
      .run();
  }

  const sponsored: SponsoredSlot[] = [];
  let invoiceNo = 1;
  for (const d of DEALS) {
    const b = brandByKey[d.brand];
    const gross = d.deliverables.reduce((sum, code) => sum + price[code], 0);
    const value = Math.round((gross * (100 - (d.discountPct ?? 0))) / 100);
    const created = d.createdDaysAgo ?? (d.postedDaysAgo ?? 0) + 21;
    const posted = atStage(d, "posted") ? d.postedDaysAgo! : null;
    const paid = d.stage === "paid" ? (d.paidDaysAgo ?? posted! - 25) : null;
    const deal = db
      .insert(s.deals)
      .values({
        brandId: brandId[d.brand],
        title: d.title,
        stage: d.stage,
        value,
        deliverables: d.deliverables,
        createdAt: ago(created, "09:30:00"),
        postedAt: posted !== null ? ago(posted, "19:00:00") : null,
        closedAt: paid !== null ? ago(paid, "14:00:00") : null,
      })
      .returning({ id: s.deals.id })
      .get();

    // Invoice: issued 10 days after posting, net 30.
    let issued: number | null = null;
    if (atStage(d, "invoiced")) {
      issued = posted! - 10;
      db.insert(s.invoices)
        .values({
          dealId: deal.id,
          number: `INV-${String(invoiceNo++).padStart(4, "0")}`,
          amount: value,
          issuedAt: addDays(STORY_DATE, -issued),
          dueAt: addDays(STORY_DATE, -issued + 30),
          paidAt: paid !== null ? addDays(STORY_DATE, -paid) : null,
        })
        .run();
    }

    // Activity timeline derived from how far the deal progressed.
    const act = (type: s.ActivityType, daysAgo: number, summary: string, channel: (typeof s.activities.$inferInsert)["channel"] = b.contact.channel, time?: string) => {
      if (daysAgo < 0) return;
      db.insert(s.activities).values({ brandId: brandId[d.brand], dealId: deal.id, type, channel, summary, occurredAt: ago(daysAgo, time) }).run();
    };
    if (d.stage === "lead") act("chat", created, `แบรนด์ทักมาสอบถามเรท: ${d.title}`, b.contact.channel, "13:20:00");
    else act("brief_received", created, `ได้รับบรีฟ: ${d.title}`, b.contact.channel, "09:30:00");
    if (atStage(d, "quotation")) act("quote_sent", created - 2, `ส่งใบเสนอราคา ${value.toLocaleString()} บาท`, "email", "15:00:00");
    if (atStage(d, "production")) {
      const draftAgo = posted !== null ? posted + 5 : created - 8;
      act("draft_sent", draftAgo, "ส่งดราฟต์ให้แบรนด์ตรวจ", b.contact.channel, "11:00:00");
      if (rng.chance(0.5) && draftAgo - 2 >= (posted ?? 0)) act("revision", draftAgo - 2, "แบรนด์ขอแก้ไขเล็กน้อย (โลโก้/คำโปรย)", b.contact.channel, "16:40:00");
    }
    const pkgNames = d.deliverables.map((c) => RATE_CARD.find((r) => r.code === c)!.name).join(" + ");
    if (posted !== null) act("posted", posted, `โพสต์งาน ${pkgNames}`, "system", "19:00:00");
    if (atStage(d, "report_sent")) act("report_sent", posted! - 7, "ส่งรายงานผล +7 วัน", "email", "10:30:00");
    if (issued !== null) act("invoiced", issued, "ออกใบแจ้งหนี้", "email", "10:00:00");
    if (paid !== null) act("paid", paid, `รับชำระ ${value.toLocaleString()} บาท`, "system", "14:00:00");

    for (const code of d.deliverables) {
      const platform = DELIVERABLE_PLATFORM[code];
      const expand = RATE_CARD.find((r) => r.code === code)!.includes;
      if (posted === null) continue;
      for (const item of platform ? [code] : expand) {
        sponsored.push({
          dealId: deal.id,
          brandName: b.name,
          dealTitle: d.title,
          category: b.category,
          platform: DELIVERABLE_PLATFORM[item],
          postedOn: addDays(STORY_DATE, -posted),
          dedicated: item === "YT_DEDICATED",
        });
      }
    }
  }
  // A few relationship touches on active brands (not on silent ones).
  for (const [key, daysAgo, summary] of [
    ["glow", 40, "คุยไลน์เรื่องแผนแคมเปญปลายปี"],
    ["glow", 12, "โทรสรุปผลแคมเปญมอยส์เจอไรเซอร์"],
    ["pixel", 20, "ทวงถามบิล INV ทางอีเมล (ครั้งที่ 1)"],
    ["mellow", 30, "ส่งไอเดียคอนเทนต์ปีใหม่"],
    ["kumo", 9, "แบรนด์ขอบคุณรายงานผล สนใจคุยงานต่อ"],
  ] as const) {
    db.insert(s.activities)
      .values({ brandId: brandId[key], type: key === "glow" && daysAgo === 12 ? "call" : "chat", channel: key === "pixel" ? "email" : "line", summary, occurredAt: ago(daysAgo, "14:30:00") })
      .run();
  }

  // CDP: generate raw platform data and push it through the real ingest pipeline.
  const bundles = generateMockData({ rng, storyDate: STORY_DATE, historyDays: HISTORY_DAYS, sponsored, spikeCategory: "tech" });
  let agree = 0;
  let total = 0;
  const { KeywordClassifier } = await import("@/cdp/classify/keywordClassifier");
  const kc = new KeywordClassifier();
  for (const p of ["tiktok", "instagram", "youtube"] as const) {
    bundles[p].comments.forEach((c, i) => {
      total++;
      if (kc.classifyOne(c.text) === bundles[p].intended[i]) agree++;
    });
    await ingest(db, new MockAdapter(p, bundles[p]), `${STORY_DATE}T06:00:00`);
  }
  // An older failed CSV attempt so Data Sources shows a realistic history.
  db.insert(s.importRuns)
    .values({
      platformId: "instagram",
      adapter: "csv",
      startedAt: `${addDays(STORY_DATE, -2)}T21:14:00`,
      finishedAt: `${addDays(STORY_DATE, -2)}T21:14:02`,
      status: "failed",
      message: "Missing column(s): Profile visits",
    })
    .run();

  seedConsents(db, rng);

  const counts = Object.fromEntries(
    (
      [
        ["contents", s.contents],
        ["content_metrics_daily", s.contentMetricsDaily],
        ["comments", s.comments],
        ["pseudonyms", s.pseudonyms],
        ["consents", s.consents],
        ["audience_snapshots", s.audienceSnapshots],
        ["brands", s.brands],
        ["deals", s.deals],
        ["invoices", s.invoices],
        ["activities", s.activities],
      ] as const
    ).map(([name, table]) => [name, db.select({ n: count() }).from(table).get()!.n]),
  );
  sqlite.close();
  return { file, counts, classifierAgreement: total ? agree / total : 1 };
}

/** Marketing opt-ins from a (mock) newsletter form, plus a handful of analytics withdrawals. */
function seedConsents(db: DB, rng: ReturnType<typeof createRng>) {
  const subjects = db.select({ id: s.pseudonyms.pseudoId }).from(s.pseudonyms).all().map((r) => r.id);
  const optIns = subjects.filter(() => rng.chance(0.06));
  for (const id of optIns) {
    db.insert(s.consents)
      .values({ subjectPseudoId: id, purpose: "marketing", lawfulBasis: "consent", status: "active", source: "newsletter_form", grantedAt: `${addDays(STORY_DATE, -rng.int(5, 110))}T12:00:00` })
      .run();
  }
  const withdrawals = subjects.filter(() => rng.chance(0.012));
  for (const id of withdrawals) withdrawConsent(db, id, `${addDays(STORY_DATE, -rng.int(1, 30))}T09:00:00`);
  applyConsent(db);
}
