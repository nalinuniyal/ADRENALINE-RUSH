"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { generateSchedule } from "@/lib/batches/schedule";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchConditions } from "@/lib/validation/candidates";
import {
  batchSchema,
  enrollmentStatusSchema,
  enrollSchema,
  generateSessionsSchema,
  transferSchema,
  type BatchFormOutput,
} from "@/lib/validation/batches";

export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  id?: string;
};

type PgError = { code?: string; message?: string } | null;

const idSchema = z.uuid();
/** Error codes raised by our own triggers carry messages written for people. */
const FRIENDLY_CODES = new Set(["ARCAP", "ARDUP", "ARBST", "ARCRS", "ARATT"]);

function logError(msg: string, error: PgError) {
  console.error(JSON.stringify({ level: "error", msg, code: error?.code }));
}

function dbMessage(error: PgError, fallback: string): string {
  if (error?.code && FRIENDLY_CODES.has(error.code) && error.message) return error.message;
  if (error?.code === "23505") return "That already exists. Refresh the page and check.";
  if (error?.code === "23503") return error.message?.includes("instructor") ? "The instructor must be an active team member." : "Something this refers to no longer exists. Refresh and try again.";
  if (error?.code === "42501") return "You do not have permission to do that.";
  logError(fallback, error);
  return fallback;
}

const notFound = (): ActionResult => ({ ok: false, message: "That item could not be found. Refresh the page and try again." });

function revalidateBatches(batchId?: string) {
  revalidatePath("/admin/batches");
  if (batchId) revalidatePath(`/admin/batches/${batchId}`, "layout");
  revalidatePath("/admin/calendar", "layout");
}

function batchColumns(v: BatchFormOutput) {
  return {
    course_id: v.courseId,
    name: v.name,
    code: v.code,
    start_date: v.startDate,
    end_date: v.endDate,
    timezone: v.timezone,
    class_days: v.classDays,
    start_time: v.startTime,
    end_time: v.endTime,
    schedule_note: v.scheduleNote,
    capacity: v.capacity,
    delivery_mode: v.deliveryMode,
    instructor_id: v.instructorId,
    default_meeting_url: v.defaultMeetingUrl,
    status: v.status,
    notes: v.notes,
  };
}

function batchWriteError(error: PgError): ActionResult {
  if (error?.code === "23505") return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { code: ["Another batch already uses this code."] } };
  if (error?.code === "23503" && error.message?.includes("instructor")) return { ok: false, fieldErrors: { instructorId: ["Choose an active team member"] }, message: "Please fix the highlighted fields." };
  if (error?.code === "23503") return { ok: false, fieldErrors: { courseId: ["That course no longer exists"] }, message: "Please fix the highlighted fields." };
  if (error?.code === "23514" && error.message?.includes("course of a batch")) return { ok: false, fieldErrors: { courseId: ["The course cannot change once students are enrolled"] }, message: "Please fix the highlighted fields." };
  return { ok: false, message: dbMessage(error, "Could not save the batch. Please try again.") };
}

/* -------------------------------------------------------------------------- */
/* Batches                                                                     */
/* -------------------------------------------------------------------------- */

export async function createBatch(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["batches.manage"]);
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("batches")
    .insert({ ...batchColumns(parsed.data), organization_id: access.organization.id, created_by: access.userId })
    .select("id")
    .single();
  if (error || !data) return batchWriteError(error);
  revalidateBatches();
  return { ok: true, id: data.id, message: "Batch created." };
}

export async function updateBatch(batchId: string, input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["batches.manage"]);
  if (!idSchema.safeParse(batchId).success) return notFound();
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("batches")
    .update(batchColumns(parsed.data))
    .eq("id", batchId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) return batchWriteError(error);
  if (!data?.length) return notFound();
  revalidateBatches(batchId);
  return { ok: true, id: batchId, message: "Batch saved." };
}

/** Only empty batches can be deleted; others are cancelled or completed to keep history. */
export async function deleteBatch(batchId: string): Promise<ActionResult> {
  const access = await assertPermission(["batches.manage"]);
  if (!idSchema.safeParse(batchId).success) return notFound();
  const supabase = await createSupabaseServerClient();
  const [enr, ses] = await Promise.all([
    supabase.from("enrollments").select("id", { count: "exact", head: true }).eq("batch_id", batchId),
    supabase.from("class_sessions").select("id", { count: "exact", head: true }).eq("batch_id", batchId),
  ]);
  if ((enr.count ?? 0) > 0 || (ses.count ?? 0) > 0) {
    return { ok: false, message: "This batch has enrollments or sessions, so it cannot be deleted. Set its status to Cancelled or Completed instead." };
  }
  const { data, error } = await supabase.from("batches").delete().eq("id", batchId).eq("organization_id", access.organization.id).select("id");
  if (error) {
    return { ok: false, message: error.code === "23503" ? "This batch has enrollments or sessions, so it cannot be deleted. Cancel it instead." : dbMessage(error, "Could not delete the batch.") };
  }
  if (!data?.length) return notFound();
  revalidateBatches();
  return { ok: true, message: "Batch deleted." };
}

/* -------------------------------------------------------------------------- */
/* Enrollments                                                                 */
/* -------------------------------------------------------------------------- */

export type CandidateHit = { id: string; fullName: string; detail: string; enrolled: boolean };

/** Candidates the user can see, matching a name/email/phone, flagged when already in the batch. */
export async function searchCandidatesForBatch(batchId: string, q: string): Promise<CandidateHit[]> {
  const access = await assertPermission(["enrollments.manage"]);
  if (!idSchema.safeParse(batchId).success) return [];
  const conds = searchConditions(String(q ?? "").slice(0, 80));
  if (!conds.length) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("candidates")
    .select("id, full_name, email, phone, company")
    .eq("organization_id", access.organization.id)
    .eq("is_archived", false)
    .or(conds.join(","))
    .order("full_name")
    .limit(10);
  const ids = (data ?? []).map((c) => c.id);
  const existing = ids.length
    ? await supabase.from("enrollments").select("candidate_id").eq("batch_id", batchId).in("candidate_id", ids).not("status", "in", "(dropped,cancelled)")
    : { data: [] as { candidate_id: string }[] };
  const enrolled = new Set((existing.data ?? []).map((e) => e.candidate_id));
  return (data ?? []).map((c) => ({
    id: c.id,
    fullName: c.full_name,
    detail: [c.email, c.phone, c.company].filter(Boolean).join(" · "),
    enrolled: enrolled.has(c.id),
  }));
}

export async function enrollCandidate(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["enrollments.manage"]);
  const parsed = enrollSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a batch and a candidate.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const batch = await supabase.from("batches").select("id, course_id").eq("id", v.batchId).eq("organization_id", access.organization.id).maybeSingle();
  if (!batch.data) return { ok: false, message: "That batch could not be found." };
  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      organization_id: access.organization.id,
      candidate_id: v.candidateId,
      batch_id: v.batchId,
      course_id: batch.data.course_id,
      status: v.status,
      notes: v.notes,
      created_by: access.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "42501") return { ok: false, message: "You can only enroll candidates you can see in the CRM." };
    if (error?.code === "23505") return { ok: false, message: "This candidate is already enrolled in this batch." };
    return { ok: false, message: dbMessage(error, "Could not enroll the candidate. Please try again.") };
  }
  revalidateBatches(v.batchId);
  revalidatePath(`/admin/candidates/${v.candidateId}`);
  revalidatePath("/admin/candidates");
  return { ok: true, id: data.id, message: "Enrolled." };
}

export async function setEnrollmentStatus(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["enrollments.manage"]);
  const parsed = enrollmentStatusSchema.safeParse(input);
  if (!parsed.success) return notFound();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("enrollments")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.enrollmentId)
    .eq("organization_id", access.organization.id)
    .select("id, batch_id, candidate_id");
  if (error) return { ok: false, message: dbMessage(error, "Could not change the enrollment status.") };
  if (!data?.length) return notFound();
  revalidateBatches(data[0].batch_id ?? undefined);
  revalidatePath(`/admin/candidates/${data[0].candidate_id}`);
  return { ok: true, message: "Enrollment updated." };
}

export async function transferEnrollment(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["enrollments.manage"]);
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose the batch to move to." };
  const supabase = await createSupabaseServerClient();
  const current = await supabase.from("enrollments").select("batch_id").eq("id", parsed.data.enrollmentId).eq("organization_id", access.organization.id).maybeSingle();
  if (!current.data) return notFound();
  if (current.data.batch_id === parsed.data.batchId) return { ok: false, message: "The student is already in that batch." };
  const { data, error } = await supabase
    .from("enrollments")
    .update({ batch_id: parsed.data.batchId })
    .eq("id", parsed.data.enrollmentId)
    .eq("organization_id", access.organization.id)
    .select("id, candidate_id");
  if (error) {
    if (error.code === "23505") return { ok: false, message: "This student is already enrolled in that batch." };
    return { ok: false, message: dbMessage(error, "Could not transfer the student.") };
  }
  if (!data?.length) return notFound();
  revalidateBatches(current.data.batch_id ?? undefined);
  revalidateBatches(parsed.data.batchId);
  revalidatePath(`/admin/candidates/${data[0].candidate_id}`);
  return { ok: true, message: "Student transferred. Their attendance so far stays with them." };
}

/* -------------------------------------------------------------------------- */
/* Bulk session generation                                                     */
/* -------------------------------------------------------------------------- */

export async function generateBatchSessions(input: unknown): Promise<ActionResult & { created?: number; skipped?: number }> {
  const access = await assertPermission(["sessions.manage"]);
  const parsed = generateSessionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: batch } = await supabase
    .from("batches")
    .select("id, course_id, timezone, instructor_id, default_meeting_url, status")
    .eq("id", v.batchId)
    .eq("organization_id", access.organization.id)
    .maybeSingle();
  if (!batch) return notFound();
  if (batch.status === "cancelled") return { ok: false, message: "This batch is cancelled. Change its status before adding classes." };

  let planned;
  try {
    planned = generateSchedule({ startDate: v.startDate, endDate: v.endDate, weeks: v.weeks, days: v.days, startTime: v.startTime, endTime: v.endTime, timeZone: batch.timezone });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not build the schedule." };
  }
  if (!planned.length) return { ok: false, message: "No class days fall between those dates." };

  // Skip times that already have a (non-cancelled) class, so running this twice is safe.
  const { data: existing } = await supabase
    .from("class_sessions")
    .select("starts_at")
    .eq("batch_id", batch.id)
    .neq("status", "cancelled")
    .gte("starts_at", planned[0].startsAt)
    .lte("starts_at", planned[planned.length - 1].startsAt);
  const taken = new Set((existing ?? []).map((e) => new Date(e.starts_at).getTime()));
  const { count: before } = await supabase.from("class_sessions").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).neq("status", "cancelled");
  const fresh = planned.filter((p) => !taken.has(new Date(p.startsAt).getTime()));
  if (!fresh.length) return { ok: true, created: 0, skipped: planned.length, message: "All of those classes already exist. Nothing was added." };

  const offset = before ?? 0;
  const rows = fresh.map((p, i) => ({
    organization_id: access.organization.id,
    kind: "class",
    batch_id: batch.id,
    course_id: batch.course_id,
    title: `${v.titlePrefix} ${offset + i + 1}`.slice(0, 200),
    starts_at: p.startsAt,
    ends_at: p.endsAt,
    timezone: batch.timezone,
    instructor_id: batch.instructor_id,
    meeting_url: batch.default_meeting_url,
    meeting_source: batch.default_meeting_url ? "manual" : null,
    created_by: access.userId,
  }));
  const { error } = await supabase.from("class_sessions").insert(rows);
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Some of those classes were just added by someone else. Refresh and try again." };
    return { ok: false, message: dbMessage(error, "Could not create the classes. Please try again.") };
  }
  revalidateBatches(batch.id);
  const skipped = planned.length - fresh.length;
  return {
    ok: true,
    created: fresh.length,
    skipped,
    message: `${fresh.length} class${fresh.length === 1 ? "" : "es"} added${skipped ? ` (${skipped} already existed)` : ""}.`,
  };
}
