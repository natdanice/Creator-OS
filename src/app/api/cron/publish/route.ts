/**
 * Publishes scheduled posts that are due — nothing else, so it's cheap to call often.
 * Call it every 5–15 minutes so a post scheduled for 18:00 goes out at 18:00
 * (the daily job also publishes, but only once a day).
 * Protected by CRON_SECRET: send "Authorization: Bearer <CRON_SECRET>".
 */
import { getDb } from "@/db/client";
import { getStoryDate } from "@/lib/queries/settings";
import { publishDue } from "@/publish/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const published = await publishDue(db, getStoryDate(db));
  return Response.json({ published });
}
