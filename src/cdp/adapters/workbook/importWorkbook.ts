/**
 * Imports the creator's own Excel workbook(s) — the cleaned "master copy" with one sheet
 * per dataset. Sheets are recognised by name; unknown sheets are ignored, so the same
 * function takes the posts, daily and audience files in any combination.
 *
 *   TikTok_Clips / IG_Posts         one row per post, lifetime totals → contents + one metrics row on the posting day
 *   TikTok_Daily                    account-level daily totals → account_daily (Overview daily chart)
 *   TikTok_Followers_Daily          followers per day → account_daily.followers + monthly audience snapshots
 *   TikTok_Follower_Gender/_Territories, IG_Audience_AgeGender/_Countries → demographics of the latest month
 *
 * Everything goes through the normal ingest pipeline (import_runs log, upserts), so
 * re-importing an updated workbook replaces the numbers instead of duplicating posts.
 * Brands tagged on "Product" posts are added as brands (Lead) for the CRM.
 */
import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { accountDaily, brands, type ContentType } from "@/db/schema";
import { ingest } from "@/cdp/ingest";
import type { PlatformAdapter, PlatformId, RawAudienceSnapshot, RawContent, RawMetricDaily } from "../PlatformAdapter";

type Row = Record<string, unknown>;

const TYPE_MAP: Record<string, ContentType> = { cover: "cover", reply: "reply", lifestyle: "lifestyle", product: "review", review: "review", tutorial: "tutorial", vlog: "vlog", bts: "bts" };
const COUNTRY_CODES: Record<string, string> = { thailand: "TH", laos: "LA", malaysia: "MY", "united states": "US" };
const KNOWN = new Set(["TH", "LA", "MY", "US"]);

/** First row = headers; empty cells are left out of each row object. */
function toObjects(matrix: unknown[][]): Row[] {
  const [header = [], ...body] = matrix;
  const names = header.map((h) => String(h ?? "").trim());
  return body
    .map((r) => Object.fromEntries(r.flatMap((v, i) => (v === null || v === "" || !names[i] ? [] : [[names[i], v]]))))
    .filter((o) => Object.keys(o).length);
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0);
const day = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = String(v ?? "").match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
};
const time = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(11, 19);
  if (typeof v === "number") {
    const secs = Math.round((v % 1) * 86400);
    return [secs / 3600, (secs % 3600) / 60, secs % 60].map((x) => String(Math.floor(x)).padStart(2, "0")).join(":");
  }
  const m = String(v ?? "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}` : "12:00:00";
};
const yes = (v: unknown) => v === true || /^(true|yes|y|1|ใช่)$/i.test(String(v ?? "").trim());
const brandKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9ก-๙]/g, "");

function posts(platform: PlatformId, rows: Row[]) {
  const hasSponsoredCol = rows.some((r) => "Is_Sponsored" in r);
  const contents: RawContent[] = [];
  const metrics: RawMetricDaily[] = [];
  const tags: string[] = [];
  for (const r of rows) {
    const d = day(r.Posted_Date);
    if (!d) continue;
    const id = String(r.Content_ID ?? "").trim() || `no-${r.Content_No}`;
    const typeRaw = String(r.Content_Type ?? "").trim().toLowerCase();
    // Sponsored = paid by a brand. Is_Ad / Paid_Promo (ads the creator paid for) is a different thing and not counted.
    const sponsored = hasSponsoredCol ? yes(r.Is_Sponsored) : typeRaw === "product";
    contents.push({
      externalId: id,
      title: String(r.Clip_Name ?? r.Caption_Full ?? id).slice(0, 90),
      type: TYPE_MAP[typeRaw] ?? "lifestyle",
      productCategory: "music",
      postedAt: `${d}T${time(r.Posted_Time)}`,
      isSponsored: sponsored,
    });
    // Only lifetime totals exist per post: they are recorded on the posting day.
    metrics.push({ contentExternalId: id, date: d, views: num(r.Views), likes: num(r.Likes), comments: num(r.Comments), shares: num(r.Shares), saves: num(r.Saves), profileViews: 0, newFollowers: 0 });
    if (typeRaw === "product") tags.push(...String(r.Tagged_Accounts ?? "").split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean));
  }
  return { contents, metrics, tags };
}

function shares(rows: Row[], keyCol: string, valueCol: string, map: (k: string) => string) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = map(String(r[keyCol] ?? "").trim());
    if (!k) continue;
    out[k] = (out[k] ?? 0) + num(r[valueCol]) * 100;
  }
  return out;
}
const asOfMonth = (rows: Row[], fallback: string) => (day(rows[0]?.Data_As_Of) ?? fallback).slice(0, 7);

export interface WorkbookResult {
  sheets: string[];
  posts: Partial<Record<PlatformId, number>>;
  accountDays: number;
  audienceMonths: number;
  brandsAdded: string[];
}

export async function importWorkbook(db: DB, data: ArrayBuffer, now: string): Promise<WorkbookResult> {
  const buf = Buffer.from(data);
  const sheetNames = await readSheetNames(buf);
  const cache = new Map<string, Row[]>();
  for (const n of sheetNames) cache.set(n.toLowerCase(), toObjects((await readXlsxFile(buf, { sheet: n })) as unknown[][]));
  const sheet = (name: string) => cache.get(name.toLowerCase()) ?? null;
  const result: WorkbookResult = { sheets: sheetNames, posts: {}, accountDays: 0, audienceMonths: 0, brandsAdded: [] };
  const today = now.slice(0, 10);
  const audience: Partial<Record<PlatformId, RawAudienceSnapshot[]>> = {};
  const tagged: string[] = [];
  const postData: Partial<Record<PlatformId, ReturnType<typeof posts>>> = {};

  for (const [name, platform] of [["TikTok_Clips", "tiktok"], ["IG_Posts", "instagram"], ["YouTube_Videos", "youtube"]] as const) {
    const rows = sheet(name);
    if (rows) {
      postData[platform] = posts(platform, rows);
      tagged.push(...postData[platform]!.tags);
    }
  }

  // TikTok account-level daily + followers
  const daily = sheet("TikTok_Daily");
  const followersDaily = sheet("TikTok_Followers_Daily");
  const followersByDay = new Map<string, number>();
  for (const r of followersDaily ?? []) {
    const d = day(r.Date);
    if (d && r.Followers != null) followersByDay.set(d, num(r.Followers));
  }
  if (daily || followersDaily) {
    const days = new Set<string>([...(daily ?? []).map((r) => day(r.Date)).filter((d): d is string => !!d), ...followersByDay.keys()]);
    const byDay = new Map((daily ?? []).map((r) => [day(r.Date), r]));
    db.transaction((tx) => {
      for (const d of days) {
        const r = byDay.get(d);
        const values = {
          platformId: "tiktok",
          date: d,
          views: num(r?.Video_Views),
          profileViews: num(r?.Profile_Views),
          likes: num(r?.Likes),
          comments: num(r?.Comments),
          shares: num(r?.Shares),
          newFollowers: num(r?.New_Followers),
          lostFollowers: r?.Lost_Followers != null ? num(r.Lost_Followers) : null,
          followers: followersByDay.get(d) ?? (r?.Total_Followers != null ? num(r.Total_Followers) : null),
        };
        // Each file only updates what it contains: the audience file brings followers, the daily file brings views etc.
        const { platformId: _p, date: _d, followers: _f, ...metrics } = values;
        const set = { ...(r ? metrics : {}), followers: sql`coalesce(excluded.followers, ${accountDaily.followers})` };
        tx.insert(accountDaily).values(values).onConflictDoUpdate({ target: [accountDaily.platformId, accountDaily.date], set }).run();
      }
    });
    result.accountDays = days.size;
  }

  // TikTok audience: month-end followers, demographics on the "as of" month
  if (followersByDay.size) {
    const monthEnd = new Map<string, number>();
    for (const [d, f] of [...followersByDay].sort()) monthEnd.set(d.slice(0, 7), f);
    const gender = sheet("TikTok_Follower_Gender");
    const territories = sheet("TikTok_Follower_Territories");
    const demoMonth = asOfMonth(gender ?? territories ?? [], today);
    audience.tiktok = [...monthEnd].map(([month, followers]) => ({
      month,
      followers,
      age: {},
      gender: month === demoMonth && gender ? shares(gender, "Gender", "Share", (g) => (/^f/i.test(g) ? "female" : /^m/i.test(g) ? "male" : "other")) : {},
      country: month === demoMonth && territories ? shares(territories, "Territory_Code", "Share", (c) => (KNOWN.has(c.toUpperCase()) ? c.toUpperCase() : "other")) : {},
    }));
  }

  // Instagram audience (no follower count in the workbook: keeps any existing value)
  const igAge = sheet("IG_Audience_AgeGender");
  const igCountries = sheet("IG_Audience_Countries");
  if (igAge || igCountries) {
    const month = asOfMonth(igAge ?? igCountries ?? [], today);
    const existing = db.get<{ followers: number }>(sql`select followers from audience_snapshots where platform_id = 'instagram' and month = ${month}`);
    const ageRows = (igAge ?? []).filter((r) => r.Age_Group && !/total|รวม/i.test(String(r.Age_Group)));
    audience.instagram = [
      {
        month,
        followers: existing?.followers ?? 0,
        age: shares(ageRows, "Age_Group", "Total", (a) => (/^(45|55|65)/.test(a) ? "45+" : a)),
        gender: ageRows.length ? { male: ageRows.reduce((s, r) => s + num(r.Men), 0) * 100, female: ageRows.reduce((s, r) => s + num(r.Women), 0) * 100 } : {},
        country: shares(igCountries ?? [], "Country", "Share", (c) => {
          const code = COUNTRY_CODES[c.toLowerCase()];
          return code && KNOWN.has(code) ? code : "other";
        }),
      },
    ];
  }

  for (const platform of ["tiktok", "instagram", "youtube"] as const) {
    const p = postData[platform];
    const a = audience[platform];
    if (!p && !a) continue;
    const adapter: PlatformAdapter = {
      kind: "csv",
      platform,
      importContents: async () => p?.contents ?? [],
      importMetrics: async () => p?.metrics ?? [],
      importComments: async () => [],
      importAudience: async () => a ?? [],
    };
    const r = await ingest(db, adapter, now);
    if (r.status === "failed") throw new Error(`${platform}: ${r.message}`);
    if (p) result.posts[platform] = p.contents.length;
    result.audienceMonths += a?.length ?? 0;
  }

  // Brands tagged on Product posts → CRM brands (Lead until deals are added). Same brand across platforms merges.
  const names = new Map<string, string>();
  for (const t of tagged) if (!names.has(brandKey(t))) names.set(brandKey(t), t);
  const AUTO_NOTE = "เพิ่มอัตโนมัติจากบัญชีที่แท็กในโพสต์ Product";
  const existing = new Map(db.select().from(brands).all().map((b) => [brandKey(b.name), b]));
  for (const [key, name] of names) {
    const old = existing.get(key);
    // Prefer the display spelling ("CT Music Shop") over a handle ("ctmusicshop") for brands this import created.
    if (old && old.notes === AUTO_NOTE && /\s|[A-Z]/.test(name) && !/\s|[A-Z]/.test(old.name)) db.update(brands).set({ name }).where(eq(brands.id, old.id)).run();
    if (!key || old) continue;
    db.insert(brands).values({ name, category: "music", notes: AUTO_NOTE, createdAt: now }).run();
    result.brandsAdded.push(name);
  }
  return result;
}
