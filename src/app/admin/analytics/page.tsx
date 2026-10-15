import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBucket, rangeQuery, resolveRange, type DateRange } from "@/lib/analytics/range";
import { percent } from "@/lib/analytics/reports";
import { requireAccess } from "@/lib/auth/session";
import {
  getActivitySeries,
  getBatchAttendance,
  getCoursePerformance,
  getFunnel,
  getKpis,
  getLeadSources,
  getMoneySeries,
  getMoneyTotals,
  getTopResources,
  type FunnelStage,
} from "@/lib/data/analytics";
import { formatPaise } from "@/lib/finance/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AnalyticsHeader } from "./_components/analytics-header";
import { ChartCard, DataTable } from "./_components/chart-card";
import { ActivityChart, MoneyChart, SourcesChart } from "./_components/charts";
import { buildTiles, KpiSkeleton, KpiTiles } from "./_components/kpi-tiles";
import { VIZ } from "./_components/viz";

export const metadata: Metadata = { title: "Analytics & Reports" };

export default function AnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  return (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <Analytics searchParams={searchParams} />
    </Suspense>
  );
}

function AnalyticsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading analytics">
      <div className="ar-skeleton mb-4 h-20 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton mb-4 h-16 rounded-[var(--radius-card)]" />
      <KpiSkeleton />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="ar-skeleton h-80 rounded-[var(--radius-card)]" />
        <div className="ar-skeleton h-80 rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = { unknown: "Not recorded", website: "Website", demo_request: "Demo request", import: "Import", manual: "Added by hand" };
const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s;
const n = (v: number) => v.toLocaleString("en-IN");

async function Analytics({ searchParams }: { searchParams: PageProps<"/admin/analytics">["searchParams"] }) {
  const { access, denied } = await requireAccess(["reports.view"]);
  if (denied) return <AccessDenied />;
  const orgId = access.organization.id;
  const tz = access.organization.timezone;
  const canFinance = access.permissions.includes("finance.view");
  const canExport = access.permissions.includes("reports.export");
  const range = resolveRange(await searchParams, tz);
  const supabase = await createSupabaseServerClient();

  const [kpis, money, activity, moneySeries, funnel, sources, courses, attendance, resources] = await Promise.all([
    getKpis(supabase, orgId, range),
    getMoneyTotals(supabase, orgId, range, canFinance),
    getActivitySeries(supabase, orgId, range),
    canFinance ? getMoneySeries(supabase, orgId, range) : Promise.resolve(null),
    getFunnel(supabase, orgId, range),
    getLeadSources(supabase, orgId, range),
    getCoursePerformance(supabase, orgId, range),
    getBatchAttendance(supabase, orgId, range),
    getTopResources(supabase, orgId, range),
  ]);
  const cur = money?.currency ?? access.organization.currency;
  const financeQ = `?from=${range.from}&to=${range.to}`;

  // Leads by channel for the chart: top 7, the rest folded into "Other".
  const byChannel = new Map<string, { leads: number; enrolled: number }>();
  for (const s of sources) {
    const cur = byChannel.get(s.channel) ?? { leads: 0, enrolled: 0 };
    byChannel.set(s.channel, { leads: cur.leads + s.leads, enrolled: cur.enrolled + s.enrolled });
  }
  const channels = [...byChannel.entries()].sort((a, b) => b[1].leads - a[1].leads);
  const top = channels.slice(0, 7).map(([k, v]) => ({ label: sourceLabel(k), ...v }));
  const rest = channels.slice(7).reduce((t, [, v]) => ({ leads: t.leads + v.leads, enrolled: t.enrolled + v.enrolled }), { leads: 0, enrolled: 0 });
  const sourceData = rest.leads ? [...top, { label: "Other", ...rest }] : top;

  const activityData = activity.map((a) => ({ label: range.bucket === "week" ? `Wk of ${formatBucket(a.bucket, "week")}` : formatBucket(a.bucket, range.bucket), leads: a.leads, enrollments: a.enrollments, registrations: a.registrations }));
  const activityTotal = activity.reduce((t, a) => t + a.leads + a.enrollments, 0);
  const moneyData = (moneySeries ?? []).map((m) => ({ label: formatBucket(m.month, "month"), collections: m.collections / 100, refunds: m.refunds / 100, expenses: m.expenses / 100, raw: m }));
  const moneyAny = (moneySeries ?? []).some((m) => m.collections || m.refunds || m.expenses);
  const activeCourses = courses.filter((c) => c.registrations || c.demoBookings || c.enrollments || c.revenue || c.outstanding);

  return (
    <>
      <AnalyticsHeader
        active="overview"
        range={range}
        timezone={tz}
        actions={
          canExport ? (
            <Link href={`/admin/analytics/reports${rangeQuery(range)}`} className={buttonVariants({ variant: "secondary" })}>
              <Download className="size-4" aria-hidden /> Reports &amp; CSV
            </Link>
          ) : undefined
        }
      />

      <KpiTiles tiles={buildTiles(kpis, money, financeQ)} />
      {!canFinance ? <p className="mt-2 text-xs text-muted">Money figures are hidden because your role cannot view finance.</p> : null}
      {money?.otherCurrencyRows ? (
        <p className="mt-2 text-xs text-muted">{money.otherCurrencyRows} record(s) in other currencies are not included in these {cur} totals.</p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard
          className={canFinance ? undefined : "lg:col-span-2"}
          title="Leads and enrollments"
          description={`New leads and new enrollments per ${range.bucket}.`}
          summary={`Line chart of new leads and enrollments per ${range.bucket}: ${n(kpis.newLeads)} leads and ${n(kpis.enrollments)} enrollments in total.`}
          empty={activityTotal === 0 ? "No leads or enrollments in this period yet." : undefined}
          chart={<ActivityChart data={activityData} />}
          table={
            <DataTable
              caption={`Leads, registrations and enrollments per ${range.bucket}`}
              head={[range.bucket === "month" ? "Month" : range.bucket === "week" ? "Week starting" : "Day", "New leads", "Registrations", "Enrollments"]}
              numeric={[1, 2, 3]}
              rows={activityData.filter((a) => a.leads || a.registrations || a.enrollments).map((a) => [a.label, n(a.leads), n(a.registrations), n(a.enrollments)])}
            />
          }
        />
        {canFinance && moneySeries ? (
          <ChartCard
            title="Money in and out"
            description="Collections, refunds and expenses per month, by their own dates."
            summary={`Grouped bar chart per month of collections, refunds and expenses in ${cur}.`}
            empty={moneyAny ? undefined : "No payments, refunds or expenses in this period."}
            chart={<MoneyChart data={moneyData.map((d) => ({ label: d.label, collections: d.collections, refunds: d.refunds, expenses: d.expenses }))} currency={cur} />}
            table={
              <DataTable
                caption="Collections, refunds, expenses and cash result per month"
                head={["Month", "Collections", "Refunds", "Expenses", "Cash result"]}
                numeric={[1, 2, 3, 4]}
                rows={moneyData.map((m) => [m.label, formatPaise(m.raw.collections, cur), formatPaise(m.raw.refunds, cur), formatPaise(m.raw.expenses, cur), formatPaise(m.raw.cashResult, cur)])}
              />
            }
          />
        ) : null}

        <Funnel stages={funnel} />

        <ChartCard
          title="Leads by source"
          description="First-touch source of leads added in the period (UTM source, else how they arrived)."
          summary={`Bar chart of leads and enrolled leads per source across ${channels.length} sources.`}
          empty={sources.length === 0 ? "No leads in this period." : undefined}
          chart={<SourcesChart data={sourceData} />}
          table={
            <DataTable
              caption="Leads by source, medium and UTM campaign"
              head={["Source", "Medium", "Campaign", "Leads", "Demo bookings", "Enrolled", "Conversion"]}
              numeric={[3, 4, 5, 6]}
              rows={sources.map((s) => [sourceLabel(s.channel), s.medium ?? "—", s.campaign ?? "—", n(s.leads), n(s.demoBookings), n(s.enrolled), `${percent(s.enrolled, s.leads)}%`])}
            />
          }
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Course performance</CardTitle>
          <CardDescription>
            Registrations, demo bookings and enrollments in the period.
            {canFinance ? " Net collections are payments received minus refunds in the period; outstanding is as of today." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeCourses.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
              Nothing happened on any course in this period. <Link href="/admin/courses" className="text-brand-700 hover:underline">Open courses</Link>.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <DataTable
                caption="Course performance"
                head={["Course", "Registrations", "Demo bookings", "Enrollments", "Conversion", ...(canFinance ? ["Net collections", "Outstanding"] : [])]}
                numeric={canFinance ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4]}
                rows={activeCourses.map((c) => [
                  <Link key="t" href={`/admin/courses/${c.courseId}`} className="font-medium text-brand-700 hover:underline">
                    {c.title}
                  </Link>,
                  n(c.registrations),
                  n(c.demoBookings),
                  n(c.enrollments),
                  c.registrations ? `${percent(c.enrollments, c.registrations)}%` : "—",
                  ...(canFinance ? [formatPaise(c.revenue ?? 0, c.currency), formatPaise(c.outstanding ?? 0, c.currency)] : []),
                ])}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Batch attendance</CardTitle>
            <CardDescription>Class sessions held in the period. Rate = present or late ÷ marked (excused left out).</CardDescription>
          </CardHeader>
          <CardContent>
            {attendance.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">No class sessions were held in this period.</p>
            ) : (
              <ul className="grid gap-3">
                {attendance.map((b) => (
                  <li key={b.batchId}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <Link href={`/admin/batches/${b.batchId}`} className="min-w-0 truncate font-medium text-brand-700 hover:underline">
                        {b.batchName}
                      </Link>
                      <span className="shrink-0 font-semibold tabular-nums">{b.rate === null ? "Not marked" : `${b.rate}%`}</span>
                    </div>
                    <Meter value={b.rate ?? 0} />
                    <p className="mt-0.5 text-xs text-muted">
                      {b.courseTitle} · {n(b.markedSessions)} of {n(b.sessions)} session{b.sessions === 1 ? "" : "s"} marked · {n(b.present)} present, {n(b.late)} late, {n(b.absent)} absent
                      {b.excused ? `, ${n(b.excused)} excused` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Most shared resources</CardTitle>
            <CardDescription>Demos and resources shared with candidates in the period (failed emails left out).</CardDescription>
          </CardHeader>
          <CardContent>
            {resources.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">Nothing was shared in this period.</p>
            ) : (
              <ol className="grid gap-3">
                {resources.map((r) => (
                  <li key={r.resourceId}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <Link href={`/admin/resources/${r.resourceId}`} className="min-w-0 truncate font-medium text-brand-700 hover:underline">
                        {r.title}
                      </Link>
                      <span className="shrink-0 font-semibold tabular-nums">{n(r.shares)}</span>
                    </div>
                    <Meter value={(r.shares / resources[0].shares) * 100} />
                    <p className="mt-0.5 text-xs text-muted">
                      {n(r.shares)} share{r.shares === 1 ? "" : "s"} · {n(r.candidates)} candidate{r.candidates === 1 ? "" : "s"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Definitions range={range} canFinance={canFinance} tz={tz} />
    </>
  );
}

/** Thin horizontal bar; the number it shows is printed beside it. */
function Meter({ value }: { value: number }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ background: VIZ.track }} aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: VIZ.series[0] }} />
    </div>
  );
}

function Funnel({ stages }: { stages: FunnelStage[] }) {
  const total = stages[0]?.candidates ?? 0;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Lead funnel</CardTitle>
        <CardDescription>Leads added in the period, by the furthest stage each has reached so far.</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">No leads in this period.</p>
        ) : (
          <ol className="grid gap-3" aria-label="Lead funnel stages">
            {stages.map((s, i) => {
              const pct = total ? (s.candidates / total) * 100 : 0;
              const prev = i > 0 ? stages[i - 1].candidates : null;
              return (
                <li key={s.key}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-fg">{s.label}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className="font-semibold">{n(s.candidates)}</span>
                      <span className="text-muted"> · {Math.round(pct)}% of leads</span>
                    </span>
                  </div>
                  <div className="mt-1 h-3 overflow-hidden rounded-[4px]" style={{ background: VIZ.track }}>
                    <div className="h-full rounded-[4px]" style={{ width: `${pct}%`, background: VIZ.series[0] }} />
                  </div>
                  {prev ? <p className="mt-0.5 text-xs text-muted">{Math.round((s.candidates / prev) * 100)}% of the previous stage</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function Definitions({ range, canFinance, tz }: { range: DateRange; canFinance: boolean; tz: string }) {
  const items: [string, string][] = [
    ["Period", `${range.from} to ${range.to}, both days included, as calendar dates in ${tz}.`],
    ["New leads", "candidates created in the period, from any source (form, import or added by hand)."],
    ["Demo bookings", "people who sent a demo request or were invited to a demo session in the period, each counted once."],
    ["Demo → enrollment", "of those demo bookings, the share who have an enrollment (cancelled ones left out)."],
    ["Enrollments", "enrollments dated in the period, except cancelled ones."],
    ["Lead funnel", "contacted = a status such as Contacted, Interested or Qualified; demo booked = demo requested/shared, a demo request or a demo invitation; demo attended = marked present or late at a demo; enrolled = has an enrollment or a won status. A lead counts at every stage up to the furthest it reached."],
  ];
  if (canFinance)
    items.push(
      ["Net collections", "payments marked received in the period minus refunds paid out in the period. Pending, failed and voided payments never count. Same numbers as Payments & Expenses for the same dates."],
      ["Cash result", "net collections minus recorded expenses. It is not accounting profit or taxable income."],
      ["Outstanding dues", "final fee minus net paid on active, pending, on-hold and completed enrollments, as of today (not limited to the period)."],
    );
  items.push(["Visibility", "every number only counts records your role can see."]);
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>How these numbers work</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 text-xs text-muted sm:grid-cols-2">
          {items.map(([t, d]) => (
            <div key={t}>
              <dt className="inline font-semibold text-fg">{t}:</dt> <dd className="inline">{d}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
