import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

export const DB_PATH = path.join(process.cwd(), "data", "creator-os.db");

export type DB = BetterSQLite3Database<typeof schema>;

export function openDb(file = DB_PATH): { db: DB; sqlite: Database.Database } {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return { db: drizzle(sqlite, { schema }), sqlite };
}

// Reuse one connection across hot reloads in dev. If the file is replaced
// (`npm run seed` or "Reset demo" while the server runs), reopen it.
const g = globalThis as unknown as { __creatorDb?: DB; __creatorSqlite?: Database.Database; __creatorDbIno?: number };

export function getDb(): DB {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error("Database not found. Run `npm run seed` first.");
  }
  const ino = fs.statSync(DB_PATH).ino;
  if (!g.__creatorDb || g.__creatorDbIno !== ino) {
    try {
      g.__creatorSqlite?.close();
    } catch {}
    const { db, sqlite } = openDb();
    g.__creatorDb = db;
    g.__creatorSqlite = sqlite;
    g.__creatorDbIno = ino;
  }
  return g.__creatorDb;
}
