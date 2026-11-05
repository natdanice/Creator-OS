/**
 * Inbox reads: brand threads (one per brand) and the audience-comment triage queue.
 * Comments are read through ANALYTICS_OK, so redacted (consent-withdrawn) people never appear.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { brands, comments, contents, deals, messages, type CommentCategory } from "@/db/schema";
import { ANALYTICS_OK } from "@/cdp/consent";
import { addDays } from "@/lib/dates";

export type Message = typeof messages.$inferSelect;

export interface ThreadSummary {
  brandId: number;
  brandName: string;
  channel: Message["channel"];
  last: Message;
  unread: number;
  newBriefs: number;
}

export function listThreads(db: DB, today: string): ThreadSummary[] {
  const rows = db
    .select({ m: messages, brandName: brands.name })
    .from(messages)
    .innerJoin(brands, eq(brands.id, messages.brandId))
    .where(sql`substr(${messages.sentAt}, 1, 10) <= ${today}`)
    .orderBy(desc(messages.sentAt))
    .all();
  const byBrand = new Map<number, ThreadSummary>();
  for (const { m, brandName } of rows) {
    let t = byBrand.get(m.brandId);
    if (!t) byBrand.set(m.brandId, (t = { brandId: m.brandId, brandName, channel: m.channel, last: m, unread: 0, newBriefs: 0 }));
    if (m.direction === "in" && !m.readAt) t.unread++;
    if (m.briefStatus === "new") t.newBriefs++;
  }
  // Threads with a new brief first, then unread, then most recent.
  return [...byBrand.values()].sort((a, b) => b.newBriefs - a.newBriefs || Number(b.unread > 0) - Number(a.unread > 0) || b.last.sentAt.localeCompare(a.last.sentAt));
}

export function threadMessages(db: DB, brandId: number) {
  return db
    .select({ m: messages, dealTitle: deals.title, dealStage: deals.stage })
    .from(messages)
    .leftJoin(deals, eq(deals.id, messages.dealId))
    .where(eq(messages.brandId, brandId))
    .orderBy(messages.sentAt)
    .all();
}

export function inboxCounts(db: DB) {
  const r = db
    .select({
      unread: sql<number>`coalesce(sum(case when ${messages.direction} = 'in' and ${messages.readAt} is null then 1 else 0 end), 0)`,
      briefs: sql<number>`coalesce(sum(case when ${messages.briefStatus} = 'new' then 1 else 0 end), 0)`,
    })
    .from(messages)
    .get()!;
  return r;
}

/** Categories that usually deserve a reply, in priority order. */
export const NEEDS_REPLY: CommentCategory[] = ["product_question", "general_question", "content_request"];
export const COMMENT_WINDOW_DAYS = 14;

export function commentQueue(
  db: DB,
  today: string,
  opts: { category?: CommentCategory | "needs_reply"; platform?: string; status?: "open" | "replied" | "hidden"; limit?: number },
) {
  const since = addDays(today, -(COMMENT_WINDOW_DAYS - 1));
  const cats = !opts.category || opts.category === "needs_reply" ? NEEDS_REPLY : [opts.category];
  const where = and(
    ANALYTICS_OK,
    inArray(comments.category, cats),
    eq(comments.replyStatus, opts.status ?? "open"),
    gte(sql`substr(${comments.createdAt}, 1, 10)`, since),
    sql`substr(${comments.createdAt}, 1, 10) <= ${today}`,
    opts.platform ? eq(comments.platformId, opts.platform) : undefined,
  );
  const rows = db
    .select({
      id: comments.id,
      text: comments.text,
      category: comments.category,
      platformId: comments.platformId,
      author: comments.authorPseudoId,
      createdAt: comments.createdAt,
      replyText: comments.replyText,
      contentTitle: contents.title,
      productCategory: contents.productCategory,
      isSponsored: contents.isSponsored,
    })
    .from(comments)
    .innerJoin(contents, eq(contents.id, comments.contentId))
    .where(where)
    // Product questions first (they sell), newest first within each category.
    .orderBy(sql`case ${comments.category} when 'product_question' then 0 when 'general_question' then 1 else 2 end`, desc(comments.createdAt))
    .limit(opts.limit ?? 40)
    .all();
  const total = db.select({ n: sql<number>`count(*)` }).from(comments).where(where).get()!.n;
  return { rows, total };
}

export function commentCountsByCategory(db: DB, today: string) {
  const since = addDays(today, -(COMMENT_WINDOW_DAYS - 1));
  return db
    .select({ category: comments.category, n: sql<number>`count(*)` })
    .from(comments)
    .where(and(ANALYTICS_OK, eq(comments.replyStatus, "open"), gte(sql`substr(${comments.createdAt}, 1, 10)`, since), sql`substr(${comments.createdAt}, 1, 10) <= ${today}`))
    .groupBy(comments.category)
    .all();
}
