import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { appSettings } from "@/db/schema";
import { STORY_DATE } from "@/lib/config";

/** The simulated "today" all screens use. Stored in the DB so the seed and the app agree. */
export function getStoryDate(db: DB): string {
  return db.select().from(appSettings).where(eq(appSettings.key, "story_date")).get()?.value ?? STORY_DATE;
}
