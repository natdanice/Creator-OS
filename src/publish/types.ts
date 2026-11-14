import type { ContentType, ProductCategory } from "@/db/schema";
import type { PlatformId } from "@/cdp/adapters/PlatformAdapter";

export type { PlatformId };
export const PUBLISH_PLATFORMS: PlatformId[] = ["tiktok", "instagram", "youtube"];

export interface TikTokOptions {
  privacy: "public" | "friends" | "private";
  allowComments: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  brandedContent: boolean;
}

export interface InstagramOptions {
  format: "reel" | "feed" | "story";
  shareToFeed: boolean;
  firstComment: string;
  collaborator: string;
  location: string;
  paidPartnership: boolean;
}

export interface YouTubeOptions {
  title: string;
  tags: string;
  format: "short" | "video";
  visibility: "public" | "unlisted" | "private";
  madeForKids: boolean;
  category: "people" | "howto" | "tech" | "entertainment";
  paidPromotion: boolean;
}

export interface PlatformOptionsMap {
  tiktok: TikTokOptions;
  instagram: InstagramOptions;
  youtube: YouTubeOptions;
}

export interface PlatformDraft<P extends PlatformId> {
  enabled: boolean;
  /** null = use the main caption */
  customCaption: string | null;
  options: PlatformOptionsMap[P];
}

/** Everything the composer sends to the server. */
export interface ComposeDraft {
  mediaId: number | null;
  caption: string;
  hashtags: string;
  contentType: ContentType;
  productCategory: ProductCategory;
  dealId: number | null;
  sponsored: boolean;
  addAdTag: boolean;
  /** "YYYY-MM-DDTHH:mm" or null to publish now */
  scheduledAt: string | null;
  platforms: { [P in PlatformId]: PlatformDraft<P> };
}

export interface MediaInfo {
  kind: "video" | "image";
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

export const DEFAULT_OPTIONS: PlatformOptionsMap = {
  tiktok: { privacy: "public", allowComments: true, allowDuet: true, allowStitch: true, brandedContent: false },
  instagram: { format: "reel", shareToFeed: true, firstComment: "", collaborator: "", location: "", paidPartnership: false },
  youtube: { title: "", tags: "", format: "short", visibility: "public", madeForKids: false, category: "people", paidPromotion: false },
};

/** What a publisher receives for one platform. */
export interface PublishRequest<P extends PlatformId = PlatformId> {
  platform: P;
  media: MediaInfo & { id: number; path: string; mime: string; sizeBytes: number };
  title: string | null;
  caption: string;
  options: PlatformOptionsMap[P];
}

export interface PublishResult {
  ok: boolean;
  externalId?: string;
  /** Link to the live post, when the platform gives one. */
  url?: string;
  /** Non-fatal notes shown in the queue (e.g. a label that must be set in the app). */
  notes?: string[];
  error?: string;
}

/**
 * Outbound counterpart of PlatformAdapter. Demo mode uses MockPublisher; live mode uses
 * the API publishers in ./live (YouTube Data API, Instagram API with Instagram Login,
 * TikTok Content Posting API). `getPublisher()` in ./publishers picks one.
 */
export interface PlatformPublisher {
  readonly kind: "mock" | "api";
  readonly platform: PlatformId;
  publish(req: PublishRequest): Promise<PublishResult>;
}
