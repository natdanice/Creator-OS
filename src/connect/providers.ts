/**
 * OAuth settings per provider. Each needs a developer app you create on the platform;
 * its client id/secret go in .env.local. The redirect URL to register with the platform is
 *   <APP_URL>/api/connect/<provider>/callback
 * LINE uses a channel access token instead of OAuth (see webhooks/line).
 *
 * Endpoints and scopes follow each platform's docs at the time of writing — they change;
 * if a connect fails, compare with the platform's current documentation.
 */
import type { Provider } from "@/db/schema";
import { APP_URL } from "@/lib/config";

export interface OAuthProvider {
  id: Exclude<Provider, "line">;
  authorizeUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** TikTok calls the client id "client_key". */
  clientIdParam: string;
  scopes: string[];
  scopeSeparator: string;
  extraAuthParams?: Record<string, string>;
}

export const OAUTH: Record<OAuthProvider["id"], OAuthProvider> = {
  google: {
    id: "google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    clientIdParam: "client_id",
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
    scopeSeparator: " ",
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  instagram: {
    id: "instagram",
    authorizeUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    clientIdEnv: "INSTAGRAM_CLIENT_ID",
    clientSecretEnv: "INSTAGRAM_CLIENT_SECRET",
    clientIdParam: "client_id",
    scopes: ["instagram_business_basic", "instagram_business_manage_insights", "instagram_business_manage_comments", "instagram_business_content_publish"],
    scopeSeparator: ",",
  },
  tiktok: {
    id: "tiktok",
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    clientIdEnv: "TIKTOK_CLIENT_KEY",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    clientIdParam: "client_key",
    scopes: ["user.info.basic", "user.info.stats", "video.list", "video.publish"],
    scopeSeparator: ",",
  },
};

/** The permission each Publisher platform needs on top of the read scopes. */
export const PUBLISH_SCOPE = {
  youtube: "https://www.googleapis.com/auth/youtube.upload",
  instagram: "instagram_business_content_publish",
  tiktok: "video.publish",
} as const;

/** Which connected account a Publisher platform posts through. */
export const PUBLISH_PROVIDER = { youtube: "google", instagram: "instagram", tiktok: "tiktok" } as const;

/** Granted scopes are stored space-separated (platforms return spaces or commas). */
export const hasScope = (granted: string | null | undefined, scope: string) => (granted ?? "").split(/[\s,]+/).includes(scope);

export const redirectUri = (p: Provider) => `${APP_URL}/api/connect/${p}/callback`;

export function configured(p: Provider): boolean {
  if (p === "line") return !!(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN);
  const o = OAUTH[p];
  return !!(process.env[o.clientIdEnv] && process.env[o.clientSecretEnv]);
}

export function envNames(p: Provider): string[] {
  return p === "line" ? ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"] : [OAUTH[p].clientIdEnv, OAUTH[p].clientSecretEnv];
}
