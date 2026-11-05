import { Sidebar } from "@/components/layout/Sidebar";
import { getDb } from "@/db/client";
import { getStoryDate } from "@/lib/queries/settings";
import { inboxCounts } from "@/inbox/queries";

// Every page reads the local SQLite file at request time.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const db = getDb();
  const storyDate = getStoryDate(db);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar storyDate={storyDate} inboxUnread={inboxCounts(db).unread} />
      <main className="min-w-0 flex-1 px-4 pb-28 pt-5 md:px-8 md:py-8">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}
