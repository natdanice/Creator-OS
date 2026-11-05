"use client";
import Link from "next/link";
import { useOptimistic, useTransition, useState } from "react";
import { moveDealStage } from "@/app/actions";
import type { DealStage } from "@/db/schema";
import type { Tier } from "@/crm/rules";
import { baht } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";

export interface KanbanDeal {
  id: number;
  title: string;
  brandId: number;
  brandName: string;
  tier: Tier;
  stage: DealStage;
  value: number;
  date: string;
}

export function Kanban({ deals, stages }: { deals: KanbanDeal[]; stages: readonly DealStage[] }) {
  const { t, dateShort } = useI18n();
  const [, start] = useTransition();
  const [optimistic, move] = useOptimistic(deals, (state, { id, stage }: { id: number; stage: DealStage }) => state.map((d) => (d.id === id ? { ...d, stage } : d)));
  const [over, setOver] = useState<DealStage | null>(null);

  const doMove = (id: number, stage: DealStage) =>
    start(async () => {
      move({ id, stage });
      await moveDealStage(id, stage);
    });

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {stages.map((stage) => {
        const col = optimistic.filter((d) => d.stage === stage);
        const total = col.reduce((s, d) => s + d.value, 0);
        return (
          <section
            key={stage}
            aria-label={t.stages[stage]}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(stage);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = Number(e.dataTransfer.getData("text/deal"));
              if (id) doMove(id, stage);
            }}
            className={`flex w-[230px] shrink-0 flex-col rounded-xl border p-2 transition-colors ${over === stage ? "border-accent bg-accent-soft/50" : "border-transparent bg-paper/70"}`}
          >
            <header className="flex items-baseline justify-between px-1.5 pb-2 pt-1">
              <h2 className="text-sm font-medium">
                {t.stages[stage]} <span className="text-muted">({col.length})</span>
              </h2>
              <span className="tabular text-[11px] text-muted">{total ? baht(total) : ""}</span>
            </header>
            <div className="flex min-h-[120px] flex-col gap-2">
              {col.map((d) => (
                <article
                  key={d.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/deal", String(d.id))}
                  className="cursor-grab rounded-lg border border-line bg-white p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)] active:cursor-grabbing"
                >
                  <Link href={`/brands/${d.brandId}`} className="text-xs font-medium text-accent-strong hover:underline">
                    {d.brandName}
                  </Link>
                  <div className="mt-0.5 text-sm leading-snug">{d.title}</div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted">
                    <span className="tabular">{baht(d.value)}</span>
                    <span>{dateShort(d.date)}</span>
                  </div>
                  <select
                    aria-label={t.pipeline.moveTo}
                    value={d.stage}
                    onChange={(e) => doMove(d.id, e.target.value as DealStage)}
                    className="mt-2 w-full rounded-md border border-line bg-white px-2 py-1 text-xs"
                  >
                    {stages.map((s) => (
                      <option key={s} value={s}>
                        {t.pipeline.moveTo}: {t.stages[s]}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
              {col.length === 0 && <p className="px-1.5 py-4 text-center text-xs text-subtle">{t.pipeline.empty}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
