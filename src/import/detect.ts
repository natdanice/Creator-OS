/**
 * Built-in recogniser (offline, free, instant). Works out what a table is from its column names
 * (English, Thai, platform export names and the creator's own workbook names), checks that the
 * values look right, and guesses the platform from the file name, links and platform-only columns.
 * Anything it isn't sure about is left for the AI step or for the creator to confirm.
 */
import { toDateTime, toNumber } from "./values";
import { PLATFORM_KINDS, type Confidence, type Detection, type Kind, type MappedKind, type PlatformId, type Table } from "./types";

/** Lowercase letters, digits and Thai vowel/tone marks only: "Video views" → "videoviews", "Posted_Date" → "posteddate". */
export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "");

/** Column names per field, per kind (normalised). The first match wins; each column is used once. */
const SYN: Record<MappedKind, Record<string, string[]>> = {
  posts: {
    id: ["videoid", "postid", "contentid", "mediaid", "content", "id", "clipid"],
    title: ["videotitle", "title", "clipname", "posttitle", "description", "caption", "captionfull", "text", "ชื่อคลิป", "แคปชัน", "คำบรรยาย"],
    postedAt: ["posttime", "publishtime", "videopublishtime", "publishedat", "publishdate", "published", "publishedon", "posteddate", "postdate", "posted", "postedon", "dateposted", "createtime", "createdtime", "createdat", "uploaddate", "uploaded", "timestamp", "วันที่โพสต์", "เวลาโพสต์", "วันที่ลง"],
    postedTime: ["postedtime", "publishtimeofday"],
    date: ["date", "day", "วันที่"],
    views: ["views", "videoviews", "totalviews", "plays", "videoplays", "totalplay", "ยอดวิว", "การดู", "จำนวนการดู"],
    likes: ["likes", "totallikes", "like", "reactions", "ถูกใจ", "ไลก์", "ยอดไลก์"],
    comments: ["comments", "totalcomments", "commentsadded", "คอมเมนต์", "ความคิดเห็น"],
    shares: ["shares", "totalshares", "share", "แชร์", "การแชร์"],
    saves: ["saves", "saved", "addtofavorites", "favorites", "addedtoplaylists", "totalsaves", "บันทึก"],
    profileViews: ["profileviews", "profilevisits", "channelpageviews"],
    newFollowers: ["newfollowers", "follows", "subscribersgained", "followersgained", "ผู้ติดตามใหม่"],
    link: ["permalink", "link", "url", "videolink", "postlink"],
    type: ["contenttype", "type", "ประเภท"],
    category: ["productcategory", "category", "หมวด", "หมวดหมู่"],
    sponsored: ["sponsored", "issponsored", "paidpartnership", "brandedcontent", "สปอนเซอร์"],
  },
  comments: {
    postId: ["contentid", "videoid", "postid", "mediaid", "content"],
    author: ["username", "user", "author", "handle", "commenter", "from", "name", "ผู้ใช้", "ชื่อผู้ใช้"],
    text: ["comment", "commenttext", "text", "message", "content", "ข้อความ", "คอมเมนต์", "ความคิดเห็น"],
    time: ["time", "createdat", "createtime", "date", "timestamp", "commenttime", "เวลา", "วันที่"],
  },
  account_daily: {
    date: ["date", "day", "วันที่"],
    views: ["videoviews", "views", "totalviews", "plays", "ยอดวิว"],
    profileViews: ["profileviews", "profilevisits", "channelpageviews"],
    likes: ["likes", "totallikes"],
    comments: ["comments", "totalcomments"],
    shares: ["shares", "totalshares"],
    newFollowers: ["newfollowers", "follows", "followersgained", "subscribersgained", "ผู้ติดตามใหม่"],
    lostFollowers: ["lostfollowers", "unfollows", "subscriberslost"],
    followers: ["totalfollowers", "followers", "followercount", "subscribers", "ผู้ติดตาม", "ผู้ติดตามทั้งหมด"],
  },
  audience_age: {
    key: ["agegroup", "age", "agerange", "ages", "ช่วงอายุ", "อายุ"],
    share: ["share", "percentage", "percent", "distribution", "total", "value", "followers", "สัดส่วน"],
    men: ["men", "male", "ชาย"],
    women: ["women", "female", "หญิง"],
  },
  audience_gender: {
    key: ["gender", "sex", "เพศ"],
    share: ["share", "percentage", "percent", "distribution", "value", "followers", "สัดส่วน"],
  },
  audience_country: {
    key: ["country", "territory", "territorycode", "countrycode", "location", "region", "ประเทศ"],
    share: ["share", "percentage", "percent", "distribution", "value", "followers", "สัดส่วน"],
  },
  brands_deals: {
    brand: ["brand", "brandname", "company", "client", "customer", "แบรนด์", "ลูกค้า"],
    category: ["category", "industry", "หมวด"],
    website: ["website", "web", "site"],
    contact_name: ["contactname", "contact", "ผู้ติดต่อ"],
    contact_role: ["contactrole", "role", "position", "ตำแหน่ง"],
    contact_channel: ["contactchannel", "channel", "ช่องทาง"],
    contact_handle: ["contacthandle", "email", "lineid", "line", "phone", "อีเมล"],
    deal_title: ["dealtitle", "deal", "project", "campaign", "job", "งาน", "แคมเปญ"],
    stage: ["stage", "status", "สถานะ"],
    value: ["value", "amount", "budget", "price", "fee", "rate", "ราคา", "ค่าจ้าง", "มูลค่า", "งบ"],
    deliverables: ["deliverables", "package", "แพ็กเกจ"],
    created_date: ["createddate", "created", "startdate", "briefdate", "วันที่เริ่ม"],
    posted_date: ["posteddate", "postdate", "publishdate", "วันที่โพสต์"],
    paid_date: ["paiddate", "paymentdate", "วันที่จ่าย", "วันที่ได้รับเงิน"],
    invoice_no: ["invoiceno", "invoice", "invoicenumber", "เลขที่ใบแจ้งหนี้"],
  },
};

/** Column names in the creator's own workbook (Content_ID, Clip_Name, Video_Views, …), added as synonyms. */
const WORKBOOK: Partial<Record<MappedKind, Record<string, string[]>>> = {
  posts: { title: ["clipname", "captionfull"], postedTime: ["postedtime"], type: ["contenttype"] },
  account_daily: { views: ["videoviews"], followers: ["totalfollowers"] },
};

function synonyms(kind: MappedKind, field: string): string[] {
  return [...(SYN[kind][field] ?? []), ...(WORKBOOK[kind]?.[field] ?? [])].map(norm);
}

/** field → column for one kind. Exact name first; then a column that contains a long synonym. */
export function mapColumns(kind: MappedKind, headers: string[]): Record<string, string> {
  const free = new Map(headers.map((h) => [h, norm(h)]));
  const out: Record<string, string> = {};
  const take = (field: string, h: string) => {
    out[field] = h;
    free.delete(h);
  };
  for (const pass of ["exact", "contains"] as const) {
    for (const field of Object.keys(SYN[kind])) {
      if (out[field]) continue;
      for (const s of synonyms(kind, field)) {
        const hit = [...free].find(([, n]) => (pass === "exact" ? n === s || n === `total${s}` : s.length >= 5 && n.includes(s)));
        if (hit) {
          take(field, hit[0]);
          break;
        }
      }
    }
  }
  return out;
}

const share = (t: Table, col: string | undefined, ok: (v: Table["rows"][number][string]) => boolean) => {
  if (!col) return 0;
  const vals = t.rows.map((r) => r[col]).filter((v) => v !== null);
  return vals.length ? vals.filter(ok).length / vals.length : 0;
};
const numeric = (t: Table, col?: string) => share(t, col, (v) => toNumber(v) !== null) >= 0.7;
const dated = (t: Table, col?: string) => share(t, col, (v) => toDateTime(v) !== null) >= 0.7;

/** Does this mapping make sense as `kind`? Returns a score (0 = no). */
function score(kind: MappedKind, t: Table, m: Record<string, string>): number {
  const n = Object.keys(m).length;
  switch (kind) {
    case "brands_deals":
      return m.brand && (m.deal_title || m.value || m.stage) ? 10 + n : 0;
    case "comments":
      return m.text && (m.author || m.postId) && !SYN.posts.views.some((s) => t.headers.some((h) => norm(h) === norm(s))) ? 9 + n : 0;
    case "audience_age":
    case "audience_gender":
    case "audience_country":
      return m.key && (m.share || (m.men && m.women)) && t.rows.length <= 300 ? 8 + n : 0;
    case "posts":
      return m.views && numeric(t, m.views) && (m.id || m.title || m.link) && (dated(t, m.postedAt) || dated(t, m.date)) ? 6 + n : 0;
    case "account_daily": {
      const metric = m.views || m.followers || m.newFollowers || m.profileViews;
      const perPost = t.headers.some((h) => [...SYN.posts.id, ...SYN.posts.title].map(norm).includes(norm(h)));
      return m.date && dated(t, m.date) && metric && !perPost ? 5 + n : 0;
    }
  }
}

/* ── Platform ── */

const NAME_HINTS: [PlatformId, RegExp][] = [
  ["tiktok", /tik\s*tok|(^|[^a-z])tt([^a-z]|$)|douyin/i],
  ["instagram", /instagram|insta|(^|[^a-z])ig([^a-z]|$)|reels?/i],
  ["youtube", /you\s*tube|(^|[^a-z])yt([^a-z]|$)|shorts/i],
];
const LINK_HINTS: [PlatformId, RegExp][] = [
  ["tiktok", /tiktok\.com/i],
  ["instagram", /instagram\.com/i],
  ["youtube", /youtube\.com|youtu\.be/i],
];
const HEADER_HINTS: [PlatformId, string[]][] = [
  ["tiktok", ["addtofavorites", "videoviews", "totalplay"]],
  ["instagram", ["reach", "accountusername", "profilevisits", "follows"]],
  ["youtube", ["subscribersgained", "subscriberslost", "channelpageviews", "watchtimehours", "addedtoplaylists", "commentsadded"]],
];

export function guessPlatform(t: Table): { platform: PlatformId | null; why: string } {
  const votes: Record<PlatformId, number> = { tiktok: 0, instagram: 0, youtube: 0 };
  const why: string[] = [];
  const names = `${t.file} ${t.sheet ?? ""}`;
  for (const [p, re] of NAME_HINTS)
    if (re.test(names)) {
      votes[p] += 3;
      why.push(`name says ${p}`);
    }
  const sample = JSON.stringify(t.rows.slice(0, 20));
  for (const [p, re] of LINK_HINTS)
    if (re.test(sample)) {
      votes[p] += 3;
      why.push(`${p} links`);
    }
  const hs = t.headers.map(norm);
  for (const [p, cols] of HEADER_HINTS)
    if (cols.some((c) => hs.includes(c))) {
      votes[p] += 1;
      why.push(`${p}-style columns`);
    }
  const ranked = (Object.entries(votes) as [PlatformId, number][]).sort((a, b) => b[1] - a[1]);
  if (!ranked[0][1] || ranked[0][1] === ranked[1][1]) return { platform: null, why: "platform not clear" };
  return { platform: ranked[0][0], why: why.join(", ") };
}

const KIND_ORDER: MappedKind[] = ["brands_deals", "comments", "audience_age", "audience_gender", "audience_country", "posts", "account_daily"];

/** The built-in recogniser's answer for one table. */
export function detectByRules(t: Table): Detection {
  let best: { kind: MappedKind; mapping: Record<string, string>; s: number } | null = null;
  for (const kind of KIND_ORDER) {
    const mapping = mapColumns(kind, t.headers);
    const s = score(kind, t, mapping);
    if (s && (!best || s > best.s)) best = { kind, mapping, s };
  }
  if (!best) return { kind: "unknown", platform: null, mapping: {}, confidence: "low", by: "rules", reason: "Column names didn't match anything known" };
  const needsPlatform = PLATFORM_KINDS.has(best.kind);
  const { platform, why } = needsPlatform ? guessPlatform(t) : { platform: null, why: "" };
  const confidence: Confidence = needsPlatform && !platform ? "medium" : "high";
  const cols = Object.entries(best.mapping)
    .map(([f, c]) => `${f} ← ${c}`)
    .join(", ");
  return { kind: best.kind, platform, mapping: best.mapping, confidence, by: "rules", reason: [why, cols].filter(Boolean).join(" · ") };
}

/** Re-map a table for a kind the creator picked (keeps the platform they chose). */
export function detectAs(t: Table, kind: Kind, platform: PlatformId | null): Detection {
  if (kind === "unknown" || kind === "creator_workbook") return { kind, platform, mapping: {}, confidence: "high", by: "you", reason: "" };
  return { kind, platform, mapping: mapColumns(kind, t.headers), confidence: "high", by: "you", reason: "Chosen by you" };
}

/** Sheets of the creator's own workbook, which has its own importer (keeps brand tags etc.). */
export const WORKBOOK_SHEETS = ["tiktok_clips", "ig_posts", "youtube_videos", "tiktok_daily", "tiktok_followers_daily", "tiktok_follower_gender", "tiktok_follower_territories", "ig_audience_agegender", "ig_audience_countries"];
export const isWorkbookSheet = (sheet: string | null) => !!sheet && WORKBOOK_SHEETS.includes(sheet.toLowerCase());
