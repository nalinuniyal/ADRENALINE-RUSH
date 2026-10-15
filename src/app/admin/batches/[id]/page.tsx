import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarDays, CalendarPlus, ClipboardCheck, Pencil, UserPlus, UsersRound } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { requireAccess } from "@/lib/auth/session";
import { summarize, summarizeByCandidate, type AttendanceMark } from "@/lib/batches/attendance";
import { scheduleSummary } from "@/lib/batches/schedule";
import { getAttendanceFor, getBatchOptions } from "@/lib/data/batches";
import { getMemberNames } from "@/lib/data/candidates";
import { deliveryLabel, formatDate, formatTime, utcToZonedParts } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { SEAT_STATUSES, type BatchStatus, type EnrollmentStatus, type SessionStatus } from "@/lib/validation/batches";
import { MeetingBadge } from "../../calendar/_components/meeting";
import { BatchStatusBadge, EnrollmentStatusBadge, PercentBadge, SessionStatusBadge, seatsText } from "../_components/badges";
import { EnrollForm, EnrollmentControls, GenerateSessionsForm } from "../_components/batch-actions";
import { BatchFeeSummary } from "../../finance/_components/batch-fee-summary";

export const metadata: Metadata = { title: "Batch" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function BatchPage({ params, searchParams }: PageProps<"/admin/batches/[id]">) {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[70vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading batch" />}>
      <BatchDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function BatchDetail({ params, searchParams }: { params: PageProps<"/admin/batches/[id]">["params"]; searchParams: PageProps<"/admin/batches/[id]">["searchParams"] }) {
  const { access, denied } = await requireAccess(["batches.view"]);
  if (denied) return <AccessDenied />;
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const created = (await searchParams).created === "1";
  const p = access.permissions;
  const canManage = p.includes("batches.manage");
  const canEnroll = p.includes("enrollments.manage");
  const canSessions = p.includes("sessions.manage");
  const canAttendance = p.includes("attendance.record");
  const orgTz = access.organization.timezone;
  const orgId = access.organization.id;

  const supabase = await createSupabaseServerClient();
  const { data: b, error } = await supabase.from("batches").select("*, courses(title)").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error("Could not load this batch.");
  if (!b) notFound();
  const course = Array.isArray(b.courses) ? b.courses[0] : b.courses;
  const status = b.status as BatchStatus;

  const [rosterRes, sessionsRes, members, otherBatches] = await Promise.all([
    supabase.rpc("get_batch_roster", { p_batch: id }),
    supabase
      .from("class_sessions")
      .select("id, title, starts_at, ends_at, timezone, status, meeting_url, meeting_source, recording_url, google_sync_status")
      .eq("batch_id", id)
      .order("starts_at")
      .limit(500),
    getMemberNames(supabase, orgId),
    canEnroll ? getBatchOptions(supabase, orgId) : Promise.resolve([]),
  ]);
  const roster = rosterRes.data ?? [];
  const sessions = sessionsRes.data ?? [];
  const liveSessions = sessions.filter((s) => s.status !== "cancelled");
  const attendance = await getAttendanceFor(
    supabase,
    liveSessions.map((s) => s.id),
  );
  const byCandidate = summarizeByCandidate(
    attendance.map((a) => ({ candidateId: a.candidate_id, sessionId: a.session_id, status: a.status as AttendanceMark })),
    new Set(liveSessions.map((s) => s.id)),
  );
  const marksBySession = new Map<string, number>();
  for (const a of attendance) marksBySession.set(a.session_id, (marksBySession.get(a.session_id) ?? 0) + 1);
  const seated = roster.filter((r) => SEAT_STATUSES.includes(r.status as EnrollmentStatus));
  const seatedIds = new Set(seated.map((r) => r.candidate_id));
  const overall = summarize(attendance.filter((a) => seatedIds.has(a.candidate_id)).map((a) => a.status as AttendanceMark));
  const now = new Date().getTime();
  const held = liveSessions.filter((s) => new Date(s.starts_at).getTime() <= now).length;
  const next = liveSessions.find((s) => new Date(s.ends_at).getTime() >= now);
  const transferTargets = otherBatches.filter((o) => o.courseId === b.course_id && o.id !== b.id).map((o) => ({ id: o.id, label: o.name }));
  const full = b.capacity !== null && seated.length >= b.capacity;
  const tz = b.timezone;

  const schedule = b.schedule_note || scheduleSummary(b.class_days, b.start_time, b.end_time) || "Not set";
  const startDefault = b.start_date && b.start_date > utcToZonedParts(new Date().toISOString(), tz).date ? b.start_date : utcToZonedParts(new Date().toISOString(), tz).date;

  return (
    <>
      <PageHeader
        icon={UsersRound}
        color="teal"
        crumbs={[{ label: "Batches", href: "/admin/batches" }, { label: b.name }]}
        title={b.name}
        description={
          <>
            {course?.title ?? "—"}
            {b.code ? ` · ${b.code}` : ""}
          </>
        }
        actions={
          <>
            <BatchStatusBadge status={status} />
            {canSessions ? (
              <Link href={`/admin/calendar/sessions/new?batch=${b.id}`} className={buttonVariants({ variant: "secondary" })}>
                <CalendarPlus className="size-4" aria-hidden /> Add session
              </Link>
            ) : null}
            {canManage ? (
              <Link href={`/admin/batches/${b.id}/edit`} className={buttonVariants({ variant: "secondary" })}>
                <Pencil className="size-4" aria-hidden /> Edit
              </Link>
            ) : null}
          </>
        }
        details={[
          { label: "Dates", value: b.start_date ? `${formatDate(b.start_date)}${b.end_date ? ` – ${formatDate(b.end_date)}` : ""}` : "Not set" },
          { label: "Schedule", value: schedule },
          { label: "Time zone", value: tz },
          { label: "Instructor", value: b.instructor_id ? (members.get(b.instructor_id)?.name ?? "—") : "Not assigned" },
          { label: "Seats", value: seatsText(seated.length, b.capacity) },
          { label: "Delivery", value: deliveryLabel(b.delivery_mode) },
          { label: "Attendance", value: <PercentBadge percent={overall.percent} label="batch attendance" /> },
          { label: "Classes held", value: `${held} of ${liveSessions.length}` },
        ]}
      />

      {created ? (
        <Alert tone="success" className="mb-4" title="Batch created">
          Next: enroll students below, then generate the class schedule.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 content-start gap-4 lg:col-span-2">
          <Card>
            <CardHeader icon={<IconTile icon={UsersRound} color="teal" size="sm" />}>
              <CardTitle>Students ({seated.length})</CardTitle>
              <CardDescription>
                Attendance % = present or late ÷ classes marked (excused left out). Progress = classes attended ÷ all {liveSessions.length} scheduled.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {roster.length === 0 ? (
                <p className="text-sm text-muted">No one is enrolled yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {roster.map((r) => {
                    const s = byCandidate.get(r.candidate_id) ?? summarize([]);
                    const inactive = !SEAT_STATUSES.includes(r.status as EnrollmentStatus);
                    return (
                      <li key={r.enrollment_id} className={cn("flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between", inactive && "opacity-70")}>
                        <div className="min-w-0">
                          <p className="font-medium">
                            {r.can_view_candidate ? (
                              <Link href={`/admin/candidates/${r.candidate_id}`} className="text-brand-700 hover:underline">
                                {r.full_name}
                              </Link>
                            ) : (
                              r.full_name
                            )}
                          </p>
                          <p className="text-xs text-muted">{[r.email, r.phone].filter(Boolean).join(" · ") || "Contact details hidden"}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                            <EnrollmentStatusBadge status={r.status as EnrollmentStatus} />
                            <PercentBadge percent={s.percent} label="attendance" />
                            <span className="text-muted">
                              {s.attended}/{liveSessions.length} attended · since {formatDate(r.enrolled_at, orgTz)}
                            </span>
                          </div>
                        </div>
                        {canEnroll && r.can_view_candidate ? (
                          <EnrollmentControls enrollmentId={r.enrollment_id} status={r.status as EnrollmentStatus} name={r.full_name} transferTargets={transferTargets} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              icon={<IconTile icon={CalendarDays} color="pink" size="sm" />}
              actions={
                canSessions ? (
                  <Link href={`/admin/calendar/sessions/new?batch=${b.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    <CalendarPlus className="size-4" aria-hidden /> Add
                  </Link>
                ) : undefined
              }
            >
              <CardTitle>Classes ({liveSessions.length})</CardTitle>
              <CardDescription>Times in {tz}.</CardDescription>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-sm text-muted">No classes scheduled yet.{canSessions ? " Use “Generate classes” to create the whole schedule at once." : ""}</p>
              ) : (
                <ol className="divide-y divide-line">
                  {sessions.map((s) => {
                    const past = new Date(s.starts_at).getTime() <= now;
                    const marks = marksBySession.get(s.id) ?? 0;
                    return (
                      <li key={s.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2.5", next?.id === s.id && "rounded-md bg-brand-50/60 px-2")}>
                        <div className="min-w-0">
                          <Link href={`/admin/calendar/sessions/${s.id}`} className={cn("font-medium text-brand-700 hover:underline", s.status === "cancelled" && "line-through")}>
                            {s.title}
                          </Link>
                          <p className="text-xs text-muted">
                            {formatDate(s.starts_at, s.timezone)} · {formatTime(s.starts_at, s.timezone)}–{formatTime(s.ends_at, s.timezone)}
                            {next?.id === s.id ? " · Next" : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {s.status !== "scheduled" ? <SessionStatusBadge status={s.status as SessionStatus} /> : null}
                          <MeetingBadge source={s.meeting_source} url={s.meeting_url} syncStatus={s.google_sync_status} compact />
                          {past && s.status !== "cancelled" ? (
                            <Link
                              href={`/admin/calendar/sessions/${s.id}#attendance`}
                              className={cn("inline-flex items-center gap-1 text-xs", marks ? "text-success-700" : "font-semibold text-warning-700")}
                            >
                              <ClipboardCheck className="size-3.5" aria-hidden />
                              {marks ? `${marks} marked` : canAttendance ? "Mark attendance" : "Not marked"}
                            </Link>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          {p.includes("finance.view") ? (
            <Suspense fallback={<div className="ar-skeleton h-28 rounded-[var(--radius-card)]" />}>
              <BatchFeeSummary batchId={b.id} access={access} />
            </Suspense>
          ) : null}

          {canEnroll ? (
            <Card>
              <CardHeader icon={<IconTile icon={UserPlus} color="blue" size="sm" />}>
                <CardTitle>Enroll a student</CardTitle>
                <CardDescription>{full ? "This batch is full." : b.capacity ? `${b.capacity - seated.length} seat${b.capacity - seated.length === 1 ? "" : "s"} left.` : "No seat limit."}</CardDescription>
              </CardHeader>
              <CardContent>
                <EnrollForm
                  batchId={b.id}
                  disabledReason={
                    status === "cancelled" || status === "completed"
                      ? `This batch is ${status}. Change its status to enroll more students.`
                      : full
                        ? "All seats are taken. Raise the capacity (Edit) or drop/transfer someone first."
                        : null
                  }
                />
              </CardContent>
            </Card>
          ) : null}

          {canSessions && status !== "cancelled" ? (
            <Card>
              <CardHeader icon={<IconTile icon={CalendarPlus} color="pink" size="sm" />}>
                <CardTitle>Generate classes</CardTitle>
                <CardDescription>Create the schedule in one go{b.default_meeting_url ? ", with the batch’s default meeting link" : ""}.</CardDescription>
              </CardHeader>
              <CardContent>
                <GenerateSessionsForm
                  batchId={b.id}
                  defaults={{
                    startDate: startDefault,
                    endDate: b.end_date ?? "",
                    days: b.class_days ?? [],
                    startTime: b.start_time?.slice(0, 5) ?? "",
                    endTime: b.end_time?.slice(0, 5) ?? "",
                    timezone: tz,
                  }}
                />
              </CardContent>
            </Card>
          ) : null}

          {b.default_meeting_url ? (
            <Card>
              <CardHeader>
                <CardTitle>Default meeting link</CardTitle>
              </CardHeader>
              <CardContent>
                <a href={b.default_meeting_url} target="_blank" rel="noopener noreferrer" className="text-sm break-all text-brand-700 hover:underline">
                  {b.default_meeting_url}
                </a>
              </CardContent>
            </Card>
          ) : null}

          {b.notes && canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Internal notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{b.notes}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
