/** Read/write connected accounts; hands out a fresh access token (refreshing when needed). */
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { connections, type Provider } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";
import { form, getJson } from "./http";
import { OAUTH } from "./providers";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null; // seconds
}

export function saveConnection(db: DB, provider: Provider, accountName: string, tokens: TokenSet, meta: Record<string, string> = {}, scopes?: string) {
  const row = {
    provider,
    accountName,
    accessToken: encrypt(tokens.accessToken),
    refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : null,
    scopes: scopes ?? null,
    meta,
    connectedAt: new Date().toISOString(),
    lastError: null,
  };
  db.insert(connections).values(row).onConflictDoUpdate({ target: connections.provider, set: row }).run();
}

export function getConnection(db: DB, provider: Provider) {
  return db.select().from(connections).where(eq(connections.provider, provider)).get() ?? null;
}

export function disconnect(db: DB, provider: Provider) {
  db.delete(connections).where(eq(connections.provider, provider)).run();
}

export function markSync(db: DB, provider: Provider, error: string | null) {
  db.update(connections)
    .set(error ? { lastError: error.slice(0, 500) } : { lastSyncAt: new Date().toISOString(), lastError: null })
    .where(eq(connections.provider, provider))
    .run();
}

/** A usable access token, refreshed if it expires within 5 minutes. Throws if the account isn't connected. */
export async function accessToken(db: DB, provider: Provider): Promise<string> {
  const c = getConnection(db, provider);
  if (!c) throw new Error(`${provider} is not connected`);
  const soon = c.expiresAt && new Date(c.expiresAt).getTime() < Date.now() + 5 * 60_000;
  if (!soon) return decrypt(c.accessToken);

  let fresh: TokenSet;
  if (provider === "google" || provider === "tiktok") {
    if (!c.refreshToken) throw new Error(`${provider} login expired — connect again in Settings`);
    const o = OAUTH[provider];
    const r = await getJson<{ access_token: string; refresh_token?: string; expires_in?: number }>(
      o.tokenUrl,
      form({ [o.clientIdParam]: process.env[o.clientIdEnv]!, client_secret: process.env[o.clientSecretEnv]!, grant_type: "refresh_token", refresh_token: decrypt(c.refreshToken) }),
    );
    fresh = { accessToken: r.access_token, refreshToken: r.refresh_token ?? decrypt(c.refreshToken), expiresIn: r.expires_in };
  } else if (provider === "instagram") {
    // Long-lived Instagram tokens (~60 days) are refreshed in place.
    const r = await getJson<{ access_token: string; expires_in: number }>(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(decrypt(c.accessToken))}`);
    fresh = { accessToken: r.access_token, expiresIn: r.expires_in };
  } else {
    return decrypt(c.accessToken);
  }
  db.update(connections)
    .set({
      accessToken: encrypt(fresh.accessToken),
      refreshToken: fresh.refreshToken ? encrypt(fresh.refreshToken) : c.refreshToken,
      expiresAt: fresh.expiresIn ? new Date(Date.now() + fresh.expiresIn * 1000).toISOString() : c.expiresAt,
    })
    .where(eq(connections.provider, provider))
    .run();
  return fresh.accessToken;
}
