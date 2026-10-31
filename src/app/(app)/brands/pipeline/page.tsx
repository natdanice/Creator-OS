import { getDb } from "@/db/client";
import { DEAL_STAGES } from "@/db/schema";
import { computeBrandStats } from "@/crm/brandStats";
import { getStoryDate } from "@/lib/queries/settings";
import { BrandsTabs } from "@/components/BrandsTabs";
import { Kanban, type KanbanDeal } from "@/components/Kanban";
import { PageHeader } from "@/components/ui";
import { t } from "@/lib/i18n";

export const metadata = { title: t.pipeline.title };

export default function PipelinePage() {
  const db = getDb();
  const today = getStoryDate(db);
  const stats = computeBrandStats(db, today);
  const deals: KanbanDeal[] = stats
    .flatMap((s) =>
      s.deals.map((d) => ({
        id: d.id,
        title: d.title,
        brandId: s.brand.id,
        brandName: s.brand.name,
        tier: s.tier,
        stage: d.stage,
        value: d.value,
        date: d.closedAt ?? d.postedAt ?? d.createdAt,
      })),
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <>
      <PageHeader title={t.brands.title} subtitle={t.pipeline.hint} />
      <BrandsTabs active="pipeline" />
      <Kanban deals={deals} stages={DEAL_STAGES} />
    </>
  );
}
