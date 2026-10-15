import { z } from "zod";
import { parseAmount } from "@/lib/finance/money";
import { IFSC_RE, isValidAccountNumber, normalizeAccountNumber, normalizeIfsc, normalizeUtr, normalizeVpa, UTR_RE, VPA_RE } from "@/lib/finance/upi";

// Form inputs are strings; outputs are DB-ready values (empty → null).

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en-US")} characters`)
    .transform((v) => (v === "" ? null : v));

export const ACCOUNT_TYPES = ["savings", "current", "other"] as const;

export const paymentDetailsSchema = z
  .object({
    upiVpa: z
      .string()
      .trim()
      .transform(normalizeVpa)
      .refine((v) => v === "" || (VPA_RE.test(v) && v.length <= 100), "Enter a UPI ID like yourname@okhdfcbank")
      .transform((v) => (v === "" ? null : v)),
    upiPayeeName: optionalText(80),
    bankAccountHolder: optionalText(100),
    /** Empty keeps the saved number when keepAccountNumber is true (the field shows it masked). */
    bankAccountNumber: z
      .string()
      .transform(normalizeAccountNumber)
      .refine((v) => v === "" || isValidAccountNumber(v), "Enter the account number: 9 to 18 digits")
      .transform((v) => (v === "" ? null : v)),
    keepAccountNumber: z.boolean().default(false),
    bankIfsc: z
      .string()
      .trim()
      .transform(normalizeIfsc)
      .refine((v) => v === "" || IFSC_RE.test(v), "Enter the 11-character IFSC, like HDFC0001234 (the 5th character is a zero)")
      .transform((v) => (v === "" ? null : v)),
    bankName: optionalText(100),
    bankBranch: optionalText(100),
    bankAccountType: z
      .string()
      .refine((v) => v === "" || (ACCOUNT_TYPES as readonly string[]).includes(v), "Choose an account type")
      .transform((v) => (v === "" ? null : (v as (typeof ACCOUNT_TYPES)[number]))),
    instructions: optionalText(1000),
    showOnPayPage: z.boolean(),
    showInReminders: z.boolean(),
    showOnCoursePages: z.boolean(),
    confirmEmailEnabled: z.boolean(),
    confirmEmailSubject: z.string().trim().min(3, "Write a subject").max(200, "Keep the subject under 200 characters"),
    confirmEmailBody: z.string().trim().min(3, "Write the message").max(4000, "Keep the message under 4,000 characters"),
  })
  .superRefine((v, ctx) => {
    if (v.upiVpa && !v.upiPayeeName) ctx.addIssue({ code: "custom", path: ["upiPayeeName"], message: "Enter the name your UPI account is registered to" });
    const hasNumber = Boolean(v.bankAccountNumber) || v.keepAccountNumber;
    const anyBank = hasNumber || v.bankIfsc || v.bankAccountHolder || v.bankName || v.bankBranch;
    if (anyBank) {
      if (!hasNumber) ctx.addIssue({ code: "custom", path: ["bankAccountNumber"], message: "Enter the account number" });
      if (!v.bankIfsc) ctx.addIssue({ code: "custom", path: ["bankIfsc"], message: "Enter the IFSC" });
      if (!v.bankAccountHolder) ctx.addIssue({ code: "custom", path: ["bankAccountHolder"], message: "Enter the account holder's name" });
    }
  });

export type PaymentDetailsInput = z.input<typeof paymentDetailsSchema>;
export type PaymentDetailsOutput = z.output<typeof paymentDetailsSchema>;

export const PAY_LINK_MODES = ["next_installment", "balance"] as const;
export type PayLinkMode = (typeof PAY_LINK_MODES)[number];

export const payLinkSchema = z.object({
  feePlanId: z.guid("Choose a fee plan"),
  mode: z.enum(PAY_LINK_MODES).default("next_installment"),
});

export const sendPayLinkSchema = z.object({
  feePlanId: z.guid("Choose a fee plan"),
  channel: z.enum(["whatsapp", "email"]),
  /** Make a link (next installment) when none is live. */
  create: z.boolean().default(true),
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: string) => DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The candidate's "I've paid" form (amount in paise). */
export const paymentProofSchema = z.object({
  utr: z
    .string({ error: "Enter the UTR / transaction reference" })
    .transform(normalizeUtr)
    .refine((v) => UTR_RE.test(v), "Enter the UTR or UPI reference number exactly as shown in your app (6–35 letters and digits)"),
  amount: z
    .string({ error: "Enter the amount you paid" })
    .transform((v, ctx) => {
      const p = parseAmount(v);
      if (p === null || p <= 0) {
        ctx.addIssue({ code: "custom", message: "Enter the amount you paid, like 5000 or 5000.50" });
        return z.NEVER;
      }
      return p;
    }),
  paidOn: z.string({ error: "Choose the date you paid" }).trim().refine(isDate, "Choose the date you paid"),
  method: z.enum(["upi", "bank_transfer"], { error: "Choose how you paid" }),
  note: z
    .string()
    .trim()
    .max(500, "Keep the note under 500 characters")
    .optional()
    .transform((v) => (v ? v : null)),
});

export const approveSchema = z.object({
  id: z.guid(),
  /** Optional correction of the received amount ("" = as reported). */
  amount: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return null;
      const p = parseAmount(v);
      if (p === null || p <= 0) {
        ctx.addIssue({ code: "custom", message: "Enter the amount you received" });
        return z.NEVER;
      }
      return p;
    }),
});

export const rejectSchema = z.object({
  id: z.guid(),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500, "Keep the reason under 500 characters"),
});
