/**
 * Checks that the Go API (backend/) returns exactly what the TypeScript code computes from the same
 * database: Overview (3 ranges), Needs-you-today, brands + tiers, pipeline and finance.
 * Start the API first (`npm run dev:api`, in the same mode as this script), then `npm run verify:api`.
 */
import { getDb } from "@/db/client";
import { getStoryDate } from "@/lib/queries/settings";
import { overviewData } from "@/lib/queries/overview";
import { todayActions } from "@/lib/queries/today";
import { computeBrandStats } from "@/crm/brandStats";
import { financeData, invoicesCsv, listInvoices } from "@/crm/finance";
import { TIERS } from "@/crm/rules";
import { brandContacts, COMMENT_CATEGORIES, DEAL_STAGES, rateCard } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { commentCountsByCategory, commentQueue, inboxCounts, listThreads, threadMessages } from "@/inbox/queries";
import { audienceProfile, audienceSegments, availableMonths, demographics, followerSeries, latestSplitMonth, segmentMembers } from "@/cdp/profiles";
import { productQuestionSpikes } from "@/cdp/segments";
import { PLATFORM_KEYS } from "@/lib/queries/overview";
import { contentPerformance, sponsoredContentIdsForDeals } from "@/crm/contentPerformance";
import { recommendNextOffer } from "@/crm/nextOffer";
import { presentOffer, type ApiOffer } from "@/crm/presentOffer";
import { DICTS } from "@/lib/i18n";
import { activities, invoices } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { consentSummary } from "@/cdp/consent";
import { getProfile } from "@/lib/queries/profile";
import { comments, importRuns, platforms, automationRules, automationRuns, consents, tasks } from "@/db/schema";
import { desc, ne } from "drizzle-orm";
import { guessDeliverables } from "@/inbox/briefDetector";

const API = process.env.API_URL ?? "http://127.0.0.1:8080";
const headers: Record<string, string> = process.env.API_TOKEN ? { Authorization: `Bearer ${process.env.API_TOKEN}` } : {};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** What JSON.stringify would send (drops undefined, Infinity → null), parsed back. */
const wire = (v: unknown) => JSON.parse(JSON.stringify(v));

/** Deep compare; numbers match within a tiny relative tolerance (float sums). Returns the first difference. */
function diff(a: unknown, b: unknown, path = "$"): string | null {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) ? null : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.join() !== kb.join()) return `${path}: keys ${ka.filter((k) => !kb.includes(k)).join() || "—"} (TS only) / ${kb.filter((k) => !ka.includes(k)).join() || "—"} (Go only)`;
    for (const k of ka) {
      const d = diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}

let failed = 0;
function check(name: string, ts: unknown, go: unknown) {
  const d = diff(wire(ts), go);
  if (d) failed++;
  console.log(`${d ? "✗" : "✓"} ${name}${d ? `\n    ${d}` : ""}`);
}

async function inboxChecks(db: ReturnType<typeof getDb>, today: string) {
  const sum = await get<{ counts: unknown; needsReply: number; commentCounts: unknown }>("/api/v1/inbox");
  check("inbox: badge counts", inboxCounts(db), sum.counts);
  const cc = [...commentCountsByCategory(db, today)].sort((a, b) => a.category.localeCompare(b.category));
  check("inbox: comment counts by category", cc, [...(sum.commentCounts as { category: string }[])].sort((a, b) => a.category.localeCompare(b.category)));

  const threads = listThreads(db, today);
  check("inbox: thread list", threads, (await get<{ threads: unknown }>("/api/v1/inbox/threads")).threads);

  const cards = db.select().from(rateCard).all();
  for (const th of threads) {
    const contact = db.select().from(brandContacts).where(and(eq(brandContacts.brandId, th.brandId), eq(brandContacts.isPrimary, true))).get() ?? null;
    const messages = threadMessages(db, th.brandId)
      .filter((r) => r.m.sentAt.slice(0, 10) <= today)
      .map(({ m, dealTitle, dealStage }) => ({
        ...m,
        brief: m.brief
          ? (() => {
              const deliverables = guessDeliverables(m.brief.platforms ?? []).map((c) => ({ code: c, name: cards.find((x) => x.code === c)?.name ?? c, price: cards.find((x) => x.code === c)?.price ?? 0 }));
              return { ...m.brief, deliverables, listPrice: deliverables.reduce((s, d) => s + d.price, 0) };
            })()
          : null,
        dealTitle,
        dealStage,
      }));
    const g = await get<{ thread: unknown }>(`/api/v1/inbox/threads/${th.brandId}`);
    check(`inbox: thread of brand ${th.brandId} (${messages.length} messages)`, { contact, messages }, g.thread);
  }

  const platforms = [undefined, "tiktok", "instagram", "youtube"];
  for (const cat of ["needs_reply", ...COMMENT_CATEGORIES] as const)
    for (const status of ["open", "replied", "hidden"] as const)
      for (const platform of platforms) {
        const ts = commentQueue(db, today, { category: cat, status, platform });
        const qs = new URLSearchParams({ cat, status, ...(platform ? { platform } : {}) });
        const go = await get<{ rows: unknown[]; total: number }>(`/api/v1/inbox/comments?${qs}`);
        check(`inbox: comments ${cat}/${status}/${platform ?? "all"} (${ts.total})`, ts, { rows: go.rows, total: go.total });
      }
}

/** Newest follower count per platform as of today: the one source Settings, the Audience page and the MCP tools use. */
function latestFollowers(db: ReturnType<typeof getDb>, today: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of db.select().from(platforms).all()) {
    const f = db.get<{ f: number } | undefined>(sql`select followers as f from audience_snapshots where platform_id = ${p.id} and month <= ${today.slice(0, 7)} order by month desc, id desc limit 1`)?.f;
    if (f !== undefined) out[p.id] = f;
  }
  return out;
}

async function audienceChecks(db: ReturnType<typeof getDb>, today: string) {
  const months = availableMonths(db, today);
  const seg = audienceSegments(db, today);
  for (const platform of PLATFORM_KEYS)
    for (const month of [undefined, ...months]) {
      const qs = new URLSearchParams({ platform, ...(month ? { month } : {}) });
      const go = await get<Record<string, unknown>>(`/api/v1/audience?${qs}`);
      const m = month ?? months[0];
      const split = m ? latestSplitMonth(db, platform, m) : null;
      const demo = split ? demographics(db, split).find((d) => d.platformId === platform) ?? null : null;
      check(
        `audience: ${platform} / ${month ?? "latest"}`,
        {
          months,
          month: m ?? null,
          series: followerSeries(db, today),
          splitMonth: split,
          demographics: demo,
          latestFollowers: latestFollowers(db, today),
          segments: { activePeople: seg.activePeople, excludedSpam: seg.excludedSpam, summaries: seg.summaries },
          spikingSegments: productQuestionSpikes(db, today).filter((s) => s.isSpike).map((s) => `askers_${s.category}`),
        },
        Object.fromEntries(Object.entries(go).filter(([k]) => !["today", "platform"].includes(k))),
      );
    }
  const seen = new Set<string>();
  for (const { id } of seg.summaries) {
    const ts = segmentMembers(db, today, id, 30);
    const go = await get<{ total: number; rows: unknown[] }>(`/api/v1/audience/segments/${id}/members?limit=30`);
    check(`audience: segment ${id} members (${ts.total})`, ts, { total: go.total, rows: go.rows });
    for (const r of ts.rows.slice(0, 3)) seen.add(r.pseudoId);
  }
  const withdrawn = db.select({ id: consents.subjectPseudoId }).from(consents).all().filter((c) => audienceProfile(db, c.id, today)?.withdrawn).slice(0, 2);
  for (const id of [...seen, ...withdrawn.map((w) => w.id)]) check(`audience: profile ${id}`, audienceProfile(db, id, today), (await get<{ profile: unknown }>(`/api/v1/audience/members/${id}`)).profile);
}

async function automationChecks(db: ReturnType<typeof getDb>) {
  const go = await get<{ rules: unknown; open: unknown; done: unknown; runs: unknown }>("/api/v1/automation");
  check("automation: rules", db.select().from(automationRules).all(), go.rules);
  check("automation: open tasks", db.select().from(tasks).where(eq(tasks.status, "open")).orderBy(desc(tasks.forDate), tasks.id).all(), go.open);
  check("automation: done tasks", db.select().from(tasks).where(ne(tasks.status, "open")).orderBy(desc(tasks.completedAt), tasks.id).all(), go.done);
  check("automation: recent runs", db.select().from(automationRuns).orderBy(desc(automationRuns.id)).limit(8).all(), go.runs);
}

async function settingsChecks(db: ReturnType<typeof getDb>, today: string) {
  const { settings: go } = await get<{ settings: Record<string, unknown> }>("/api/v1/settings");
  const plats = db.select().from(platforms).all();
  check("settings: platforms", plats, go.platforms);
  check("settings: profile", getProfile(db), go.profile);
  check("settings: rate card", db.select().from(rateCard).all(), go.rateCard);
  check("settings: import history", db.select().from(importRuns).orderBy(desc(importRuns.startedAt), desc(importRuns.id)).all(), go.importRuns);
  check("settings: consent summary", consentSummary(db), go.consent);
  check("settings: redacted comments", db.select({ n: sql<number>`count(*)` }).from(comments).where(eq(comments.redacted, true)).get()!.n, go.redactedComments);
  check("settings: latest follower counts", latestFollowers(db, today), go.latestFollowers);
}

async function brand360Checks(db: ReturnType<typeof getDb>, today: string) {
  const stats = computeBrandStats(db, today);
  for (const st of stats) {
    const { brand: go } = await get<{ brand: { stats: unknown; performance: unknown; offer: ApiOffer; invoices: unknown; activities: unknown } }>(`/api/v1/brands/${st.brand.id}`);
    const dealIds = st.deals.map((d) => d.id);
    const perf = contentPerformance(db, sponsoredContentIdsForDeals(db, dealIds), today).sort((a, b) => (a.postedAt === b.postedAt ? a.contentId - b.contentId : a.postedAt < b.postedAt ? 1 : -1)); // same time → by id (the old order was arbitrary)
    check(`brand 360 #${st.brand.id} ${st.brand.name}: stats, ${perf.length} posts`, { stats: st, performance: perf }, { stats: go.stats, performance: go.performance });
    for (const locale of ["en", "th"] as const) {
      const t = DICTS[locale];
      const want = recommendNextOffer(db, st, today, perf, undefined, t);
      check(`brand 360 #${st.brand.id}: offer "${want.rule}" in ${locale}`, { rule: want.rule, codes: want.codes, price: want.price, title: want.title, reason: want.reason }, { rule: go.offer.rule, codes: go.offer.codes, price: go.offer.price, ...presentOffer(t, go.offer) });
    }
    check(`brand 360 #${st.brand.id}: invoices`, dealIds.length ? db.select().from(invoices).where(inArray(invoices.dealId, dealIds)).all() : [], go.invoices);
    check(`brand 360 #${st.brand.id}: timeline`, db.select().from(activities).where(eq(activities.brandId, st.brand.id)).orderBy(desc(activities.occurredAt)).all().filter((a) => a.occurredAt.slice(0, 10) <= today), go.activities);
  }
  const missing = await fetch(`${API}/api/v1/brands/99999`, { headers });
  check("brand 360: unknown brand is a 404", 404, missing.status);
}

async function main() {
  const db = getDb();
  const today = getStoryDate(db);
  const ctx = await get<{ today: string; mode: string }>("/api/v1/context");
  console.log(`database today ${today} · API today ${ctx.today} (${ctx.mode} mode)`);
  check("context: same \"today\"", today, ctx.today);

  for (const range of [7, 28, 90]) {
    const r = await get<{ overview: unknown }>(`/api/v1/overview?range=${range}`);
    check(`overview, ${range} days`, overviewData(db, today, range), r.overview);
  }
  check("needs you today", todayActions(db, today), (await get<{ actions: unknown }>("/api/v1/today")).actions);

  const stats = computeBrandStats(db, today);
  const rows = [...stats].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || b.dealValueThisYear - a.dealValueThisYear);
  const b = await get<{ rows: unknown[]; tierCounts: Record<string, number> }>("/api/v1/brands");
  check("brands: rows (tier, value, silent…)", rows, b.rows);
  check("brands: tier counts", Object.fromEntries(TIERS.map((t) => [t, stats.filter((s) => s.tier === t).length])), b.tierCounts);
  const pro = await get<{ rows: { tier: string }[] }>("/api/v1/brands?tier=partner");
  check("brands: tier filter", rows.filter((s) => s.tier === "partner"), pro.rows);

  const deals = stats
    .flatMap((s) => s.deals.map((d) => ({ id: d.id, title: d.title, brandId: s.brand.id, brandName: s.brand.name, tier: s.tier, stage: d.stage, value: d.value, date: d.closedAt ?? d.postedAt ?? d.createdAt })))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const p = await get<{ deals: unknown[]; stages: string[] }>("/api/v1/pipeline");
  check("pipeline: stages", [...DEAL_STAGES], p.stages);
  // Same deals; order among deals sharing a timestamp is not meaningful, so compare by id.
  const byId = (xs: { id: number }[]) => [...xs].sort((a, b) => a.id - b.id);
  check("pipeline: deals", byId(deals), byId(p.deals as { id: number }[]));

  check("finance", financeData(db, today), (await get<{ finance: unknown }>("/api/v1/finance")).finance);
  const year = today.slice(0, 4);
  // Decode by hand: Response.text() would drop the BOM that makes Excel open Thai text correctly.
  const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await (await fetch(`${API}/api/v1/finance/export?year=${year}`, { headers })).arrayBuffer());
  check(`finance: CSV export ${year}`, invoicesCsv(listInvoices(db, today), year), csv);

  await inboxChecks(db, today);
  await audienceChecks(db, today);
  await automationChecks(db);
  await settingsChecks(db, today);
  await brand360Checks(db, today);

  console.log(failed ? `\n${failed} check(s) differ.` : "\nGo API matches the TypeScript code.");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
