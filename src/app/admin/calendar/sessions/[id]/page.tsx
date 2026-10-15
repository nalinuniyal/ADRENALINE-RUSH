import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarDays, ClipboardCheck, Clapperboard, Pencil, Video } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { requireAccess } from "@/lib/auth/session";
import { summarize, type AttendanceMark } from "@/lib/batches/attendance";
import { getMemberNames } from "@/lib/data/candidates";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ENROLLMENT_STATUS_LABELS, type EnrollmentStatus, type SessionStatus } from "@/lib/validation/batches";
import { PercentBadge, SessionStatusBadge } from "../../../batches/_components/badges";
import { MeetingBadge, MeetingLink } from "../../_components/meeting";
import { AttendanceForm, RecordingForm, RetryGoogleButton, SessionActions } from "../../_components/session-actions";

export const metadata: Metadata = { title: "Session" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function SessionPage({ params, searchParams }: PageProps<"/admin/calendar/sessions/[id]">) {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[70vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading session" />}>
      <SessionDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SessionDetail({ params, searchParams }: { params: PageProps<"/admin/calendar/sessions/[id]">["params"]; searchParams: PageProps<"/admin/calendar/sessions/[id]">["searchParams"] }) {
  const { access, denied } = await requireAccess(["sessions.view"]);
  if (denied) return <AccessDenied />;
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const canManage = access.permissions.includes("sessions.manage");
  const canRecord = access.permissions.includes("attendance.record");
  const orgTz = access.organization.timezone;

  const supabase = await createSupabaseServerClient();
  const { data: s, error } = await supabase
    .from("class_sessions")
    .select("*, batches(id, name), courses(title)")
    .eq("id", id)
    .eq("organization_id", access.organization.id)
    .maybeSingle();
  if (error) throw new Error("Could not load this session.");
  if (!s) notFound();
  const batch = Array.isArray(s.batches) ? s.batches[0] : s.batches;
  const course = Array.isArray(s.courses) ? s.courses[0] : s.courses;
  const status = s.status as SessionStatus;
  const [peopleRes, members] = await Promise.all([supabase.rpc("get_session_people", { p_session: id }), getMemberNames(supabase, access.organization.id)]);
  const people = peopleRes.data ?? [];
  const summary = summarize(people.flatMap((p) => (p.attendance ? [p.attendance as AttendanceMark] : [])));
  const lastMark = people.filter((p) => p.recorded_at).sort((a, b) => (a.recorded_at! < b.recorded_at! ? 1 : -1))[0];

  const now = new Date().getTime();
  const opensAt = new Date(s.starts_at).getTime() - 30 * 60_000;
  const attendanceBlocked =
    status === "cancelled" ? "This session was cancelled, so attendance cannot be recorded." : now < opensAt ? `Attendance opens 30 minutes before the session starts (${formatDateTime(new Date(opensAt), s.timezone)}).` : null;

  const isGoogle = s.meeting_source === "google";
  const tzNote = s.timezone !== orgTz ? ` (${formatTime(s.starts_at, orgTz)} ${orgTz})` : "";

  return (
    <>
      <PageHeader
        icon={CalendarDays}
        color="pink"
        crumbs={[
          { label: "Calendar", href: "/admin/calendar" },
          ...(batch ? [{ label: batch.name, href: `/admin/batches/${batch.id}` }] : [{ label: "Demo sessions" }]),
          { label: s.title },
        ]}
        title={s.title}
        description={
          <>
            {s.kind === "demo" ? "Demo session" : "Class"} · {course?.title ?? "—"}
          </>
        }
        actions={
          canManage ? (
            <>
              <Link href={`/admin/calendar/sessions/${s.id}/edit`} className={buttonVariants({ variant: "secondary" })}>
                <Pencil className="size-4" aria-hidden /> Edit
              </Link>
              <SessionActions sessionId={s.id} status={status} batchId={s.batch_id} />
            </>
          ) : undefined
        }
        details={[
          { label: "Date", value: formatDate(s.starts_at, s.timezone) },
          { label: "Time", value: `${formatTime(s.starts_at, s.timezone)}–${formatTime(s.ends_at, s.timezone)} ${s.timezone}${tzNote}` },
          { label: "Status", value: <SessionStatusBadge status={status} /> },
          { label: "Instructor", value: s.instructor_id ? (members.get(s.instructor_id)?.name ?? "—") : "Not assigned" },
          { label: "Attendance", value: <PercentBadge percent={summary.percent} label="attendance for this session" /> },
        ]}
      />

      {sp.saved === "1" && sp.google !== "failed" ? (
        <Alert tone="success" className="mb-4">
          Session saved.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 content-start gap-4 lg:col-span-2">
          <Card>
            <CardHeader icon={<IconTile icon={Video} color="green" size="sm" />}>
              <CardTitle>Meeting link</CardTitle>
              <CardDescription>
                <MeetingBadge source={s.meeting_source} url={s.meeting_url} syncStatus={s.google_sync_status} />
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {s.meeting_url ? <MeetingLink url={s.meeting_url} /> : <p className="text-sm text-muted">No meeting link yet.</p>}
              {isGoogle && s.google_synced_at && s.google_sync_status === "synced" ? (
                <p className="text-xs text-muted">Created in Google Calendar · last updated {formatDateTime(s.google_synced_at, orgTz)}</p>
              ) : null}
              {s.google_sync_status === "failed" ? (
                <Alert tone="warning" title="Google Calendar was not updated">
                  <p>{s.google_sync_error ?? "The last attempt failed."} The session itself is saved.</p>
                  {canManage ? (
                    <div className="mt-2">
                      <RetryGoogleButton sessionId={s.id} />
                    </div>
                  ) : null}
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card id="attendance">
            <CardHeader icon={<IconTile icon={ClipboardCheck} color="teal" size="sm" />}>
              <CardTitle>Attendance</CardTitle>
              <CardDescription>
                {summary.present} present · {summary.late} late · {summary.absent} absent · {summary.excused} excused
                {lastMark?.recorded_at ? ` · last updated by ${members.get(lastMark.recorded_by ?? "")?.name ?? "a team member"} ${formatDateTime(lastMark.recorded_at, orgTz)}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canRecord ? (
                <AttendanceForm
                  sessionId={s.id}
                  disabledReason={attendanceBlocked}
                  people={people.map((p) => ({
                    candidateId: p.candidate_id,
                    name: p.full_name,
                    email: p.email,
                    status: (p.attendance ?? "") as AttendanceMark | "",
                    note: p.note ?? "",
                    detail: p.enrollment_status && p.enrollment_status !== "active" ? ENROLLMENT_STATUS_LABELS[p.enrollment_status as EnrollmentStatus] : undefined,
                  }))}
                />
              ) : people.length ? (
                <ul className="divide-y divide-line text-sm">
                  {people.map((p) => (
                    <li key={p.candidate_id} className="flex justify-between gap-2 py-2">
                      <span>{p.full_name}</span>
                      <span className="text-muted">{p.attendance ?? "Not marked"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{s.kind === "demo" ? "No one is invited yet. Edit the session to choose who is attending." : "No students are enrolled in this batch yet."}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          {canRecord || canManage ? (
            <Card>
              <CardHeader icon={<IconTile icon={Clapperboard} color="orange" size="sm" />}>
                <CardTitle>After the session</CardTitle>
              </CardHeader>
              <CardContent>
                <RecordingForm sessionId={s.id} recordingUrl={s.recording_url ?? ""} completed={status === "completed"} cancelled={status === "cancelled"} />
              </CardContent>
            </Card>
          ) : s.recording_url ? (
            <Card>
              <CardHeader>
                <CardTitle>Recording</CardTitle>
              </CardHeader>
              <CardContent>
                <MeetingLink url={s.recording_url} />
              </CardContent>
            </Card>
          ) : null}

          {s.description || s.prep_notes ? (
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {s.description ? <p className="whitespace-pre-line">{s.description}</p> : null}
                {s.prep_notes ? (
                  <div>
                    <p className="text-xs font-semibold text-muted uppercase">Preparation</p>
                    <p className="whitespace-pre-line">{s.prep_notes}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {s.notes && canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Internal notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{s.notes}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
