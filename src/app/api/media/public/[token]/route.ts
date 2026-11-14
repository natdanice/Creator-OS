/**
 * Serves one uploaded media file to a platform's servers (Instagram images, TikTok photos),
 * which fetch by URL. Open without login, but only for a valid, unexpired signed token.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { mediaAssets } from "@/db/schema";
import { UPLOAD_DIR } from "@/publish/service";
import { verifyMediaToken } from "@/publish/live/util";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const id = verifyMediaToken((await params).token);
  if (!id) return new Response("Link expired", { status: 404 });
  const m = getDb().select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
  const file = m && path.join(UPLOAD_DIR, m.storedName);
  if (!m || !file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: { "Content-Type": m.mime, "Content-Length": String(fs.statSync(file).size), "Cache-Control": "private, no-store" },
  });
}
