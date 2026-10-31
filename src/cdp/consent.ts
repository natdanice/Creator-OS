/**
 * CDP stage 2 — CONSENT (PDPA).
 *
 * 1. Every audience member seen for the first time gets an `analytics` consent row
 *    with lawful basis "legitimate_interest" (public comments on the creator's own posts).
 * 2. If a subject withdraws/objects, `applyConsent()` wipes the text of their comments
 *    and flags them `redacted`, which removes them from every segment and analytic.
 * 3. Analytics queries must use `ANALYTICS_OK` when reading comments.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { comments, consents } from "@/db/schema";

export const REDACTED_TEXT = "[ถูกลบตามคำขอถอนความยินยอม]";

/** Use in WHERE clauses for any analytics over comments. */
export const ANALYTICS_OK = eq(comments.redacted, false);

export function registerAnalyticsBasis(db: DB, pseudoIds: string[], at: string) {
  if (pseudoIds.length === 0) return;
  const existing = new Set(
    db
      .select({ id: consents.subjectPseudoId })
      .from(consents)
      .where(and(eq(consents.purpose, "analytics"), inArray(consents.subjectPseudoId, pseudoIds)))
      .all()
      .map((r) => r.id),
  );
  const rows = pseudoIds
    .filter((id) => !existing.has(id))
    .map((id) => ({
      subjectPseudoId: id,
      purpose: "analytics" as const,
      lawfulBasis: "legitimate_interest" as const,
      status: "active" as const,
      source: "public_comment",
      grantedAt: at,
    }));
  for (let i = 0; i < rows.length; i += 500) db.insert(consents).values(rows.slice(i, i + 500)).run();
}

export function withdrawConsent(db: DB, pseudoId: string, at: string) {
  db.update(consents)
    .set({ status: "withdrawn", withdrawnAt: at })
    .where(eq(consents.subjectPseudoId, pseudoId))
    .run();
}

/** Redacts comments of every subject whose analytics consent is withdrawn. Returns rows affected. */
export function applyConsent(db: DB): number {
  const res = db
    .update(comments)
    .set({ text: REDACTED_TEXT, redacted: true })
    .where(
      and(
        eq(comments.redacted, false),
        inArray(
          comments.authorPseudoId,
          db
            .select({ id: consents.subjectPseudoId })
            .from(consents)
            .where(and(eq(consents.purpose, "analytics"), eq(consents.status, "withdrawn"))),
        ),
      ),
    )
    .run();
  return res.changes;
}

export function consentSummary(db: DB) {
  return db
    .select({
      purpose: consents.purpose,
      lawfulBasis: consents.lawfulBasis,
      status: consents.status,
      n: sql<number>`count(*)`,
    })
    .from(consents)
    .groupBy(consents.purpose, consents.lawfulBasis, consents.status)
    .all();
}
