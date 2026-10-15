import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BadgeCheck, CalendarClock, CreditCard, FileText, IndianRupee, Link2, ReceiptText, Wallet } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { requireAccess } from "@/lib/auth/session";
import { todayIn } from "@/lib/calendar";
import { getBalances, getSchedule, installmentName, nextUnpaid } from "@/lib/data/finance";
import { getActivePayLinks, getPaymentSettings, loadSubmissionViews } from "@/lib/data/pay-links";
import { Badge } from "@/components/ui/badge";
import { formatPaise, paiseToInput, paymentDisplayStatus, PAYMENT_METHOD_LABELS, toPaise, type DiscountType, type PaymentMethod, type PaymentStatus } from "@/lib/finance/money";
import { razorpayStatus } from "@/lib/finance/razorpay";
import { formatDate, formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { EnrollmentStatus } from "@/lib/validation/batches";
import { EnrollmentStatusBadge } from "../../../batches/_components/badges";
import { FeeStateBadge, InstallmentStatusBadge, PaymentStatusBadge } from "../../_components/badges";
import { FeePlanForm, type FeePlanFormValues } from "../../_components/fee-plan-form";
import { DeleteFeePlanButton, PaymentActions, RecordPaymentForm, VoidRefundButton } from "../../_components/payment-forms";
import { PayLinkCard } from "../../_components/pay-link-card";
import { PaymentLinks, type LinkRow } from "../../_components/payment-links";
import { SubmissionList } from "../../_components/submission-list";
import { ReminderButtons } from "../../_components/reminder-buttons";

export const metadata: Metadata = { title: "Fees" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EnrollmentFeesPage({ params }: PageProps<"/admin/finance/fees/[enrollmentId]">) {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[70vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading fees" />}>
      <EnrollmentFees params={params} />
    </Suspense>
  );
}

async function EnrollmentFees({ params }: { params: PageProps<"/admin/finance/fees/[enrollmentId]">["params"] }) {
  const { access, denied } = await requireAccess(["finance.view"]);
  if (denied) return <AccessDenied />;
  const { enrollmentId } = await params;
  if (!UUID_RE.test(enrollmentId)) notFound();
  const orgId = access.organization.id;
  const tz = access.organization.timezone;
  const canManage = access.permissions.includes("finance.manage");
  const today = todayIn(tz);
  const supabase = await createSupabaseServerClient();

  const { data: e, error } = await supabase
    .from("enrollments")
    .select("id, status, enrolled_at, batch_id, course_id, candidate_id, candidates(full_name, email, phone), courses(title, list_price, discounted_price, currency), batches(name)")
    .eq("id", enrollmentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error("Could not load this enrollment.");
  if (!e) notFound();
  const cand = Array.isArray(e.candidates) ? e.candidates[0] : e.candidates;
  const course = Array.isArray(e.courses) ? e.courses[0] : e.courses;
  const batch = Array.isArray(e.batches) ? e.batches[0] : e.batches;

  const { data: plan } = await supabase.from("fee_plans").select("*").eq("enrollment_id", enrollmentId).eq("organization_id", orgId).maybeSingle();
  const [schedule, balances, paymentsRes, linksRes, settingsRes] = await Promise.all([
    plan ? getSchedule(supabase, plan.id) : Promise.resolve([]),
    plan ? getBalances(supabase, orgId, [plan.id]) : Promise.resolve(new Map()),
    plan
      ? supabase
          .from("payments")
          .select("id, receipt_number, paid_on, amount, currency, method, status, reference, notes, void_reason, voided_at, gateway, created_at, installment_id, payment_refunds(id, amount, refunded_on, method, reference, reason, status, void_reason, created_at)")
          .eq("fee_plan_id", plan.id)
          .order("paid_on", { ascending: false })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    plan ? supabase.from("payment_links").select("id, amount, currency, status, short_url, error, created_at, installment_id").eq("fee_plan_id", plan.id).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    supabase.from("sharing_settings").select("whatsapp_country_code").eq("organization_id", orgId).maybeSingle(),
  ]);
  const [payLinks, paySettings, submissions] = plan
    ? await Promise.all([getActivePayLinks(supabase, orgId, [plan.id]), getPaymentSettings(supabase, orgId), loadSubmissionViews(supabase, orgId, tz, { planId: plan.id, limit: 20 })])
    : [new Map(), null, []];
  const payLink = plan ? payLinks.get(plan.id) : undefined;
  const pendingReports = submissions.filter((x) => x.status === "pending").length;
  const payConfigured = Boolean(paySettings?.upiVpa || paySettings?.bankAccountLast4);
  const bal = plan ? balances.get(plan.id) : undefined;
  const payments = paymentsRes.data ?? [];
  const cur = plan?.currency ?? course?.currency ?? access.organization.currency;
  const next = nextUnpaid(schedule);
  const instName = new Map(schedule.map((s) => [s.id, installmentName(s)]));
  const overdue = schedule.some((s) => s.status === "overdue");
  const rzp = razorpayStatus();

  const coursePrice = course?.discounted_price ?? course?.list_price ?? null;
  const initial: FeePlanFormValues = plan
    ? {
        baseFee: paiseToInput(toPaise(plan.base_fee)),
        currency: plan.currency,
        discountType: plan.discount_type as DiscountType,
        discountValue: plan.discount_type === "none" ? "" : paiseToInput(toPaise(plan.discount_value)),
        discountReason: plan.discount_reason ?? "",
        notes: plan.notes ?? "",
        installments: schedule.map((s) => ({ dueDate: s.dueDate, amount: paiseToInput(s.amount), label: s.label ?? "" })),
      }
    : { baseFee: coursePrice !== null ? paiseToInput(toPaise(coursePrice)) : "", currency: cur, discountType: "none", discountValue: "", discountReason: "", notes: "", installments: [] };
  const priceHint =
    course?.list_price != null
      ? `Course price: ${formatPaise(toPaise(course.list_price), course.currency)}${course.discounted_price != null ? `, offer ${formatPaise(toPaise(course.discounted_price), course.currency)}` : ""}`
      : null;

  const links: LinkRow[] = (linksRes.data ?? []).map((l) => ({
    id: l.id,
    amountText: formatPaise(toPaise(l.amount), l.currency),
    target: l.installment_id ? (instName.get(l.installment_id) ?? "installment") : "full balance",
    status: l.status,
    shortUrl: l.short_url,
    error: l.error,
    createdText: `Created ${formatDateTime(l.created_at, tz)}`,
  }));

  return (
    <>
      <PageHeader
        icon={Wallet}
        color="green"
        crumbs={[{ label: "Payments & Expenses", href: "/admin/finance" }, { label: "Fees & dues", href: "/admin/finance/fees" }, { label: cand?.full_name ?? "Student" }]}
        title={cand?.full_name ?? "Student"}
        description={
          <>
            {course?.title ?? "Course"}
            {batch ? (
              <>
                {" · "}
                <Link href={`/admin/batches/${e.batch_id}`} className="text-brand-700 hover:underline">
                  {batch.name}
                </Link>
              </>
            ) : null}
            {" · "}
            <Link href={`/admin/candidates/${e.candidate_id}`} className="text-brand-700 hover:underline">
              Candidate profile
            </Link>
          </>
        }
        actions={
          <>
            <EnrollmentStatusBadge status={e.status as EnrollmentStatus} />
            {pendingReports ? (
              <a href="#reported-payments">
                <Badge tone="warning" data-testid="pending-reports-badge">
                  {pendingReports} to verify
                </Badge>
              </a>
            ) : null}
            <FeeStateBadge hasPlan={Boolean(plan)} outstanding={bal?.outstanding ?? 0} overdue={overdue} />
          </>
        }
        details={
          plan && bal
            ? [
                { label: "Final fee", value: formatPaise(bal.finalFee, cur) },
                { label: "Received", value: formatPaise(bal.gross, cur) },
                { label: "Refunded", value: formatPaise(bal.refunded, cur) },
                { label: "Paid (net)", value: <span data-testid="net-paid">{formatPaise(bal.net, cur)}</span> },
                { label: "Outstanding", value: <span data-testid="outstanding" className={bal.outstanding ? "text-danger-700" : "text-success-700"}>{formatPaise(bal.outstanding, cur)}</span> },
                ...(bal.credit ? [{ label: "Credit (overpaid)", value: formatPaise(bal.credit, cur) }] : []),
              ]
            : [{ label: "Fee", value: "Not set yet" }]
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 content-start gap-4 lg:col-span-2">
          {plan && schedule.length ? (
            <Card>
              <CardHeader icon={<IconTile icon={CalendarClock} color="orange" size="sm" />}>
                <CardTitle>Installments</CardTitle>
                <CardDescription>Received payments (net of refunds) fill the earliest installment first, unless recorded against a specific one.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="divide-y divide-line">
                  {schedule.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid={`installment-${s.seq}`}>
                      <div>
                        <p className="font-medium">{installmentName(s)}</p>
                        <p className="text-xs text-muted">Due {formatDate(s.dueDate)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm tabular-nums">
                        <span>{formatPaise(s.amount, cur)}</span>
                        <span className="text-muted">paid {formatPaise(s.paid, cur)}</span>
                        <InstallmentStatusBadge status={s.status} />
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          {submissions.length ? (
            <Card id="reported-payments">
              <CardHeader icon={<IconTile icon={BadgeCheck} color="orange" size="sm" />}>
                <CardTitle>Reported by the student ({pendingReports} to verify)</CardTitle>
                <CardDescription>UPI and bank transfers the student reported on their pay page. Approving records the payment and issues a receipt.</CardDescription>
              </CardHeader>
              <CardContent>
                <SubmissionList items={submissions} canManage={canManage} compact />
              </CardContent>
            </Card>
          ) : null}

          {plan ? (
            <Card>
              <CardHeader icon={<IconTile icon={ReceiptText} color="green" size="sm" />}>
                <CardTitle>Payments ({payments.length})</CardTitle>
                <CardDescription>Payments are never deleted. Void a mistake with a reason and record it again.</CardDescription>
              </CardHeader>
              <CardContent>
                {payments.length === 0 ? (
                  <p className="text-sm text-muted">No payments recorded yet.</p>
                ) : (
                  <ul className="grid gap-3">
                    {payments.map((p) => {
                      const amount = toPaise(p.amount);
                      const refunds = p.payment_refunds ?? [];
                      const refunded = refunds.filter((r) => r.status === "completed").reduce((s, r) => s + toPaise(r.amount), 0);
                      const shown = paymentDisplayStatus(p.status as PaymentStatus, amount, refunded);
                      return (
                        <li key={p.id} className={cn("rounded-lg border border-line p-3", p.status === "voided" && "opacity-70")} data-testid="payment-row">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className={cn("text-base font-semibold tabular-nums", p.status === "voided" && "line-through")}>{formatPaise(amount, p.currency)}</p>
                              <p className="text-xs text-muted">
                                {formatDate(p.paid_on)} · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                                {p.reference ? ` · Ref ${p.reference}` : ""}
                                {p.installment_id && instName.get(p.installment_id) ? ` · for ${instName.get(p.installment_id)}` : ""}
                              </p>
                              {p.notes ? <p className="mt-1 text-xs whitespace-pre-line">{p.notes}</p> : null}
                              {p.void_reason ? <p className="mt-1 text-xs text-danger-700">Voided: {p.void_reason}</p> : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <PaymentStatusBadge status={shown} />
                              {p.receipt_number ? (
                                <Link href={`/admin/finance/receipts/${p.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                                  <FileText className="size-3.5" aria-hidden /> {p.receipt_number}
                                </Link>
                              ) : null}
                            </div>
                          </div>
                          {refunds.length ? (
                            <ul className="mt-2 grid gap-1.5 border-t border-line pt-2">
                              {refunds.map((r) => (
                                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 text-xs">
                                  <span className={cn(r.status === "voided" && "line-through opacity-70")}>
                                    Refund <strong className="tabular-nums">{formatPaise(toPaise(r.amount), p.currency)}</strong> on {formatDate(r.refunded_on)} ·{" "}
                                    {PAYMENT_METHOD_LABELS[r.method as PaymentMethod] ?? r.method} · {r.reason}
                                    {r.void_reason ? ` · voided: ${r.void_reason}` : ""}
                                  </span>
                                  {canManage && r.status === "completed" ? <VoidRefundButton refundId={r.id} /> : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {canManage && p.status !== "voided" ? (
                            <div className="mt-2 border-t border-line pt-2">
                              <PaymentActions paymentId={p.id} status={p.status} refundable={p.status === "completed" ? amount - refunded : 0} today={today} paidOn={p.paid_on} currency={p.currency} />
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          {canManage ? (
            <Card>
              <CardHeader icon={<IconTile icon={Wallet} color="teal" size="sm" />}>
                <CardTitle>{plan ? "Fee plan" : "Set up the fee"}</CardTitle>
                <CardDescription>The agreed fee for this enrollment, any discount and an optional installment schedule. One fee plan per enrollment.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <FeePlanForm enrollmentId={e.id} initial={initial} today={today} priceHint={priceHint} hasPayments={payments.length > 0} />
                {plan && payments.length === 0 && links.length === 0 ? <DeleteFeePlanButton planId={plan.id} /> : null}
              </CardContent>
            </Card>
          ) : !plan ? (
            <Card>
              <CardContent>
                <p className="text-sm text-muted">No fee has been set for this enrollment yet.</p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="grid min-w-0 content-start gap-4">
          {plan && canManage ? (
            <Card>
              <CardHeader icon={<IconTile icon={CreditCard} color="green" size="sm" />}>
                <CardTitle>Record a payment</CardTitle>
                <CardDescription>Cash, UPI, bank transfer, card or cheque. A receipt number is issued when it is received.</CardDescription>
              </CardHeader>
              <CardContent>
                <RecordPaymentForm
                  feePlanId={plan.id}
                  installments={schedule.filter((s) => s.remaining > 0).map((s) => ({ id: s.id, label: `${installmentName(s)} · ${formatPaise(s.remaining, cur)} left`, remaining: s.remaining }))}
                  defaultAmount={next ? next.remaining : (bal?.outstanding ?? 0)}
                  today={today}
                  currency={cur}
                />
              </CardContent>
            </Card>
          ) : null}

          {plan && canManage && (bal?.outstanding ?? 0) > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Send a reminder</CardTitle>
                <CardDescription>
                  {next ? `${installmentName(next)}: ${formatPaise(next.remaining, cur)} ${next.status === "overdue" ? "overdue since" : "due"} ${formatDate(next.dueDate)}.` : `${formatPaise(bal?.outstanding ?? 0, cur)} outstanding.`}{" "}
                  Recorded on the candidate’s timeline.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ReminderButtons feePlanId={plan.id} installmentId={next?.id ?? null} hasPhone={Boolean(cand?.phone)} hasEmail={Boolean(cand?.email)} />
              </CardContent>
            </Card>
          ) : null}

          {plan && canManage ? (
            <Card>
              <CardHeader icon={<IconTile icon={IndianRupee} color="teal" size="sm" />}>
                <CardTitle>UPI / bank transfer pay link</CardTitle>
                <CardDescription>
                  Free. A private page with a UPI QR code for the amount, your UPI ID and bank details. The student pays you directly and enters the UTR there; you
                  confirm it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!payConfigured ? (
                  <p className="text-sm text-muted">
                    Add your UPI ID or bank details first in{" "}
                    <Link href="/admin/settings/payments" className="text-brand-700 hover:underline">
                      Settings › Payment details
                    </Link>
                    .
                  </p>
                ) : (bal?.outstanding ?? 0) <= 0 && !payLink ? (
                  <p className="text-sm text-muted">Nothing is outstanding, so no pay link is needed.</p>
                ) : (
                  <PayLinkCard
                    feePlanId={plan.id}
                    link={payLink ? { id: payLink.id, url: payLink.url, amountMode: payLink.amountMode, openText: payLink.openCount ? `opened ${payLink.openCount}× · last ${formatDateTime(payLink.lastOpenedAt ?? payLink.createdAt, tz)}` : "not opened yet" } : null}
                    hasPhone={Boolean(cand?.phone)}
                    hasEmail={Boolean(cand?.email)}
                    nextText={next && schedule.length ? `${installmentName(next)} (${formatPaise(Math.min(next.remaining, bal?.outstanding ?? 0), cur)})` : null}
                    balanceText={formatPaise(bal?.outstanding ?? 0, cur)}
                  />
                )}
              </CardContent>
            </Card>
          ) : null}

          {plan && canManage ? (
            <Card>
              <CardHeader icon={<IconTile icon={Link2} color="indigo" size="sm" />}>
                <CardTitle>Online payment link</CardTitle>
                <CardDescription>
                  {rzp.configured
                    ? `Razorpay ${rzp.mode === "test" ? "test mode: no real money moves" : "live mode"}. The payment is recorded automatically when Razorpay confirms it.`
                    : "Optional. Set up Razorpay (Settings › Integrations) to send pay-online links. Manual payments always work."}
                </CardDescription>
              </CardHeader>
              {rzp.configured ? (
                <CardContent>
                  <PaymentLinks
                    feePlanId={plan.id}
                    nextInstallment={next && schedule.length ? { id: next.id, text: `${installmentName(next)} (${formatPaise(next.remaining, cur)})` } : null}
                    outstandingText={(bal?.outstanding ?? 0) >= 100 ? formatPaise(bal?.outstanding ?? 0, cur) : null}
                    links={links}
                    phone={cand?.phone ?? null}
                    countryCode={settingsRes.data?.whatsapp_country_code ?? "91"}
                    candidateName={cand?.full_name ?? ""}
                  />
                </CardContent>
              ) : null}
            </Card>
          ) : null}

          {plan?.discount_reason || plan?.notes ? (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {plan.discount_reason ? (
                  <p>
                    <span className="text-muted">Discount: </span>
                    {formatPaise(toPaise(plan.discount_amount), cur)} · {plan.discount_reason}
                  </p>
                ) : null}
                {plan.notes ? <p className="whitespace-pre-line">{plan.notes}</p> : null}
              </CardContent>
            </Card>
          ) : null}

          <p className="text-xs text-muted">
            Enrolled {formatDate(e.enrolled_at, tz)}. Fees belong to an enrollment; to charge for another course or batch, enroll the candidate there first.
          </p>
        </div>
      </div>
    </>
  );
}
