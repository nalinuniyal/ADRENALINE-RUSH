import { toPaise } from "@/lib/finance/money";

/** What get_fee_pay_page() / get_public_payment_details() return, parsed defensively. */

export type BankDetails = {
  accountHolder: string | null;
  accountNumber: string;
  ifsc: string | null;
  bankName: string | null;
  branch: string | null;
  accountType: string | null;
};

export type PaymentDetails = {
  upiVpa: string | null;
  upiPayeeName: string | null;
  upiQrMediaId: string | null;
  bank: BankDetails | null;
  instructions: string | null;
};

export type PayPageClosed = {
  status: "not_found" | "revoked" | "closed" | "error";
  businessName: string | null;
};
export type PayPageOpen = {
  status: "ok" | "paid";
  businessName: string;
  firstName: string | null;
  courseTitle: string;
  currency: string;
  amountMode: "next_installment" | "balance";
  amountDue: number;
  installmentLabel: string | null;
  dueDate: string | null;
  outstanding: number;
  reference: string;
  pendingSubmissions: number;
  detailsShown: boolean;
} & PaymentDetails;
export type PayPage = PayPageClosed | PayPageOpen;

export const isOpenPayPage = (p: PayPage): p is PayPageOpen =>
  p.status === "ok" || p.status === "paid";

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;

function parseBank(v: unknown): BankDetails | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  const accountNumber = str(b.account_number);
  if (!accountNumber) return null;
  return {
    accountHolder: str(b.account_holder),
    accountNumber,
    ifsc: str(b.ifsc),
    bankName: str(b.bank_name),
    branch: str(b.branch),
    accountType: str(b.account_type),
  };
}

export function parsePaymentDetails(v: unknown): PaymentDetails | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  const out = {
    upiVpa: str(d.upi_vpa),
    upiPayeeName: str(d.upi_payee_name),
    upiQrMediaId: str(d.upi_qr_media_id),
    bank: parseBank(d.bank),
    instructions: str(d.instructions),
  };
  return out.upiVpa || out.bank ? out : null;
}

export function parsePayPage(v: unknown): PayPage {
  if (!v || typeof v !== "object")
    return { status: "error", businessName: null };
  const d = v as Record<string, unknown>;
  const status = d.status;
  if (status === "not_found" || status === "revoked" || status === "closed")
    return { status, businessName: str(d.business_name) };
  if (status !== "ok" && status !== "paid")
    return { status: "error", businessName: null };
  const amount = (x: unknown) => {
    try {
      return toPaise(typeof x === "number" || typeof x === "string" ? x : 0);
    } catch {
      return 0;
    }
  };
  return {
    status,
    businessName: str(d.business_name) ?? "",
    firstName: str(d.first_name),
    courseTitle: str(d.course_title) ?? "your course",
    currency: str(d.currency) ?? "INR",
    amountMode: d.amount_mode === "balance" ? "balance" : "next_installment",
    amountDue: amount(d.amount_due),
    installmentLabel: str(d.installment_label),
    dueDate: str(d.due_date),
    outstanding: amount(d.outstanding),
    reference: str(d.reference) ?? "",
    pendingSubmissions:
      typeof d.pending_submissions === "number" ? d.pending_submissions : 0,
    detailsShown: d.details_shown === true,
    upiVpa: str(d.upi_vpa),
    upiPayeeName: str(d.upi_payee_name),
    upiQrMediaId: str(d.upi_qr_media_id),
    bank: parseBank(d.bank),
    instructions: str(d.instructions),
  };
}

/** One "I've paid" report, formatted for the admin lists. */
export type SubmissionView = {
  id: string;
  candidateName: string;
  feeHref: string | null;
  courseTitle: string;
  amountText: string;
  amountInput: string;
  paidOnText: string;
  methodText: string;
  utr: string;
  note: string | null;
  hasScreenshot: boolean;
  status: "pending" | "approved" | "rejected";
  rejectReason: string | null;
  receiptHref: string | null;
  submittedText: string;
  /** Another payment already uses this UTR as its reference. */
  duplicateOf: string | null;
};
