import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";

export async function BrandsTabs({ active }: { active: "list" | "pipeline" | "quote" }) {
  const { t, date, dateShort } = await getI18n();
  const tabs = [
    { key: "list", href: "/brands", label: t.brands.tabList },
    { key: "pipeline", href: "/brands/pipeline", label: t.brands.tabPipeline },
    { key: "quote", href: "/brands/quotes/new", label: t.brands.tabQuote },
  ] as const;
  return (
    <nav className="mb-5 flex gap-1 border-b border-line">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab.key === active ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
