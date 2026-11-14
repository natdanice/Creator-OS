import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { brands, deals, mediaAssets, publications, publishJobs } from "@/db/schema";
import { stageAtLeast } from "@/crm/rules";
import { getStoryDate } from "@/lib/queries/settings";
import { bangkokNow } from "@/lib/clock";
import { IS_LIVE } from "@/lib/config";
import { publishTargets } from "@/publish/publishers";
import { getI18n } from "@/lib/i18n/server";
import { Card, PageHeader, Pill, PlatformTag } from "@/components/ui";
import { Composer, type DealOption } from "@/components/publisher/Composer";
import { QueueActions } from "@/components/publisher/QueueActions";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.publisher.title };
}

const TONE = { published: "good", scheduled: "accent", failed: "bad", cancelled: "neutral", partial: "warn" } as const;

export default async function PublisherPage() {
  const { t, date } = await getI18n();
  const P = t.publisher;
  const db = getDb();
  const now = IS_LIVE ? bangkokNow().slice(0, 16) : `${getStoryDate(db)}T10:00`;
  const targets = await publishTargets(db);

  const brandRows = db.select().from(brands).all();
  const allDeals = db.select().from(deals).all();
  // Deals that still need content: anything from Brief up to Posted.
  const dealOptions: DealOption[] = allDeals
    .filter((d) => stageAtLeast(d.stage, "brief") && !stageAtLeast(d.stage, "report_sent"))
    .map((d) => {
      const b = brandRows.find((x) => x.id === d.brandId)!;
      return { id: d.id, title: d.title, brandName: b.name, category: b.category };
    })
    .sort((a, b) => a.brandName.localeCompare(b.brandName));

  const jobs = db.select().from(publishJobs).orderBy(desc(publishJobs.id)).limit(30).all();
  const pubs = jobs.length ? db.select().from(publications).where(inArray(publications.jobId, jobs.map((j) => j.id))).all() : [];
  const media = jobs.length ? db.select().from(mediaAssets).where(inArray(mediaAssets.id, jobs.map((j) => j.mediaId))).all() : [];
  const dealOf = (id: number | null) => (id ? allDeals.find((x) => x.id === id) : undefined);

  return (
    <>
      <PageHeader title={P.title} subtitle={P.subtitle} />
      <Composer deals={dealOptions} now={now} live={IS_LIVE} targets={targets} />

      <Card title={P.queue} className="mt-8" bodyClass="overflow-x-auto">
        {jobs.length === 0 ? (
          <p className="p-5 text-sm text-muted">{P.queueEmpty}</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-normal">{P.colPost}</th>
                <th className="py-2.5 font-normal">{P.colPlatforms}</th>
                <th className="py-2.5 font-normal">{P.colWhen}</th>
                <th className="py-2.5 font-normal">{t.common.status}</th>
                <th className="px-5 py-2.5 text-right font-normal" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const m = media.find((x) => x.id === j.mediaId);
                const mine = pubs.filter((p) => p.jobId === j.id);
                const deal = dealOf(j.dealId);
                const when = j.status === "scheduled" ? j.scheduledAt : (mine.find((p) => p.publishedAt)?.publishedAt ?? j.scheduledAt ?? j.createdAt);
                return (
                  <tr key={j.id} className="border-b border-line align-top last:border-0">
                    <td className="max-w-[340px] px-5 py-3">
                      <div className="line-clamp-2 font-medium">{(mine.find((p) => p.title)?.title || j.caption.split("\n")[0] || m?.originalName) ?? "—"}</div>
                      <div className="mt-0.5 text-xs text-subtle">
                        {m?.originalName}
                        {deal && (
                          <>
                            {" · "}
                            <Link href={`/brands/${deal.brandId}`} className="text-accent-strong hover:underline">
                              {brandRows.find((b) => b.id === deal.brandId)?.name} — {deal.title}
                            </Link>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-3">
                      <ul className="max-w-[420px] space-y-1.5">
                        {mine.map((p) => (
                          <li key={p.id}>
                            <div className="flex flex-wrap items-center gap-2">
                              <PlatformTag id={p.platformId} />
                              <Pill tone={TONE[p.status]}>{P.statuses[p.status]}</Pill>
                              {p.url ? (
                                <a href={p.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent-strong hover:underline">
                                  {P.openPost} ↗
                                </a>
                              ) : (
                                p.externalId && <span className="tabular text-[11px] text-subtle">{p.externalId}</span>
                              )}
                            </div>
                            {p.status === "failed" && p.error && <p className="mt-0.5 text-xs text-bad">{p.error}</p>}
                            {p.note?.split("\n").map((n) => (
                              <p key={n} className="mt-0.5 text-xs text-warn">
                                {n}
                              </p>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="tabular py-3 text-xs text-ink-2">
                      {when ? `${date(when)} ${when.slice(11, 16)}` : "—"}
                    </td>
                    <td className="py-3">
                      <Pill tone={TONE[j.status]}>{P.statuses[j.status]}</Pill>
                    </td>
                    <td className="px-5 py-3">{["scheduled", "failed", "partial"].includes(j.status) && <QueueActions jobId={j.id} status={j.status} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
