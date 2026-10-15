import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A chart with its numbers. The drawing is hidden from screen readers (it
 * repeats the table); the table is always one click away for everyone.
 */
export function ChartCard({
  title,
  description,
  summary,
  chart,
  table,
  empty,
  className,
  tableOpen = false,
}: {
  title: string;
  description?: ReactNode;
  /** One sentence for screen readers describing what the chart shows. */
  summary: string;
  chart?: ReactNode;
  table?: ReactNode;
  /** Shown instead of chart and table when there is nothing to plot. */
  empty?: ReactNode;
  className?: string;
  tableOpen?: boolean;
}) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="pt-1">
        {empty ? (
          <p className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{empty}</p>
        ) : (
          <figure className="m-0">
            <figcaption className="sr-only">{summary} The same numbers are in the table below.</figcaption>
            {chart ? <div aria-hidden>{chart}</div> : null}
            {table ? (
              <details className="group mt-2" open={tableOpen}>
                <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">
                  <span className="group-open:hidden">Show the numbers</span>
                  <span className="hidden group-open:inline">Hide the numbers</span>
                </summary>
                <div className="mt-2 overflow-x-auto">{table}</div>
              </details>
            ) : null}
          </figure>
        )}
      </CardContent>
    </Card>
  );
}

/** Plain accessible table; numbers right-aligned in tabular figures. */
export function DataTable({ caption, head, rows, numeric = [] }: { caption: string; head: string[]; rows: ReactNode[][]; numeric?: number[] }) {
  return (
    <table className="w-full min-w-[20rem] border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line text-left text-xs text-muted">
          {head.map((h, i) => (
            <th key={h} scope="col" className={cn("px-2 py-1.5 font-medium", numeric.includes(i) && "text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-line last:border-0">
            {r.map((c, ci) =>
              ci === 0 ? (
                <th key={ci} scope="row" className="px-2 py-1.5 text-left font-normal">
                  {c}
                </th>
              ) : (
                <td key={ci} className={cn("px-2 py-1.5", numeric.includes(ci) && "text-right tabular-nums")}>
                  {c}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
