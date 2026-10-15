import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UsersRound } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAccess } from "@/lib/auth/session";
import { getInstructorOptions } from "@/lib/data/batches";
import { getCourseOptions } from "@/lib/data/candidates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/validation/batches";
import { emptyBatchForm, timeZoneList } from "../_components/batch-data";
import { BatchForm } from "../_components/batch-form";

export const metadata: Metadata = { title: "New batch" };

export default function NewBatchPage({ searchParams }: PageProps<"/admin/batches/new">) {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[60vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading" />}>
      <NewBatch searchParams={searchParams} />
    </Suspense>
  );
}

async function NewBatch({ searchParams }: { searchParams: PageProps<"/admin/batches/new">["searchParams"] }) {
  const { access, denied } = await requireAccess(["batches.manage"]);
  if (denied) return <AccessDenied />;
  const supabase = await createSupabaseServerClient();
  const [courses, instructors] = await Promise.all([getCourseOptions(supabase, access.organization.id), getInstructorOptions(supabase, access.organization.id, access.userId)]);
  const course = firstParam((await searchParams).course) ?? "";

  return (
    <>
      <PageHeader
        title="New batch"
        icon={UsersRound}
        color="teal"
        crumbs={[{ label: "Batches", href: "/admin/batches" }, { label: "New batch" }]}
        description="A batch is one cohort of a course with its own dates, schedule, capacity and students."
      />
      {courses.length === 0 ? (
        <EmptyState
          title="Create a course first"
          description="Every batch belongs to a course."
          action={
            <Link href="/admin/courses/new" className={buttonVariants()}>
              New course
            </Link>
          }
        />
      ) : (
        <Card>
          <CardContent className="py-5">
            <BatchForm
              initial={emptyBatchForm(access.organization.timezone, courses.some((c) => c.id === course) ? course : "")}
              courses={courses.map((c) => ({ value: c.id, label: c.status === "draft" ? `${c.title} (draft)` : c.title }))}
              instructors={instructors}
              timeZones={timeZoneList(access.organization.timezone)}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
