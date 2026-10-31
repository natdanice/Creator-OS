import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { pseudonyms } from "@/db/schema";

/**
 * Real handles are hashed with a local salt and mapped to a sequential pseudo ID
 * (U0001…). Only the hash is persisted, so the original handle cannot be read back
 * from the database. In production the salt would live in a secret store.
 */
const SALT = process.env.PSEUDONYM_SALT ?? "creator-os-local-salt";

export function hashHandle(handle: string): string {
  return createHash("sha256").update(SALT + ":" + handle.trim().toLowerCase()).digest("hex");
}

export class Pseudonymizer {
  private cache = new Map<string, string>();
  private nextNum: number;

  constructor(private db: DB) {
    const row = db.select({ n: sql<number>`count(*)` }).from(pseudonyms).get();
    this.nextNum = (row?.n ?? 0) + 1;
  }

  idFor(handle: string, seenAt: string): string {
    const hash = hashHandle(handle);
    const cached = this.cache.get(hash);
    if (cached) return cached;
    const existing = this.db.select().from(pseudonyms).where(eq(pseudonyms.handleHash, hash)).get();
    if (existing) {
      this.cache.set(hash, existing.pseudoId);
      return existing.pseudoId;
    }
    const pseudoId = "U" + String(this.nextNum++).padStart(4, "0");
    this.db.insert(pseudonyms).values({ pseudoId, handleHash: hash, firstSeenAt: seenAt }).run();
    this.cache.set(hash, pseudoId);
    return pseudoId;
  }
}
