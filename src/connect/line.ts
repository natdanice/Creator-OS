/**
 * LINE Official Account via the Messaging API (no OAuth: a channel secret + access token in .env.local).
 * Incoming chats arrive through the webhook; each LINE user is one brand contact.
 * Sending is a push message, only when the creator clicks "Send via LINE".
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getJson } from "./http";

export const isLineUserId = (s: string) => /^U[0-9a-f]{32}$/.test(s);

export function verifyLineSignature(body: string, signature: string | null) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const auth = () => ({ Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` });

export async function lineProfile(userId: string) {
  return getJson<{ displayName: string }>(`https://api.line.me/v2/bot/profile/${userId}`, { headers: auth() }).catch(() => ({ displayName: "LINE user" }));
}

export async function pushLine(to: string, text: string) {
  await getJson(`https://api.line.me/v2/bot/message/push`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 5000) }] }),
  });
}
