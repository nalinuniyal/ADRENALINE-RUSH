import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "RESEND_API_KEY", "EMAIL_FROM"];
const saved: Record<string, string | undefined> = {};
const msg = { to: "someone@example.test", subject: "S", html: "<p>h</p>", text: "h" };

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sendEmail", () => {
  it("never pretends: no provider means not_sent", async () => {
    const { sendEmail, NO_PROVIDER } = await import("./send");
    expect(await sendEmail(msg)).toEqual({ status: "not_sent", provider: null, messageId: null, error: NO_PROVIDER });
  });

  it("sends through Resend and records the message id", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "msg_123" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendEmail } = await import("./send");
    const out = await sendEmail({ ...msg, senderName: "Academy" });
    expect(out).toEqual({ status: "sent", provider: "resend", messageId: "msg_123", error: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: '"Academy" <onboarding@resend.dev>', to: ["someone@example.test"] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("captures provider errors without addresses and never logs them", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "You can only send to owner@example.test" }), { status: 403 })));
    const { sendEmail } = await import("./send");
    const out = await sendEmail(msg);
    expect(out.status).toBe("failed");
    expect(out.error).toBe("Resend 403: You can only send to [address]");
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain("@");
  });

  it("prefers SMTP when fully configured and reports partial SMTP", async () => {
    const { emailConfig, emailProviderStatus } = await import("./config");
    process.env.SMTP_HOST = "smtp.gmail.com";
    expect(emailProviderStatus()).toMatchObject({ active: null, note: expect.stringContaining("partly configured") });
    process.env.SMTP_USER = "me@gmail.test";
    process.env.SMTP_PASSWORD = "app-password";
    process.env.RESEND_API_KEY = "re_x";
    expect(emailConfig()).toMatchObject({ provider: "smtp", port: 465, secure: true, from: "me@gmail.test" });
    const status = emailProviderStatus();
    expect(status.active).toBe("smtp");
    expect(JSON.stringify(status)).not.toContain("app-password");
  });
});
