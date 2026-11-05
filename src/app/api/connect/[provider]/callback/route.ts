/** The platform sends the user back here with ?code=…; exchange it for tokens and store the connection. */
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { bearer, form, getJson } from "@/connect/http";
import { OAUTH, redirectUri, type OAuthProvider } from "@/connect/providers";
import { saveConnection, type TokenSet } from "@/connect/store";

type Done = { account: string; tokens: TokenSet; meta?: Record<string, string> };

async function exchange(o: OAuthProvider, code: string): Promise<Done> {
  const base = { [o.clientIdParam]: process.env[o.clientIdEnv]!, client_secret: process.env[o.clientSecretEnv]!, grant_type: "authorization_code", redirect_uri: redirectUri(o.id), code };
  if (o.id === "google") {
    const r = await getJson<{ access_token: string; refresh_token?: string; expires_in: number }>(o.tokenUrl, form(base));
    const profile = await getJson<{ emailAddress: string }>("https://gmail.googleapis.com/gmail/v1/users/me/profile", bearer(r.access_token)).catch(() => null);
    const ch = await getJson<{ items?: { id: string; snippet: { title: string } }[] }>("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", bearer(r.access_token)).catch(() => null);
    const channel = ch?.items?.[0];
    return {
      account: [channel?.snippet.title, profile?.emailAddress].filter(Boolean).join(" · ") || "Google",
      tokens: { accessToken: r.access_token, refreshToken: r.refresh_token, expiresIn: r.expires_in },
      meta: { email: profile?.emailAddress ?? "", channelId: channel?.id ?? "", channelTitle: channel?.snippet.title ?? "" },
    };
  }
  if (o.id === "instagram") {
    const short = await getJson<{ access_token: string; user_id: number | string }>(o.tokenUrl, form(base));
    const long = await getJson<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(process.env[o.clientSecretEnv]!)}&access_token=${encodeURIComponent(short.access_token)}`,
    );
    const me = await getJson<{ username: string; user_id?: string }>(`https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(long.access_token)}`);
    return { account: `@${me.username}`, tokens: { accessToken: long.access_token, expiresIn: long.expires_in }, meta: { userId: String(me.user_id ?? short.user_id), username: me.username } };
  }
  const r = await getJson<{ access_token: string; refresh_token: string; expires_in: number; open_id: string }>(o.tokenUrl, form(base));
  const me = await getJson<{ data: { user: { display_name?: string } } }>("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", bearer(r.access_token)).catch(() => null);
  return { account: me?.data.user.display_name ?? "TikTok", tokens: { accessToken: r.access_token, refreshToken: r.refresh_token, expiresIn: r.expires_in }, meta: { openId: r.open_id } };
}

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const o = OAUTH[provider as keyof typeof OAUTH];
  if (!o) return new Response("Unknown provider", { status: 404 });
  const url = new URL(req.url);
  const back = (q: string) => Response.redirect(new URL(`/settings?${q}#connections`, redirectUri(o.id)), 302);
  const store = await cookies();
  const expected = store.get(`oauth_state_${o.id}`)?.value;
  store.delete(`oauth_state_${o.id}`);
  if (url.searchParams.get("error")) return back(`connectError=${encodeURIComponent(url.searchParams.get("error_description") ?? url.searchParams.get("error")!)}`);
  if (!expected || url.searchParams.get("state") !== expected) return back(`connectError=${encodeURIComponent("Login expired or was opened in another browser — try again")}`);
  try {
    const done = await exchange(o, url.searchParams.get("code") ?? "");
    saveConnection(getDb(), o.id, done.account, done.tokens, done.meta, o.scopes.join(" "));
    revalidatePath("/", "layout");
    return back(`connected=${o.id}`);
  } catch (e) {
    return back(`connectError=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
