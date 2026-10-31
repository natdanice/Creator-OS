"use client";
/**
 * Write-once composer: one media file + main caption → per-platform overrides and options
 * → live validation + preview → one click publishes (or schedules) to every enabled platform.
 */
import { useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleAlert, ImageIcon, Send, Upload, Video } from "lucide-react";
import { publishPostAction } from "@/app/actions";
import { CONTENT_TYPES, PRODUCT_CATEGORIES, type ContentType, type ProductCategory } from "@/lib/constants";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { btn, PlatformTag, Pill } from "@/components/ui";
import { LIMITS, effectiveOptions, enabledPlatforms, finalCaption, fmtDuration, suggestTitle, validatePlatform, validateSchedule, type Issue } from "@/publish/rules";
import { DEFAULT_OPTIONS, PUBLISH_PLATFORMS, type ComposeDraft, type MediaInfo, type PlatformId, type PlatformOptionsMap } from "@/publish/types";
import type { CreateResult } from "@/publish/service";

export interface DealOption {
  id: number;
  title: string;
  brandName: string;
  category: ProductCategory;
}

interface UploadedMedia extends MediaInfo {
  id: number;
  name: string;
  sizeBytes: number;
  url: string;
}

const newDraft = (): ComposeDraft => ({
  mediaId: null,
  caption: "",
  hashtags: "",
  contentType: "review",
  productCategory: "skincare",
  dealId: null,
  sponsored: false,
  addAdTag: true,
  scheduledAt: null,
  platforms: {
    tiktok: { enabled: true, customCaption: null, options: { ...DEFAULT_OPTIONS.tiktok } },
    instagram: { enabled: true, customCaption: null, options: { ...DEFAULT_OPTIONS.instagram } },
    youtube: { enabled: true, customCaption: null, options: { ...DEFAULT_OPTIONS.youtube } },
  },
});

async function readMediaMeta(file: File): Promise<MediaInfo & { url: string }> {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("video/")) {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    await new Promise((res) => {
      v.onloadedmetadata = res;
      v.onerror = res;
    });
    return { kind: "video", url, durationSec: Number.isFinite(v.duration) ? v.duration : null, width: v.videoWidth || null, height: v.videoHeight || null };
  }
  const img = new Image();
  img.src = url;
  await new Promise((res) => {
    img.onload = res;
    img.onerror = res;
  });
  return { kind: "image", url, durationSec: null, width: img.naturalWidth || null, height: img.naturalHeight || null };
}

const field = `${btn.input} w-full`;
const label = "mb-1 block text-xs text-muted";

function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? "opacity-60" : ""}`}>
      <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function Composer({ deals, now }: { deals: DealOption[]; now: string }) {
  const { t } = useI18n();
  const P = t.publisher;
  const [draft, setDraft] = useState<ComposeDraft>(newDraft);
  const [media, setMedia] = useState<UploadedMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<ComposeDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setPlatform = <K extends PlatformId>(p: K, patch: Partial<ComposeDraft["platforms"][K]>) =>
    setDraft((d) => ({ ...d, platforms: { ...d.platforms, [p]: { ...d.platforms[p], ...patch } } }));
  const setOpt = <K extends PlatformId>(p: K, patch: Partial<PlatformOptionsMap[K]>) =>
    setDraft((d) => ({ ...d, platforms: { ...d.platforms, [p]: { ...d.platforms[p], options: { ...d.platforms[p].options, ...patch } } } }));

  const onCaption = (caption: string) =>
    setDraft((d) => {
      const next = { ...d, caption };
      if (!titleTouched) next.platforms = { ...d.platforms, youtube: { ...d.platforms.youtube, options: { ...d.platforms.youtube.options, title: suggestTitle(caption) } } };
      return next;
    });

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const meta = await readMediaMeta(file);
      const body = new FormData();
      body.append("file", file);
      if (meta.width) body.append("width", String(meta.width));
      if (meta.height) body.append("height", String(meta.height));
      if (meta.durationSec) body.append("durationSec", String(meta.durationSec));
      const res = await fetch("/api/media", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setMedia({ ...meta, id: json.id, name: json.name, sizeBytes: json.sizeBytes });
      const vertical = !meta.width || !meta.height || meta.height >= meta.width;
      setDraft((d) => ({
        ...d,
        mediaId: json.id,
        platforms: {
          ...d.platforms,
          // YouTube can't take an image; default the format from length + orientation.
          youtube: {
            ...d.platforms.youtube,
            enabled: meta.kind === "video" && d.platforms.youtube.enabled,
            options: { ...d.platforms.youtube.options, format: meta.kind === "video" && (meta.durationSec ?? 0) <= LIMITS.youtube.shortMaxSec && vertical ? "short" : "video" },
          },
        },
      }));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  const enabled = enabledPlatforms(draft);
  const issues = useMemo(() => {
    const out = {} as Record<PlatformId, Issue[]>;
    for (const p of PUBLISH_PLATFORMS) out[p] = draft.platforms[p].enabled ? validatePlatform(draft, p, media) : [];
    return out;
  }, [draft, media]);
  const scheduleIssues = validateSchedule(draft, now);
  const hasErrors = enabled.some((p) => issues[p].some((i) => i.level === "error")) || scheduleIssues.length > 0;
  const blocker = !media ? P.noMedia : enabled.length === 0 ? P.noPlatform : hasErrors ? P.fixErrors : null;

  const issueText = (p: PlatformId | null, i: Issue) => fmt(P.v[i.code], { ...(i.vars ?? {}), platform: p ? t.platforms[p] : "" });

  const publish = () =>
    start(async () => {
      const res = await publishPostAction(draft);
      setResult(res);
      if (res.ok) window.scrollTo({ top: 0, behavior: "smooth" });
    });

  const reset = () => {
    setDraft(newDraft());
    setMedia(null);
    setTitleTouched(false);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  if (result?.ok) {
    return (
      <div className="rounded-xl border border-good/30 bg-good-soft p-6">
        <div className="flex items-center gap-2 text-good">
          <CheckCircle2 size={20} aria-hidden />
          <h2 className="text-lg font-medium">{P.resultTitle}</h2>
          <Pill tone={result.status === "published" ? "good" : result.status === "scheduled" ? "accent" : "warn"}>{P.statuses[result.status!]}</Pill>
        </div>
        <p className="mt-2 text-sm text-ink-2">
          {enabled.map((p) => t.platforms[p]).join(" · ")} — {P.queue} ↓
        </p>
        <button className={`${btn.primary} mt-4`} onClick={reset}>
          {P.newPost}
        </button>
      </div>
    );
  }

  const selectedDeal = deals.find((d) => d.id === draft.dealId);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {/* 1 · Media */}
        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="text-base font-medium">1 · {P.media}</h2>
          <p className="mb-3 text-xs text-muted">{P.mediaHint}</p>
          <input ref={fileRef} type="file" accept="video/*,image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          {media ? (
            <div className="flex flex-wrap items-start gap-4">
              <div className="overflow-hidden rounded-lg bg-ink">
                {media.kind === "video" ? (
                  <video src={media.url} controls muted playsInline className="max-h-64 max-w-[240px]" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={media.url} alt="" className="max-h-64 max-w-[240px] object-contain" />
                )}
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  {media.kind === "video" ? <Video size={16} aria-hidden /> : <ImageIcon size={16} aria-hidden />}
                  {media.name}
                </div>
                <div className="text-xs text-muted">
                  {media.kind === "video" ? P.video : P.image} · {(media.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  {media.width && media.height && ` · ${media.width}×${media.height} (${media.height > media.width ? P.vertical : media.height === media.width ? P.square : P.horizontal})`}
                  {media.durationSec ? ` · ${fmtDuration(media.durationSec)}` : ""}
                </div>
                <button className={`${btn.ghost} mt-2`} onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {P.replace}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFile(e.dataTransfer.files?.[0]);
              }}
              disabled={uploading}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line bg-paper py-10 text-sm text-muted hover:border-accent hover:text-ink"
            >
              <Upload size={22} aria-hidden />
              {uploading ? P.uploading : P.chooseFile}
            </button>
          )}
          {uploadError && <p className="mt-2 text-xs text-bad">{uploadError}</p>}
        </section>

        {/* 2 · Main post */}
        <section className="space-y-3 rounded-xl border border-line bg-card p-5">
          <h2 className="text-base font-medium">2 · {P.post}</h2>
          <label className="block">
            <span className={label}>{P.caption}</span>
            <textarea rows={5} value={draft.caption} onChange={(e) => onCaption(e.target.value)} placeholder={P.captionPh} className={field} />
          </label>
          <label className="block">
            <span className={label}>{P.hashtags}</span>
            <input value={draft.hashtags} onChange={(e) => update({ hashtags: e.target.value })} placeholder={P.hashtagsPh} className={field} />
          </label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="block">
              <span className={label}>{t.common.type}</span>
              <select value={draft.contentType} onChange={(e) => update({ contentType: e.target.value as ContentType })} className={field}>
                {CONTENT_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {t.contentTypes[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>{t.common.category}</span>
              <select value={draft.productCategory} onChange={(e) => update({ productCategory: e.target.value as ProductCategory })} className={field}>
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t.categories[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>{P.deal}</span>
              <select
                value={draft.dealId ?? ""}
                onChange={(e) => {
                  const d = deals.find((x) => x.id === Number(e.target.value));
                  update({ dealId: d?.id ?? null, sponsored: !!d || (draft.sponsored && !draft.dealId), productCategory: d?.category ?? draft.productCategory });
                }}
                className={field}
              >
                <option value="">{P.noDeal}</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.brandName} — {d.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Check checked={draft.sponsored} disabled={!!draft.dealId} onChange={(v) => update({ sponsored: v })}>
              {P.disclosure}
            </Check>
            {draft.sponsored && (
              <Check checked={draft.addAdTag} onChange={(v) => update({ addAdTag: v })}>
                {P.addAdTag}
              </Check>
            )}
          </div>
          {selectedDeal && <p className="text-xs text-accent-strong">{P.v.disclosureForced}</p>}
        </section>

        {/* 3 · Platforms */}
        <section className="space-y-3">
          <h2 className="text-base font-medium">3 · {P.platforms}</h2>
          {PUBLISH_PLATFORMS.map((p) => {
            const pd = draft.platforms[p];
            const custom = pd.customCaption !== null;
            const eff = effectiveOptions(draft, p);
            return (
              <article key={p} className={`rounded-xl border bg-card transition-opacity ${pd.enabled ? "border-line" : "border-dashed border-line opacity-60"}`}>
                <header className="flex items-center justify-between border-b border-line px-5 py-3">
                  <PlatformTag id={p} />
                  <button
                    role="switch"
                    aria-checked={pd.enabled}
                    aria-label={t.platforms[p]}
                    onClick={() => setPlatform(p, { enabled: !pd.enabled })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${pd.enabled ? "bg-accent" : "bg-line"}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${pd.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </header>
                {pd.enabled && (
                  <div className="space-y-3 p-5">
                    {p === "youtube" && (
                      <label className="block">
                        <span className={label}>
                          {P.ytTitle}{" "}
                          <span className="tabular">
                            ({draft.platforms.youtube.options.title.length}/{LIMITS.youtube.title})
                          </span>
                        </span>
                        <input
                          value={draft.platforms.youtube.options.title}
                          onChange={(e) => {
                            setTitleTouched(true);
                            setOpt("youtube", { title: e.target.value });
                          }}
                          placeholder={P.ytTitlePh}
                          className={field}
                        />
                      </label>
                    )}
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs text-muted">{custom ? fmt(P.customCaption, { platform: t.platforms[p] }) : `${p === "youtube" ? P.description : P.caption}: ${P.useMain}`}</span>
                        <button className="text-xs font-medium text-accent-strong hover:underline" onClick={() => setPlatform(p, { customCaption: custom ? null : draft.caption })}>
                          {custom ? P.useMainBtn : P.customize}
                        </button>
                      </div>
                      {custom && <textarea rows={4} value={pd.customCaption ?? ""} onChange={(e) => setPlatform(p, { customCaption: e.target.value })} className={field} />}
                    </div>

                    {p === "tiktok" && (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className={label}>{P.privacy}</span>
                          <select value={draft.platforms.tiktok.options.privacy} onChange={(e) => setOpt("tiktok", { privacy: e.target.value as "public" })} className={field}>
                            {(["public", "friends", "private"] as const).map((v) => (
                              <option key={v} value={v}>
                                {P.privacyOpts[v]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="space-y-1.5 pt-1">
                          <Check checked={draft.platforms.tiktok.options.allowComments} onChange={(v) => setOpt("tiktok", { allowComments: v })}>
                            {P.allowComments}
                          </Check>
                          <Check checked={draft.platforms.tiktok.options.allowDuet} onChange={(v) => setOpt("tiktok", { allowDuet: v })}>
                            {P.allowDuet}
                          </Check>
                          <Check checked={draft.platforms.tiktok.options.allowStitch} onChange={(v) => setOpt("tiktok", { allowStitch: v })}>
                            {P.allowStitch}
                          </Check>
                          <Check checked={(eff as PlatformOptionsMap["tiktok"]).brandedContent} disabled={draft.sponsored} onChange={(v) => setOpt("tiktok", { brandedContent: v })}>
                            {P.brandedContent}
                          </Check>
                        </div>
                        {media?.kind === "image" && <p className="text-xs text-muted md:col-span-2">{P.photoMode}</p>}
                      </div>
                    )}

                    {p === "instagram" && (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className={label}>{P.format}</span>
                          <select value={draft.platforms.instagram.options.format} onChange={(e) => setOpt("instagram", { format: e.target.value as "reel" })} className={field}>
                            {(["reel", "feed", "story"] as const).map((v) => (
                              <option key={v} value={v}>
                                {P.igFormats[v]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className={label}>{P.collaborator}</span>
                          <input value={draft.platforms.instagram.options.collaborator} onChange={(e) => setOpt("instagram", { collaborator: e.target.value })} placeholder={P.collaboratorPh} className={field} />
                        </label>
                        <label className="block">
                          <span className={label}>{P.firstComment}</span>
                          <input value={draft.platforms.instagram.options.firstComment} onChange={(e) => setOpt("instagram", { firstComment: e.target.value })} placeholder={P.firstCommentPh} className={field} />
                        </label>
                        <label className="block">
                          <span className={label}>{P.location}</span>
                          <input value={draft.platforms.instagram.options.location} onChange={(e) => setOpt("instagram", { location: e.target.value })} className={field} />
                        </label>
                        <div className="space-y-1.5 md:col-span-2">
                          {draft.platforms.instagram.options.format === "reel" && (
                            <Check checked={draft.platforms.instagram.options.shareToFeed} onChange={(v) => setOpt("instagram", { shareToFeed: v })}>
                              {P.shareToFeed}
                            </Check>
                          )}
                          <Check checked={(eff as PlatformOptionsMap["instagram"]).paidPartnership} disabled={draft.sponsored} onChange={(v) => setOpt("instagram", { paidPartnership: v })}>
                            {P.paidPartnership}
                          </Check>
                        </div>
                      </div>
                    )}

                    {p === "youtube" && (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className={label}>{P.format}</span>
                          <select value={draft.platforms.youtube.options.format} onChange={(e) => setOpt("youtube", { format: e.target.value as "short" })} className={field}>
                            {(["short", "video"] as const).map((v) => (
                              <option key={v} value={v}>
                                {P.ytFormats[v]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className={label}>{P.visibility}</span>
                          <select value={draft.platforms.youtube.options.visibility} onChange={(e) => setOpt("youtube", { visibility: e.target.value as "public" })} className={field}>
                            {(["public", "unlisted", "private"] as const).map((v) => (
                              <option key={v} value={v}>
                                {P.visibilityOpts[v]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className={label}>{P.ytCategory}</span>
                          <select value={draft.platforms.youtube.options.category} onChange={(e) => setOpt("youtube", { category: e.target.value as "people" })} className={field}>
                            {(["people", "howto", "tech", "entertainment"] as const).map((v) => (
                              <option key={v} value={v}>
                                {P.ytCategories[v]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className={label}>{P.tags}</span>
                          <input value={draft.platforms.youtube.options.tags} onChange={(e) => setOpt("youtube", { tags: e.target.value })} placeholder={P.tagsPh} className={field} />
                        </label>
                        <fieldset className="md:col-span-2">
                          <legend className={label}>{P.madeForKids}</legend>
                          <div className="flex gap-4 text-sm">
                            {([false, true] as const).map((v) => (
                              <label key={String(v)} className="flex items-center gap-1.5">
                                <input type="radio" name="madeForKids" checked={draft.platforms.youtube.options.madeForKids === v} onChange={() => setOpt("youtube", { madeForKids: v })} className="accent-[var(--color-accent)]" />
                                {v ? P.yes : P.no}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <div className="md:col-span-2">
                          <Check checked={(eff as PlatformOptionsMap["youtube"]).paidPromotion} disabled={draft.sponsored} onChange={(v) => setOpt("youtube", { paidPromotion: v })}>
                            {P.paidPromotion}
                          </Check>
                        </div>
                      </div>
                    )}

                    {issues[p].length > 0 && (
                      <ul className="space-y-1">
                        {issues[p].map((i, k) => (
                          <li key={k} className={`flex items-start gap-1.5 text-xs ${i.level === "error" ? "text-bad" : "text-warn"}`}>
                            {i.level === "error" ? <CircleAlert size={14} className="mt-px shrink-0" aria-hidden /> : <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />}
                            {issueText(p, i)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          <p className="text-[11px] text-subtle">{P.rulesNote}</p>
        </section>
      </div>

      {/* Preview + publish */}
      <aside className="h-fit space-y-3 xl:sticky xl:top-6">
        <section className="rounded-xl border border-line bg-card">
          <h2 className="border-b border-line px-5 py-3 text-base font-medium">{P.preview}</h2>
          <div className="divide-y divide-line">
            {enabled.length === 0 && <p className="px-5 py-4 text-sm text-muted">{P.noPlatform}</p>}
            {enabled.map((p) => {
              const text = finalCaption(draft, p);
              const max = p === "youtube" ? LIMITS.youtube.description : LIMITS[p].caption;
              const eff = effectiveOptions(draft, p);
              const errs = issues[p].filter((i) => i.level === "error").length;
              const chips: string[] = [];
              if (p === "tiktok") {
                const o = eff as PlatformOptionsMap["tiktok"];
                chips.push(P.privacyOpts[o.privacy]);
                if (!o.allowDuet) chips.push(`${P.allowDuet} ✕`);
                if (!o.allowStitch) chips.push(`${P.allowStitch} ✕`);
                if (o.brandedContent) chips.push(P.brandedContent);
              } else if (p === "instagram") {
                const o = eff as PlatformOptionsMap["instagram"];
                chips.push(P.igFormats[o.format]);
                if (o.collaborator) chips.push(o.collaborator);
                if (o.paidPartnership) chips.push(P.paidPartnership);
              } else {
                const o = eff as PlatformOptionsMap["youtube"];
                chips.push(P.ytFormats[o.format], P.visibilityOpts[o.visibility]);
                if (o.paidPromotion) chips.push(P.paidPromotion);
              }
              return (
                <div key={p} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <PlatformTag id={p} />
                    <span className={`tabular text-[11px] ${text.length > max ? "text-bad" : "text-subtle"}`}>
                      {text.length}/{max}
                    </span>
                  </div>
                  {p === "youtube" && <div className="mt-2 line-clamp-2 text-sm font-medium">{draft.platforms.youtube.options.title || "—"}</div>}
                  <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-ink-2">{text || "—"}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {chips.map((c) => (
                      <span key={c} className="rounded bg-paper px-1.5 py-0.5 text-[11px] text-ink-2">
                        {c}
                      </span>
                    ))}
                    {errs > 0 && <Pill tone="bad">{errs} ✕</Pill>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-line bg-card p-5">
          <fieldset>
            <legend className={label}>{P.when}</legend>
            <div className="flex gap-2">
              {(["now", "schedule"] as const).map((m) => {
                const on = m === "now" ? !draft.scheduledAt : !!draft.scheduledAt;
                return (
                  <button
                    key={m}
                    onClick={() => update({ scheduledAt: m === "now" ? null : `${nextDay(now)}T18:00` })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm ${on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:bg-paper"}`}
                  >
                    {m === "now" ? P.now : P.schedule}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {draft.scheduledAt ? (
            <label className="block">
              <span className={label}>{P.scheduleAt}</span>
              <input type="datetime-local" value={draft.scheduledAt} min={now.slice(0, 16)} onChange={(e) => update({ scheduledAt: e.target.value || null })} className={field} />
            </label>
          ) : (
            <p className="text-[11px] text-subtle">
              {P.nowHint}: {now.slice(0, 10)}
            </p>
          )}
          {scheduleIssues.map((i, k) => (
            <p key={k} className="text-xs text-bad">
              {issueText(null, i)}
            </p>
          ))}
          {result && !result.ok && <p className="text-xs text-bad">{P.fixErrors}</p>}
          <button className={`${btn.primary} w-full py-3 text-base`} disabled={!!blocker || pending} onClick={publish}>
            {draft.scheduledAt ? <CalendarClock size={18} aria-hidden /> : <Send size={18} aria-hidden />}
            {pending ? P.publishing : fmt(draft.scheduledAt ? P.scheduleBtn : P.publishBtn, { n: enabled.length })}
          </button>
          {blocker && !pending && <p className="text-center text-xs text-muted">{blocker}</p>}
          <p className="text-[11px] leading-relaxed text-subtle">{P.mockNote}</p>
        </section>
      </aside>
    </div>
  );
}

function nextDay(now: string): string {
  const d = new Date(now.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
