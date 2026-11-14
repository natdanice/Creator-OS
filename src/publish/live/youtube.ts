/**
 * YouTube Data API v3 — videos.insert with a resumable, chunked upload.
 * Needs the youtube.upload scope on the Google connection.
 *
 * YouTube rules worth knowing:
 * - Videos uploaded by an API project that hasn't passed YouTube's API audit are locked to
 *   Private. We compare the returned privacy with the one asked for and say so in a note.
 * - There's no "Short" flag: YouTube treats a vertical or square video of ≤ 3 minutes as a Short.
 * - Each upload uses a large share of the project's daily API quota.
 */
import { readError } from "@/connect/http";
import { LIMITS } from "../rules";
import type { PlatformPublisher, PublishRequest, PublishResult, YouTubeOptions } from "../types";
import { readChunk } from "./util";

const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";
/** Chunk size must be a multiple of 256 KiB. */
const CHUNK = 64 * 256 * 1024; // 16 MiB
const CATEGORY_ID: Record<YouTubeOptions["category"], string> = { people: "22", howto: "26", tech: "28", entertainment: "24" };

export class YouTubePublisher implements PlatformPublisher {
  readonly kind = "api" as const;
  readonly platform = "youtube" as const;
  constructor(private token: () => Promise<string>) {}

  async publish(req: PublishRequest): Promise<PublishResult> {
    const o = req.options as YouTubeOptions;
    const { media } = req;
    if (media.kind !== "video") return { ok: false, error: "YouTube needs a video, not an image" };

    const token = await this.token();
    const metadata = {
      snippet: {
        title: (req.title ?? o.title).trim(),
        description: req.caption,
        tags: o.tags.split(",").map((s) => s.trim()).filter(Boolean),
        categoryId: CATEGORY_ID[o.category] ?? "22",
      },
      status: { privacyStatus: o.visibility, selfDeclaredMadeForKids: o.madeForKids },
      paidProductPlacementDetails: { hasPaidProductPlacement: o.paidPromotion },
    };

    // 1) Start a resumable session: metadata is checked here, before any bytes are sent.
    const init = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status,paidProductPlacementDetails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(media.sizeBytes),
        "X-Upload-Content-Type": media.mime,
      },
      body: JSON.stringify(metadata),
    });
    if (!init.ok) return { ok: false, error: await readError(init) };
    const session = init.headers.get("location");
    if (!session) return { ok: false, error: "YouTube didn't return an upload address" };

    // 2) Send the file in chunks. 308 = "keep going"; its Range header says what arrived.
    let offset = 0;
    let retries = 0;
    let video: { id: string; status?: { privacyStatus?: string; uploadStatus?: string } } | null = null;
    while (!video) {
      const len = Math.min(CHUNK, media.sizeBytes - offset);
      const res = await fetch(session, {
        method: "PUT",
        redirect: "manual",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": media.mime, "Content-Range": `bytes ${offset}-${offset + len - 1}/${media.sizeBytes}` },
        body: await readChunk(media.path, offset, len),
      });
      if (res.status === 308) {
        const range = res.headers.get("range"); // "bytes=0-16777215"
        const next = range ? Number(range.split("-")[1]) + 1 : offset;
        if (next === offset && ++retries > 3) return { ok: false, error: "YouTube stopped accepting the upload — try again" };
        if (next !== offset) retries = 0;
        offset = next;
        continue;
      }
      if (!res.ok) return { ok: false, error: await readError(res, UPLOAD) };
      video = await res.json();
    }

    const notes: string[] = [];
    const got = video.status?.privacyStatus;
    if (got && got !== o.visibility) {
      notes.push(`YouTube set this video to ${got} (you chose ${o.visibility}). Uploads from a Google Cloud project that hasn't passed YouTube's API audit stay private — change it in YouTube Studio.`);
    }
    const vertical = !media.width || !media.height || media.height >= media.width;
    if (o.format === "video" && vertical && (media.durationSec ?? Infinity) <= LIMITS.youtube.shortMaxSec) {
      notes.push("YouTube shows vertical or square videos of 3 minutes or less as Shorts.");
    }
    return { ok: true, externalId: video.id, url: `https://youtu.be/${video.id}`, notes };
  }
}
