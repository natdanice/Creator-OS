/**
 * CDP stage 1 — DATAFLOW.
 *
 * Every data source (CSV export, mock generator, and later a real platform API)
 * implements this interface. Adapters return *raw* records keyed by the platform's
 * own external IDs; `cdp/ingest.ts` maps them onto database rows.
 *
 * Adapters MAY return raw author handles (that is what platforms export).
 * They are pseudonymized during ingest and never stored.
 */
import type { CommentCategory, ContentType, ProductCategory } from "@/db/schema";

export type PlatformId = "tiktok" | "instagram" | "youtube";

export interface RawContent {
  externalId: string;
  title: string;
  type: ContentType;
  productCategory: ProductCategory;
  postedAt: string; // YYYY-MM-DDTHH:mm:ss
  isSponsored: boolean;
  /** CRM link, if the source knows it (mock does; CSV exports don't — linked later in the UI). */
  dealId?: number | null;
  /**
   * true when type / category / sponsored are keyword guesses (API connectors). A post that's
   * already stored then keeps its own tags, e.g. the ones the creator picked in the Publisher.
   */
  tagsGuessed?: boolean;
}

export interface RawMetricDaily {
  contentExternalId: string;
  date: string; // YYYY-MM-DD
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  profileViews: number;
  newFollowers: number;
}

export interface RawComment {
  contentExternalId: string;
  authorHandle: string; // raw — will be pseudonymized
  text: string;
  createdAt: string;
  /** Optional pre-labelled category (e.g. from a test fixture). Normally left empty and classified at ingest. */
  category?: CommentCategory;
}

export interface RawAudienceSnapshot {
  month: string; // YYYY-MM
  followers: number;
  age: Record<string, number>;
  gender: Record<string, number>;
  country: Record<string, number>;
}

export interface PlatformAdapter {
  /** "mock" | "csv" | "api" — recorded on import_runs. */
  readonly kind: "mock" | "csv" | "api";
  readonly platform: PlatformId;
  importContents(): Promise<RawContent[]>;
  importMetrics(): Promise<RawMetricDaily[]>;
  importComments(): Promise<RawComment[]>;
  importAudience(): Promise<RawAudienceSnapshot[]>;
}
