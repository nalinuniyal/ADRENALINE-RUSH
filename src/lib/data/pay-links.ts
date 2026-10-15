import "server-only";
import { serverEnv } from "@/lib/env.server";
import { siteUrl } from "@/lib/email/automations";
import { payLinkToken, payLinkUrl } from "@/lib/finance/pay-link-token";
import { formatPaise, paiseToInput, toPaise } from "@/lib/finance/money";
import type { SubmissionView } from "@/lib/finance/pay-page";
import { formatDate, formatDateTime } from "@/lib/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** PAY_LINK_SECRET when set (recommended), otherwise the Supabase secret key. */
export function payLinkSecret(): string {
  const own = process.env.PAY_LINK_SECRET;
  if (own && own.length >= 32) return own;
  return serverEnv().SUPABASE_SECRET_KEY;
}

export const payUrl = (id: string, nonce: string) => payLinkUrl(siteUrl(), payLinkToken(payLinkSecret(), id, nonce));

export type PaymentSettings = {
  upiVpa: string | null;
  upiPayeeName: string | null;
  upiQrMediaId: string | null;
  bankAccountHolder: string | null;
  bankAccountLast4: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountType: string | null;
  instructions: string | null;
  showOnPayPage: boolean;
  showInReminders: boolean;
  showOnCoursePages: boolean;
  confirmEmailEnabled: boolean;
  confirmEmailSubject: string;
  confirmEmailBody: string;
};

/** Settings as the signed-in user may see them (null when not readable or not set up). */
export async function getPaymentSettings(supabase: Supabase, orgId: string): Promise<PaymentSettings | null> {
  const { data, error } = await supabase
    .from("payment_settings")
    .select(
      "upi_vpa, upi_payee_name, upi_qr_media_id, bank_account_holder, bank_account_last4, bank_ifsc, bank_name, bank_branch, bank_account_type, instructions, show_on_pay_page, show_in_reminders, show_on_course_pages, confirm_email_enabled, confirm_email_subject, confirm_email_body",
    )
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) console.error(JSON.stringify({ level: "error", msg: "payment settings read failed", code: error.code }));
  if (!data) return null;
  return {
    upiVpa: data.upi_vpa,
    upiPayeeName: data.upi_payee_name,
    upiQrMediaId: data.upi_qr_media_id,
    bankAccountHolder: data.bank_account_holder,
    bankAccountLast4: data.bank_account_last4,
    bankIfsc: data.bank_ifsc,
    bankName: data.bank_name,
    bankBranch: data.bank_branch,
    bankAccountType: data.bank_account_type,
    instructions: data.instructions,
    showOnPayPage: data.show_on_pay_page,
    showInReminders: data.show_in_reminders,
    showOnCoursePages: data.show_on_course_pages,
    confirmEmailEnabled: data.confirm_email_enabled,
    confirmEmailSubject: data.confirm_email_subject,
    confirmEmailBody: data.confirm_email_body,
  };
}

export type ActivePayLink = { id: string; amountMode: "next_installment" | "balance"; url: string; openCount: number; lastOpenedAt: string | null; createdAt: string };

/**
 * Live pay links of the given plans, with their URLs. The plan rows are read
 * with the caller's client (RLS: finance.view); only then is the nonce read
 * with the privileged client to rebuild each URL.
 */
export async function getActivePayLinks(supabase: Supabase, orgId: string, planIds: string[]): Promise<Map<string, ActivePayLink>> {
  const out = new Map<string, ActivePayLink>();
  if (!planIds.length) return out;
  const { data } = await supabase
    .from("fee_pay_links")
    .select("id, fee_plan_id, amount_mode, open_count, last_opened_at, created_at")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .in("fee_plan_id", planIds);
  if (!data?.length) return out;
  const { data: nonces } = await createSupabaseAdminClient()
    .from("fee_pay_links")
    .select("id, token_nonce")
    .in(
      "id",
      data.map((l) => l.id),
    );
  const nonceOf = new Map((nonces ?? []).map((n) => [n.id, n.token_nonce]));
  for (const l of data) {
    const nonce = nonceOf.get(l.id);
    if (!nonce) continue;
    out.set(l.fee_plan_id, {
      id: l.id,
      amountMode: l.amount_mode as ActivePayLink["amountMode"],
      url: payUrl(l.id, nonce),
      openCount: l.open_count,
      lastOpenedAt: l.last_opened_at,
      createdAt: l.created_at,
    });
  }
  return out;
}

export type SubmissionRow = {
  id: string;
  feePlanId: string;
  candidateId: string;
  amount: number;
  currency: string;
  paidOn: string;
  method: "upi" | "bank_transfer";
  utr: string;
  note: string | null;
  hasScreenshot: boolean;
  status: "pending" | "approved" | "rejected";
  rejectReason: string | null;
  paymentId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  installmentId: string | null;
};

export const SUBMISSION_SELECT = "id, fee_plan_id, candidate_id, amount, currency, paid_on, method, utr, note, has_screenshot, status, reject_reason, payment_id, created_at, reviewed_at, installment_id";

type RawSubmission = {
  id: string;
  fee_plan_id: string;
  candidate_id: string;
  amount: number;
  currency: string;
  paid_on: string;
  method: string;
  utr: string;
  note: string | null;
  has_screenshot: boolean | null;
  status: string;
  reject_reason: string | null;
  payment_id: string | null;
  created_at: string;
  reviewed_at: string | null;
  installment_id: string | null;
};

export function toSubmissionRow(r: RawSubmission): SubmissionRow {
  return {
    id: r.id,
    feePlanId: r.fee_plan_id,
    candidateId: r.candidate_id,
    amount: toPaise(r.amount),
    currency: r.currency,
    paidOn: r.paid_on,
    method: r.method as SubmissionRow["method"],
    utr: r.utr,
    note: r.note,
    hasScreenshot: Boolean(r.has_screenshot),
    status: r.status as SubmissionRow["status"],
    rejectReason: r.reject_reason,
    paymentId: r.payment_id,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    installmentId: r.installment_id,
  };
}

/** Number of "I've paid" reports waiting for a decision (0 when not readable). */
export async function countPendingSubmissions(supabase: Supabase, orgId: string, planId?: string): Promise<number> {
  let q = supabase.from("payment_submissions").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "pending");
  if (planId) q = q.eq("fee_plan_id", planId);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Reports formatted for the admin lists, with a warning when a recorded
 * payment already uses the same UTR as its reference.
 */
export async function loadSubmissionViews(
  supabase: Supabase,
  orgId: string,
  tz: string,
  opts: { status?: "pending" | "approved" | "rejected" | null; planId?: string; limit?: number } = {},
): Promise<SubmissionView[]> {
  let q = supabase
    .from("payment_submissions")
    .select(`${SUBMISSION_SELECT}, candidates(full_name), fee_plans(enrollment_id, courses(title))`)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.planId) q = q.eq("fee_plan_id", opts.planId);
  const { data, error } = await q;
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "payment submissions read failed", code: error.code }));
    throw new Error("Could not load the payments to verify.");
  }
  const rows = data ?? [];
  const utrs = [...new Set(rows.filter((r) => r.status === "pending").map((r) => r.utr))];
  const dupes = new Map<string, string>();
  if (utrs.length) {
    const { data: pays } = await supabase.from("payments").select("reference, receipt_number, status").eq("organization_id", orgId).in("reference", utrs).in("status", ["completed", "pending"]);
    for (const p of pays ?? []) if (p.reference) dupes.set(p.reference.toUpperCase(), p.receipt_number ?? "pending payment");
  }
  return rows.map((r) => {
    const s = toSubmissionRow(r as RawSubmission);
    const cand = Array.isArray(r.candidates) ? r.candidates[0] : r.candidates;
    const plan = Array.isArray(r.fee_plans) ? r.fee_plans[0] : r.fee_plans;
    const course = plan ? (Array.isArray(plan.courses) ? plan.courses[0] : plan.courses) : null;
    return {
      id: s.id,
      candidateName: cand?.full_name ?? "Student",
      feeHref: plan?.enrollment_id ? `/admin/finance/fees/${plan.enrollment_id}` : null,
      courseTitle: course?.title ?? "Course",
      amountText: formatPaise(s.amount, s.currency),
      amountInput: paiseToInput(s.amount),
      paidOnText: formatDate(s.paidOn),
      methodText: s.method === "upi" ? "UPI" : "Bank transfer",
      utr: s.utr,
      note: s.note,
      hasScreenshot: s.hasScreenshot,
      status: s.status,
      rejectReason: s.rejectReason,
      receiptHref: s.paymentId ? `/admin/finance/receipts/${s.paymentId}` : null,
      submittedText: formatDateTime(s.createdAt, tz),
      duplicateOf: s.status === "pending" ? (dupes.get(s.utr) ?? null) : null,
    };
  });
}
