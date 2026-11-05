"use client";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactNum, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { useMonthLabel } from "./monthLabel";

type Row = { month: string; tiktok: number; instagram: number; youtube: number };
const SERIES = [
  { key: "tiktok", color: "var(--color-tiktok)" },
  { key: "instagram", color: "var(--color-instagram)" },
  { key: "youtube", color: "var(--color-youtube)" },
] as const;

function TooltipBox({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string }) {
  const { t } = useI18n();
  const monthLabel = useMonthLabel();
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium text-ink">{label && monthLabel(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="h-0.5 w-3 rounded" style={{ background: p.color }} />
            {t.platforms[p.dataKey as "tiktok"]}
          </span>
          <span className="tabular text-ink">{num(p.value)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-6 border-t border-line pt-1 text-ink">
        <span>{t.common.total}</span>
        <span className="tabular">{num(total)}</span>
      </div>
    </div>
  );
}

export function FollowerGrowthChart({ data }: { data: Row[] }) {
  const { t } = useI18n();
  const monthLabel = useMonthLabel();
  const [table, setTable] = useState(false);
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button onClick={() => setTable((v) => !v)} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          {table ? t.common.chartView : t.common.tableView}
        </button>
      </div>
      {table ? (
        <div className="max-h-[260px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-left text-muted">
              <tr>
                <th className="py-1.5 font-normal">{t.audience.month}</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-1.5 text-right font-normal">
                    {t.platforms[s.key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {data.map((r) => (
                <tr key={r.month} className="border-t border-line">
                  <td className="py-1">{monthLabel(r.month)}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="py-1 text-right">
                      {num(r[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#ece8de" />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: "#6b6963" }} tickLine={false} axisLine={{ stroke: "#e3ded2" }} minTickGap={24} />
              <YAxis tickFormatter={compactNum} tick={{ fontSize: 11, fill: "#6b6963" }} tickLine={false} axisLine={false} width={44} />
              <Tooltip content={<TooltipBox />} cursor={{ stroke: "#9a978f", strokeWidth: 1, strokeDasharray: "3 3" }} />
              <Legend
                verticalAlign="top"
                align="left"
                height={28}
                iconType="plainline"
                itemSorter={null}
                formatter={(v: string) => <span className="text-xs text-ink-2">{t.platforms[v as "tiktok"]}</span>}
              />
              {SERIES.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
