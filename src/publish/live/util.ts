/** Shared helpers for the API publishers: chunked file reads, polling and signed public media links. */
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import { APP_URL } from "@/lib/config";

/** Reads `length` bytes from `start` (keeps big videos out of memory: one chunk at a time). */
export async function readChunk(path: string, start: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Uint8Array(length);
  const fh = await fs.open(path, "r");
  try {
    let read = 0;
    while (read < length) {
      const { bytesRead } = await fh.read(out, read, length - read, start + read);
      if (bytesRead === 0) throw new Error("Media file is shorter than expected — upload it again");
      read += bytesRead;
    }
  } finally {
    await fh.close();
  }
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Calls `check` until it returns a value (not undefined) or the time runs out (then returns undefined). */
export async function poll<T>(check: () => Promise<T | undefined>, { everyMs = 5000, timeoutMs = 5 * 60_000 } = {}): Promise<T | undefined> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v !== undefined) return v;
    if (Date.now() + everyMs > end) return undefined;
    await sleep(everyMs);
  }
}

/* ── Signed public media links ──
 * Instagram (images) and TikTok (photos) fetch the file from a URL instead of taking an upload.
 * /api/media/public/<token> serves one media file without login while the token is valid. */

const secret = () => process.env.AUTH_SECRET || "creator-os-demo-only";
const sign = (data: string) => createHmac("sha256", secret()).update(`media:${data}`).digest("base64url");

export function mediaToken(mediaId: number, ttlSec = 3600): string {
  const data = `${mediaId}.${Math.floor(Date.now() / 1000) + ttlSec}`;
  return `${data}.${sign(data)}`;
}

/** The media id if the token is genuine and unexpired, else null. */
export function verifyMediaToken(token: string): number | null {
  const [id, exp, sig] = token.split(".");
  if (!id || !exp || !sig) return null;
  const want = Buffer.from(sign(`${id}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return Number(id) || null;
}

/** A link the platform's servers can fetch. Needs the app on a public https address (APP_URL). */
export function publicMediaUrl(mediaId: number, what: string): string {
  if (!/^https:\/\//.test(APP_URL) || /localhost|127\.0\.0\.1/.test(APP_URL)) {
    throw new Error(`${what} downloads the file from your app, so the app must be online at a public https address (set APP_URL). Post a video instead, or host the app first.`);
  }
  return `${APP_URL.replace(/\/$/, "")}/api/media/public/${mediaToken(mediaId)}`;
}
