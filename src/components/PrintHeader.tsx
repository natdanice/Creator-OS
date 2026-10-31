import { MockBadge } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

export async function PrintHeader({ title, right }: { title: string; right: React.ReactNode }) {
  const { t, date, dateShort } = await getI18n();
  return (
    <header className="mb-8 flex items-start justify-between gap-6 border-b-2 border-ink pb-6">
      <div>
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-heading font-semibold text-ink">C</div>
          <span className="font-heading text-lg">Everyday Mock</span>
          <MockBadge />
        </div>
        <h1 className="mt-4 text-3xl font-semibold">{title}</h1>
      </div>
      <div className="text-right text-sm">{right}</div>
    </header>
  );
}

export async function PrintFooter({ text }: { text?: string }) {
  const { t, date, dateShort } = await getI18n();
  return <footer className="mt-10 border-t border-line pt-4 text-xs text-muted">{text ?? t.report.footer} · {t.app.name}</footer>;
}
