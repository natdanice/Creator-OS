/** Applies new migrations to the current database (keeps all data). Used by `start:live`. */
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DB_PATH, openDb } from "@/db/client";

const { db, sqlite } = openDb(DB_PATH);
migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
sqlite.close();
console.log(`✓ Migrations applied to ${DB_PATH}`);
