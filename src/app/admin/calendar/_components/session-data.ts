import "server-only";
import type { Access } from "@/lib/auth/session";
import { getBatchOptions, getInstructorOptions } from "@/lib/data/batches";
import { getCourseOptions } from "@/lib/data/candidates";
import { getGoogleStatus } from "@/lib/google/integration";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BatchChoice, DemoPerson } from "./session-form";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Everything the session form needs: batches, courses, instructors, demo requesters, Google status. */
export async function sessionFormOptions(supabase: Supabase, access: Access) {
  const orgId = access.organization.id;
  const [batches, courses, instructors, google, demoRegs] = await Promise.all([
    getBatchOptions(supabase, orgId),
    getCourseOptions(supabase, orgId),
    getInstructorOptions(supabase, orgId, access.userId),
    getGoogleStatus(supabase, orgId),
    supabase
      .from("course_registrations")
      .select("course_id, created_at, candidates(id, full_name, email, phone)")
      .eq("organization_id", orgId)
      .eq("channel", "demo_request")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const demoPeople: Record<string, DemoPerson[]> = {};
  const seen = new Set<string>();
  for (const r of demoRegs.data ?? []) {
    const c = Array.isArray(r.candidates) ? r.candidates[0] : r.candidates;
    if (!c || !r.course_id || seen.has(`${r.course_id}:${c.id}`)) continue;
    seen.add(`${r.course_id}:${c.id}`);
    (demoPeople[r.course_id] ??= []).push({ id: c.id, name: c.full_name, detail: [c.email, c.phone].filter(Boolean).join(" · ") });
  }

  const batchChoices: BatchChoice[] = batches.map((b) => ({
    id: b.id,
    label: `${b.name} — ${b.courseTitle}`,
    timezone: b.timezone,
    instructorId: b.instructorId,
    defaultMeetingUrl: b.defaultMeetingUrl,
  }));

  return {
    batches: batchChoices,
    rawBatches: batches,
    courses: courses.map((c) => ({ value: c.id, label: c.title })),
    instructors,
    demoPeople,
    google: google.configured && google.state === "connected" ? ("connected" as const) : ("unavailable" as const),
    canConnectGoogle: access.permissions.includes("integrations.manage"),
  };
}
