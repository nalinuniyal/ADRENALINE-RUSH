import { z } from "zod";
import { MANUAL_METHODS, parseAmount, PAYMENT_METHODS, computeFee, type DiscountType } from "@/lib/finance/money";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: string) => DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

const uuid = (message = "Choose a valid option") => z.string({ error: message }).refine((v) => z.guid().safeParse(v).success, message);
const optionalUuid = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.guid().safeParse(v).success, "Choose a valid option");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const requiredDate = (message = "Choose a date") => z.string({ error: message }).trim().refine(isDate, message);
/** Positive amount ("4999" / "4999.50") → integer paise. */
const amount = (label = "Amount") =>
  z
    .union([z.string(), z.number()], { error: `Enter the ${label.toLowerCase()}` })
    .transform((v, ctx) => {
      const p = parseAmount(String(v));
      if (p === null) {
        ctx.addIssue({ code: "custom", message: "Enter an amount like 4999 or 4999.50" });
        return z.NEVER;
      }
      return p;
    });
const positiveAmount = (label?: string) => amount(label).refine((p) => p > 0, "Enter an amount greater than zero");

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => v || "INR")
  .refine((v) => /^[A-Z]{3}$/.test(v), "Use a 3-letter currency code like INR");

export const DISCOUNT_TYPES = ["none", "amount", "percent"] as const;

export const installmentInputSchema = z.object({
  dueDate: requiredDate("Choose a due date"),
  amount: positiveAmount(),
  label: optionalText(80),
});

export const feePlanSchema = z
  .object({
    enrollmentId: uuid("Choose an enrollment"),
    currency,
    baseFee: amount("Course fee"),
    discountType: z.enum(DISCOUNT_TYPES).default("none"),
    discountValue: z.union([z.string(), z.number()]).optional().default(""),
    discountReason: optionalText(300),
    notes: optionalText(2000),
    installments: z.array(installmentInputSchema).max(60, "Use at most 60 installments").default([]),
  })
  .transform((v, ctx) => {
    const raw = String(v.discountValue ?? "").trim();
    let discountValue = 0;
    if (v.discountType !== "none") {
      const p = parseAmount(raw);
      if (p === null || p === 0) {
        ctx.addIssue({ code: "custom", path: ["discountValue"], message: v.discountType === "percent" ? "Enter a percentage like 10 or 12.5" : "Enter the discount amount" });
        return z.NEVER;
      }
      if (v.discountType === "percent" && p > 10_000) {
        ctx.addIssue({ code: "custom", path: ["discountValue"], message: "A percentage cannot be more than 100" });
        return z.NEVER;
      }
      discountValue = p; // paise for "amount", hundredths of a percent for "percent"
    }
    if (v.discountType !== "none" && !v.discountReason) {
      ctx.addIssue({ code: "custom", path: ["discountReason"], message: "Say why the discount was given" });
      return z.NEVER;
    }
    let fee: { discountPaise: number; finalPaise: number };
    try {
      fee = computeFee(v.baseFee, v.discountType as DiscountType, v.discountType === "percent" ? (discountValue / 100).toFixed(2) : discountValue);
    } catch {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "The discount cannot be more than the fee" });
      return z.NEVER;
    }
    if (v.installments.length) {
      const sum = v.installments.reduce((s, i) => s + i.amount, 0);
      if (sum !== fee.finalPaise) {
        ctx.addIssue({ code: "custom", path: ["installments"], message: "The installments must add up to the final fee" });
        return z.NEVER;
      }
    }
    return { ...v, discountValue, ...fee };
  });
export type FeePlanInput = z.input<typeof feePlanSchema>;
export type FeePlanOutput = z.output<typeof feePlanSchema>;

export const paymentSchema = z.object({
  feePlanId: uuid("Choose a fee plan"),
  amount: positiveAmount(),
  paidOn: requiredDate("Choose the payment date"),
  method: z.enum(MANUAL_METHODS as [string, ...string[]], { error: "Choose how it was paid" }),
  reference: optionalText(120),
  notes: optionalText(2000),
  installmentId: optionalUuid,
  status: z.enum(["completed", "pending"]).default("completed"),
});

export const refundSchema = z.object({
  paymentId: uuid("Choose a payment"),
  amount: positiveAmount("Refund amount"),
  refundedOn: requiredDate("Choose the refund date"),
  method: z.enum(MANUAL_METHODS as [string, ...string[]], { error: "Choose how it was refunded" }),
  reference: optionalText(120),
  reason: z.string({ error: "Say why the refund was made" }).trim().min(3, "Say why the refund was made").max(500, "Use 500 characters or fewer"),
});

export const voidSchema = z.object({
  id: uuid("That item could not be found"),
  reason: z.string({ error: "Give a reason" }).trim().min(3, "Give a reason (at least 3 characters)").max(500, "Use 500 characters or fewer"),
});

export const expenseSchema = z.object({
  categoryId: uuid("Choose a category"),
  spentOn: requiredDate("Choose the date"),
  amount: positiveAmount(),
  currency,
  description: z.string({ error: "Describe the expense" }).trim().min(1, "Describe the expense").max(200, "Use 200 characters or fewer"),
  vendor: optionalText(120),
  method: z.enum(MANUAL_METHODS as [string, ...string[]], { error: "Choose how it was paid" }),
  reference: optionalText(120),
  notes: optionalText(2000),
  receiptUrl: optionalText(500).refine((v) => v === null || (/^https:\/\//i.test(v) && URL.canParse(v)), "Paste a link starting with https://"),
  courseId: optionalUuid,
  batchId: optionalUuid,
});

export const categorySchema = z.object({
  name: z.string({ error: "Enter a name" }).trim().min(1, "Enter a name").max(60, "Use 60 characters or fewer"),
});

export const paymentLinkSchema = z.object({
  feePlanId: uuid("Choose a fee plan"),
  installmentId: optionalUuid,
});

export const reminderSchema = z.object({
  feePlanId: uuid("Choose a fee plan"),
  installmentId: optionalUuid,
  channel: z.enum(["whatsapp", "email"]),
});

/* -------------------------------------------------------------------------- */
/* List filters (from the URL)                                                 */
/* -------------------------------------------------------------------------- */

const urlUuid = z
  .string()
  .optional()
  .transform((v) => (v && z.guid().safeParse(v).success ? v : ""));
const urlDate = z
  .string()
  .optional()
  .transform((v) => (v && isDate(v) ? v : ""));

export const financeFilterSchema = z
  .object({
    from: urlDate,
    to: urlDate,
    course: urlUuid,
    batch: urlUuid,
    method: z
      .string()
      .optional()
      .transform((v) => ((PAYMENT_METHODS as readonly string[]).includes(v ?? "") ? (v as string) : "")),
    status: z
      .string()
      .optional()
      .transform((v) => (["completed", "pending", "failed", "voided", "refunded", "all"].includes(v ?? "") ? (v as string) : "")),
    category: urlUuid,
    q: z
      .string()
      .optional()
      .transform((v) => (v ?? "").trim().slice(0, 80)),
  })
  .transform((v) => (v.from && v.to && v.from > v.to ? { ...v, from: v.to, to: v.from } : v));
export type FinanceFilters = z.output<typeof financeFilterSchema>;

export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseFinanceFilters(raw: Record<string, string | string[] | undefined>): FinanceFilters {
  return financeFilterSchema.parse(Object.fromEntries(["from", "to", "course", "batch", "method", "status", "category", "q"].map((k) => [k, firstParam(raw[k])])));
}

/** Query string for links that keep the current filters. */
export function filterQuery(f: Partial<FinanceFilters>, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
