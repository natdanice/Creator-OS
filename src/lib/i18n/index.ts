/**
 * i18n core (safe to import from server and client code).
 *
 * - UI language is chosen per request from the `locale` cookie (default English).
 *   Server components: `const { t } = await getI18n()` from ./server.
 *   Client components: `const { t } = useI18n()` from ./client.
 * - DATA language is Thai: anything the system writes into the database or drafts
 *   for a Thai brand (task messages, activity notes) uses `dataT`.
 */
import { th, type Dict } from "./th";
import { en } from "./en";

export type { Dict } from "./th";
export type Locale = "en" | "th";
export const LOCALES: Locale[] = ["en", "th"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";

export const DICTS: Record<Locale, Dict> = { en, th };

/** Language of generated data (drafts to Thai brands, timeline notes). */
export const dataT: Dict = th;

export function asLocale(v: string | undefined | null): Locale {
  return v === "th" || v === "en" ? v : DEFAULT_LOCALE;
}

/** Fill {placeholders}: fmt("{n} days", { n: 3 }) → "3 days". */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

const DATE_LOCALE: Record<Locale, string> = { en: "en-GB", th: "th-TH" };

export interface I18n {
  locale: Locale;
  /** Live mode (real data): hides demo-only UI such as the mock badge and the simulated date. */
  live: boolean;
  t: Dict;
  /** "31 Oct 2026" / "31 ต.ค. 69" */
  date: (d: string) => string;
  /** "31 Oct" / "31 ต.ค." */
  dateShort: (d: string) => string;
}

export function makeI18n(locale: Locale, live = false): I18n {
  const long = new Intl.DateTimeFormat(DATE_LOCALE[locale], { day: "numeric", month: "short", year: locale === "th" ? "2-digit" : "numeric", timeZone: "UTC" });
  const short = new Intl.DateTimeFormat(DATE_LOCALE[locale], { day: "numeric", month: "short", timeZone: "UTC" });
  const toDate = (d: string) => new Date(d.slice(0, 10) + "T00:00:00Z");
  return { locale, live, t: DICTS[locale], date: (d) => long.format(toDate(d)), dateShort: (d) => short.format(toDate(d)) };
}
