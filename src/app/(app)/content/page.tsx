import { Placeholder } from "@/components/Placeholder";
import { t } from "@/lib/i18n";

export const metadata = { title: t.placeholders.content.title };

export default function Page() {
  return <Placeholder k="content" />;
}
