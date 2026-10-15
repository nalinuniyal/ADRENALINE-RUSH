import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AccessDenied } from "@/components/admin/access-denied";
import { buttonVariants } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/session";
import { formatPaise, PAYMENT_METHOD_LABELS, toPaise, type PaymentMethod } from "@/lib/finance/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PrintButton } from "../../_components/print-button";

export const metadata: Metadata = { title: "Receipt" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

// Printing hides the admin header and page chrome so only the receipt remains.
const PRINT_CSS = `@media print {
  header, nav, .ar-no-print { display: none !important; }
  body, .ar-backdrop { background: #fff !important; }
  main { padding: 0 !important; max-width: none !important; }
  .ar-receipt { box-shadow: none !important; border: none !important; }
}`;

export default function ReceiptPage({ params }: PageProps<"/admin/finance/receipts/[paymentId]">) {
  return (
    <Suspense fallback={<div className="ar-skeleton mx-auto h-[60vh] max-w-2xl rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading receipt" />}>
      <Receipt params={params} />
    </Suspense>
  );
}

async function Receipt({ params }: { params: PageProps<"/admin/finance/receipts/[paymentId]">["params"] }) {
  const { access, denied } = await requireAccess(["finance.view"]);
  if (denied) return <AccessDenied />;
  const { paymentId } = await params;
  if (!UUID_RE.test(paymentId)) notFound();
  const supabase = await createSupabaseServerClient();
  const orgId = access.organization.id;
  const [{ data: p }, { data: org }] = await Promise.all([
    supabase
      .from("payments")
      .select(
        "id, receipt_number, paid_on, amount, currency, method, reference, status, void_reason, created_at, enrollment_id, installment_id, candidates(full_name, email, phone), fee_plans(final_fee, courses(title)), enrollments(batches(name)), fee_installments(seq, label), payment_refunds(amount, refunded_on, status)",
      )
      .eq("id", paymentId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase.from("organizations").select("name, contact_email, contact_phone, website_url").eq("id", orgId).single(),
  ]);
  if (!p || !p.receipt_number) notFound();
  const cand = one(p.candidates);
  const plan = one(p.fee_plans);
  const course = one(plan?.courses);
  const batch = one(one(p.enrollments)?.batches);
  const inst = one(p.fee_installments);
  const refunds = (p.payment_refunds ?? []).filter((r) => r.status === "completed");
  const refunded = refunds.reduce((s, r) => s + toPaise(r.amount), 0);
  const amount = toPaise(p.amount);

  return (
    <div className="mx-auto max-w-2xl">
      <style href="ar-receipt-print" precedence="default">
        {PRINT_CSS}
      </style>
      <div className="ar-no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href={`/admin/finance/fees/${p.enrollment_id}`} className={buttonVariants({ variant: "ghost" })}>
          ← Back to fees
        </Link>
        <PrintButton />
      </div>
      <article className="ar-receipt relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-white p-6 text-[#181818] shadow-card sm:p-10" aria-label={`Receipt ${p.receipt_number}`}>
        {p.status === "voided" ? (
          <p className="absolute top-8 right-[-3rem] rotate-45 bg-danger-700 px-16 py-1 text-sm font-bold tracking-widest text-white uppercase">Void</p>
        ) : null}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#ddd] pb-4">
          <div>
            <p className="text-xl font-bold">{org?.name ?? access.organization.name}</p>
            <p className="text-xs text-[#555]">{[org?.contact_email, org?.contact_phone, org?.website_url].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right">
            <p className="text-xs tracking-wider text-[#555] uppercase">Payment receipt</p>
            <p className="text-lg font-bold" data-testid="receipt-number">
              {p.receipt_number}
            </p>
            <p className="text-sm">{formatDate(p.paid_on)}</p>
          </div>
        </header>
        <dl className="grid gap-x-6 gap-y-3 py-6 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[#555]">Received from</dt>
            <dd className="font-semibold">{cand?.full_name ?? "—"}</dd>
            {cand?.email || cand?.phone ? <dd className="text-xs text-[#555]">{[cand?.email, cand?.phone].filter(Boolean).join(" · ")}</dd> : null}
          </div>
          <div>
            <dt className="text-xs text-[#555]">For</dt>
            <dd className="font-semibold">{course?.title ?? "Course fee"}</dd>
            <dd className="text-xs text-[#555]">{[batch?.name, inst ? inst.label || `Installment ${inst.seq}` : null].filter(Boolean).join(" · ")}</dd>
          </div>
          <div>
            <dt className="text-xs text-[#555]">Payment method</dt>
            <dd>{PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}</dd>
          </div>
          {p.reference ? (
            <div>
              <dt className="text-xs text-[#555]">Reference</dt>
              <dd className="break-all">{p.reference}</dd>
            </div>
          ) : null}
        </dl>
        <div className="flex items-center justify-between rounded-lg bg-[#f3f3f3] px-4 py-3">
          <span className="text-sm font-medium">Amount received</span>
          <span className="text-2xl font-bold tabular-nums">{formatPaise(amount, p.currency)}</span>
        </div>
        {refunded ? (
          <p className="mt-3 text-sm">
            Refunded since: {formatPaise(refunded, p.currency)} ({refunds.map((r) => formatDate(r.refunded_on)).join(", ")}). Net received {formatPaise(amount - refunded, p.currency)}.
          </p>
        ) : null}
        {p.status === "voided" ? <p className="mt-3 text-sm font-semibold text-danger-700">This payment was voided{p.void_reason ? `: ${p.void_reason}` : ""}. This receipt is not valid.</p> : null}
        <footer className="mt-8 border-t border-[#ddd] pt-4 text-xs text-[#555]">
          <p>Thank you for your payment. This is a computer-generated receipt and does not need a signature.</p>
          <p className="mt-1">Recorded {formatDateTime(p.created_at, access.organization.timezone)}.</p>
        </footer>
      </article>
    </div>
  );
}
