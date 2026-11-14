/**
 * Per-platform limits, validation and final-caption assembly. Pure functions —
 * the composer runs them live in the browser and the server re-runs them before publishing.
 *
 * NOTE: limits are prototype values; confirm against each platform's current
 * documentation before connecting real APIs.
 */
import type { ComposeDraft, MediaInfo, PlatformId, PlatformOptionsMap } from "./types";

export const LIMITS = {
  tiktok: { caption: 2200, maxVideoSec: 600 },
  instagram: { caption: 2200, hashtags: 30, reelMaxSec: 180, storyMaxSec: 60, feedMaxSec: 3600 },
  youtube: { title: 100, description: 5000, tags: 500, hashtags: 15, shortMaxSec: 180 },
} as const;

export type IssueCode =
  | "captionTooLong"
  | "tooManyHashtags"
  | "ytHashtagsIgnored"
  | "titleRequired"
  | "titleTooLong"
  | "titleInvalidChars"
  | "tagsTooLong"
  | "imageNotSupported"
  | "videoTooLong"
  | "shortsNotVertical"
  | "storyCaptionHidden"
  | "brandedPrivate"
  | "scheduleInPast";

export interface Issue {
  level: "error" | "warning";
  code: IssueCode;
  vars?: Record<string, string | number>;
}

export function countHashtags(text: string): number {
  return (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Disclosure options are forced on for sponsored posts. */
export function effectiveOptions<P extends PlatformId>(draft: ComposeDraft, platform: P): PlatformOptionsMap[P] {
  const o = { ...draft.platforms[platform].options } as PlatformOptionsMap[PlatformId];
  if (draft.sponsored) {
    if (platform === "tiktok") (o as PlatformOptionsMap["tiktok"]).brandedContent = true;
    if (platform === "instagram") (o as PlatformOptionsMap["instagram"]).paidPartnership = true;
    if (platform === "youtube") (o as PlatformOptionsMap["youtube"]).paidPromotion = true;
  }
  return o as PlatformOptionsMap[P];
}

/** Caption as it will be posted (YouTube: the description). */
export function finalCaption(draft: ComposeDraft, platform: PlatformId): string {
  const body = (draft.platforms[platform].customCaption ?? draft.caption).trim();
  let tags = draft.hashtags.trim();
  if (draft.sponsored && draft.addAdTag && !/(^|\s)#ad\b/i.test(`${body} ${tags}`)) tags = `#ad ${tags}`.trim();
  return [body, tags].filter(Boolean).join("\n\n");
}

/** Default YouTube title: first line of the main caption, trimmed to the limit. */
export function suggestTitle(caption: string): string {
  return (caption.split("\n")[0] ?? "").replace(/[<>]/g, "").slice(0, LIMITS.youtube.title).trim();
}

export function validatePlatform(draft: ComposeDraft, platform: PlatformId, media: MediaInfo | null): Issue[] {
  const issues: Issue[] = [];
  const caption = finalCaption(draft, platform);
  const dur = media?.kind === "video" ? media.durationSec : null;
  const tooLong = (max: number, format: string) => {
    if (dur !== null && dur > max) issues.push({ level: "error", code: "videoTooLong", vars: { dur: fmtDuration(dur), max: fmtDuration(max), format } });
  };

  if (platform === "tiktok") {
    if (caption.length > LIMITS.tiktok.caption) issues.push({ level: "error", code: "captionTooLong", vars: { n: caption.length, max: LIMITS.tiktok.caption } });
    tooLong(LIMITS.tiktok.maxVideoSec, "");
    const o = effectiveOptions(draft, "tiktok");
    // TikTok rule: branded content can't be "Only me".
    if (o.brandedContent && o.privacy === "private") issues.push({ level: "error", code: "brandedPrivate" });
  }

  if (platform === "instagram") {
    const o = draft.platforms.instagram.options;
    const allText = `${caption} ${o.firstComment}`;
    if (caption.length > LIMITS.instagram.caption) issues.push({ level: "error", code: "captionTooLong", vars: { n: caption.length, max: LIMITS.instagram.caption } });
    const tags = countHashtags(allText);
    if (tags > LIMITS.instagram.hashtags) issues.push({ level: "error", code: "tooManyHashtags", vars: { n: tags, max: LIMITS.instagram.hashtags } });
    if (o.format === "story" && caption) issues.push({ level: "warning", code: "storyCaptionHidden" });
    if (o.format === "reel") tooLong(LIMITS.instagram.reelMaxSec, "Reel");
    if (o.format === "story") tooLong(LIMITS.instagram.storyMaxSec, "Story");
    if (o.format === "feed") tooLong(LIMITS.instagram.feedMaxSec, "Feed");
  }

  if (platform === "youtube") {
    const o = draft.platforms.youtube.options;
    if (media?.kind === "image") issues.push({ level: "error", code: "imageNotSupported" });
    if (!o.title.trim()) issues.push({ level: "error", code: "titleRequired" });
    if (o.title.length > LIMITS.youtube.title) issues.push({ level: "error", code: "titleTooLong", vars: { n: o.title.length, max: LIMITS.youtube.title } });
    if (/[<>]/.test(o.title)) issues.push({ level: "error", code: "titleInvalidChars" });
    if (caption.length > LIMITS.youtube.description) issues.push({ level: "error", code: "captionTooLong", vars: { n: caption.length, max: LIMITS.youtube.description } });
    const tagLen = o.tags.split(",").map((s) => s.trim()).filter(Boolean).join(",").length;
    if (tagLen > LIMITS.youtube.tags) issues.push({ level: "error", code: "tagsTooLong", vars: { n: tagLen, max: LIMITS.youtube.tags } });
    if (countHashtags(caption) > LIMITS.youtube.hashtags) issues.push({ level: "warning", code: "ytHashtagsIgnored", vars: { max: LIMITS.youtube.hashtags } });
    if (o.format === "short" && media?.kind === "video") {
      tooLong(LIMITS.youtube.shortMaxSec, "Shorts");
      if (media.width && media.height && media.width > media.height) issues.push({ level: "warning", code: "shortsNotVertical" });
    }
  }
  return issues;
}

export function validateSchedule(draft: ComposeDraft, now: string): Issue[] {
  if (draft.scheduledAt && draft.scheduledAt.slice(0, 16) <= now.slice(0, 16)) return [{ level: "error", code: "scheduleInPast" }];
  return [];
}

export function enabledPlatforms(draft: ComposeDraft): PlatformId[] {
  return (Object.keys(draft.platforms) as PlatformId[]).filter((p) => draft.platforms[p].enabled);
}
