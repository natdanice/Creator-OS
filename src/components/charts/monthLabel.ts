"use client";
import { useMemo } from "react";
import { useI18n } from "@/lib/i18n/client";

/** "2026-10" → "Oct 26" / "ต.ค. 69" */
export function useMonthLabel() {
  const { locale } = useI18n();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
    return (m: string) => f.format(new Date(`${m}-01T00:00:00Z`));
  }, [locale]);
}
