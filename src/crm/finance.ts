/**
 * Finance rollups from invoices (the source of truth for money received).
 *
 * Income       = invoice amounts by `paid_at` (cash basis).
 * Outstanding  = unpaid invoices. Overdue = unpaid and past `due_at`.
 * Expected     = won deals not yet invoiced (Production → Report sent).
 * By platform  = each invoice split across its deliverables by rate-card price
 *                (bundles expand to their parts; add-ons are their own bucket).
 * Tax          = ESTIMATE only: Thai companies usually withhold 3% on service fees.
 */
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { brands, deals, invoices, rateCard } from "@/db/schema";
import { addDays, addMonths, diffDays, monthOf } from "@/lib/dates";
import { stageAtLeast } from "./rules";

export const WHT_RATE = 0.03;
export type InvoiceStatus = "paid" | "due" | "overdue";
export type IncomeBucket = "tiktok" | "instagram" | "youtube" | "addons";
export const INCOME_BUCKETS: IncomeBucket[] = ["tiktok", "instagram", "youtube", "addons"];
export const AGEING = ["notDue", "d1_30", "d31_60", "d61"] as const;
export type AgeingBucket = (typeof AGEING)[number];

export interface InvoiceRow {
  id: number;
  number: string;
  amount: number;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  dealId: number;
  dealTitle: string;
  dealStage: typeof deals.$inferSelect.stage;
  brandId: number;
  brandName: string;
  status: InvoiceStatus;
  daysOverdue: number;
}

export function listInvoices(db: DB, today: string): InvoiceRow[] {
  return db
    .select({ inv: invoices, dealTitle: deals.title, dealStage: deals.stage, brandId: brands.id, brandName: brands.name })
    .from(invoices)
    .innerJoin(deals, eq(deals.id, invoices.dealId))
    .innerJoin(brands, eq(brands.id, deals.brandId))
    .all()
    .filter((r) => r.inv.issuedAt <= today)
    .map(({ inv, ...r }) => {
      const paid = !!inv.paidAt && inv.paidAt <= today;
      const daysOverdue = paid ? 0 : Math.max(0, diffDays(inv.dueAt, today));
      return { ...inv, ...r, paidAt: paid ? inv.paidAt : null, status: paid ? "paid" : daysOverdue > 0 ? "overdue" : "due", daysOverdue } as InvoiceRow;
    })
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.number.localeCompare(a.number));
}

function ageingOf(r: InvoiceRow): AgeingBucket {
  if (r.daysOverdue <= 0) return "notDue";
  if (r.daysOverdue <= 30) return "d1_30";
  if (r.daysOverdue <= 60) return "d31_60";
  return "d61";
}

/** Share of a deal's value that belongs to each platform / add-ons, from rate-card prices. */
export function platformWeights(deliverables: string[], cards: (typeof rateCard.$inferSelect)[]): Record<IncomeBucket, number> {
  const price = (code: string) => cards.find((c) => c.code === code)?.price ?? 0;
  const w: Record<IncomeBucket, number> = { tiktok: 0, instagram: 0, youtube: 0, addons: 0 };
  for (const code of deliverables) {
    const card = cards.find((c) => c.code === code);
    if (!card) continue;
    if (card.kind === "addon") w.addons += card.price;
    else if (card.platformId) w[card.platformId as IncomeBucket] += card.price;
    else {
      const parts = card.includes.map((c) => ({ c, p: price(c), platform: cards.find((x) => x.code === c)?.platformId as IncomeBucket }));
      const sum = parts.reduce((s, x) => s + x.p, 0) || 1;
      for (const x of parts) w[x.platform] += (card.price * x.p) / sum;
    }
  }
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(INCOME_BUCKETS.map((k) => [k, w[k] / total])) as Record<IncomeBucket, number>;
}

export function financeData(db: DB, today: string) {
  const rows = listInvoices(db, today);
  const year = today.slice(0, 4);
  const lastYearSameDay = `${Number(year) - 1}${today.slice(4)}`;
  const paid = rows.filter((r) => r.status === "paid");
  const unpaid = rows.filter((r) => r.status !== "paid");
  const sum = (xs: InvoiceRow[]) => xs.reduce((s, r) => s + r.amount, 0);

  const incomeYtd = sum(paid.filter((r) => r.paidAt!.startsWith(year)));
  const incomePrevYtd = sum(paid.filter((r) => r.paidAt!.startsWith(String(Number(year) - 1)) && r.paidAt! <= lastYearSameDay));
  const yearAgo = addDays(today, -364);
  const paid12 = paid.filter((r) => r.paidAt! >= yearAgo);
  const avgDaysToPay = paid12.length ? paid12.reduce((s, r) => s + diffDays(r.issuedAt, r.paidAt!), 0) / paid12.length : null;

  const allDeals = db.select({ d: deals, brandName: brands.name }).from(deals).innerJoin(brands, eq(brands.id, deals.brandId)).all();
  const invoicedDeals = new Set(rows.map((r) => r.dealId));
  const expected = allDeals.filter(({ d }) => d.createdAt.slice(0, 10) <= today && stageAtLeast(d.stage, "production") && !stageAtLeast(d.stage, "invoiced") && !invoicedDeals.has(d.id));

  // Monthly cash received, last 12 months
  const thisMonth = monthOf(today);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, i - 11));
  const monthly = months.map((m) => ({ month: m, income: sum(paid.filter((r) => r.paidAt!.startsWith(m))) }));

  // Income by brand (12 months)
  const brandMap = new Map<number, { brandId: number; brandName: string; income: number; invoices: number }>();
  for (const r of paid12) {
    const b = brandMap.get(r.brandId) ?? { brandId: r.brandId, brandName: r.brandName, income: 0, invoices: 0 };
    b.income += r.amount;
    b.invoices++;
    brandMap.set(r.brandId, b);
  }
  const byBrand = [...brandMap.values()].sort((a, b) => b.income - a.income);

  // Income by platform (12 months)
  const cards = db.select().from(rateCard).all();
  const dealById = new Map(allDeals.map(({ d }) => [d.id, d]));
  const byPlatform: Record<IncomeBucket, number> = { tiktok: 0, instagram: 0, youtube: 0, addons: 0 };
  for (const r of paid12) {
    const w = platformWeights(dealById.get(r.dealId)?.deliverables ?? [], cards);
    for (const k of INCOME_BUCKETS) byPlatform[k] += r.amount * w[k];
  }

  const ageing = Object.fromEntries(AGEING.map((a) => [a, { n: 0, amount: 0 }])) as Record<AgeingBucket, { n: number; amount: number }>;
  for (const r of unpaid) {
    const a = ageing[ageingOf(r)];
    a.n++;
    a.amount += r.amount;
  }

  const years = [...new Set(paid.map((r) => r.paidAt!.slice(0, 4)))].sort().reverse();
  const tax = years.map((y) => {
    const gross = sum(paid.filter((r) => r.paidAt!.startsWith(y)));
    return { year: y, gross, wht: Math.round(gross * WHT_RATE), net: Math.round(gross * (1 - WHT_RATE)), invoices: paid.filter((r) => r.paidAt!.startsWith(y)).length };
  });

  return {
    rows,
    kpis: {
      incomeYtd,
      incomePrevYtd,
      outstanding: sum(unpaid),
      outstandingCount: unpaid.length,
      overdue: sum(unpaid.filter((r) => r.status === "overdue")),
      overdueCount: unpaid.filter((r) => r.status === "overdue").length,
      avgDaysToPay,
      expected: expected.reduce((s, { d }) => s + d.value, 0),
      expectedCount: expected.length,
    },
    expected: expected.map(({ d, brandName }) => ({ id: d.id, title: d.title, stage: d.stage, value: d.value, brandId: d.brandId, brandName })),
    monthly,
    byBrand,
    byPlatform,
    ageing,
    tax,
  };
}

export function invoicesCsv(rows: InvoiceRow[], year: string) {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["invoice", "brand", "deal", "issued", "due", "paid", "amount_thb", "wht_3pct_est", "net_thb"];
  const lines = rows
    .filter((r) => r.paidAt?.startsWith(year))
    .sort((a, b) => a.paidAt!.localeCompare(b.paidAt!))
    .map((r) => [r.number, r.brandName, r.dealTitle, r.issuedAt, r.dueAt, r.paidAt, r.amount, Math.round(r.amount * WHT_RATE), Math.round(r.amount * (1 - WHT_RATE))].map(esc).join(","));
  return "﻿" + [header.join(","), ...lines].join("\n") + "\n";
}
