"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { VIZ } from "./viz";

/*
 * Client-side chart marks only. Every number is computed on the server and
 * passed in; the same numbers are also rendered as a table next to each chart
 * (see ChartFigure), so nothing is available only by hovering.
 */

const compactNumber = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

/** Axis labels: ₹0 / ₹15K / ₹2.5L / ₹1.2Cr for INR (Intl's en-IN compact prints "T" for thousand). */
function compactMoney(amount: number, currency: string) {
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const fmt = (v: number, unit: string) => `${sign}${symbol}${Number(v.toFixed(1)).toLocaleString("en-IN")}${unit}`;
  if (currency === "INR") {
    if (abs >= 1e7) return fmt(abs / 1e7, "Cr");
    if (abs >= 1e5) return fmt(abs / 1e5, "L");
  } else if (abs >= 1e6) return fmt(abs / 1e6, "M");
  if (abs >= 1e3) return fmt(abs / 1e3, "K");
  return fmt(abs, "");
}

function fullMoney(rupees: number, currency: string) {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 }).format(rupees);
  } catch {
    return `${currency} ${rupees.toFixed(2)}`;
  }
}

const axisTick = { fill: VIZ.axisText, fontSize: 12 };

type Series = { key: string; label: string; color: string };

/** Legend above a chart: a short key in the series colour, text in ink. */
export function Legend({ series, shape }: { series: Series[]; shape: "line" | "rect" }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden>
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className={shape === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]"} style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Values lead, labels follow; line keys, not boxes. */
function TooltipCard({ title, rows }: { title: ReactNode; rows: { color: string; label: string; value: string }[] }) {
  return (
    <div className="min-w-36 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-card">
      <p className="mb-1 text-muted">{title}</p>
      <ul className="grid gap-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
            <span className="font-semibold text-fg tabular-nums">{r.value}</span>
            <span className="text-muted">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function seriesTooltip(series: Series[], format: (v: number) => string) {
  function SeriesTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as Record<string, number | string>;
    return (
      <TooltipCard
        title={String(row?.label ?? label ?? "")}
        rows={series.map((s) => ({ color: s.color, label: s.label, value: format(Number(row?.[s.key] ?? 0)) }))}
      />
    );
  }
  return SeriesTooltip;
}

export type ActivityDatum = { label: string; leads: number; enrollments: number };

const ACTIVITY_SERIES: Series[] = [
  { key: "leads", label: "New leads", color: VIZ.series[0] },
  { key: "enrollments", label: "Enrollments", color: VIZ.series[1] },
];

export function ActivityChart({ data }: { data: ActivityDatum[] }) {
  const fmt = (v: number) => v.toLocaleString("en-IN");
  return (
    <div>
      <Legend series={ACTIVITY_SERIES} shape="line" />
      <LineChart responsive style={{ width: "100%", height: 260 }} data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke={VIZ.grid} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: VIZ.baseline }} minTickGap={16} />
        <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => compactNumber.format(v)} width={44} />
        <Tooltip content={seriesTooltip(ACTIVITY_SERIES, fmt)} cursor={{ stroke: VIZ.baseline, strokeWidth: 1 }} isAnimationActive={false} />
        {ACTIVITY_SERIES.map((s) => (
          <Line
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={data.length <= 16 ? { r: 4, fill: s.color, stroke: VIZ.surface, strokeWidth: 2 } : false}
            activeDot={{ r: 5, fill: s.color, stroke: VIZ.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </div>
  );
}

export type MoneyDatum = { label: string; collections: number; refunds: number; expenses: number };

const MONEY_SERIES: Series[] = [
  { key: "collections", label: "Collections", color: VIZ.series[0] },
  { key: "refunds", label: "Refunds", color: VIZ.series[1] },
  { key: "expenses", label: "Expenses", color: VIZ.series[2] },
];

/** Amounts in rupees (not paise). */
export function MoneyChart({ data, currency }: { data: MoneyDatum[]; currency: string }) {
  return (
    <div>
      <Legend series={MONEY_SERIES} shape="rect" />
      <BarChart responsive style={{ width: "100%", height: 260 }} data={data} margin={{ top: 8, right: 12, bottom: 0, left: -4 }} barGap={2} barCategoryGap="24%" accessibilityLayer>
        <CartesianGrid vertical={false} stroke={VIZ.grid} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: VIZ.baseline }} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => compactMoney(v, currency)} width={56} />
        <Tooltip content={seriesTooltip(MONEY_SERIES, (v) => fullMoney(v, currency))} cursor={{ fill: VIZ.hover }} isAnimationActive={false} />
        {MONEY_SERIES.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </div>
  );
}

export type SourceDatum = { label: string; leads: number; enrolled: number };

const SOURCE_SERIES: Series[] = [
  { key: "leads", label: "Leads", color: VIZ.series[0] },
  { key: "enrolled", label: "Enrolled", color: VIZ.series[1] },
];

export function SourcesChart({ data }: { data: SourceDatum[] }) {
  const height = Math.max(140, data.length * 44 + 32);
  return (
    <div>
      <Legend series={SOURCE_SERIES} shape="rect" />
      <BarChart responsive layout="vertical" style={{ width: "100%", height }} data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%" accessibilityLayer>
        <CartesianGrid horizontal={false} stroke={VIZ.grid} />
        <XAxis type="number" allowDecimals={false} tick={axisTick} tickLine={false} axisLine={{ stroke: VIZ.baseline }} tickFormatter={(v: number) => compactNumber.format(v)} />
        <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={false} width={96} />
        <Tooltip content={seriesTooltip(SOURCE_SERIES, (v) => v.toLocaleString("en-IN"))} cursor={{ fill: VIZ.hover }} isAnimationActive={false} />
        {SOURCE_SERIES.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} maxBarSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </div>
  );
}
