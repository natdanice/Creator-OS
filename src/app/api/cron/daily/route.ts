/**
 * The daily job (call once a day, e.g. 10:00 Bangkok, from Vercel Cron or any scheduler):
 * sync connected accounts → publish scheduled posts that are due → run the automation rules.
 * Protected by CRON_SECRET: send "Authorization: Bearer <CRON_SECRET>".
 */
import { getDb } from "@/db/client";
import { getStoryDate } from "@/lib/queries/settings";
import { publishDue } from "@/publish/service";
import { runAutomations } from "@/automation/engine";
import { syncAll } from "@/connect/sync";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const today = getStoryDate(db);
  const synced = await syncAll(db);
  const published = await publishDue(db, today);
  const automations = runAutomations(db, today);
  return Response.json({ today, synced, published, automations });
}
