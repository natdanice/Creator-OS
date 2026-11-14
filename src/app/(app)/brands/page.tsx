import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { createBrandAction } from "@/app/actions";
import { PRODUCT_CATEGORIES } from "@/db/schema";
import { TIERS } from "@/crm/rules";
import { getBrands } from "@/lib/api";
import { BrandsTabs } from "@/components/BrandsTabs";
import { btn, Card, PageHeader, Pill, TierBadge } from "@/components/ui";
import { baht } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.brands.title };
}

export default async function BrandsPage({ searchParams }: { searchParams: Promise<{ q?: string; tier?: string; category?: string }> }) {
  const { t, date, dateShort } = await getI18n();
  const { q = "", tier = "", category = "" } = await searchParams;
  // Search, tier and category filtering and the sort happen in the Go API (backend/).
  const { rows, tierCounts } = await getBrands({ q, tier, category });
  const countBy = (tr: (typeof TIERS)[number]) => tierCounts[tr] ?? 0;

  return (
    <>
      <PageHeader title={t.brands.title} subtitle={t.brands.subtitle} />
      <BrandsTabs active="list" />

      <details className="group mb-4">
        <summary className={`${btn.ghost} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
          <Plus size={16} aria-hidden /> {t.brandForm.add}
        </summary>
        <form action={createBrandAction} className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-line bg-card p-5 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-muted">
            {t.brandForm.name}
            <input id="brand-name" name="name" required className={`${btn.input} mt-1 w-full text-ink`} />
          </label>
          <label className="text-xs text-muted">
            {t.brandForm.category}
            <select id="brand-category" name="category" className={`${btn.input} mt-1 w-full text-ink`}>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t.categories[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            {t.brandForm.website}
            <input id="brand-website" name="website" placeholder="brand.co.th" className={`${btn.input} mt-1 w-full text-ink`} />
          </label>
          <label className="text-xs text-muted">
            {t.brandForm.contactName}
            <input id="brand-contact" name="contactName" className={`${btn.input} mt-1 w-full text-ink`} />
          </label>
          <label className="text-xs text-muted">
            {t.brandForm.contactRole}
            <input id="brand-role" name="contactRole" className={`${btn.input} mt-1 w-full text-ink`} />
          </label>
          <label className="text-xs text-muted">
            {t.brandForm.channel}
            <select id="brand-channel" name="channel" className={`${btn.input} mt-1 w-full text-ink`}>
              {(["email", "line", "ig_dm"] as const).map((c) => (
                <option key={c} value={c}>
                  {t.channels[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted sm:col-span-2">
            {t.brandForm.handle}
            <input id="brand-handle" name="handle" className={`${btn.input} mt-1 w-full text-ink`} />
          </label>
          <div className="sm:col-span-2 xl:col-span-4">
            <button className={btn.primary}>{t.brandForm.save}</button>
          </div>
        </form>
      </details>

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
