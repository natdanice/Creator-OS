/**
 * Time for writes. Demo mode stamps everything on the simulated story date at a fixed
 * time of day (so the story stays coherent); live mode uses the real Bangkok clock.
 */
import { IS_LIVE, TIMEZONE } from "./config";

const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** "YYYY-MM-DDTHH:mm:ss" in Bangkok time. */
export function bangkokNow(): string {
  return fmt.format(new Date()).replace(" ", "T");
}

export function bangkokToday(): string {
  return bangkokNow().slice(0, 10);
}

/** Timestamp for something happening on `day`: the real clock in live mode (when `day` is today), else `day` at `demoTime`. */
export function stamp(day: string, demoTime = "10:00:00"): string {
  return IS_LIVE && day === bangkokToday() ? bangkokNow() : `${day}T${demoTime}`;
}
