/**
 * Writes the recommended next offer's title and reason in the reader's language. The Go API picks the
 * offer and returns the raw numbers behind it (`vars`); this turns them into text with the same
 * wording and number formats as crm/nextOffer.ts.
 */
import { fmt, type Dict } from "@/lib/i18n";
import { baht, compactNum, num, pct, signedPct } from "@/lib/format";

export interface ApiOffer {
  rule: "starter" | "reengage" | "retainer" | "bundle" | "dedicated" | "repeat";
  codes: string[];
  price: number;
  vars: Record<string, string | number>;
}

export function presentOffer(t: Dict, o: ApiOffer): { title: string; reason: string } {
  const v = o.vars;
  switch (o.rule) {
    case "starter":
      return { title: fmt(t.offers.starter, { pkg: String(v.pkg) }), reason: fmt(t.offers.starterWhy, { category: t.categories[v.category as "tech"], views: compactNum(Number(v.avgViews)) }) };
    case "reengage":
      return { title: fmt(t.offers.reengage, { pkg: String(v.pkg) }), reason: fmt(t.offers.reengageWhy, { days: Number(v.days), pkg: String(v.pkg), views: num(Number(v.views)), growth: signedPct(Number(v.growth)) }) };
    case "retainer":
      return { title: t.offers.retainer, reason: fmt(t.offers.retainerWhy, { n: Number(v.n), value: baht(Number(v.value)) }) };
    case "bundle":
      return { title: t.offers.bundle, reason: fmt(t.offers.bundleWhy, { platform: t.platforms[v.platform as "tiktok"], er: pct(Number(v.er)), median: pct(Number(v.median)) }) };
    case "dedicated":
      return { title: t.offers.dedicated, reason: fmt(t.offers.dedicatedWhy, { n: Number(v.n).toFixed(1) }) };
    case "repeat":
      return { title: t.offers.repeat, reason: fmt(t.offers.repeatWhy, { pkg: String(v.pkg) }) };
  }
}
