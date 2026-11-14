/**
 * YouTube via YouTube Data API v3 + YouTube Analytics API v2.
 * Daily per-video metrics come straight from Analytics (no totals conversion needed);
 * Analytics data usually lags 2–3 days behind.
 */
import type { PlatformAdapter, RawAudienceSnapshot, RawComment, RawContent, RawMetricDaily } from "@/cdp/adapters/PlatformAdapter";
import { addDays } from "@/lib/dates";
import { bearer, getJson } from "./http";
import { firstLine, guessTags, looksSponsored, toBangkok } from "./tags";

const API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";
const MAX_VIDEOS = 60;
const METRIC_DAYS = 120;
const COMMENT_VIDEOS = 20;

type Report = { columnHeaders: { name: string }[]; rows?: (string | number)[][] };

const AGE: Record<string, string> = { "age13-17": "13-17", "age18-24": "18-24", "age25-34": "25-34", "age35-44": "35-44", "age45-54": "45+", "age55-64": "45+", "age65-": "45+" };
const KNOWN_COUNTRIES = new Set(["TH", "LA", "MY", "US"]);

export class YouTubeApiAdapter implements PlatformAdapter {
  readonly kind = "api" as const;
  readonly platform = "youtube" as const;
  private videos: { id: string; title: string; publishedAt: string; description: string }[] = [];
  private loaded = false;
  private subscribers = 0;

  constructor(
    private token: string,
    private today: string,
  ) {}

  private get<T>(url: string) {
    return getJson<T>(url, bearer(this.token));
  }

  private async load() {
    if (this.loaded) return;
    const ch = await this.get<{ items?: { contentDetails: { relatedPlaylists: { uploads: string } }; statistics: { subscriberCount?: string } }[] }>(`${API}/channels?part=contentDetails,statistics&mine=true`);
    const channel = ch.items?.[0];
    if (!channel) throw new Error("This Google account has no YouTube channel");
    this.subscribers = Number(channel.statistics.subscriberCount ?? 0);
    let pageToken = "";
    while (this.videos.length < MAX_VIDEOS) {
      const page = await this.get<{ items: { contentDetails: { videoId: string; videoPublishedAt?: string }; snippet: { title: string; description: string } }[]; nextPageToken?: string }>(
        `${API}/playlistItems?part=contentDetails,snippet&maxResults=50&playlistId=${channel.contentDetails.relatedPlaylists.uploads}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      );
      for (const it of page.items) {
        if (!it.contentDetails.videoPublishedAt) continue; // private/deleted
        this.videos.push({ id: it.contentDetails.videoId, title: it.snippet.title, description: it.snippet.description, publishedAt: toBangkok(it.contentDetails.videoPublishedAt) });
      }
      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }
    this.loaded = true;
  }

  async importContents(): Promise<RawContent[]> {
    await this.load();
    return this.videos.map((v) => ({
      externalId: v.id,
      title: firstLine(v.title),
      postedAt: v.publishedAt,
      isSponsored: looksSponsored(`${v.title}\n${v.description}`),
      ...guessTags(`${v.title} ${v.description.slice(0, 300)}`),
      tagsGuessed: true,
    }));
  }

  async importMetrics(): Promise<RawMetricDaily[]> {
    await this.load();
    const start = addDays(this.today, -(METRIC_DAYS - 1));
    const recent = this.videos.filter((v) => v.publishedAt.slice(0, 10) >= start);
    const out: RawMetricDaily[] = [];
    for (const v of recent) {
      const from = v.publishedAt.slice(0, 10);
      const r = await this.get<Report>(
        `${ANALYTICS}?ids=channel==MINE&startDate=${from}&endDate=${this.today}&metrics=views,likes,comments,shares,subscribersGained&dimensions=day&filters=video==${v.id}&sort=day`,
      );
      for (const row of r.rows ?? []) {
        const [date, views, likes, comments, shares, subs] = row as [string, number, number, number, number, number];
        out.push({ contentExternalId: v.id, date, views, likes, comments, shares, saves: 0, profileViews: 0, newFollowers: subs });
      }
    }
    return out;
  }

  async importComments(): Promise<RawComment[]> {
    await this.load();
    const out: RawComment[] = [];
    for (const v of this.videos.slice(0, COMMENT_VIDEOS)) {
      const r = await this.get<{ items?: { snippet: { topLevelComment: { snippet: { authorDisplayName: string; authorChannelId?: { value: string }; textOriginal: string; publishedAt: string } } } }[] }>(
        `${API}/commentThreads?part=snippet&maxResults=100&order=time&videoId=${v.id}`,
      ).catch(() => ({ items: [] })); // comments turned off on this video
      for (const it of r.items ?? []) {
        const c = it.snippet.topLevelComment.snippet;
        // Raw author id goes to ingest, which replaces it with a pseudonym before anything is stored.
        out.push({ contentExternalId: v.id, authorHandle: c.authorChannelId?.value ?? c.authorDisplayName, text: c.textOriginal, createdAt: toBangkok(c.publishedAt) });
      }
    }
    return out;
  }

  async importAudience(): Promise<RawAudienceSnapshot[]> {
    await this.load();
    const start = addDays(this.today, -89);
    const demo = await this.get<Report>(`${ANALYTICS}?ids=channel==MINE&startDate=${start}&endDate=${this.today}&metrics=viewerPercentage&dimensions=ageGroup,gender`);
    const geo = await this.get<Report>(`${ANALYTICS}?ids=channel==MINE&startDate=${start}&endDate=${this.today}&metrics=views&dimensions=country&sort=-views&maxResults=50`);
    const age: Record<string, number> = {};
    const gender: Record<string, number> = {};
    for (const [a, g, pct] of (demo.rows ?? []) as [string, string, number][]) {
      age[AGE[a] ?? a] = (age[AGE[a] ?? a] ?? 0) + pct;
      const gk = g === "female" || g === "male" ? g : "other";
      gender[gk] = (gender[gk] ?? 0) + pct;
    }
    const totalViews = (geo.rows ?? []).reduce((s, r) => s + Number(r[1]), 0) || 1;
    const country: Record<string, number> = {};
    for (const [c, views] of (geo.rows ?? []) as [string, number][]) {
      const k = KNOWN_COUNTRIES.has(c) ? c : "other";
      country[k] = (country[k] ?? 0) + (views / totalViews) * 100;
    }
    // YouTube reports demographics of viewers (not subscribers); used as the best available proxy.
    return [{ month: this.today.slice(0, 7), followers: this.subscribers, age, gender, country }];
  }
}
