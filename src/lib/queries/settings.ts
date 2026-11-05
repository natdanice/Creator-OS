import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { appSettings } from "@/db/schema";
import { IS_LIVE, STORY_DATE } from "@/lib/config";
import { bangkokToday } from "@/lib/clock";

/** "Today" for every screen: the real Bangkok date in live mode, else the simulated story date stored by the seed. */
export function getStoryDate(db: DB): string {
  if (IS_LIVE) return bangkokToday();
  return db.select().from(appSettings).where(eq(appSettings.key, "story_date")).get()?.value ?? STORY_DATE;
}
