/**
 * One-stop import: shared types. Every uploaded file is read into tables (one per CSV, one per
 * sheet), each table is identified (what it is, which platform, which column means what), then
 * loaded into the right place.
 */
import { CRM_COLUMNS } from "@/crm/crmColumns";
import type { PlatformId } from "@/cdp/adapters/PlatformAdapter";

export type { PlatformId };

/** What a table can be. `creator_workbook` = the creator's own Excel master copy (whole file). */
export const KINDS = ["posts", "comments", "account_daily", "audience_age", "audience_gender", "audience_country", "brands_deals", "creator_workbook", "unknown"] as const;
export type Kind = (typeof KINDS)[number];
export type MappedKind = Exclude<Kind, "creator_workbook" | "unknown">;
export const MAPPED_KINDS: MappedKind[] = ["posts", "comments", "account_daily", "audience_age", "audience_gender", "audience_country", "brands_deals"];

/** Kinds that belong to one platform (the rest don't need a platform). */
export const PLATFORM_KINDS = new Set<Kind>(["posts", "comments", "account_daily", "audience_age", "audience_gender", "audience_country"]);

/** The fields each kind understands. A mapping says which column holds each field. */
export const FIELDS: Record<MappedKind, readonly string[]> = {
  posts: ["id", "title", "postedAt", "postedTime", "date", "views", "likes", "comments", "shares", "saves", "profileViews", "newFollowers", "link", "type", "category", "sponsored"],
  comments: ["postId", "author", "text", "time"],
  account_daily: ["date", "views", "profileViews", "likes", "comments", "shares", "newFollowers", "lostFollowers", "followers"],
  audience_age: ["key", "share", "men", "women"],
  audience_gender: ["key", "share"],
  audience_country: ["key", "share"],
  brands_deals: CRM_COLUMNS,
};

export const ALL_FIELDS = [...new Set(Object.values(FIELDS).flat())];

/** Columns a kind can't do without. Each inner list = "one of these". */
export const REQUIRED: Record<MappedKind, string[][]> = {
  posts: [["postedAt", "date"], ["views"]],
  comments: [["text"]],
  account_daily: [["date"]],
  audience_age: [["key"], ["share", "men"]],
  audience_gender: [["key"], ["share"]],
  audience_country: [["key"], ["share"]],
  brands_deals: [["brand"]],
};

/** Required fields this mapping doesn't have (first field of each missing group). */
export function missingFields(kind: Kind, mapping: Record<string, string>): string[] {
  if (kind === "unknown" || kind === "creator_workbook") return [];
  return REQUIRED[kind].filter((group) => !group.some((f) => mapping[f])).map((group) => group[0]);
}

export type Cell = string | number | boolean | Date | null;

export interface Table {
  id: string; // "<fileIndex>:<sheet or ''>"
  file: string;
  fileIndex: number;
  sheet: string | null;
  headers: string[];
  rows: Record<string, Cell>[];
}

export type Confidence = "high" | "medium" | "low";

export interface Detection {
  kind: Kind;
  platform: PlatformId | null;
  /** field → column header */
  mapping: Record<string, string>;
  confidence: Confidence;
  by: "rules" | "ai" | "you";
  reason: string;
}

export type ItemStatus = "imported" | "needs_you" | "skipped" | "failed";

export interface PlanItem {
  tableId: string;
  file: string;
  sheet: string | null;
  rows: number;
  headers: string[];
  detection: Detection;
  status: ItemStatus;
  /** What happened (imported) or why it's waiting (needs_you). */
  message: string;
  /** Required fields no column was found for: the creator picks the column. */
  missing?: string[];
}

export interface Plan {
  batchId: string;
  createdAt: string;
  aiAvailable: boolean;
  items: PlanItem[];
}
