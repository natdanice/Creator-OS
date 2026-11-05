import { getDb } from "@/db/client";
import { invoicesCsv, listInvoices } from "@/crm/finance";
import { getStoryDate } from "@/lib/queries/settings";

/** Paid invoices of one year as CSV (for the accountant / tax filing). */
export async function GET(req: Request) {
  const db = getDb();
  const today = getStoryDate(db);
  const year = new URL(req.url).searchParams.get("year") ?? today.slice(0, 4);
  if (!/^\d{4}$/.test(year)) return new Response("bad year", { status: 400 });
  return new Response(invoicesCsv(listInvoices(db, today), year), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="creator-os-income-${year}.csv"` },
  });
}
