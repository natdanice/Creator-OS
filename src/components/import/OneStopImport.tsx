"use client";
/**
 * One-stop import: drop any files → Creator OS recognises each table and imports the confident
 * ones at once → anything it isn't sure about waits here with its best guess for one click.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleHelp, Loader2, Sparkles, Upload } from "lucide-react";
import { btn, Pill, PlatformTag } from "@/components/ui";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { KINDS, PLATFORM_KINDS, type Kind, type Plan, type PlanItem, type PlatformId } from "@/import/types";

const PLATFORMS: PlatformId[] = ["tiktok", "instagram", "youtube"];
const CHOOSABLE = KINDS.filter((k) => k !== "creator_workbook");

/** Where each kind of data shows up in the app. */
const WHERE: Partial<Record<Kind, string>> = {
  posts: "/",
  account_daily: "/",
  creator_workbook: "/",
  comments: "/inbox?tab=comments",
  audience_age: "/audience",
  audience_gender: "/audience",
  audience_country: "/audience",
  brands_deals: "/brands",
};

type Choice = { kind: Kind; platform: PlatformId | null; mapping?: Record<string, string> };

export function OneStopImport({ aiOn }: { aiOn: boolean }) {
  const { t } = useI18n();
  const I = t.importer;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const choiceOf = (it: PlanItem): Choice => choices[it.tableId] ?? { kind: it.detection.kind, platform: it.detection.platform };
  const needsPlatform = (c: Choice) => PLATFORM_KINDS.has(c.kind) && !c.platform;

  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(fmt(I.reading, { n: files.length }));
    setError(null);
    try {
      const body = new FormData();
      for (const f of files) body.append("files", f);
      const res = await fetch("/api/import", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setPlan(json);
      setChoices({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function decide(items: PlanItem[], skip = false) {
    if (!plan) return;
    setBusy(I.working);
    setError(null);
    try {
      const decisions = items.map((it) => ({ tableId: it.tableId, skip, ...choiceOf(it) }));
      const res = await fetch("/api/import/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: plan.batchId, decisions }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setPlan(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const waiting = plan?.items.filter((i) => i.status === "needs_you") ?? [];
  const done = plan?.items.filter((i) => i.status === "imported") ?? [];
  const rest = plan?.items.filter((i) => i.status === "skipped" || i.status === "failed") ?? [];
  const columnsMissing = (it: PlanItem) => (it.missing ?? []).some((f) => !choiceOf(it).mapping?.[f]);
  const ready = waiting.filter((it) => choiceOf(it).kind !== "unknown" && !needsPlatform(choiceOf(it)) && !columnsMissing(it));
  const name = (it: PlanItem) => (it.sheet ? `${it.file} › ${it.sheet}` : it.file);

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <section>
        <input ref={input} type="file" multiple accept=".csv,.tsv,.txt,.xlsx,.xlsm" className="hidden" onChange={(e) => upload([...(e.target.files ?? [])])} />
        <button
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            upload([...e.dataTransfer.files]);
          }}
          disabled={!!busy}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-12 text-center transition-colors ${over ? "border-accent bg-accent-soft" : "border-line bg-card hover:border-accent"}`}
        >
          {busy ? <Loader2 size={24} className="animate-spin text-accent" aria-hidden /> : <Upload size={24} className="text-muted" aria-hidden />}
          <span className="font-medium">{busy ?? (plan ? I.uploadMore : I.drop)}</span>
          <span className="text-xs text-muted">{I.dropHint}</span>
        </button>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
          <Sparkles size={13} className={`mt-px shrink-0 ${aiOn ? "text-accent" : ""}`} aria-hidden />
          <span>
            {aiOn ? I.aiOn : I.aiOff}. {aiOn && I.privacy}
          </span>
        </p>
        {error && (
          <p role="alert" className="mt-2 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
      </section>

      {/* Waiting for the creator */}
      {waiting.length > 0 && (
        <section aria-labelledby="waiting">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="waiting" className="flex items-center gap-2 text-lg font-medium">
                <CircleHelp size={18} className="text-warn" aria-hidden /> {I.needsYou}
              </h2>
              <p className="text-xs text-muted">{I.needsYouHint}</p>
            </div>
            {ready.length > 1 && (
              <button className={btn.primary} disabled={!!busy} onClick={() => decide(ready)}>
                {fmt(I.importAll, { n: ready.length })}
              </button>
            )}
          </div>
          <ul className="space-y-3">
            {waiting.map((it) => {
              const c = choiceOf(it);
              const set = (patch: Partial<Choice>) => setChoices((s) => ({ ...s, [it.tableId]: { ...c, ...patch } }));
              const guess = it.detection.kind !== "unknown";
              return (
                <li key={it.tableId} className="rounded-xl border border-line bg-card p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium break-all">{name(it)}</span>
                    <span className="text-xs text-muted">{fmt(I.rows, { n: it.rows })}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">
                    {guess ? (
                      <>
                        {I.looksLike} <strong className="font-medium">{I.kinds[it.detection.kind]}</strong>
                        {it.detection.platform && <> · {t.platforms[it.detection.platform]}</>} <span className="text-xs text-subtle">({I.by[it.detection.by]})</span>
                      </>
                    ) : (
                      I.notRecognised
                    )}
                    {it.message && <span className="text-warn"> — {it.message}</span>}
                  </p>
                  {it.headers.length > 0 && (
                    <p className="mt-1 line-clamp-2 text-xs text-subtle">
                      {I.columns}: {it.headers.join(" · ")}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-muted">{I.whatIsIt}</span>
                      <select value={c.kind} onChange={(e) => set({ kind: e.target.value as Kind })} className={btn.input}>
                        {CHOOSABLE.map((k) => (
                          <option key={k} value={k}>
                            {I.kinds[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {PLATFORM_KINDS.has(c.kind) && (
                      <label className="block">
                        <span className="mb-1 block text-xs text-muted">{I.platform}</span>
                        <select value={c.platform ?? ""} onChange={(e) => set({ platform: (e.target.value || null) as PlatformId | null })} className={btn.input}>
                          <option value="">{I.pickPlatform}</option>
                          {PLATFORMS.map((p) => (
                            <option key={p} value={p}>
                              {t.platforms[p]}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {c.kind === it.detection.kind &&
                      (it.missing ?? []).map((f) => (
                        <label key={f} className="block">
                          <span className="mb-1 block text-xs text-muted">
                            {I.whichColumn} {I.fields[f as keyof typeof I.fields] ?? f}?
                          </span>
                          <select value={c.mapping?.[f] ?? ""} onChange={(e) => set({ mapping: { ...c.mapping, [f]: e.target.value } })} className={btn.input}>
                            <option value="">{I.pickColumn}</option>
                            {it.headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    <div className="flex gap-2">
                      <button className={btn.primary} disabled={!!busy || c.kind === "unknown" || needsPlatform(c) || (c.kind === it.detection.kind && columnsMissing(it))} onClick={() => decide([it])}>
                        {I.importBtn}
                      </button>
                      <button className={btn.ghost} disabled={!!busy} onClick={() => decide([it], true)}>
                        {I.skip}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Imported */}
      {done.length > 0 && (
        <section aria-labelledby="done">
          <h2 id="done" className="mb-3 flex items-center gap-2 text-lg font-medium">
            <CheckCircle2 size={18} className="text-good" aria-hidden /> {I.imported}
          </h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-card">
            {done.map((it) => (
              <li key={it.tableId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{I.kinds[it.detection.kind]}</span>
                    {it.detection.platform && <PlatformTag id={it.detection.platform} />}
                    <Pill tone={it.detection.by === "ai" ? "accent" : "neutral"}>{I.by[it.detection.by]}</Pill>
                  </div>
                  <p className="mt-0.5 text-xs text-muted break-all">{name(it)}</p>
                  <p className="mt-0.5 text-sm text-ink-2">{it.message}</p>
                </div>
                {WHERE[it.detection.kind] && (
                  <Link href={WHERE[it.detection.kind]!} className="shrink-0 text-sm font-medium text-accent-strong hover:underline">
                    {I.see} →
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {waiting.length === 0 && <p className="mt-3 text-sm text-good">{I.allDone}</p>}
        </section>
      )}

      {/* Skipped or failed */}
      {rest.length > 0 && (
        <section aria-labelledby="rest">
          <h2 id="rest" className="sr-only">
            {I.skipped}
          </h2>
          <ul className="space-y-1.5">
            {rest.map((it) => (
              <li key={it.tableId} className={`flex items-start gap-2 text-sm ${it.status === "failed" ? "text-bad" : "text-muted"}`}>
                <CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium">{it.status === "failed" ? I.failed : I.skipped}:</span> <span className="break-all">{name(it)}</span>
                  {(it.message || it.detection.reason) && <> — {it.message || it.detection.reason}</>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
