import "server-only";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import type { Access } from "@/lib/auth/session";
import { deliveryLabel, formatDate, formatMoney } from "@/lib/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { CourseStatus } from "@/lib/validation/courses";
import { z } from "zod";
import { COURSE_COLUMNS } from "./course-data";
import { CourseActions } from "./course-actions";
import { CourseStatusBadge } from "./status-badge";

export type CourseTab = "details" | "curriculum" | "form" | "registrations";

/** Loads one course of the caller's organization (RLS applies), or 404s. Memoised per request. */
export const loadCourse = cache(async (id: string, organizationId: string) => {
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("courses")
    .select(`${COURSE_COLUMNS}, course_categories(name)`)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "course read failed", code: error.code }));
    throw new Error("Could not load the course.");
  }
  if (!data) notFound();
  const category = Array.isArray(data.course_categories) ? data.course_categories[0] : data.course_categories;
  return { ...data, status: data.status as CourseStatus, categoryName: category?.name ?? null };
});

/**
 * Total registrations for the delete guard. Candidate RLS would hide some from
 * this user, so the count uses the privileged client; it returns a number only,
 * for a course already verified to belong to the caller's organization.
 */
async function totalRegistrations(courseId: string, organizationId: string): Promise<number | null> {
  const { count, error } = await createSupabaseAdminClient()
    .from("course_registrations")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId)
    .eq("organization_id", organizationId);
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "registration count failed", code: error.code }));
    return null;
  }
  return count ?? 0;
}

export async function CourseHeader({ courseId, access, active }: { courseId: string; access: Access; active: CourseTab }) {
  const course = await loadCourse(courseId, access.organization.id);
  const canManage = access.permissions.includes("courses.manage");
  const regCount = canManage && course.status === "draft" ? await totalRegistrations(course.id, access.organization.id) : null;

  const price =
    course.list_price === null
      ? "Not set"
      : `${formatMoney(course.discounted_price ?? course.list_price, course.currency)}${course.show_price ? "" : " (hidden)"}`;

  const tabs: { key: CourseTab; label: string; href: string }[] = [
    { key: "details", label: "Details", href: `/admin/courses/${course.id}` },
    { key: "curriculum", label: "Curriculum", href: `/admin/courses/${course.id}?tab=curriculum` },
    { key: "form", label: "Registration form", href: `/admin/courses/${course.id}?tab=form` },
    { key: "registrations", label: "Registrations", href: `/admin/courses/${course.id}/registrations` },
  ];

  return (
    <>
      <PageHeader
        title={course.title}
        icon={BookOpen}
        color="violet"
        crumbs={[{ label: "Courses", href: "/admin/courses" }, { label: course.title }]}
        actions={<CourseActions courseId={course.id} slug={course.slug} status={course.status} canManage={canManage} registrationCount={regCount} />}
        details={[
          { label: "Status", value: <CourseStatusBadge status={course.status} /> },
          { label: "Category", value: course.categoryName ?? "Uncategorised" },
          { label: "Delivery", value: deliveryLabel(course.delivery_mode) },
          { label: "Price", value: price },
          { label: "Updated", value: formatDate(course.updated_at, access.organization.timezone) },
          ...(course.published_at ? [{ label: "First published", value: formatDate(course.published_at, access.organization.timezone) }] : []),
        ]}
      />
      <nav aria-label="Course sections" className="mb-4 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={t.key === active ? "page" : undefined}
                scroll={false}
                className={cn(
                  "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition",
                  t.key === active ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
