import { getDb } from "@/db/client";
import { brands, deals, rateCard } from "@/db/schema";
import { BrandsTabs } from "@/components/BrandsTabs";
import { QuoteForm } from "@/components/QuoteForm";
import { PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.quote.title };
}

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ brand?: string; codes?: string }> }) {
  const { t, date, dateShort } = await getI18n();
  const { brand, codes } = await searchParams;
  const db = getDb();
  const allDeals = db.select().from(deals).all();
  const brandOpts = db
    .select()
    .from(brands)
    .orderBy(brands.name)
    .all()
    .map((b) => ({
      id: b.id,
      name: b.name,
      deals: allDeals.filter((d) => d.brandId === b.id && ["lead", "brief", "quotation"].includes(d.stage)).map((d) => ({ id: d.id, title: d.title, stage: d.stage })),
    }));
  const cards = db.select().from(rateCard).all();
  return (
    <>
      <PageHeader title={t.quote.title} subtitle={t.quote.hint} />
      <BrandsTabs active="quote" />
      <QuoteForm brands={brandOpts} cards={cards} initialBrand={brand ? Number(brand) : undefined} initialCodes={codes ? codes.split(",") : []} />
    </>
  );
}
