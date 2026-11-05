/**
 * Single-user login. On when APP_PASSWORD is set (live use); off for the public class demo.
 * The session is a signed cookie: "<expiry>.<HMAC-SHA256(AUTH_SECRET, expiry)>".
 * Uses Web Crypto so the same code runs in the proxy and in server actions.
 */
export const SESSION_COOKIE = "cos_session";
export const SESSION_DAYS = 30;

export const authEnabled = () => !!process.env.APP_PASSWORD;

function secret() {
  // AUTH_SECRET should be a long random string; fall back to the password so a missing secret never disables login.
  return process.env.AUTH_SECRET || `pw:${process.env.APP_PASSWORD ?? ""}`;
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => Buffer.from(buf).toString("base64url");

async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant-time string comparison (via HMAC of both sides). */
async function safeEqual(a: string, b: string) {
  const [x, y] = await Promise.all([hmac(`cmp:${a}`), hmac(`cmp:${b}`)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function passwordMatches(input: string) {
  const pw = process.env.APP_PASSWORD;
  return !!pw && (await safeEqual(input, pw));
}

export async function createSession() {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  return `${exp}.${await hmac(`session:${exp}`)}`;
}

export async function verifySession(token: string | undefined) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(`session:${exp}`));
}
