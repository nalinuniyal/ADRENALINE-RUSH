import { describe, expect, it } from "vitest";
import {
  addMonths,
  allocate,
  cashSummary,
  computeFee,
  formatPaise,
  formatReceiptNumber,
  installmentStatus,
  monthlyDueDates,
  paiseToInput,
  paiseToString,
  parseAmount,
  paymentDisplayStatus,
  percentOf,
  planBalance,
  splitEvenly,
  toPaise,
} from "./money";

describe("parsing and formatting", () => {
  it("parses amounts strictly into integer paise", () => {
    expect(parseAmount("4999")).toBe(499900);
    expect(parseAmount("4999.5")).toBe(499950);
    expect(parseAmount("0.10")).toBe(10);
    expect(parseAmount("1,25,000.75")).toBe(12500075);
    expect(parseAmount(" 12 ")).toBe(1200);
    for (const bad of ["", "-5", "1.234", "abc", "1e5", "12345678901", "."]) expect(parseAmount(bad)).toBeNull();
  });

  it("round-trips database numerics without float drift", () => {
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise("1234.56")).toBe(123456);
    expect(toPaise("-10.5")).toBe(-1050);
    expect(toPaise(9999999999.99)).toBe(999999999999);
    expect(toPaise(null)).toBe(0);
    expect(paiseToString(123456)).toBe("1234.56");
    expect(paiseToString(5)).toBe("0.05");
    expect(paiseToString(-1050)).toBe("-10.50");
    expect(paiseToInput(499900)).toBe("4999");
    expect(paiseToInput(499950)).toBe("4999.50");
    expect(formatPaise(1250000)).toBe("₹12,500");
    expect(formatPaise(1250050)).toBe("₹12,500.50");
  });

  it("formats receipt numbers like the database", () => {
    expect(formatReceiptNumber(2026, 1)).toBe("AR-2026-0001");
    expect(formatReceiptNumber(2026, 12345)).toBe("AR-2026-12345");
  });
});

describe("fees and discounts", () => {
  it("rounds percentage discounts half-up to the paisa (same as PostgreSQL round)", () => {
    expect(percentOf(4999900, "10")).toBe(499990);
    expect(percentOf(1, "50")).toBe(1); // 0.5 paisa rounds up
    expect(percentOf(333, "33.33")).toBe(111);
    expect(percentOf(999_999_999_999, "99.99")).toBe(999_899_999_999);
    expect(() => percentOf(100, "101")).toThrow();
  });

  it("computes the final fee", () => {
    expect(computeFee(5000000, "none", 0)).toEqual({ discountPaise: 0, finalPaise: 5000000 });
    expect(computeFee(5000000, "amount", 500000)).toEqual({ discountPaise: 500000, finalPaise: 4500000 });
    expect(computeFee(5000000, "percent", "12.5")).toEqual({ discountPaise: 625000, finalPaise: 4375000 });
    expect(() => computeFee(1000, "amount", 2000)).toThrow(/more than the fee/);
  });

  it("splits evenly in whole rupees with the remainder on the last installment", () => {
    expect(splitEvenly(3000000, 3)).toEqual([1000000, 1000000, 1000000]);
    const parts = splitEvenly(3000000, 7);
    expect(parts).toEqual([428500, 428500, 428500, 428500, 428500, 428500, 429000]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(3000000);
    expect(splitEvenly(1000050, 2)).toEqual([500000, 500050]);
    expect(splitEvenly(5, 3)).toEqual([1, 1, 3]);
    expect(splitEvenly(100, 0)).toEqual([]);
  });

  it("generates monthly due dates clamped to month ends", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(monthlyDueDates("2026-11-15", 3)).toEqual(["2026-11-15", "2026-12-15", "2027-01-15"]);
  });
});

describe("allocation and status", () => {
  const inst = [
    { id: "i1", amountPaise: 1000000 },
    { id: "i2", amountPaise: 1000000 },
    { id: "i3", amountPaise: 1000000 },
  ];

  it("fills the earliest installments first and supports partial payments", () => {
    const paid = allocate(inst, [{ netPaise: 1500000 }]);
    expect([...paid.values()]).toEqual([1000000, 500000, 0]);
  });

  it("applies a payment to its chosen installment first, then overflows in order", () => {
    const paid = allocate(inst, [{ netPaise: 400000, installmentId: "i3" }, { netPaise: 1200000 }]);
    expect([...paid.values()]).toEqual([1000000, 200000, 400000]);
    const overflow = allocate(inst, [{ netPaise: 1500000, installmentId: "i2" }]);
    expect([...overflow.values()]).toEqual([500000, 1000000, 0]);
  });

  it("never counts more than was paid, and ignores fully refunded payments", () => {
    const paid = allocate(inst, [{ netPaise: 0 }, { netPaise: -5 }, { netPaise: 5000000 }]);
    expect([...paid.values()]).toEqual([1000000, 1000000, 1000000]);
  });

  it("derives paid / partly paid / due / overdue from dates", () => {
    expect(installmentStatus(100, 100, "2026-01-01", "2026-10-15")).toBe("paid");
    expect(installmentStatus(100, 40, "2026-10-14", "2026-10-15")).toBe("overdue");
    expect(installmentStatus(100, 40, "2026-10-15", "2026-10-15")).toBe("partially_paid");
    expect(installmentStatus(100, 0, "2026-11-01", "2026-10-15")).toBe("due");
  });

  it("balances: outstanding never negative, overpayment is credit; cash result = net − expenses", () => {
    expect(planBalance(3000000, 1500000, 0)).toEqual({ netPaise: 1500000, outstandingPaise: 1500000, creditPaise: 0 });
    expect(planBalance(3000000, 1500000, 500000)).toEqual({ netPaise: 1000000, outstandingPaise: 2000000, creditPaise: 0 });
    expect(planBalance(1000, 1500, 0)).toEqual({ netPaise: 1500, outstandingPaise: 0, creditPaise: 500 });
    expect(cashSummary(800000, 100000, 250025)).toEqual({ netPaise: 700000, cashResultPaise: 449975 });
  });

  it("shows refunded / partly refunded for received payments only", () => {
    expect(paymentDisplayStatus("completed", 1000, 0)).toBe("completed");
    expect(paymentDisplayStatus("completed", 1000, 400)).toBe("partially_refunded");
    expect(paymentDisplayStatus("completed", 1000, 1000)).toBe("refunded");
    expect(paymentDisplayStatus("voided", 1000, 0)).toBe("voided");
  });
});
