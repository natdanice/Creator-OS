import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { Chat } from "@/components/ask/Chat";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.askAi.title };
}

export default async function AskAiPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.askAi.title} subtitle={t.askAi.subtitle} />
      <Chat claudeEnabled={!!process.env.ANTHROPIC_API_KEY} />
      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
        <ShieldCheck size={14} className="mt-px shrink-0 text-good" aria-hidden /> {t.askAi.privacyNote}
      </p>
    </>
  );
}
