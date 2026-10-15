import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { UsersRound } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/session";
import { getInstructorOptions } from "@/lib/data/batches";
import { getCourseOptions } from "@/lib/data/candidates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { timeZoneList } from "../../_components/batch-data";
import { BatchForm } from "../../_components/batch-form";
import { DeleteBatchButton } from "../../_components/batch-actions";

export const metadata: Metadata = { title: "Edit batch" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EditBatchPage({ params }: PageProps<"/admin/batches/[id]/edit">) {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[60vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading" />}>
      <EditBatch params={params} />
    </Suspense>
  );
}

async function EditBatch({ params }: { params: PageProps<"/admin/batches/[id]/edit">["params"] }) {
  const { access, denied } = await requireAccess(["batches.manage"]);
  if (denied) return <AccessDenied />;
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: b } = await supabase.from("batches").select("*").eq("id", id).eq("organization_id", access.organization.id).maybeSingle();
  if (!b) notFound();
  const [courses, instructors] = await Promise.all([getCourseOptions(supabase, access.organization.id), getInstructorOptions(supabase, access.organization.id, access.userId)]);
  // Keep the current course selectable even if it was archived.
  const courseOptions = courses.map((c) => ({ value: c.id, label: c.title }));
  if (!courseOptions.some((c) => c.value === b.course_id)) {
    const cur = await supabase.from("courses").select("title").eq("id", b.course_id).maybeSingle();
    courseOptions.unshift({ value: b.course_id, label: `${cur.data?.title ?? "Current course"} (archived)` });
  }
  if (b.instructor_id && !instructors.some((i) => i.value === b.instructor_id)) instructors.unshift({ value: b.instructor_id, label: "Current instructor (no longer active)" });

  return (
    <>
      <PageHeader
        title={`Edit ${b.name}`}
        icon={UsersRound}
        color="teal"
        crumbs={[{ label: "Batches", href: "/admin/batches" }, { label: b.name, href: `/admin/batches/${b.id}` }, { label: "Edit" }]}
        actions={<DeleteBatchButton batchId={b.id} />}
      />
      <Card>
        <CardContent className="py-5">
          <BatchForm
            batchId={b.id}
            initial={{
              courseId: b.course_id,
              name: b.name,
              code: b.code ?? "",
              startDate: b.start_date ?? "",
              endDate: b.end_date ?? "",
              timezone: b.timezone,
              classDays: (b.class_days ?? []).map(String),
              startTime: b.start_time?.slice(0, 5) ?? "",
              endTime: b.end_time?.slice(0, 5) ?? "",
              scheduleNote: b.schedule_note ?? "",
              capacity: b.capacity?.toString() ?? "",
              deliveryMode: b.delivery_mode,
              instructorId: b.instructor_id ?? "",
              defaultMeetingUrl: b.default_meeting_url ?? "",
              status: b.status,
              notes: b.notes ?? "",
            }}
            courses={courseOptions}
            instructors={instructors}
            timeZones={timeZoneList(b.timezone)}
          />
        </CardContent>
      </Card>
    </>
  );
}
