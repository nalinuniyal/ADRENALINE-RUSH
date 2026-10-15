/**
 * The report catalogue and the CSV layouts of the reports built by
 * /admin/analytics/reports/[report]. Client-safe: no server imports.
 * Amounts are plain "1234.50" (no symbol) so spreadsheets can add them up;
 * every cell goes through csvCell (formula-injection protection).
 */
import { toCsv } from "@/lib/csv";
import { paiseToString } from "@/lib/finance/money";

export type ReportKey = "leads" | "lead-sources" | "enrollments" | "attendance" | "course-performance" | "payments" | "refunds" | "expenses";

export type ReportDef = {
  key: ReportKey;
  title: string;
  description: string;
  /** Needs finance.view as well as reports.export. */
  money: boolean;
  /** Needs a CRM view permission (candidate names and contact details). */
  crm?: boolean;
  /** Handled by an existing finance export route (same filters). */
  href?: string;
  dateField: string;
};

export const REPORTS: ReportDef[] = [
  { key: "leads", title: "Leads and candidates", description: "Every lead created in the period with status, owner, source and UTM campaign.", money: false, crm: true, dateField: "date the lead was created" },
  { key: "lead-sources", title: "Lead sources and campaigns", description: "Leads, demo bookings and enrollments per source, medium and UTM campaign.", money: false, dateField: "date the lead was created" },
  { key: "enrollments", title: "Enrollments", description: "Enrollments with course, batch and status. Fee columns are included when you can view finance.", money: false, crm: true, dateField: "enrollment date" },
  { key: "attendance", title: "Attendance", description: "Attendance marks for class and demo sessions held in the period.", money: false, dateField: "session date" },
  { key: "course-performance", title: "Course performance", description: "Registrations, demos, enrollments and conversion per course; revenue and dues when you can view finance.", money: false, dateField: "registration, enrollment and payment dates" },
  { key: "payments", title: "Payments and collections", description: "Every payment with receipt number, method, status and refunds.", money: true, href: "/admin/finance/payments/export", dateField: "payment date" },
  { key: "refunds", title: "Refunds", description: "Refunds paid out, with the original receipt and reason.", money: true, dateField: "refund date" },
  { key: "expenses", title: "Expenses", description: "Recorded expenses with category, vendor and linked course or batch.", money: true, href: "/admin/finance/expenses/export", dateField: "expense date" },
];

export const reportByKey = (key: string) => REPORTS.find((r) => r.key === key) ?? null;

/** Who may download a report. */
export function canExportReport(def: ReportDef, permissions: readonly string[]): boolean {
  if (!permissions.includes("reports.export")) return false;
  if (def.money && !permissions.includes("finance.view")) return false;
  if (def.crm && !permissions.includes("candidates.view_all") && !permissions.includes("candidates.view_assigned")) return false;
  return true;
}

/** "0.0"–"100.0" or "" when there is nothing to divide by. */
export function percent(part: number, whole: number): string {
  if (!whole) return "";
  return (Math.round((part / whole) * 1000) / 10).toFixed(1);
}

const money = (paise: number | null | undefined) => (paise === null || paise === undefined ? "" : paiseToString(paise));

export type CoursePerformanceRow = {
  title: string;
  status: string;
  registrations: number;
  demoBookings: number;
  enrollments: number;
  collections: number | null;
  refunds: number | null;
  revenue: number | null;
  outstanding: number | null;
  currency: string;
};

export function coursePerformanceCsv(rows: CoursePerformanceRow[], withMoney: boolean): string {
  const headers = ["Course", "Status", "Registrations", "Demo bookings", "Enrollments", "Conversion % (enrollments / registrations)"];
  if (withMoney) headers.push("Collections", "Refunds", "Net collections", "Outstanding today", "Currency");
  return toCsv(
    headers,
    rows.map((r) => {
      const base: unknown[] = [r.title, r.status, r.registrations, r.demoBookings, r.enrollments, percent(r.enrollments, r.registrations)];
      if (withMoney) base.push(money(r.collections), money(r.refunds), money(r.revenue), money(r.outstanding), r.currency);
      return base;
    }),
  );
}

export type LeadSourceRow = { channel: string; medium: string | null; campaign: string | null; leads: number; demoBookings: number; enrolled: number };

export function leadSourcesCsv(rows: LeadSourceRow[]): string {
  return toCsv(
    ["Source", "UTM medium", "UTM campaign", "Leads", "Demo bookings", "Enrolled", "Lead → enrollment %"],
    rows.map((r) => [r.channel, r.medium, r.campaign, r.leads, r.demoBookings, r.enrolled, percent(r.enrolled, r.leads)]),
  );
}

export type LeadRow = {
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  owner: string;
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  city: string | null;
  company: string | null;
  createdAt: string;
};

export function leadsCsv(rows: LeadRow[]): string {
  return toCsv(
    ["Name", "Email", "Phone", "Lead status", "Owner", "Source", "UTM source", "UTM medium", "UTM campaign", "City", "Company", "Created"],
    rows.map((r) => [r.name, r.email, r.phone, r.status, r.owner, r.source, r.utmSource, r.utmMedium, r.utmCampaign, r.city, r.company, r.createdAt]),
  );
}

export type EnrollmentRow = {
  candidate: string;
  email: string | null;
  course: string;
  batch: string;
  status: string;
  enrolledAt: string;
  finalFee: number | null;
  netPaid: number | null;
  outstanding: number | null;
  currency: string | null;
};

export function enrollmentsCsv(rows: EnrollmentRow[], withMoney: boolean): string {
  const headers = ["Candidate", "Email", "Course", "Batch", "Status", "Enrolled on"];
  if (withMoney) headers.push("Final fee", "Net paid", "Outstanding today", "Currency");
  return toCsv(
    headers,
    rows.map((r) => {
      const base: unknown[] = [r.candidate, r.email, r.course, r.batch, r.status, r.enrolledAt];
      if (withMoney) base.push(money(r.finalFee), money(r.netPaid), money(r.outstanding), r.currency ?? "");
      return base;
    }),
  );
}

export type AttendanceRow = { date: string; session: string; kind: string; batch: string; course: string; candidate: string; status: string; note: string | null };

export function attendanceCsv(rows: AttendanceRow[]): string {
  return toCsv(
    ["Session date", "Session", "Type", "Batch", "Course", "Person", "Status", "Note"],
    rows.map((r) => [r.date, r.session, r.kind, r.batch, r.course, r.candidate, r.status, r.note]),
  );
}

export type RefundRow = { refundedOn: string; candidate: string; course: string; receipt: string | null; amount: number; currency: string; method: string; reason: string; status: string; reference: string | null };

export function refundsCsv(rows: RefundRow[]): string {
  return toCsv(
    ["Refund date", "Candidate", "Course", "Original receipt", "Amount", "Currency", "Method", "Reason", "Status", "Reference"],
    rows.map((r) => [r.refundedOn, r.candidate, r.course, r.receipt, paiseToString(r.amount), r.currency, r.method, r.reason, r.status === "voided" ? "Voided" : "Paid out", r.reference]),
  );
}
