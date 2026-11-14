/** Lenient cell parsing for files from anywhere: numbers, dates, times and yes/no. */
import type { Cell } from "./types";

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

/** "1,234", "1.2K", "3.4M", "42%", 1234 → number (null when it isn't one). */
export function toNumber(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v instanceof Date || v === null) return null;
  const s = v.trim().replace(/,/g, "");
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([kKmMbB]?)\s*%?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase() as "k"] ?? 1;
  return Number(m[1]) * mult;
}

export const num = (v: Cell) => toNumber(v) ?? 0;

/** Buddhist-era years (2569) → Common Era. */
const ce = (y: number) => (y > 2400 ? y - 543 : y);

function fromExcelSerial(n: number): Date {
  return new Date(Math.round((n - 25569) * 86400 * 1000));
}

export type DateOrder = "dmy" | "mdy";

/**
 * Whether a column writes a/b/yyyy dates day-first or month-first, from its values: a first part
 * above 12 means day-first, a second part above 12 means month-first. When every value fits both,
 * `fallback` decides (Meta/Instagram exports are month-first; Thai and most others day-first).
 */
export function dateOrderOf(values: Cell[], fallback: DateOrder = "dmy"): DateOrder {
  for (const v of values) {
    const m = typeof v === "string" ? v.match(/(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/) : null;
    if (m && +m[1] > 12) return "dmy";
    if (m && +m[2] > 12) return "mdy";
  }
  return fallback;
}

/** Any date-ish value → { day: "YYYY-MM-DD", time: "HH:mm:ss" | null }. a/b/yyyy is read in `order` (day-first by default). */
export function toDateTime(v: Cell, order: DateOrder = "dmy"): { day: string; time: string | null } | null {
  if (v === null || typeof v === "boolean") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const iso = v.toISOString();
    const t = iso.slice(11, 19);
    return { day: iso.slice(0, 10), time: t === "00:00:00" ? null : t };
  }
  if (typeof v === "number") {
    if (v > 20000 && v < 80000) return toDateTime(fromExcelSerial(v)); // Excel serial date (whole days)
    if (v > 1e9 && v < 1e11) return toDateTime(new Date(v * 1000)); // unix seconds
    if (v > 1e12 && v < 1e14) return toDateTime(new Date(v)); // unix ms
    return null;
  }
  const s = v.trim();
  const time = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  let t: string | null = null;
  if (time) {
    let h = Number(time[1]);
    if (/pm/i.test(time[4] ?? "") && h < 12) h += 12;
    if (/am/i.test(time[4] ?? "") && h === 12) h = 0;
    t = `${pad(h)}:${time[2]}:${time[3] ?? "00"}`;
  }
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // 2026-01-31
  if (m) return valid(ce(+m[1]), +m[2], +m[3], t);
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); // 31/01/2026 or 01/31/2026
  if (m) {
    let [d, mo] = order === "dmy" ? [+m[1], +m[2]] : [+m[2], +m[1]];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    const y = +m[3] < 100 ? 2000 + +m[3] : ce(+m[3]);
    return valid(y, mo, d, t);
  }
  m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/); // Jan 31, 2026
  if (m && MONTHS[m[1].toLowerCase()]) return valid(ce(+m[3]), MONTHS[m[1].toLowerCase()], +m[2], t);
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/); // 31 Jan 2026
  if (m && MONTHS[m[2].toLowerCase()]) return valid(ce(+m[3]), MONTHS[m[2].toLowerCase()], +m[1], t);
  return null;
}

function valid(y: number, mo: number, d: number, time: string | null) {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { day: `${y}-${pad(mo)}-${pad(d)}`, time };
}

/** A time-of-day cell ("19:30", 0.8125 as an Excel fraction, a Date) → "HH:mm:ss". */
export function toTime(v: Cell): string | null {
  if (typeof v === "number" && v >= 0 && v < 1) {
    const secs = Math.round(v * 86400);
    return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
  }
  if (v instanceof Date) return v.toISOString().slice(11, 19);
  const m = String(v ?? "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${pad(+m[1])}:${m[2]}:${m[3] ?? "00"}` : null;
}

export const yes = (v: Cell) => v === true || /^(true|yes|y|1|ใช่|sponsored|paid)$/i.test(String(v ?? "").trim());

export const text = (v: Cell) => (v === null ? "" : v instanceof Date ? v.toISOString() : String(v)).trim();
