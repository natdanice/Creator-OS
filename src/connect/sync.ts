/**
 * Pulls every connected account into the CDP / Inbox. Called by the daily job and by
 * "Sync now" in Settings. One provider failing never stops the others; the error is
 * saved on the connection and shown in Settings.
 */
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { connections, platforms, type Provider } from "@/db/schema";
import { ingest } from "@/cdp/ingest";
import type { PlatformAdapter, PlatformId, RawAudienceSnapshot, RawComment, RawContent, RawMetricDaily } from "@/cdp/adapters/PlatformAdapter";
import { getStoryDate } from "@/lib/queries/settings";
import { bangkokNow } from "@/lib/clock";
import { accessToken, getConnection, markSync } from "./store";
import { YouTubeApiAdapter } from "./youtube";
import { fetchInstagram } from "./instagram";
import { fetchTikTok } from "./tiktok";
import { importGmail } from "./gmail";
import { totalsToDeltas } from "./totals";

/** Wraps already-fetched arrays as a PlatformAdapter so they go through the normal ingest pipeline. */
function arrays(platform: PlatformId, d: { contents: RawContent[]; metrics: RawMetricDaily[]; comments?: RawComment[]; audience: RawAudienceSnapshot[] }): PlatformAdapter {
  return {
    kind: "api",
    platform,
    importContents: async () => d.contents,
    importMetrics: async () => d.metrics,
    importComments: async () => d.comments ?? [],
    importAudience: async () => d.audience,
  };
}

function setHandle(db: DB, platform: PlatformId, handle: string) {
  if (handle) db.update(platforms).set({ handle }).where(eq(platforms.id, platform)).run();
}

export async function syncProvider(db: DB, provider: Provider): Promise<string> {
  const conn = getConnection(db, provider);
  if (!conn) return "not connected";
  const today = getStoryDate(db);
  const now = bangkokNow();
  const month = today.slice(0, 7);
  try {
    const token = await accessToken(db, provider);
    const parts: string[] = [];
    if (provider === "google") {
      if (conn.meta?.channelId) {
        const r = await ingest(db, new YouTubeApiAdapter(token, today), now);
        if (r.status === "failed") throw new Error(`YouTube: ${r.message}`);
        setHandle(db, "youtube", conn.meta.channelTitle ?? "");
        parts.push(`YouTube ${r.contents} videos, ${r.comments} new comments`);
      }
      const g = await importGmail(db, token, conn.meta?.email ?? "");
      parts.push(`Gmail ${g.imported} new messages${g.newBrands ? `, ${g.newBrands} new brands` : ""}`);
    } else if (provider === "instagram") {
      const d = await fetchInstagram(token, month);
      const r = await ingest(db, arrays("instagram", { ...d, metrics: totalsToDeltas(db, "instagram", today, d.posts) }), now);
      if (r.status === "failed") throw new Error(r.message ?? "failed");
      setHandle(db, "instagram", conn.accountName);
      parts.push(`Instagram ${r.contents} posts, ${r.comments} new comments`);
    } else if (provider === "tiktok") {
      const d = await fetchTikTok(token, month);
      const r = await ingest(db, arrays("tiktok", { ...d, metrics: totalsToDeltas(db, "tiktok", today, d.posts) }), now);
      if (r.status === "failed") throw new Error(r.message ?? "failed");
      setHandle(db, "tiktok", conn.accountName);
      parts.push(`TikTok ${r.contents} videos`);
    }
    markSync(db, provider, null);
    return parts.join(" · ") || "ok";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    markSync(db, provider, msg);
    return `error: ${msg}`;
  }
}

export async function syncAll(db: DB) {
  const out: Record<string, string> = {};
  for (const c of db.select({ provider: connections.provider }).from(connections).all()) out[c.provider] = await syncProvider(db, c.provider);
  return out;
}
