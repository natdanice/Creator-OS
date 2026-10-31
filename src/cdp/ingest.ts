/**
 * Runs one PlatformAdapter end-to-end:
 *   Dataflow (adapter → raw records) → classify comments → pseudonymize authors
 *   → Consent (register basis, redact withdrawn) → upsert rows → log an import_run.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { audienceBreakdown, audienceSnapshots, comments, contentMetricsDaily, contents, importRuns } from "@/db/schema";
import type { PlatformAdapter } from "./adapters/PlatformAdapter";
import { getClassifier } from "./classify";
import { Pseudonymizer } from "./pseudonymize";
import { applyConsent, registerAnalyticsBasis } from "./consent";

export interface IngestResult {
  runId: number;
  status: "success" | "partial" | "failed";
  contents: number;
  metricRows: number;
  comments: number;
  audienceSnapshots: number;
  message: string | null;
}

function chunks<T>(arr: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function ingest(db: DB, adapter: PlatformAdapter, now: string): Promise<IngestResult> {
  const platformId = adapter.platform;
  const warnings: string[] = [];

  let rawContents, rawMetrics, rawComments, rawAudience;
  try {
    [rawContents, rawMetrics, rawComments, rawAudience] = await Promise.all([
      adapter.importContents(),
      adapter.importMetrics(),
      adapter.importComments(),
      adapter.importAudience(),
    ]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const run = db
      .insert(importRuns)
      .values({ platformId, adapter: adapter.kind, startedAt: now, finishedAt: now, status: "failed", message })
      .returning({ id: importRuns.id })
      .get();
    return { runId: run.id, status: "failed", contents: 0, metricRows: 0, comments: 0, audienceSnapshots: 0, message };
  }

  // Classification is async (LLM-ready), so do it before the write transaction.
  const titleByExt = new Map(rawContents.map((c) => [c.externalId, c]));
  const needs = rawComments.filter((c) => !c.category);
  const labels = await getClassifier().classifyBatch(
    needs.map((c) => ({
      text: c.text,
      contentTitle: titleByExt.get(c.contentExternalId)?.title,
      productCategory: titleByExt.get(c.contentExternalId)?.productCategory,
    })),
  );
  const labelOf = new Map(needs.map((c, i) => [c, labels[i]]));
  const classifierName = getClassifier().name;

  const result = db.transaction((tx) => {
    // contents
    for (const c of rawContents) {
      tx.insert(contents)
        .values({ platformId, ...c, dealId: c.dealId ?? null })
        .onConflictDoUpdate({
          target: [contents.platformId, contents.externalId],
          set: { title: c.title, type: c.type, productCategory: c.productCategory, postedAt: c.postedAt, isSponsored: c.isSponsored },
        })
        .run();
    }
    const idByExt = new Map(
      tx.select({ id: contents.id, ext: contents.externalId }).from(contents).where(eq(contents.platformId, platformId)).all().map((r) => [r.ext, r.id]),
    );

    // metrics
    const metricRows = rawMetrics.flatMap((m) => {
      const contentId = idByExt.get(m.contentExternalId);
      if (!contentId) {
        warnings.push(`metric for unknown content ${m.contentExternalId}`);
        return [];
      }
      const { contentExternalId: _ignored, ...rest } = m;
      return [{ contentId, ...rest }];
    });
    for (const batch of chunks(metricRows)) {
      tx.insert(contentMetricsDaily)
        .values(batch)
        .onConflictDoUpdate({
          target: [contentMetricsDaily.contentId, contentMetricsDaily.date],
          set: {
            views: sql`excluded.views`,
            likes: sql`excluded.likes`,
            comments: sql`excluded.comments`,
            shares: sql`excluded.shares`,
            saves: sql`excluded.saves`,
            profileViews: sql`excluded.profile_views`,
            newFollowers: sql`excluded.new_followers`,
          },
        })
        .run();
    }

    // comments (pseudonymize; skip exact duplicates from re-imports)
    const pz = new Pseudonymizer(tx as unknown as DB);
    const seen = new Set<string>();
    const commentRows = rawComments.flatMap((c) => {
      const contentId = idByExt.get(c.contentExternalId);
      if (!contentId) {
        warnings.push(`comment for unknown content ${c.contentExternalId}`);
        return [];
      }
      const authorPseudoId = pz.idFor(c.authorHandle, c.createdAt);
      seen.add(authorPseudoId);
      return [
        {
          platformId,
          contentId,
          authorPseudoId,
          text: c.text,
          category: c.category ?? labelOf.get(c)!,
          classifier: c.category ? "source" : classifierName,
          createdAt: c.createdAt,
        },
      ];
    });
    let insertedComments = 0;
    for (const row of commentRows) {
      const dup = tx
        .select({ id: comments.id })
        .from(comments)
        .where(and(eq(comments.contentId, row.contentId), eq(comments.authorPseudoId, row.authorPseudoId), eq(comments.createdAt, row.createdAt)))
        .get();
      if (dup) continue;
      tx.insert(comments).values(row).run();
      insertedComments++;
    }

    // audience
    for (const a of rawAudience) {
      const snap = tx
        .insert(audienceSnapshots)
        .values({ platformId, month: a.month, followers: a.followers })
        .onConflictDoUpdate({ target: [audienceSnapshots.platformId, audienceSnapshots.month], set: { followers: a.followers } })
        .returning({ id: audienceSnapshots.id })
        .get();
      tx.delete(audienceBreakdown).where(eq(audienceBreakdown.snapshotId, snap.id)).run();
      const rows = (["age", "gender", "country"] as const).flatMap((dimension) =>
        Object.entries(a[dimension]).map(([bucket, pct]) => ({ snapshotId: snap.id, dimension, bucket, pct })),
      );
      if (rows.length) tx.insert(audienceBreakdown).values(rows).run();
    }

    // consent stage
    registerAnalyticsBasis(tx as unknown as DB, [...seen], now);
    applyConsent(tx as unknown as DB);

    const status: IngestResult["status"] = warnings.length ? "partial" : "success";
    const message = warnings.length ? `${warnings.length} warning(s): ${warnings.slice(0, 3).join("; ")}` : null;
    const run = tx
      .insert(importRuns)
      .values({
        platformId,
        adapter: adapter.kind,
        startedAt: now,
        finishedAt: now,
        status,
        contents: rawContents.length,
        metricRows: metricRows.length,
        comments: insertedComments,
        audienceSnapshots: rawAudience.length,
        message,
      })
      .returning({ id: importRuns.id })
      .get();
    return {
      runId: run.id,
      status,
      contents: rawContents.length,
      metricRows: metricRows.length,
      comments: insertedComments,
      audienceSnapshots: rawAudience.length,
      message,
    };
  });
  return result;
}
