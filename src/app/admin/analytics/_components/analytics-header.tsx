import type { ReactNode } from "react";
import Form from "next/form";
import Link from "next/link";
import { Check, LineChart } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { formatRange, RANGE_LABELS, RANGE_PRESETS, rangeQuery, type DateRange } from "@/lib/analytics/range";
import { cn } from "@/lib/utils";

export type AnalyticsTab = "overview" | "reports";

const TABS: { key: AnalyticsTab; label: string; href: string }[] = [
  { key: "overview", label: "Overview", href: "/admin/analytics" },
  { key: "reports", label: "Reports", href: "/admin/analytics/reports" },
];

/** Page header, section tabs and the period picker shared by analytics pages. */
export function AnalyticsHeader({ active, range, timezone, actions }: { active: AnalyticsTab; range: DateRange; timezone: string; actions?: ReactNode }) {
  const q = rangeQuery(range);
  return (
    <>
      <PageHeader
        title="Analytics & Reports"
        icon={LineChart}
        color="indigo"
        description={`${RANGE_LABELS[range.preset]} · ${formatRange(range.from, range.to)} · dates in ${timezone}`}
        actions={actions}
      />
      <nav aria-label="Analytics sections" className="mb-4 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={`${t.href}${q}`}
                aria-current={t.key === active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition",
                  t.key === active ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <RangePicker action={TABS.find((t) => t.key === active)!.href} range={range} />
      {range.error ? (
        <Alert tone="warning" className="mb-4">
          {range.error} Showing this month instead.
        </Alert>
      ) : null}
    </>
  );
}

/** One row above everything it scopes: presets first, custom dates after. */
export function RangePicker({ action, range }: { action: string; range: DateRange }) {
  return (
    <section aria-label="Period" className="mb-4 flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-card lg:flex-row lg:items-end lg:justify-between">
      <ul className="flex flex-wrap gap-1.5" aria-label="Quick periods">
        {RANGE_PRESETS.filter((p) => p !== "custom").map((p) => {
          const on = range.preset === p;
          return (
            <li key={p}>
              <Link
                href={`${action}?range=${p}`}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition",
                  on ? "border-brand-600 bg-brand-50 font-semibold text-brand-800" : "border-line text-fg hover:bg-brand-50/60",
                )}
              >
                {on ? <Check className="size-4" strokeWidth={3} aria-hidden /> : null}
                {RANGE_LABELS[p]}
              </Link>
            </li>
          );
        })}
      </ul>
      <Form action={action} aria-label="Custom period" className="flex flex-wrap items-end gap-2" key={`${range.preset}-${range.from}-${range.to}`}>
        <input type="hidden" name="range" value="custom" />
        <div className="flex flex-col gap-1">
          <label htmlFor="range-from" className="text-xs font-medium text-muted">
            From
          </label>
          <Input id="range-from" name="from" type="date" required defaultValue={range.from} className="w-[9.5rem]" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="range-to" className="text-xs font-medium text-muted">
            To
          </label>
          <Input id="range-to" name="to" type="date" required defaultValue={range.to} className="w-[9.5rem]" />
        </div>
        <button type="submit" className={buttonVariants({ variant: range.preset === "custom" ? "primary" : "secondary" })}>
          {range.preset === "custom" ? <Check className="size-4" strokeWidth={3} aria-hidden /> : null}
          Custom
        </button>
      </Form>
    </section>
  );
}

