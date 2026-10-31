/** Which platform a content-producing rate-card code is published on (bundles expand via rate_card.includes). */
export const DELIVERABLE_PLATFORM: Record<string, "tiktok" | "instagram" | "youtube"> = {
  TT_VIDEO: "tiktok",
  IG_REEL: "instagram",
  YT_INTEGRATION: "youtube",
  YT_DEDICATED: "youtube",
};
