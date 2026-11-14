/**
 * Bulk import of brands and deals from one spreadsheet (CSV), one row per deal.
 * A row without deal_title only creates/updates the brand. Re-importing the same file
 * skips deals that already exist (same brand + title + created date).
 * Stages from Invoiced on get an invoice; Paid deals count toward tiers via closed_at.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { activities, brandContacts, brands, DEAL_STAGES, deals, invoices, PRODUCT_CATEGORIES, rateCard, type DealStage, type ProductCategory } from "@/db/schema";
import { parseCsv } from "@/cdp/adapters/csv/parseCsv";
import { stageAtLeast } from "./rules";
import { addDays } from "@/lib/dates";
import { th } from "@/lib/i18n/th";
import { en } from "@/lib/i18n/en";

import { CRM_COLUMNS } from "./crmColumns";
export { CRM_COLUMNS };

export function crmTemplate() {
  const rows = [
    CRM_COLUMNS.join(","),
    "EXAMPLE Skin (delete this row),skincare,exampleskin.com,Khun A,Brand Manager,line,@exampleskin,Serum launch,paid,30000,TT_VIDEO+IG_REEL,2026-03-01,2026-03-20,2026-04-15,INV-0001",
    "EXAMPLE Skin (delete this row),skincare,,,,,,Year-end campaign,brief,45000,BUNDLE_3P,2026-10-28,,,",
  ];
  return "﻿" + rows.join("\n") + "\n";
}

const CATEGORY_WORDS: Record<string, ProductCategory> = { สกินแคร์: "skincare", ความงาม: "skincare", beauty: "skincare", เทค: "tech", แกดเจ็ต: "tech", gadget: "tech", อาหาร: "food", บ้าน: "home", ของใช้ในบ้าน: "home", แฟชั่น: "fashion" };
const CHANNELS = { line: "line", email: "email", ig_dm: "ig_dm", ig: "ig_dm", instagram: "ig_dm", อีเมล: "email" } as const;

function stageOf(v: string): DealStage | null {
  const s = v.trim().toLowerCase().replace(/\s+/g, "_");
  if ((DEAL_STAGES as readonly string[]).includes(s)) return s as DealStage;
  for (const st of DEAL_STAGES) if ([th.stages[st], en.stages[st]].some((n) => n.toLowerCase() === v.trim().toLowerCase())) return st;
  return null;
}
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim());

export function importCrm(db: DB, csv: string, today: string) {
  const rows = parseCsv(csv);
  const missing = ["brand"].filter((c) => rows.length && !(c in rows[0]));
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(", ")}`);
  const codes = new Set(db.select({ code: rateCard.code }).from(rateCard).all().map((r) => r.code));
  const result = { brands: 0, deals: 0, invoices: 0, skipped: 0, errors: [] as string[] };

  db.transaction((tx) => {
    rows.forEach((r, i) => {
      const line = i + 2;
      const name = (r.brand ?? "").trim();
      if (!name || /delete this row/i.test(name)) return;
      const catRaw = (r.category ?? "").trim().toLowerCase();
      const category = (PRODUCT_CATEGORIES as readonly string[]).includes(catRaw) ? (catRaw as ProductCategory) : (CATEGORY_WORDS[catRaw] ?? "home");

      let brand = tx.select().from(brands).where(sql`lower(${brands.name}) = ${name.toLowerCase()}`).get();
      if (!brand) {
        brand = tx.insert(brands).values({ name, category, website: r.website?.trim() || null, createdAt: `${(isDate(r.created_date ?? "") ? r.created_date : today).trim()}T09:00:00` }).returning().get();
        result.brands++;
      }
      const handle = (r.contact_handle ?? "").trim();
      if (handle || r.contact_name?.trim()) {
        const channel = CHANNELS[(r.contact_channel ?? "").trim().toLowerCase() as keyof typeof CHANNELS] ?? (handle.includes("@") && handle.includes(".") ? "email" : "line");
        const exists = tx.select().from(brandContacts).where(eq(brandContacts.brandId, brand.id)).get();
        if (!exists) tx.insert(brandContacts).values({ brandId: brand.id, name: r.contact_name?.trim() || "—", role: r.contact_role?.trim() || "—", channel, handle: handle || "—", isPrimary: true }).run();
      }

      const title = (r.deal_title ?? "").trim();
      if (!title) return;
      const stage = stageOf(r.stage ?? "") ?? "lead";
      if (r.stage && !stageOf(r.stage)) result.errors.push(`Row ${line}: unknown stage “${r.stage}”, used Lead`);
      const value = Math.round(Number((r.value ?? "0").replace(/[^\d.]/g, ""))) || 0;
      const deliverables = (r.deliverables ?? "").split(/[+|;]/).map((s) => s.trim().toUpperCase()).filter((c) => codes.has(c));
      const posted = isDate(r.posted_date ?? "") ? r.posted_date.trim() : null;
      const paid = isDate(r.paid_date ?? "") ? r.paid_date.trim() : null;
      const created = isDate(r.created_date ?? "") ? r.created_date.trim() : (posted ? addDays(posted, -21) : today);
      if (stageAtLeast(stage, "posted") && !posted) result.errors.push(`Row ${line}: “${title}” is ${stage} but has no posted_date`);

      const dup = tx.select({ id: deals.id }).from(deals).where(and(eq(deals.brandId, brand.id), eq(deals.title, title), sql`substr(${deals.createdAt},1,10) = ${created}`)).get();
      if (dup) {
        result.skipped++;
        return;
      }
      const deal = tx
        .insert(deals)
        .values({ brandId: brand.id, title, stage, value, deliverables, createdAt: `${created}T09:00:00`, postedAt: posted ? `${posted}T19:00:00` : null, closedAt: stage === "paid" ? `${paid ?? posted ?? created}T14:00:00` : null })
        .returning({ id: deals.id })
        .get();
      result.deals++;
      const act = (type: (typeof activities.$inferInsert)["type"], day: string, summary: string) => tx.insert(activities).values({ brandId: brand!.id, dealId: deal.id, type, channel: "system", summary, occurredAt: `${day}T12:00:00` }).run();
      act(stage === "lead" ? "chat" : "brief_received", created, `นำเข้า: ${title}`);
      if (posted) act("posted", posted, `โพสต์งาน ${title}`);

      if (stageAtLeast(stage, "invoiced")) {
        const issued = posted ? addDays(posted, 10) : created;
        const n = tx.select({ n: sql<number>`count(*)` }).from(invoices).get()!.n + 1;
        const number = r.invoice_no?.trim() || `INV-${String(n).padStart(4, "0")}`;
        if (tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.number, number)).get()) result.errors.push(`Row ${line}: invoice ${number} already exists, skipped the invoice`);
        else {
          tx.insert(invoices).values({ dealId: deal.id, number, amount: value, issuedAt: issued, dueAt: addDays(issued, 30), paidAt: stage === "paid" ? (paid ?? addDays(issued, 30)) : null }).run();
          result.invoices++;
          act("invoiced", issued, `ออกใบแจ้งหนี้ ${number}`);
          if (stage === "paid") act("paid", paid ?? addDays(issued, 30), `รับชำระ ${value.toLocaleString()} บาท`);
        }
      }
    });
  });
  return result;
}
