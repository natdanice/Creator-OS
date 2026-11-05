/**
 * Creates the EMPTY live database (your real data): tables, platforms, the starting
 * rate card and the automation rules. No mock story. Refuses to overwrite an existing file.
 *   npm run setup:live            → data/creator-os-live.db (or DATABASE_PATH)
 */
import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDb } from "@/db/client";
import { insertReferenceData } from "@/seed/seedDatabase";

const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "creator-os-live.db");
if (fs.existsSync(file)) {
  console.error(`✗ ${file} already exists. It may hold your real data, so it was not touched.`);
  process.exit(1);
}
const { db, sqlite } = openDb(file);
migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
insertReferenceData(db, { tiktok: "—", instagram: "—", youtube: "—" });
sqlite.close();
console.log(`✓ Created ${file}\nNext: set APP_MODE=live, APP_PASSWORD and AUTH_SECRET in .env.local, then npm run dev`);
