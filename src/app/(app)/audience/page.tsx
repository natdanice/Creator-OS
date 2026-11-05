import Link from "next/link";
import { FileText, ShieldCheck, X } from "lucide-react";
import { getDb } from "@/db/client";
import type { ProductCategory } from "@/db/schema";
import { audienceProfile, audienceSegments, availableMonths, demographics, followerSeries, segmentMembers, SEGMENT_WINDOW_DAYS, SUPERFAN_MIN_COMMENTS, type SegmentId } from "@/cdp/profiles";
import { productQuestionSpikes } from "@/cdp/segments";
import { PLATFORM_KEYS, type PlatformKey } from "@/lib/queries/overview";
import { getStoryDate } from "@/lib/queries/settings";
import { ButtonLink, Card, PageHeader, Pill, PlatformTag, ShareBar, StatStrip, StatTile } from "@/components/ui";
import { FollowerGrowthChart } from "@/components/charts/FollowerGrowthChart";
import { num, signedPct } from "@/lib/format";
import { fmt, type Dict, type I18n } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.audience.title };
}

type Params = { month?: string; p?: string; segment?: string; member?: string };

function segmentName(t: Dict, id: SegmentId) {
  if (id.startsWith("askers_")) return fmt(t.audience.segs.askers.name, { category: t.categories[id.slice(7) as ProductCategory] });
  return t.audience.segs[id as "superfans"].name;
}
function segmentDesc(t: Dict, id: SegmentId) {
  if (id.startsWith("askers_")) return fmt(t.audience.segs.askers.desc, { category: t.categories[id.slice(7) as ProductCategory] });
  return fmt(t.audience.segs[id as "superfans"].desc, { n: SUPERFAN_MIN_COMMENTS });
}

export default async function AudiencePage({ searchParams }: { searchParams: Promise<Params> }) {
  const i18n = await getI18n();
  const { t, date } = i18n;
  const params = await searchParams;
  const db = getDb();
  const today = getStoryDate(db);
  const months = availableMonths(db, today);
  const month = params.month && months.includes(params.month) ? params.month : months[0];
  const platform: PlatformKey = PLATFORM_KEYS.includes(params.p as PlatformKey) ? (params.p as PlatformKey) : "tiktok";
  const series = followerSeries(db, today);
  const last = series.at(-1);
  const yearAgo = series.at(-13);
  const demo = demographics(db, month).find((d) => d.platformId === platform);
  const seg = audienceSegments(db, today);
  const spikes = new Set(productQuestionSpikes(db, today).filter((s) => s.isSpike).map((s) => `askers_${s.category}`));
  const segmentIds = seg.summaries.map((s) => s.id);
  const segment = segmentIds.includes(params.segment as SegmentId) ? (params.segment as SegmentId) : null;
  const members = segment ? segmentMembers(db, today, segment, 30) : null;
  const profile = params.member ? audienceProfile(db, params.member, today) : null;

  const href = (patch: Partial<Params>, hash = "") => {
    const q = new URLSearchParams(Object.entries({ ...params, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/audience${q.size ? `?${q}` : ""}${hash}`;
  };
  const total = last ? PLATFORM_KEYS.reduce((s, p) => s + (last[p] ?? 0), 0) : 0;
  const totalYearAgo = yearAgo ? PLATFORM_KEYS.reduce((s, p) => s + (yearAgo[p] ?? 0), 0) : 0;
  const growth = (now: number, then: number) => (then ? fmt(t.audience.growth12m, { pct: signedPct(now / then - 1, 0) }) : undefined);
  const color = `var(--color-${platform})`;

  return (
    <>
      <PageHeader
        title={t.audience.title}
        subtitle={t.audience.subtitle}
        right={
          <ButtonLink href="/print/media-kit" variant="ghost">
            <FileText size={16} aria-hidden /> {t.audience.mediaKit}
          </ButtonLink>
        }
      />

      {params.member && <ProfileCard i18n={i18n} profile={profile} closeHref={href({ member: undefined })} />}

      <StatStrip>
        <StatTile label={t.audience.total} value={num(total)} sub={growth(total, totalYearAgo)} />
        {PLATFORM_KEYS.map((p) => (
          <StatTile key={p} label={t.platforms[p]} value={num(last?.[p] ?? 0)} sub={growth(last?.[p] ?? 0, yearAgo?.[p] ?? 0)} />
        ))}
      </StatStrip>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={t.audience.growthChart} hint={t.audience.growthHint} className="xl:col-span-2">
          <FollowerGrowthChart data={series} />
        </Card>
        <Card
          title={t.audience.demographics}
          hint={t.audience.demographicsHint}
          right={
            <form action="/audience" className="flex items-center gap-2">
              {params.p && <input type="hidden" name="p" value={params.p} />}
              <select name="month" defaultValue={month} aria-label={t.audience.month} className="rounded-md border border-line bg-white px-2 py-1 text-xs">
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button className="rounded-md border border-line px-2 py-1 text-xs hover:bg-paper">OK</button>
            </form>
          }
        >
          <div className="mb-4 flex gap-1" role="group">
            {PLATFORM_KEYS.map((p) => (
              <Link key={p} href={href({ p })} className={`rounded-md px-2.5 py-1 text-xs ${p === platform ? "bg-ink text-white" : "border border-line text-ink-2 hover:bg-paper"}`} aria-current={p === platform ? "true" : undefined}>
                {t.platforms[p]}
              </Link>
            ))}
          </div>
          {demo ? (
            <div className="space-y-5">
              <DemoGroup title={t.audience.age} rows={demo.age.map((a) => ({ label: a.bucket, pct: a.pct }))} color={color} />
              <DemoGroup title={t.audience.gender} rows={demo.gender.map((g) => ({ label: t.audience.genders[g.bucket as "female"] ?? g.bucket, pct: g.pct }))} color={color} />
              <DemoGroup title={t.audience.country} rows={demo.country.map((c) => ({ label: (t.audience.countries as Record<string, string>)[c.bucket] ?? c.bucket, pct: c.pct }))} color={color} />
            </div>
          ) : (
            <p className="text-sm text-muted">{t.overview.noData}</p>
          )}
        </Card>
      </div>

      <Card className="mt-4" title={t.audience.segments} hint={fmt(t.audience.segmentsHint, { days: SEGMENT_WINDOW_DAYS, active: num(seg.activePeople), spam: seg.excludedSpam })}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {seg.summaries.map((s) => (
            <Link
              key={s.id}
              href={href({ segment: s.id === segment ? undefined : s.id }, s.id === segment ? "" : "#members")}
              className={`rounded-lg border p-4 transition-colors ${s.id === segment ? "border-accent bg-accent-soft/40" : "border-line hover:border-subtle"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">{segmentName(t, s.id)}</div>
                {spikes.has(s.id) && <Pill tone="accent">{t.audience.spiking}</Pill>}
                {s.id === "contactable" && <ShieldCheck size={16} className="text-good" aria-hidden />}
              </div>
              <p className="mt-0.5 text-xs text-muted">{segmentDesc(t, s.id)}</p>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="tabular font-heading text-2xl font-semibold">{num(s.size)}</span>
                {s.id !== "contactable" && <span className="text-xs text-muted">{fmt(t.audience.contactableN, { n: s.contactable })}</span>}
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">{t.audience.privacyNote}</p>
      </Card>

      {segment && members && (
        <Card id="members" className="mt-4 scroll-mt-6" bodyClass="p-0" title={fmt(t.audience.membersTitle, { segment: segmentName(t, segment) })} hint={fmt(t.audience.membersShowing, { n: members.rows.length, total: members.total })}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-normal">{t.audience.colPerson}</th>
                  <th className="py-2.5 text-right font-normal">{t.audience.colComments}</th>
                  <th className="py-2.5 text-right font-normal">{t.audience.colPq}</th>
                  <th className="py-2.5 pl-6 font-normal">{t.audience.colPlatforms}</th>
                  <th className="px-5 py-2.5 font-normal">{t.audience.colLast}</th>
                </tr>
              </thead>
              <tbody>
                {members.rows.map((m) => (
                  <tr key={m.pseudoId} className="border-b border-line last:border-0 hover:bg-paper/60">
                    <td className="px-5 py-2.5">
                      <Link href={href({ member: m.pseudoId })} className="tabular font-medium hover:text-accent-strong">
                        {m.pseudoId}
                      </Link>
                      {m.contactable && (
                        <span className="ml-2">
                          <Pill tone="good">{t.audience.optedIn}</Pill>
                        </span>
                      )}
                    </td>
                    <td className="tabular py-2.5 text-right">{m.comments}</td>
                    <td className="tabular py-2.5 text-right">{m.productQuestions}</td>
                    <td className="py-2.5 pl-6">
                      <span className="flex gap-3">
                        {m.platforms.map((p) => (
                          <PlatformTag key={p} id={p} />
                        ))}
                      </span>
                    </td>
                    <td className="tabular px-5 py-2.5 text-ink-2">{date(m.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function DemoGroup({ title, rows, color }: { title: string; rows: { label: string; pct: number }[]; color: string }) {
  const max = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-muted">{title}</h3>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <ShareBar key={r.label} label={r.label} share={r.pct / max} value={`${r.pct.toFixed(1)}%`} color={color} />
        ))}
      </div>
    </div>
  );
}

function ProfileCard({ i18n, profile, closeHref }: { i18n: I18n; profile: ReturnType<typeof audienceProfile>; closeHref: string }) {
  const { t, date } = i18n;
  const close = (
    <Link href={closeHref} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
      <X size={14} aria-hidden /> {t.audience.close}
    </Link>
  );
  if (!profile)
    return (
      <Card className="mb-4" title={t.audience.profile} right={close}>
        <p className="text-sm text-muted">{t.audience.notFound}</p>
      </Card>
    );
  const totalComments = Object.values(profile.totals).reduce((a, b) => a + b, 0);
  const interestMax = profile.interests[0]?.n ?? 1;
  return (
    <Card id="profile" className="mb-4 border-accent/40" title={`${t.audience.profile} · ${profile.pseudoId}`} hint={t.audience.profileHint} right={close}>
      {profile.withdrawn ? (
        <p className="rounded-lg bg-paper p-3 text-sm text-ink-2">{t.audience.withdrawn}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted">{t.audience.firstSeen}</dt>
                <dd className="tabular">{date(profile.firstSeenAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t.audience.lastActive}</dt>
                <dd className="tabular">{profile.lastAt ? date(profile.lastAt) : t.common.none}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t.common.comments}</dt>
                <dd className="tabular">{totalComments}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t.audience.colPlatforms}</dt>
                <dd className="flex flex-wrap gap-2">
                  {profile.platforms.map((p) => (
                    <PlatformTag key={p.platformId} id={p.platformId} />
                  ))}
                </dd>
              </div>
            </dl>
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted">{t.audience.consents}</h3>
              <ul className="space-y-1 text-xs">
                {profile.consents.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={c.status === "active" ? "good" : "neutral"}>{t.settings.consentStatus[c.status]}</Pill>
                    {t.settings.purposes[c.purpose]} · {t.settings.bases[c.lawfulBasis]}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted" title={t.audience.interestsHint}>
                {t.audience.interests}
              </h3>
              <div className="space-y-1.5">
                {profile.interests.map((x) => (
                  <ShareBar key={x.category} label={t.categories[x.category]} share={x.n / interestMax} value={String(x.n)} />
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted">{t.audience.commentMix}</h3>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(profile.totals) as (keyof typeof profile.totals)[])
                  .filter((k) => profile.totals[k] > 0)
                  .map((k) => (
                    <Pill key={k} tone={k === "product_question" ? "accent" : "neutral"}>
                      {t.commentCategories[k]} {profile.totals[k]}
                    </Pill>
                  ))}
              </div>
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted">{t.audience.recentComments}</h3>
            <ul className="max-h-[260px] space-y-2 overflow-auto pr-1 text-sm">
              {profile.comments.slice(0, 30).map((c) => (
                <li key={c.id} className="rounded-lg border border-line p-2.5">
                  <p>{c.text}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                    <PlatformTag id={c.platformId} />
                    <span>{date(c.createdAt)}</span>
                    <span>· {t.commentCategories[c.category]}</span>
                    <span className="line-clamp-1">· {c.contentTitle}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

