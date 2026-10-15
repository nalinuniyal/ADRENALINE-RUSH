import { describe, expect, it } from "vitest";
import { expenseSchema, feePlanSchema, parseFinanceFilters, paymentSchema, refundSchema, voidSchema } from "./finance";

const ID = "0b8f6a52-0c55-4c7f-9a52-3d0b6c1e9a10";

describe("fee plan validation", () => {
  it("computes the final fee in paise and checks the installment total", () => {
    const ok = feePlanSchema.parse({
      enrollmentId: ID,
      baseFee: "30000",
      discountType: "percent",
      discountValue: "10",
      discountReason: "Early bird",
      installments: [
        { dueDate: "2026-11-01", amount: "13500" },
        { dueDate: "2026-12-01", amount: "13500" },
      ],
    });
    expect(ok).toMatchObject({ currency: "INR", baseFee: 3000000, discountValue: 1000, discountPaise: 300000, finalPaise: 2700000 });
    const bad = feePlanSchema.safeParse({ enrollmentId: ID, baseFee: "30000", installments: [{ dueDate: "2026-11-01", amount: "10000" }] });
    expect(bad.success).toBe(false);
    expect(bad.error?.flatten().fieldErrors.installments).toEqual(["The installments must add up to the final fee"]);
  });

  it("needs a reason for discounts and refuses discounts above the fee or 100%", () => {
    const noReason = feePlanSchema.safeParse({ enrollmentId: ID, baseFee: "1000", discountType: "amount", discountValue: "100" });
    expect(noReason.error?.flatten().fieldErrors.discountReason).toBeTruthy();
    expect(feePlanSchema.safeParse({ enrollmentId: ID, baseFee: "1000", discountType: "amount", discountValue: "2000", discountReason: "x" }).success).toBe(false);
    expect(feePlanSchema.safeParse({ enrollmentId: ID, baseFee: "1000", discountType: "percent", discountValue: "101", discountReason: "x" }).success).toBe(false);
    expect(feePlanSchema.safeParse({ enrollmentId: ID, baseFee: "10.999" }).success).toBe(false);
    expect(feePlanSchema.parse({ enrollmentId: ID, baseFee: "0" }).finalPaise).toBe(0);
  });
});

describe("payment, refund and expense validation", () => {
  it("accepts manual payments only and converts amounts to paise", () => {
    expect(paymentSchema.parse({ feePlanId: ID, amount: "5000.5", paidOn: "2026-10-15", method: "upi" })).toMatchObject({ amount: 500050, status: "completed", installmentId: null });
    expect(paymentSchema.safeParse({ feePlanId: ID, amount: "5000", paidOn: "2026-10-15", method: "razorpay" }).success).toBe(false);
    expect(paymentSchema.safeParse({ feePlanId: ID, amount: "0", paidOn: "2026-10-15", method: "upi" }).success).toBe(false);
    expect(paymentSchema.safeParse({ feePlanId: ID, amount: "5", paidOn: "2026-02-30", method: "upi" }).success).toBe(false);
  });

  it("requires reasons for refunds and voids", () => {
    expect(refundSchema.safeParse({ paymentId: ID, amount: "100", refundedOn: "2026-10-15", method: "upi", reason: "" }).success).toBe(false);
    expect(voidSchema.safeParse({ id: ID, reason: "no" }).success).toBe(false);
    expect(voidSchema.parse({ id: ID, reason: "Entered twice" }).reason).toBe("Entered twice");
  });

  it("validates expenses and receipt links", () => {
    const base = { categoryId: ID, spentOn: "2026-10-15", amount: "2500.25", description: "Room hire", method: "bank_transfer" };
    expect(expenseSchema.parse(base)).toMatchObject({ amount: 250025, currency: "INR", receiptUrl: null, courseId: null });
    expect(expenseSchema.safeParse({ ...base, receiptUrl: "http://insecure.example" }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...base, receiptUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("parses list filters from the URL defensively", () => {
    expect(parseFinanceFilters({ from: "2026-10-31", to: "2026-10-01", course: "nope", method: "upi", status: ["voided", "x"] })).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-31",
      course: "",
      method: "upi",
      status: "voided",
    });
  });
});
