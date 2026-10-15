import { toCsv } from "@/lib/csv";
import { paiseToString, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, paymentDisplayStatus, toPaise, type PaymentMethod, type PaymentStatus } from "@/lib/finance/money";

/** Amount columns are plain "1234.50" (no currency symbol) so spreadsheets can add them up. */

export type PaymentExportRow = {
  receipt_number: string | null;
  paid_on: string;
  candidate: string;
  course: string;
  batch: string;
  amount: number | string;
  refunded: number | string;
  currency: string;
  method: string;
  status: string;
  reference: string | null;
  installment: string;
  notes: string | null;
  void_reason: string | null;
  recorded_by: string;
  created_at: string;
};

export const PAYMENT_CSV_HEADERS = [
  "Receipt no.", "Payment date", "Candidate", "Course", "Batch", "Amount", "Refunded", "Net", "Currency", "Method", "Status",
  "Reference", "Installment", "Notes", "Void reason", "Recorded by", "Recorded at",
];

export function paymentsCsv(rows: PaymentExportRow[]): string {
  return toCsv(
    PAYMENT_CSV_HEADERS,
    rows.map((r) => {
      const amount = toPaise(r.amount);
      const refunded = toPaise(r.refunded);
      const counted = r.status === "completed";
      return [
        r.receipt_number, r.paid_on, r.candidate, r.course, r.batch,
        paiseToString(amount), paiseToString(refunded), paiseToString(counted ? amount - refunded : 0), r.currency,
        PAYMENT_METHOD_LABELS[r.method as PaymentMethod] ?? r.method,
        PAYMENT_STATUS_LABELS[paymentDisplayStatus(r.status as PaymentStatus, amount, refunded)] ?? r.status,
        r.reference, r.installment, r.notes, r.void_reason, r.recorded_by, r.created_at,
      ];
    }),
  );
}

export type ExpenseExportRow = {
  spent_on: string;
  category: string;
  description: string;
  vendor: string | null;
  amount: number | string;
  currency: string;
  method: string;
  reference: string | null;
  course: string;
  batch: string;
  status: string;
  receipt_url: string | null;
  notes: string | null;
  void_reason: string | null;
  created_by: string;
  created_at: string;
};

export const EXPENSE_CSV_HEADERS = [
  "Date", "Category", "Description", "Vendor / payee", "Amount", "Currency", "Method", "Reference", "Course", "Batch", "Status",
  "Receipt link", "Notes", "Void reason", "Recorded by", "Recorded at",
];

export function expensesCsv(rows: ExpenseExportRow[]): string {
  return toCsv(
    EXPENSE_CSV_HEADERS,
    rows.map((r) => [
      r.spent_on, r.category, r.description, r.vendor, paiseToString(toPaise(r.amount)), r.currency,
      PAYMENT_METHOD_LABELS[r.method as PaymentMethod] ?? r.method, r.reference, r.course, r.batch,
      r.status === "voided" ? "Voided" : "Recorded", r.receipt_url, r.notes, r.void_reason, r.created_by, r.created_at,
    ]),
  );
}
