import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  cancelPaymentLink,
  createPaymentLink,
  parseWebhookEvent,
  paymentLinkBody,
  razorpayConfig,
  razorpayContact,
  RazorpayError,
  razorpayStatus,
  verifyWebhookSignature,
  type FetchLike,
} from "./razorpay";

// Synthetic test credentials only; nothing here is a real key.
const cfg = { keyId: "rzp_test_SyntheticKey01", keySecret: "synthetic-secret", webhookSecret: "synthetic-webhook-secret", mode: "test" as const };
const input = {
  amountPaise: 1250050,
  currency: "INR",
  referenceId: "0b8f6a52-0c55-4c7f-9a52-3d0b6c1e9a10",
  description: "Course fee · installment 2",
  customer: { name: "Asha Example", email: "asha@example.test", contact: "+919000090000" },
  callbackUrl: "https://academy.example.test/pay/thank-you",
  notes: { fee_plan_id: "plan-1" },
};

type Call = { url: string; init: RequestInit };
function stub(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sign = (body: string, secret = cfg.webhookSecret) => createHmac("sha256", secret).update(body).digest("hex");

describe("configuration", () => {
  it("needs a key id and secret; the key id prefix tells test from live", () => {
    expect(razorpayConfig({})).toBeNull();
    expect(razorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_abc" })).toBeNull();
    expect(razorpayConfig({ RAZORPAY_KEY_ID: "not_a_key", RAZORPAY_KEY_SECRET: "x" })).toBeNull();
    expect(razorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "s" })).toMatchObject({ mode: "test", webhookSecret: null });
    expect(razorpayConfig({ RAZORPAY_KEY_ID: "rzp_live_abc", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w" })).toMatchObject({ mode: "live", webhookSecret: "w" });
  });

  it("reports status for Settings without exposing secrets", () => {
    const s = razorpayStatus({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "top-secret" });
    expect(s).toEqual({ configured: true, mode: "test", keyId: "rzp_test_abc", webhookSecretSet: false, problem: null });
    expect(JSON.stringify(s)).not.toContain("top-secret");
    expect(razorpayStatus({ RAZORPAY_KEY_ID: "wrong" }).problem).toMatch(/rzp_test_/);
    expect(razorpayStatus({}).problem).toBeNull();
  });

  it("formats contacts with a leading +", () => {
    expect(razorpayContact("919000090000")).toBe("+919000090000");
    expect(razorpayContact("12")).toBeNull();
    expect(razorpayContact(null)).toBeNull();
  });
});

describe("payment links", () => {
  it("creates a link with basic auth, amount in paise, our reference id and no Razorpay notifications", async () => {
    const { fn, calls } = stub(json({ id: "plink_Synthetic001", short_url: "https://rzp.io/i/abc123", status: "created" }));
    const link = await createPaymentLink(cfg, input, fn);
    expect(link).toEqual({ id: "plink_Synthetic001", shortUrl: "https://rzp.io/i/abc123", status: "created" });
    expect(calls[0].url).toBe("https://api.razorpay.com/v1/payment_links");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("rzp_test_SyntheticKey01:synthetic-secret").toString("base64")}`);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      amount: 1250050,
      currency: "INR",
      accept_partial: false,
      reference_id: input.referenceId,
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: input.callbackUrl,
      callback_method: "get",
      customer: { name: "Asha Example", email: "asha@example.test", contact: "+919000090000" },
      notes: { fee_plan_id: "plan-1" },
    });
  });

  it("refuses amounts under 1.00 and leaves out empty customer fields", () => {
    expect(() => paymentLinkBody({ ...input, amountPaise: 99 })).toThrow(RazorpayError);
    expect(() => paymentLinkBody({ ...input, amountPaise: 100.5 })).toThrow(RazorpayError);
    expect(paymentLinkBody({ ...input, customer: { name: "Bala", email: null, contact: null } }).customer).toEqual({ name: "Bala" });
  });

  it("turns Razorpay errors into readable messages without secrets", async () => {
    const bad = stub(json({ error: { code: "BAD_REQUEST_ERROR", description: "reference_id already exists" } }, 400));
    await expect(createPaymentLink(cfg, input, bad.fn)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST_ERROR", message: "Razorpay could not create the link: reference_id already exists" });
    const auth = stub(json({ error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } }, 401));
    const err = (await createPaymentLink(cfg, input, auth.fn).catch((e: RazorpayError) => e)) as RazorpayError;
    expect(err.message).toMatch(/rejected the API keys/);
    expect(err.message).not.toContain("synthetic-secret");
    const down = stub(new Error("ECONNREFUSED"));
    await expect(createPaymentLink(cfg, input, down.fn)).rejects.toMatchObject({ status: 0, code: "network" });
    const timeout = stub(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    await expect(createPaymentLink(cfg, input, timeout.fn)).rejects.toThrow(/did not answer in time/);
    const html = stub(new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    await expect(createPaymentLink(cfg, input, html.fn)).rejects.toThrow(/Bad Gateway/);
    const empty = stub(json({ status: "created" }));
    await expect(createPaymentLink(cfg, input, empty.fn)).rejects.toThrow(/without a payment link/);
  });

  it("cancels a link", async () => {
    const { fn, calls } = stub(json({ id: "plink_Synthetic001", status: "cancelled" }));
    await cancelPaymentLink(cfg, "plink_Synthetic001", fn);
    expect(calls[0].url).toBe("https://api.razorpay.com/v1/payment_links/plink_Synthetic001/cancel");
    await expect(cancelPaymentLink(cfg, "../../payments", fn)).rejects.toThrow(/Unknown payment link/);
  });
});

describe("webhooks", () => {
  const paid = JSON.stringify({
    entity: "event",
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: "plink_Synthetic001", status: "paid", amount: 1250050, amount_paid: 1250050, reference_id: input.referenceId } },
      payment: { entity: { id: "pay_Synthetic001", amount: 1250050, currency: "INR", status: "captured", method: "upi", created_at: 1_791_000_000 } },
      order: { entity: { id: "order_Synthetic001" } },
    },
    created_at: 1_791_000_005,
  });

  it("verifies the HMAC-SHA256 signature of the raw body", () => {
    expect(verifyWebhookSignature(paid, sign(paid), cfg.webhookSecret)).toBe(true);
    expect(verifyWebhookSignature(paid, sign(paid).toUpperCase(), cfg.webhookSecret)).toBe(true);
    expect(verifyWebhookSignature(paid + " ", sign(paid), cfg.webhookSecret)).toBe(false);
    expect(verifyWebhookSignature(paid, sign(paid, "other-secret"), cfg.webhookSecret)).toBe(false);
    expect(verifyWebhookSignature(paid, null, cfg.webhookSecret)).toBe(false);
    expect(verifyWebhookSignature(paid, "abc", cfg.webhookSecret)).toBe(false);
    expect(verifyWebhookSignature(paid, sign(paid), "")).toBe(false);
  });

  it("extracts the paid link, Razorpay payment id and amount from the signed payload", () => {
    expect(parseWebhookEvent(paid)).toEqual({
      kind: "link_paid",
      event: "payment_link.paid",
      linkId: "plink_Synthetic001",
      linkStatus: "paid",
      paymentId: "pay_Synthetic001",
      amountPaise: 1250050,
      currency: "INR",
      paidAt: new Date(1_791_000_000 * 1000).toISOString(),
    });
  });

  it("ignores malformed, uncaptured and unrelated events", () => {
    expect(parseWebhookEvent("not json")).toEqual({ kind: "ignored", event: "invalid_json" });
    const uncaptured = paid.replace('"captured"', '"authorized"');
    expect(parseWebhookEvent(uncaptured).kind).toBe("ignored");
    const fractional = paid.replaceAll("1250050", "1250.5");
    expect(parseWebhookEvent(fractional).kind).toBe("ignored");
    expect(parseWebhookEvent(JSON.stringify({ event: "payment.captured", payload: {} }))).toEqual({ kind: "ignored", event: "payment.captured" });
    expect(parseWebhookEvent(JSON.stringify({ event: "payment_link.expired", payload: { payment_link: { entity: { id: "plink_Synthetic001" } } } }))).toEqual({
      kind: "link_closed",
      event: "payment_link.expired",
      linkId: "plink_Synthetic001",
      linkStatus: "expired",
    });
  });
});
