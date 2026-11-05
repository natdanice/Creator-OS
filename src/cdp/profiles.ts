/**
 * CDP stage 3–4 for the AUDIENCE side: behavioural segments and the Single
 * Customer Profile of one pseudonymous person (U0001…).
 *
 * Only consented data is used (ANALYTICS_OK). A person whose analytics consent
 * is withdrawn has no profile — the app shows that the data was excluded.
 * Real handles never exist here; the pseudo ID is the only identifier.
 */
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { audienceBreakdown, audienceSnapshots, comments, consents, contents, pseudonyms, PRODUCT_CATEGORIES, type CommentCategory, type ProductCategory } from "@/db/schema";
import { ANALYTICS_OK } from "./consent";
import { addDays, monthOf } from "@/lib/dates";

export const SEGMENT_WINDOW_DAYS = 90;
export const SUPERFAN_MIN_COMMENTS = 5;
export const NEW_DAYS = 30;

export type SegmentId = "superfans" | "requesters" | "newcomers" | "contactable" | `askers_${ProductCategory}`;

interface PersonAgg {
  pseudoId: string;
  n: number;
  spam: number;
  pq: number;
  requests: number;
  platforms: string;
  lastAt: string;
  firstSeenAt: string;
  marketing: number;
}

function peopleInWindow(db: DB, today: string): PersonAgg[] {
  const since = addDays(today, -(SEGMENT_WINDOW_DAYS - 1));
  const day = sql<string>`substr(${comments.createdAt}, 1, 10)`;
  return db
    .select({
      pseudoId: comments.authorPseudoId,
      n: sql<number>`count(*)`,
      spam: sql<number>`sum(case when ${comments.category} = 'spam' then 1 else 0 end)`,
      pq: sql<number>`sum(case when ${comments.category} = 'product_question' then 1 else 0 end)`,
      requests: sql<number>`sum(case when ${comments.category} = 'content_request' then 1 else 0 end)`,
      platforms: sql<string>`group_concat(distinct ${comments.platformId})`,
      lastAt: sql<string>`max(${comments.createdAt})`,
      firstSeenAt: pseudonyms.firstSeenAt,
      marketing: sql<number>`(select count(*) from ${consents} where ${consents.subjectPseudoId} = ${comments.authorPseudoId} and ${consents.purpose} = 'marketing' and ${consents.status} = 'active')`,
    })
    .from(comments)
    .innerJoin(pseudonyms, eq(pseudonyms.pseudoId, comments.authorPseudoId))
    .where(and(ANALYTICS_OK, gte(day, since), lte(day, today)))
    .groupBy(comments.authorPseudoId)
    .all();
}

/** pseudoId → product categories they asked about (window). */
function askersByCategory(db: DB, today: string) {
  const since = addDays(today, -(SEGMENT_WINDOW_DAYS - 1));
  const day = sql<string>`substr(${comments.createdAt}, 1, 10)`;
  return db
    .selectDistinct({ pseudoId: comments.authorPseudoId, category: contents.productCategory })
    .from(comments)
    .innerJoin(contents, eq(contents.id, comments.contentId))
    .where(and(ANALYTICS_OK, eq(comments.category, "product_question"), gte(day, since), lte(day, today)))
    .all();
}

export interface SegmentSummary {
  id: SegmentId;
  size: number;
  contactable: number; // members with active marketing consent
}

export function audienceSegments(db: DB, today: string) {
  const people = peopleInWindow(db, today);
  const real = people.filter((p) => p.spam * 2 < p.n); // mostly-spam accounts are left out of every segment
  const askers = askersByCategory(db, today);
  const newSince = addDays(today, -(NEW_DAYS - 1));
  const members: Record<SegmentId, Set<string>> = {
    superfans: new Set(real.filter((p) => p.n - p.spam >= SUPERFAN_MIN_COMMENTS).map((p) => p.pseudoId)),
    requesters: new Set(real.filter((p) => p.requests > 0).map((p) => p.pseudoId)),
    newcomers: new Set(real.filter((p) => p.firstSeenAt.slice(0, 10) >= newSince).map((p) => p.pseudoId)),
    contactable: new Set(real.filter((p) => p.marketing > 0).map((p) => p.pseudoId)),
    ...(Object.fromEntries(PRODUCT_CATEGORIES.map((c) => [`askers_${c}`, new Set<string>()])) as Record<`askers_${ProductCategory}`, Set<string>>),
  };
  const realIds = new Set(real.map((p) => p.pseudoId));
  for (const a of askers) if (realIds.has(a.pseudoId)) members[`askers_${a.category}`].add(a.pseudoId);
  const byId = new Map(real.map((p) => [p.pseudoId, p]));
  const summaries: SegmentSummary[] = (Object.keys(members) as SegmentId[]).map((id) => ({
    id,
    size: members[id].size,
    contactable: [...members[id]].filter((p) => byId.get(p)!.marketing > 0).length,
  }));
  return { activePeople: real.length, excludedSpam: people.length - real.length, summaries, members, byId };
}

export function segmentMembers(db: DB, today: string, id: SegmentId, limit = 50) {
  const { members, byId } = audienceSegments(db, today);
  const set = members[id];
  if (!set) return { total: 0, rows: [] };
  const rows = [...set]
    .map((p) => byId.get(p)!)
    .sort((a, b) => b.n - a.n || b.lastAt.localeCompare(a.lastAt))
    .slice(0, limit)
    .map((p) => ({ pseudoId: p.pseudoId, comments: p.n, productQuestions: p.pq, platforms: p.platforms.split(","), lastAt: p.lastAt, contactable: p.marketing > 0 }));
  return { total: set.size, rows };
}

export interface AudienceProfile {
  pseudoId: string;
  firstSeenAt: string;
  withdrawn: boolean;
  consents: (typeof consents.$inferSelect)[];
  totals: Record<CommentCategory, number>;
  interests: { category: ProductCategory; n: number }[];
  platforms: { platformId: string; n: number }[];
  lastAt: string | null;
  comments: { id: number; text: string; category: CommentCategory; platformId: string; createdAt: string; contentTitle: string; productCategory: ProductCategory }[];
}

/** Single Customer Profile of one audience member. */
export function audienceProfile(db: DB, pseudoId: string, today: string): AudienceProfile | null {
  const p = db.select().from(pseudonyms).where(eq(pseudonyms.pseudoId, pseudoId)).get();
  if (!p) return null;
  const cs = db.select().from(consents).where(eq(consents.subjectPseudoId, pseudoId)).orderBy(asc(consents.grantedAt)).all();
  const withdrawn = cs.some((c) => c.purpose === "analytics" && c.status === "withdrawn");
  const empty = { product_question: 0, content_request: 0, general_question: 0, praise: 0, spam: 0 };
  if (withdrawn) return { pseudoId, firstSeenAt: p.firstSeenAt, withdrawn, consents: cs, totals: empty, interests: [], platforms: [], lastAt: null, comments: [] };
  const rows = db
    .select({
      id: comments.id,
      text: comments.text,
      category: comments.category,
      platformId: comments.platformId,
      createdAt: comments.createdAt,
      contentTitle: contents.title,
      productCategory: contents.productCategory,
    })
    .from(comments)
    .innerJoin(contents, eq(contents.id, comments.contentId))
    .where(and(eq(comments.authorPseudoId, pseudoId), ANALYTICS_OK, sql`substr(${comments.createdAt}, 1, 10) <= ${today}`))
    .orderBy(desc(comments.createdAt))
    .all();
  const totals = { ...empty };
  const interest = new Map<ProductCategory, number>();
  const plats = new Map<string, number>();
  for (const r of rows) {
    totals[r.category]++;
    if (r.category !== "spam") interest.set(r.productCategory, (interest.get(r.productCategory) ?? 0) + 1);
    plats.set(r.platformId, (plats.get(r.platformId) ?? 0) + 1);
  }
  return {
    pseudoId,
    firstSeenAt: p.firstSeenAt,
    withdrawn,
    consents: cs,
    totals,
    interests: [...interest].map(([category, n]) => ({ category, n })).sort((a, b) => b.n - a.n),
    platforms: [...plats].map(([platformId, n]) => ({ platformId, n })).sort((a, b) => b.n - a.n),
    lastAt: rows[0]?.createdAt ?? null,
    comments: rows,
  };
}

/** Followers per platform per month (for the growth chart). */
export function followerSeries(db: DB, today: string) {
  const rows = db.select().from(audienceSnapshots).where(lte(audienceSnapshots.month, monthOf(today))).orderBy(audienceSnapshots.month).all();
  const months = [...new Set(rows.map((r) => r.month))];
  return months.map((month) => {
    const row: Record<string, string | number> = { month };
    for (const r of rows.filter((x) => x.month === month)) row[r.platformId] = r.followers;
    return row as { month: string; tiktok: number; instagram: number; youtube: number };
  });
}

export function availableMonths(db: DB, today: string) {
  return [...new Set(db.select({ m: audienceSnapshots.month }).from(audienceSnapshots).where(lte(audienceSnapshots.month, monthOf(today))).all().map((r) => r.m))].sort().reverse();
}

/** Demographic split of one month, per platform. */
export function demographics(db: DB, month: string) {
  const snaps = db.select().from(audienceSnapshots).where(eq(audienceSnapshots.month, month)).all();
  return snaps.map((s) => {
    const bd = db.select().from(audienceBreakdown).where(eq(audienceBreakdown.snapshotId, s.id)).all();
    const dim = (d: "age" | "gender" | "country") => bd.filter((b) => b.dimension === d).map((b) => ({ bucket: b.bucket, pct: b.pct }));
    return { platformId: s.platformId, followers: s.followers, age: dim("age"), gender: dim("gender"), country: dim("country") };
  });
}
