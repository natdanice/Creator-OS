import { Placeholder } from "@/components/Placeholder";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.placeholders.finance.title };
}

export default async function Page() {
  const { t, date, dateShort } = await getI18n();
  return <Placeholder k="finance" />;
}
