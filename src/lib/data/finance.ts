import "server-only";
import { toPaise } from "@/lib/finance/money";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FinanceFilters } from "@/lib/validation/finance";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function logError(msg: string, code?: string) {
  console.error(JSON.stringify({ level: "error", msg, code }));
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export type FinanceSummary = {
  currency: string;
  booked: number;
  gross: number;
  refunds: number;
  net: number;
  expenses: number;
  cashResult: number;
  outstanding: number;
  overdue: number;
  overdueCount: number;
  paymentCount: number;
  expenseCount: number;
  otherCurrencyRows: number;
};

/** Totals in paise, computed by public.finance_summary() (RLS applies). */
export async function getFinanceSummary(supabase: Supabase, orgId: string, f: Pick<FinanceFilters, "from" | "to" | "course" | "batch">): Promise<FinanceSummary> {
  const { data, error } = await supabase.rpc("finance_summary", {
    p_org: orgId,
    p_from: f.from || undefined,
    p_to: f.to || undefined,
    p_course: f.course || undefined,
    p_batch: f.batch || undefined,
  });
  const r = data?.[0];
  if (error || !r) {
    logError("finance summary failed", error?.code);
    throw new Error("Could not load the finance totals.");
  }
  return {
    currency: r.currency,
    booked: toPaise(r.booked),
    gross: toPaise(r.gross),
    refunds: toPaise(r.refunds),
    net: toPaise(r.net),
    expenses: toPaise(r.expenses),
    cashResult: toPaise(r.cash_result),
    outstanding: toPaise(r.outstanding),
    overdue: toPaise(r.overdue),
    overdueCount: r.overdue_count,
    paymentCount: r.payment_count,
    expenseCount: r.expense_count,
    otherCurrencyRows: r.other_currency_rows,
  };
}

export type OverdueRow = {
  feePlanId: string;
  enrollmentId: string;
  candidateId: string;
  candidateName: string;
  phone: string | null;
  email: string | null;
  courseTitle: string;
  batchName: string | null;
  installmentId: string;
  seq: number;
  label: string | null;
  dueDate: string;
  remaining: number;
  currency: string;
  daysOverdue: number;
};

export async function getOverdueInstallments(supabase: Supabase, orgId: string, f: Pick<FinanceFilters, "course" | "batch">): Promise<OverdueRow[]> {
  const { data, error } = await supabase.rpc("finance_overdue_installments", { p_org: orgId, p_course: f.course || undefined, p_batch: f.batch || undefined });
  if (error) {
    logError("overdue list failed", error.code);
    throw new Error("Could not load overdue installments.");
  }
  const rows = data ?? [];
  const candidateIds = [...new Set(rows.map((r) => r.candidate_id))];
  const courseIds = [...new Set(rows.map((r) => r.course_id))];
  const batchIds = [...new Set(rows.map((r) => r.batch_id).filter((v): v is string => Boolean(v)))];
  const [cands, courses, batches] = await Promise.all([
    candidateIds.length ? supabase.from("candidates").select("id, full_name, phone, email").in("id", candidateIds) : Promise.resolve({ data: [] }),
    courseIds.length ? supabase.from("courses").select("id, title").in("id", courseIds) : Promise.resolve({ data: [] }),
    batchIds.length ? supabase.from("batches").select("id, name").in("id", batchIds) : Promise.resolve({ data: [] }),
  ]);
  const cand = new Map((cands.data ?? []).map((c) => [c.id, c]));
  const course = new Map((courses.data ?? []).map((c) => [c.id, c.title]));
  const batch = new Map((batches.data ?? []).map((b) => [b.id, b.name]));
  return rows
    .map((r) => ({
      feePlanId: r.fee_plan_id,
      enrollmentId: r.enrollment_id,
      candidateId: r.candidate_id,
      candidateName: cand.get(r.candidate_id)?.full_name ?? "Candidate",
      phone: cand.get(r.candidate_id)?.phone ?? null,
      email: cand.get(r.candidate_id)?.email ?? null,
      courseTitle: course.get(r.course_id) ?? "Course",
      batchName: r.batch_id ? (batch.get(r.batch_id) ?? null) : null,
      installmentId: r.installment_id,
      seq: r.seq,
      label: r.label,
      dueDate: r.due_date,
      remaining: toPaise(r.remaining),
      currency: r.currency,
      daysOverdue: r.days_overdue,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.candidateName.localeCompare(b.candidateName));
}

/* -------------------------------------------------------------------------- */
/* Payments and expenses lists                                                 */
/* -------------------------------------------------------------------------- */

export const PAYMENT_LIST_SELECT =
  "id, receipt_number, paid_on, amount, currency, method, status, reference, notes, void_reason, recorded_by, created_at, enrollment_id, candidate_id, fee_plan_id, installment_id, gateway, candidates!inner(full_name), fee_plans!inner(course_id, courses(title)), enrollments!inner(batch_id, batches(name)), payment_refunds(amount, status), fee_installments(seq, label)";

export function paymentsQuery(supabase: Supabase, orgId: string, f: FinanceFilters) {
  let q = supabase.from("payments").select(PAYMENT_LIST_SELECT).eq("organization_id", orgId);
  if (f.from) q = q.gte("paid_on", f.from);
  if (f.to) q = q.lte("paid_on", f.to);
  if (f.course) q = q.eq("fee_plans.course_id", f.course);
  if (f.batch) q = q.eq("enrollments.batch_id", f.batch);
  if (f.method) q = q.eq("method", f.method as "upi");
  if (f.status && f.status !== "all" && f.status !== "refunded") q = q.eq("status", f.status as "completed");
  if (f.status === "refunded") q = q.eq("status", "completed");
  if (f.q) {
    const term = f.q.replace(/[%_,()"\\]/g, " ").trim();
    // Digits mean a receipt or transaction reference; words mean a name.
    if (term && /\d/.test(term)) q = q.or(`receipt_number.ilike.%${term}%,reference.ilike.%${term}%`);
    else if (term) q = q.ilike("candidates.full_name", `%${term}%`);
  }
  return q.order("paid_on", { ascending: false }).order("created_at", { ascending: false });
}

export type PaymentListRow = {
  id: string;
  receiptNumber: string | null;
  paidOn: string;
  amount: number;
  refunded: number;
  currency: string;
  method: string;
  status: "pending" | "completed" | "failed" | "voided";
  reference: string | null;
  notes: string | null;
  voidReason: string | null;
  recordedBy: string | null;
  createdAt: string;
  enrollmentId: string;
  candidateId: string;
  candidateName: string;
  courseTitle: string;
  batchName: string | null;
  installment: string;
  gateway: string | null;
};

type RawPayment = {
  id: string;
  receipt_number: string | null;
  paid_on: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  reference: string | null;
  notes: string | null;
  void_reason: string | null;
  recorded_by: string | null;
  created_at: string;
  enrollment_id: string;
  candidate_id: string;
  gateway: string | null;
  candidates: { full_name: string } | { full_name: string }[] | null;
  fee_plans: { course_id: string; courses: { title: string } | { title: string }[] | null } | { course_id: string; courses: { title: string } | { title: string }[] | null }[] | null;
  enrollments: { batch_id: string | null; batches: { name: string } | { name: string }[] | null } | { batch_id: string | null; batches: { name: string } | { name: string }[] | null }[] | null;
  payment_refunds: { amount: number; status: string }[] | null;
  fee_installments: { seq: number; label: string | null } | { seq: number; label: string | null }[] | null;
};

export function toPaymentRow(r: RawPayment): PaymentListRow {
  const plan = one(r.fee_plans);
  const enr = one(r.enrollments);
  const inst = one(r.fee_installments);
  return {
    id: r.id,
    receiptNumber: r.receipt_number,
    paidOn: r.paid_on,
    amount: toPaise(r.amount),
    refunded: (r.payment_refunds ?? []).filter((x) => x.status === "completed").reduce((s, x) => s + toPaise(x.amount), 0),
    currency: r.currency,
    method: r.method,
    status: r.status as PaymentListRow["status"],
    reference: r.reference,
    notes: r.notes,
    voidReason: r.void_reason,
    recordedBy: r.recorded_by,
    createdAt: r.created_at,
    enrollmentId: r.enrollment_id,
    candidateId: r.candidate_id,
    candidateName: one(r.candidates)?.full_name ?? "Candidate",
    courseTitle: one(plan?.courses)?.title ?? "—",
    batchName: one(enr?.batches)?.name ?? null,
    installment: inst ? inst.label || `Installment ${inst.seq}` : "",
    gateway: r.gateway,
  };
}

export const EXPENSE_LIST_SELECT =
  "id, category_id, spent_on, amount, currency, description, vendor, method, reference, notes, receipt_url, course_id, batch_id, status, void_reason, created_by, created_at, expense_categories(name), courses(title), batches(name)";

export function expensesQuery(supabase: Supabase, orgId: string, f: FinanceFilters) {
  let q = supabase.from("expenses").select(EXPENSE_LIST_SELECT).eq("organization_id", orgId);
  if (f.from) q = q.gte("spent_on", f.from);
  if (f.to) q = q.lte("spent_on", f.to);
  if (f.course) q = q.eq("course_id", f.course);
  if (f.batch) q = q.eq("batch_id", f.batch);
  if (f.category) q = q.eq("category_id", f.category);
  if (f.status === "voided") q = q.eq("status", "voided");
  else if (f.status !== "all") q = q.eq("status", "recorded");
  if (f.q) {
    const term = f.q.replace(/[%_,()"\\]/g, " ").trim();
    if (term) q = q.or(`description.ilike.%${term}%,vendor.ilike.%${term}%,reference.ilike.%${term}%`);
  }
  return q.order("spent_on", { ascending: false }).order("created_at", { ascending: false });
}

export type ExpenseCategory = { id: string; name: string; position: number; is_active: boolean };

export async function getExpenseCategories(supabase: Supabase, orgId: string): Promise<ExpenseCategory[]> {
  const { data } = await supabase.from("expense_categories").select("id, name, position, is_active").eq("organization_id", orgId).order("position").order("name");
  return data ?? [];
}

/* -------------------------------------------------------------------------- */
/* One enrollment's fees                                                       */
/* -------------------------------------------------------------------------- */

export type ScheduleRow = { id: string; seq: number; label: string | null; dueDate: string; amount: number; paid: number; remaining: number; status: "paid" | "partially_paid" | "due" | "overdue" };

export async function getSchedule(supabase: Supabase, planId: string): Promise<ScheduleRow[]> {
  const { data, error } = await supabase.rpc("fee_plan_schedule", { p_plan: planId });
  if (error) {
    logError("fee schedule failed", error.code);
    throw new Error("Could not load the installment schedule.");
  }
  return (data ?? []).map((s) => ({
    id: s.installment_id,
    seq: s.seq,
    label: s.label,
    dueDate: s.due_date,
    amount: toPaise(s.amount),
    paid: toPaise(s.paid),
    remaining: toPaise(s.remaining),
    status: s.status as ScheduleRow["status"],
  }));
}

export type PlanBalance = { finalFee: number; gross: number; refunded: number; net: number; outstanding: number; credit: number; currency: string };

export async function getBalances(supabase: Supabase, orgId: string, planIds: string[]): Promise<Map<string, PlanBalance>> {
  if (!planIds.length) return new Map();
  const { data } = await supabase.from("fee_plan_balances").select("*").eq("organization_id", orgId).in("fee_plan_id", planIds);
  return new Map(
    (data ?? []).map((b) => [
      b.fee_plan_id as string,
      {
        finalFee: toPaise(b.final_fee),
        gross: toPaise(b.gross_paid),
        refunded: toPaise(b.refunded),
        net: toPaise(b.net_paid),
        outstanding: toPaise(b.outstanding),
        credit: toPaise(b.credit),
        currency: b.currency ?? "INR",
      },
    ]),
  );
}

/** Which installment a reminder or payment link is for: the earliest unpaid one. */
export function nextUnpaid(schedule: ScheduleRow[]): ScheduleRow | null {
  return schedule.find((s) => s.remaining > 0) ?? null;
}

export const installmentName = (s: { seq: number; label: string | null }) => s.label || `Installment ${s.seq}`;
