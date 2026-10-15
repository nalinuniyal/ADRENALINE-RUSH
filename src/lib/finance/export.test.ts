import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { expensesCsv, paymentsCsv, PAYMENT_CSV_HEADERS } from "./export";

describe("finance CSV", () => {
  it("exports payments with exact amounts, net and readable labels; voided rows count zero", () => {
    const csv = paymentsCsv([
      {
        receipt_number: "AR-2026-0001", paid_on: "2026-10-01", candidate: "Asha Example", course: "Course", batch: "Oct",
        amount: 15000, refunded: "5000.50", currency: "INR", method: "upi", status: "completed", reference: "UTR123",
        installment: "1", notes: null, void_reason: null, recorded_by: "Owner", created_at: "1 Oct 2026",
      },
      {
        receipt_number: null, paid_on: "2026-10-02", candidate: "=HYPERLINK(\"x\")", course: "Course", batch: "",
        amount: 0.1, refunded: 0, currency: "INR", method: "cash", status: "voided", reference: null,
        installment: "", notes: "Line 1\nLine 2", void_reason: "Entered twice", recorded_by: "Owner", created_at: "2 Oct 2026",
      },
    ]);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(PAYMENT_CSV_HEADERS);
    expect(rows[1].slice(5, 11)).toEqual(["15000.00", "5000.50", "9999.50", "INR", "UPI", "Partly refunded"]);
    expect(rows[2][2]).toBe("'=HYPERLINK(\"x\")");
    expect(rows[2].slice(5, 11)).toEqual(["0.10", "0.00", "0.00", "INR", "Cash", "Voided"]);
    expect(rows[2][13]).toBe("Line 1\nLine 2");
  });

  it("exports expenses", () => {
    const rows = parseCsv(
      expensesCsv([
        {
          spent_on: "2026-10-03", category: "Venue", description: "Room hire", vendor: "Hall Co", amount: "2500.25", currency: "INR",
          method: "bank_transfer", reference: null, course: "", batch: "", status: "recorded", receipt_url: null, notes: null,
          void_reason: null, created_by: "Owner", created_at: "3 Oct 2026",
        },
      ]),
    );
    expect(rows[1].slice(0, 7)).toEqual(["2026-10-03", "Venue", "Room hire", "Hall Co", "2500.25", "INR", "Bank transfer"]);
    expect(rows[1][10]).toBe("Recorded");
  });
});
