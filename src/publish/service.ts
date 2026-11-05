/**
 * Publishing workflow.
 *   createJob  → validates every enabled platform, stores one publish_job + one publication per platform
 *   publishJob → sends each publication through its PlatformPublisher; successful posts become
 *                `contents` rows (so they flow into the CDP), and a linked deal moves to Posted
 *   publishDue → called by the daily 10:00 automation run for scheduled jobs that are due
 */
import path from "node:path";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import type { DB } from "@/db/client";
import { activities, contents, deals, mediaAssets, publications, publishJobs, type PublishStatus } from "@/db/schema";
import { stageAtLeast } from "@/crm/rules";
import { dataT, fmt } from "@/lib/i18n";
import { getPublisher } from "./MockPublisher";
import { stamp } from "@/lib/clock";
import { effectiveOptions, enabledPlatforms, finalCaption, validatePlatform, validateSchedule, type Issue } from "./rules";
import type { ComposeDraft, MediaInfo, PlatformId } from "./types";

export const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

export interface CreateResult {
  ok: boolean;
  jobId?: number;
  status?: PublishStatus;
  issues?: Partial<Record<PlatformId | "schedule" | "general", Issue[]>>;
}

function mediaInfo(m: typeof mediaAssets.$inferSelect): MediaInfo {
  return { kind: m.kind, durationSec: m.durationSec, width: m.width, height: m.height };
}

export async function createJob(db: DB, draft: ComposeDraft, now: string): Promise<CreateResult> {
  const media = draft.mediaId ? db.select().from(mediaAssets).where(eq(mediaAssets.id, draft.mediaId)).get() : undefined;
  const platforms = enabledPlatforms(draft);
  if (!media || platforms.length === 0) return { ok: false, issues: { general: [] } };

  const issues: CreateResult["issues"] = {};
  for (const p of platforms) {
    const errs = validatePlatform(draft, p, mediaInfo(media)).filter((i) => i.level === "error");
    if (errs.length) issues[p] = errs;
  }
  const sched = validateSchedule(draft, now);
  if (sched.length) issues.schedule = sched;
  if (Object.keys(issues).length) return { ok: false, issues };

  const jobId = db.transaction((tx) => {
    const job = tx
      .insert(publishJobs)
      .values({
        mediaId: media.id,
        caption: draft.caption,
        hashtags: draft.hashtags,
        contentType: draft.contentType,
        productCategory: draft.productCategory,
        dealId: draft.dealId,
        sponsored: draft.sponsored,
        scheduledAt: draft.scheduledAt ? `${draft.scheduledAt.slice(0, 16)}:00` : null,
        status: "scheduled",
        createdAt: now,
      })
      .returning({ id: publishJobs.id })
      .get();
    for (const p of platforms) {
      const options = effectiveOptions(draft, p) as unknown as Record<string, unknown>;
      tx.insert(publications)
        .values({
          jobId: job.id,
          platformId: p,
          title: p === "youtube" ? draft.platforms.youtube.options.title.trim() : null,
          caption: finalCaption(draft, p),
          options,
          status: "scheduled",
        })
        .run();
    }
    return job.id;
  });

  if (!draft.scheduledAt) await publishJob(db, jobId, now);
  const status = db.select({ s: publishJobs.status }).from(publishJobs).where(eq(publishJobs.id, jobId)).get()!.s;
  return { ok: true, jobId, status };
}

export async function publishJob(db: DB, jobId: number, at: string) {
  const job = db.select().from(publishJobs).where(eq(publishJobs.id, jobId)).get();
  if (!job || job.status !== "scheduled") return;
  const media = db.select().from(mediaAssets).where(eq(mediaAssets.id, job.mediaId)).get()!;
  const pubs = db.select().from(publications).where(and(eq(publications.jobId, jobId), eq(publications.status, "scheduled"))).all();

  const results = await Promise.all(
    pubs.map(async (pub) => {
      const platform = pub.platformId as PlatformId;
      try {
        const res = await getPublisher(platform).publish({
          platform,
          media: { ...mediaInfo(media), path: path.join(UPLOAD_DIR, media.storedName), mime: media.mime },
          title: pub.title,
          caption: pub.caption,
          options: pub.options as never,
        });
        return { pub, res };
      } catch (e) {
        return { pub, res: { ok: false, error: e instanceof Error ? e.message : String(e) } };
      }
    }),
  );

  db.transaction((tx) => {
    let okCount = 0;
    for (const { pub, res } of results) {
      if (!res.ok) {
        tx.update(publications).set({ status: "failed", error: res.error ?? "unknown error" }).where(eq(publications.id, pub.id)).run();
        continue;
      }
      okCount++;
      const title = (pub.title || pub.caption.split("\n")[0] || media.originalName).slice(0, 90);
      const content = tx
        .insert(contents)
        .values({
          platformId: pub.platformId,
          externalId: res.externalId!,
          title,
          type: job.contentType,
          productCategory: job.productCategory,
          postedAt: at,
          isSponsored: job.sponsored,
          dealId: job.dealId,
        })
        .returning({ id: contents.id })
        .get();
      tx.update(publications).set({ status: "published", externalId: res.externalId, contentId: content.id, publishedAt: at }).where(eq(publications.id, pub.id)).run();
    }
    const status: PublishStatus = okCount === results.length ? "published" : okCount === 0 ? "failed" : "partial";
    tx.update(publishJobs).set({ status }).where(eq(publishJobs.id, jobId)).run();

    // A sponsored post going live moves its deal to Posted (which later triggers the +7 / +30 report rules).
    if (okCount && job.dealId) {
      const deal = tx.select().from(deals).where(eq(deals.id, job.dealId)).get();
      if (deal && !stageAtLeast(deal.stage, "posted")) {
        tx.update(deals).set({ stage: "posted", postedAt: at }).where(eq(deals.id, deal.id)).run();
        const names = results.filter((r) => r.res.ok).map((r) => dataT.platforms[r.pub.platformId as PlatformId]).join(" + ");
        tx.insert(activities)
          .values({ brandId: deal.brandId, dealId: deal.id, type: "posted", channel: "system", summary: fmt(dataT.templates.postedViaPublisher, { platforms: names }), occurredAt: at })
          .run();
      }
    }
  });
}

/** Publish every scheduled job due at or before `today` 10:00 (the simulated cron). */
export async function publishDue(db: DB, today: string): Promise<number> {
  const cutoff = stamp(today);
  const due = db
    .select()
    .from(publishJobs)
    .where(and(eq(publishJobs.status, "scheduled"), isNotNull(publishJobs.scheduledAt), lte(publishJobs.scheduledAt, cutoff)))
    .all();
  for (const job of due) await publishJob(db, job.id, job.scheduledAt!);
  return due.length;
}

export function cancelJob(db: DB, jobId: number) {
  db.transaction((tx) => {
    tx.update(publishJobs).set({ status: "cancelled" }).where(and(eq(publishJobs.id, jobId), eq(publishJobs.status, "scheduled"))).run();
    tx.update(publications)
      .set({ status: "cancelled" })
      .where(and(eq(publications.jobId, jobId), inArray(publications.status, ["scheduled"])))
      .run();
  });
}
