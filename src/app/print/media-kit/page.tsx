/**
 * Media kit for brands, rebuilt from live data every time it is opened:
 * followers + demographics (latest snapshot), last-90-day performance, top posts, rate card.
 */
import { and, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contents, rateCard } from "@/db/schema";
import { audienceAsOf, totalFollowers } from "@/cdp/segments";
import { overviewData, PLATFORM_KEYS } from "@/lib/queries/overview";
import { getStoryDate } from "@/lib/queries/settings";
import { PrintFooter, PrintHeader } from "@/components/PrintHeader";
import { PlatformTag } from "@/components/ui";
import { addDays } from "@/lib/dates";
import { baht, compactNum, num, pct } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { getProfile } from "@/lib/queries/profile";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.mediaKit.title };
}

export default async function MediaKitPage() {
  const { t, date } = await getI18n();
  const db = getDb();
  const today = getStoryDate(db);
  const aud = audienceAsOf(db, today);
  const ov = overviewData(db, today, 90);
  const start = addDays(today, -89);
  const posts = db
    .select({ platformId: contents.platformId, n: sql<number>`count(*)` })
    .from(contents)
    .where(and(gte(sql`substr(${contents.postedAt}, 1, 10)`, start), lte(sql`substr(${contents.postedAt}, 1, 10)`, today)))
    .groupBy(contents.platformId)
    .all();
  const cards = db.select().from(rateCard).all().filter((c) => c.kind !== "addon");

  return (
    <>
      <PrintHeader
        title={t.mediaKit.title}
        right={
          <>
            <div className="text-muted">{t.mediaKit.followers}</div>
            <div className="tabular font-heading text-3xl font-semibold">{num(totalFollowers(aud))}</div>
            <div className="mt-1 text-xs text-muted">{date(today)}</div>
          </>
        }
      />
      <p className="-mt-4 mb-8 text-sm text-ink-2">{getProfile(db).tagline || t.mediaKit.tagline}</p>

      <section className="mb-8 break-inside-avoid">
        <h2 className="mb-3 text-lg font-medium">{t.mediaKit.audience}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {aud.map((a) => (
            <div key={a.platformId} className="rounded-lg border border-line p-4">
              <PlatformTag id={a.platformId} />
              <div className="tabular mt-1 font-heading text-2xl font-semibold">{compactNum(a.followers)}</div>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted">{t.mediaKit.topAge}</dt>
                  <dd className="tabular">{a.topAge ? `${a.topAge.bucket} (${a.topAge.pct.toFixed(0)}%)` : t.common.none}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">{t.mediaKit.women}</dt>
                  <dd className="tabular">{a.femalePct !== null ? `${a.femalePct.toFixed(0)}%` : t.common.none}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">{t.mediaKit.thailand}</dt>
                  <dd className="tabular">{a.thPct !== null ? `${a.thPct.toFixed(0)}%` : t.common.none}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8 break-inside-avoid">
        <h2 className="mb-3 text-lg font-medium">{t.mediaKit.performance}</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-2 font-normal">{t.common.platform}</th>
              <th className="py-2 text-right font-normal">{t.mediaKit.posts}</th>
              <th className="py-2 text-right font-normal">{t.mediaKit.views}</th>
              <th className="py-2 text-right font-normal">{t.mediaKit.er}</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {PLATFORM_KEYS.map((p) => (
              <tr key={p} className="border-b border-line">
                <td className="py-2">
                  <PlatformTag id={p} />
                </td>
                <td className="py-2 text-right">{posts.find((x) => x.platformId === p)?.n ?? 0}</td>
                <td className="py-2 text-right">{num(ov.kpis.views.byPlatform[p])}</td>
                <td className="py-2 text-right">{pct(ov.kpis.er.byPlatform[p], 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-8 break-inside-avoid">
        <h2 className="mb-3 text-lg font-medium">{t.mediaKit.topContent}</h2>
        <ol className="space-y-2 text-sm">
          {ov.top.slice(0, 5).map((c, i) => (
            <li key={c.key} className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
              <span className="min-w-0">
                <span className="tabular mr-2 text-muted">{i + 1}.</span>
                {c.title}
                {c.posts.map((p) => (
                  <span key={p.id} className="ml-2">
                    <PlatformTag id={p.platformId} />
                  </span>
                ))}
              </span>
              <span className="tabular shrink-0 text-ink-2">
                {num(c.views)} · ER {pct(c.er)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-8 break-inside-avoid">
        <h2 className="mb-3 text-lg font-medium">{t.mediaKit.rates}</h2>
        <table className="w-full text-sm">
          <tbody>
            {cards.map((c) => (
              <tr key={c.code} className="border-b border-line">
                <td className="py-2">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted">{c.description}</div>
                </td>
                <td className="tabular py-2 text-right">{baht(c.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <PrintFooter text={fmt(t.mediaKit.footer, { date: date(today) })} />
    </>
  );
}
