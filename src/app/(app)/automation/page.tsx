import { desc, eq, ne } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { getDb } from "@/db/client";
import { automationRules, automationRuns, tasks } from "@/db/schema";
import { getStoryDate } from "@/lib/queries/settings";
import { RuleToggle, RunPanel, TaskCard } from "@/components/automation";
import { Card, PageHeader, Pill } from "@/components/ui";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { presentTask, ruleName } from "@/automation/present";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t.automation.title };
}

export default async function AutomationPage() {
  const i18n = await getI18n();
  const { t } = i18n;
  const db = getDb();
  const today = getStoryDate(db);
  const rules = db.select().from(automationRules).all();
  const nameOf = (id: string) => ruleName(i18n, id, rules.find((r) => r.id === id)?.name ?? id);
  const meta = (id: string) => t.ruleMeta[id as "pq_spike"];
  const open = db.select().from(tasks).where(eq(tasks.status, "open")).orderBy(desc(tasks.forDate), tasks.id).all();
  const done = db.select().from(tasks).where(ne(tasks.status, "open")).orderBy(desc(tasks.completedAt)).all();
  const runs = db.select().from(automationRuns).orderBy(desc(automationRuns.id)).limit(8).all();

  return (
    <>
      <PageHeader title={t.automation.title} subtitle={t.automation.subtitle} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={t.automation.rules} className="xl:col-span-2" bodyClass="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-normal">{t.automation.colName}</th>
                <th className="py-2.5 font-normal">{t.automation.colTrigger}</th>
                <th className="py-2.5 font-normal">{t.automation.colChannel}</th>
                <th className="py-2.5 font-normal">{t.automation.colSchedule}</th>
                <th className="py-2.5 font-normal">{t.automation.colLastRun}</th>
                <th className="px-5 py-2.5 text-right font-normal">{t.automation.colEnabled}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 font-medium">{nameOf(r.id)}</td>
                  <td className="max-w-[260px] py-3 text-ink-2">{meta(r.id)?.trigger ?? r.trigger}</td>
                  <td className="py-3">
                    <Pill tone={r.channel === "internal" ? "neutral" : "accent"}>{t.channels[r.channel]}</Pill>
                  </td>
                  <td className="whitespace-nowrap py-3 text-ink-2">{t.ruleMeta.schedule}</td>
                  <td className="tabular py-3 text-xs text-muted">{r.lastRunAt ? r.lastRunAt.replace("T", " ").slice(0, 16) : t.common.none}</td>
                  <td className="px-5 py-3 text-right">
                    <RuleToggle id={r.id} enabled={r.enabled} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          <Card title={t.automation.run}>
            <RunPanel defaultDate={today} />
          </Card>
          <div className="flex items-start gap-3 rounded-xl border border-good/30 bg-good-soft p-4 text-sm text-good">
            <ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden />
            {t.automation.humanNote}
          </div>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-medium">
        {t.automation.tasks} <span className="text-muted">({open.length})</span>
      </h2>
      {open.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-card p-8 text-center text-sm text-muted">{t.automation.noTasks}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {open.map((tk) => (
            <TaskCard key={tk.id} task={{ ...tk, ...presentTask(i18n, tk), ruleName: nameOf(tk.ruleId) }} />
          ))}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={`${t.automation.tasksDone} (${done.length})`}>
          {done.length === 0 ? (
            <p className="text-sm text-muted">{t.common.none}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {done.map((tk) => (
                <li key={tk.id} className="flex items-center justify-between gap-3">
                  <span className={tk.status === "dismissed" ? "text-muted line-through" : ""}>{presentTask(i18n, tk).title}</span>
                  <Pill tone={tk.status === "done" ? "good" : "neutral"}>{tk.status === "done" ? t.automation.tasksDone : t.automation.dismiss}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t.automation.history}>
          {runs.length === 0 ? (
            <p className="text-sm text-muted">{t.common.none}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex justify-between gap-3">
                  <span className="tabular">{r.forDate} 10:00</span>
                  <span className="text-muted">{fmt(t.automation.runResult, { created: r.created, skipped: r.skipped })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
