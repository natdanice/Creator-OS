import { desc, eq, sql } from "drizzle-orm";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { getDb } from "@/db/client";
import { comments, importRuns, platforms } from "@/db/schema";
import { consentSummary } from "@/cdp/consent";
import { CSV_COLUMNS } from "@/cdp/adapters/csv/CsvAdapter";
import { getStoryDate } from "@/lib/queries/settings";
import { CsvImportForm, ResetDemoButton } from "@/components/DataSourceForms";
import { Card, PageHeader, Pill, PlatformTag } from "@/components/ui";
import { num } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.settings.title };
}

const STATUS_TONE = { success: "good", partial: "warn", failed: "bad" } as const;

export default async function SettingsPage() {
  const { t, date, dateShort } = await getI18n();
  const db = getDb();
  const today = getStoryDate(db);
  const plats = db.select().from(platforms).all();
  const runs = db.select().from(importRuns).orderBy(desc(importRuns.startedAt), desc(importRuns.id)).all();
  const consent = consentSummary(db);
  const redacted = db.select({ n: sql<number>`count(*)` }).from(comments).where(eq(comments.redacted, true)).get()!.n;
  const stages = [
    [t.settings.stage1, t.settings.stage1Hint],
    [t.settings.stage2, t.settings.stage2Hint],
    [t.settings.stage3, t.settings.stage3Hint],
    [t.settings.stage4, t.settings.stage4Hint],
  ];

  return (
    <>
      <PageHeader title={t.settings.title} subtitle={`${t.settings.storyDate}: ${today}`} />

      <Card title={t.settings.pipeline} className="mb-4">
        <ol className="grid grid-cols-1 gap-2 md:grid-cols-4">
          {stages.map(([name, hint], i) => (
            <li key={name} className="relative rounded-lg border border-line bg-paper p-3">
              <div className="text-xs text-muted">{i + 1}</div>
              <div className="font-heading font-medium">{name}</div>
              <div className="mt-1 text-xs text-muted">{hint}</div>
              {i < 3 && <ArrowRight size={16} className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white text-accent md:block" aria-hidden />}
            </li>
          ))}
        </ol>
      </Card>

      <h2 className="mb-1 text-lg font-medium">{t.settings.dataSources}</h2>
      <p className="mb-3 text-sm text-muted">{t.settings.dataSourcesHint}</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {plats.map((p) => {
          const last = runs.find((r) => r.platformId === p.id);
          return (
            <Card key={p.id} title={<PlatformTag id={p.id} />} right={last && <Pill tone={STATUS_TONE[last.status]}>{t.settings.status[last.status]}</Pill>}>
              {last ? (
                <dl className="mb-4 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted">{t.settings.lastImport}</dt>
                    <dd className="tabular">{last.startedAt.replace("T", " ").slice(0, 16)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">{t.settings.adapter}</dt>
                    <dd>{last.adapter}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">{t.settings.rows}</dt>
                    <dd className="tabular">
                      {num(last.contents)} / {num(last.metricRows)} / {num(last.comments)} / {num(last.audienceSnapshots)}
                    </dd>
                  </div>
                  {last.message && <p className="rounded bg-bad-soft p-2 text-bad">{last.message}</p>}
                </dl>
              ) : (
                <p className="mb-4 text-xs text-muted">{t.settings.neverImported}</p>
              )}
              <CsvImportForm platform={p.id} />
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer">{t.settings.csvColumns}</summary>
                <p className="mt-1 leading-relaxed">{[...Object.values(CSV_COLUMNS[p.id as "tiktok"]), "Type", "Category", "Sponsored"].join(", ")}</p>
              </details>
            </Card>
          );
        })}
      </div>

      <Card title={t.settings.history} className="mt-4" bodyClass="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="px-5 py-2.5 font-normal">{t.common.date}</th>
              <th className="py-2.5 font-normal">{t.common.platform}</th>
              <th className="py-2.5 font-normal">{t.settings.adapter}</th>
              <th className="py-2.5 font-normal">{t.common.status}</th>
              <th className="px-5 py-2.5 text-right font-normal">contents / metrics / comments / audience</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="tabular px-5 py-2">{r.startedAt.replace("T", " ").slice(0, 16)}</td>
                <td className="py-2">
                  <PlatformTag id={r.platformId} />
                </td>
                <td className="py-2">{r.adapter}</td>
                <td className="py-2">
                  <Pill tone={STATUS_TONE[r.status]}>{t.settings.status[r.status]}</Pill>
                </td>
                <td className="tabular px-5 py-2 text-right text-xs">
                  {r.status === "failed" ? <span className="text-bad">{r.message}</span> : `${num(r.contents)} / ${num(r.metricRows)} / ${num(r.comments)} / ${num(r.audienceSnapshots)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t.settings.consent} hint={t.settings.consentHint} bodyClass="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-normal">{t.settings.purpose}</th>
                <th className="py-2.5 font-normal">{t.settings.basis}</th>
                <th className="py-2.5 font-normal">{t.common.status}</th>
                <th className="px-5 py-2.5 text-right font-normal">{t.settings.count}</th>
              </tr>
            </thead>
            <tbody>
              {consent.map((c) => (
                <tr key={`${c.purpose}-${c.lawfulBasis}-${c.status}`} className="border-b border-line last:border-0">
                  <td className="px-5 py-2">{t.settings.purposes[c.purpose]}</td>
                  <td className="py-2">{t.settings.bases[c.lawfulBasis]}</td>
                  <td className="py-2">
                    <Pill tone={c.status === "active" ? "good" : "warn"}>{t.settings.consentStatus[c.status]}</Pill>
                  </td>
                  <td className="tabular px-5 py-2 text-right">{num(c.n)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="px-5 py-2 text-muted">
                  {t.settings.redacted}
                </td>
                <td className="tabular px-5 py-2 text-right">{num(redacted)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card
          title={
            <span className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-good" aria-hidden />
              {t.settings.pdpaTitle}
            </span>
          }
        >
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
            {t.settings.pdpa.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={t.settings.demo} hint={t.settings.demoHint} className="mt-4">
        <ResetDemoButton />
      </Card>
    </>
  );
}
