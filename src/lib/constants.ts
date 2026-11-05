/** Plain enums shared by server and client code (kept out of the DB schema so client bundles stay small). */
export const CONTENT_TYPES = ["review", "tutorial", "vlog", "bts", "cover", "reply", "lifestyle"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const PRODUCT_CATEGORIES = ["skincare", "tech", "food", "home", "fashion", "music"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
