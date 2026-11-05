import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { appSettings, platforms } from "@/db/schema";

export interface CreatorProfile {
  name: string;
  tagline: string;
  handles: Record<string, string>;
}

/** The creator's own name, media-kit tagline and platform handles (Settings → Your profile). */
export function getProfile(db: DB): CreatorProfile {
  const get = (key: string) => db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? "";
  const handles = Object.fromEntries(db.select().from(platforms).all().map((p) => [p.id, p.handle === "—" ? "" : p.handle]));
  return { name: get("creator_name") || "Creator", tagline: get("creator_tagline"), handles };
}

export function setSetting(db: DB, key: string, value: string) {
  db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } }).run();
}
