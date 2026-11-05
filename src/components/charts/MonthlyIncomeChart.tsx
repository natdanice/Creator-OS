"use client";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { baht, compactNum } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { useMonthLabel } from "./monthLabel";

type Row = { month: string; income: number };
// accent-strong: the brand orange (#f26b3a) is below 3:1 against white for a data mark.
const BAR = "var(--color-accent-strong)";

function TooltipBox({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  const monthLabel = useMonthLabel();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-medium text-ink">{label && monthLabel(label)}</div>
      <div className="tabular mt-0.5 text-ink">{baht(payload[0].value)}</div>
    </div>
  );
}

export function MonthlyIncomeChart({ data }: { data: Row[] }) {
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
        <div className="max-h-[240px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-left text-muted">
              <tr>
                <th className="py-1.5 font-normal">{t.audience.month}</th>
                <th className="py-1.5 text-right font-normal">{t.finance.colAmount}</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {data.map((r) => (
                <tr key={r.month} className="border-t border-line">
                  <td className="py-1">{monthLabel(r.month)}</td>
                  <td className="py-1 text-right">{baht(r.income)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="#ece8de" />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: "#6b6963" }} tickLine={false} axisLine={{ stroke: "#e3ded2" }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis tickFormatter={(v: number) => compactNum(v)} tick={{ fontSize: 11, fill: "#6b6963" }} tickLine={false} axisLine={false} width={40} />
              <Tooltip content={<TooltipBox />} cursor={{ fill: "#f4f1ea" }} />
              <Bar dataKey="income" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
