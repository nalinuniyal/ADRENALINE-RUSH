import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download, ReceiptText, Search } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { requireAccess } from "@/lib/auth/session";
import { getBatchOptions } from "@/lib/data/batches";
import { getCourseOptions } from "@/lib/data/candidates";
import { paymentsQuery, toPaymentRow } from "@/lib/data/finance";
import { formatPaise, paymentDisplayStatus, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/finance/money";
import { formatDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { filterQuery, parseFinanceFilters } from "@/lib/validation/finance";
import { PaymentStatusBadge } from "../_components/badges";
import { FilterField, FinanceFilterBar } from "../_components/filters";
import { FinanceHeader, FinanceSkeleton } from "../_components/finance-header";

export const metadata: Metadata = { title: "Payments" };
const LIMIT = 500;

export default function PaymentsPage({ searchParams }: PageProps<"/admin/finance/payments">) {
  return (
    <Suspense fallback={<FinanceSkeleton label="Loading payments" />}>
      <PaymentsList searchParams={searchParams} />
    </Suspense>
  );
}

async function PaymentsList({ searchParams }: { searchParams: PageProps<"/admin/finance/payments">["searchParams"] }) {
  const { access, denied } = await requireAccess(["finance.view"]);
  if (denied) return <AccessDenied />;
  const orgId = access.organization.id;
  const canExport = access.permissions.includes("reports.export");
  const filters = parseFinanceFilters(await searchParams);
  const supabase = await createSupabaseServerClient();
  const [res, courses, batches] = await Promise.all([
    paymentsQuery(supabase, orgId, filters).limit(LIMIT),
    getCourseOptions(supabase, orgId),
    getBatchOptions(supabase, orgId, { includeClosed: true }),
  ]);
  if (res.error) {
    console.error(JSON.stringify({ level: "error", msg: "payments list failed", code: res.error.code }));
    throw new Error("Could not load payments.");
  }
  let rows = (res.data ?? []).map((r) => toPaymentRow(r as never));
  if (filters.status === "refunded") rows = rows.filter((r) => r.refunded > 0);
  const cur = access.organization.currency;
  const counted = rows.filter((r) => r.status === "completed" && r.currency === cur);
  const gross = counted.reduce((s, r) => s + r.amount, 0);
  const refunded = counted.reduce((s, r) => s + r.refunded, 0);
  const filtered = Boolean(filters.from || filters.to || filters.course || filters.batch || filters.method || filters.status || filters.q);

  return (
    <>
      <FinanceHeader
        active="payments"
        description="Every payment recorded, newest first. Pending, failed and voided payments are listed but never counted."
        actions={
          canExport ? (
            <a href={`/admin/finance/payments/export${filterQuery(filters)}`} className={buttonVariants({ variant: "secondary" })}>
              <Download className="size-4" aria-hidden /> Export CSV
            </a>
          ) : undefined
        }
      />
      <FinanceFilterBar
        action="/admin/finance/payments"
        filters={filters}
        courses={courses.map((c) => ({ id: c.id, label: c.title }))}
        batches={batches.map((b) => ({ id: b.id, label: `${b.name} — ${b.courseTitle}` }))}
        extra={
          <>
            <FilterField id="f-method" label="Method">
              <Select id="f-method" name="method" defaultValue={filters.method}>
                <option value="">All methods</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField id="f-status" label="Status">
              <Select id="f-status" name="status" defaultValue={filters.status}>
                <option value="">All</option>
                <option value="completed">Received</option>
                <option value="refunded">With refunds</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
                <option value="voided">Voided</option>
              </Select>
            </FilterField>
            <FilterField id="f-q" label="Name, receipt or reference">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input id="f-q" name="q" type="search" defaultValue={filters.q} className="pl-9" maxLength={80} />
              </div>
            </FilterField>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ReceiptText className="size-6" aria-hidden />}
          title={filtered ? "No payments match these filters" : "No payments yet"}
          description={filtered ? undefined : "Open Fees & dues, choose a student and record their first payment."}
          action={
            <Link href={filtered ? "/admin/finance/payments" : "/admin/finance/fees"} className={buttonVariants({ variant: filtered ? "secondary" : "primary" })}>
              {filtered ? "Clear filters" : "Go to Fees & dues"}
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <p className="border-b border-line px-4 py-2 text-xs text-muted">
            {rows.length}
            {rows.length >= LIMIT ? "+" : ""} payment{rows.length === 1 ? "" : "s"} · received {formatPaise(gross, cur)} · refunded {formatPaise(refunded, cur)} · net{" "}
            <span className="font-semibold text-fg">{formatPaise(gross - refunded, cur)}</span>
            {rows.length >= LIMIT ? " · showing the latest 500; narrow the filters or export for more" : ""}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">Payments</caption>
              <thead className="border-b border-line bg-canvas/60 text-xs text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Date</th>
                  <th scope="col" className="px-4 py-3 font-medium">Student</th>
                  <th scope="col" className="px-4 py-3 font-medium">Method</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-line transition last:border-0 hover:bg-brand-50/50">
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(p.paidOn)}</td>
                    <td className="max-w-xs px-4 py-3">
                      <Link href={`/admin/finance/fees/${p.enrollmentId}`} className="font-semibold text-brand-700 hover:underline">
                        {p.candidateName}
                      </Link>
                      <p className="truncate text-xs text-muted">
                        {p.courseTitle}
                        {p.batchName ? ` · ${p.batchName}` : ""}
                        {p.installment ? ` · ${p.installment}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                      {p.reference ? <p className="max-w-40 truncate text-xs text-muted">{p.reference}</p> : null}
                    </td>
                    <td className={cn("px-4 py-3 text-right whitespace-nowrap tabular-nums", p.status === "voided" && "line-through opacity-70")}>
                      {formatPaise(p.amount, p.currency)}
                      {p.refunded ? <p className="text-xs text-muted">−{formatPaise(p.refunded, p.currency)} refunded</p> : null}
                    </td>
                    <td className="px-4 py-3">
                      <PaymentStatusBadge status={paymentDisplayStatus(p.status, p.amount, p.refunded)} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {p.receiptNumber ? (
                        <Link href={`/admin/finance/receipts/${p.id}`} className="text-brand-700 hover:underline">
                          {p.receiptNumber}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
