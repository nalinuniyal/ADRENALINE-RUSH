import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Plus, Search, Tags } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { requireAccess } from "@/lib/auth/session";
import { deliveryLabel, formatDate, formatMoney } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { courseListFilterSchema, firstParam, type CourseStatus } from "@/lib/validation/courses";
import { CourseStatusBadge } from "./_components/status-badge";

export const metadata: Metadata = { title: "Courses" };

const PAGE_SIZE = 25;

export default function CoursesPage({ searchParams }: PageProps<"/admin/courses">) {
  return (
    <Suspense fallback={<CoursesSkeleton />}>
      <CourseList searchParams={searchParams} />
    </Suspense>
  );
}

type Filters = ReturnType<typeof courseListFilterSchema.parse>;

function listHref(f: Filters, patch: Partial<Filters>) {
  const next = { ...f, ...patch };
  const qs = new URLSearchParams();
  if (next.q) qs.set("q", next.q);
  if (next.status !== "all") qs.set("status", next.status);
  if (next.category) qs.set("category", next.category);
  if (next.page > 1) qs.set("page", String(next.page));
  const s = qs.toString();
  return s ? `/admin/courses?${s}` : "/admin/courses";
}

function escapeLike(v: string) {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function CourseList({ searchParams }: { searchParams: PageProps<"/admin/courses">["searchParams"] }) {
  const { access, denied } = await requireAccess(["courses.view"]);
  if (denied) return <AccessDenied />;
  const canManage = access.permissions.includes("courses.manage");
  const canSeeAllCandidates = access.permissions.includes("candidates.view_all");

  const raw = await searchParams;
  const filters = courseListFilterSchema.parse({
    q: firstParam(raw.q),
    status: firstParam(raw.status),
    category: firstParam(raw.category),
    page: firstParam(raw.page),
  });

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("courses")
    .select(
      "id, title, slug, status, delivery_mode, list_price, discounted_price, currency, show_price, updated_at, category_id, course_categories(name), course_registrations(count)",
      { count: "exact" },
    )
    .eq("organization_id", access.organization.id);
  if (filters.q) query = query.ilike("title", `%${escapeLike(filters.q)}%`);
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.category === "none") query = query.is("category_id", null);
  else if (filters.category) query = query.eq("category_id", filters.category);
  const from = (filters.page - 1) * PAGE_SIZE;

  const [coursesRes, categoriesRes] = await Promise.all([
    query.order("updated_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    supabase.from("course_categories").select("id, name").eq("organization_id", access.organization.id).order("position").order("name"),
  ]);
  if (coursesRes.error || categoriesRes.error) {
    console.error(JSON.stringify({ level: "error", msg: "course list failed", code: (coursesRes.error ?? categoriesRes.error)?.code }));
    throw new Error("Could not load courses.");
  }

  const courses = coursesRes.data ?? [];
  const categories = categoriesRes.data ?? [];
  const total = coursesRes.count ?? courses.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(filters.q || filters.status !== "all" || filters.category);

  const rows = courses.map((c) => {
    const category = Array.isArray(c.course_categories) ? c.course_categories[0] : c.course_categories;
    const regs = (c.course_registrations as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
    return { ...c, status: c.status as CourseStatus, categoryName: category?.name ?? null, regs };
  });

  return (
    <>
      <PageHeader
        title="Courses"
        icon={BookOpen}
        color="violet"
        description="Create and publish courses, their curriculum and registration forms."
        actions={
          <>
            <Link href="/admin/courses/categories" className={buttonVariants({ variant: "secondary" })}>
              <Tags className="size-4" aria-hidden /> Categories
            </Link>
            {canManage ? (
              <Link href="/admin/courses/new" className={buttonVariants()}>
                <Plus className="size-4" aria-hidden /> New course
              </Link>
            ) : null}
          </>
        }
      />

      <Card className="mb-4">
        <Form key={`${filters.q}|${filters.status}|${filters.category}`} action="/admin/courses" role="search" aria-label="Filter courses" className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="course-q" className="text-xs font-medium text-[#444]">
              Search by title
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input id="course-q" name="q" type="search" defaultValue={filters.q} placeholder="e.g. Salesforce" className="pl-9" maxLength={100} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="course-status" className="text-xs font-medium text-[#444]">
              Status
            </label>
            <Select id="course-status" name="status" defaultValue={filters.status}>
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="course-category" className="text-xs font-medium text-[#444]">
              Category
            </label>
            <Select id="course-category" name="category" defaultValue={filters.category}>
              <option value="">All categories</option>
              <option value="none">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonVariants({ className: "flex-1 sm:flex-none" })}>
              Apply
            </button>
            {filtered ? (
              <Link href="/admin/courses" className={buttonVariants({ variant: "ghost" })}>
                Clear
              </Link>
            ) : null}
          </div>
        </Form>
      </Card>

      {!canSeeAllCandidates && rows.length ? (
        <Alert tone="info" className="mb-4">
          Registration counts include only the candidates your role can see.
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Search className="size-6" aria-hidden />}
            title="No courses match these filters"
            description="Try a different title or clear the filters."
            action={
              <Link href="/admin/courses" className={buttonVariants({ variant: "secondary" })}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<BookOpen className="size-6" aria-hidden />}
            title="No courses yet"
            description={canManage ? "Create your first course, add its curriculum and publish its registration page." : "Courses will appear here once someone with course management access creates them."}
            action={
              canManage ? (
                <Link href="/admin/courses/new" className={buttonVariants()}>
                  <Plus className="size-4" aria-hidden /> New course
                </Link>
              ) : undefined
            }
          />
        )
      ) : (
        <Card className="overflow-hidden">
          <p className="sr-only" aria-live="polite">
            {total} course{total === 1 ? "" : "s"} found
          </p>
          {/* Phones: stacked list */}
          <ul className="divide-y divide-line md:hidden">
            {rows.map((c) => (
              <li key={c.id} className="relative px-4 py-3 transition hover:bg-brand-50/50">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/admin/courses/${c.id}`} className="min-w-0 font-semibold text-brand-700 after:absolute after:inset-0 hover:underline">
                    <span className="line-clamp-2">{c.title}</span>
                  </Link>
                  <CourseStatusBadge status={c.status} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {[c.categoryName ?? "Uncategorised", deliveryLabel(c.delivery_mode), priceText(c)].join(" · ")}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {c.regs} registration{c.regs === 1 ? "" : "s"} · Updated {formatDate(c.updated_at, access.organization.timezone)}
                </p>
              </li>
            ))}
          </ul>
          {/* Tablets and up: table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Courses</caption>
              <thead className="border-b border-line bg-canvas/60 text-xs text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Course</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Delivery</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Price</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Registrations</th>
                  <th scope="col" className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-line transition last:border-0 hover:bg-brand-50/50">
                    <td className="max-w-sm px-4 py-3">
                      <Link href={`/admin/courses/${c.id}`} className="font-semibold text-brand-700 hover:underline">
                        {c.title}
                      </Link>
                      <p className="text-xs text-muted">{c.categoryName ?? "Uncategorised"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <CourseStatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{deliveryLabel(c.delivery_mode)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{priceText(c)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c.regs > 0 ? (
                        <Link href={`/admin/courses/${c.id}/registrations`} className="text-brand-700 hover:underline" aria-label={`${c.regs} registrations for ${c.title}`}>
                          {c.regs}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDate(c.updated_at, access.organization.timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
              <span className="text-muted">
                Page {filters.page} of {pages} · {total} courses
              </span>
              <span className="flex gap-2">
                {filters.page > 1 ? (
                  <Link href={listHref(filters, { page: filters.page - 1 })} className={buttonVariants({ variant: "secondary", size: "sm" })} rel="prev">
                    <ChevronLeft className="size-4" aria-hidden /> Previous
                  </Link>
                ) : null}
                {filters.page < pages ? (
                  <Link href={listHref(filters, { page: filters.page + 1 })} className={buttonVariants({ variant: "secondary", size: "sm" })} rel="next">
                    Next <ChevronRight className="size-4" aria-hidden />
                  </Link>
                ) : null}
              </span>
            </nav>
          ) : null}
        </Card>
      )}
    </>
  );
}

function priceText(c: { list_price: number | null; discounted_price: number | null; currency: string; show_price: boolean }) {
  if (c.list_price === null) return "No price";
  const shown = c.discounted_price !== null && c.discounted_price < c.list_price ? c.discounted_price : c.list_price;
  return `${formatMoney(shown, c.currency)}${c.show_price ? "" : " (hidden)"}`;
}

function CoursesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading courses">
      <div className="ar-skeleton mb-4 h-20 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton mb-4 h-24 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton h-72 rounded-[var(--radius-card)]" />
    </div>
  );
}
