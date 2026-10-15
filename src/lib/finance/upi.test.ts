import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hashPayToken, isWellFormedPayToken, newPayLinkSeed, payLinkToken, payLinkUrl } from "./pay-link-token";
import { parsePayPage, parsePaymentDetails } from "./pay-page";
import { buildReminderMessage, buildPayLinkMessage } from "./reminder";
import { buildUpiLink, fillPlaceholders, isValidAccountNumber, isValidIfsc, isValidUtr, isValidVpa, maskAccountNumber, normalizeUtr, UPI_NOTE_MAX, upiAmount, upiNote } from "./upi";
import { qrDataUrl, qrSvg } from "./upi-qr";
import { paymentDetailsSchema, paymentProofSchema } from "@/lib/validation/payment-details";

describe("UPI ID, IFSC, account number and UTR validation", () => {
  it("accepts common UPI IDs and rejects malformed ones", () => {
    for (const ok of ["asha.example@okhdfcbank", "9876543210@ybl", "Test_Academy@PAYTM", " shop-1@upi "]) expect(isValidVpa(ok)).toBe(true);
    for (const bad of ["", "no-at-sign", "a@b", "@okaxis", "name@", "name@ok axis", "name@@ybl", "name@1bank", "x@ybl"]) expect(isValidVpa(bad)).toBe(false);
  });

  it("validates IFSC with the zero in the 5th place", () => {
    expect(isValidIfsc("HDFC0001234")).toBe(true);
    expect(isValidIfsc(" sbin0012345 ")).toBe(true);
    expect(isValidIfsc("HDFC1001234")).toBe(false);
    expect(isValidIfsc("HDF00001234")).toBe(false);
    expect(isValidIfsc("HDFC000123")).toBe(false);
  });

  it("validates account numbers (9–18 digits, spaces ignored) and UTRs", () => {
    expect(isValidAccountNumber("1234 5678 9012")).toBe(true);
    expect(isValidAccountNumber("12345678")).toBe(false);
    expect(isValidAccountNumber("1234567890123456789")).toBe(false);
    expect(isValidAccountNumber("12345678901A")).toBe(false);
    expect(normalizeUtr(" 4123-4567 8901 ")).toBe("412345678901");
    expect(isValidUtr("412345678901")).toBe(true);
    expect(isValidUtr("HDFCN52026101512345678")).toBe(true);
    expect(isValidUtr("12345")).toBe(false);
    expect(isValidUtr("4123/45678901")).toBe(false);
  });

  it("masks account numbers", () => {
    expect(maskAccountNumber("123456789012")).toBe("•••• 9012");
    expect(maskAccountNumber("1234")).toBe("••••");
    expect(maskAccountNumber(null)).toBe("");
  });
});

describe("UPI deep link", () => {
  it("builds upi://pay with encoded payee, 2-decimal amount, INR and note", () => {
    const link = buildUpiLink({ vpa: "Asha.Example@OkHdfcBank", payeeName: "Test & Co Academy", amountPaise: 500050, note: "Data Course FEE-1A2B3C4D" });
    expect(link).toBe("upi://pay?pa=asha.example@okhdfcbank&pn=Test%20%26%20Co%20Academy&am=5000.50&cu=INR&tn=Data%20Course%20FEE-1A2B3C4D");
    const u = new URL(link);
    expect(u.searchParams.get("pn")).toBe("Test & Co Academy");
    expect(u.searchParams.get("am")).toBe("5000.50");
  });

  it("omits the amount for an open-amount link and strips unsafe characters", () => {
    const link = buildUpiLink({ vpa: "shop@ybl", payeeName: "A=B?C#D", note: "x&am=1" });
    expect(link).not.toContain("am=");
    const u = new URL(link);
    expect(u.searchParams.get("pa")).toBe("shop@ybl");
    expect(u.searchParams.get("pn")).toBe("A B C D");
    // "&" and "=" cannot start a new parameter: the note stays one value.
    expect(u.searchParams.get("tn")).toBe("x&am 1");
    expect([...u.searchParams.keys()].filter((k) => k === "am")).toHaveLength(0);
  });

  it("formats amounts with exactly two decimals and rejects non-positive ones", () => {
    expect(upiAmount(100)).toBe("1.00");
    expect(upiAmount(4999905)).toBe("49999.05");
    expect(() => upiAmount(0)).toThrow();
    expect(() => upiAmount(10.5)).toThrow();
  });

  it("keeps the note short, with the reference intact", () => {
    const note = upiNote("A very long course title about data science and machine learning for working professionals", "FEE-1A2B3C4D");
    expect(note.length).toBeLessThanOrEqual(UPI_NOTE_MAX);
    expect(note.endsWith(" FEE-1A2B3C4D")).toBe(true);
    expect(upiNote(null, "FEE-1A2B3C4D")).toBe("FEE-1A2B3C4D");
  });

  it("refuses an invalid UPI ID", () => {
    expect(() => buildUpiLink({ vpa: "not-a-vpa" })).toThrow();
  });
});

describe("QR code", () => {
  it("renders an SVG (and a data URL) for a UPI link", async () => {
    const link = buildUpiLink({ vpa: "shop@ybl", payeeName: "Shop", amountPaise: 100000, note: "Fee" });
    const svg = await qrSvg(link);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg).not.toMatch(/<script/i);
    expect(await qrDataUrl(link)).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

describe("pay link tokens", () => {
  const secret = "s".repeat(40);
  it("re-creates the same 43-character token from id and nonce, and only its hash is stored", () => {
    const { id, nonce } = newPayLinkSeed();
    const t1 = payLinkToken(secret, id, nonce);
    expect(t1).toBe(payLinkToken(secret, id, nonce));
    expect(isWellFormedPayToken(t1)).toBe(true);
    expect(hashPayToken(t1)).toMatch(/^[0-9a-f]{64}$/);
    expect(payLinkToken(secret, id, newPayLinkSeed().nonce)).not.toBe(t1);
    expect(payLinkToken("t".repeat(40), id, nonce)).not.toBe(t1);
    expect(payLinkUrl("https://example.test/", t1)).toBe(`https://example.test/pay/${t1}`);
  });
  it("rejects malformed tokens and short secrets", () => {
    expect(isWellFormedPayToken("abc")).toBe(false);
    expect(isWellFormedPayToken("../" + "a".repeat(40))).toBe(false);
    expect(() => payLinkToken("short", "id", "nonce")).toThrow();
  });
});

describe("payment details form", () => {
  const base = {
    upiVpa: "",
    upiPayeeName: "",
    bankAccountHolder: "",
    bankAccountNumber: "",
    keepAccountNumber: false,
    bankIfsc: "",
    bankName: "",
    bankBranch: "",
    bankAccountType: "",
    instructions: "",
    showOnPayPage: true,
    showInReminders: true,
    showOnCoursePages: false,
    confirmEmailEnabled: true,
    confirmEmailSubject: "Payment received",
    confirmEmailBody: "Thanks {{first_name}}",
  };
  it("normalises valid input", () => {
    const r = paymentDetailsSchema.parse({ ...base, upiVpa: " Test@YBL ", upiPayeeName: "Test Academy", bankAccountHolder: "Test Academy", bankAccountNumber: "1234 5678 9012", bankIfsc: "hdfc0001234", bankAccountType: "current" });
    expect(r).toMatchObject({ upiVpa: "test@ybl", bankAccountNumber: "123456789012", bankIfsc: "HDFC0001234", bankAccountType: "current", bankName: null });
  });
  it("reports bad formats and incomplete bank details", () => {
    const r = paymentDetailsSchema.safeParse({ ...base, upiVpa: "bad", bankIfsc: "HDFC1001234" });
    expect(r.success).toBe(false);
    const f = r.success ? {} : r.error.flatten().fieldErrors;
    expect(f.upiVpa).toBeTruthy();
    expect(f.bankIfsc).toBeTruthy();
    const r2 = paymentDetailsSchema.safeParse({ ...base, bankIfsc: "HDFC0001234" });
    expect(r2.success ? {} : r2.error.flatten().fieldErrors).toMatchObject({ bankAccountNumber: expect.any(Array), bankAccountHolder: expect.any(Array) });
    // Keeping a saved number satisfies the "account number" requirement.
    expect(paymentDetailsSchema.safeParse({ ...base, bankIfsc: "HDFC0001234", bankAccountHolder: "X", keepAccountNumber: true }).success).toBe(true);
    // A UPI ID needs the payee name.
    expect(paymentDetailsSchema.safeParse({ ...base, upiVpa: "a.b@ybl" }).success).toBe(false);
  });
  it("parses the candidate's proof form", () => {
    expect(paymentProofSchema.parse({ utr: "4123 4567 8901", amount: "5,000.50", paidOn: "2026-10-14", method: "upi", note: "" })).toEqual({
      utr: "412345678901",
      amount: 500050,
      paidOn: "2026-10-14",
      method: "upi",
      note: null,
    });
    expect(paymentProofSchema.safeParse({ utr: "12", amount: "0", paidOn: "2026-02-30", method: "cash" }).success).toBe(false);
  });
});

describe("messages and parsing", () => {
  it("adds the pay page and UPI ID to reminders", () => {
    const m = buildReminderMessage({ candidateName: "Asha Example", businessName: "Test Academy", courseTitle: "Course", installmentLabel: null, duePaise: 100000, dueDate: null, outstandingPaise: 100000, currency: "INR", today: "2026-10-15", payPageUrl: "https://example.test/pay/x", upiId: "shop@ybl" });
    expect(m.body).toContain("https://example.test/pay/x");
    expect(m.body).not.toContain("Please reply");
    const m2 = buildReminderMessage({ candidateName: "Asha", businessName: "T", courseTitle: "C", installmentLabel: null, duePaise: 1, dueDate: null, outstandingPaise: 1, currency: "INR", today: "2026-10-15", upiId: "shop@ybl" });
    expect(m2.body).toContain("You can pay by UPI to shop@ybl.");
  });
  it("builds the pay link message", () => {
    const m = buildPayLinkMessage({ candidateName: "Asha Example", businessName: "Test Academy", courseTitle: "Course", label: "Installment 2", amountPaise: 500000, currency: "INR", url: "https://example.test/pay/x", upiId: null });
    expect(m.body).toContain("Hi Asha,");
    expect(m.body).toContain("Installment 2 (₹5,000)");
    expect(m.body).toContain("https://example.test/pay/x");
  });
  it("fills placeholders and leaves unknown ones", () => {
    expect(fillPlaceholders("Hi {{first_name}}, {{ amount }} {{unknown}}", { first_name: "Asha", amount: "₹1" })).toBe("Hi Asha, ₹1 {{unknown}}");
  });
  it("parses pay page data defensively", () => {
    expect(parsePayPage(null)).toEqual({ status: "error", businessName: null });
    expect(parsePayPage({ status: "revoked", business_name: "T" })).toEqual({ status: "revoked", businessName: "T" });
    const p = parsePayPage({ status: "ok", business_name: "T", course_title: "C", currency: "INR", amount_due: 5000.5, outstanding: "15000.00", reference: "FEE-1", bank: { account_number: "123456789012", ifsc: "HDFC0001234" }, upi_vpa: "a@ybl", details_shown: true });
    expect(p).toMatchObject({ status: "ok", amountDue: 500050, outstanding: 1500000, upiVpa: "a@ybl", bank: { accountNumber: "123456789012" } });
    expect(parsePaymentDetails({ instructions: "x" })).toBeNull();
  });
});
