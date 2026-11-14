import { getI18n } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui";
import { OneStopImport } from "@/components/import/OneStopImport";
import { aiAvailable } from "@/import/claudeDetect";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.importer.title };
}

export default async function ImportPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.importer.title} subtitle={t.importer.subtitle} />
      <OneStopImport aiOn={aiAvailable()} />
    </>
  );
}
