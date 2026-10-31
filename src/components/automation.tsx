"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Play, RotateCcw, X } from "lucide-react";
import { completeTask, dismissTask, resetTasks, runAutomationsAction, toggleRule } from "@/app/actions";
import type { RunResult } from "@/automation/engine";
import { btn, Pill } from "@/components/ui";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

export function RunPanel({ defaultDate }: { defaultDate: string }) {
  const { t, dateShort } = useI18n();
  const [date, setDate] = useState(defaultDate);
  const [result, setResult] = useState<(RunResult & { published: number }) | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">{t.automation.simulate}</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={btn.input} />
      </label>
      <button className={btn.primary} disabled={pending || !date} onClick={() => start(async () => setResult(await runAutomationsAction(date)))}>
        <Play size={16} aria-hidden /> {pending ? t.automation.running : t.automation.run}
      </button>
      <button
        className={btn.ghost}
        disabled={pending}
        onClick={() =>
          start(async () => {
            await resetTasks();
            setResult(null);
          })
        }
      >
        <RotateCcw size={14} aria-hidden /> {t.automation.resetTasks}
      </button>
      <p className="w-full text-xs text-muted">{t.automation.simulateHint}</p>
      {result && (
        <p role="status" className="w-full rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
          {result.forDate}: {fmt(t.automation.runResult, { created: result.created, skipped: result.skipped })}
          {result.published > 0 && ` · ${fmt(t.automation.publishedDue, { n: result.published })}`}
        </p>
      )}
    </div>
  );
}

export function RuleToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const { t, dateShort } = useI18n();
  const [on, setOn] = useState(enabled);
  const [, start] = useTransition();
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => {
        setOn(!on);
        start(() => toggleRule(id, !on));
      }}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
      <span className="sr-only">{on ? t.automation.on : t.automation.off}</span>
    </button>
  );
}

export interface TaskView {
  id: number;
  title: string;
  reason: string;
  draftMessage: string;
  channel: "email" | "line" | "internal";
  ruleName: string;
  link: string | null;
  brandId: number | null;
  forDate: string;
}

export function TaskCard({ task }: { task: TaskView }) {
  const { t, dateShort } = useI18n();
  const [text, setText] = useState(task.draftMessage);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  return (
    <article id={`task-${task.id}`} className="scroll-mt-6 rounded-xl border border-line bg-card">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-5 py-3.5">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Pill tone={task.channel === "internal" ? "neutral" : "accent"}>{t.channels[task.channel]}</Pill>
            <span>{task.ruleName}</span>
            <span className="tabular">· {task.forDate}</span>
          </div>
          <h3 className="text-base font-medium">{task.title}</h3>
        </div>
        <div className="flex gap-3 text-xs">
          {task.brandId && (
            <Link href={`/brands/${task.brandId}`} className="text-muted hover:text-ink">
              Brand 360
            </Link>
          )}
          {task.link && task.link !== `/brands/${task.brandId}` && (
            <Link href={task.link} className="inline-flex items-center gap-1 text-accent-strong hover:underline">
              {t.common.open} <ExternalLink size={12} aria-hidden />
            </Link>
          )}
        </div>
      </header>
      <div className="space-y-3 p-5">
        <p className="text-sm">
          <span className="text-muted">{t.automation.reason}: </span>
          {task.reason}
        </p>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t.automation.draft}</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(14, text.split("\n").length + 1)} className={`${btn.input} w-full font-sans leading-relaxed`} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className={btn.ghost}
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy size={14} aria-hidden /> {copied ? t.automation.copied : t.automation.copy}
          </button>
          <button className={btn.primary} disabled={pending} onClick={() => start(() => completeTask(task.id, text))}>
            <Check size={16} aria-hidden /> {t.automation.markDone}
          </button>
          <button className={`${btn.ghost} ml-auto`} disabled={pending} onClick={() => start(() => dismissTask(task.id))}>
            <X size={14} aria-hidden /> {t.automation.dismiss}
          </button>
        </div>
      </div>
    </article>
  );
}
