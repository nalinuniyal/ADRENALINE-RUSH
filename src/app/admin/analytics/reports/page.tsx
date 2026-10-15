import type { Metadata } from "next";
import { Suspense } from "react";
import { Download, FileSpreadsheet, Lock } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { formatRange, rangeQuery, resolveRange } from "@/lib/analytics/range";
import { canExportReport, REPORTS, type ReportDef } from "@/lib/analytics/reports";
import { requireAccess } from "@/lib/auth/session";
import { AnalyticsHeader } from "../_components/analytics-header";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage({ searchParams }: PageProps<"/admin/analytics/reports">) {
  return (
    <Suspense fallback={<div className="ar-skeleton h-96 rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading reports" />}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

function why(def: ReportDef, permissions: readonly string[]): string {
  if (!permissions.includes("reports.export")) return "Your role cannot export reports.";
  if (def.money && !permissions.includes("finance.view")) return "Needs permission to view finance.";
  return "Needs access to candidates.";
}

function href(def: ReportDef, range: ReturnType<typeof resolveRange>) {
  // Finance exports take plain from/to dates (their own filter format).
  return def.href ? `${def.href}?from=${range.from}&to=${range.to}` : `/admin/analytics/reports/${def.key}${rangeQuery(range)}`;
}

async function Reports({ searchParams }: { searchParams: PageProps<"/admin/analytics/reports">["searchParams"] }) {
  const { access, denied } = await requireAccess(["reports.view"]);
  if (denied) return <AccessDenied />;
  const range = resolveRange(await searchParams, access.organization.timezone);
  const perms = access.permissions;
  const visible = REPORTS.filter((r) => !r.money || perms.includes("finance.view"));
  const hiddenMoney = REPORTS.length - visible.length;

  return (
    <>
      <AnalyticsHeader active="reports" range={range} timezone={access.organization.timezone} />
      <p className="mb-3 text-sm text-muted">
        Each report is a CSV file for <span className="font-medium text-fg">{formatRange(range.from, range.to)}</span> that opens in Excel or Google Sheets. Downloads are recorded in the audit log.
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {visible.map((r) => {
          const allowed = canExportReport(r, perms);
          return (
            <li key={r.key}>
              <Card className="flex h-full flex-col">
                <CardHeader icon={<IconTile icon={FileSpreadsheet} color={r.money ? "green" : "indigo"} size="sm" />}>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {r.title}
                    {r.money ? <Badge tone="success">Finance</Badge> : null}
                  </CardTitle>
                  <CardDescription>{r.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">Filtered by {r.dateField}</span>
                  {allowed ? (
                    <a href={href(r, range)} className={buttonVariants({ variant: "secondary", size: "sm" })} data-testid={`report-${r.key}`}>
                      <Download className="size-4" aria-hidden /> Download CSV
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted">
                      <Lock className="size-3.5" aria-hidden /> {why(r, perms)}
                    </span>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
      {hiddenMoney ? <p className="mt-3 text-xs text-muted">Payment, refund and expense reports are hidden because your role cannot view finance.</p> : null}
    </>
  );
}
