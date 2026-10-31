/**
 * Mock data source. Produces raw, platform-shaped records (exactly what an adapter
 * would return) for a generic lifestyle / product-review creator.
 *
 * Model
 * - Organic posts appear on random days in the last HISTORY_DAYS days.
 * - Sponsored posts are placed on the dates the CRM story says they went live.
 * - Each post has a total-view budget (log-normal) spread over days with exponential decay.
 * - Engagement and followers-per-view depend on platform × content type, so the
 *   "best content type" insight has a real answer in the data.
 * - Comments are generated as individual rows; the daily `comments` metric is the
 *   count of those rows, so the two always reconcile.
 */
import type { CommentCategory, ContentType, ProductCategory } from "@/db/schema";
import { addDays, addMonths, daysBetween, monthOf } from "@/lib/dates";
import type { Rng } from "@/lib/rng";
import type { PlatformId, RawAudienceSnapshot, RawComment, RawContent, RawMetricDaily } from "../PlatformAdapter";

export interface SponsoredSlot {
  dealId: number;
  brandName: string;
  category: ProductCategory;
  platform: PlatformId;
  postedOn: string; // YYYY-MM-DD
  dedicated: boolean;
}

export interface PlatformBundle {
  contents: RawContent[];
  metrics: RawMetricDaily[];
  comments: RawComment[];
  audience: RawAudienceSnapshot[];
  /** Category the generator *intended* for each comment — used only to report classifier agreement. */
  intended: CommentCategory[];
}

const P: Record<
  PlatformId,
  {
    postChance: number;
    medianViews: number;
    decay: number;
    likeRate: number;
    shareRate: number;
    saveRate: number;
    profileRate: number;
    commentRate: number;
    viewMult: Record<ContentType, number>;
    followersPer1k: Record<ContentType, number>;
    baseFollowers: number;
    monthlyGrowthBefore: number;
    hours: [number, number];
  }
> = {
  tiktok: {
    postChance: 0.52,
    medianViews: 36000,
    decay: 0.62,
    likeRate: 0.075,
    shareRate: 0.012,
    saveRate: 0.01,
    profileRate: 0.025,
    commentRate: 0.00045,
    viewMult: { review: 1.0, tutorial: 1.2, vlog: 0.8, bts: 0.9 },
    followersPer1k: { review: 3.4, tutorial: 6.6, vlog: 2.4, bts: 3.0 },
    baseFollowers: 168000,
    monthlyGrowthBefore: 0.035,
    hours: [18, 21],
  },
  instagram: {
    postChance: 0.38,
    medianViews: 13500,
    decay: 0.68,
    likeRate: 0.085,
    shareRate: 0.008,
    saveRate: 0.015,
    profileRate: 0.03,
    commentRate: 0.0009,
    viewMult: { review: 0.9, tutorial: 1.0, vlog: 1.0, bts: 1.15 },
    followersPer1k: { review: 3.2, tutorial: 4.1, vlog: 4.6, bts: 8.8 },
    baseFollowers: 61000,
    monthlyGrowthBefore: 0.02,
    hours: [11, 20],
  },
  youtube: {
    postChance: 0.22,
    medianViews: 15500,
    decay: 0.86,
    likeRate: 0.045,
    shareRate: 0.004,
    saveRate: 0.003,
    profileRate: 0.015,
    commentRate: 0.0016,
    viewMult: { review: 1.2, tutorial: 1.1, vlog: 0.8, bts: 0.6 },
    followersPer1k: { review: 11.5, tutorial: 9.6, vlog: 6.2, bts: 4.8 },
    baseFollowers: 38500,
    monthlyGrowthBefore: 0.03,
    hours: [17, 19],
  },
};

const TYPE_WEIGHTS: Record<PlatformId, Record<ContentType, number>> = {
  tiktok: { review: 40, tutorial: 25, vlog: 20, bts: 15 },
  instagram: { review: 30, tutorial: 20, vlog: 30, bts: 20 },
  youtube: { review: 50, tutorial: 25, vlog: 20, bts: 5 },
};
const CATEGORY_WEIGHTS: Record<ProductCategory, number> = { skincare: 28, tech: 24, food: 20, home: 16, fashion: 12 };

const PRODUCTS: Record<ProductCategory, string[]> = {
  skincare: ["เซรั่ม", "กันแดด", "คลีนซิ่ง", "มอยส์เจอไรเซอร์"],
  tech: ["หูฟัง", "พาวเวอร์แบงค์", "กล้องแอคชั่น", "คีย์บอร์ด"],
  food: ["กาแฟดริป", "กราโนล่า", "ซอสพริก", "ขนมคลีน"],
  home: ["เครื่องฟอกอากาศ", "เทียนหอม", "หมอนยางพารา", "ไม้ถูพื้น"],
  fashion: ["กระเป๋าผ้า", "รองเท้าผ้าใบ", "เสื้อลินิน", "แว่นกันแดด"],
};

const TITLES: Record<ContentType, string[]> = {
  review: ["รีวิว{p} ใช้จริง 2 สัปดาห์", "{p} ราคาไม่ถึงพัน คุ้มไหม?", "เทียบ{p} 3 แบรนด์", "{p}ที่ใช้ซ้ำมาทั้งปี"],
  tutorial: ["วิธีเลือก{p}ให้เหมาะกับคุณ", "ฮาวทูใช้{p}ให้คุ้ม", "5 ทริค{p}ที่ไม่มีใครบอก", "มือใหม่เริ่มใช้{p}ยังไงดี"],
  vlog: ["1 วันของครีเอเตอร์ + {p}ที่ใช้ทุกวัน", "Weekend vlog ช้อป{p}", "ทำงานที่บ้านกับ{p}ตัวใหม่", "Vlog จัดของ ได้{p}มาเพียบ"],
  bts: ["เบื้องหลังถ่ายรีวิว{p}", "จัดไฟถ่าย{p}ยังไง", "ไอเดียคอนเทนต์{p}ที่ไม่ได้ลง", "BTS: ถ่าย{p} 1 คลิปใช้กี่ชั่วโมง"],
};

const COMMENT_TEMPLATES: Record<CommentCategory, string[]> = {
  product_question: [
    "{p}ตัวนี้ซื้อที่ไหนคะ",
    "ราคาเท่าไหร่ครับ",
    "{p}ตัวนี้กี่บาทคะ",
    "ขอลิงก์{p}หน่อยค่ะ",
    "มีโค้ดส่วนลดไหมคะ",
    "รุ่นไหนคุ้มสุดครับ",
    "มีขายใน shopee ไหมคะ",
    "ของแท้ใช่ไหมคะ ซื้อร้านไหนดี",
  ],
  content_request: [
    "อยากให้รีวิว{p}ตัวอื่นด้วยค่ะ",
    "ทำคลิปเปรียบเทียบ{p}หน่อยครับ",
    "ขอคลิปแบบละเอียดกว่านี้ค่ะ",
    "ทำต่อเลยค่ะ รอดู",
    "ภาค 2 มาเร็วๆ นะ",
    "อยากดูรูทีนตอนเช้าค่ะ",
    "อยากให้ลองรีวิวของถูกบ้างครับ",
    "ขอฮาวทูแบบมือใหม่ค่ะ",
  ],
  general_question: [
    "ถ่ายด้วยกล้องอะไรคะ",
    "ตัดต่อด้วยแอปอะไรครับ",
    "เพลงในคลิปชื่ออะไรคะ",
    "ไปที่นี่มาเมื่อไหร่คะ",
    "ไลฟ์วันไหนคะ?",
    "ห้องนี้แต่งเองหรอคะ?",
    "ปกติตื่นกี่โมงคะ",
    "เสื้อที่ใส่ในคลิปสีอะไรคะ",
  ],
  praise: [
    "ชอบคลิปนี้มากค่ะ ❤️",
    "รีวิวละเอียดมาก ขอบคุณค่ะ",
    "ดูจบแล้วอยากได้เลย 555",
    "ตัดต่อเก่งมากครับ",
    "น่ารักมากกก",
    "เป็นกำลังใจให้นะคะ",
    "ดูเพลินมาก",
    "ภาพสวยมากครับ",
    "พูดตรงดีครับ ชอบ",
    "คลิปนี้ช่วยได้เยอะเลยค่ะ 🙏",
  ],
  spam: [
    "ติดตามกลับด้วยนะคะ 🙏",
    "รายได้เสริม วันละ 500 ทักไลน์",
    "f4f กันค่ะ",
    "ปั๊มยอดวิว ราคาถูก ดูที่โปรไฟล์",
    "เว็บตรง แตกง่าย https://spam.example",
    "รับสมัครงานออนไลน์ ทำที่บ้าน",
  ],
};

const CATEGORY_PQ: Record<ProductCategory, string[]> = {
  skincare: ["ใช้กับผิวแพ้ง่ายได้ไหมคะ", "ผิวมันใช้กับ{p}ตัวนี้ได้มั้ยคะ"],
  tech: ["แบตอยู่ได้กี่ชั่วโมงครับ", "ประกันศูนย์ไหมครับ", "ใช้กับ iPhone ได้ไหมครับ", "{p}รุ่นไหนดีกว่ากันครับ"],
  food: ["สั่งซื้อยังไงคะ", "ส่งต่างประเทศไหมคะ"],
  home: ["ใช้กับห้อง 30 ตรม. ได้ไหมคะ", "ราคาโปรตอนนี้เท่าไหร่คะ"],
  fashion: ["ไซซ์ M มีขายไหมคะ", "{p}ร้านไหนคะ"],
};

const AGE_BASE: Record<PlatformId, Record<string, number>> = {
  tiktok: { "13-17": 9, "18-24": 41, "25-34": 33, "35-44": 12, "45+": 5 },
  instagram: { "13-17": 4, "18-24": 30, "25-34": 42, "35-44": 17, "45+": 7 },
  youtube: { "13-17": 6, "18-24": 28, "25-34": 38, "35-44": 19, "45+": 9 },
};
const GENDER_BASE: Record<PlatformId, Record<string, number>> = {
  tiktok: { female: 66, male: 32, other: 2 },
  instagram: { female: 72, male: 26, other: 2 },
  youtube: { female: 55, male: 43, other: 2 },
};
const COUNTRY_BASE = { TH: 91, LA: 3, MY: 2, US: 1.5, other: 2.5 };

function normalize(rec: Record<string, number>): Record<string, number> {
  const total = Object.values(rec).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, Math.round((v / total) * 1000) / 10]));
}

export interface GenerateOptions {
  rng: Rng;
  storyDate: string;
  historyDays: number;
  sponsored: SponsoredSlot[];
  /** Product category whose product questions surge in the last 7 days. */
  spikeCategory: ProductCategory;
}

interface Post {
  raw: RawContent;
  platform: PlatformId;
  totalViews: number;
}

export function generateMockData(opts: GenerateOptions): Record<PlatformId, PlatformBundle> {
  const { rng, storyDate, historyDays, sponsored, spikeCategory } = opts;
  const windowStart = addDays(storyDate, -(historyDays - 1));
  const spikeStart = addDays(storyDate, -6);
  const platformsList: PlatformId[] = ["tiktok", "instagram", "youtube"];
  const out = Object.fromEntries(
    platformsList.map((p) => [p, { contents: [], metrics: [], comments: [], audience: [], intended: [] } as PlatformBundle]),
  ) as Record<PlatformId, PlatformBundle>;

  const posts: Post[] = [];
  const counters: Record<PlatformId, number> = { tiktok: 0, instagram: 0, youtube: 0 };
  const extId = (p: PlatformId) => {
    counters[p]++;
    const prefix = { tiktok: "tt", instagram: "ig", youtube: "yt" }[p];
    return `${prefix}_${String(counters[p]).padStart(4, "0")}`;
  };
  const postTime = (p: PlatformId, day: string) => {
    const [h0, h1] = P[p].hours;
    return `${day}T${String(rng.int(h0, h1)).padStart(2, "0")}:${String(rng.pick([0, 15, 30, 45])).padStart(2, "0")}:00`;
  };
  const makePost = (p: PlatformId, day: string, type: ContentType, cat: ProductCategory, sponsoredSlot?: SponsoredSlot) => {
    const product = rng.pick(PRODUCTS[cat]);
    const title = sponsoredSlot
      ? `${sponsoredSlot.brandName} × ${rng.pick(TITLES[type]).replace("{p}", product)}`
      : rng.pick(TITLES[type]).replace("{p}", product);
    const mult = P[p].viewMult[type] * (sponsoredSlot ? 0.92 : 1) * (sponsoredSlot?.dedicated ? 1.15 : 1);
    posts.push({
      platform: p,
      totalViews: Math.round(rng.lognormal(P[p].medianViews * mult, 0.55)),
      raw: {
        externalId: extId(p),
        title,
        type,
        productCategory: cat,
        postedAt: postTime(p, day),
        isSponsored: !!sponsoredSlot,
        dealId: sponsoredSlot?.dealId ?? null,
      },
    });
  };

  // Organic schedule
  for (const day of daysBetween(windowStart, storyDate)) {
    for (const p of platformsList) {
      if (rng.chance(P[p].postChance)) {
        makePost(p, day, rng.weighted(TYPE_WEIGHTS[p]), rng.weighted(CATEGORY_WEIGHTS));
      }
    }
  }
  // Story: two fresh tech reviews in the spike week to carry the product-question surge.
  makePost("tiktok", addDays(storyDate, -5), "review", spikeCategory);
  makePost("youtube", addDays(storyDate, -3), "review", spikeCategory);

  // Sponsored posts on their CRM dates
  for (const s of sponsored) {
    const type: ContentType = s.dedicated ? "review" : rng.chance(0.7) ? "review" : "tutorial";
    makePost(s.platform, s.postedOn, type, s.category, s);
  }

  // Authors: a pool of fans with a heavy-tailed activity distribution, plus spam accounts.
  const fanPool = Array.from({ length: 1400 }, (_, i) => `fan_${(i * 7919 + 13).toString(36)}`);
  const spamPool = Array.from({ length: 40 }, (_, i) => `promo_${(i * 104729 + 7).toString(36)}`);
  const pickFan = () => fanPool[Math.floor(Math.pow(rng.next(), 1.8) * fanPool.length)];

  const dailyFollowers: Record<PlatformId, Map<string, number>> = { tiktok: new Map(), instagram: new Map(), youtube: new Map() };

  for (const post of posts) {
    const p = post.platform;
    const cfg = P[p];
    const c = post.raw;
    const posted = c.postedAt.slice(0, 10);
    // Posts older than the window (old sponsored work) keep their first 30 days only.
    const horizon = posted < windowStart ? 30 : 60;
    const lastDay = [addDays(posted, horizon - 1), storyDate].sort()[0];
    const days = daysBetween(posted, lastDay);
    const weights = Array.from({ length: horizon }, (_, k) => Math.pow(cfg.decay, k) + 0.002);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const saveMult = c.type === "tutorial" ? 2 : 1;
    const fpk = cfg.followersPer1k[c.type] * (c.isSponsored ? 0.85 : 1);
    const jitter = () => rng.float(0.85, 1.15);

    const viewsByDay = days.map((_, k) => Math.round((post.totalViews * weights[k]) / wSum));
    const commentsByDay = new Array(days.length).fill(0) as number[];

    // Comment rows
    const totalComments = Math.round(post.totalViews * cfg.commentRate * (c.isSponsored ? 1.3 : 1) * rng.float(0.7, 1.3));
    const pqBase = c.type === "review" || c.type === "tutorial" ? 22 : 7;
    for (let k = 0; k < days.length; k++) {
      const day = days[k];
      const inSpike = c.productCategory === spikeCategory && day >= spikeStart;
      const share = viewsByDay[k] / Math.max(1, post.totalViews);
      const expected = totalComments * share * (inSpike ? 1.5 : 1);
      let n = Math.floor(expected) + (rng.next() < expected % 1 ? 1 : 0);
      if (n > 0 && day === storyDate) n = Math.max(1, Math.round(n * 0.6)); // today is only partly over
      for (let j = 0; j < n; j++) {
        const weights: Record<CommentCategory, number> = {
          product_question: (pqBase + (c.isSponsored ? 6 : 0)) * (inSpike ? 2.6 : 1),
          content_request: 12,
          general_question: 12,
          praise: 48,
          spam: 9,
        };
        const cat = rng.weighted(weights);
        let tmpl = rng.pick(COMMENT_TEMPLATES[cat]);
        if (cat === "product_question" && rng.chance(0.4)) tmpl = rng.pick(CATEGORY_PQ[c.productCategory]);
        const text = tmpl.replace("{p}", rng.pick(PRODUCTS[c.productCategory]));
        const hh = String(rng.int(day === storyDate ? 0 : 7, day === storyDate ? 9 : 23)).padStart(2, "0");
        const mm = String(rng.int(0, 59)).padStart(2, "0");
        const ss = String(rng.int(0, 59)).padStart(2, "0");
        out[p].comments.push({
          contentExternalId: c.externalId,
          authorHandle: cat === "spam" ? rng.pick(spamPool) : pickFan(),
          text,
          createdAt: `${day}T${hh}:${mm}:${ss}`,
        });
        out[p].intended.push(cat);
        commentsByDay[k]++;
      }
    }

    days.forEach((day, k) => {
      const v = viewsByDay[k];
      if (v <= 0 && commentsByDay[k] === 0) return;
      const nf = Math.round((v * fpk) / 1000 * jitter());
      out[p].metrics.push({
        contentExternalId: c.externalId,
        date: day,
        views: v,
        likes: Math.round(v * cfg.likeRate * jitter()),
        comments: commentsByDay[k],
        shares: Math.round(v * cfg.shareRate * jitter()),
        saves: Math.round(v * cfg.saveRate * saveMult * jitter()),
        profileViews: Math.round(v * cfg.profileRate * jitter()),
        newFollowers: nf,
      });
      dailyFollowers[p].set(day, (dailyFollowers[p].get(day) ?? 0) + nf);
    });
    out[p].contents.push(c);
  }

  // Audience: 18 monthly snapshots. In-window months are base + accumulated new followers
  // (so they reconcile with metrics); earlier months are back-projected from platform growth.
  const storyMonth = monthOf(storyDate);
  const firstWindowMonth = monthOf(windowStart);
  for (const p of platformsList) {
    const cfg = P[p];
    const months = Array.from({ length: 18 }, (_, i) => addMonths(storyMonth, i - 17));
    let running = cfg.baseFollowers;
    const followersAt = new Map<string, number>();
    for (const day of daysBetween(windowStart, storyDate)) {
      running += dailyFollowers[p].get(day) ?? 0;
      followersAt.set(monthOf(day), running);
    }
    const beforeMonths = months.filter((m) => m < firstWindowMonth);
    let back = cfg.baseFollowers;
    for (let i = beforeMonths.length - 1; i >= 0; i--) {
      followersAt.set(beforeMonths[i], back);
      back = Math.round(back / (1 + cfg.monthlyGrowthBefore));
    }
    months.forEach((m, i) => {
      const drift = (i - 17) * 0.3; // audience slowly matures toward 25-34
      const age = normalize({
        ...AGE_BASE[p],
        "18-24": AGE_BASE[p]["18-24"] - drift * 0.6 + rng.float(-0.5, 0.5),
        "25-34": AGE_BASE[p]["25-34"] + drift + rng.float(-0.5, 0.5),
      });
      out[p].audience.push({
        month: m,
        followers: followersAt.get(m)!,
        age,
        gender: normalize(Object.fromEntries(Object.entries(GENDER_BASE[p]).map(([k, v]) => [k, v + rng.float(-0.4, 0.4)]))),
        country: normalize(Object.fromEntries(Object.entries(COUNTRY_BASE).map(([k, v]) => [k, v + rng.float(-0.2, 0.2)]))),
      });
    });
  }

  return out;
}
