"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { askAiAction } from "@/app/actions";
import type { Answer } from "@/ai";
import { btn, Pill } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";

type Turn = { role: "user"; text: string } | ({ role: "assistant"; fallback?: boolean; error?: boolean } & Answer);

export function Chat({ claudeEnabled }: { claudeEnabled: boolean }) {
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  const ask = (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    const history = turns.filter((x) => !(x.role === "assistant" && x.error)).map((x) => ({ role: x.role, text: x.text }));
    setTurns((v) => [...v, { role: "user", text: question }]);
    setInput("");
    start(async () => {
      try {
        const a = await askAiAction(question, history);
        setTurns((v) => [...v, { role: "assistant", ...a }]);
      } catch {
        setTurns((v) => [...v, { role: "assistant", text: t.askAi.error, citations: [], engine: "rules", error: true }]);
      }
    });
  };

  return (
    <div className="flex min-h-[60vh] flex-col rounded-xl border border-line bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
        <Pill tone={claudeEnabled ? "accent" : "neutral"}>
          <Sparkles size={12} aria-hidden /> {claudeEnabled ? t.askAi.engineClaude : t.askAi.engineRules}
        </Pill>
        {turns.length > 0 && (
          <button onClick={() => setTurns([])} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
            <RotateCcw size={12} aria-hidden /> {t.askAi.clear}
          </button>
        )}
      </div>

      <div className="flex-1 space-y-5 overflow-auto p-5" aria-live="polite">
        {turns.length === 0 && (
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted">{t.askAi.suggestedTitle}</h2>
            <div className="flex flex-wrap gap-2">
              {t.askAi.suggested.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border border-line bg-white px-3 py-1.5 text-left text-sm text-ink-2 hover:border-accent hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((x, i) =>
          x.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 text-sm text-white">{x.text}</p>
            </div>
          ) : (
            <div key={i} className="max-w-[92%]">
              <div className={`whitespace-pre-line rounded-2xl rounded-bl-sm border px-4 py-3 text-sm leading-relaxed ${x.error ? "border-bad/30 bg-bad-soft text-bad" : "border-line bg-white"}`}>{x.text}</div>
              {(x.citations.length > 0 || x.fallback) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {x.citations.length > 0 && <span className="text-muted">{t.askAi.sources}:</span>}
                  {x.citations.map((c) => (
                    <Link key={c.href} href={c.href} className="text-accent-strong hover:underline">
                      {c.label}
                    </Link>
                  ))}
                  {x.fallback && <span className="text-warn">{t.askAi.engineFallback}</span>}
                </div>
              )}
            </div>
          ),
        )}
        {pending && <p className="text-sm text-muted">{t.askAi.thinking}</p>}
        <div ref={end} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask(input);
            }
          }}
          rows={1}
          maxLength={500}
          placeholder={t.askAi.placeholder}
          aria-label={t.askAi.placeholder}
          className={`${btn.input} max-h-32 min-h-[42px] flex-1 resize-y`}
        />
        <button className={btn.primary} disabled={pending || !input.trim()} aria-label={t.askAi.send}>
          <ArrowUp size={16} aria-hidden /> {t.askAi.send}
        </button>
      </form>
    </div>
  );
}
