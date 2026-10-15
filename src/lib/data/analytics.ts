import "server-only";
import type { DateRange } from "@/lib/analytics/range";
import type { CoursePerformanceRow, LeadSourceRow } from "@/lib/analytics/reports";
import { getFinanceSummary, type FinanceSummary } from "@/lib/data/finance";
import { toPaise } from "@/lib/finance/money";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Analytics reads. Every call goes through the signed-in user's RLS client to
 * SECURITY INVOKER functions (supabase/migrations/…_analytics.sql), so people
 * only ever count rows they may read. Money comes from the same
 * public.finance_summary() the finance overview uses, so the two always agree.
 */

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Period = Pick<DateRange, "from" | "to">;

function fail(msg: string, code?: string): never {
  console.error(JSON.stringify({ level: "error", msg, code }));
  throw new Error("Could not load the analytics. Please try again.");
}

const args = (orgId: string, r: Period) => ({ p_org: orgId, p_from: r.from, p_to: r.to });
const paiseOrNull = (v: number | string | null | undefined) => (v === null || v === undefined ? null : toPaise(v));

export type Kpis = {
  newLeads: number;
  registrations: number;
  demoBookings: number;
  demoEnrolled: number;
  enrollments: number;
  activeStudents: number;
  overdueFollowUps: number;
};

export async function getKpis(supabase: Supabase, orgId: string, r: Period): Promise<Kpis> {
  const { data, error } = await supabase.rpc("analytics_kpis", args(orgId, r));
  const k = data?.[0];
  if (error || !k) fail("analytics kpis failed", error?.code);
  return {
    newLeads: k.new_leads,
    registrations: k.registrations,
    demoBookings: k.demo_bookings,
    demoEnrolled: k.demo_enrolled,
    enrollments: k.enrollments,
    activeStudents: k.active_students,
    overdueFollowUps: k.overdue_follow_ups,
  };
}

/** Finance totals for the period, or null when the viewer lacks finance.view. */
export async function getMoneyTotals(supabase: Supabase, orgId: string, r: Period, canFinance: boolean): Promise<FinanceSummary | null> {
  if (!canFinance) return null;
  return getFinanceSummary(supabase, orgId, { from: r.from, to: r.to, course: "", batch: "" });
}

export type ActivityPoint = { bucket: string; leads: number; registrations: number; enrollments: number };

export async function getActivitySeries(supabase: Supabase, orgId: string, r: DateRange): Promise<ActivityPoint[]> {
  const { data, error } = await supabase.rpc("analytics_activity_series", { ...args(orgId, r), p_bucket: r.bucket });
  if (error) fail("analytics activity failed", error.code);
  return (data ?? []).map((d) => ({ bucket: d.bucket, leads: d.leads, registrations: d.registrations, enrollments: d.enrollments }));
}

export type MoneyPoint = { month: string; collections: number; refunds: number; expenses: number; net: number; cashResult: number };

export async function getMoneySeries(supabase: Supabase, orgId: string, r: Period): Promise<MoneyPoint[]> {
  const { data, error } = await supabase.rpc("analytics_money_series", args(orgId, r));
  if (error) fail("analytics money failed", error.code);
  return (data ?? []).map((d) => ({
    month: d.month,
    collections: toPaise(d.collections),
    refunds: toPaise(d.refunds),
    expenses: toPaise(d.expenses),
    net: toPaise(d.net),
    cashResult: toPaise(d.cash_result),
  }));
}

export type FunnelStage = { stage: number; key: string; label: string; candidates: number };

export async function getFunnel(supabase: Supabase, orgId: string, r: Period): Promise<FunnelStage[]> {
  const { data, error } = await supabase.rpc("analytics_funnel", args(orgId, r));
  if (error) fail("analytics funnel failed", error.code);
  return (data ?? []).map((d) => ({ stage: d.stage, key: d.key, label: d.label, candidates: d.candidates }));
}

export async function getLeadSources(supabase: Supabase, orgId: string, r: Period): Promise<LeadSourceRow[]> {
  const { data, error } = await supabase.rpc("analytics_lead_sources", args(orgId, r));
  if (error) fail("analytics sources failed", error.code);
  return (data ?? []).map((d) => ({
    channel: d.channel,
    medium: d.utm_medium ?? null,
    campaign: d.utm_campaign ?? null,
    leads: d.leads,
    demoBookings: d.demo_bookings,
    enrolled: d.enrolled,
  }));
}

export type CoursePerformance = CoursePerformanceRow & { courseId: string };

export async function getCoursePerformance(supabase: Supabase, orgId: string, r: Period): Promise<CoursePerformance[]> {
  const { data, error } = await supabase.rpc("analytics_course_performance", args(orgId, r));
  if (error) fail("analytics courses failed", error.code);
  return (data ?? []).map((d) => ({
    courseId: d.course_id,
    title: d.title,
    status: d.status,
    registrations: d.registrations,
    demoBookings: d.demo_bookings,
    enrollments: d.enrollments,
    collections: paiseOrNull(d.collections),
    refunds: paiseOrNull(d.refunds),
    revenue: paiseOrNull(d.revenue),
    outstanding: paiseOrNull(d.outstanding),
    currency: d.currency,
  }));
}

export type BatchAttendance = {
  batchId: string;
  batchName: string;
  courseTitle: string;
  sessions: number;
  markedSessions: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  rate: number | null;
};

export async function getBatchAttendance(supabase: Supabase, orgId: string, r: Period): Promise<BatchAttendance[]> {
  const { data, error } = await supabase.rpc("analytics_batch_attendance", args(orgId, r));
  if (error) fail("analytics attendance failed", error.code);
  return (data ?? []).map((d) => ({
    batchId: d.batch_id,
    batchName: d.batch_name,
    courseTitle: d.course_title,
    sessions: d.sessions,
    markedSessions: d.marked_sessions,
    present: d.present,
    late: d.late,
    absent: d.absent,
    excused: d.excused,
    rate: d.attendance_rate === null || d.attendance_rate === undefined ? null : Number(d.attendance_rate),
  }));
}

export type TopResource = { resourceId: string; title: string; shares: number; candidates: number };

export async function getTopResources(supabase: Supabase, orgId: string, r: Period, limit = 8): Promise<TopResource[]> {
  const { data, error } = await supabase.rpc("analytics_top_resources", { ...args(orgId, r), p_limit: limit });
  if (error) fail("analytics resources failed", error.code);
  return (data ?? []).map((d) => ({ resourceId: d.resource_id, title: d.title, shares: d.shares, candidates: d.candidates }));
}
