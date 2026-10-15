import type { Metadata } from "next";
import { Suspense } from "react";
import { Tags } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { requireAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CategoryManager } from "./category-manager";

export const metadata: Metadata = { title: "Course categories" };

export default function CategoriesPage() {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[50vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading categories" />}>
      <Categories />
    </Suspense>
  );
}

async function Categories() {
  const { access, denied } = await requireAccess(["courses.view"]);
  if (denied) return <AccessDenied />;
  const canManage = access.permissions.includes("courses.manage");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("course_categories")
    .select("id, name, slug, description, position, courses(count)")
    .eq("organization_id", access.organization.id)
    .order("position")
    .order("name");
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "category list failed", code: error.code }));
    throw new Error("Could not load categories.");
  }

  const categories = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    position: c.position,
    courseCount: (c.courses as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
  }));

  return (
    <>
      <PageHeader
        title="Course categories"
        icon={Tags}
        color="violet"
        crumbs={[{ label: "Courses", href: "/admin/courses" }, { label: "Categories" }]}
        description="Group courses on the public catalogue. Lower positions are listed first."
      />
      <CategoryManager categories={categories} canManage={canManage} />
    </>
  );
}
