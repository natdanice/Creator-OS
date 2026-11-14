/**
 * Instagram API with Instagram Login — content publishing (Business or Creator account).
 * Needs the instagram_business_content_publish scope.
 *
 * Flow: create a media container → (video) upload the file to it → wait until Instagram
 * has processed it → publish → (optional) post the first comment.
 *
 * Instagram rules worth knowing:
 * - Videos are uploaded directly (resumable upload). Images are fetched by Instagram from a
 *   public URL and must be JPEG, so image posts need the app online at a public https address.
 * - All feed videos are Reels; "Feed post" with a video = a Reel shared to the feed.
 * - The API can't set the Paid partnership label; it must be turned on in the Instagram app.
 * - Location needs a numeric place ID (a Facebook Page ID), not a place name.
 */
import { getJson, readError } from "@/connect/http";
import type { InstagramOptions, PlatformPublisher, PublishRequest, PublishResult } from "../types";
import { poll, publicMediaUrl, readChunk } from "./util";

const VERSION = "v23.0";
const G = `https://graph.instagram.com/${VERSION}`;
const RUPLOAD = `https://rupload.facebook.com/ig-api-upload/${VERSION}`;

type Container = { status_code?: "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED"; status?: string };

export class InstagramPublisher implements PlatformPublisher {
  readonly kind = "api" as const;
  readonly platform = "instagram" as const;
  constructor(
    private token: () => Promise<string>,
    private userId: string,
  ) {}

  async publish(req: PublishRequest): Promise<PublishResult> {
    const o = req.options as InstagramOptions;
    const { media } = req;
    const token = await this.token();
    const post = (path: string, params: Record<string, string>) =>
      getJson<{ id: string }>(`${G}/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, access_token: token }).toString() });
    const notes: string[] = [];
    const story = o.format === "story";

    // 1) Container
    const params: Record<string, string> = {};
    if (!story && req.caption) params.caption = req.caption;
    const collaborators = o.collaborator.split(/[,\s]+/).map((s) => s.replace(/^@/, "")).filter(Boolean).slice(0, 3);
    if (collaborators.length && !story) params.collaborators = JSON.stringify(collaborators);
    const place = o.location.trim();
    if (place && !story) {
      if (/^\d+$/.test(place)) params.location_id = place;
      else notes.push(`Location “${place}” wasn't added: Instagram's API needs a numeric place ID. Add the location in the Instagram app.`);
    }
    if (media.kind === "video") {
      params.media_type = story ? "STORIES" : "REELS";
      params.upload_type = "resumable";
      if (!story) params.share_to_feed = String(o.format === "feed" || o.shareToFeed);
    } else {
      if (!/^image\/jpe?g$/.test(media.mime)) return { ok: false, error: "Instagram only accepts JPEG images through the API — save the image as .jpg and upload it again" };
      params.image_url = publicMediaUrl(media.id, "Instagram");
      if (story) params.media_type = "STORIES";
    }
    const container = await post(`${this.userId}/media`, params);

    // 2) Video bytes go straight to Instagram's upload server.
    if (media.kind === "video") {
      const res = await fetch(`${RUPLOAD}/${container.id}`, {
        method: "POST",
        headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(media.sizeBytes) },
        body: await readChunk(media.path, 0, media.sizeBytes),
      });
      if (!res.ok) return { ok: false, error: await readError(res) };
    }

    // 3) Wait for processing (videos take a while).
    const state = await poll(async () => {
      const c = await getJson<Container>(`${G}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`);
      return c.status_code === "IN_PROGRESS" || !c.status_code ? undefined : c;
    });
    if (!state) return { ok: false, error: "Instagram is still processing the video after 5 minutes — check the Instagram app before trying again" };
    if (state.status_code !== "FINISHED") return { ok: false, error: `Instagram couldn't process the media (${state.status_code}${state.status ? `: ${state.status}` : ""})` };

    // 4) Publish
    const published = await post(`${this.userId}/media_publish`, { creation_id: container.id });
    const link = await getJson<{ permalink?: string }>(`${G}/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`).catch(() => null);

    // 5) Extras that the API can or can't do
    if (o.firstComment.trim() && !story) {
      await post(`${published.id}/comments`, { message: o.firstComment.trim() }).catch((e) => notes.push(`Posted, but the first comment failed: ${e instanceof Error ? e.message : e}`));
    }
    if (o.paidPartnership) notes.push("Turn on the Paid partnership label in the Instagram app: the API can't set it.");

    return { ok: true, externalId: published.id, url: link?.permalink, notes };
  }
}
