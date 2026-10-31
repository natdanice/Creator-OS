import { Construction } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { t } from "@/lib/i18n";

type Key = keyof typeof t.placeholders & ("content" | "inbox" | "audience" | "finance" | "askAi");

export function Placeholder({ k }: { k: Key }) {
  const p = t.placeholders[k];
  return (
    <>
      <PageHeader title={p.title} subtitle={p.body} />
      <Card>
        <div className="flex items-start gap-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-strong">
            <Construction size={20} aria-hidden />
          </div>
          <div>
            <p className="text-sm text-muted">{t.placeholders.comingSoon}</p>
            <h2 className="mt-4 text-sm font-medium">{t.placeholders.willInclude}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {p.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </>
  );
}
