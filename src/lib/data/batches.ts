import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BatchStatus } from "@/lib/validation/batches";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type InstructorOption = { value: string; label: string };

/** Owner/admin/instructor members (only returned to batch/session managers). */
export async function getInstructorOptions(supabase: Supabase, orgId: string, currentUserId: string): Promise<InstructorOption[]> {
  const { data, error } = await supabase.rpc("list_instructor_options", { p_org: orgId });
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "instructor options failed", code: error.code }));
    return [];
  }
  return (data ?? []).map((m) => {
    const name = m.full_name || m.email;
    const role = m.role === "instructor" ? "" : ` (${m.role})`;
    return { value: m.user_id, label: m.user_id === currentUserId ? `${name} (me)` : `${name}${role}` };
  });
}

export type BatchOption = { id: string; name: string; courseId: string; courseTitle: string; status: BatchStatus; timezone: string; instructorId: string | null; defaultMeetingUrl: string | null };

/** Batches the user can see that can still take students or classes. */
export async function getBatchOptions(supabase: Supabase, orgId: string, opts: { includeClosed?: boolean } = {}): Promise<BatchOption[]> {
  let q = supabase
    .from("batches")
    .select("id, name, course_id, status, timezone, instructor_id, default_meeting_url, start_date, courses(title)")
    .eq("organization_id", orgId);
  if (!opts.includeClosed) q = q.not("status", "in", "(completed,cancelled)");
  const { data } = await q.order("start_date", { ascending: false, nullsFirst: false }).order("name").limit(300);
  return (data ?? []).map((b) => {
    const course = Array.isArray(b.courses) ? b.courses[0] : b.courses;
    return {
      id: b.id,
      name: b.name,
      courseId: b.course_id,
      courseTitle: course?.title ?? "—",
      status: b.status as BatchStatus,
      timezone: b.timezone,
      instructorId: b.instructor_id,
      defaultMeetingUrl: b.default_meeting_url,
    };
  });
}

export type AttendanceRow = { session_id: string; candidate_id: string; status: "present" | "absent" | "late" | "excused" };

/** Attendance for a set of sessions, in pages so large batches are complete. */
export async function getAttendanceFor(supabase: Supabase, sessionIds: string[]): Promise<AttendanceRow[]> {
  const out: AttendanceRow[] = [];
  for (let i = 0; i < sessionIds.length; i += 150) {
    const chunk = sessionIds.slice(i, i + 150);
    const { data } = await supabase.from("attendance_records").select("session_id, candidate_id, status").in("session_id", chunk).limit(10000);
    out.push(...((data ?? []) as AttendanceRow[]));
  }
  return out;
}
