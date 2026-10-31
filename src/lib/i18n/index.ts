import { th, type Dict } from "./th";
import { en } from "./en";

export type Locale = "th" | "en";
export const LOCALE: Locale = (process.env.NEXT_PUBLIC_LOCALE as Locale) ?? "th";

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(base)) return (over as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = merge((base as Record<string, unknown>)[k], v);
  return out as T;
}

const dicts: Record<Locale, Dict> = { th, en: merge<Dict>(th, en) };

/** The active dictionary. Usage: `t.overview.title`. */
export const t: Dict = dicts[LOCALE];

/** Fill {placeholders}: fmt("{n} วัน", { n: 3 }) → "3 วัน". */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
