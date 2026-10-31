// English stub. Fill in keys to translate; missing keys fall back to Thai (see ./index.ts).
import type { Dict } from "./th";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const en: DeepPartial<Dict> = {
  app: { mockBadge: "Mock data" },
  nav: { overview: "Overview", brands: "Brands & Deals", automation: "Automation", settings: "Settings" },
};
