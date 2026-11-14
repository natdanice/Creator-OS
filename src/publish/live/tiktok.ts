/**
 * TikTok Content Posting API — Direct Post. Needs the video.publish scope.
 *
 * Flow: ask TikTok what this creator may post (creator_info) → init the post → upload the
 * video in chunks (photos: TikTok pulls them from a URL) → poll the publish status.
 *
 * TikTok rules worth knowing:
 * - Until TikTok audits your app, every post is restricted to "Only me" (SELF_ONLY), and
 *   creator_info only offers that option.
 * - Branded content can't be posted as "Only me".
 * - Photo posts are pulled from a URL on a domain you verified in the TikTok developer portal,
 *   so they need the app online at a public https address.
 */
import { getJson, readError } from "@/connect/http";
import type { PlatformPublisher, PublishRequest, PublishResult, TikTokOptions } from "../types";
import { poll, publicMediaUrl, readChunk } from "./util";

const API = "https://open.tiktokapis.com/v2";

export type TikTokPrivacy = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
export const TIKTOK_PRIVACY: Record<TikTokOptions["privacy"], TikTokPrivacy> = { public: "PUBLIC_TO_EVERYONE", friends: "MUTUAL_FOLLOW_FRIENDS", private: "SELF_ONLY" };

export interface CreatorInfo {
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options: TikTokPrivacy[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

type Envelope<T> = { data: T; error?: { code: string; message: string } };

async function call<T>(token: string, path: string, body: unknown): Promise<T> {
  const r = await getJson<Envelope<T>>(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body ?? {}),
  });
  if (r.error && r.error.code !== "ok") throw new Error(`TikTok: ${r.error.message || r.error.code}`);
  return r.data;
}

export const tiktokCreatorInfo = (token: string) => call<CreatorInfo>(token, "/post/publish/creator_info/query/", {});

/** Chunking rules: one chunk up to 64 MB; above that ≥ 5 MB chunks, the last one takes the remainder. */
export function tiktokChunks(size: number): { chunkSize: number; count: number } {
  const SINGLE_MAX = 64 * 1024 * 1024;
  const CHUNK = 32 * 1024 * 1024;
  if (size <= SINGLE_MAX) return { chunkSize: size, count: 1 };
  return { chunkSize: CHUNK, count: Math.floor(size / CHUNK) };
}

type Status = { status: "PROCESSING_UPLOAD" | "PROCESSING_DOWNLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED"; fail_reason?: string; postId?: string };

/**
 * Publish status. Post ids are 64-bit numbers in the JSON, which JSON.parse rounds
 * (…0001 → …0000), so the id is read from the raw text.
 */
async function fetchStatus(token: string, publishId: string): Promise<Status> {
  const res = await fetch(`${API}/post/publish/status/fetch/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ publish_id: publishId }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const text = await res.text();
  const r = JSON.parse(text) as Envelope<Status>;
  if (r.error && r.error.code !== "ok") throw new Error(`TikTok: ${r.error.message || r.error.code}`);
  const postId = text.match(/"publicaly_available_post_id"\s*:\s*\[\s*"?(\d+)/)?.[1]; // (sic) TikTok's field name
  return { ...r.data, postId };
}

export class TikTokPublisher implements PlatformPublisher {
  readonly kind = "api" as const;
  readonly platform = "tiktok" as const;
  constructor(private token: () => Promise<string>) {}

  async publish(req: PublishRequest): Promise<PublishResult> {
    const o = req.options as TikTokOptions;
    const { media } = req;
    const token = await this.token();
    const info = await tiktokCreatorInfo(token);
    const privacy = TIKTOK_PRIVACY[o.privacy];
    if (!info.privacy_level_options.includes(privacy)) {
      const onlyMe = info.privacy_level_options.length === 1 && info.privacy_level_options[0] === "SELF_ONLY";
      return { ok: false, error: onlyMe ? "TikTok only allows “Only me” for this app until TikTok audits it — set Who can view to Only me" : `TikTok doesn't allow this privacy for your account (allowed: ${info.privacy_level_options.join(", ")})` };
    }
    if (o.brandedContent && privacy === "SELF_ONLY") return { ok: false, error: "TikTok doesn't allow branded content to be posted as “Only me”" };

    const postInfo = {
      privacy_level: privacy,
      disable_comment: !o.allowComments || !!info.comment_disabled,
      brand_content_toggle: o.brandedContent,
      brand_organic_toggle: false,
    };

    let publishId: string;
    if (media.kind === "video") {
      if (info.max_video_post_duration_sec && media.durationSec && media.durationSec > info.max_video_post_duration_sec) {
        return { ok: false, error: `TikTok allows videos up to ${Math.floor(info.max_video_post_duration_sec / 60)} min for this account` };
      }
      const { chunkSize, count } = tiktokChunks(media.sizeBytes);
      const init = await call<{ publish_id: string; upload_url: string }>(token, "/post/publish/video/init/", {
        post_info: { ...postInfo, title: req.caption, disable_duet: !o.allowDuet || !!info.duet_disabled, disable_stitch: !o.allowStitch || !!info.stitch_disabled },
        source_info: { source: "FILE_UPLOAD", video_size: media.sizeBytes, chunk_size: chunkSize, total_chunk_count: count },
      });
      publishId = init.publish_id;
      for (let i = 0; i < count; i++) {
        const start = i * chunkSize;
        const end = i === count - 1 ? media.sizeBytes : start + chunkSize; // last chunk takes the remainder
        const res = await fetch(init.upload_url, {
          method: "PUT",
          headers: { "Content-Type": media.mime, "Content-Range": `bytes ${start}-${end - 1}/${media.sizeBytes}` },
          body: await readChunk(media.path, start, end - start),
        });
        if (!res.ok) return { ok: false, error: await readError(res) };
      }
    } else {
      const caption = req.caption;
      const init = await call<{ publish_id: string }>(token, "/post/publish/content/init/", {
        post_info: { ...postInfo, title: (caption.split("\n")[0] ?? "").slice(0, 90), description: caption.slice(0, 4000), auto_add_music: true },
        source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: [publicMediaUrl(media.id, "TikTok")] },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      });
      publishId = init.publish_id;
    }

    const done = await poll(async () => {
      const s = await fetchStatus(token, publishId);
      return s.status === "PUBLISH_COMPLETE" || s.status === "FAILED" ? s : undefined;
    });

    const notes: string[] = [];
    if (privacy === "SELF_ONLY") notes.push("Posted as “Only me”. Change who can view it in the TikTok app.");
    if (!done) {
      // The upload finished; TikTok is still working on it. Retrying could post it twice.
      notes.push("TikTok was still processing this post after 5 minutes — check the TikTok app.");
      return { ok: true, externalId: `publish_${publishId}`, notes };
    }
    if (done.status === "FAILED") return { ok: false, error: `TikTok couldn't publish it${done.fail_reason ? ` (${done.fail_reason})` : ""}` };
    const { postId } = done;
    const user = info.creator_username;
    return {
      ok: true,
      externalId: postId ?? `publish_${publishId}`,
      url: postId && user ? `https://www.tiktok.com/@${user}/video/${postId}` : undefined,
      notes,
    };
  }
}
