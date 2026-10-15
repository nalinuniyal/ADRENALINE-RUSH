"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { zonedToUtc } from "@/lib/format";
import { removeGoogleEvent, syncSessionWithGoogle } from "@/lib/google/integration";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { attendanceSchema, sessionFollowUpSchema, sessionSchema, type SessionFormOutput } from "@/lib/validation/batches";
import type { ActionResult } from "./batches";

type PgError = { code?: string; message?: string } | null;
const idSchema = z.uuid();
const FRIENDLY_CODES = new Set(["ARCAP", "ARDUP", "ARBST", "ARCRS", "ARATT"]);

function dbMessage(error: PgError, fallback: string): string {
  if (error?.code && FRIENDLY_CODES.has(error.code) && error.message) return error.message;
  if (error?.code === "23505") return "Another class in this batch already starts at that time.";
  if (error?.code === "23514") return "Some values were not accepted. Check the dates, times and links.";
  if (error?.code === "42501") return "You do not have permission to do that.";
  console.error(JSON.stringify({ level: "error", msg: fallback, code: error?.code }));
  return fallback;
}

const notFound = (): ActionResult => ({ ok: false, message: "That session could not be found. Refresh the page and try again." });

function revalidateSession(sessionId?: string, batchId?: string | null) {
  revalidatePath("/admin/calendar", "layout");
  if (sessionId) revalidatePath(`/admin/calendar/sessions/${sessionId}`, "layout");
  if (batchId) revalidatePath(`/admin/batches/${batchId}`, "layout");
  revalidatePath("/admin");
}

function sessionColumns(v: SessionFormOutput) {
  const manual = v.meetingMode === "manual";
  return {
    title: v.title,
    description: v.description,
    prep_notes: v.prepNotes,
    notes: v.notes,
    starts_at: zonedToUtc(v.date, v.startTime, v.timezone),
    ends_at: zonedToUtc(v.date, v.endTime, v.timezone),
    timezone: v.timezone,
    instructor_id: v.instructorId,
    status: v.status,
    recording_url: v.recordingUrl,
    google_add_attendees: v.meetingMode === "google" && v.addAttendees,
    meeting_source: v.meetingMode === "none" ? null : v.meetingMode,
    meeting_url: manual ? v.meetingUrl : null,
  };
}

export type SessionActionResult = ActionResult & { googleError?: string };

async function afterSave(orgId: string, sessionId: string, wantsGoogle: boolean, hadEvent: boolean, baseMessage: string): Promise<SessionActionResult> {
  if (!wantsGoogle && !hadEvent) return { ok: true, id: sessionId, message: baseMessage };
  const sync = await syncSessionWithGoogle(orgId, sessionId);
  if (sync.ok) return { ok: true, id: sessionId, message: [baseMessage, sync.message].filter(Boolean).join(" ") };
  return { ok: true, id: sessionId, message: `${baseMessage} Google Calendar was not updated.`, googleError: sync.message };
}

async function setInvitees(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, orgId: string, userId: string, sessionId: string, ids: string[]) {
  const current = await supabase.from("session_attendees").select("candidate_id").eq("session_id", sessionId);
  const have = new Set((current.data ?? []).map((r) => r.candidate_id));
  const want = new Set(ids);
  const remove = [...have].filter((id) => !want.has(id));
  const add = [...want].filter((id) => !have.has(id));
  if (remove.length) await supabase.from("session_attendees").delete().eq("session_id", sessionId).in("candidate_id", remove);
  if (add.length) {
    const { error } = await supabase
      .from("session_attendees")
      .insert(add.map((candidate_id) => ({ session_id: sessionId, candidate_id, organization_id: orgId, added_by: userId })));
    if (error) return dbMessage(error, "Some invitees could not be added.");
  }
  return null;
}

export async function createSession(input: unknown): Promise<SessionActionResult> {
  const access = await assertPermission(["sessions.manage"]);
  const parsed = sessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const orgId = access.organization.id;

  let courseId = v.courseId;
  if (v.kind === "class") {
    const batch = await supabase.from("batches").select("course_id").eq("id", v.batchId!).eq("organization_id", orgId).maybeSingle();
    if (!batch.data) return { ok: false, fieldErrors: { batchId: ["Choose a batch"] }, message: "Please fix the highlighted fields." };
    courseId = batch.data.course_id;
  }
  const { data, error } = await supabase
    .from("class_sessions")
    .insert({ ...sessionColumns(v), organization_id: orgId, kind: v.kind, batch_id: v.kind === "class" ? v.batchId : null, course_id: courseId!, created_by: access.userId })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: dbMessage(error, "Could not save the session. Please try again.") };

  let note = "";
  if (v.kind === "demo" && v.attendeeIds.length) {
    const err = await setInvitees(supabase, orgId, access.userId, data.id, v.attendeeIds);
    if (err) note = ` ${err}`;
  }
  revalidateSession(data.id, v.batchId);
  return afterSave(orgId, data.id, v.meetingMode === "google", false, `Session saved.${note}`);
}

export async function updateSession(sessionId: string, input: unknown): Promise<SessionActionResult> {
  const access = await assertPermission(["sessions.manage"]);
  if (!idSchema.safeParse(sessionId).success) return notFound();
  const parsed = sessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const orgId = access.organization.id;
  const supabase = await createSupabaseServerClient();
  const current = await supabase
    .from("class_sessions")
    .select("id, kind, batch_id, meeting_source, meeting_url, google_event_id")
    .eq("id", sessionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!current.data) return notFound();

  const cols = sessionColumns({ ...v, kind: current.data.kind as "class" | "demo" });
  // Keep an existing Google Meet link while Google stays selected.
  if (v.meetingMode === "google" && current.data.meeting_source === "google") cols.meeting_url = current.data.meeting_url;
  const { error } = await supabase.from("class_sessions").update(cols).eq("id", sessionId).eq("organization_id", orgId);
  if (error) return { ok: false, message: dbMessage(error, "Could not save the session. Please try again.") };

  let note = "";
  if (current.data.kind === "demo") {
    const err = await setInvitees(supabase, orgId, access.userId, sessionId, v.attendeeIds);
    if (err) note = ` ${err}`;
  }
  revalidateSession(sessionId, current.data.batch_id);
  return afterSave(orgId, sessionId, v.meetingMode === "google", Boolean(current.data.google_event_id), `Session saved.${note}`);
}

export async function cancelSession(sessionId: string): Promise<SessionActionResult> {
  const access = await assertPermission(["sessions.manage"]);
  if (!idSchema.safeParse(sessionId).success) return notFound();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId)
    .eq("organization_id", access.organization.id)
    .select("id, batch_id, google_event_id");
  if (error) return { ok: false, message: dbMessage(error, "Could not cancel the session.") };
  if (!data?.length) return notFound();
  revalidateSession(sessionId, data[0].batch_id);
  return afterSave(access.organization.id, sessionId, false, Boolean(data[0].google_event_id), "Session cancelled.");
}

export async function restoreSession(sessionId: string): Promise<SessionActionResult> {
  const access = await assertPermission(["sessions.manage"]);
  if (!idSchema.safeParse(sessionId).success) return notFound();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .update({ status: "scheduled" })
    .eq("id", sessionId)
    .eq("organization_id", access.organization.id)
    .select("id, batch_id, meeting_source");
  if (error) return { ok: false, message: dbMessage(error, "Could not restore the session.") };
  if (!data?.length) return notFound();
  revalidateSession(sessionId, data[0].batch_id);
  return afterSave(access.organization.id, sessionId, data[0].meeting_source === "google", false, "Session restored.");
}

export async function deleteSession(sessionId: string): Promise<SessionActionResult> {
  const access = await assertPermission(["sessions.manage"]);
  if (!idSchema.safeParse(sessionId).success) return notFound();
  const supabase = await createSupabaseServerClient();
  const orgId = access.organization.id;
  const current = await supabase.from("class_sessions").select("id, batch_id, google_event_id, google_add_attendees").eq("id", sessionId).eq("organization_id", orgId).maybeSingle();
  if (!current.data) return notFound();
  const attendance = await supabase.from("attendance_records").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
  if ((attendance.count ?? 0) > 0) return { ok: false, message: "Attendance has been recorded for this session, so it cannot be deleted. Cancel it instead." };

  let googleError: string | undefined;
  if (current.data.google_event_id) {
    googleError = (await removeGoogleEvent(orgId, current.data.google_event_id, current.data.google_add_attendees)) ?? undefined;
  }
  const { error } = await supabase.from("class_sessions").delete().eq("id", sessionId).eq("organization_id", orgId);
  if (error) return { ok: false, message: dbMessage(error, "Could not delete the session.") };
  revalidateSession(undefined, current.data.batch_id);
  return {
    ok: true,
    message: "Session deleted.",
    googleError: googleError ? `The Google Calendar event could not be removed (${googleError}). Delete it in Google Calendar.` : undefined,
  };
}

export async function retryGoogleSync(sessionId: string): Promise<SessionActionResult> {
  const access = await assertPermission(["sessions.manage"]);
  if (!idSchema.safeParse(sessionId).success) return notFound();
  const sync = await syncSessionWithGoogle(access.organization.id, sessionId);
  revalidateSession(sessionId);
  return sync.ok ? { ok: true, message: sync.message || "Google Calendar is up to date." } : { ok: false, message: sync.message, googleError: sync.message };
}

/* -------------------------------------------------------------------------- */
/* Attendance and recordings                                                   */
/* -------------------------------------------------------------------------- */

export async function saveAttendance(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["attendance.record"]);
  const parsed = attendanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Some marks were not valid. Refresh and try again." };
  const { sessionId, marks } = parsed.data;
  const orgId = access.organization.id;
  const supabase = await createSupabaseServerClient();
  const session = await supabase.from("class_sessions").select("id, batch_id").eq("id", sessionId).eq("organization_id", orgId).maybeSingle();
  if (!session.data) return notFound();

  const set = marks.filter((m) => m.status !== "");
  const cleared = marks.filter((m) => m.status === "").map((m) => m.candidateId);
  if (set.length) {
    const { error } = await supabase.from("attendance_records").upsert(
      set.map((m) => ({ organization_id: orgId, session_id: sessionId, candidate_id: m.candidateId, status: m.status as "present", note: m.note })),
      { onConflict: "session_id,candidate_id" },
    );
    if (error) return { ok: false, message: dbMessage(error, "Could not save attendance. Please try again.") };
  }
  if (cleared.length) {
    const { error } = await supabase.from("attendance_records").delete().eq("session_id", sessionId).in("candidate_id", cleared);
    if (error) return { ok: false, message: dbMessage(error, "Could not clear some marks.") };
  }
  revalidateSession(sessionId, session.data.batch_id);
  for (const m of marks) revalidatePath(`/admin/candidates/${m.candidateId}`);
  return { ok: true, message: `Attendance saved for ${set.length} ${set.length === 1 ? "person" : "people"}.` };
}

export async function saveSessionFollowUp(input: unknown): Promise<ActionResult> {
  await assertPermission(["attendance.record", "sessions.manage"]);
  const parsed = sessionFollowUpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Paste a full recording link starting with https://", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_session_outcome", {
    p_session: parsed.data.sessionId,
    // null clears the link (the generated type does not know the argument is nullable).
    p_recording_url: parsed.data.recordingUrl as string,
    p_completed: parsed.data.markCompleted,
  });
  if (error) return { ok: false, message: dbMessage(error, "Could not save. Please try again.") };
  revalidateSession(parsed.data.sessionId);
  return { ok: true, message: "Saved." };
}
