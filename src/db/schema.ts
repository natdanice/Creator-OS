/**
 * Creator OS — data model.
 *
 * Conventions
 * - Dates are ISO text: "YYYY-MM-DD" for days, "YYYY-MM-DDTHH:mm:ss" for timestamps
 *   (creator-local time, Asia/Bangkok, stored without offset).
 * - Money is integer THB (no satang).
 * - Audience members are only ever referenced by pseudonymous IDs (U0001…).
 *   Real handles never reach the database; ingest hashes them (see cdp/pseudonymize.ts).
 */
import { sqliteTable, text, integer, real, primaryKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/* ───────────────────────────── CDP: sources ───────────────────────────── */

export const platforms = sqliteTable("platforms", {
  id: text("id").primaryKey(), // tiktok | instagram | youtube
  name: text("name").notNull(),
  handle: text("handle").notNull(), // the creator's own account
  color: text("color").notNull(),
});

import { CONTENT_TYPES, PRODUCT_CATEGORIES, type ContentType, type ProductCategory } from "@/lib/constants";
export { CONTENT_TYPES, PRODUCT_CATEGORIES, type ContentType, type ProductCategory };

export const contents = sqliteTable(
  "contents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    platformId: text("platform_id").notNull().references(() => platforms.id),
    externalId: text("external_id").notNull(), // id on the platform (video id, media id…)
    title: text("title").notNull(),
    type: text("type").$type<ContentType>().notNull(),
    productCategory: text("product_category").$type<ProductCategory>().notNull(),
    postedAt: text("posted_at").notNull(),
    isSponsored: integer("is_sponsored", { mode: "boolean" }).notNull().default(false),
    dealId: integer("deal_id").references(() => deals.id),
  },
  (t) => [uniqueIndex("contents_platform_ext").on(t.platformId, t.externalId), index("contents_deal").on(t.dealId)],
);

/** Daily deltas (not cumulative) per post. */
export const contentMetricsDaily = sqliteTable(
  "content_metrics_daily",
  {
    contentId: integer("content_id").notNull().references(() => contents.id),
    date: text("date").notNull(),
    views: integer("views").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    profileViews: integer("profile_views").notNull().default(0),
    newFollowers: integer("new_followers").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.contentId, t.date] }), index("metrics_date").on(t.date)],
);

/** One row per platform per month; followers as of month end (or as of story date for the current month). */
export const audienceSnapshots = sqliteTable(
  "audience_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    platformId: text("platform_id").notNull().references(() => platforms.id),
    month: text("month").notNull(), // YYYY-MM
    followers: integer("followers").notNull(),
  },
  (t) => [uniqueIndex("audience_platform_month").on(t.platformId, t.month)],
);

/** Demographic split of a snapshot. dimension = age | gender | country; pct sums to 100 per dimension. */
export const audienceBreakdown = sqliteTable("audience_breakdown", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  snapshotId: integer("snapshot_id").notNull().references(() => audienceSnapshots.id),
  dimension: text("dimension").$type<"age" | "gender" | "country">().notNull(),
  bucket: text("bucket").notNull(),
  pct: real("pct").notNull(),
});

/** Pseudonym registry: maps a salted hash of a platform handle to a stable pseudo ID. The handle itself is never stored. */
export const pseudonyms = sqliteTable("pseudonyms", {
  pseudoId: text("pseudo_id").primaryKey(), // U0001…
  handleHash: text("handle_hash").notNull().unique(),
  firstSeenAt: text("first_seen_at").notNull(),
});

export const COMMENT_CATEGORIES = ["product_question", "content_request", "general_question", "praise", "spam"] as const;
export type CommentCategory = (typeof COMMENT_CATEGORIES)[number];

export const comments = sqliteTable(
  "comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    platformId: text("platform_id").notNull().references(() => platforms.id),
    contentId: integer("content_id").notNull().references(() => contents.id),
    authorPseudoId: text("author_pseudo_id").notNull().references(() => pseudonyms.pseudoId),
    text: text("text").notNull(),
    category: text("category").$type<CommentCategory>().notNull(),
    classifier: text("classifier").notNull(), // which classifier produced `category`
    redacted: integer("redacted", { mode: "boolean" }).notNull().default(false), // consent withdrawn → text wiped, excluded from analytics
    createdAt: text("created_at").notNull(),
    // Inbox triage. Replies are drafted here and posted by the creator on the platform (nothing is sent).
    replyStatus: text("reply_status").$type<"open" | "replied" | "hidden">().notNull().default("open"),
    replyText: text("reply_text"),
    repliedAt: text("replied_at"),
  },
  (t) => [index("comments_content").on(t.contentId), index("comments_created").on(t.createdAt)],
);

/** PDPA consent ledger for audience data. One row per subject × purpose. */
export const consents = sqliteTable("consents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subjectPseudoId: text("subject_pseudo_id").notNull().references(() => pseudonyms.pseudoId),
  purpose: text("purpose").$type<"analytics" | "marketing">().notNull(),
  lawfulBasis: text("lawful_basis").$type<"legitimate_interest" | "consent">().notNull(),
  status: text("status").$type<"active" | "withdrawn">().notNull(),
  source: text("source").notNull(), // e.g. public_comment, newsletter_form
  grantedAt: text("granted_at").notNull(),
  withdrawnAt: text("withdrawn_at"),
});

export const importRuns = sqliteTable("import_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  platformId: text("platform_id").notNull().references(() => platforms.id),
  adapter: text("adapter").notNull(), // mock | csv | api
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").$type<"success" | "partial" | "failed">().notNull(),
  contents: integer("contents").notNull().default(0),
  metricRows: integer("metric_rows").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  audienceSnapshots: integer("audience_snapshots").notNull().default(0),
  message: text("message"),
});

/* ───────────────────────────── CRM ───────────────────────────── */

export const brands = sqliteTable("brands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").$type<ProductCategory>().notNull(),
  website: text("website"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const brandContacts = sqliteTable("brand_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brandId: integer("brand_id").notNull().references(() => brands.id),
  name: text("name").notNull(), // fictional
  role: text("role").notNull(),
  channel: text("channel").$type<"line" | "email" | "ig_dm">().notNull(),
  handle: text("handle").notNull(), // fictional placeholder
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
});

export const DEAL_STAGES = ["lead", "brief", "quotation", "production", "posted", "report_sent", "invoiced", "paid"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const deals = sqliteTable(
  "deals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brandId: integer("brand_id").notNull().references(() => brands.id),
    title: text("title").notNull(),
    stage: text("stage").$type<DealStage>().notNull(),
    value: integer("value").notNull(),
    currency: text("currency").notNull().default("THB"),
    deliverables: text("deliverables", { mode: "json" }).$type<string[]>().notNull(), // rate_card codes
    createdAt: text("created_at").notNull(),
    postedAt: text("posted_at"), // when the deliverables went live
    closedAt: text("closed_at"), // when the deal reached Paid
  },
  (t) => [index("deals_brand").on(t.brandId)],
);

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  number: text("number").notNull().unique(),
  amount: integer("amount").notNull(),
  issuedAt: text("issued_at").notNull(),
  dueAt: text("due_at").notNull(),
  paidAt: text("paid_at"),
});

export const ACTIVITY_TYPES = [
  "brief_received",
  "quote_sent",
  "draft_sent",
  "revision",
  "posted",
  "report_sent",
  "invoiced",
  "paid",
  "call",
  "chat",
  "note",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activities = sqliteTable(
  "activities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brandId: integer("brand_id").notNull().references(() => brands.id),
    dealId: integer("deal_id").references(() => deals.id),
    type: text("type").$type<ActivityType>().notNull(),
    channel: text("channel").$type<"line" | "email" | "ig_dm" | "phone" | "system">().notNull(),
    summary: text("summary").notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (t) => [index("activities_brand").on(t.brandId)],
);

export const rateCard = sqliteTable("rate_card", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  platformId: text("platform_id").references(() => platforms.id), // null = multi-platform / add-on
  kind: text("kind").$type<"single" | "bundle" | "retainer" | "addon">().notNull(),
  description: text("description").notNull(),
  price: integer("price").notNull(),
  // codes of content-producing items this package expands to (for bundles); empty for add-ons
  includes: text("includes", { mode: "json" }).$type<string[]>().notNull(),
});

export const quotes = sqliteTable("quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: text("number").notNull().unique(),
  brandId: integer("brand_id").notNull().references(() => brands.id),
  dealId: integer("deal_id").references(() => deals.id),
  createdAt: text("created_at").notNull(),
  validUntil: text("valid_until").notNull(),
  discountPct: integer("discount_pct").notNull().default(0),
  notes: text("notes"),
});

export const quoteItems = sqliteTable("quote_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quoteId: integer("quote_id").notNull().references(() => quotes.id),
  rateCardId: integer("rate_card_id").notNull().references(() => rateCard.id),
  qty: integer("qty").notNull(),
  unitPrice: integer("unit_price").notNull(),
});

/** Brand conversations (LINE OA / IG DM / email), mock-imported. One thread per brand. */
export interface BriefSignal {
  budget: number | null;
  platforms: ("tiktok" | "instagram" | "youtube")[];
  timing: string | null; // the matched phrase, e.g. "ต้นเดือนธันวาคม"
  product: string | null;
}

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brandId: integer("brand_id").notNull().references(() => brands.id),
    direction: text("direction").$type<"in" | "out">().notNull(),
    channel: text("channel").$type<"line" | "email" | "ig_dm">().notNull(),
    body: text("body").notNull(),
    sentAt: text("sent_at").notNull(),
    readAt: text("read_at"),
    // Brief detection on inbound messages (see inbox/briefDetector.ts)
    brief: text("brief", { mode: "json" }).$type<BriefSignal>(),
    briefStatus: text("brief_status").$type<"none" | "new" | "converted" | "ignored">().notNull().default("none"),
    dealId: integer("deal_id").references(() => deals.id),
    taskId: integer("task_id"), // outbound message that came from an approved automation draft
  },
  (t) => [index("messages_brand").on(t.brandId)],
);

/* ───────────────────────────── Automation ───────────────────────────── */

export const automationRules = sqliteTable("automation_rules", {
  id: text("id").primaryKey(), // rule code, matches automation/rules/*.ts
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  channel: text("channel").$type<"email" | "line" | "internal">().notNull(),
  schedule: text("schedule").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: text("last_run_at"),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ruleId: text("rule_id").notNull().references(() => automationRules.id),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(), // why the rule fired, with numbers
    draftMessage: text("draft_message").notNull(),
    channel: text("channel").$type<"email" | "line" | "internal">().notNull(),
    brandId: integer("brand_id").references(() => brands.id),
    dealId: integer("deal_id").references(() => deals.id),
    link: text("link"), // in-app link (report, brand 360…)
    vars: text("vars", { mode: "json" }).$type<Record<string, string | number>>(), // raw values for re-rendering title/reason per UI language
    status: text("status").$type<"open" | "done" | "dismissed">().notNull().default("open"),
    forDate: text("for_date").notNull(), // simulated "today" of the run
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [uniqueIndex("tasks_dedupe").on(t.dedupeKey)],
);

export const automationRuns = sqliteTable("automation_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  forDate: text("for_date").notNull(),
  ranAt: text("ran_at").notNull(),
  created: integer("created").notNull(),
  skipped: integer("skipped").notNull(),
  detail: text("detail", { mode: "json" }).$type<Record<string, { created: number; skipped: number }>>().notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/* ───────────────────────────── Publisher (outbound) ───────────────────────────── */

/** An uploaded video/image. The file lives in data/uploads/ (never sent anywhere in the prototype). */
export const mediaAssets = sqliteTable("media_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  originalName: text("original_name").notNull(),
  storedName: text("stored_name").notNull(),
  mime: text("mime").notNull(),
  kind: text("kind").$type<"video" | "image">().notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  durationSec: real("duration_sec"),
  uploadedAt: text("uploaded_at").notNull(),
});

export const PUBLISH_STATUSES = ["scheduled", "published", "failed", "cancelled", "partial"] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

/** One "write once" post: the shared caption plus which platforms it goes to. */
export const publishJobs = sqliteTable("publish_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mediaId: integer("media_id").notNull().references(() => mediaAssets.id),
  caption: text("caption").notNull(),
  hashtags: text("hashtags").notNull(),
  contentType: text("content_type").$type<ContentType>().notNull(),
  productCategory: text("product_category").$type<ProductCategory>().notNull(),
  dealId: integer("deal_id").references(() => deals.id),
  sponsored: integer("sponsored", { mode: "boolean" }).notNull().default(false),
  scheduledAt: text("scheduled_at"), // null = publish immediately
  status: text("status").$type<PublishStatus>().notNull(),
  createdAt: text("created_at").notNull(),
});

/** The job as sent to one platform: final caption + platform-specific options + result. */
export const publications = sqliteTable(
  "publications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id").notNull().references(() => publishJobs.id),
    platformId: text("platform_id").notNull().references(() => platforms.id),
    title: text("title"), // YouTube only
    caption: text("caption").notNull(), // final text as posted (caption / description)
    options: text("options", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<PublishStatus>().notNull(),
    externalId: text("external_id"),
    contentId: integer("content_id").references(() => contents.id), // row created in the CDP once live
    publishedAt: text("published_at"),
    error: text("error"),
  },
  (t) => [index("publications_job").on(t.jobId)],
);
