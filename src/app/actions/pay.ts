"use server";

import { fromPaise } from "@/lib/finance/money";
import { hashPayToken, isWellFormedPayToken } from "@/lib/finance/pay-link-token";
import { sniffImage } from "@/lib/email/image";
import { checkRateLimit, clientIp, DB_UNAVAILABLE_MESSAGE, type RateLimitRule } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { paymentProofSchema } from "@/lib/validation/payment-details";

export type PayProofResult = { ok: boolean; message?: string; fieldErrors?: Record<string, string[] | undefined> };

const SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
const PROOF_PER_IP: RateLimitRule = { namespace: "pay-proof-ip", limit: 10, windowSeconds: 60 * 60 };
const PROOF_PER_TOKEN: RateLimitRule = { namespace: "pay-proof-token", limit: 6, windowSeconds: 60 * 60 };

const RESULT_MESSAGES: Record<string, string> = {
  not_found: "This payment link is not valid. Ask for a new one.",
  revoked: "This payment link has been switched off. Ask for a new one.",
  closed: "This enrollment is closed, so payments are no longer taken here. Please contact us.",
  paid: "Nothing is due on this fee any more. Thank you!",
  invalid_amount: "Check the amount: it must be more than zero and not more than what is still payable.",
  invalid_date: "Choose the date you paid (within the last 90 days).",
  invalid_utr: "Enter the UTR or UPI reference number exactly as shown in your app.",
  invalid_method: "Choose how you paid.",
  invalid_screenshot: "The screenshot must be a PNG, JPG or WebP image of up to 2 MB.",
  duplicate_utr: "This transaction reference has already been sent to us. If you paid again, use the new reference.",
  too_many: "We already have several payments from you waiting to be checked. Please wait until we confirm them.",
};

/**
 * Public "I've paid" form on /pay/<token>. Creates a PENDING report only; a
 * finance manager checks the bank/UPI statement and approves it.
 */
export async function submitPaymentProof(token: string, formData: FormData): Promise<PayProofResult> {
  if (!isWellFormedPayToken(token)) return { ok: false, message: RESULT_MESSAGES.not_found };
  const tokenHash = hashPayToken(token);
  const [ipRate, tokenRate] = await Promise.all([checkRateLimit(PROOF_PER_IP, await clientIp()), checkRateLimit(PROOF_PER_TOKEN, tokenHash)]);
  if (ipRate === "unavailable" || tokenRate === "unavailable") return { ok: false, message: DB_UNAVAILABLE_MESSAGE };
  if (ipRate !== "ok" || tokenRate !== "ok") return { ok: false, message: "Too many attempts. Please wait an hour and try again, or contact us." };

  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const parsed = paymentProofSchema.safeParse({ utr: str("utr"), amount: str("amount"), paidOn: str("paidOn"), method: str("method"), note: str("note") });
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;

  let screenshot: string | null = null;
  let screenshotType: string | null = null;
  const file = formData.get("screenshot");
  if (file instanceof File && file.size > 0) {
    if (file.size > SCREENSHOT_MAX_BYTES) return { ok: false, message: RESULT_MESSAGES.invalid_screenshot, fieldErrors: { screenshot: ["Up to 2 MB"] } };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffImage(bytes);
    if (!sniffed || sniffed.contentType === "image/gif") return { ok: false, message: RESULT_MESSAGES.invalid_screenshot, fieldErrors: { screenshot: ["PNG, JPG or WebP only"] } };
    screenshot = `\\x${Buffer.from(bytes).toString("hex")}`;
    screenshotType = sniffed.contentType;
  }

  const { data, error } = await createSupabaseAdminClient().rpc("submit_fee_payment_proof", {
    p_token_hash: tokenHash,
    p_amount: fromPaise(v.amount),
    p_paid_on: v.paidOn,
    p_method: v.method,
    p_utr: v.utr,
    p_note: v.note ?? undefined,
    p_screenshot: screenshot ?? undefined,
    p_screenshot_type: screenshotType ?? undefined,
  });
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "payment proof submit failed", code: error.code }));
    return { ok: false, message: "We could not save this right now. Please try again in a minute." };
  }
  const result = (data as { result?: string } | null)?.result ?? "error";
  if (result === "ok") return { ok: true, message: "Thank you! We have your payment details and will confirm once we see the money in our account. You will get a receipt." };
  const field = result === "invalid_amount" ? "amount" : result === "invalid_date" ? "paidOn" : result === "invalid_utr" || result === "duplicate_utr" ? "utr" : null;
  const message = RESULT_MESSAGES[result] ?? "We could not save this right now. Please try again.";
  return { ok: false, message, fieldErrors: field ? { [field]: [message] } : undefined };
}
