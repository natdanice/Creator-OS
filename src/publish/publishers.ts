/**
 * Which publisher posts for each platform.
 *   demo mode → MockPublisher (nothing leaves the machine)
 *   live mode → the platform's API publisher, through the connected account. Live mode never
 *               fakes a post: a platform that isn't connected (or lacks posting permission) fails
 *               with a message saying what to do.
 */
import type { DB } from "@/db/client";
import { IS_LIVE } from "@/lib/config";
import { accessToken, getConnection } from "@/connect/store";
import { hasScope, PUBLISH_PROVIDER, PUBLISH_SCOPE } from "@/connect/providers";
import { MockPublisher } from "./MockPublisher";
import { InstagramPublisher } from "./live/instagram";
import { tiktokCreatorInfo, TikTokPublisher, TIKTOK_PRIVACY } from "./live/tiktok";
import { YouTubePublisher } from "./live/youtube";
import { PUBLISH_PLATFORMS, type PlatformId, type PlatformPublisher, type TikTokOptions } from "./types";

const NAME: Record<PlatformId, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };

/** mock = demo · ready = will really post · the rest = blocked, with the reason. */
export type TargetState = "mock" | "ready" | "not_connected" | "needs_permission" | "no_channel";

export interface PublishTarget {
  state: TargetState;
  account?: string;
  /** TikTok: the privacy choices TikTok currently allows for this account (Composer greys out the rest). */
  tiktokPrivacy?: TikTokOptions["privacy"][];
  /** A problem asking the platform about the account (shown, not blocking). */
  warning?: string;
}

function targetState(db: DB, platform: PlatformId): { state: TargetState; account?: string } {
  if (!IS_LIVE) return { state: "mock" };
  const conn = getConnection(db, PUBLISH_PROVIDER[platform]);
  if (!conn) return { state: "not_connected" };
  if (!hasScope(conn.scopes, PUBLISH_SCOPE[platform])) return { state: "needs_permission", account: conn.accountName };
  if (platform === "youtube" && !conn.meta?.channelId) return { state: "no_channel", account: conn.accountName };
  if (platform === "instagram" && !conn.meta?.userId) return { state: "needs_permission", account: conn.accountName };
  return { state: "ready", account: platform === "youtube" ? (conn.meta?.channelTitle ?? conn.accountName) : conn.accountName };
}

const BLOCKED: Record<Exclude<TargetState, "mock" | "ready">, (n: string) => string> = {
  not_connected: (n) => `${n} isn't connected — connect it in Settings → Connected accounts`,
  needs_permission: (n) => `${n} is connected without posting permission — click Reconnect in Settings and allow posting`,
  no_channel: () => "This Google account has no YouTube channel",
};

class Blocked implements PlatformPublisher {
  readonly kind = "api" as const;
  constructor(
    readonly platform: PlatformId,
    private reason: string,
  ) {}
  async publish() {
    return { ok: false, error: this.reason };
  }
}

export function getPublisher(db: DB, platform: PlatformId): PlatformPublisher {
  const { state } = targetState(db, platform);
  if (state === "mock") return new MockPublisher(platform);
  if (state !== "ready") return new Blocked(platform, BLOCKED[state](NAME[platform]));
  const token = () => accessToken(db, PUBLISH_PROVIDER[platform]);
  if (platform === "youtube") return new YouTubePublisher(token);
  if (platform === "instagram") return new InstagramPublisher(token, getConnection(db, "instagram")!.meta!.userId);
  return new TikTokPublisher(token);
}

/** Readiness per platform for the Composer. Asks TikTok which privacy options are allowed. */
export async function publishTargets(db: DB): Promise<Record<PlatformId, PublishTarget>> {
  const out = {} as Record<PlatformId, PublishTarget>;
  for (const p of PUBLISH_PLATFORMS) out[p] = targetState(db, p);
  if (out.tiktok.state === "ready") {
    try {
      const info = await tiktokCreatorInfo(await accessToken(db, "tiktok"));
      out.tiktok.tiktokPrivacy = (Object.keys(TIKTOK_PRIVACY) as TikTokOptions["privacy"][]).filter((k) => info.privacy_level_options.includes(TIKTOK_PRIVACY[k]));
      if (info.creator_nickname) out.tiktok.account = info.creator_nickname;
    } catch (e) {
      out.tiktok.warning = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}
