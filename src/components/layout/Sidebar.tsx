"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Bot, Building2, Inbox, Languages, LayoutDashboard, Menu, Send, Settings, Sparkles, Upload, Users, Wallet, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { setLocaleAction } from "@/app/actions";

type Item = { href: string; label: string; icon: typeof Bot; badge?: number };

/** Desktop: light cream sidebar. Phone: a bottom tab bar (5 items) with the rest under "More". */
export function Sidebar({ storyDate, inboxUnread }: { storyDate: string; inboxUnread: number }) {
  const { t, locale, live } = useI18n();
  const todayLabel = live ? t.app.todayLive : t.app.today;
  const [switching, start] = useTransition();
  const [moreOpen, setMoreOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setMoreOpen(false), [path]);

  const overview: Item = { href: "/", label: t.nav.overview, icon: LayoutDashboard };
  const publisher: Item = { href: "/content", label: t.nav.content, icon: Send };
  const inbox: Item = { href: "/inbox", label: t.nav.inbox, icon: Inbox, badge: inboxUnread };
  const audience: Item = { href: "/audience", label: t.nav.audience, icon: Users };
  const brands: Item = { href: "/brands", label: t.nav.brands, icon: Building2 };
  const automation: Item = { href: "/automation", label: t.nav.automation, icon: Bot };
  const finance: Item = { href: "/finance", label: t.nav.finance, icon: Wallet };
  const askAi: Item = { href: "/ask-ai", label: t.nav.askAi, icon: Sparkles };
  const importData: Item = { href: "/import", label: t.nav.importData, icon: Upload };
  const settings: Item = { href: "/settings", label: t.nav.settings, icon: Settings };
  const ITEMS = [overview, importData, publisher, inbox, audience, brands, automation, finance, askAi];
  // Phone tabs use short labels so Thai names fit.
  const TABS: Item[] = [
    { ...overview, label: t.navTabs.overview },
    { ...inbox, label: t.navTabs.inbox },
    { ...publisher, label: t.navTabs.content },
    { ...brands, label: t.navTabs.brands },
  ];
  const MORE = [importData, audience, automation, finance, askAi, settings];

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const badge = (n?: number) => (n ? <span className="tabular rounded-full bg-accent px-1.5 text-[11px] font-medium leading-[18px] text-white">{n}</span> : null);

  const langButton = (
    <button
      onClick={() => start(() => setLocaleAction(locale === "en" ? "th" : "en"))}
      disabled={switching}
      aria-label={t.lang.label}
      className="flex w-fit items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
    >
      <Languages size={14} aria-hidden />
      <span className="font-medium">{locale.toUpperCase()}</span>
      <span className="text-subtle">→</span>
      {t.lang.switchTo}
    </button>
  );

  const sideLink = (it: Item) => {
    const Icon = it.icon;
    const on = active(it.href);
    return (
      <Link
        key={it.href}
        href={it.href}
        aria-current={on ? "page" : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${on ? "bg-white font-medium text-ink shadow-[inset_3px_0_0_var(--color-accent)]" : "text-ink-2 hover:bg-white/60 hover:text-ink"}`}
      >
        <Icon size={18} className={on ? "text-accent-strong" : "text-muted"} aria-hidden />
        <span className="whitespace-nowrap">{it.label}</span>
        <span className="ml-auto">{badge(it.badge)}</span>
      </Link>
    );
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-paper md:flex">
        <div className="flex items-center gap-2.5 px-5 py-6">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-heading text-base font-semibold text-white">C</div>
          <div>
            <div className="font-heading text-lg leading-none text-ink">{t.app.name}</div>
            <div className="mt-1 text-[11px] text-muted">{t.app.tagline}</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {ITEMS.map(sideLink)}
          <div className="mt-auto border-t border-line pt-2">{sideLink(settings)}</div>
        </nav>
        <div className="space-y-3 px-5 py-4">
          {langButton}
          <div className="text-[11px] text-muted">
            {todayLabel}
            <div className="tabular mt-0.5 text-sm text-ink">{storyDate}</div>
          </div>
        </div>
      </aside>

      {/* Phone: small top bar */}
      <div className="no-print flex items-center justify-between px-4 pt-4 md:hidden">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent font-heading text-sm font-semibold text-white">C</div>
          <span className="font-heading text-base">{t.app.name}</span>
        </div>
        <span className="tabular text-xs text-muted">{storyDate}</span>
      </div>

      {/* Phone: "More" sheet */}
      {moreOpen && (
        <div className="no-print fixed inset-0 z-30 md:hidden" role="dialog" aria-modal="true" aria-label={t.nav.more}>
          <button className="absolute inset-0 bg-ink/30" aria-label={t.audience.close} onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-paper px-4 pt-4" style={{ paddingBottom: "calc(76px + env(safe-area-inset-bottom, 0px))" }}>
            <div className="grid gap-0.5">{MORE.map(sideLink)}</div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
              {langButton}
              <span className="text-[11px] text-muted">
                {todayLabel} <span className="tabular text-ink">{storyDate}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Phone: bottom tab bar */}
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-white md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}
      >
        {TABS.map((it) => {
          const Icon = it.icon;
          const on = active(it.href) && !moreOpen;
          return (
            <Link key={it.href} href={it.href} aria-current={on ? "page" : undefined} className={`relative flex flex-col items-center gap-0.5 py-2 text-[10.5px] ${on ? "font-medium text-accent-strong" : "text-muted"}`}>
              <Icon size={20} aria-hidden />
              <span className="max-w-full truncate px-1">{it.label}</span>
              {!!it.badge && <span className="tabular absolute left-1/2 top-1 ml-2 rounded-full bg-accent px-1 text-[10px] leading-4 text-white">{it.badge}</span>}
            </Link>
          );
        })}
        <button onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} className={`flex flex-col items-center gap-0.5 py-2 text-[10.5px] ${moreOpen || MORE.some((m) => active(m.href)) ? "font-medium text-accent-strong" : "text-muted"}`}>
          {moreOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          <span>{t.nav.more}</span>
        </button>
      </nav>
    </>
  );
}
