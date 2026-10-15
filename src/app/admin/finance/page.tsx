import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlarmClock, ArrowDownLeft, BadgeCheck, ArrowUpRight, Banknote, BookOpenCheck, Download, Hourglass, type LucideIcon, Receipt, Scale, Wallet } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile, type IconTileColor } from "@/components/ui/icon-tile";
import { requireAccess } from "@/lib/auth/session";
import { getBatchOptions } from "@/lib/data/batches";
import { getCourseOptions } from "@/lib/data/candidates";
import { getFinanceSummary, getOverdueInstallments, PAYMENT_LIST_SELECT, toPaymentRow } from "@/lib/data/finance";
import { countPendingSubmissions, getActivePayLinks, getPaymentSettings } from "@/lib/data/pay-links";
import { formatPaise, paymentDisplayStatus, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/finance/money";
import { formatDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { filterQuery, parseFinanceFilters } from "@/lib/validation/finance";
import { PaymentStatusBadge } from "./_components/badges";
import { FinanceFilterBar } from "./_components/filters";
import { FinanceHeader, FinanceSkeleton } from "./_components/finance-header";
import { PayLinkQuick } from "./_components/pay-link-card";
import { ReminderButtons } from "./_components/reminder-buttons";

export const metadata: Metadata = { title: "Payments & Expenses" };

export default function FinancePage({ searchParams }: PageProps<"/admin/finance">) {
  return (
    <Suspense fallback={<FinanceSkeleton label="Loading finance overview" />}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

type Tile = { label: string; value: number; icon: LucideIcon; color: IconTileColor; hint: string; tone?: "danger" | "success"; href?: string };

async function Overview({ searchParams }: { searchParams: PageProps<"/admin/finance">["searchParams"] }) {
  const { access, denied } = await requireAccess(["finance.view"]);
  if (denied) return <AccessDenied />;
  const orgId = access.organization.id;
  const canManage = access.permissions.includes("finance.manage");
  const canExport = access.permissions.includes("reports.export");
  const filters = parseFinanceFilters(await searchParams);
  const supabase = await createSupabaseServerClient();

  const [summary, overdue, courses, batches, recentRes] = await Promise.all([
    getFinanceSummary(supabase, orgId, filters),
    getOverdueInstallments(supabase, orgId, filters),
    getCourseOptions(supabase, orgId),
    getBatchOptions(supabase, orgId, { includeClosed: true }),
    supabase.from("payments").select(PAYMENT_LIST_SELECT).eq("organization_id", orgId).order("created_at", { ascending: false }).limit(6),
  ]);
  const recent = (recentRes.data ?? []).map((r) => toPaymentRow(r as never));
  const shownOverdue = overdue.slice(0, 50);
  const [toVerify, paySettings, payLinks] = await Promise.all([
    countPendingSubmissions(supabase, orgId),
    canManage ? getPaymentSettings(supabase, orgId) : Promise.resolve(null),
    canManage ? getActivePayLinks(supabase, orgId, [...new Set(shownOverdue.map((o) => o.feePlanId))]) : Promise.resolve(new Map<string, { url: string }>()),
  ]);
  const payConfigured = Boolean(paySettings?.upiVpa || paySettings?.bankAccountLast4);
  const cur = summary.currency;
  const q = filterQuery({ from: filters.from, to: filters.to, course: filters.course, batch: filters.batch });
  const period = filters.from || filters.to ? `${filters.from ? formatDate(filters.from) : "the start"} – ${filters.to ? formatDate(filters.to) : "today"}` : "all time";

  const tiles: Tile[] = [
    { label: "Gross collections", value: summary.gross, icon: ArrowDownLeft, color: "green", hint: `${summary.paymentCount} received payment${summary.paymentCount === 1 ? "" : "s"}`, href: `/admin/finance/payments${q}` },
    { label: "Refunds", value: summary.refunds, icon: ArrowUpRight, color: "orange", hint: "Refunds paid out" },
    { label: "Net collections", value: summary.net, icon: Banknote, color: "teal", hint: "Gross − refunds" },
    { label: "Expenses", value: summary.expenses, icon: Receipt, color: "pink", hint: `${summary.expenseCount} expense${summary.expenseCount === 1 ? "" : "s"}`, href: `/admin/finance/expenses${q}` },
    { label: "Cash result", value: summary.cashResult, icon: Scale, color: "indigo", hint: "Net collections − expenses", tone: summary.cashResult < 0 ? "danger" : "success" },
    { label: "Outstanding fees", value: summary.outstanding, icon: Hourglass, color: "violet", hint: "Still payable today", href: `/admin/finance/fees${filterQuery({ course: filters.course, batch: filters.batch, status: "" })}` },
    { label: "Overdue", value: summary.overdue, icon: AlarmClock, color: "orange", hint: `${summary.overdueCount} installment${summary.overdueCount === 1 ? "" : "s"} past due`, tone: summary.overdue > 0 ? "danger" : undefined },
    { label: "Booked fees", value: summary.booked, icon: BookOpenCheck, color: "blue", hint: "Agreed fees of enrollments" },
  ];

  return (
    <>
      <FinanceHeader
        active="overview"
        description={`Fees, payments, refunds and expenses · ${period} · ${cur}`}
        actions={
          canExport ? (
            <>
              <a href={`/admin/finance/payments/export${q}`} className={buttonVariants({ variant: "secondary" })}>
                <Download className="size-4" aria-hidden /> Payments CSV
              </a>
              <a href={`/admin/finance/expenses/export${q}`} className={buttonVariants({ variant: "secondary" })}>
                <Download className="size-4" aria-hidden /> Expenses CSV
              </a>
            </>
          ) : undefined
        }
      />
      <FinanceFilterBar
        action="/admin/finance"
        filters={filters}
        courses={courses.map((c) => ({ id: c.id, label: c.title }))}
        batches={batches.map((b) => ({ id: b.id, label: `${b.name} — ${b.courseTitle}` }))}
        periodHint="The period filters payments, refunds and expenses by their own dates (and booked fees by enrollment date). Outstanding and overdue are always as of today."
      />

      {toVerify ? (
        <Link
          href="/admin/finance/verify"
          className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-warning-700/25 bg-warning-50 px-4 py-3 text-sm text-warning-700 transition hover:border-warning-700/50"
          data-testid="to-verify-banner"
        >
          <span className="flex items-center gap-2 font-semibold">
            <BadgeCheck className="size-4" aria-hidden /> {toVerify} payment{toVerify === 1 ? "" : "s"} to verify
          </span>
          <span className="text-xs">Students reported UPI / bank transfers. Check and approve →</span>
        </Link>
      ) : null}

      <section aria-label="Totals" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted">{t.label}</p>
                <IconTile icon={t.icon} color={t.color} size="sm" />
              </div>
              <p className={cn("mt-1 text-xl font-bold tabular-nums sm:text-2xl", t.tone === "danger" && "text-danger-700", t.tone === "success" && "text-success-700")} data-testid={`kpi-${t.label.toLowerCase().replace(/\s+/g, "-")}`}>
                {formatPaise(t.value, cur)}
              </p>
              <p className="mt-0.5 text-xs text-muted">{t.hint}</p>
            </>
          );
          return t.href ? (
            <Link key={t.label} href={t.href} className="ar-lift rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card transition hover:border-brand-300">
              {body}
            </Link>
          ) : (
            <div key={t.label} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card">
              {body}
            </div>
          );
        })}
      </section>
      <p className="mb-4 text-xs text-muted">
        Cash result is money in minus money out for the period. It is not accounting profit or taxable income.
        {summary.otherCurrencyRows ? ` ${summary.otherCurrencyRows} record(s) in other currencies are not included in these ${cur} totals.` : ""}
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader icon={<IconTile icon={AlarmClock} color="orange" size="sm" />}>
            <CardTitle>Overdue installments ({overdue.length})</CardTitle>
            <CardDescription>Unpaid installments past their due date, oldest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {overdue.length === 0 ? (
              <p className="text-sm text-muted">Nothing is overdue.</p>
            ) : (
              <ul className="divide-y divide-line">
                {shownOverdue.map((o) => (
                  <li key={o.installmentId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/admin/finance/fees/${o.enrollmentId}`} className="font-semibold text-brand-700 hover:underline">
                        {o.candidateName}
                      </Link>
                      <p className="text-xs text-muted">
                        {o.courseTitle}
                        {o.batchName ? ` · ${o.batchName}` : ""}
                      </p>
                      <p className="mt-1 text-sm">
                        <span className="font-semibold text-danger-700 tabular-nums">{formatPaise(o.remaining, o.currency)}</span> · {o.label || `Installment ${o.seq}`} · due{" "}
                        {formatDate(o.dueDate)} ({o.daysOverdue} day{o.daysOverdue === 1 ? "" : "s"} ago)
                      </p>
                    </div>
                    {canManage ? (
                      <div className="flex flex-col items-start gap-1.5 sm:items-end">
                        <ReminderButtons feePlanId={o.feePlanId} installmentId={o.installmentId} hasPhone={Boolean(o.phone)} hasEmail={Boolean(o.email)} compact />
                        {payConfigured ? <PayLinkQuick feePlanId={o.feePlanId} url={payLinks.get(o.feePlanId)?.url ?? null} hasPhone={Boolean(o.phone)} /> : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<IconTile icon={Wallet} color="green" size="sm" />} actions={<Link href="/admin/finance/payments" className={buttonVariants({ variant: "ghost", size: "sm" })}>All</Link>}>
              <CardTitle>Latest payments</CardTitle>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <p className="text-sm text-muted">
                  No payments yet. Open <Link href="/admin/finance/fees" className="text-brand-700 hover:underline">Fees &amp; dues</Link>, choose a student and record a payment.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {recent.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <Link href={`/admin/finance/fees/${p.enrollmentId}`} className="block truncate text-sm font-medium text-brand-700 hover:underline">
                          {p.candidateName}
                        </Link>
                        <p className="text-xs text-muted">
                          {formatDate(p.paidOn)} · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold tabular-nums">{formatPaise(p.amount, p.currency)}</span>
                        <PaymentStatusBadge status={paymentDisplayStatus(p.status, p.amount, p.refunded)} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How these numbers work</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-xs text-muted">
                <div><dt className="inline font-semibold text-fg">Booked fees:</dt> <dd className="inline">final fee (after discount) of enrollments that are pending, active, on hold or completed.</dd></div>
                <div><dt className="inline font-semibold text-fg">Gross collections:</dt> <dd className="inline">payments marked received. Pending, failed and voided payments never count.</dd></div>
                <div><dt className="inline font-semibold text-fg">Net collections:</dt> <dd className="inline">gross collections minus refunds paid out in the period.</dd></div>
                <div><dt className="inline font-semibold text-fg">Outstanding:</dt> <dd className="inline">final fee minus net paid, never below zero. Cancelled and dropped enrollments are left out (their payments and refunds still count, because the money really moved).</dd></div>
                <div><dt className="inline font-semibold text-fg">Cash result:</dt> <dd className="inline">net collections minus expenses. With a course or batch filter, only expenses linked to it count.</dd></div>
                <div><dt className="inline font-semibold text-fg">Dates:</dt> <dd className="inline">calendar dates in {access.organization.timezone}.</dd></div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
