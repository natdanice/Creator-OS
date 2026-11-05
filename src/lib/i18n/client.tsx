"use client";
import { createContext, useContext, useMemo } from "react";
import { makeI18n, type I18n, type Locale } from "./index";

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ locale, live = false, children }: { locale: Locale; live?: boolean; children: React.ReactNode }) {
  const value = useMemo(() => makeI18n(locale, live), [locale, live]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}
