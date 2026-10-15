"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission, type Access } from "@/lib/auth/session";
import { getBalances, getSchedule, installmentName, nextUnpaid } from "@/lib/data/finance";
import { getActivePayLinks, getPaymentSettings, payLinkSecret, payUrl } from "@/lib/data/pay-links";
import { normalizeAddress } from "@/lib/email/automation-rules";
import { deliverAndLog, loadEmailSettings, siteUrl } from "@/lib/email/automations";
import { sniffImage } from "@/lib/email/image";
import { renderEmail } from "@/lib/email/render";
import { formatPaise, fromPaise, toPaise } from "@/lib/finance/money";
import { hashPayToken, newPayLinkSeed, payLinkToken } from "@/lib/finance/pay-link-token";
import { buildPayLinkMessage } from "@/lib/finance/reminder";
import { whatsappChatLink } from "@/lib/public-site";
import { checkRateLimit, type RateLimitRule } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { approveSchema, payLinkSchema, paymentDetailsSchema, rejectSchema, sendPayLinkSchema, type PayLinkMode } from "@/lib/validation/payment-details";

export type UpiActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  id?: string;
  /** Pay page, WhatsApp click-to-chat or image URL for the browser. */
  url?: string;
};

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type PgError = { code?: string; message?: string } | null;

const DETAIL_EDITORS = ["finance.manage", "settings.manage"] as const;
const MANAGE = ["finance.manage"] as const;
const QR_MAX_BYTES = 1024 * 1024;
const QR_LIMIT: RateLimitRule = { namespace: "payment-qr-user", limit: 30, windowSeconds: 60 * 60 };
const PAY_LINK_LIMIT: RateLimitRule = { namespace: "pay-link-user", limit: 120, windowSeconds: 60 * 60 };
const PAY_LINK_EMAIL_LIMIT: RateLimitRule = { namespace: "pay-link-email-user", limit: 100, windowSeconds: 60 * 60 };

const fix = (fieldErrors: Record<string, string[] | undefined>): UpiActionResult => ({ ok: false, message: "Please fix the highlighted fields.", fieldErrors });

function dbMessage(error: PgError, fallback: string): string {
  if (error?.code === "ARFIN" && error.message) return error.message;
  if (error?.code === "42501") return "You do not have permission to do that.";
  if (error?.code === "23514") return "Some values were not accepted. Check the form and try again.";
  if (error?.code === "23505") return "That reference is already used by another payment.";
  console.error(JSON.stringify({ level: "error", msg: fallback, code: error?.code }));
  return fallback;
}

function revalidatePaymentPages() {
  revalidatePath("/admin/settings/payments");
  revalidatePath("/admin/finance", "layout");
  // Course pages can show the payment details.
  revalidatePath("/courses", "layout");
}

/* -------------------------------------------------------------------------- */
/* Settings › Payment details                                                  */
/* -------------------------------------------------------------------------- */

export async function savePaymentDetails(input: unknown): Promise<UpiActionResult> {
  const access = await assertPermission(DETAIL_EDITORS);
  const parsed = paymentDetailsSchema.safeParse(input);
  if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const patch = {
    upi_vpa: v.upiVpa,
    upi_payee_name: v.upiPayeeName,
    bank_account_holder: v.bankAccountHolder,
    bank_ifsc: v.bankIfsc,
    bank_name: v.bankName,
    bank_branch: v.bankBranch,
    bank_account_type: v.bankAccountType,
    instructions: v.instructions,
    show_on_pay_page: v.showOnPayPage,
    show_in_reminders: v.showInReminders,
    show_on_course_pages: v.showOnCoursePages,
    confirm_email_enabled: v.confirmEmailEnabled,
    confirm_email_subject: v.confirmEmailSubject,
    confirm_email_body: v.confirmEmailBody,
    // A blank field with "keep" leaves the saved number untouched.
    ...(v.bankAccountNumber || !v.keepAccountNumber ? { bank_account_number: v.bankAccountNumber } : {}),
  };
  const { data, error } = await supabase.from("payment_settings").update(patch).eq("organization_id", access.organization.id).select("organization_id");
  if (error) return { ok: false, message: dbMessage(error, "Could not save the payment details. Please try again.") };
  if (!data?.length) return { ok: false, message: "Payment details are not set up yet. Run the latest supabase/setup.sql and try again." };
  revalidatePaymentPages();
  return { ok: true, message: "Payment details saved." };
}

/** Uploads the owner's own UPI QR image (PNG or JPG, up to 1 MB) and selects it. */
export async function uploadPaymentQr(formData: FormData): Promise<UpiActionResult> {
  const access = await assertPermission(DETAIL_EDITORS);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose your QR image to upload." };
  if (file.size > QR_MAX_BYTES) return { ok: false, message: "The QR image can be at most 1 MB. Take a smaller screenshot or compress it." };
  const rate = await checkRateLimit(QR_LIMIT, access.userId);
  if (rate !== "ok") return { ok: false, message: rate === "limited" ? "Too many uploads. Try again in an hour." : "Uploads are temporarily unavailable. Try again shortly." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed || (sniffed.contentType !== "image/png" && sniffed.contentType !== "image/jpeg")) return { ok: false, message: "Upload the QR as a PNG or JPG image." };
  const buf = Buffer.from(bytes);
  const id = randomUUID();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("media_assets").insert({
    id,
    organization_id: access.organization.id,
    file_name: file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || null,
    content_type: sniffed.contentType,
    data: `\\x${buf.toString("hex")}`,
    byte_size: buf.byteLength,
    sha256: createHash("sha256").update(buf).digest("hex"),
    width: sniffed.width,
    height: sniffed.height,
    created_by: access.userId,
  });
  if (error) return { ok: false, message: dbMessage(error, "Could not upload the QR image. Please try again.") };
  const { error: upError } = await supabase.from("payment_settings").update({ upi_qr_media_id: id }).eq("organization_id", access.organization.id);
  if (upError) return { ok: false, message: dbMessage(upError, "Could not save the QR image. Please try again.") };
  revalidatePaymentPages();
  return { ok: true, id, url: `/media/${id}`, message: "QR image uploaded." };
}

export async function removePaymentQr(): Promise<UpiActionResult> {
  const access = await assertPermission(DETAIL_EDITORS);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("payment_settings").update({ upi_qr_media_id: null }).eq("organization_id", access.organization.id);
  if (error) return { ok: false, message: dbMessage(error, "Could not remove the QR image.") };
  revalidatePaymentPages();
  return { ok: true, message: "QR image removed. The pay page shows the automatic QR (with the amount)." };
}

/* -------------------------------------------------------------------------- */
/* Pay links                                                                   */
/* -------------------------------------------------------------------------- */

async function planOf(supabase: Supabase, orgId: string, planId: string) {
  const { data } = await supabase
    .from("fee_plans")
    .select("id, enrollment_id, candidate_id, currency, candidates(full_name, email, phone, do_not_contact), courses(title)")
    .eq("id", planId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return data;
}

async function makePayLink(supabase: Supabase, access: Access, planId: string, mode: PayLinkMode): Promise<{ url: string } | { error: string }> {
  const rate = await checkRateLimit(PAY_LINK_LIMIT, access.userId);
  if (rate !== "ok") return { error: rate === "limited" ? "Too many pay links in the last hour. Try again later." : "Creating links is temporarily unavailable. Try again shortly." };
  const { id, nonce } = newPayLinkSeed();
  const token = payLinkToken(payLinkSecret(), id, nonce);
  const { error } = await supabase.rpc("create_fee_pay_link", { p_plan: planId, p_mode: mode, p_id: id, p_nonce: nonce, p_token_hash: hashPayToken(token) });
  if (error) return { error: dbMessage(error, "Could not make the pay link. Please try again.") };
  return { url: payUrl(id, nonce) };
}

/** Makes a new pay link for the plan (revoking the old one, so old messages stop working). */
export async function createPayLink(input: unknown): Promise<UpiActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = payLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a fee plan." };
  const supabase = await createSupabaseServerClient();
  const plan = await planOf(supabase, access.organization.id, parsed.data.feePlanId);
  if (!plan) return { ok: false, message: "That fee plan could not be found." };
  const res = await makePayLink(supabase, access, plan.id, parsed.data.mode);
  if ("error" in res) return { ok: false, message: res.error };
  revalidatePath(`/admin/finance/fees/${plan.enrollment_id}`);
  revalidatePath("/admin/finance");
  return { ok: true, url: res.url, message: "Pay link ready. Copy it or send it by WhatsApp or email." };
}

export async function revokePayLink(linkId: string): Promise<UpiActionResult> {
  const access = await assertPermission(MANAGE);
  if (!z.guid().safeParse(linkId).success) return { ok: false, message: "That link could not be found." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fee_pay_links")
    .update({ status: "revoked" })
    .eq("id", linkId)
    .eq("organization_id", access.organization.id)
    .eq("status", "active")
    .select("fee_plan_id, fee_plans(enrollment_id)");
  if (error) return { ok: false, message: dbMessage(error, "Could not switch the link off.") };
  if (!data?.length) return { ok: false, message: "That link is already switched off." };
  const plan = Array.isArray(data[0].fee_plans) ? data[0].fee_plans[0] : data[0].fee_plans;
  if (plan?.enrollment_id) revalidatePath(`/admin/finance/fees/${plan.enrollment_id}`);
  revalidatePath("/admin/finance");
  return { ok: true, message: "Pay link switched off. Anyone opening it now sees that it is no longer valid." };
}

/**
 * Shares the plan's pay link (making one for the next installment when none is
 * live): WhatsApp returns a click-to-chat link and records "opened"; email
 * sends through the email provider and records the outcome. Copy: returns the URL.
 */
export async function sendPayLink(input: unknown): Promise<UpiActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = sendPayLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a fee plan and a channel." };
  const v = parsed.data;
  const orgId = access.organization.id;
  const supabase = await createSupabaseServerClient();
  const plan = await planOf(supabase, orgId, v.feePlanId);
  if (!plan) return { ok: false, message: "That fee plan could not be found." };
  const cand = Array.isArray(plan.candidates) ? plan.candidates[0] : plan.candidates;
  const course = Array.isArray(plan.courses) ? plan.courses[0] : plan.courses;
  if (!cand) return { ok: false, message: "You cannot see this candidate's contact details." };
  if (cand.do_not_contact) return { ok: false, message: "This candidate is marked “do not contact”." };

  const [schedule, balances, links, settings] = await Promise.all([getSchedule(supabase, plan.id), getBalances(supabase, orgId, [plan.id]), getActivePayLinks(supabase, orgId, [plan.id]), getPaymentSettings(supabase, orgId)]);
  const outstanding = balances.get(plan.id)?.outstanding ?? 0;
  if (outstanding <= 0) return { ok: false, message: "Nothing is outstanding on this fee plan." };
  if (!settings?.upiVpa && !settings?.bankAccountLast4) return { ok: false, message: "Add your UPI ID or bank details first (Settings › Payment details)." };

  let link = links.get(plan.id);
  const mode: PayLinkMode = link?.amountMode ?? "next_installment";
  if (!link) {
    if (!v.create) return { ok: false, message: "There is no pay link yet. Make one first." };
    const made = await makePayLink(supabase, access, plan.id, mode);
    if ("error" in made) return { ok: false, message: made.error };
    link = { id: "", amountMode: mode, url: made.url, openCount: 0, lastOpenedAt: null, createdAt: new Date().toISOString() };
  }
  const next = mode === "next_installment" ? nextUnpaid(schedule) : null;
  const msg = buildPayLinkMessage({
    candidateName: cand.full_name,
    businessName: access.organization.name,
    courseTitle: course?.title ?? "your course",
    label: next ? installmentName(next) : null,
    amountPaise: next ? Math.min(next.remaining, outstanding) : outstanding,
    currency: plan.currency,
    url: link.url,
    upiId: settings?.showInReminders ? settings.upiVpa : null,
  });

  if (v.channel === "whatsapp") {
    const { data: share } = await supabase.from("sharing_settings").select("whatsapp_country_code").eq("organization_id", orgId).maybeSingle();
    const wa = whatsappChatLink(cand.phone, msg.body, share?.whatsapp_country_code ?? "91");
    if (!wa.ok) return { ok: false, message: wa.reason };
    const { error } = await supabase.rpc("log_fee_reminder", { p_plan: plan.id, p_channel: "whatsapp", p_status: "opened", p_installment: next?.id ?? undefined });
    if (error) console.error(JSON.stringify({ level: "error", msg: "pay link share log failed", code: error.code }));
    revalidatePath(`/admin/finance/fees/${plan.enrollment_id}`);
    revalidatePath(`/admin/candidates/${plan.candidate_id}`);
    return { ok: true, url: wa.url, message: "WhatsApp opened with the pay link. Press send in WhatsApp to deliver it." };
  }

  const to = normalizeAddress(cand.email);
  if (!to) return { ok: false, message: "No valid email address is saved for this candidate." };
  const rate = await checkRateLimit(PAY_LINK_EMAIL_LIMIT, access.userId);
  if (rate !== "ok") return { ok: false, message: rate === "limited" ? "Too many emails in the last hour. Try again later." : "Sending is temporarily unavailable. Try again shortly." };
  const admin = createSupabaseAdminClient();
  const emailSettings = await loadEmailSettings(admin, orgId);
  const rendered = renderEmail(
    {
      subject: msg.subject,
      design: { body: msg.body, button_label: "Open the pay page", button_url: link.url, footer_text: `Sent by ${access.organization.name}. Reply to this email if you have any questions.` },
    },
    { business_name: access.organization.name },
    { siteUrl: siteUrl() },
  );
  const outcome = await deliverAndLog(admin, { organizationId: orgId, kind: "fee_reminder", candidateId: plan.candidate_id, createdBy: access.userId }, to, rendered, {
    replyTo: normalizeAddress(emailSettings.replyTo) ?? normalizeAddress(access.email),
    senderName: emailSettings.senderName ?? access.organization.name,
  });
  const { error } = await supabase.rpc("log_fee_reminder", { p_plan: plan.id, p_channel: "email", p_status: outcome.status, p_installment: next?.id ?? undefined });
  if (error) console.error(JSON.stringify({ level: "error", msg: "pay link share log failed", code: error.code }));
  revalidatePath(`/admin/finance/fees/${plan.enrollment_id}`);
  revalidatePath(`/admin/candidates/${plan.candidate_id}`);
  if (outcome.status === "sent") return { ok: true, url: link.url, message: "Pay link emailed." };
  if (outcome.status === "not_sent") return { ok: false, url: link.url, message: "No email provider is set up, so nothing was sent. Copy the link or use WhatsApp instead." };
  return { ok: false, url: link.url, message: `The email could not be sent: ${outcome.error ?? "unknown error"}` };
}

/** Returns the live pay link, making one (next installment) when there is none. */
export async function ensurePayLink(feePlanId: string): Promise<UpiActionResult> {
  const access = await assertPermission(MANAGE);
  if (!z.guid().safeParse(feePlanId).success) return { ok: false, message: "That fee plan could not be found." };
  const supabase = await createSupabaseServerClient();
  const plan = await planOf(supabase, access.organization.id, feePlanId);
  if (!plan) return { ok: false, message: "That fee plan could not be found." };
  const live = (await getActivePayLinks(supabase, access.organization.id, [plan.id])).get(plan.id);
  if (live) return { ok: true, url: live.url, message: "Pay link ready to copy." };
  const res = await makePayLink(supabase, access, plan.id, "next_installment");
  if ("error" in res) return { ok: false, message: res.error };
  revalidatePath(`/admin/finance/fees/${plan.enrollment_id}`);
  return { ok: true, url: res.url, message: "Pay link made for the next installment. Copy it below." };
}

/* -------------------------------------------------------------------------- */
/* Verifying "I've paid" reports                                               */
/* -------------------------------------------------------------------------- */

async function revalidateSubmission(supabase: Supabase, planId: string | null) {
  revalidatePath("/admin/finance", "layout");
  if (!planId) return;
  const { data } = await supabase.from("fee_plans").select("enrollment_id, candidate_id").eq("id", planId).maybeSingle();
  if (data) {
    revalidatePath(`/admin/finance/fees/${data.enrollment_id}`);
    revalidatePath(`/admin/candidates/${data.candidate_id}`);
  }
}

/** Approve: records the payment (with receipt) and, when switched on, emails the candidate. */
export async function approveSubmission(input: unknown): Promise<UpiActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data: sub } = await supabase.from("payment_submissions").select("id, fee_plan_id, utr").eq("id", parsed.data.id).eq("organization_id", access.organization.id).maybeSingle();
  if (!sub) return { ok: false, message: "That payment report could not be found. Refresh the page." };
  const { data, error } = await supabase.rpc("approve_payment_submission", {
    p_submission: sub.id,
    p_amount: parsed.data.amount !== null ? fromPaise(parsed.data.amount) : undefined,
  });
  if (error || !data) return { ok: false, message: dbMessage(error, "Could not approve the payment. Please try again.") };
  const result = data as { payment_id: string; receipt_number: string | null };
  await revalidateSubmission(supabase, sub.fee_plan_id);
  const emailNote = await sendConfirmation(supabase, access, result.payment_id, sub.utr);
  return { ok: true, id: result.payment_id, message: `Approved. Payment recorded with receipt ${result.receipt_number ?? "(pending)"}.${emailNote}` };
}

async function sendConfirmation(supabase: Supabase, access: Access, paymentId: string, utr: string): Promise<string> {
  try {
    const orgId = access.organization.id;
    const settings = await getPaymentSettings(supabase, orgId);
    if (!settings?.confirmEmailEnabled) return "";
    const { data: pay } = await supabase
      .from("payments")
      .select("amount, currency, receipt_number, fee_plan_id, candidate_id, candidates(full_name, email, do_not_contact), fee_plans(courses(title))")
      .eq("id", paymentId)
      .maybeSingle();
    const cand = pay ? (Array.isArray(pay.candidates) ? pay.candidates[0] : pay.candidates) : null;
    const to = normalizeAddress(cand?.email);
    if (!pay || !cand || !to || cand.do_not_contact) return " No confirmation email was sent (no email address, or do not contact).";
    const fp = Array.isArray(pay.fee_plans) ? pay.fee_plans[0] : pay.fee_plans;
    const course = fp ? (Array.isArray(fp.courses) ? fp.courses[0] : fp.courses) : null;
    const outstanding = (await getBalances(supabase, orgId, [pay.fee_plan_id])).get(pay.fee_plan_id)?.outstanding ?? 0;
    const vars = {
      first_name: cand.full_name.trim().split(/\s+/)[0] || "there",
      amount: formatPaise(toPaise(pay.amount), pay.currency),
      course: course?.title ?? "your course",
      receipt_number: pay.receipt_number ?? "",
      outstanding: formatPaise(outstanding, pay.currency),
      business_name: access.organization.name,
      utr,
    };
    const admin = createSupabaseAdminClient();
    const emailSettings = await loadEmailSettings(admin, orgId);
    const rendered = renderEmail(
      { subject: settings.confirmEmailSubject, design: { body: settings.confirmEmailBody, footer_text: `Sent by ${access.organization.name}.` } },
      vars,
      { siteUrl: siteUrl() },
    );
    const outcome = await deliverAndLog(admin, { organizationId: orgId, kind: "payment_confirmation", candidateId: pay.candidate_id, createdBy: access.userId }, to, rendered, {
      replyTo: normalizeAddress(emailSettings.replyTo) ?? normalizeAddress(access.email),
      senderName: emailSettings.senderName ?? access.organization.name,
      recordActivity: true,
    });
    if (outcome.status === "sent") return " Confirmation emailed to the candidate.";
    if (outcome.status === "not_sent") return " No email provider is set up, so no confirmation email was sent.";
    return " The confirmation email could not be sent.";
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "payment confirmation email failed", detail: e instanceof Error ? e.message.slice(0, 120) : "unknown" }));
    return " The confirmation email could not be sent.";
  }
}

export async function rejectSubmission(input: unknown): Promise<UpiActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return fix(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data: sub } = await supabase.from("payment_submissions").select("id, fee_plan_id").eq("id", parsed.data.id).eq("organization_id", access.organization.id).maybeSingle();
  if (!sub) return { ok: false, message: "That payment report could not be found. Refresh the page." };
  const { error } = await supabase.rpc("reject_payment_submission", { p_submission: sub.id, p_reason: parsed.data.reason });
  if (error) return { ok: false, message: dbMessage(error, "Could not reject the payment report.") };
  await revalidateSubmission(supabase, sub.fee_plan_id);
  return { ok: true, message: "Rejected. Nothing was recorded. Tell the candidate why if needed." };
}
