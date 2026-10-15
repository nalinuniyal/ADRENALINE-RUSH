import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MAX_WEBHOOK_BYTES, parseWebhookEvent, razorpayConfig, verifyWebhookSignature } from "@/lib/finance/razorpay";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const log = (level: "info" | "error", msg: string, extra: Record<string, unknown> = {}) => console[level](JSON.stringify({ level, msg, ...extra }));

/**
 * Razorpay webhook (Dashboard → Webhooks → this URL, events payment_link.paid,
 * payment_link.expired, payment_link.cancelled). The signature over the raw
 * body is checked before anything is read; payments are recorded idempotently
 * by Razorpay payment id with the amount from Razorpay's signed payload.
 * Answers 2xx for anything handled or deliberately ignored, 5xx so Razorpay
 * retries when our database is unavailable.
 */
export async function POST(request: Request) {
  const cfg = razorpayConfig();
  if (!cfg?.webhookSecret) return json({ error: "Razorpay webhooks are not configured" }, 503);

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_WEBHOOK_BYTES) return json({ error: "Payload too large" }, 413);
  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return json({ error: "Payload too large" }, 413);
  if (!verifyWebhookSignature(raw, request.headers.get("x-razorpay-signature"), cfg.webhookSecret)) {
    log("error", "razorpay webhook signature mismatch");
    return json({ error: "Invalid signature" }, 400);
  }

  const event = parseWebhookEvent(raw);
  const eventId = (request.headers.get("x-razorpay-event-id") ?? "").slice(0, 64);
  const admin = createSupabaseAdminClient();

  if (event.kind === "link_paid") {
    const { data, error } = await admin.rpc("record_gateway_payment", {
      p_provider_link_id: event.linkId,
      p_gateway_payment_id: event.paymentId,
      p_amount_paise: event.amountPaise,
      p_currency: event.currency,
      p_paid_at: event.paidAt ?? new Date().toISOString(),
      p_link_status: event.linkStatus,
    });
    if (error) {
      log("error", "razorpay payment record failed", { code: error.code, eventId });
      return json({ error: "Could not record the payment" }, 500);
    }
    const result = (data as { result?: string } | null)?.result ?? "unknown";
    log("info", "razorpay webhook handled", { event: event.event, result, eventId });
    return json({ ok: true, result });
  }

  if (event.kind === "link_closed") {
    const { error } = await admin.from("payment_links").update({ status: event.linkStatus }).eq("provider_link_id", event.linkId).eq("status", "created");
    if (error) {
      log("error", "razorpay link status update failed", { code: error.code, eventId });
      return json({ error: "Could not update the link" }, 500);
    }
    return json({ ok: true, result: event.linkStatus });
  }

  log("info", "razorpay webhook ignored", { event: event.event, eventId });
  return json({ ok: true, result: "ignored" });
}
