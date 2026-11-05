"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { Bot, Building2, Inbox, Languages, LayoutDashboard, Send, Settings, Sparkles, Users, Wallet } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { setLocaleAction } from "@/app/actions";

export function Sidebar({ storyDate, inboxUnread }: { storyDate: string; inboxUnread: number }) {
  const { t, locale } = useI18n();
  const [switching, start] = useTransition();
  const ITEMS = [
    { href: "/", label: t.nav.overview, icon: LayoutDashboard },
    { href: "/content", label: t.nav.content, icon: Send },
    { href: "/inbox", label: t.nav.inbox, icon: Inbox, badge: inboxUnread },
    { href: "/audience", label: t.nav.audience, icon: Users },
    { href: "/brands", label: t.nav.brands, icon: Building2 },
    { href: "/automation", label: t.nav.automation, icon: Bot },
    { href: "/finance", label: t.nav.finance, icon: Wallet },
    { href: "/ask-ai", label: t.nav.askAi, icon: Sparkles },
  ];
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const item = (it: { href: string; label: string; icon: typeof Bot; badge?: number }) => {
    const Icon = it.icon;
    const on = active(it.href);
    return (
      <Link
        key={it.href}
        href={it.href}
        className={`group flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
          on ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white"
        }`}
      >
        <Icon size={18} className={on ? "text-accent" : ""} aria-hidden />
        <span className="whitespace-nowrap">{it.label}</span>
        {!!it.badge && <span className="tabular ml-auto rounded-full bg-accent px-1.5 text-[11px] font-medium text-white">{it.badge}</span>}
      </Link>
    );
  };
  return (
    <aside className="no-print sticky top-0 z-20 flex w-full flex-col bg-ink text-white md:h-screen md:w-60 md:shrink-0">
      <div className="flex items-center gap-2 px-4 py-4 md:px-5 md:py-6">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-heading text-base font-semibold text-ink">C</div>
        <div>
          <div className="font-heading text-lg leading-none">{t.app.name}</div>
          <div className="mt-1 text-[11px] text-white/50">{t.app.tagline}</div>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible md:pb-0">
        {ITEMS.map(item)}
        <div className="md:mt-auto md:border-t md:border-white/10 md:pt-2">{item({ href: "/settings", label: t.nav.settings, icon: Settings })}</div>
      </nav>
      <button
        onClick={() => start(() => setLocaleAction(locale === "en" ? "th" : "en"))}
        disabled={switching}
        aria-label={t.lang.label}
        className="mx-3 mb-3 flex w-fit items-center gap-2 md:mb-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:bg-white/5 hover:text-white disabled:opacity-50"
      >
        <Languages size={14} aria-hidden />
        <span className="font-medium">{locale.toUpperCase()}</span>
        <span className="text-white/40">→</span>
        {t.lang.switchTo}
      </button>
      <div className="hidden px-5 py-4 text-[11px] text-white/45 md:block">
        {t.app.today}
        <div className="tabular mt-0.5 text-sm text-white/80">{storyDate}</div>
      </div>
    </aside>
  );
}
