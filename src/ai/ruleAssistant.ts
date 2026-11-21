/**
 * Offline Ask AI: matches the question to an intent (English or Thai keywords)
 * and answers from Facts with fixed templates. Brand names are matched first.
 */
import { baht, compactNum, num, pct, signedPct } from "@/lib/format";
import { fmt, type I18n } from "@/lib/i18n";
import type { Answer, Assistant, Citation } from "./Assistant";
import { sourceHref, type Facts, type SourceId } from "./facts";

type Intent = "followup" | "owed" | "income" | "best" | "pq" | "audience" | "pitch" | "inbox";

const INTENTS: [Intent, RegExp][] = [
  ["owed", /owe|overdue|unpaid|outstanding|invoice|receivable|ค้าง|บิล|ใบแจ้งหนี้|ยังไม่(จ่าย|โอน)|ทวง/i],
  ["followup", /follow|chase|contact|reach out|silent|ตาม|ทัก|เงียบ/i],
  ["income", /income|earn|revenue|money|made|รายได้|เงินเข้า|ได้เงิน|ยอดขาย/i],
  ["pq", /product question|asking about|spike|purchase intent|ถามสินค้า|คำถาม|ถามเรื่อง|พุ่ง/i],
  ["best", /best|perform|top|viral|which (content|post|video)|works|ดีที่สุด|คอนเทนต์ไหน|โพสต์ไหน|ปัง|เวิร์ก/i],
  ["audience", /audience|follower|demograph|fans?\b|who (watch|follow)|ผู้ติดตาม|ผู้ชม|แฟน|กลุ่มเป้าหมาย|ฐานคนดู/i],
  ["pitch", /pitch|offer|sell|upsell|propose|next deal|เสนอ|ขายงาน|อัปเซล|ดีลถัดไป/i],
  ["inbox", /brief|message|inbox|dm|line|บรีฟ|ข้อความ|แชท|อินบ็อกซ์/i],
];

export class RuleAssistant implements Assistant {
  readonly engine = "rules" as const;

  async answer(question: string, f: Facts, i18n: I18n): Promise<Answer> {
    const { t } = i18n;
    const a = t.askAi.a;
    const lines: string[] = [];
    const src = new Set<SourceId>();
    const q = question.toLowerCase();
    const brandLink = (id: number) => src.add(`brand:${id}`);

    const brand = f.brands.find((b) => q.includes(b.name.toLowerCase()) || q.includes(b.name.split(" ")[0].toLowerCase()));
    const intent = INTENTS.find(([, re]) => re.test(question))?.[0];

    if (brand && intent !== "owed") {
      brandLink(brand.id);
      lines.push(fmt(a.brandIntro, { brand: brand.name, tier: t.tiers[brand.tier], category: t.categories[brand.category] }));
      lines.push(fmt(a.brandStats, { value: baht(brand.valueThisYear), jobs: brand.jobs, days: brand.daysSinceLastJob ?? t.common.none }));
      if (brand.openDeals.length) lines.push(fmt(a.brandOpen, { list: brand.openDeals.map((d) => `${d.title} (${t.stages[d.stage]}, ${baht(d.value)})`).join(" · ") }));
      for (const inv of f.unpaidInvoices.filter((x) => x.brandId === brand.id)) {
        lines.push(fmt(a.brandOwed, { invoice: inv.number, amount: baht(inv.amount), status: inv.status === "overdue" ? fmt(a.owedOverdue, { days: inv.daysOverdue }) : fmt(a.owedDue, { date: i18n.date(inv.dueAt) }) }));
        src.add("finance");
      }
      const thread = f.inbox.threads.find((x) => x.brandId === brand.id);
      if (thread) {
        lines.push(fmt(a.brandInbox, { snippet: thread.lastMessage }));
        src.add(`inbox:${brand.id}`);
      }
      if (brand.nextOffer) lines.push(fmt(a.brandOffer, { offer: brand.nextOffer.title, price: baht(brand.nextOffer.price), why: brand.nextOffer.why }));
    } else if (intent === "followup") {
      lines.push(fmt(a.followupIntro, { date: i18n.date(f.today) }));
      for (const th of f.inbox.threads.filter((x) => x.newBrief)) {
        lines.push(fmt(a.followupBrief, { brand: th.brand }));
        src.add(`inbox:${th.brandId}`);
      }
      for (const inv of f.unpaidInvoices.filter((x) => x.status === "overdue")) {
        lines.push(fmt(a.followupInvoice, { brand: inv.brand, invoice: inv.number, days: inv.daysOverdue, amount: baht(inv.amount) }));
        src.add("finance");
      }
      for (const b of f.brands.filter((x) => x.silent).sort((x, y) => (y.daysSinceLastContact ?? 0) - (x.daysSinceLastContact ?? 0))) {
        lines.push(fmt(a.followupSilent, { brand: b.name, days: b.daysSinceLastContact ?? 0, offer: b.nextOffer?.title ?? t.common.none }));
        brandLink(b.id);
      }
      const reports = f.openTasks.filter((x) => x.rule === "post_plus_7" || x.rule === "post_plus_30");
      for (const r of reports) lines.push(`• ${r.title}`);
      if (reports.length) src.add("automation");
      if (lines.length === 1) lines.push(a.followupNone);
      else if (!f.openTasks.length) lines.push(a.followupRunHint);
    } else if (intent === "owed") {
      const list = brand ? f.unpaidInvoices.filter((x) => x.brandId === brand.id) : f.unpaidInvoices;
      if (!list.length) lines.push(a.owedNone);
      else {
        lines.push(fmt(a.owedIntro, { n: list.length, amount: baht(list.reduce((s, x) => s + x.amount, 0)) }));
        for (const inv of list) {
          lines.push(fmt(a.owedLine, { brand: inv.brand, invoice: inv.number, amount: baht(inv.amount), status: inv.status === "overdue" ? fmt(a.owedOverdue, { days: inv.daysOverdue }) : fmt(a.owedDue, { date: i18n.date(inv.dueAt) }) }));
          brandLink(inv.brandId);
        }
      }
      src.add("finance");
    } else if (intent === "income") {
      const fin = f.finance;
      const change = fin.incomeSamePeriodLastYear ? fin.incomeThisYear / fin.incomeSamePeriodLastYear - 1 : null;
      lines.push(fmt(a.incomeIntro, { year: f.today.slice(0, 4), amount: baht(fin.incomeThisYear), change: change === null ? t.common.none : signedPct(change, 0) }));
      lines.push(fmt(a.incomeTop, { list: fin.topBrands12m.slice(0, 3).map((b) => `${b.brand} ${baht(b.income)}`).join(" · ") }));
      const plat = Object.entries(fin.incomeByPlatform12m).sort((x, y) => y[1] - x[1]);
      lines.push(fmt(a.incomePlatform, { list: plat.map(([k, v]) => `${k === "addons" ? t.finance.addons : t.platforms[k as "tiktok"]} ${baht(v)}`).join(" · ") }));
      if (fin.expectedFromWonDeals) lines.push(fmt(a.incomeExpected, { amount: baht(fin.expectedFromWonDeals), n: fin.expectedDeals.length }));
      if (fin.outstanding) lines.push(fmt(a.incomeOutstanding, { amount: baht(fin.outstanding) }));
      src.add("finance");
    } else if (intent === "best") {
      lines.push(fmt(a.bestIntro, { start: i18n.dateShort(f.content.window.start), end: i18n.dateShort(f.content.window.end) }));
      for (const c of f.content.top.slice(0, 3)) lines.push(fmt(a.bestLine, { title: c.title, platform: c.platforms.map((p) => t.platforms[p]).join(" + "), views: num(c.views), er: c.er === null ? t.common.none : pct(c.er) }));
      const h = f.content.bestTypeForFollowers;
      if (h) lines.push(fmt(t.overview.insightFpv, { platform: t.platforms[h.platform], type: t.contentTypes[h.type], fpk: h.followersPer1kViews.toFixed(1), x: h.liftVsPlatformAvg.toFixed(1) }));
      src.add("overview");
    } else if (intent === "pq") {
      lines.push(a.pqIntro);
      for (const p of [...f.productQuestions7d].sort((x, y) => y.recent - x.recent))
        lines.push(
          p.ratioVsBaseline === null
            ? fmt(a.pqLineNoBase, { category: t.categories[p.category], recent: p.recent })
            : fmt(a.pqLine, { category: t.categories[p.category], recent: p.recent, ratio: p.ratioVsBaseline.toFixed(1), flag: p.isSpike ? a.pqFlag : "" }),
        );
      for (const p of f.productQuestions7d.filter((x) => x.isSpike)) {
        const bs = f.brands.filter((b) => b.category === p.category && b.jobs > 0);
        lines.push(fmt(a.pqPitch, { category: t.categories[p.category], brands: bs.map((b) => `${b.name} (${t.tiers[b.tier]})`).join(", ") || t.common.none }));
        bs.forEach((b) => brandLink(b.id));
      }
      src.add("overview").add("audience");
    } else if (intent === "audience") {
      lines.push(fmt(a.audienceIntro, { total: num(f.audience.totalFollowers) }));
      for (const p of f.audience.platforms) lines.push(fmt(a.audienceLine, { platform: t.platforms[p.platform as "tiktok"], followers: compactNum(p.followers), age: p.topAge ?? t.common.none, female: p.femalePct ?? "—" }));
      const s = f.audience.segments90d;
      const spike = f.productQuestions7d.find((x) => x.isSpike)?.category ?? "tech";
      lines.push(fmt(a.audienceSegments, { superfans: s.superfans ?? 0, askers: s[`askers_${spike}`] ?? 0, category: t.categories[spike], contactable: s.contactable ?? 0 }));
      src.add("audience");
    } else if (intent === "pitch") {
      lines.push(a.pitchIntro);
      const ranked = f.brands.filter((b) => b.nextOffer && b.jobs > 0).sort((x, y) => y.lifetimeValue - x.lifetimeValue).slice(0, 5);
      for (const b of ranked) {
        lines.push(fmt(a.pitchLine, { brand: b.name, tier: t.tiers[b.tier], offer: b.nextOffer!.title, price: baht(b.nextOffer!.price) }));
        brandLink(b.id);
      }
    } else if (intent === "inbox") {
      const briefs = f.inbox.threads.filter((x) => x.newBrief).length;
      lines.push(fmt(a.inboxIntro, { unread: f.inbox.unread, briefs }));
      for (const th of f.inbox.threads) {
        lines.push(fmt(a.inboxLine, { brand: th.brand, flag: th.newBrief ? a.inboxBriefFlag : "", snippet: th.lastMessage.slice(0, 90) }));
        src.add(`inbox:${th.brandId}`);
      }
    } else {
      lines.push(a.help);
    }

    return { text: lines.join("\n"), citations: citations(i18n, f, [...src]), engine: this.engine };
  }
}

export function citations(i18n: I18n, f: Facts, ids: SourceId[]): Citation[] {
  const { t } = i18n;
  const label = (id: SourceId) => {
    const [kind, arg] = id.split(":");
    const brand = arg ? f.brands.find((b) => b.id === Number(arg))?.name : undefined;
    if (kind === "brand") return brand ? `Brand 360 · ${brand}` : t.nav.brands;
    if (kind === "inbox") return brand ? `${t.nav.inbox} · ${brand}` : t.nav.inbox;
    if (kind === "finance") return t.nav.finance;
    if (kind === "overview") return t.nav.overview;
    if (kind === "audience") return t.nav.audience;
    if (kind === "automation") return t.nav.automation;
    return id;
  };
  return ids.flatMap((id) => {
    const href = sourceHref(id);
    return href ? [{ label: label(id), href }] : [];
  });
}
