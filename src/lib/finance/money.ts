/**
 * Money maths for fees, installments and totals. Amounts are handled as
 * integer paise (1/100 of the currency unit) so no floating-point error can
 * creep in; the database stores numeric(12,2) and repeats every rule that
 * matters (it is the source of truth). Client-safe: no server imports.
 */

/** numeric(12,2) upper bound, in paise. */
export const MAX_PAISE = 999_999_999_999;
const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;

/** Strictly parses "4999", "4999.5" or "4999.50" into paise; null when invalid. */
export function parseAmount(input: string | null | undefined): number | null {
  const s = (input ?? "").trim().replace(/,/g, "");
  if (!AMOUNT_RE.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return paise <= MAX_PAISE ? paise : null;
}

/**
 * Converts a numeric value from the database (number or decimal string) to
 * paise. numeric(12,2) values always round-trip exactly through this.
 */
export function toPaise(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "string") {
    const neg = value.trim().startsWith("-");
    const p = parseAmount(value.trim().replace(/^-/, ""));
    if (p === null) throw new Error(`Not an amount: ${value}`);
    return neg ? -p : p;
  }
  if (!Number.isFinite(value)) throw new Error("Not an amount");
  return Math.round(value * 100);
}

/** Paise → number for the database/JSON (exact for 2 decimals: JSON prints the shortest form). */
export function fromPaise(paise: number): number {
  return paise / 100;
}

/** Paise → "1234.50" (for inputs and CSV). */
export function paiseToString(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Paise → input value without trailing ".00" ("4999", "4999.50"). */
export function paiseToInput(paise: number): string {
  const s = paiseToString(paise);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

export function formatPaise(paise: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(paise / 100);
  } catch {
    return `${currency} ${paiseToString(paise)}`;
  }
}

/** percent (0–100, up to 2 decimals) of an amount, rounded half-up to the paisa like PostgreSQL's round(). */
export function percentOf(basePaise: number, percent: string | number): number {
  const hundredths = typeof percent === "number" ? Math.round(percent * 100) : parseAmount(String(percent));
  if (hundredths === null || hundredths < 0 || hundredths > 10_000) throw new Error("Percent must be between 0 and 100");
  // base × hundredths / 10000 can exceed 2^53, so use BigInt with half-up rounding.
  const num = BigInt(basePaise) * BigInt(hundredths);
  return Number((num + BigInt(5_000)) / BigInt(10_000));
}

export type DiscountType = "none" | "amount" | "percent";

/** Same rules as public.fee_plans_before_write(). discountValue: paise for "amount", percent for "percent". */
export function computeFee(basePaise: number, type: DiscountType, discountValue: number | string): { discountPaise: number; finalPaise: number } {
  let discountPaise = 0;
  if (type === "amount") discountPaise = typeof discountValue === "number" ? discountValue : (parseAmount(discountValue) ?? 0);
  else if (type === "percent") discountPaise = percentOf(basePaise, discountValue);
  if (discountPaise > basePaise) throw new Error("The discount cannot be more than the fee");
  return { discountPaise, finalPaise: basePaise - discountPaise };
}

/**
 * Splits a total into n installments. Whole rupees where possible; the last
 * installment takes the remainder so the parts always add up exactly.
 */
export function splitEvenly(totalPaise: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) return [];
  if (n === 1) return [totalPaise];
  let each = Math.floor(totalPaise / n / 100) * 100;
  if (each === 0) each = Math.floor(totalPaise / n);
  const parts = Array.from({ length: n }, () => each);
  parts[n - 1] = totalPaise - each * (n - 1);
  return parts;
}

/** "YYYY-MM-DD" plus k months, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, k: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** n due dates starting on `first`, every `everyMonths` months. */
export function monthlyDueDates(first: string, n: number, everyMonths = 1): string[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => addMonths(first, i * everyMonths));
}

export type AllocInstallment = { id: string; amountPaise: number };
/** A completed payment, net of its completed refunds, in payment-date order. */
export type AllocPayment = { netPaise: number; installmentId?: string | null };

/**
 * Applies payments to installments exactly like public.fee_plan_allocation():
 * each payment first fills the installment it was recorded against, then the
 * earliest unpaid ones. Returns paid paise per installment id.
 */
export function allocate(installments: AllocInstallment[], payments: AllocPayment[]): Map<string, number> {
  const remaining = installments.map((i) => i.amountPaise);
  for (const p of payments) {
    let net = p.netPaise;
    if (net <= 0) continue;
    const target = p.installmentId ? installments.findIndex((i) => i.id === p.installmentId) : -1;
    if (target >= 0) {
      const take = Math.min(net, remaining[target]);
      remaining[target] -= take;
      net -= take;
    }
    for (let i = 0; i < remaining.length && net > 0; i++) {
      const take = Math.min(net, remaining[i]);
      remaining[i] -= take;
      net -= take;
    }
  }
  return new Map(installments.map((inst, i) => [inst.id, inst.amountPaise - remaining[i]]));
}

export type InstallmentStatus = "paid" | "partially_paid" | "due" | "overdue";
export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = {
  paid: "Paid",
  partially_paid: "Partly paid",
  due: "Due",
  overdue: "Overdue",
};

/** Same rule as public.fee_plan_schedule(): dates are "YYYY-MM-DD" in the business time zone. */
export function installmentStatus(amountPaise: number, paidPaise: number, dueDate: string, today: string): InstallmentStatus {
  if (paidPaise >= amountPaise) return "paid";
  if (dueDate < today) return "overdue";
  return paidPaise > 0 ? "partially_paid" : "due";
}

/** Outstanding never goes below zero; anything paid beyond the fee is a credit. */
export function planBalance(finalPaise: number, grossPaise: number, refundedPaise: number) {
  const net = grossPaise - refundedPaise;
  return { netPaise: net, outstandingPaise: Math.max(finalPaise - net, 0), creditPaise: Math.max(net - finalPaise, 0) };
}

/** Net collections = gross − refunds; cash result = net − expenses (not profit, not taxable income). */
export function cashSummary(grossPaise: number, refundsPaise: number, expensesPaise: number) {
  const net = grossPaise - refundsPaise;
  return { netPaise: net, cashResultPaise: net - expensesPaise };
}

/** Receipt numbers as the database issues them: AR-2026-0001. */
export function formatReceiptNumber(year: number, n: number, prefix = "AR"): string {
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

export const PAYMENT_METHODS = ["upi", "bank_transfer", "cash", "card", "cheque", "razorpay", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const MANUAL_METHODS = PAYMENT_METHODS.filter((m) => m !== "razorpay") as Exclude<PaymentMethod, "razorpay">[];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  card: "Card",
  cheque: "Cheque",
  razorpay: "Razorpay (online)",
  other: "Other",
};

export const PAYMENT_STATUSES = ["pending", "completed", "failed", "voided"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PaymentDisplayStatus = PaymentStatus | "partially_refunded" | "refunded";
export const PAYMENT_STATUS_LABELS: Record<PaymentDisplayStatus, string> = {
  pending: "Pending",
  completed: "Received",
  failed: "Failed",
  voided: "Voided",
  partially_refunded: "Partly refunded",
  refunded: "Refunded",
};

/** "Refunded" and "Partly refunded" are derived from the payment's completed refunds. */
export function paymentDisplayStatus(status: PaymentStatus, amountPaise: number, refundedPaise: number): PaymentDisplayStatus {
  if (status !== "completed" || refundedPaise <= 0) return status;
  return refundedPaise >= amountPaise ? "refunded" : "partially_refunded";
}
