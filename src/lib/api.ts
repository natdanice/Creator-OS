/**
 * Client for the Go API in /backend (see its README section). Used by server components, server
 * actions and route handlers only: the token never reaches the browser.
 *
 *   API_URL    where the Go API listens (default http://127.0.0.1:8080)
 *   API_TOKEN  sent as "Authorization: Bearer …" when set (must match the API's own API_TOKEN)
 */
import type { overviewData } from "@/lib/queries/overview";
import type { TodayAction } from "@/lib/queries/today";
import type { BrandStats } from "@/crm/brandStats";
import type { financeData } from "@/crm/finance";
import type { DealStage } from "@/db/schema";
import type { Tier } from "@/crm/rules";

const BASE = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function headers(json: boolean): Record<string, string> {
  return { ...(json ? { "Content-Type": "application/json" } : {}), ...(process.env.API_TOKEN ? { Authorization: `Bearer ${process.env.API_TOKEN}` } : {}) };
}

/** Fetch from the Go API; throws ApiError with a readable message (including "the API isn't running"). */
export async function apiFetch(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: init.method ?? "GET", headers: headers(init.body !== undefined), body: init.body !== undefined ? JSON.stringify(init.body) : undefined, cache: "no-store" });
  } catch {
    throw new ApiError(`The Creator OS API isn't reachable at ${BASE}. Start it with "npm run dev:api" (live data: "npm run dev:api:live").`, 503);
  }
  if (!res.ok) {
    const msg = await res.json().then((j: { error?: string }) => j.error).catch(() => undefined);
    throw new ApiError(msg ?? `API error ${res.status} for ${path}`, res.status);
  }
  return res;
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return (await apiFetch(path, init)).json() as Promise<T>;
}

/* ── Typed calls ── */

export async function getOverview(range: number) {
  const r = await api<{ today: string; overview: ReturnType<typeof overviewData> }>(`/api/v1/overview?range=${range}`);
  // The API sends null for "no baseline at all" (an infinite jump), which JSON can't carry as Infinity.
  r.overview.spikes = r.overview.spikes.map((s) => ({ ...s, ratio: s.ratio ?? Infinity }));
  return r;
}

export const getTodayActions = () => api<{ today: string; actions: TodayAction[] }>("/api/v1/today");

export function getBrands(filter: { q?: string; tier?: string; category?: string }) {
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
  return api<{ today: string; tierCounts: Record<Tier, number>; rows: BrandStats[] }>(`/api/v1/brands${qs ? `?${qs}` : ""}`);
}

export interface PipelineDeal {
  id: number;
  title: string;
  brandId: number;
  brandName: string;
  tier: Tier;
  stage: DealStage;
  value: number;
  date: string;
}
export const getPipeline = () => api<{ today: string; stages: DealStage[]; deals: PipelineDeal[] }>("/api/v1/pipeline");

export const getFinance = () => api<{ today: string; finance: ReturnType<typeof financeData> }>("/api/v1/finance");

export const moveDeal = (id: number, stage: DealStage) => api<{ changed: boolean }>(`/api/v1/deals/${id}/stage`, { method: "POST", body: { stage } });
export const payInvoice = (id: number) => api<{ ok: boolean }>(`/api/v1/invoices/${id}/paid`, { method: "POST" });
export const createBrand = (b: { name: string; category: string; website: string; contactName: string; contactRole: string; channel: string; handle: string }) =>
  api<{ id: number }>("/api/v1/brands", { method: "POST", body: b });

/* ── Inbox ── */

import type { CommentCategory, BriefSignal } from "@/db/schema";
import type { Message, ThreadSummary } from "@/inbox/queries";
import type { Contact } from "@/lib/apiTypes";

export interface RateItem {
  code: string;
  name: string;
  price: number;
}
export interface ThreadMessage extends Omit<Message, "brief"> {
  brief: (BriefSignal & { deliverables: RateItem[]; listPrice: number }) | null;
  dealTitle: string | null;
  dealStage: DealStage | null;
}
export interface InboxComment {
  id: number;
  text: string;
  category: CommentCategory;
  platformId: "tiktok" | "instagram" | "youtube";
  author: string;
  createdAt: string;
  replyText: string | null;
  contentTitle: string;
  productCategory: import("@/db/schema").ProductCategory;
  isSponsored: boolean;
}

export const getInboxSummary = () =>
  api<{ today: string; counts: { unread: number; briefs: number }; needsReply: number; commentCounts: { category: CommentCategory; n: number }[] }>("/api/v1/inbox");
export const getThreads = () => api<{ today: string; threads: ThreadSummary[] }>("/api/v1/inbox/threads");
export const getThread = (brandId: number) => api<{ today: string; thread: { contact: Contact | null; messages: ThreadMessage[] } }>(`/api/v1/inbox/threads/${brandId}`);
export function getComments(f: { cat?: string; platform?: string; status?: string }) {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  return api<{ today: string; rows: InboxComment[]; total: number; windowDays: number; counts: { category: CommentCategory; n: number }[] }>(`/api/v1/inbox/comments${qs ? `?${qs}` : ""}`);
}
export const markRead = (brandId: number) => api<{ changed: number }>(`/api/v1/inbox/threads/${brandId}/read`, { method: "POST" });
export const replyToBrand = (brandId: number, body: string) => api<{ ok: boolean }>(`/api/v1/inbox/threads/${brandId}/reply`, { method: "POST", body: { body } });
export const convertBriefApi = (id: number, title: string, value: number) => api<{ converted: boolean }>(`/api/v1/messages/${id}/convert`, { method: "POST", body: { title, value } });
export const ignoreBriefApi = (id: number) => api<{ ok: boolean }>(`/api/v1/messages/${id}/ignore`, { method: "POST" });
export const replyCommentApi = (id: number, text: string) => api<{ ok: boolean }>(`/api/v1/comments/${id}/reply`, { method: "POST", body: { text } });
export const hideCommentApi = (id: number) => api<{ ok: boolean }>(`/api/v1/comments/${id}/hide`, { method: "POST" });

/* ── Audience ── */

import type { AudienceProfile, SegmentId, SegmentSummary } from "@/cdp/profiles";

export interface AudienceDemographics {
  platformId: string;
  followers: number;
  age: { bucket: string; pct: number }[];
  gender: { bucket: string; pct: number }[];
  country: { bucket: string; pct: number }[];
}
export interface SegmentMember {
  pseudoId: string;
  comments: number;
  productQuestions: number;
  platforms: string[];
  lastAt: string;
  contactable: boolean;
}

export const getAudience = (f: { month?: string; platform?: string }) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  return api<{
    today: string;
    months: string[];
    month: string | null;
    platform: "tiktok" | "instagram" | "youtube";
    series: { month: string; tiktok: number; instagram: number; youtube: number }[];
    splitMonth: string | null;
    demographics: AudienceDemographics | null;
    segments: { activePeople: number; excludedSpam: number; summaries: SegmentSummary[] };
    spikingSegments: string[];
  }>(`/api/v1/audience${qs ? `?${qs}` : ""}`);
};
export const getSegmentMembers = (id: SegmentId, limit = 30) => api<{ total: number; rows: SegmentMember[] }>(`/api/v1/audience/segments/${id}/members?limit=${limit}`);
export const getAudienceMember = (pseudoId: string) =>
  api<{ profile: AudienceProfile }>(`/api/v1/audience/members/${encodeURIComponent(pseudoId)}`).then((r) => r.profile).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e)));

/* ── Automation ── */

import type { automationRules, automationRuns, tasks } from "@/db/schema";

export const getAutomation = () =>
  api<{ today: string; rules: (typeof automationRules.$inferSelect)[]; open: (typeof tasks.$inferSelect)[]; done: (typeof tasks.$inferSelect)[]; runs: (typeof automationRuns.$inferSelect)[] }>("/api/v1/automation");
export const setRuleEnabled = (id: string, enabled: boolean) => api<{ ok: boolean }>(`/api/v1/automation/rules/${encodeURIComponent(id)}/enabled`, { method: "POST", body: { enabled } });
export const resetAutomation = () => api<{ ok: boolean }>("/api/v1/automation/reset", { method: "POST" });
export const completeTaskApi = (id: number, message: string) =>
  api<{ done: boolean; title: string; channel: "email" | "line" | "internal"; brandId: number | null; body: string }>(`/api/v1/tasks/${id}/complete`, { method: "POST", body: { message } });
export const dismissTaskApi = (id: number) => api<{ ok: boolean }>(`/api/v1/tasks/${id}/dismiss`, { method: "POST" });

/* ── Settings ── */

import type { importRuns, platforms, rateCard } from "@/db/schema";

export interface SettingsData {
  platforms: (typeof platforms.$inferSelect)[];
  profile: { name: string; tagline: string; handles: Record<string, string> };
  latestFollowers: Record<string, number>;
  rateCard: (typeof rateCard.$inferSelect)[];
  importRuns: (typeof importRuns.$inferSelect)[];
  consent: { purpose: "analytics" | "marketing"; lawfulBasis: "legitimate_interest" | "consent"; status: "active" | "withdrawn"; n: number }[];
  redactedComments: number;
}
export const getSettings = () => api<{ today: string; settings: SettingsData }>("/api/v1/settings");
export const saveRatesApi = (prices: Record<string, number>) => api<{ changed: number }>("/api/v1/settings/rates", { method: "PUT", body: { prices } });
export const saveProfileApi = (p: { name: string; tagline: string; handles: Record<string, string>; followers: Record<string, string> }) => api<{ ok: boolean }>("/api/v1/settings/profile", { method: "PUT", body: p });

/* ── Brand 360 ── */

import type { ContentPerformance } from "@/crm/contentPerformance";
import type { ApiOffer } from "@/crm/presentOffer";
import type { activities as activitiesTable, invoices as invoicesTable } from "@/db/schema";

export interface Brand360Data {
  stats: BrandStats;
  performance: ContentPerformance[];
  offer: ApiOffer;
  invoices: (typeof invoicesTable.$inferSelect)[];
  activities: (typeof activitiesTable.$inferSelect)[];
  rateCard: { code: string; name: string }[];
}
/** null when there is no such brand. */
export const getBrand360 = (id: number) =>
  api<{ today: string; brand: Brand360Data }>(`/api/v1/brands/${id}`).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e)));
