import { Sidebar } from "@/components/layout/Sidebar";
import { getDb } from "@/db/client";
import { getStoryDate } from "@/lib/queries/settings";

// Every page reads the local SQLite file at request time.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const storyDate = getStoryDate(getDb());
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar storyDate={storyDate} />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}
