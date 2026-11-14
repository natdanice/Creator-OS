import Link from "next/link";
import { Bot, Inbox as InboxIcon } from "lucide-react";
import { getDb } from "@/db/client";
import { COMMENT_CATEGORIES, type CommentCategory } from "@/db/schema";
import { PLATFORM_KEYS } from "@/lib/queries/overview";
import { getComments, getInboxSummary, getThread, getThreads } from "@/lib/api";
import { getBriefDetector } from "@/inbox/briefDetector";
import { suggestBrandReply, suggestCommentReply } from "@/inbox/replies";
import { getConnection } from "@/connect/store";
import { configured } from "@/connect/providers";
import { isLineUserId } from "@/connect/line";
import { IS_LIVE } from "@/lib/config";
import { BriefActions, CommentReply, MarkRead, ReplyBox } from "@/components/inbox/InboxClient";
import { btn, Card, PageHeader, Pill, PlatformTag } from "@/components/ui";
import { baht } from "@/lib/format";
import { fmt, type I18n } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.inbox.title };
}

type Params = { tab?: string; thread?: string; cat?: string; platform?: string; status?: string };
const STATUSES = ["open", "replied", "hidden"] as const;

const time = (ts: string) => ts.slice(11, 16);

export default async function InboxPage({ searchParams }: { searchParams: Promise<Params> }) {
  const i18n = await getI18n();
  const { t } = i18n;
  const params = await searchParams;
  const tab = params.tab === "comments" ? "comments" : "brands";
  const { today, counts, needsReply } = await getInboxSummary();

  const tabs = [
    { key: "brands", href: "/inbox", label: t.inbox.tabBrands, badge: counts.unread },
    { key: "comments", href: "/inbox?tab=comments", label: t.inbox.tabComments, badge: needsReply },
  ];

  return (
    <>
      <PageHeader title={t.inbox.title} subtitle={t.inbox.subtitle} />
      <nav className="mb-5 flex gap-1 border-b border-line">
        {tabs.map((x) => (
          <Link key={x.key} href={x.href} className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${x.key === tab ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {x.label}
            {x.badge > 0 && <span className="tabular rounded-full bg-accent px-1.5 text-[11px] font-medium text-white">{x.badge}</span>}
          </Link>
        ))}
      </nav>
      {tab === "brands" ? <BrandMessages i18n={i18n} today={today} threadParam={params.thread} /> : <Comments i18n={i18n} today={today} params={params} />}
    </>
  );
}

async function BrandMessages({ i18n, today, threadParam }: { i18n: I18n; today: string; threadParam?: string }) {
  const { t, date, dateShort } = i18n;
  const db = getDb();
  const { threads } = await getThreads();
  const current = threads.find((x) => x.brandId === Number(threadParam)) ?? threads[0];
  const thread = current ? (await getThread(current.brandId)).thread : null;
  const msgs = thread?.messages ?? [];
  const contact = thread?.contact ?? undefined;
  const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
  const detector = getBriefDetector();

  if (!current) return <Card><p className="text-sm text-muted">{t.inbox.noThreads}</p></Card>;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[19rem_1fr]">
      <Card bodyClass="p-0" className="self-start">
        <ul className="max-h-[70vh] divide-y divide-line overflow-auto">
          {threads.map((th) => {
            const on = th.brandId === current.brandId;
            return (
              <li key={th.brandId}>
                <Link href={`/inbox?thread=${th.brandId}`} className={`block px-4 py-3 ${on ? "bg-accent-soft/50" : "hover:bg-paper"}`} aria-current={on ? "true" : undefined}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${th.unread ? "font-semibold" : "font-medium"}`}>{th.brandName}</span>
                    <span className="tabular shrink-0 text-[11px] text-muted">{th.last.sentAt.slice(0, 10) === today ? time(th.last.sentAt) : dateShort(th.last.sentAt)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                    {th.last.direction === "out" && `${t.inbox.you}: `}
                    {th.last.body}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Pill>{t.channels[th.channel]}</Pill>
                    {th.newBriefs > 0 && <Pill tone="accent">{t.inbox.newBrief}</Pill>}
                    {th.unread > 0 && <Pill tone="warn">{fmt(t.inbox.unreadN, { n: th.unread })}</Pill>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card
        bodyClass="p-0"
        title={current.brandName}
        hint={contact ? `${t.inbox.contact}: ${contact.name} · ${contact.role} · ${t.channels[contact.channel]}` : undefined}
        right={
          <Link href={`/brands/${current.brandId}`} className="text-xs text-muted hover:text-ink">
            {t.inbox.openBrand}
          </Link>
        }
      >
        <MarkRead brandId={current.brandId} unread={current.unread} />
        <ol className="max-h-[60vh] space-y-4 overflow-auto p-4">
          {msgs.map((m) => {
            const { dealTitle, dealStage } = m;
            const out = m.direction === "out";
            return (
              <li key={m.id} className={`flex flex-col ${out ? "items-end" : "items-start"}`}>
                <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${out ? "rounded-br-sm bg-ink text-white" : "rounded-bl-sm border border-line bg-white"}`}>{m.body}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                  {m.taskId && (
                    <span className="inline-flex items-center gap-1" title={t.inbox.fromAutomation}>
                      <Bot size={11} aria-hidden /> {t.inbox.fromAutomation} ·
                    </span>
                  )}
                  <span className="tabular">
                    {date(m.sentAt)} {time(m.sentAt)}
                  </span>
                </div>
                {!out && m.brief && m.briefStatus !== "none" && (
                  <div className="mt-2 w-full max-w-[85%] rounded-xl border border-accent/30 bg-accent-soft/40 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-accent-strong">{t.inbox.briefDetected}</span>
                      <span className="text-[11px] text-muted">{fmt(t.inbox.detector, { name: detector.name })}</span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="text-muted">{t.inbox.briefBudget}</dt>
                        <dd className="tabular">{m.brief.budget ? baht(m.brief.budget) : t.inbox.notStated}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">{t.inbox.briefPlatforms}</dt>
                        <dd>{m.brief.platforms.length ? m.brief.platforms.map((p) => t.platforms[p]).join(", ") : t.inbox.notStated}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">{t.inbox.briefTiming}</dt>
                        <dd>{m.brief.timing ?? t.inbox.notStated}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">{t.inbox.briefProduct}</dt>
                        <dd>{m.brief.product ?? t.inbox.notStated}</dd>
                      </div>
                    </dl>
                    {m.briefStatus === "new" && (
                      <BriefActions
                        messageId={m.id}
                        defaultTitle={m.brief.product ?? m.body.slice(0, 40)}
                        defaultValue={m.brief.budget ?? m.brief.listPrice}
                        deliverables={m.brief.deliverables.map((c) => c.name).join(" + ")}
                      />
                    )}
                    {m.briefStatus === "converted" && dealTitle && (
                      <p className="mt-2 text-xs">
                        {fmt(t.inbox.briefConverted, { deal: dealTitle, stage: t.stages[dealStage!] })} ·{" "}
                        <Link href="/brands/pipeline" className="text-accent-strong hover:underline">
                          {t.inbox.viewPipeline}
                        </Link>
                      </p>
                    )}
                    {m.briefStatus === "ignored" && <p className="mt-2 text-xs text-muted">{t.inbox.briefIgnored}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <ReplyBox
          brandId={current.brandId}
          canGmail={IS_LIVE && !!getConnection(db, "google") && contact?.channel === "email" && !!contact.handle.includes("@")}
          canLine={configured("line") && contact?.channel === "line" && isLineUserId(contact.handle)}
          channel={t.channels[contact?.channel ?? current.channel]}
          suggestion={suggestBrandReply(contact?.name.replace(/\s*\(สมมติ\)$/, "") ?? "", lastIn ? { body: lastIn.body, brief: lastIn.brief } : null)}
        />
        {!IS_LIVE && (
          <p className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[11px] text-muted">
            <InboxIcon size={12} aria-hidden /> {t.inbox.mockNote}
          </p>
        )}
      </Card>
    </div>
  );
}

async function Comments({ i18n, today, params }: { i18n: I18n; today: string; params: Params }) {
  const { t, date } = i18n;
  const cat = params.cat && (COMMENT_CATEGORIES as readonly string[]).includes(params.cat) ? (params.cat as CommentCategory) : "needs_reply";
  const status = STATUSES.includes(params.status as "open") ? (params.status as (typeof STATUSES)[number]) : "open";
  const platform = PLATFORM_KEYS.includes(params.platform as "tiktok") ? params.platform : undefined;
  const { rows, total, counts, windowDays } = await getComments({ cat, platform, status });
  const NEEDS_REPLY: CommentCategory[] = ["product_question", "general_question", "content_request"];
  const countOf = (c: CommentCategory | "needs_reply") => (c === "needs_reply" ? counts.filter((x) => NEEDS_REPLY.includes(x.category)) : counts.filter((x) => x.category === c)).reduce((s, x) => s + x.n, 0);
  const href = (patch: Partial<Params>) => {
    const q = new URLSearchParams(Object.entries({ ...params, tab: "comments", ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/inbox?${q}`;
  };
  const chips: (CommentCategory | "needs_reply")[] = ["needs_reply", ...COMMENT_CATEGORIES];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <Link key={c} href={href({ cat: c === "needs_reply" ? undefined : c })} className={`rounded-full border px-3 py-1 text-xs ${c === cat ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:border-subtle"}`}>
            {c === "needs_reply" ? t.inbox.filterNeedsReply : t.commentCategories[c]} <span className="tabular opacity-70">{countOf(c)}</span>
          </Link>
        ))}
        <form action="/inbox" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="tab" value="comments" />
          {cat !== "needs_reply" && <input type="hidden" name="cat" value={cat} />}
          <select name="platform" defaultValue={platform ?? ""} aria-label={t.common.platform} className={`${btn.input} py-1.5 text-xs`}>
            <option value="">{t.platforms.all}</option>
            {PLATFORM_KEYS.map((p) => (
              <option key={p} value={p}>
                {t.platforms[p]}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} aria-label={t.common.status} className={`${btn.input} py-1.5 text-xs`}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.inbox.commentStatus[s]}
              </option>
            ))}
          </select>
          <button className={`${btn.ghost} py-1.5 text-xs`}>OK</button>
        </form>
      </div>
      <p className="mb-3 text-xs text-muted">
        {fmt(t.inbox.showing, { n: rows.length, total, days: windowDays })} · {t.inbox.commentsNote}
      </p>
      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{t.inbox.noComments}</p>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {rows.map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <Link href={`/audience?member=${c.author}`} className="tabular font-medium text-ink hover:text-accent-strong" title={t.inbox.viewProfile}>
                  {c.author}
                </Link>
                <PlatformTag id={c.platformId} />
                <span className="tabular">
                  {date(c.createdAt)} {time(c.createdAt)}
                </span>
                <Pill tone={c.category === "product_question" ? "accent" : c.category === "spam" ? "bad" : "neutral"}>{t.commentCategories[c.category]}</Pill>
                {c.isSponsored && <Pill>{t.common.sponsored}</Pill>}
              </div>
              <p className="mt-2 text-sm">{c.text}</p>
              <p className="mt-1 line-clamp-1 text-xs text-subtle">
                {t.inbox.on} “{c.contentTitle}” · {t.categories[c.productCategory]}
              </p>
              {status === "open" ? (
                <CommentReply commentId={c.id} spam={c.category === "spam"} suggestion={suggestCommentReply(c.category, c.productCategory, c.isSponsored)} />
              ) : (
                c.replyText && (
                  <p className="mt-3 rounded-lg bg-paper p-2.5 text-sm">
                    <span className="text-xs text-muted">{t.inbox.yourReply}: </span>
                    {c.replyText}
                  </p>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
