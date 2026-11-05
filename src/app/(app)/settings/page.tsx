import { desc, eq, sql } from "drizzle-orm";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { getDb } from "@/db/client";
import { comments, connections, importRuns, platforms, rateCard, type Provider } from "@/db/schema";
import { consentSummary } from "@/cdp/consent";
import { CSV_COLUMNS } from "@/cdp/adapters/csv/CsvAdapter";
import { getStoryDate } from "@/lib/queries/settings";
import { CsvImportForm, ResetDemoButton } from "@/components/DataSourceForms";
import { btn, Card, PageHeader, Pill, PlatformTag } from "@/components/ui";
import { DisconnectButton, LogoutButton, SyncButton } from "@/components/settings/ConnectionButtons";
import { configured, envNames, redirectUri } from "@/connect/providers";
import { saveRatesAction } from "@/app/actions";
import { authEnabled } from "@/lib/auth";
import { APP_URL } from "@/lib/config";
import { fmt } from "@/lib/i18n";
import { num } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.settings.title };
}

const STATUS_TONE = { success: "good", partial: "warn", failed: "bad" } as const;

const PROVIDER_ORDER: Provider[] = ["google", "instagram", "tiktok", "line"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; connectError?: string }> }) {
  const { connected, connectError } = await searchParams;
  const { t, date, dateShort, live } = await getI18n();
  const db = getDb();
  const today = getStoryDate(db);
  const plats = db.select().from(platforms).all();
  const conns = db.select().from(connections).all();
  const cards = db.select().from(rateCard).all();
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
      <PageHeader title={t.settings.title} subtitle={`${live ? t.app.todayLive : t.settings.storyDate}: ${today}`} right={authEnabled() ? <LogoutButton /> : undefined} />

      <Card id="connections" title={t.connect.title} hint={t.connect.hint} className="mb-4 scroll-mt-6" bodyClass="px-5 pb-2 pt-1">
        {connected && <p role="status" className="mb-3 rounded-lg bg-good-soft px-3 py-2 text-sm text-good">{t.connect.connectedOk}</p>}
        {connectError && <p role="alert" className="mb-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{fmt(t.connect.connectFailed, { error: connectError })}</p>}
        {!live && <p className="mb-3 rounded-lg bg-paper px-3 py-2 text-sm text-ink-2">{t.connect.demoOnly}</p>}
        <ul className="divide-y divide-line">
          {PROVIDER_ORDER.map((p) => {
            const conn = conns.find((c) => c.provider === p);
            const ready = configured(p);
            const info = t.connect.providers[p];
            return (
              <li key={p} className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div className="min-w-0 max-w-xl">
                  <div className="font-medium">{info.name}</div>
                  <p className="text-xs text-muted">{info.what}</p>
                  {conn && (
                    <p className="mt-1 text-xs">
                      <span className="text-good">{fmt(t.connect.connectedAs, { account: conn.accountName })}</span>
                      <span className="text-muted"> · {conn.lastSyncAt ? fmt(t.connect.lastSync, { when: conn.lastSyncAt.slice(0, 16).replace("T", " ") + " UTC" }) : t.connect.neverSynced}</span>
                    </p>
                  )}
                  {conn?.lastError && <p className="mt-1 text-xs text-bad">{fmt(t.connect.lastError, { error: conn.lastError })}</p>}
                  {p === "line" && ready && <p className="mt-1 text-xs text-good">{t.connect.lineReady}</p>}
                  {!ready && <p className="mt-1 text-xs text-warn">{fmt(t.connect.notConfigured, { env: envNames(p).join(" + ") })}</p>}
                  {live && (
                    <p className="mt-1 break-all text-[11px] text-subtle">
                      {p === "line" ? t.connect.webhookUrl : t.connect.redirectUrl}: <code>{p === "line" ? `${APP_URL}/api/webhooks/line` : redirectUri(p)}</code>
                    </p>
                  )}
                </div>
                {live && ready && p !== "line" && (
                  <div className="flex flex-wrap items-center gap-3">
                    {conn && <SyncButton provider={p} />}
                    <a href={`/api/connect/${p}`} className={conn ? btn.ghost : btn.primary}>
                      {conn ? t.connect.reconnect : t.connect.connect}
                    </a>
                    {conn && <DisconnectButton provider={p} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

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
            {(live ? t.settings.pdpa.slice(0, -1) : t.settings.pdpa).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={t.rates.title} hint={t.rates.hint} className="mt-4">
        <form action={saveRatesAction}>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
            {cards.map((c) => (
              <label key={c.code} className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{c.name}</span>
                  <span className="block truncate text-xs text-muted">{c.description}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-muted">
                  ฿
                  <input id={`price_${c.code}`} name={`price_${c.code}`} defaultValue={c.price} inputMode="numeric" className={`${btn.input} tabular w-28 text-right`} />
                </span>
              </label>
            ))}
          </div>
          <button className={`${btn.primary} mt-4`}>{t.rates.save}</button>
        </form>
      </Card>

      {!live && (
        <Card title={t.settings.demo} hint={t.settings.demoHint} className="mt-4">
          <ResetDemoButton />
        </Card>
      )}
    </>
  );
}
