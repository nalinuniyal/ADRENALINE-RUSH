import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarDays } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/session";
import { utcToZonedParts } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MeetingMode } from "@/lib/validation/batches";
import { timeZoneList } from "../../../../batches/_components/batch-data";
import { sessionFormOptions } from "../../../_components/session-data";
import { SessionForm } from "../../../_components/session-form";

export const metadata: Metadata = { title: "Edit session" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EditSessionPage({ params }: PageProps<"/admin/calendar/sessions/[id]/edit">) {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[60vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading" />}>
      <EditSession params={params} />
    </Suspense>
  );
}

async function EditSession({ params }: { params: PageProps<"/admin/calendar/sessions/[id]/edit">["params"] }) {
  const { access, denied } = await requireAccess(["sessions.manage"]);
  if (denied) return <AccessDenied />;
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: s } = await supabase.from("class_sessions").select("*").eq("id", id).eq("organization_id", access.organization.id).maybeSingle();
  if (!s) notFound();
  const [opts, invitees] = await Promise.all([
    sessionFormOptions(supabase, access),
    s.kind === "demo" ? supabase.from("session_attendees").select("candidate_id").eq("session_id", id) : Promise.resolve({ data: [] as { candidate_id: string }[] }),
  ]);
  // A closed batch is not in the options list; keep it selectable for this session.
  if (s.batch_id && !opts.batches.some((b) => b.id === s.batch_id)) {
    const b = await supabase.from("batches").select("name").eq("id", s.batch_id).maybeSingle();
    opts.batches.unshift({ id: s.batch_id, label: b.data?.name ?? "Current batch", timezone: s.timezone, instructorId: null, defaultMeetingUrl: null });
  }
  if (!opts.courses.some((c) => c.value === s.course_id)) opts.courses.unshift({ value: s.course_id, label: "Current course" });
  const start = utcToZonedParts(s.starts_at, s.timezone);
  const end = utcToZonedParts(s.ends_at, s.timezone);
  const meetingMode: MeetingMode = s.meeting_source === "google" ? "google" : s.meeting_url ? "manual" : "none";

  return (
    <>
      <PageHeader
        title={`Edit ${s.title}`}
        icon={CalendarDays}
        color="pink"
        crumbs={[{ label: "Calendar", href: "/admin/calendar" }, { label: s.title, href: `/admin/calendar/sessions/${s.id}` }, { label: "Edit" }]}
      />
      <Card>
        <CardContent className="py-5">
          <SessionForm
            sessionId={s.id}
            initial={{
              kind: s.kind as "class" | "demo",
              batchId: s.batch_id ?? "",
              courseId: s.course_id,
              title: s.title,
              date: start.date,
              startTime: start.time,
              // A session never spans midnight in its own zone in practice; if it does, keep the wall time.
              endTime: end.time,
              timezone: s.timezone,
              instructorId: s.instructor_id ?? "",
              description: s.description ?? "",
              prepNotes: s.prep_notes ?? "",
              notes: s.notes ?? "",
              meetingMode,
              meetingUrl: meetingMode === "manual" ? (s.meeting_url ?? "") : "",
              recordingUrl: s.recording_url ?? "",
              status: s.status,
              addAttendees: s.google_add_attendees,
              attendeeIds: (invitees.data ?? []).map((r) => r.candidate_id),
            }}
            batches={opts.batches}
            courses={opts.courses}
            instructors={opts.instructors}
            demoPeople={opts.demoPeople}
            google={opts.google}
            canConnectGoogle={opts.canConnectGoogle}
            timeZones={timeZoneList(s.timezone)}
          />
        </CardContent>
      </Card>
    </>
  );
}
