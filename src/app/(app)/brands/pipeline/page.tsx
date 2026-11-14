import { getPipeline } from "@/lib/api";
import { BrandsTabs } from "@/components/BrandsTabs";
import { Kanban } from "@/components/Kanban";
import { PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.pipeline.title };
}

export default async function PipelinePage() {
  const { t } = await getI18n();
  const { deals, stages } = await getPipeline();
  return (
    <>
      <PageHeader title={t.brands.title} subtitle={t.pipeline.hint} />
      <BrandsTabs active="pipeline" />
      <Kanban deals={deals} stages={stages} />
    </>
  );
}
