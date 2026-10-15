import type { NextRequest } from "next/server";
import { resolveRange, type DateRange } from "@/lib/analytics/range";
import {
  attendanceCsv,
  canExportReport,
  coursePerformanceCsv,
  enrollmentsCsv,
  leadSourcesCsv,
  leadsCsv,
  refundsCsv,
  reportByKey,
  type AttendanceRow,
  type EnrollmentRow,
  type LeadRow,
  type RefundRow,
} from "@/lib/analytics/reports";
import { getAccess } from "@/lib/auth/session";
import { getCoursePerformance, getLeadSources } from "@/lib/data/analytics";
import { getLeadStatuses, getMemberNames } from "@/lib/data/candidates";
import { PAYMENT_METHOD_LABELS, toPaise, type PaymentMethod } from "@/lib/finance/money";
import { formatDateTime, utcToZonedParts, zonedToUtc } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CHUNK = 1000;
const MAX_ROWS = 20_000;
const noStore = { "Cache-Control": "no-store" };

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Ctx = { supabase: Supabase; orgId: string; tz: string; range: DateRange; canFinance: boolean };
type Built = { body: string; rows: number; truncated: boolean };

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

class ExportError extends Error {}

/** UTC instants bounding the period's calendar days in the business time zone: [start, end). */
function bounds(r: DateRange, tz: string) {
  const next = new Date(`${r.to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: zonedToUtc(r.from, "00:00", tz), end: zonedToUtc(next.toISOString().slice(0, 10), "00:00", tz) };
}

/** Reads a query in chunks of 1000 (PostgREST's page size) up to MAX_ROWS. */
async function readAll<T>(make: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string } | null }>, what: string): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    const { data, error } = await make(from, from + CHUNK - 1);
    if (error) {
      if (error.code === "PGRST103") break;
      console.error(JSON.stringify({ level: "error", msg: `${what} export failed`, code: error.code }));
      throw new ExportError();
    }
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < CHUNK) break;
  }
  return { rows, truncated: rows.length >= MAX_ROWS };
}

async function leads({ supabase, orgId, tz, range }: Ctx): Promise<Built> {
  const { start, end } = bounds(range, tz);
  type Raw = { full_name: string; email: string | null; phone: string | null; source: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; city: string | null; company: string | null; created_at: string; lead_status_id: string | null; owner_id: string | null };
  const [statuses, members, { rows, truncated }] = await Promise.all([
    getLeadStatuses(supabase, orgId),
    getMemberNames(supabase, orgId),
    readAll<Raw>(
      (a, b) =>
        supabase
          .from("candidates")
          .select("full_name, email, phone, source, utm_source, utm_medium, utm_campaign, city, company, created_at, lead_status_id, owner_id")
          .eq("organization_id", orgId)
          .gte("created_at", start)
          .lt("created_at", end)
          .order("created_at", { ascending: true })
          .order("id")
          .range(a, b),
      "leads",
    ),
  ]);
  const status = new Map(statuses.map((s) => [s.id, s.label]));
  const list: LeadRow[] = rows.map((c) => ({
    name: c.full_name,
    email: c.email,
    phone: c.phone,
    status: c.lead_status_id ? (status.get(c.lead_status_id) ?? "") : "",
    owner: c.owner_id ? (members.get(c.owner_id)?.name ?? "") : "",
    source: c.source,
    utmSource: c.utm_source,
    utmMedium: c.utm_medium,
    utmCampaign: c.utm_campaign,
    city: c.city,
    company: c.company,
    createdAt: formatDateTime(c.created_at, tz),
  }));
  return { body: leadsCsv(list), rows: list.length, truncated };
}

async function leadSources({ supabase, orgId, range }: Ctx): Promise<Built> {
  const rows = await getLeadSources(supabase, orgId, range);
  return { body: leadSourcesCsv(rows), rows: rows.length, truncated: false };
}

async function coursePerformance({ supabase, orgId, range, canFinance }: Ctx): Promise<Built> {
  const rows = await getCoursePerformance(supabase, orgId, range);
  return { body: coursePerformanceCsv(rows, canFinance), rows: rows.length, truncated: false };
}

async function enrollments({ supabase, orgId, tz, range, canFinance }: Ctx): Promise<Built> {
  const { start, end } = bounds(range, tz);
  type Raw = { id: string; status: string; enrolled_at: string; candidates: { full_name: string; email: string | null } | null; courses: { title: string } | null; batches: { name: string } | null };
  const { rows, truncated } = await readAll<Raw>(
    (a, b) =>
      supabase
        .from("enrollments")
        .select("id, status, enrolled_at, candidates(full_name, email), courses(title), batches(name)")
        .eq("organization_id", orgId)
        .gte("enrolled_at", start)
        .lt("enrolled_at", end)
        .order("enrolled_at", { ascending: true })
        .order("id")
        .range(a, b),
    "enrollments",
  );
  const balances = new Map<string, { final: number; net: number; outstanding: number; currency: string }>();
  if (canFinance && rows.length) {
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from("fee_plan_balances").select("enrollment_id, final_fee, net_paid, outstanding, currency").eq("organization_id", orgId).in("enrollment_id", ids.slice(i, i + 200));
      if (error) {
        console.error(JSON.stringify({ level: "error", msg: "enrollment balances export failed", code: error.code }));
        throw new ExportError();
      }
      for (const b of data ?? []) {
        if (b.enrollment_id) balances.set(b.enrollment_id, { final: toPaise(b.final_fee), net: toPaise(b.net_paid), outstanding: toPaise(b.outstanding), currency: b.currency ?? "" });
      }
    }
  }
  const list: EnrollmentRow[] = rows.map((r) => {
    const c = one(r.candidates);
    const bal = balances.get(r.id);
    return {
      candidate: c?.full_name ?? "",
      email: c?.email ?? null,
      course: one(r.courses)?.title ?? "",
      batch: one(r.batches)?.name ?? "",
      status: r.status,
      enrolledAt: utcToZonedParts(r.enrolled_at, tz).date,
      finalFee: bal?.final ?? null,
      netPaid: bal?.net ?? null,
      outstanding: bal?.outstanding ?? null,
      currency: bal?.currency ?? null,
    };
  });
  return { body: enrollmentsCsv(list, canFinance), rows: list.length, truncated };
}

async function attendance({ supabase, orgId, tz, range }: Ctx): Promise<Built> {
  const { start, end } = bounds(range, tz);
  type Raw = {
    status: string;
    note: string | null;
    candidates: { full_name: string } | null;
    class_sessions: { title: string; kind: string; starts_at: string; batches: { name: string } | null; courses: { title: string } | null } | null;
  };
  const { rows, truncated } = await readAll<Raw>(
    (a, b) =>
      supabase
        .from("attendance_records")
        .select("status, note, candidates(full_name), class_sessions!inner(title, kind, starts_at, batches(name), courses(title))")
        .eq("organization_id", orgId)
        .gte("class_sessions.starts_at", start)
        .lt("class_sessions.starts_at", end)
        .order("recorded_at", { ascending: true })
        .order("id")
        .range(a, b),
    "attendance",
  );
  const sorted = rows
    .map((r) => ({ r, s: one(r.class_sessions) }))
    .sort((x, y) => (x.s?.starts_at ?? "").localeCompare(y.s?.starts_at ?? "") || (one(x.r.candidates)?.full_name ?? "").localeCompare(one(y.r.candidates)?.full_name ?? ""));
  const list: AttendanceRow[] = sorted.map(({ r, s }) => ({
    date: s ? formatDateTime(s.starts_at, tz) : "",
    session: s?.title ?? "",
    kind: s?.kind === "demo" ? "Demo" : "Class",
    batch: one(s?.batches)?.name ?? "",
    course: one(s?.courses)?.title ?? "",
    // People outside the viewer's CRM access stay anonymous.
    candidate: one(r.candidates)?.full_name ?? "(not visible to you)",
    status: r.status,
    note: r.note,
  }));
  return { body: attendanceCsv(list), rows: list.length, truncated };
}

async function refunds({ supabase, orgId, range }: Ctx): Promise<Built> {
  type Raw = {
    refunded_on: string;
    amount: number;
    method: string;
    reason: string;
    status: string;
    reference: string | null;
    payments: { receipt_number: string | null; currency: string; candidates: { full_name: string } | null } | null;
    fee_plans: { courses: { title: string } | null } | null;
  };
  const { rows, truncated } = await readAll<Raw>(
    (a, b) =>
      supabase
        .from("payment_refunds")
        .select("refunded_on, amount, method, reason, status, reference, payments(receipt_number, currency, candidates(full_name)), fee_plans(courses(title))")
        .eq("organization_id", orgId)
        .gte("refunded_on", range.from)
        .lte("refunded_on", range.to)
        .order("refunded_on", { ascending: true })
        .order("created_at")
        .range(a, b),
    "refunds",
  );
  const list: RefundRow[] = rows.map((r) => {
    const p = one(r.payments);
    return {
      refundedOn: r.refunded_on,
      candidate: one(p?.candidates)?.full_name ?? "",
      course: one(one(r.fee_plans)?.courses)?.title ?? "",
      receipt: p?.receipt_number ?? null,
      amount: toPaise(r.amount),
      currency: p?.currency ?? "",
      method: PAYMENT_METHOD_LABELS[r.method as PaymentMethod] ?? r.method,
      reason: r.reason,
      status: r.status,
      reference: r.reference,
    };
  });
  return { body: refundsCsv(list), rows: list.length, truncated };
}

const BUILDERS: Partial<Record<string, (c: Ctx) => Promise<Built>>> = {
  leads,
  "lead-sources": leadSources,
  "course-performance": coursePerformance,
  enrollments,
  attendance,
  refunds,
};

/**
 * CSV report for the chosen period. Needs reports.export (plus finance.view
 * for money reports); every query runs as the signed-in user, so RLS applies.
 * Payments and expenses are exported by the finance routes.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/admin/analytics/reports/[report]">) {
  const { report } = await ctx.params;
  const def = reportByKey(report);
  const build = def ? BUILDERS[def.key] : undefined;
  if (!def || !build) return new Response("Unknown report.", { status: 404, headers: noStore });

  const result = await getAccess();
  if (result.status !== "ok") return new Response("Sign in to export reports.", { status: 401, headers: noStore });
  const access = result.access;
  if (!access.permissions.includes("reports.view") || !canExportReport(def, access.permissions)) {
    return new Response("You do not have permission to export this report.", { status: 403, headers: noStore });
  }

  const tz = access.organization.timezone;
  const range = resolveRange(Object.fromEntries(request.nextUrl.searchParams.entries()), tz);
  if (range.error) return new Response(range.error, { status: 400, headers: noStore });
  const orgId = access.organization.id;
  const supabase = await createSupabaseServerClient();
  const canFinance = access.permissions.includes("finance.view");

  let built: Built;
  try {
    built = await build({ supabase, orgId, tz, range, canFinance });
  } catch (e) {
    if (!(e instanceof ExportError)) console.error(JSON.stringify({ level: "error", msg: "report export failed", report: def.key }));
    return new Response("Could not export the report. Please try again.", { status: 500, headers: noStore });
  }

  // Exports can contain personal data: record who exported what (no values). Fail closed.
  const { error: auditError } = await supabase.rpc("write_audit_log", {
    p_organization_id: orgId,
    p_action: "reports.export",
    p_entity_type: "report",
    p_details: { report: def.key, from: range.from, to: range.to, rows: built.rows, truncated: built.truncated, with_money: canFinance && (def.money || def.key === "enrollments" || def.key === "course-performance") },
  });
  if (auditError) {
    console.error(JSON.stringify({ level: "error", msg: "export audit failed", code: auditError.code }));
    return new Response("Could not export the report. Please try again.", { status: 500, headers: noStore });
  }

  return new Response("\uFEFF" + built.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${def.key}-${range.from}-to-${range.to}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
