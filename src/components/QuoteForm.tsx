"use client";
import { useMemo, useState } from "react";
import { createQuote } from "@/app/actions";
import { baht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { btn } from "@/components/ui";

interface Card {
  code: string;
  name: string;
  description: string;
  price: number;
  kind: string;
}
interface BrandOpt {
  id: number;
  name: string;
  deals: { id: number; title: string; stage: string }[];
}

export function QuoteForm({ brands, cards, initialBrand, initialCodes }: { brands: BrandOpt[]; cards: Card[]; initialBrand?: number; initialCodes: string[] }) {
  const { t, dateShort } = useI18n();
  const [brandId, setBrandId] = useState<number>(initialBrand ?? brands[0]?.id);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(cards.map((c) => [c.code, initialCodes.filter((x) => x === c.code).length])));
  const [discount, setDiscount] = useState(0);
  const brand = brands.find((b) => b.id === brandId);
  const subtotal = useMemo(() => cards.reduce((s, c) => s + c.price * (qty[c.code] ?? 0), 0), [cards, qty]);
  const total = Math.round((subtotal * (100 - discount)) / 100);
  const groups = [
    { kind: "single", items: cards.filter((c) => c.kind === "single") },
    { kind: "bundle", items: cards.filter((c) => c.kind === "bundle" || c.kind === "retainer") },
    { kind: "addon", items: cards.filter((c) => c.kind === "addon") },
  ];

  return (
    <form action={createQuote} className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-card p-5 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t.quote.brand}</span>
            <select name="brandId" value={brandId} onChange={(e) => setBrandId(Number(e.target.value))} className={`${btn.input} w-full`}>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t.quote.deal}</span>
            <select name="dealId" key={brandId} defaultValue="" className={`${btn.input} w-full`}>
              <option value="">{t.quote.newDeal}</option>
              {brand?.deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} ({t.stages[d.stage as "lead"]})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-muted">{t.quote.dealTitle}</span>
            <input name="dealTitle" placeholder={t.quote.newDeal} className={`${btn.input} w-full`} />
          </label>
        </div>

        <div className="rounded-xl border border-line bg-card">
          <h2 className="border-b border-line px-5 py-3.5 text-base font-medium">{t.quote.rateCard}</h2>
          {groups.map((g) => (
            <ul key={g.kind} className="divide-y divide-line border-b border-line last:border-0">
              {g.items.map((c) => (
                <li key={c.code} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted">{c.description}</div>
                  </div>
                  <div className="tabular w-24 text-right text-sm">{baht(c.price)}</div>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    name={`qty_${c.code}`}
                    aria-label={`${t.quote.qty} ${c.name}`}
                    value={qty[c.code] ?? 0}
                    onChange={(e) => setQty((q) => ({ ...q, [c.code]: Math.max(0, Number(e.target.value)) }))}
                    className={`${btn.input} w-16 text-center`}
                  />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>

      <aside className="h-fit space-y-3 rounded-xl border border-line bg-card p-5 xl:sticky xl:top-6">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">{t.quote.discount}</span>
          <input type="number" name="discountPct" min={0} max={50} value={discount} onChange={(e) => setDiscount(Math.max(0, Math.min(50, Number(e.target.value))))} className={`${btn.input} w-full`} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">{t.quote.notes}</span>
          <textarea name="notes" rows={3} className={`${btn.input} w-full`} />
        </label>
        <dl className="space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t.quote.subtotal}</dt>
            <dd className="tabular">{baht(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t.quote.discountLine}</dt>
            <dd className="tabular">−{baht(subtotal - total)}</dd>
          </div>
          <div className="flex justify-between pt-1 font-heading text-xl font-semibold">
            <dt>{t.quote.grandTotal}</dt>
            <dd className="tabular text-accent-strong">{baht(total)}</dd>
          </div>
        </dl>
        <button className={`${btn.primary} w-full`} disabled={subtotal === 0}>
          {subtotal === 0 ? t.quote.pickOne : t.quote.create}
        </button>
      </aside>
    </form>
  );
}
