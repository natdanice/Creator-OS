import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { brandContacts, brands, deals, quoteItems, quotes, rateCard } from "@/db/schema";
import { PrintFooter, PrintHeader } from "@/components/PrintHeader";
import { baht, dateTh } from "@/lib/format";
import { t } from "@/lib/i18n";

export const metadata = { title: t.quote.printTitle };

export default async function QuotePrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const q = db.select().from(quotes).where(eq(quotes.id, Number(id))).get();
  if (!q) notFound();
  const brand = db.select().from(brands).where(eq(brands.id, q.brandId)).get()!;
  const contact = db.select().from(brandContacts).where(eq(brandContacts.brandId, brand.id)).get();
  const deal = q.dealId ? db.select().from(deals).where(eq(deals.id, q.dealId)).get() : null;
  const items = db.select({ item: quoteItems, card: rateCard }).from(quoteItems).innerJoin(rateCard, eq(rateCard.id, quoteItems.rateCardId)).where(eq(quoteItems.quoteId, q.id)).all();
  const subtotal = items.reduce((s, i) => s + i.item.qty * i.item.unitPrice, 0);
  const total = Math.round((subtotal * (100 - q.discountPct)) / 100);

  return (
    <article>
      <PrintHeader
        title={t.quote.printTitle}
        right={
          <dl className="space-y-0.5">
            <div>
              <dt className="inline text-muted">{t.quote.quoteNo} </dt>
              <dd className="inline font-medium">{q.number}</dd>
            </div>
            <div>
              <dt className="inline text-muted">{t.quote.issued} </dt>
              <dd className="inline">{dateTh(q.createdAt)}</dd>
            </div>
            <div>
              <dt className="inline text-muted">{t.quote.validUntil} </dt>
              <dd className="inline">{dateTh(q.validUntil)}</dd>
            </div>
          </dl>
        }
      />
      <section className="mb-8 grid grid-cols-2 gap-6 text-sm">
        <div>
          <div className="text-xs text-muted">{t.quote.to}</div>
          <div className="mt-1 font-medium">{brand.name}</div>
          {contact && (
            <div className="text-muted">
              {contact.name} · {contact.role}
            </div>
          )}
          {deal && <div className="mt-2">{deal.title}</div>}
        </div>
        <div>
          <div className="text-xs text-muted">{t.quote.from}</div>
          <div className="mt-1 font-medium">Everyday Mock (@everyday.mock)</div>
          <div className="text-muted">TikTok · Instagram · YouTube</div>
        </div>
      </section>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink text-left text-xs text-muted">
            <th className="py-2 font-normal">{t.quote.item}</th>
            <th className="py-2 text-right font-normal">{t.quote.qty}</th>
            <th className="py-2 text-right font-normal">{t.quote.unitPrice}</th>
            <th className="py-2 text-right font-normal">{t.quote.amount}</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ item, card }) => (
            <tr key={item.id} className="border-b border-line align-top">
              <td className="py-3">
                <div className="font-medium">{card.name}</div>
                <div className="text-xs text-muted">{card.description}</div>
              </td>
              <td className="tabular py-3 text-right">{item.qty}</td>
              <td className="tabular py-3 text-right">{baht(item.unitPrice)}</td>
              <td className="tabular py-3 text-right">{baht(item.qty * item.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-sm">
          <tr>
            <td colSpan={3} className="pt-4 text-right text-muted">
              {t.quote.subtotal}
            </td>
            <td className="tabular pt-4 text-right">{baht(subtotal)}</td>
          </tr>
          {q.discountPct > 0 && (
            <tr>
              <td colSpan={3} className="text-right text-muted">
                {t.quote.discountLine} {q.discountPct}%
              </td>
              <td className="tabular text-right">−{baht(subtotal - total)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={3} className="pt-2 text-right font-heading text-lg">
              {t.quote.grandTotal}
            </td>
            <td className="tabular pt-2 text-right font-heading text-lg font-semibold text-accent-strong">{baht(total)}</td>
          </tr>
        </tfoot>
      </table>
      {q.notes && <p className="mt-6 rounded-lg bg-paper p-3 text-sm">{q.notes}</p>}
      <p className="mt-6 text-xs text-muted">{t.quote.terms}</p>
      <PrintFooter text={t.app.mockBadgeTitle} />
    </article>
  );
}
