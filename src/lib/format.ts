const intl = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const num = (n: number) => intl.format(Math.round(n));
export const compactNum = (n: number) => compact.format(n);
export const baht = (n: number) => "฿" + intl.format(Math.round(n));
export const pct = (x: number, digits = 1) => (x * 100).toFixed(digits) + "%";
export const signedPct = (x: number, digits = 1) => (x >= 0 ? "+" : "") + (x * 100).toFixed(digits) + "%";

const thDate = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const thDateShort = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });

export const dateTh = (d: string) => thDate.format(new Date(d.slice(0, 10) + "T00:00:00Z"));
export const dateThShort = (d: string) => thDateShort.format(new Date(d.slice(0, 10) + "T00:00:00Z"));
