import type { BriefSignal } from "@/db/schema";

/**
 * Spots a new job brief in an inbound brand message and pulls out what it can
 * (budget, platforms, timing, product). Same swap pattern as the comment
 * classifier: `KeywordBriefDetector` today, an LLM-backed detector later.
 */
export interface BriefDetector {
  readonly name: string;
  detect(text: string): BriefSignal | null;
}

/** A message is a brief when it shows intent to hire AND at least one concrete job detail. */
const INTENT = [/บรีฟ/, /แคมเปญ/, /ร่วมงาน/, /จ้าง/, /อยากได้(คลิป|คอนเทนต์|รีวิว)/, /สนใจให้(รีวิว|ทำ)/, /เสนองาน/, /สอบถามเรท/, /brief/i, /campaign/i, /collab/i, /sponsor/i];

const PLATFORM_PATTERNS: [BriefSignal["platforms"][number], RegExp][] = [
  ["tiktok", /tiktok|ติ๊กต็อก/i],
  ["instagram", /\big\b|instagram|reel|อินสตา|สตอรี่/i],
  ["youtube", /youtube|ยูทูป|ยูทูบ/i],
];

const TIMING = /(ต้น|กลาง|ปลาย)เดือน\S+|ภายใน(วันที่\s?)?\S+|ก่อน(วันที่\s?)?\d+[^\s]*|\d{1,2}\.\d{1,2}|(สัปดาห์|อาทิตย์)หน้า|เดือนหน้า|ไตรมาส\s?\d/;

// "รุ่นใหม่ Kumo Air 2" → "Kumo Air 2"; "รีวิวหมอนยางพารา" → "หมอนยางพารา"
const PRODUCT = /(?:สินค้า|รุ่นใหม่|ตัวใหม่|รสใหม่|รีวิว)\s*([^\s,]+(?:\s[A-Za-z0-9]+)*)/;

const MULTIPLIER: Record<string, number> = { k: 1_000, K: 1_000, พัน: 1_000, หมื่น: 10_000, แสน: 100_000 };

export function parseBudget(text: string): number | null {
  const m = text.match(/(?:งบ(?:ประมาณ)?|budget|ราคา(?:ที่)?(?:ตั้งไว้)?)\D{0,12}?([\d][\d,.]*)\s*(k|K|พัน|หมื่น|แสน)?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  const value = n * (m[2] ? MULTIPLIER[m[2]] : 1);
  return value >= 1_000 ? Math.round(value) : null;
}

export class KeywordBriefDetector implements BriefDetector {
  readonly name = "keyword-brief-v1";

  detect(text: string): BriefSignal | null {
    if (!INTENT.some((p) => p.test(text))) return null;
    const budget = parseBudget(text);
    const platforms = PLATFORM_PATTERNS.filter(([, re]) => re.test(text)).map(([p]) => p);
    const timing = text.match(TIMING)?.[0]?.replace(/(ค่ะ|ครับ|คะ|นะ)+$/, "") ?? null;
    const product =
      text
        .match(PRODUCT)?.[1]
        ?.replace(/\s*\b(IG|TikTok|YouTube|Reel|Instagram)\b.*$/i, "")
        .replace(/(ลง|บน)$/, "")
        .trim() || null;
    if (budget === null && platforms.length === 0 && !timing) return null;
    return { budget, platforms, timing, product };
  }
}

export function getBriefDetector(): BriefDetector {
  return new KeywordBriefDetector();
}

/** Rate-card codes a brief most likely needs, from the platforms it mentions. */
export function guessDeliverables(platforms: BriefSignal["platforms"]): string[] {
  if (platforms.length === 3) return ["BUNDLE_3P"];
  const code = { tiktok: "TT_VIDEO", instagram: "IG_REEL", youtube: "YT_INTEGRATION" } as const;
  return platforms.length ? platforms.map((p) => code[p]) : ["TT_VIDEO"];
}
