/**
 * CSV adapter. Column names follow the native analytics exports of each platform
 * (TikTok Studio, Instagram Insights, YouTube Studio), plus three creator-added
 * tagging columns the platforms don't export: Type, Category, Sponsored.
 *
 * Metrics CSV  — one row per post per day.
 * Comments CSV — one row per comment: Content ID, Username, Comment, Time.
 */
import type { ContentType, ProductCategory } from "@/db/schema";
import { CONTENT_TYPES, PRODUCT_CATEGORIES } from "@/db/schema";
import type { PlatformAdapter, PlatformId, RawComment, RawContent, RawMetricDaily } from "../PlatformAdapter";
import { parseCsv } from "./parseCsv";

interface ColumnMap {
  id: string;
  title: string;
  postedAt: string;
  date: string;
  views: string;
  likes: string;
  comments: string;
  shares: string;
  saves: string;
  profileViews: string;
  newFollowers: string;
}

export const CSV_COLUMNS: Record<PlatformId, ColumnMap> = {
  tiktok: {
    id: "Video ID",
    title: "Video title",
    postedAt: "Post time",
    date: "Date",
    views: "Video views",
    likes: "Likes",
    comments: "Comments",
    shares: "Shares",
    saves: "Add to Favorites",
    profileViews: "Profile views",
    newFollowers: "New followers",
  },
  instagram: {
    id: "Post ID",
    title: "Description",
    postedAt: "Publish time",
    date: "Date",
    views: "Views",
    likes: "Likes",
    comments: "Comments",
    shares: "Shares",
    saves: "Saves",
    profileViews: "Profile visits",
    newFollowers: "Follows",
  },
  youtube: {
    id: "Content",
    title: "Video title",
    postedAt: "Video publish time",
    date: "Date",
    views: "Views",
    likes: "Likes",
    comments: "Comments added",
    shares: "Shares",
    saves: "Added to playlists",
    profileViews: "Channel page views",
    newFollowers: "Subscribers gained",
  },
};

const num = (s: string | undefined) => Number((s ?? "0").replace(/,/g, "")) || 0;
const normTs = (s: string) => (s.length === 10 ? `${s}T12:00:00` : s.replace(" ", "T").slice(0, 19));

export class CsvAdapter implements PlatformAdapter {
  readonly kind = "csv" as const;
  private metricRows: Record<string, string>[];
  private commentRows: Record<string, string>[];
  private cols: ColumnMap;

  constructor(
    readonly platform: PlatformId,
    metricsCsv: string,
    commentsCsv?: string,
  ) {
    this.cols = CSV_COLUMNS[platform];
    this.metricRows = parseCsv(metricsCsv);
    this.commentRows = commentsCsv ? parseCsv(commentsCsv) : [];
    const missing = Object.values(this.cols).filter((c) => this.metricRows.length && !(c in this.metricRows[0]));
    if (missing.length) throw new Error(`Missing column(s): ${missing.join(", ")}`);
  }

  async importContents(): Promise<RawContent[]> {
    const byId = new Map<string, RawContent>();
    for (const r of this.metricRows) {
      const id = r[this.cols.id];
      if (byId.has(id)) continue;
      const type = (r["Type"] ?? "").toLowerCase() as ContentType;
      const cat = (r["Category"] ?? "").toLowerCase() as ProductCategory;
      byId.set(id, {
        externalId: id,
        title: r[this.cols.title] || id,
        type: CONTENT_TYPES.includes(type) ? type : "vlog",
        productCategory: PRODUCT_CATEGORIES.includes(cat) ? cat : "home",
        postedAt: normTs(r[this.cols.postedAt]),
        isSponsored: /^(1|true|yes|y)$/i.test(r["Sponsored"] ?? ""),
      });
    }
    return [...byId.values()];
  }

  async importMetrics(): Promise<RawMetricDaily[]> {
    const c = this.cols;
    return this.metricRows.map((r) => ({
      contentExternalId: r[c.id],
      date: r[c.date].slice(0, 10),
      views: num(r[c.views]),
      likes: num(r[c.likes]),
      comments: num(r[c.comments]),
      shares: num(r[c.shares]),
      saves: num(r[c.saves]),
      profileViews: num(r[c.profileViews]),
      newFollowers: num(r[c.newFollowers]),
    }));
  }

  async importComments(): Promise<RawComment[]> {
    return this.commentRows.map((r) => ({
      contentExternalId: r["Content ID"],
      authorHandle: r["Username"],
      text: r["Comment"],
      createdAt: normTs(r["Time"]),
    }));
  }

  async importAudience() {
    return [];
  }
}
