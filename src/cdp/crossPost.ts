/**
 * Cross-post matching: the same video posted on several platforms becomes one "content group".
 *
 * Creators usually post one video everywhere within a day or two, with a slightly different
 * caption per platform (e.g. Instagram first with a long caption, TikTok later with a short label).
 * Two posts on different platforms are the same piece of content when
 *   1. they were made in one Publisher job (certain), or
 *   2. they went up within MAX_GAP_HOURS of each other AND their captions overlap enough.
 * A group holds at most one post per platform. Best matches are taken first (greedy).
 *
 * Caption overlap = shared character pairs ÷ the shorter caption's pairs, after dropping
 * @ and # signs, emoji, punctuation and spaces. Character pairs work for Thai, which has no spaces
 * between words, and "shorter" lets a short label match a long caption that contains it.
 * Each pair is weighted by how rare it is across all posts, so a recurring series template
 * ("ถ้าเพลง #… เป็น Funk", "… ราคาไม่ถึงพัน คุ้มไหม?") counts little and the song or product name counts a lot.
 *
 * Overlap alone can't tell "same video, different caption" from "same series, different video",
 * so a match also needs something specific in common: at least MIN_RARE_SHARED character pairs that
 * appear in only a few posts overall (a song name, a product model, "ร้านกาแฟ"). Captions that are
 * identical, or almost the same (NEAR_SAME) and posted within CLOSE_HOURS, match without that.
 */
import { isNotNull } from "drizzle-orm";
import type { DB } from "@/db/client";
import { contents, publications } from "@/db/schema";

export const MAX_GAP_HOURS = 72;
/** Overlap needed when the posts are within a day and a half, and when they're further apart. */
const MIN_SIM_CLOSE = 0.35;
const CLOSE_HOURS = 36;
const MIN_SIM = 0.8;
/** Shared "rare" character pairs needed (a 4-letter word = 3 pairs). Rare = found in at most RARE_MAX posts. */
const MIN_RARE_SHARED = 3;
const RARE_MAX = 4;
const NEAR_SAME = 0.85;

export interface PostRef {
  id: number;
  platformId: string;
  title: string;
  postedAt: string; // YYYY-MM-DDTHH:mm:ss
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    // Mentions keep their text: "@ctmusicshop" on Instagram should match "CT Music Shop" on TikTok.
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ""); // drop @, #, emoji, punctuation, spaces (keeps Thai vowel/tone marks)
}

function bigrams(text: string): Set<string> {
  const s = normalize(text);
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

type Weight = (bigram: string) => number;

/** 0–1: how much of the shorter caption appears in the longer one (optionally weighted by rarity). */
export function captionOverlap(a: string, b: string, weight: Weight = () => 1): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size < 2 || B.size < 2) return 0;
  const total = (S: Set<string>) => [...S].reduce((n, x) => n + weight(x), 0);
  let shared = 0;
  for (const x of A) if (B.has(x)) shared += weight(x);
  return shared / Math.min(total(A), total(B));
}

/** Rarity weight per character pair: ln(1 + posts ÷ posts containing it). Never 0, so short corpora still work. */
function documentFrequency(titles: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of titles) for (const x of bigrams(t)) df.set(x, (df.get(x) ?? 0) + 1);
  return df;
}

export function rarity(titles: string[], df = documentFrequency(titles)): Weight {
  const n = titles.length;
  return (x) => Math.log(1 + n / (df.get(x) ?? 1));
}

/** How many character pairs both captions share that are rare across all posts. */
export function rareShared(a: string, b: string, df: Map<string, number>, rareMax: number): number {
  const B = bigrams(b);
  let n = 0;
  for (const x of bigrams(a)) if (B.has(x) && (df.get(x) ?? 0) <= rareMax) n++;
  return n;
}

const hoursApart = (a: string, b: string) => Math.abs(Date.parse(`${a}Z`) - Date.parse(`${b}Z`)) / 3_600_000;

/**
 * Groups posts into pieces of content. Every post appears in exactly one group (alone if it has no twin).
 * `sameJob` = pairs known to be one piece (Publisher jobs).
 */
export function groupCrossPosts(posts: PostRef[], sameJob: [number, number][] = []): number[][] {
  const groupOf = new Map<number, number[]>(posts.map((p) => [p.id, [p.id]]));
  const platformOf = new Map(posts.map((p) => [p.id, p.platformId]));
  const join = (a: number, b: number) => {
    const ga = groupOf.get(a);
    const gb = groupOf.get(b);
    if (!ga || !gb || ga === gb) return;
    const platforms = new Set(ga.map((id) => platformOf.get(id)));
    if (gb.some((id) => platforms.has(platformOf.get(id)))) return; // one post per platform
    ga.push(...gb);
    for (const id of gb) groupOf.set(id, ga);
  };

  for (const [a, b] of sameJob) join(a, b);
  const titles = posts.map((p) => p.title);
  const df = documentFrequency(titles);
  const weight = rarity(titles, df);

  const sorted = [...posts].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  const candidates: { a: number; b: number; sim: number; gap: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const gap = hoursApart(a.postedAt, b.postedAt);
      if (gap > MAX_GAP_HOURS) break; // sorted by time: nothing later can be closer
      if (a.platformId === b.platformId) continue;
      const sim = captionOverlap(a.title, b.title, weight);
      if (sim < (gap <= CLOSE_HOURS ? MIN_SIM_CLOSE : MIN_SIM)) continue;
      const sameText = normalize(a.title) === normalize(b.title) || (sim >= NEAR_SAME && gap <= CLOSE_HOURS);
      if (sameText || rareShared(a.title, b.title, df, RARE_MAX) >= MIN_RARE_SHARED) candidates.push({ a: a.id, b: b.id, sim, gap });
    }
  }
  candidates.sort((x, y) => y.sim - x.sim || x.gap - y.gap);
  for (const c of candidates) join(c.a, c.b);

  return [...new Set(groupOf.values())];
}

/** All posts in the database, grouped. */
export function contentGroups(db: DB): number[][] {
  const posts = db.select({ id: contents.id, platformId: contents.platformId, title: contents.title, postedAt: contents.postedAt }).from(contents).all();
  const pubs = db.select({ jobId: publications.jobId, contentId: publications.contentId }).from(publications).where(isNotNull(publications.contentId)).all();
  const byJob = new Map<number, number[]>();
  for (const p of pubs) byJob.set(p.jobId, [...(byJob.get(p.jobId) ?? []), p.contentId!]);
  const sameJob = [...byJob.values()].flatMap((ids) => ids.slice(1).map((id) => [ids[0], id] as [number, number]));
  return groupCrossPosts(posts, sameJob);
}
