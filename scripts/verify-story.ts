/**
 * Checks that the seeded data tells the intended story and that running the
 * automations for STORY_DATE yields exactly the expected tasks.
 * Runs on a temporary copy of the database, so the real one is untouched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DB_PATH, openDb } from "@/db/client";
import { STORY_DATE } from "@/lib/config";
import { computeBrandStats } from "@/crm/brandStats";
import { productQuestionSpikes } from "@/cdp/segments";
import { runAutomations } from "@/automation/engine";
import { tasks } from "@/db/schema";

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "creator-os-")), "verify.db");
fs.copyFileSync(DB_PATH, tmp);
const { db, sqlite } = openDb(tmp);

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

const stats = computeBrandStats(db, STORY_DATE);
console.log(`\nStory date: ${STORY_DATE}\n`);
console.table(
  stats.map((s) => ({
    brand: s.brand.name,
    tier: s.tier,
    paid12m: s.paidInWindow,
    valueThisYear: s.dealValueThisYear,
    jobs: s.jobs,
    daysSinceJob: s.daysSinceLastJob,
    daysSinceActivity: s.daysSinceLastActivity,
    silent: s.isSilent,
  })),
);
const tierCount = (tier: string) => stats.filter((s) => s.tier === tier).length;
check("at least 1 Partner", tierCount("partner") >= 1, `partner=${tierCount("partner")} repeat=${tierCount("repeat")} one_time=${tierCount("one_time")} lead=${tierCount("lead")}`);
const silent = stats.filter((s) => s.isSilent).map((s) => s.brand.name);
check("a few One-time brands silent > 120 days", silent.length >= 2 && stats.filter((s) => s.isSilent).every((s) => s.tier === "one_time"), silent.join(", "));

const spikes = productQuestionSpikes(db, STORY_DATE);
console.table(spikes.map((s) => ({ ...s, ratio: Number(s.ratio.toFixed(2)), recentPerDay: Number(s.recentPerDay.toFixed(2)), baselinePerDay: Number(s.baselinePerDay.toFixed(2)) })));
check("exactly one product-question spike (tech)", spikes.filter((s) => s.isSpike).map((s) => s.category).join() === "tech");

const result = runAutomations(db, STORY_DATE);
const created = db.select().from(tasks).all();
console.log("\nTasks created for", STORY_DATE);
for (const tk of created) console.log(`  [${tk.ruleId}] ${tk.title}`);
const byRule = (id: string) => created.filter((tk) => tk.ruleId === id).length;
check("+7 report: 1 task", byRule("post_plus_7") === 1);
check("+30 report + proposal: 1 task", byRule("post_plus_30") === 1);
check("silent re-engagement: 3 tasks", byRule("brand_silent_120") === 3);
check("overdue invoice: 1 task", byRule("invoice_overdue_30") === 1);
check("product-question spike: 1 task", byRule("pq_spike") === 1);
const again = runAutomations(db, STORY_DATE);
check("re-running the same date is idempotent", again.created === 0 && again.skipped === result.created);

sqlite.close();
fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nAll story checks passed.");
process.exit(failures ? 1 : 0);
