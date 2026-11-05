/** LINE webhook: every text message from a LINE user lands in that brand's Inbox thread. */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { brandContacts, brands, messages } from "@/db/schema";
import { getBriefDetector } from "@/inbox/briefDetector";
import { lineProfile, verifyLineSignature } from "@/connect/line";
import { guessTags, toBangkok } from "@/connect/tags";

type LineEvent = { type: string; timestamp: number; source: { type: string; userId?: string }; message?: { id: string; type: string; text?: string } };

export async function POST(req: Request) {
  const body = await req.text();
  if (!verifyLineSignature(body, req.headers.get("x-line-signature"))) return new Response("Bad signature", { status: 401 });
  const db = getDb();
  const detector = getBriefDetector();
  const { events = [] } = JSON.parse(body) as { events?: LineEvent[] };
  for (const ev of events) {
    const userId = ev.source.userId;
    if (ev.type !== "message" || ev.message?.type !== "text" || !userId || !ev.message.text) continue;
    if (db.select({ id: messages.id }).from(messages).where(eq(messages.externalId, `line:${ev.message.id}`)).get()) continue;
    const at = toBangkok(new Date(ev.timestamp));
    let brandId = db.select({ id: brandContacts.brandId }).from(brandContacts).where(and(eq(brandContacts.channel, "line"), eq(brandContacts.handle, userId))).get()?.id;
    if (!brandId) {
      // A new LINE chat becomes a new brand named after the LINE display name; rename it later on Brand 360.
      const { displayName } = await lineProfile(userId);
      brandId = db.insert(brands).values({ name: displayName, category: guessTags(ev.message.text).productCategory, createdAt: at }).returning({ id: brands.id }).get().id;
      db.insert(brandContacts).values({ brandId, name: displayName, role: "LINE", channel: "line", handle: userId, isPrimary: true }).run();
    }
    const brief = detector.detect(ev.message.text);
    db.insert(messages).values({ brandId, direction: "in", channel: "line", body: ev.message.text, sentAt: at, brief, briefStatus: brief ? "new" : "none", externalId: `line:${ev.message.id}` }).run();
  }
  revalidatePath("/", "layout");
  return new Response("OK");
}
