import type { Metadata } from "next";
import { Suspense } from "react";
import { BookOpen } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CourseForm } from "../_components/course-form";
import { emptyCourseForm } from "../_components/course-data";

export const metadata: Metadata = { title: "New course" };

export default function NewCoursePage() {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[60vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading" />}>
      <NewCourse />
    </Suspense>
  );
}

async function NewCourse() {
  const { access, denied } = await requireAccess(["courses.manage"]);
  if (denied) return <AccessDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: categories, error } = await supabase
    .from("course_categories")
    .select("id, name")
    .eq("organization_id", access.organization.id)
    .order("position")
    .order("name");
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "category list failed", code: error.code }));
    throw new Error("Could not load categories.");
  }

  return (
    <>
      <PageHeader
        title="New course"
        icon={BookOpen}
        color="violet"
        crumbs={[{ label: "Courses", href: "/admin/courses" }, { label: "New course" }]}
        description="Fill in the essentials now; you can add the curriculum and customise the registration form after saving."
      />
      <Card>
        <CardContent className="py-5">
          <CourseForm initial={emptyCourseForm(access.organization.currency)} categories={categories ?? []} />
        </CardContent>
      </Card>
    </>
  );
}
