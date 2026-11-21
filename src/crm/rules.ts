/**
 * CRM business rules — the single place these definitions live.
 *
 * TIERS (computed, never stored). Count deals that reached **Paid** with
 * `closed_at` inside the 365 days ending on "today":
 *   Partner  ≥ 3 paid deals
 *   Repeat   = 2
 *   One-time = 1
 *   Lead     = 0   (includes brands whose only paid work is older than 12 months)
 *
 * WON deal      = stage is Production or later (the brand has committed), paid or not.
 * Deal value this year = Σ value of won deals created in today's calendar year (committed work, including unpaid).
 * Jobs          = number of PAID deals, lifetime (money actually earned).
 * Lifetime value (LTV) = Σ value of PAID deals, lifetime.  Avg deal size = LTV ÷ jobs.
 *                 Won-but-unpaid work is in "deal value this year" and the finance "expected" figure, not in jobs or LTV.
 * Last job      = latest `posted_at` of the brand's deals.
 * Silent        = has ≥ 1 won deal, no deal currently before Paid, and no activity
 *                 for ≥ SILENT_DAYS days.
 */
import { DEAL_STAGES, type DealStage } from "@/db/schema";

export type Tier = "partner" | "repeat" | "one_time" | "lead";
export const TIERS: Tier[] = ["partner", "repeat", "one_time", "lead"];

export const TIER_WINDOW_DAYS = 365;
export const SILENT_DAYS = 120;

export function tierFor(paidDealsInWindow: number): Tier {
  if (paidDealsInWindow >= 3) return "partner";
  if (paidDealsInWindow === 2) return "repeat";
  if (paidDealsInWindow === 1) return "one_time";
  return "lead";
}

const STAGE_INDEX = Object.fromEntries(DEAL_STAGES.map((s, i) => [s, i])) as Record<DealStage, number>;
export const stageAtLeast = (stage: DealStage, min: DealStage) => STAGE_INDEX[stage] >= STAGE_INDEX[min];
export const isWon = (stage: DealStage) => stageAtLeast(stage, "production");
export const isOpen = (stage: DealStage) => stage !== "paid";

/** Engagement rate = (likes + comments + shares + saves) ÷ views. */
export function engagementRate(m: { views: number; likes: number; comments: number; shares: number; saves: number }) {
  return m.views > 0 ? (m.likes + m.comments + m.shares + m.saves) / m.views : 0;
}
