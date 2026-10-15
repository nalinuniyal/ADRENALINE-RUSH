import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import type { Access } from "@/lib/auth/session";
import { summarize, type AttendanceMark } from "@/lib/batches/attendance";
import { getBatchOptions } from "@/lib/data/batches";
import { formatDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EnrollmentStatus } from "@/lib/validation/batches";
import { EnrollmentStatusBadge, PercentBadge } from "../../batches/_components/badges";
import { EnrollInBatch } from "./enroll-in-batch";

/** Enrollment history with attendance, plus "Enroll in batch", for the candidate profile. */
export async function CandidateEnrollments({ candidateId, access }: { candidateId: string; access: Access }) {
  const p = access.permissions;
  const canEnroll = p.includes("enrollments.manage") && p.includes("batches.view");
  const supabase = await createSupabaseServerClient();
  const [enrRes, attRes, batchOptions] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id, status, enrolled_at, batch_id, batches(name), courses(title)")
      .eq("candidate_id", candidateId)
      .order("enrolled_at", { ascending: false }),
    supabase.from("attendance_records").select("status, session_id, class_sessions(batch_id, status)").eq("candidate_id", candidateId).limit(2000),
    canEnroll ? getBatchOptions(supabase, access.organization.id) : Promise.resolve([]),
  ]);
  const enrollments = enrRes.data ?? [];
  const batchIds = [...new Set(enrollments.map((e) => e.batch_id).filter((v): v is string => Boolean(v)))];
  const sessionsRes = batchIds.length
    ? await supabase.from("class_sessions").select("batch_id").in("batch_id", batchIds).neq("status", "cancelled").limit(5000)
    : { data: [] as { batch_id: string | null }[] };
  const totals = new Map<string, number>();
  for (const s of sessionsRes.data ?? []) if (s.batch_id) totals.set(s.batch_id, (totals.get(s.batch_id) ?? 0) + 1);
  const marksByBatch = new Map<string, AttendanceMark[]>();
  for (const a of attRes.data ?? []) {
    const s = Array.isArray(a.class_sessions) ? a.class_sessions[0] : a.class_sessions;
    if (!s?.batch_id || s.status === "cancelled") continue;
    marksByBatch.set(s.batch_id, [...(marksByBatch.get(s.batch_id) ?? []), a.status as AttendanceMark]);
  }
  const enrolledIn = new Set(enrollments.filter((e) => !["dropped", "cancelled"].includes(e.status)).map((e) => e.batch_id));
  const choices = batchOptions.filter((b) => !enrolledIn.has(b.id)).map((b) => ({ id: b.id, label: `${b.name} — ${b.courseTitle}` }));

  return (
    <Card>
      <CardHeader icon={<IconTile icon={GraduationCap} color="teal" size="sm" />} actions={canEnroll ? <EnrollInBatch candidateId={candidateId} batches={choices} /> : undefined}>
        <CardTitle>Enrollments ({enrollments.length})</CardTitle>
        <CardDescription>Batches, status and attendance.</CardDescription>
      </CardHeader>
      <CardContent>
        {enrollments.length === 0 ? (
          <p className="text-sm text-muted">Not enrolled in any batch yet.</p>
        ) : (
          <ul className="grid gap-2">
            {enrollments.map((e) => {
              const batch = Array.isArray(e.batches) ? e.batches[0] : e.batches;
              const course = Array.isArray(e.courses) ? e.courses[0] : e.courses;
              const s = summarize(e.batch_id ? (marksByBatch.get(e.batch_id) ?? []) : []);
              const total = e.batch_id ? (totals.get(e.batch_id) ?? 0) : 0;
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {e.batch_id && batch ? (
                        <Link href={`/admin/batches/${e.batch_id}`} className="text-brand-700 hover:underline">
                          {batch.name}
                        </Link>
                      ) : (
                        (course?.title ?? "Course")
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {course?.title ?? "—"} · enrolled {formatDate(e.enrolled_at, access.organization.timezone)}
                      {e.batch_id ? ` · ${s.attended}/${total} classes attended` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <EnrollmentStatusBadge status={e.status as EnrollmentStatus} />
                    {e.batch_id ? <PercentBadge percent={s.percent} label="attendance" /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
