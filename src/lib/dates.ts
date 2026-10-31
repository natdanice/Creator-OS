// Pure date-string helpers. All math is done in UTC on "YYYY-MM-DD" strings so
// results never depend on the machine's timezone.

const DAY = 86_400_000;

export function toDate(d: string): Date {
  return new Date(d.slice(0, 10) + "T00:00:00Z");
}

export function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return fmtDay(new Date(toDate(d).getTime() + n * DAY));
}

/** Whole days from a to b (b − a). Accepts timestamps; only the date part is used. */
export function diffDays(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
}

export function dayOf(ts: string): string {
  return ts.slice(0, 10);
}

export function monthOf(d: string): string {
  return d.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Inclusive list of days from start to end. */
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Window of `n` days ending on (and including) `end`. */
export function windowEnding(end: string, n: number): { start: string; end: string } {
  return { start: addDays(end, -(n - 1)), end };
}

export function isoWeekKey(d: string): string {
  const date = toDate(d);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
