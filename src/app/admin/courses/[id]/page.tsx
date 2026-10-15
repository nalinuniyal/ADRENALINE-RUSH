import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied } from "@/components/admin/access-denied";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccess, type Access } from "@/lib/auth/session";
import { serializeCurriculum } from "@/lib/forms/curriculum";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/validation/courses";
import { courseToForm } from "../_components/course-data";
import { CourseForm } from "../_components/course-form";
import { CourseHeader, loadCourse, type CourseTab } from "../_components/course-header";
import { CurriculumEditor } from "../_components/curriculum-editor";
import { FormBuilder, type BuilderField } from "../_components/form-builder";

export const metadata: Metadata = { title: "Course" };

export default function CoursePage({ params, searchParams }: PageProps<"/admin/courses/[id]">) {
  return (
    <Suspense fallback={<CourseSkeleton />}>
      <CourseDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function CourseDetail({ params, searchParams }: Pick<PageProps<"/admin/courses/[id]">, "params" | "searchParams">) {
  const { access, denied } = await requireAccess(["courses.view"]);
  if (denied) return <AccessDenied />;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tabParam = firstParam(sp.tab);
  const tab: CourseTab = tabParam === "curriculum" || tabParam === "form" ? tabParam : "details";
  const canManage = access.permissions.includes("courses.manage");
  const notice = firstParam(sp.created) ? "created" : firstParam(sp.cloned) === "partial" ? "cloned-partial" : firstParam(sp.cloned) ? "cloned" : null;

  return (
    <>
      <CourseHeader courseId={id} access={access} active={tab} />
      {notice === "created" ? (
        <Alert tone="success" className="mb-4">
          Course created as a draft. Next, add the curriculum and review the registration form, then publish.
        </Alert>
      ) : null}
      {notice === "cloned" ? (
        <Alert tone="success" className="mb-4">
          This is a draft copy. Update the title and slug, then publish when ready.
        </Alert>
      ) : null}
      {notice === "cloned-partial" ? (
        <Alert tone="warning" className="mb-4">
          The course was copied, but some curriculum or form fields could not be copied. Review this copy before publishing.
        </Alert>
      ) : null}
      {!canManage ? (
        <Alert tone="info" className="mb-4">
          You have view-only access to courses.
        </Alert>
      ) : null}
      {tab === "details" ? <DetailsTab id={id} access={access} canManage={canManage} /> : null}
      {tab === "curriculum" ? <CurriculumTab id={id} access={access} canManage={canManage} /> : null}
      {tab === "form" ? <FormTab id={id} access={access} canManage={canManage} /> : null}
    </>
  );
}

type TabProps = { id: string; access: Access; canManage: boolean };

async function DetailsTab({ id, access, canManage }: TabProps) {
  const course = await loadCourse(id, access.organization.id);
  const supabase = await createSupabaseServerClient();
  const { data: categories, error } = await supabase
    .from("course_categories")
    .select("id, name")
    .eq("organization_id", access.organization.id)
    .order("position")
    .order("name");
  if (error) throw new Error("Could not load categories.");

  return (
    <Card>
      <CardContent className="py-5">
        <CourseForm courseId={course.id} initial={courseToForm(course)} categories={categories ?? []} readOnly={!canManage} />
      </CardContent>
    </Card>
  );
}

async function CurriculumTab({ id, access, canManage }: TabProps) {
  const course = await loadCourse(id, access.organization.id);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("course_modules")
    .select("title, description, position, lessons(title, duration_minutes, position)")
    .eq("course_id", course.id)
    .order("position");
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "curriculum read failed", code: error.code }));
    throw new Error("Could not load the curriculum.");
  }
  const modules = (data ?? []).map((m) => ({
    title: m.title,
    description: m.description,
    lessons: [...m.lessons].sort((a, b) => a.position - b.position).map((l) => ({ title: l.title, durationMinutes: l.duration_minutes })),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Curriculum</CardTitle>
        <CardDescription>Modules and lessons shown on the public course page.</CardDescription>
      </CardHeader>
      <CardContent>
        <CurriculumEditor key={course.updated_at} courseId={course.id} initialText={serializeCurriculum(modules)} readOnly={!canManage} />
      </CardContent>
    </Card>
  );
}

async function FormTab({ id, access, canManage }: TabProps) {
  const course = await loadCourse(id, access.organization.id);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("course_registration_fields")
    .select("id, key, label, type, maps_to, required, options, help_text, placeholder, is_active")
    .eq("course_id", course.id)
    .order("position")
    .order("created_at");
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "form fields read failed", code: error.code }));
    throw new Error("Could not load the registration form.");
  }
  const fields: BuilderField[] = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registration form</CardTitle>
        <CardDescription>
          The questions people answer on{" "}
          {course.status === "published" ? (
            <Link href={`/courses/${course.slug}#register`} className="text-brand-700 hover:underline" target="_blank" rel="noopener noreferrer">
              the public course page<span className="sr-only"> (opens in a new tab)</span>
            </Link>
          ) : (
            "the public course page"
          )}
          . Changes apply to new registrations immediately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormBuilder courseId={course.id} fields={fields} readOnly={!canManage} />
      </CardContent>
    </Card>
  );
}

function CourseSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading course">
      <div className="ar-skeleton mb-4 h-32 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton mb-4 h-10 rounded" />
      <div className="ar-skeleton h-[50vh] rounded-[var(--radius-card)]" />
    </div>
  );
}
