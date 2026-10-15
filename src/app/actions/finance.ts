"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission, type Access } from "@/lib/auth/session";
import { todayIn } from "@/lib/calendar";
import { getBalances, getSchedule, installmentName, nextUnpaid } from "@/lib/data/finance";
import { getActivePayLinks, getPaymentSettings } from "@/lib/data/pay-links";
import { normalizeAddress } from "@/lib/email/automation-rules";
import { deliverAndLog, loadEmailSettings, siteUrl } from "@/lib/email/automations";
import { renderEmail } from "@/lib/email/render";
import { fromPaise, formatPaise } from "@/lib/finance/money";
import { cancelPaymentLink, createPaymentLink, razorpayConfig, razorpayContact, RazorpayError } from "@/lib/finance/razorpay";
import { buildReminderMessage } from "@/lib/finance/reminder";
import { normalizeWhatsappNumber, whatsappChatLink } from "@/lib/public-site";
import { checkRateLimit, type RateLimitRule } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  categorySchema,
  expenseSchema,
  feePlanSchema,
  paymentLinkSchema,
  paymentSchema,
  refundSchema,
  reminderSchema,
  voidSchema,
} from "@/lib/validation/finance";

export type FinanceActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  id?: string;
  /** WhatsApp click-to-chat or payment link to open/copy in the browser. */
  url?: string;
};

type PgError = { code?: string; message?: string } | null;
type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const MANAGE = ["finance.manage"] as const;
const idSchema = z.uuid();
const REMINDER_EMAIL_LIMIT: RateLimitRule = { namespace: "fee-reminder-user", limit: 100, windowSeconds: 60 * 60 };
const LINK_LIMIT: RateLimitRule = { namespace: "payment-link-user", limit: 60, windowSeconds: 60 * 60 };

const fix = (fieldErrors: Record<string, string[] | undefined>): FinanceActionResult => ({ ok: false, message: "Please fix the highlighted fields.", fieldErrors });
const notFound = (): FinanceActionResult => ({ ok: false, message: "That item could not be found. Refresh the page and try again." });

/** Messages raised by our own triggers (SQLSTATE ARFIN) are written for people. */
function dbMessage(error: PgError, fallback: string): string {
  if (error?.code === "ARFIN" && error.message) return error.message;
  if (error?.code === "42501") return "You do not have permission to do that.";
  if (error?.code === "23505") return "That already exists. Refresh the page and check.";
  if (error?.code === "23503") return "Something this refers to no longer exists, or is still in use. Refresh and try again.";
  if (error?.code === "P0002") return "That enrollment could not be found.";
  console.error(JSON.stringify({ level: "error", msg: fallback, code: error?.code }));
  return fallback;
}

function revalidateFinance(enrollmentId?: string | null, candidateId?: string | null) {
  revalidatePath("/admin/finance", "layout");
  if (enrollmentId) revalidatePath(`/admin/finance/fees/${enrollmentId}`);
  if (candidateId) revalidatePath(`/admin/candidates/${candidateId}`);
  revalidatePath("/admin/batches", "layout");
}

async function planInfo(supabase: Supabase, orgId: string, planId: string) {
  const { data } = await supabase.from("fee_plans").select("id, enrollment_id, candidate_id, currency, final_fee").eq("id", planId).eq("organization_id", orgId).maybeSingle();
  return data;
}

/* -------------------------------------------------------------------------- */
/* Fee plans                                                                   */
/* -------------------------------------------------------------------------- */

export async function saveFeePlan(input: unknown): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = feePlanSchema.safeParse(input);
  if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const enr = await supabase.from("enrollments").select("id, candidate_id").eq("id", v.enrollmentId).eq("organization_id", access.organization.id).maybeSingle();
  if (!enr.data) return { ok: false, message: "That enrollment could not be found. Fees need a batch or course enrollment first." };
  const { data, error } = await supabase.rpc("save_fee_plan", {
    p_enrollment: v.enrollmentId,
    p_currency: v.currency,
    p_base_fee: fromPaise(v.baseFee),
    p_discount_type: v.discountType,
    // Amount discounts are sent in currency units, percentages as percent.
    p_discount_value: v.discountType === "none" ? 0 : fromPaise(v.discountValue),
    p_discount_reason: v.discountReason ?? "",
    p_notes: v.notes ?? "",
    p_installments: v.installments.map((i) => ({ due_date: i.dueDate, amount: fromPaise(i.amount), label: i.label })),
  });
  if (error || !data) return { ok: false, message: dbMessage(error, "Could not save the fee plan. Please try again.") };
  revalidateFinance(v.enrollmentId, enr.data.candidate_id);
  return { ok: true, id: data, message: "Fee plan saved." };
}

/** Only a plan without any payments (even voided ones) can be removed. */
export async function deleteFeePlan(planId: string): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(planId).success) return notFound();
  const supabase = await createSupabaseServerClient();
  const plan = await planInfo(supabase, access.organization.id, planId);
  if (!plan) return notFound();
  const [{ count: pays }, { count: links }] = await Promise.all([
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("fee_plan_id", planId),
    supabase.from("payment_links").select("id", { count: "exact", head: true }).eq("fee_plan_id", planId),
  ]);
  if ((pays ?? 0) > 0 || (links ?? 0) > 0) return { ok: false, message: "This fee plan has payments or payment links, so it is kept for the record. Change the fee instead." };
  const { error } = await supabase.from("fee_plans").delete().eq("id", planId).eq("organization_id", access.organization.id);
  if (error) return { ok: false, message: dbMessage(error, "Could not remove the fee plan.") };
  revalidateFinance(plan.enrollment_id, plan.candidate_id);
  return { ok: true, message: "Fee plan removed." };
}

/* -------------------------------------------------------------------------- */
/* Payments and refunds                                                        */
/* -------------------------------------------------------------------------- */

export async function recordPayment(input: unknown): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const plan = await planInfo(supabase, access.organization.id, v.feePlanId);
  if (!plan) return { ok: false, message: "Set up the fee plan before recording payments." };
  const { data, error } = await supabase
    .from("payments")
    .insert({
      organization_id: access.organization.id,
      fee_plan_id: v.feePlanId,
      // Copied from the fee plan again by the database; sent only to satisfy the column types.
      enrollment_id: plan.enrollment_id,
      candidate_id: plan.candidate_id,
      installment_id: v.installmentId,
      amount: fromPaise(v.amount),
      currency: plan.currency,
      paid_on: v.paidOn,
      method: v.method as "upi",
      reference: v.reference,
      notes: v.notes,
      status: v.status,
      recorded_by: access.userId,
    })
    .select("id, receipt_number")
    .single();
  if (error || !data) return { ok: false, message: dbMessage(error, "Could not record the payment. Please try again.") };
  revalidateFinance(plan.enrollment_id, plan.candidate_id);
  return {
    ok: true,
    id: data.id,
    message: data.receipt_number ? `Payment of ${formatPaise(v.amount, plan.currency)} recorded. Receipt ${data.receipt_number}.` : "Pending payment recorded. Mark it received when the money arrives.",
  };
}

async function paymentPlan(supabase: Supabase, orgId: string, paymentId: string) {
  const { data } = await supabase.from("payments").select("id, enrollment_id, candidate_id, fee_plan_id, status").eq("id", paymentId).eq("organization_id", orgId).maybeSingle();
  return data;
}

export async function markPaymentReceived(paymentId: string): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(paymentId).success) return notFound();
  const supabase = await createSupabaseServerClient();
  const p = await paymentPlan(supabase, access.organization.id, paymentId);
  if (!p) return notFound();
  if (p.status !== "pending") return { ok: false, message: "Only pending payments can be marked as received." };
  const { data, error } = await supabase.from("payments").update({ status: "completed" }).eq("id", paymentId).eq("organization_id", access.organization.id).select("receipt_number");
  if (error || !data?.length) return { ok: false, message: dbMessage(error, "Could not update the payment.") };
  revalidateFinance(p.enrollment_id, p.candidate_id);
  return { ok: true, message: `Marked as received. Receipt ${data[0].receipt_number}.` };
}

export async function markPaymentFailed(paymentId: string): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(paymentId).success) return notFound();
  const supabase = await createSupabaseServerClient();
  const p = await paymentPlan(supabase, access.organization.id, paymentId);
  if (!p) return notFound();
  if (p.status !== "pending") return { ok: false, message: "Only pending payments can be marked as failed." };
  const { error } = await supabase.from("payments").update({ status: "failed" }).eq("id", paymentId).eq("organization_id", access.organization.id);
  if (error) return { ok: false, message: dbMessage(error, "Could not update the payment.") };
  revalidateFinance(p.enrollment_id, p.candidate_id);
  return { ok: true, message: "Marked as failed. It does not count as collected." };
}

export async function voidPayment(input: unknown): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const p = await paymentPlan(supabase, access.organization.id, parsed.data.id);
  if (!p) return notFound();
  const { error } = await supabase.from("payments").update({ status: "voided", void_reason: parsed.data.reason }).eq("id", parsed.data.id).eq("organization_id", access.organization.id);
  if (error) return { ok: false, message: dbMessage(error, "Could not void the payment.") };
  revalidateFinance(p.enrollment_id, p.candidate_id);
  return { ok: true, message: "Payment voided. It stays in the history but no longer counts." };
}

export async function recordRefund(input: unknown): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const p = await paymentPlan(supabase, access.organization.id, v.paymentId);
  if (!p) return notFound();
  const { error } = await supabase.from("payment_refunds").insert({
    organization_id: access.organization.id,
    payment_id: v.paymentId,
    fee_plan_id: p.fee_plan_id,
    amount: fromPaise(v.amount),
    refunded_on: v.refundedOn,
    method: v.method as "upi",
    reference: v.reference,
    reason: v.reason,
    recorded_by: access.userId,
  });
  if (error) return { ok: false, message: dbMessage(error, "Could not record the refund. Please try again.") };
  revalidateFinance(p.enrollment_id, p.candidate_id);
  return { ok: true, message: "Refund recorded." };
}

export async function voidRefund(input: unknown): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("payment_refunds")
    .update({ status: "voided", void_reason: parsed.data.reason })
    .eq("id", parsed.data.id)
    .eq("organization_id", access.organization.id)
    .select("payment_id, payments(enrollment_id, candidate_id)");
  if (error) return { ok: false, message: dbMessage(error, "Could not void the refund.") };
  if (!data?.length) return notFound();
  const pay = Array.isArray(data[0].payments) ? data[0].payments[0] : data[0].payments;
  revalidateFinance(pay?.enrollment_id, pay?.candidate_id);
  return { ok: true, message: "Refund voided." };
}

/* -------------------------------------------------------------------------- */
/* Expenses and categories                                                     */
/* -------------------------------------------------------------------------- */

export async function saveExpense(input: unknown, expenseId?: string | null): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
  if (expenseId && !idSchema.safeParse(expenseId).success) return notFound();
  const v = parsed.data;
  const cols = {
    category_id: v.categoryId,
    spent_on: v.spentOn,
    amount: fromPaise(v.amount),
    currency: v.currency,
    description: v.description,
    vendor: v.vendor,
    method: v.method as "upi",
    reference: v.reference,
    notes: v.notes,
    receipt_url: v.receiptUrl,
    course_id: v.courseId,
    batch_id: v.batchId,
  };
  const supabase = await createSupabaseServerClient();
  const res = expenseId
    ? await supabase.from("expenses").update(cols).eq("id", expenseId).eq("organization_id", access.organization.id).select("id")
    : await supabase.from("expenses").insert({ ...cols, organization_id: access.organization.id, created_by: access.userId }).select("id");
  if (res.error) {
    if (res.error.code === "23503") return fix({ categoryId: ["Choose a category, course and batch from the lists"] });
    return { ok: false, message: dbMessage(res.error, "Could not save the expense. Please try again.") };
  }
  if (!res.data?.length) return notFound();
  revalidateFinance();
  return { ok: true, id: res.data[0].id, message: expenseId ? "Expense updated." : `Expense of ${formatPaise(v.amount, v.currency)} recorded.` };
}

export async function voidExpense(input: unknown): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("expenses")
    .update({ status: "voided", void_reason: parsed.data.reason })
    .eq("id", parsed.data.id)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) return { ok: false, message: dbMessage(error, "Could not void the expense.") };
  if (!data?.length) return notFound();
  revalidateFinance();
  return { ok: true, message: "Expense voided. It stays in the history but no longer counts." };
}

export async function addExpenseCategory(input: unknown): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase.from("expense_categories").select("id", { count: "exact", head: true }).eq("organization_id", access.organization.id);
  const { error } = await supabase.from("expense_categories").insert({ organization_id: access.organization.id, name: parsed.data.name, position: (count ?? 0) + 1 });
  if (error) return error.code === "23505" ? fix({ name: ["A category with this name already exists"] }) : { ok: false, message: dbMessage(error, "Could not add the category.") };
  revalidateFinance();
  return { ok: true, message: "Category added." };
}

export async function updateExpenseCategory(categoryId: string, input: { name?: string; isActive?: boolean }): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(categoryId).success) return notFound();
  const patch: { name?: string; is_active?: boolean } = {};
  if (input.name !== undefined) {
    const parsed = categorySchema.safeParse({ name: input.name });
    if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
    patch.name = parsed.data.name;
  }
  if (typeof input.isActive === "boolean") patch.is_active = input.isActive;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("expense_categories").update(patch).eq("id", categoryId).eq("organization_id", access.organization.id).select("id");
  if (error) return error.code === "23505" ? fix({ name: ["A category with this name already exists"] }) : { ok: false, message: dbMessage(error, "Could not update the category.") };
  if (!data?.length) return notFound();
  revalidateFinance();
  return { ok: true, message: "Category updated." };
}

export async function deleteExpenseCategory(categoryId: string): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(categoryId).success) return notFound();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("expense_categories").delete().eq("id", categoryId).eq("organization_id", access.organization.id).select("id");
  if (error) {
    return { ok: false, message: error.code === "23503" ? "This category has expenses. Switch it off instead so it stops appearing in the list." : dbMessage(error, "Could not delete the category.") };
  }
  if (!data?.length) return notFound();
  revalidateFinance();
  return { ok: true, message: "Category deleted." };
}

/* -------------------------------------------------------------------------- */
/* Reminders                                                                   */
/* -------------------------------------------------------------------------- */

type ReminderContext = {
  planId: string;
  enrollmentId: string;
  candidateId: string;
  candidate: { full_name: string; email: string | null; phone: string | null; do_not_contact: boolean };
  courseTitle: string;
  currency: string;
  dueInstallment: { id: string; name: string; remaining: number; dueDate: string } | null;
  outstanding: number;
};

/** Everything a reminder or payment link needs, computed on the server from the database. */
async function reminderContext(supabase: Supabase, access: Access, planId: string, installmentId: string | null): Promise<ReminderContext | { error: string }> {
  const orgId = access.organization.id;
  const { data: plan } = await supabase
    .from("fee_plans")
    .select("id, enrollment_id, candidate_id, currency, candidates(full_name, email, phone, do_not_contact), courses(title)")
    .eq("id", planId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!plan) return { error: "That fee plan could not be found." };
  const candidate = Array.isArray(plan.candidates) ? plan.candidates[0] : plan.candidates;
  if (!candidate) return { error: "You cannot see this candidate's contact details." };
  const course = Array.isArray(plan.courses) ? plan.courses[0] : plan.courses;
  const [schedule, balances] = await Promise.all([getSchedule(supabase, planId), getBalances(supabase, orgId, [planId])]);
  const inst = installmentId ? schedule.find((s) => s.id === installmentId) : nextUnpaid(schedule);
  if (installmentId && !inst) return { error: "That installment no longer exists. Refresh the page." };
  return {
    planId,
    enrollmentId: plan.enrollment_id,
    candidateId: plan.candidate_id,
    candidate,
    courseTitle: course?.title ?? "your course",
    currency: plan.currency,
    dueInstallment: inst && inst.remaining > 0 ? { id: inst.id, name: installmentName(inst), remaining: inst.remaining, dueDate: inst.dueDate } : null,
    outstanding: balances.get(planId)?.outstanding ?? 0,
  };
}

async function countryCode(supabase: Supabase, orgId: string): Promise<string> {
  const { data } = await supabase.from("sharing_settings").select("whatsapp_country_code").eq("organization_id", orgId).maybeSingle();
  return data?.whatsapp_country_code ?? "91";
}

async function activeLinkUrl(supabase: Supabase, planId: string, installmentId: string | null): Promise<string | null> {
  let q = supabase.from("payment_links").select("short_url").eq("fee_plan_id", planId).eq("status", "created");
  q = installmentId ? q.eq("installment_id", installmentId) : q.is("installment_id", null);
  const { data } = await q.order("created_at", { ascending: false }).limit(1);
  return data?.[0]?.short_url ?? null;
}

/**
 * WhatsApp: returns a click-to-chat link and records "opened" (not "sent":
 * the person still presses send). Email: sends through the email provider and
 * records the honest outcome. Both add a timeline entry without amounts.
 */
export async function sendFeeReminder(input: unknown): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = reminderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a fee plan and a channel." };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const ctx = await reminderContext(supabase, access, v.feePlanId, v.installmentId);
  if ("error" in ctx) return { ok: false, message: ctx.error };
  if (ctx.outstanding <= 0) return { ok: false, message: "Nothing is outstanding on this fee plan." };
  if (ctx.candidate.do_not_contact) return { ok: false, message: "This candidate is marked “do not contact”." };

  const today = todayIn(access.organization.timezone);
  const due = ctx.dueInstallment;
  const [link, paySettings, payLinks] = await Promise.all([
    activeLinkUrl(supabase, ctx.planId, due?.id ?? null),
    getPaymentSettings(supabase, access.organization.id),
    getActivePayLinks(supabase, access.organization.id, [ctx.planId]),
  ]);
  // The free UPI / bank-transfer pay page and UPI ID, when "show in reminders" is on.
  const showUpi = paySettings?.showInReminders ?? false;
  const payPageUrl = showUpi ? (payLinks.get(ctx.planId)?.url ?? null) : null;
  const msg = buildReminderMessage({
    candidateName: ctx.candidate.full_name,
    businessName: access.organization.name,
    courseTitle: ctx.courseTitle,
    installmentLabel: due?.name ?? null,
    duePaise: due?.remaining ?? ctx.outstanding,
    dueDate: due?.dueDate ?? null,
    outstandingPaise: ctx.outstanding,
    currency: ctx.currency,
    today,
    paymentUrl: link,
    payPageUrl,
    upiId: showUpi ? (paySettings?.upiVpa ?? null) : null,
  });

  if (v.channel === "whatsapp") {
    const wa = whatsappChatLink(ctx.candidate.phone, msg.body, await countryCode(supabase, access.organization.id));
    if (!wa.ok) return { ok: false, message: wa.reason };
    const { error } = await supabase.rpc("log_fee_reminder", { p_plan: ctx.planId, p_channel: "whatsapp", p_status: "opened", p_installment: due?.id ?? undefined });
    if (error) return { ok: false, message: dbMessage(error, "Could not record the reminder.") };
    revalidatePath(`/admin/candidates/${ctx.candidateId}`);
    return { ok: true, url: wa.url, message: "WhatsApp opened with the reminder. Press send in WhatsApp to deliver it." };
  }

  const to = normalizeAddress(ctx.candidate.email);
  if (!to) return { ok: false, message: "No valid email address is saved for this candidate." };
  const rate = await checkRateLimit(REMINDER_EMAIL_LIMIT, access.userId);
  if (rate !== "ok") return { ok: false, message: rate === "limited" ? "Too many reminder emails in the last hour. Try again later." : "Sending is temporarily unavailable. Try again shortly." };
  const admin = createSupabaseAdminClient();
  const settings = await loadEmailSettings(admin, access.organization.id);
  const rendered = renderEmail(
    {
      subject: msg.subject,
      design: {
        body: msg.body,
        button_label: link ? "Pay online" : payPageUrl ? "Pay by UPI or bank transfer" : null,
        button_url: link ?? payPageUrl,
        footer_text: `Sent by ${access.organization.name}. Reply to this email if you have any questions.`,
      },
    },
    { business_name: access.organization.name },
    { siteUrl: siteUrl() },
  );
  const outcome = await deliverAndLog(admin, { organizationId: access.organization.id, kind: "fee_reminder", candidateId: ctx.candidateId, createdBy: access.userId }, to, rendered, {
    replyTo: normalizeAddress(settings.replyTo) ?? normalizeAddress(access.email),
    senderName: settings.senderName ?? access.organization.name,
  });
  const { error } = await supabase.rpc("log_fee_reminder", { p_plan: ctx.planId, p_channel: "email", p_status: outcome.status, p_installment: due?.id ?? undefined });
  if (error) console.error(JSON.stringify({ level: "error", msg: "reminder log failed", code: error.code }));
  revalidatePath(`/admin/candidates/${ctx.candidateId}`);
  if (outcome.status === "sent") return { ok: true, message: "Reminder emailed." };
  if (outcome.status === "not_sent") return { ok: false, message: "No email provider is set up, so nothing was sent. Use WhatsApp, or set up email under Marketing › Emails › Settings." };
  return { ok: false, message: `The email could not be sent: ${outcome.error ?? "unknown error"}` };
}

/* -------------------------------------------------------------------------- */
/* Razorpay payment links                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Creates (or reuses) a Razorpay payment link for an installment or the whole
 * outstanding amount. The amount is computed here from the database; the
 * browser only says which plan/installment.
 */
export async function createRazorpayLink(input: unknown): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  const cfg = razorpayConfig();
  if (!cfg) return { ok: false, message: "Online payments are not set up. Add the Razorpay keys (see Settings › Integrations), or keep recording payments manually." };
  const parsed = paymentLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a fee plan." };
  const supabase = await createSupabaseServerClient();
  const ctx = await reminderContext(supabase, access, parsed.data.feePlanId, parsed.data.installmentId);
  if ("error" in ctx) return { ok: false, message: ctx.error };
  const installmentId = parsed.data.installmentId ? (ctx.dueInstallment?.id ?? null) : null;
  if (parsed.data.installmentId && !installmentId) return { ok: false, message: "That installment is already paid." };
  const amount = installmentId ? Math.min(ctx.dueInstallment?.remaining ?? 0, ctx.outstanding) : ctx.outstanding;
  if (amount < 100) return { ok: false, message: "Nothing (or less than 1.00) is outstanding, so no link is needed." };

  // Idempotency: one live link per plan/installment and amount.
  let existing = supabase.from("payment_links").select("short_url, amount").eq("fee_plan_id", ctx.planId).eq("status", "created");
  existing = installmentId ? existing.eq("installment_id", installmentId) : existing.is("installment_id", null);
  const { data: live } = await existing.order("created_at", { ascending: false }).limit(1);
  if (live?.[0]?.short_url && Math.round(live[0].amount * 100) === amount) return { ok: true, url: live[0].short_url, message: "A link for this amount already exists. Share it again." };

  const rate = await checkRateLimit(LINK_LIMIT, access.userId);
  if (rate !== "ok") return { ok: false, message: rate === "limited" ? "Too many payment links in the last hour. Try again later." : "Creating links is temporarily unavailable. Try again shortly." };

  const { data: row, error } = await supabase
    .from("payment_links")
    .insert({ organization_id: access.organization.id, fee_plan_id: ctx.planId, installment_id: installmentId, amount: fromPaise(amount), currency: ctx.currency, status: "creating", created_by: access.userId })
    .select("id")
    .single();
  if (error || !row) return { ok: false, message: dbMessage(error, "Could not prepare the payment link.") };

  const phone = normalizeWhatsappNumber(ctx.candidate.phone, await countryCode(supabase, access.organization.id));
  try {
    const link = await createPaymentLink(cfg, {
      amountPaise: amount,
      currency: ctx.currency,
      referenceId: row.id,
      description: `${ctx.courseTitle} · ${installmentId ? ctx.dueInstallment?.name : "Course fee"}`,
      customer: { name: ctx.candidate.full_name, email: normalizeAddress(ctx.candidate.email), contact: phone.ok ? razorpayContact(phone.digits) : null },
      callbackUrl: `${siteUrl()}/pay/thank-you`,
      notes: { fee_plan_id: ctx.planId, installment_id: installmentId ?? "", payment_link_row: row.id },
      expireBy: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    });
    const { error: upError } = await supabase.from("payment_links").update({ status: "created", provider_link_id: link.id, short_url: link.shortUrl, error: null }).eq("id", row.id);
    if (upError) console.error(JSON.stringify({ level: "error", msg: "payment link save failed", code: upError.code }));
    revalidateFinance(ctx.enrollmentId);
    return { ok: true, url: link.shortUrl, message: `Payment link for ${formatPaise(amount, ctx.currency)} created (${cfg.mode === "test" ? "test mode" : "live"}).` };
  } catch (e) {
    const message = e instanceof RazorpayError ? e.message : "Could not reach Razorpay. Try again.";
    await supabase.from("payment_links").update({ status: "failed", error: message.slice(0, 500) }).eq("id", row.id);
    revalidateFinance(ctx.enrollmentId);
    return { ok: false, message: `${message} Nothing was charged; you can still record payments manually.` };
  }
}

export async function cancelRazorpayLink(linkRowId: string): Promise<FinanceActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(linkRowId).success) return notFound();
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("payment_links")
    .select("id, status, provider_link_id, fee_plan_id, fee_plans(enrollment_id)")
    .eq("id", linkRowId)
    .eq("organization_id", access.organization.id)
    .maybeSingle();
  if (!row) return notFound();
  if (row.status !== "created" && row.status !== "creating" && row.status !== "failed") return { ok: false, message: "This link is already closed." };
  const cfg = razorpayConfig();
  if (row.provider_link_id && row.status === "created") {
    if (!cfg) return { ok: false, message: "Razorpay keys are not set, so the link cannot be cancelled from here. Cancel it in the Razorpay dashboard." };
    try {
      await cancelPaymentLink(cfg, row.provider_link_id);
    } catch (e) {
      return { ok: false, message: e instanceof RazorpayError ? e.message.replace("could not create the link", "could not cancel the link") : "Could not reach Razorpay. Try again." };
    }
  }
  const { error } = await supabase.from("payment_links").update({ status: "cancelled" }).eq("id", row.id);
  if (error) return { ok: false, message: dbMessage(error, "Could not update the link.") };
  const plan = Array.isArray(row.fee_plans) ? row.fee_plans[0] : row.fee_plans;
  revalidateFinance(plan?.enrollment_id);
  return { ok: true, message: "Payment link cancelled." };
}
