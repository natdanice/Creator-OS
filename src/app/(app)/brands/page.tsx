import Link from "next/link";
import { Search } from "lucide-react";
import { getDb } from "@/db/client";
import { PRODUCT_CATEGORIES } from "@/db/schema";
import { computeBrandStats } from "@/crm/brandStats";
import { TIERS } from "@/crm/rules";
import { getStoryDate } from "@/lib/queries/settings";
import { BrandsTabs } from "@/components/BrandsTabs";
import { btn, Card, PageHeader, Pill, TierBadge } from "@/components/ui";
import { baht } from "@/lib/format";
import { fmt, t } from "@/lib/i18n";

export const metadata = { title: t.brands.title };

export default async function BrandsPage({ searchParams }: { searchParams: Promise<{ q?: string; tier?: string; category?: string }> }) {
  const { q = "", tier = "", category = "" } = await searchParams;
  const db = getDb();
  const today = getStoryDate(db);
  const all = computeBrandStats(db, today);
  const rows = all
    .filter((s) => !q || s.brand.name.toLowerCase().includes(q.toLowerCase()))
    .filter((s) => !tier || s.tier === tier)
    .filter((s) => !category || s.brand.category === category)
    .sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || b.dealValueThisYear - a.dealValueThisYear);
  const countBy = (tr: string) => all.filter((s) => s.tier === tr).length;

  return (
    <>
      <PageHeader title={t.brands.title} subtitle={t.brands.subtitle} />
      <BrandsTabs active="list" />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {TIERS.map((tr) => (
          <Link key={tr} href={tier === tr ? "/brands" : `/brands?tier=${tr}`} className={`rounded-xl border bg-card p-4 transition-colors ${tier === tr ? "border-accent" : "border-line hover:border-subtle"}`}>
            <div className="flex items-center justify-between">
              <TierBadge tier={tr} />
              <span className="tabular font-heading text-2xl font-semibold">{countBy(tr)}</span>
            </div>
            <p className="mt-2 text-xs text-muted">{t.tierHelp[tr]}</p>
          </Link>
        ))}
      </div>

      <Card bodyClass="p-0">
        <form className="flex flex-wrap items-center gap-2 border-b border-line p-4" action="/brands">
          <label className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
            <input name="q" defaultValue={q} placeholder={t.brands.searchPlaceholder} aria-label={t.common.search} className={`${btn.input} w-full pl-9`} />
          </label>
          <select name="tier" defaultValue={tier} aria-label={t.brands.colTier} className={btn.input}>
            <option value="">{t.brands.allTiers}</option>
            {TIERS.map((tr) => (
              <option key={tr} value={tr}>
                {t.tiers[tr]}
              </option>
            ))}
          </select>
          <select name="category" defaultValue={category} aria-label={t.common.category} className={btn.input}>
            <option value="">{t.common.all}</option>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t.categories[c]}
              </option>
            ))}
          </select>
          <button className={btn.ghost}>{t.common.search}</button>
          <span className="ml-auto text-xs text-muted">{fmt(t.brands.countSummary, { n: rows.length })}</span>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-normal">{t.brands.colBrand}</th>
                <th className="py-2.5 font-normal">{t.brands.colTier}</th>
                <th className="py-2.5 text-right font-normal">{t.brands.colValueYear}</th>
                <th className="py-2.5 text-right font-normal">{t.brands.colDaysSince}</th>
                <th className="px-5 py-2.5 text-right font-normal">{t.brands.colOpen}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.brand.id} className="border-b border-line last:border-0 hover:bg-paper/60">
                  <td className="px-5 py-3">
                    <Link href={`/brands/${s.brand.id}`} className="font-medium hover:text-accent-strong">
                      {s.brand.name}
                    </Link>
                    <div className="text-xs text-muted">{t.categories[s.brand.category]}</div>
                  </td>
                  <td className="py-3">
                    <TierBadge tier={s.tier} />
                  </td>
                  <td className="tabular py-3 text-right">{s.dealValueThisYear ? baht(s.dealValueThisYear) : t.common.none}</td>
                  <td className="tabular py-3 text-right">
                    {s.daysSinceLastJob === null ? (
                      t.common.none
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        {s.isSilent && <Pill tone="warn">{fmt(t.brands.silent, { n: s.daysSinceLastActivity! })}</Pill>}
                        {s.daysSinceLastJob} {t.common.days}
                      </span>
                    )}
                  </td>
                  <td className="tabular px-5 py-3 text-right">{s.openDeals || t.common.none}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted">
                    {t.brands.noResults}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
