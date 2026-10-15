import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal Razorpay client for Payment Links and webhooks. Every network call
 * takes an injectable `fetch`, so it is unit-tested with stubbed responses.
 * Docs: https://razorpay.com/docs/api/payments/payment-links/create-standard
 *       https://razorpay.com/docs/webhooks/validate-test
 * The key secret and webhook secret never leave the server.
 */

export const RAZORPAY_API = "https://api.razorpay.com/v1";
export const REQUEST_TIMEOUT_MS = 10_000;
/** Webhook bodies are small JSON documents; anything bigger is rejected unread. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type RazorpayConfig = { keyId: string; keySecret: string; webhookSecret: string | null; mode: "test" | "live" };

/** Reads RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET; null when not set up. */
export function razorpayConfig(env: Record<string, string | undefined> = process.env): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret || !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) return null;
  return {
    keyId,
    keySecret,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET?.trim() || null,
    mode: keyId.startsWith("rzp_live_") ? "live" : "test",
  };
}

export type RazorpayStatus = {
  configured: boolean;
  mode: "test" | "live" | null;
  /** Key id is not secret; shown so the owner can check which account is used. */
  keyId: string | null;
  webhookSecretSet: boolean;
  /** Something is set but not usable (e.g. a key id with the wrong format). */
  problem: string | null;
};

export function razorpayStatus(env: Record<string, string | undefined> = process.env): RazorpayStatus {
  const cfg = razorpayConfig(env);
  if (cfg) return { configured: true, mode: cfg.mode, keyId: cfg.keyId, webhookSecretSet: Boolean(cfg.webhookSecret), problem: null };
  const anySet = Boolean(env.RAZORPAY_KEY_ID?.trim() || env.RAZORPAY_KEY_SECRET?.trim());
  return {
    configured: false,
    mode: null,
    keyId: null,
    webhookSecretSet: Boolean(env.RAZORPAY_WEBHOOK_SECRET?.trim()),
    problem: anySet ? "RAZORPAY_KEY_ID must start with rzp_test_ or rzp_live_, and RAZORPAY_KEY_SECRET must be set too." : null,
  };
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

async function call(fetchImpl: FetchLike, cfg: RazorpayConfig, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(`${RAZORPAY_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new RazorpayError(timedOut ? "Razorpay did not answer in time. Try again." : "Could not reach Razorpay. Check the internet connection and try again.", 0, "network");
  }
  let body: Record<string, unknown> = {};
  try {
    const v: unknown = await res.json();
    if (v && typeof v === "object") body = v as Record<string, unknown>;
  } catch {
    // Non-JSON answer: handled below.
  }
  if (!res.ok) {
    const err = (body.error && typeof body.error === "object" ? body.error : {}) as { code?: unknown; description?: unknown };
    const description = typeof err.description === "string" ? err.description : res.statusText || "Unknown error";
    const message =
      res.status === 401
        ? "Razorpay rejected the API keys. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET."
        : `Razorpay could not create the link: ${description}`.slice(0, 300);
    throw new RazorpayError(message, res.status, typeof err.code === "string" ? err.code : null);
  }
  return body;
}

export type PaymentLinkInput = {
  amountPaise: number;
  currency: string;
  /** Our payment_links row id: unique per link, so a retried request cannot create a second link. */
  referenceId: string;
  description: string;
  customer: { name: string; email?: string | null; contact?: string | null };
  callbackUrl: string;
  notes?: Record<string, string>;
  /** Unix seconds; Razorpay requires at least 15 minutes in the future. */
  expireBy?: number | null;
};

export type PaymentLink = { id: string; shortUrl: string; status: string };

export function paymentLinkBody(input: PaymentLinkInput) {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) throw new RazorpayError("The amount must be at least 1.00.", 400, "amount");
  const customer: Record<string, string> = { name: input.customer.name.slice(0, 100) };
  if (input.customer.email) customer.email = input.customer.email;
  if (input.customer.contact) customer.contact = input.customer.contact;
  return {
    amount: input.amountPaise,
    currency: input.currency,
    accept_partial: false,
    reference_id: input.referenceId.slice(0, 40),
    description: input.description.slice(0, 2048),
    customer,
    // We share the link ourselves (WhatsApp / email), so Razorpay sends nothing.
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: input.notes ?? {},
    callback_url: input.callbackUrl,
    callback_method: "get",
    ...(input.expireBy ? { expire_by: input.expireBy } : {}),
  };
}

export async function createPaymentLink(cfg: RazorpayConfig, input: PaymentLinkInput, fetchImpl: FetchLike = fetch): Promise<PaymentLink> {
  const body = await call(fetchImpl, cfg, "/payment_links", { method: "POST", body: JSON.stringify(paymentLinkBody(input)) });
  const id = typeof body.id === "string" ? body.id : "";
  const shortUrl = typeof body.short_url === "string" ? body.short_url : "";
  if (!/^plink_[A-Za-z0-9]+$/.test(id) || !/^https:\/\//.test(shortUrl)) throw new RazorpayError("Razorpay answered without a payment link.", 502, "bad_response");
  return { id, shortUrl, status: typeof body.status === "string" ? body.status : "created" };
}

export async function cancelPaymentLink(cfg: RazorpayConfig, linkId: string, fetchImpl: FetchLike = fetch): Promise<void> {
  if (!/^plink_[A-Za-z0-9]+$/.test(linkId)) throw new RazorpayError("Unknown payment link.", 400, "id");
  await call(fetchImpl, cfg, `/payment_links/${linkId}/cancel`, { method: "POST", body: "{}" });
}

/** "+919876543210" style contact for Razorpay from WhatsApp-style digits. */
export function razorpayContact(digits: string | null | undefined): string | null {
  return digits && /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}

/* -------------------------------------------------------------------------- */
/* Webhooks                                                                    */
/* -------------------------------------------------------------------------- */

/** HMAC-SHA256 of the raw body with the webhook secret, compared in constant time. */
export function verifyWebhookSignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !secret || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type WebhookEvent =
  | { kind: "link_paid"; event: string; linkId: string; linkStatus: "paid" | "partially_paid"; paymentId: string; amountPaise: number; currency: string; paidAt: string | null }
  | { kind: "link_closed"; event: string; linkId: string; linkStatus: "expired" | "cancelled" }
  | { kind: "ignored"; event: string };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Extracts what we use from a verified webhook body. Unknown or malformed events are "ignored". */
export function parseWebhookEvent(rawBody: string): WebhookEvent {
  let root: Record<string, unknown>;
  try {
    root = obj(JSON.parse(rawBody));
  } catch {
    return { kind: "ignored", event: "invalid_json" };
  }
  const event = typeof root.event === "string" ? root.event.slice(0, 60) : "unknown";
  const payload = obj(root.payload);
  const link = obj(obj(payload.payment_link).entity);
  const linkId = typeof link.id === "string" && /^plink_[A-Za-z0-9]+$/.test(link.id) ? link.id : null;

  if (event === "payment_link.paid" || event === "payment_link.partially_paid") {
    const pay = obj(obj(payload.payment).entity);
    const paymentId = typeof pay.id === "string" && /^pay_[A-Za-z0-9]+$/.test(pay.id) ? pay.id : null;
    const amount = pay.amount;
    const currency = typeof pay.currency === "string" && /^[A-Z]{3}$/.test(pay.currency) ? pay.currency : null;
    const captured = pay.status === "captured" || pay.captured === true;
    if (!linkId || !paymentId || !currency || !captured || typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
      return { kind: "ignored", event };
    }
    const createdAt = typeof pay.created_at === "number" ? new Date(pay.created_at * 1000).toISOString() : null;
    return {
      kind: "link_paid",
      event,
      linkId,
      linkStatus: event === "payment_link.paid" ? "paid" : "partially_paid",
      paymentId,
      amountPaise: amount,
      currency,
      paidAt: createdAt,
    };
  }
  if ((event === "payment_link.expired" || event === "payment_link.cancelled") && linkId) {
    return { kind: "link_closed", event, linkId, linkStatus: event === "payment_link.expired" ? "expired" : "cancelled" };
  }
  return { kind: "ignored", event };
}
