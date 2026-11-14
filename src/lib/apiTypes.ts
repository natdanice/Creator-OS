/** Shapes the Go API returns that have no Drizzle table type of their own. */
import type { brandContacts } from "@/db/schema";

export type Contact = typeof brandContacts.$inferSelect;
