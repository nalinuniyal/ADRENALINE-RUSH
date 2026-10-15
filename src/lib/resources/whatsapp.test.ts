import { describe, expect, it } from "vitest";
import { normalizeWhatsappNumber, whatsappChatLink } from "@/lib/public-site";

describe("normalizeWhatsappNumber", () => {
  it.each([
    ["+91 98765 43210", "91", "919876543210"],
    ["9876543210", "91", "919876543210"],
    ["098765-43210", "91", "919876543210"],
    ["(98765) 43210", "91", "919876543210"],
    ["919876543210", "91", "919876543210"],
    ["0091 98765 43210", "91", "919876543210"],
    ["+44 7700 900123", "91", "447700900123"],
    ["07700 900123", "44", "447700900123"],
    ["202-555-0123", "1", "12025550123"],
    ["+1 202 555 0123 ext. 12", "91", "12025550123"],
  ])("%s with +%s → %s", (input, cc, digits) => {
    expect(normalizeWhatsappNumber(input, cc)).toEqual({ ok: true, digits });
  });

  it.each([[""], [null], ["   "], ["call me"], ["12345"], ["+0 123 456 789"], ["+1234567890123456"]])("rejects %s", (input) => {
    const r = normalizeWhatsappNumber(input as string | null, "91");
    expect(r.ok).toBe(false);
  });

  it("ignores an invalid default country code instead of guessing", () => {
    expect(normalizeWhatsappNumber("9876543210", "+91")).toEqual({ ok: true, digits: "9876543210" });
  });
});

describe("whatsappChatLink", () => {
  it("builds a wa.me link with the encoded message", () => {
    const r = whatsappChatLink("98765 43210", "Hi Asha,\nDemo: https://x.example/r/a?b=1&c=2", "91");
    expect(r).toEqual({
      ok: true,
      digits: "919876543210",
      url: "https://wa.me/919876543210?text=Hi%20Asha%2C%0ADemo%3A%20https%3A%2F%2Fx.example%2Fr%2Fa%3Fb%3D1%26c%3D2",
    });
  });

  it("explains a missing number", () => {
    expect(whatsappChatLink(null, "Hi")).toEqual({ ok: false, reason: "No phone number saved for this candidate." });
  });
});
