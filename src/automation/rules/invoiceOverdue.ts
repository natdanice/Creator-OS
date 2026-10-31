/**
 * invoice_overdue_30 — invoice unpaid (as of today) and ≥ 30 days past its due date.
 * Internal reminder for the creator, with a polite chaser drafted inside. Dedupe: invoice.
 */
import { eq } from "drizzle-orm";
import { deals, invoices } from "@/db/schema";
import { diffDays } from "@/lib/dates";
import { baht, dateTh } from "@/lib/format";
import { fmt, t } from "@/lib/i18n";
import type { AutomationRule, TaskDraft } from "../types";

export const OVERDUE_DAYS = 30;

export const invoiceOverdue: AutomationRule = {
  id: "invoice_overdue_30",
  evaluate(ctx): TaskDraft[] {
    const rows = ctx.db.select({ inv: invoices, deal: deals }).from(invoices).innerJoin(deals, eq(deals.id, invoices.dealId)).all();
    return rows
      .filter(({ inv }) => inv.issuedAt <= ctx.today && (!inv.paidAt || inv.paidAt > ctx.today) && diffDays(inv.dueAt, ctx.today) >= OVERDUE_DAYS)
      .map(({ inv, deal }) => {
        const s = ctx.stats.find((x) => x.brand.id === deal.brandId)!;
        const days = diffDays(inv.dueAt, ctx.today);
        return {
          dedupeKey: `invoice_overdue_30:${inv.id}`,
          title: fmt(t.ruleTitles.invoice_overdue_30, { invoice: inv.number, brand: s.brand.name, days }),
          reason: fmt(t.ruleReasons.invoice_overdue_30, { due: dateTh(inv.dueAt), amount: baht(inv.amount) }),
          draftMessage: fmt(t.templates.invoice, {
            invoice: inv.number,
            brand: s.brand.name,
            amount: baht(inv.amount),
            due: dateTh(inv.dueAt),
            days,
            contact: s.contact?.name ?? "-",
            channel: s.contact ? t.channels[s.contact.channel] : "-",
            greeting: fmt(t.templates.greeting, { contact: s.contact?.name ?? s.brand.name }),
          }),
          brandId: s.brand.id,
          dealId: deal.id,
          link: `/brands/${s.brand.id}`,
        };
      });
  },
};
