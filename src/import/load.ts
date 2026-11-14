/**
 * Loads one identified table into the right place. Everything reuses the existing pipelines:
 *   posts, comments, audience → cdp/ingest (upserts, pseudonymised comments, consent, import_runs log)
 *   account_daily            → account_daily (Overview's daily chart), like the workbook importer
 *   brands_deals             → crm/importCrm (same rules as the CSV template)
 *   creator_workbook         → cdp/adapters/workbook/importWorkbook (whole file)
 * Re-importing a newer export updates numbers instead of duplicating rows.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { accountDaily, audienceBreakdown, audienceSnapshots, contents, CONTENT_TYPES, PRODUCT_CATEGORIES, type ContentType, type ProductCategory } from "@/db/schema";
import { ingest } from "@/cdp/ingest";
import type { PlatformAdapter, RawAudienceSnapshot, RawComment, RawContent, RawMetricDaily } from "@/cdp/adapters/PlatformAdapter";
import { importWorkbook } from "@/cdp/adapters/workbook/importWorkbook";
import { CRM_COLUMNS, importCrm } from "@/crm/importCrm";
import { firstLine, guessTags, looksSponsored } from "@/connect/tags";
import { dateOrderOf, num, text, toDateTime, toNumber, toTime, yes, type DateOrder } from "./values";
import type { Cell, Detection, PlatformId, Table } from "./types";

export interface LoadResult {
  ok: boolean;
  message: string;
}

const TYPE_WORDS: Record<string, ContentType> = { product: "review", unbox: "review", unboxing: "review", howto: "tutorial", "how-to": "tutorial", tips: "tutorial", behind: "bts", reels: "lifestyle" };

function adapterOf(platform: PlatformId, d: { contents?: RawContent[]; metrics?: RawMetricDaily[]; comments?: RawComment[]; audience?: RawAudienceSnapshot[] }): PlatformAdapter {
  return {
    kind: "csv",
    platform,
    importContents: async () => d.contents ?? [],
    importMetrics: async () => d.metrics ?? [],
    importComments: async () => d.comments ?? [],
    importAudience: async () => d.audience ?? [],
  };
}

const get = (row: Record<string, Cell>, m: Record<string, string>, field: string): Cell => (m[field] ? (row[m[field]] ?? null) : null);

/** Day-first or month-first for one column (Instagram/Meta exports are month-first when the values can't tell). */
const orderFor = (t: Table, d: Detection, field: string): DateOrder =>
  dateOrderOf(d.mapping[field] ? t.rows.map((r) => r[d.mapping[field]]) : [], d.platform === "instagram" ? "mdy" : "dmy");

/* ── posts ── */

async function loadPosts(db: DB, t: Table, d: Detection, now: string): Promise<LoadResult> {
  const platform = d.platform!;
  const m = d.mapping;
  // New posts without a category in the file get the creator's usual one (their niche), else a keyword guess.
  const usual = db.get<{ c: ProductCategory }>(sql`select product_category c from contents group by c order by count(*) desc limit 1`)?.c;
  const existing = db.select({ ext: contents.externalId, postedAt: contents.postedAt }).from(contents).where(eq(contents.platformId, platform)).all();
  const byMinute = new Map(existing.map((c) => [c.postedAt.slice(0, 16), c.ext]));

  const posts = new Map<string, RawContent>();
  const metrics: RawMetricDaily[] = [];
  let skipped = 0;
  const postedOrder = orderFor(t, d, "postedAt");
  const dateOrder = orderFor(t, d, "date");
  for (const row of t.rows) {
    const posted = toDateTime(get(row, m, "postedAt"), postedOrder) ?? (m.postedAt ? null : toDateTime(get(row, m, "date"), dateOrder));
    if (!posted) {
      skipped++;
      continue;
    }
    const time = toTime(get(row, m, "postedTime")) ?? posted.time ?? "12:00:00";
    const postedAt = `${posted.day}T${time}`;
    const title = firstLine(text(get(row, m, "title"))) || text(get(row, m, "link")) || postedAt;
    // Without an ID column: reuse the post already stored at that minute, else a stable ID from time + title.
    const id =
      text(get(row, m, "id")) ||
      byMinute.get(postedAt.slice(0, 16)) ||
      `file-${createHash("sha1").update(`${postedAt}|${title}`).digest("hex").slice(0, 12)}`;

    if (!posts.has(id)) {
      const guess = guessTags(title);
      const typeRaw = text(get(row, m, "type")).toLowerCase();
      const catRaw = text(get(row, m, "category")).toLowerCase();
      const type = (CONTENT_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as ContentType) : TYPE_WORDS[typeRaw];
      const category = (PRODUCT_CATEGORIES as readonly string[]).includes(catRaw) ? (catRaw as ProductCategory) : undefined;
      posts.set(id, {
        externalId: id,
        title: title.slice(0, 90),
        postedAt,
        type: type ?? guess.type,
        productCategory: category ?? usual ?? guess.productCategory,
        isSponsored: m.sponsored ? yes(get(row, m, "sponsored")) : looksSponsored(title),
        // Tags the file didn't state are guesses: a post already stored keeps its own.
        tagsGuessed: !type || !category,
      });
    }
    // A "date" column (different from the posting day) = one row per post per day; otherwise lifetime totals on the posting day.
    const day = m.date && m.postedAt ? (toDateTime(get(row, m, "date"), dateOrder)?.day ?? posted.day) : posted.day;
    metrics.push({
      contentExternalId: id,
      date: day,
      views: num(get(row, m, "views")),
      likes: num(get(row, m, "likes")),
      comments: num(get(row, m, "comments")),
      shares: num(get(row, m, "shares")),
      saves: num(get(row, m, "saves")),
      profileViews: num(get(row, m, "profileViews")),
      newFollowers: num(get(row, m, "newFollowers")),
    });
  }
  if (!posts.size) return { ok: false, message: `None of the ${t.rows.length} rows had a readable posting date` };
  const r = await ingest(db, adapterOf(platform, { contents: [...posts.values()], metrics }), now);
  if (r.status === "failed") return { ok: false, message: r.message ?? "failed" };
  return { ok: true, message: `${r.contents} posts, ${r.metricRows} metric rows${skipped ? ` · ${skipped} rows without a date skipped` : ""}` };
}

/* ── comments ── */

async function loadComments(db: DB, t: Table, d: Detection, now: string): Promise<LoadResult> {
  const m = d.mapping;
  const order = orderFor(t, d, "time");
  const raw: RawComment[] = t.rows.flatMap((row) => {
    const body = text(get(row, m, "text"));
    const when = toDateTime(get(row, m, "time"), order);
    if (!body) return [];
    return [{ contentExternalId: text(get(row, m, "postId")), authorHandle: text(get(row, m, "author")) || "unknown", text: body, createdAt: when ? `${when.day}T${when.time ?? "12:00:00"}` : now }];
  });
  if (!raw.length) return { ok: false, message: "No rows had comment text" };
  const r = await ingest(db, adapterOf(d.platform!, { comments: raw }), now);
  if (r.status === "failed") return { ok: false, message: r.message ?? "failed" };
  const unmatched = raw.length - r.comments;
  return { ok: true, message: `${r.comments} new comments${unmatched > 0 ? ` · ${unmatched} skipped (already imported, or their post isn't imported yet)` : ""}` };
}

/* ── account daily ── */

function loadAccountDaily(db: DB, t: Table, d: Detection): LoadResult {
  const m = d.mapping;
  let n = 0;
  const order = orderFor(t, d, "date");
  db.transaction((tx) => {
    for (const row of t.rows) {
      const day = toDateTime(get(row, m, "date"), order)?.day;
      if (!day) continue;
      const opt = (f: string) => (m[f] ? toNumber(get(row, m, f)) : null);
      const values = {
        platformId: d.platform!,
        date: day,
        views: num(get(row, m, "views")),
        profileViews: num(get(row, m, "profileViews")),
        likes: num(get(row, m, "likes")),
        comments: num(get(row, m, "comments")),
        shares: num(get(row, m, "shares")),
        newFollowers: num(get(row, m, "newFollowers")),
        lostFollowers: opt("lostFollowers"),
        followers: opt("followers"),
      };
      // Only overwrite what this file has: a followers-only file mustn't zero the views.
      const set: Record<string, unknown> = { followers: sql`coalesce(excluded.followers, ${accountDaily.followers})` };
      for (const f of ["views", "profileViews", "likes", "comments", "shares", "newFollowers", "lostFollowers"] as const) if (m[f]) set[f] = values[f];
      tx.insert(accountDaily).values(values).onConflictDoUpdate({ target: [accountDaily.platformId, accountDaily.date], set }).run();
      n++;
    }
  });
  return n ? { ok: true, message: `${n} days` } : { ok: false, message: "No rows had a readable date" };
}

/* ── audience ── */

const COUNTRY: Record<string, string> = { thailand: "TH", ไทย: "TH", th: "TH", laos: "LA", ลาว: "LA", la: "LA", malaysia: "MY", มาเลเซีย: "MY", my: "MY", "united states": "US", usa: "US", us: "US", สหรัฐอเมริกา: "US" };
const KNOWN = new Set(["TH", "LA", "MY", "US"]);

function bucketOf(kind: Detection["kind"], key: string): string | null {
  const k = key.trim();
  if (!k || /total|รวม|all/i.test(k)) return null;
  if (kind === "audience_gender") return /^(f|w|หญิง)/i.test(k) ? "female" : /^(m|ชาย)/i.test(k) ? "male" : "other";
  if (kind === "audience_country") {
    const code = COUNTRY[k.toLowerCase()] ?? (k.length === 2 ? k.toUpperCase() : null);
    return code && KNOWN.has(code) ? code : "other";
  }
  const a = k.replace(/\s/g, "").replace("–", "-");
  return /^(45|55|65)/.test(a) ? "45+" : a;
}

async function loadAudience(db: DB, t: Table, d: Detection, now: string): Promise<LoadResult> {
  const m = d.mapping;
  const dimension = d.kind === "audience_age" ? "age" : d.kind === "audience_gender" ? "gender" : "country";
  const values: Record<string, number> = {};
  const gender: Record<string, number> = {};
  for (const row of t.rows) {
    const b = bucketOf(d.kind, text(get(row, m, "key")));
    if (!b) continue;
    const men = toNumber(get(row, m, "men"));
    const women = toNumber(get(row, m, "women"));
    const v = toNumber(get(row, m, "share")) ?? (men ?? 0) + (women ?? 0);
    values[b] = (values[b] ?? 0) + v;
    if (dimension === "age" && (men !== null || women !== null)) {
      gender.male = (gender.male ?? 0) + (men ?? 0);
      gender.female = (gender.female ?? 0) + (women ?? 0);
    }
  }
  const pct = (o: Record<string, number>) => {
    const total = Object.values(o).reduce((a, b) => a + b, 0) || 1;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, (v / total) * 100]));
  };
  if (!Object.keys(values).length) return { ok: false, message: "No rows with a value" };

  // The month's other breakdowns are kept: ingest replaces the whole month, so pass them back in.
  const month = now.slice(0, 7);
  const snap = db.select().from(audienceSnapshots).where(and(eq(audienceSnapshots.platformId, d.platform!), eq(audienceSnapshots.month, month))).get();
  const prev = snap ? db.select().from(audienceBreakdown).where(eq(audienceBreakdown.snapshotId, snap.id)).all() : [];
  const keep = (dim: "age" | "gender" | "country") => Object.fromEntries(prev.filter((r) => r.dimension === dim).map((r) => [r.bucket, r.pct]));
  const followers =
    snap?.followers ??
    db.select({ f: audienceSnapshots.followers }).from(audienceSnapshots).where(eq(audienceSnapshots.platformId, d.platform!)).orderBy(desc(audienceSnapshots.month)).get()?.f ??
    0;
  const a: RawAudienceSnapshot = {
    month,
    followers,
    age: dimension === "age" ? pct(values) : keep("age"),
    gender: dimension === "gender" ? pct(values) : dimension === "age" && Object.keys(gender).length ? pct(gender) : keep("gender"),
    country: dimension === "country" ? pct(values) : keep("country"),
  };
  const r = await ingest(db, adapterOf(d.platform!, { audience: [a] }), now);
  if (r.status === "failed") return { ok: false, message: r.message ?? "failed" };
  return { ok: true, message: `${dimension} split for ${month} (${Object.keys(values).length} groups)` };
}

/* ── brands & deals ── */

function loadBrandsDeals(db: DB, t: Table, d: Detection, today: string): LoadResult {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cell = (row: Record<string, Cell>, f: string) => {
    const v = get(row, d.mapping, f);
    if (/_date$/.test(f)) return toDateTime(v, orderFor(t, d, f))?.day ?? "";
    if (f === "value") return String(toNumber(v) ?? text(v));
    return text(v);
  };
  const csv = [CRM_COLUMNS.join(","), ...t.rows.map((row) => CRM_COLUMNS.map((f) => esc(cell(row, f))).join(","))].join("\n");
  const r = importCrm(db, csv, today);
  return { ok: true, message: `${r.brands} new brands, ${r.deals} deals, ${r.invoices} invoices${r.skipped ? `, ${r.skipped} already there` : ""}${r.errors.length ? ` · ${r.errors.slice(0, 3).join(" · ")}` : ""}` };
}

/** Load one table (or, for the creator's workbook, the whole file). */
export async function loadTable(db: DB, t: Table, d: Detection, now: string, fileBuffer?: Buffer): Promise<LoadResult> {
  switch (d.kind) {
    case "posts":
      return loadPosts(db, t, d, now);
    case "comments":
      return loadComments(db, t, d, now);
    case "account_daily":
      return loadAccountDaily(db, t, d);
    case "audience_age":
    case "audience_gender":
    case "audience_country":
      return loadAudience(db, t, d, now);
    case "brands_deals":
      return loadBrandsDeals(db, t, d, now.slice(0, 10));
    case "creator_workbook": {
      if (!fileBuffer) return { ok: false, message: "File missing" };
      const r = await importWorkbook(db, fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer, now);
      const posts = Object.values(r.posts).reduce((a, b) => a + (b ?? 0), 0);
      return { ok: true, message: `${posts} posts, ${r.accountDays} days, ${r.audienceMonths} audience months${r.brandsAdded.length ? `, new brands: ${r.brandsAdded.join(", ")}` : ""}` };
    }
    default:
      return { ok: false, message: "Not recognised" };
  }
}
