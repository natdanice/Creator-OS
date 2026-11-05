/** Starts "Connect <platform>": redirects to the platform's consent screen with a CSRF state cookie. */
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { configured, OAUTH, redirectUri } from "@/connect/providers";

export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const o = OAUTH[provider as keyof typeof OAUTH];
  if (!o) return new Response("Unknown provider", { status: 404 });
  if (!configured(o.id)) return Response.redirect(new URL(`/settings?connectError=${encodeURIComponent(`Add ${o.clientIdEnv} and ${o.clientSecretEnv} to .env.local first`)}#connections`, redirectUri(o.id)), 302);
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set(`oauth_state_${o.id}`, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  const url = new URL(o.authorizeUrl);
  url.searchParams.set(o.clientIdParam, process.env[o.clientIdEnv]!);
  url.searchParams.set("redirect_uri", redirectUri(o.id));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", o.scopes.join(o.scopeSeparator));
  url.searchParams.set("state", state);
  for (const [k, v] of Object.entries(o.extraAuthParams ?? {})) url.searchParams.set(k, v);
  return Response.redirect(url.toString(), 302);
}
