import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Search, UsersRound } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { requireAccess } from "@/lib/auth/session";
import { scheduleSummary } from "@/lib/batches/schedule";
import { getCourseOptions, getMemberNames } from "@/lib/data/candidates";
import { deliveryLabel, formatDate } from "@/lib/format";
import { searchTerm } from "@/lib/search";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BATCH_STATUS_LABELS, BATCH_STATUSES, batchListFilterSchema, firstParam, SEAT_STATUSES, type BatchStatus } from "@/lib/validation/batches";
import { BatchStatusBadge, seatsText } from "./_components/badges";

export const metadata: Metadata = { title: "Batches" };

export default function BatchesPage({ searchParams }: PageProps<"/admin/batches">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <BatchList searchParams={searchParams} />
    </Suspense>
  );
}

async function BatchList({ searchParams }: { searchParams: PageProps<"/admin/batches">["searchParams"] }) {
  const { access, denied } = await requireAccess(["batches.view"]);
  if (denied) return <AccessDenied />;
  const canManage = access.permissions.includes("batches.manage");
  const orgId = access.organization.id;
  const tz = access.organization.timezone;
  const raw = await searchParams;
  const filters = batchListFilterSchema.parse({ q: firstParam(raw.q), status: firstParam(raw.status), course: firstParam(raw.course) });

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("batches")
    .select("id, name, code, course_id, start_date, end_date, class_days, start_time, end_time, schedule_note, capacity, delivery_mode, instructor_id, status, courses(title)")
    .eq("organization_id", orgId);
  if (filters.q) {
    const term = searchTerm(filters.q);
    if (term) query = query.or(`name.ilike."%${term}%",code.ilike."%${term}%"`);
  }
  if (filters.status === "active") query = query.not("status", "in", "(completed,cancelled)");
  else if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.course) query = query.eq("course_id", filters.course);

  const [batchesRes, courses, members] = await Promise.all([
    query.order("start_date", { ascending: true, nullsFirst: false }).order("name").limit(200),
    getCourseOptions(supabase, orgId),
    getMemberNames(supabase, orgId),
  ]);
  if (batchesRes.error) {
    console.error(JSON.stringify({ level: "error", msg: "batch list failed", code: batchesRes.error.code }));
    throw new Error("Could not load batches.");
  }
  const batches = batchesRes.data ?? [];
  const ids = batches.map((b) => b.id);
  const seatRows = ids.length
    ? (await supabase.from("enrollments").select("batch_id").in("batch_id", ids).in("status", [...SEAT_STATUSES]).limit(10000)).data ?? []
    : [];
  const seats = new Map<string, number>();
  for (const r of seatRows) if (r.batch_id) seats.set(r.batch_id, (seats.get(r.batch_id) ?? 0) + 1);

  const rows = batches.map((b) => {
    const course = Array.isArray(b.courses) ? b.courses[0] : b.courses;
    return {
      ...b,
      status: b.status as BatchStatus,
      courseTitle: course?.title ?? "—",
      instructor: b.instructor_id ? (members.get(b.instructor_id)?.name ?? "—") : "Not assigned",
      schedule: b.schedule_note || scheduleSummary(b.class_days, b.start_time, b.end_time) || "Not set",
      seats: seatsText(seats.get(b.id) ?? 0, b.capacity),
      dates: b.start_date ? `${formatDate(b.start_date, tz)}${b.end_date ? ` – ${formatDate(b.end_date, tz)}` : ""}` : "Dates not set",
    };
  });
  const filtered = Boolean(filters.q || filters.status !== "active" || filters.course);

  return (
    <>
      <PageHeader
        title="Batches"
        icon={UsersRound}
        color="teal"
        description={access.role === "instructor" && !canManage ? "Batches you teach." : "Cohorts of a course with their schedule, capacity, roster and attendance."}
        actions={
          canManage ? (
            <Link href="/admin/batches/new" className={buttonVariants()}>
              <Plus className="size-4" aria-hidden /> New batch
            </Link>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <Form key={`${filters.q}|${filters.status}|${filters.course}`} action="/admin/batches" role="search" aria-label="Filter batches" className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="batch-q" className="text-xs font-medium text-[#444]">
              Search by name or code
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input id="batch-q" name="q" type="search" defaultValue={filters.q} placeholder="e.g. October" className="pl-9" maxLength={100} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="batch-status" className="text-xs font-medium text-[#444]">
              Status
            </label>
            <Select id="batch-status" name="status" defaultValue={filters.status}>
              <option value="active">Current (not finished)</option>
              <option value="all">All statuses</option>
              {BATCH_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {BATCH_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="batch-course" className="text-xs font-medium text-[#444]">
              Course
            </label>
            <Select id="batch-course" name="course" defaultValue={filters.course}>
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonVariants({ className: "flex-1 sm:flex-none" })}>
              Apply
            </button>
            {filtered ? (
              <Link href="/admin/batches" className={buttonVariants({ variant: "ghost" })}>
                Clear
              </Link>
            ) : null}
          </div>
        </Form>
      </Card>

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState icon={<Search className="size-6" aria-hidden />} title="No batches match these filters" action={<Link href="/admin/batches" className={buttonVariants({ variant: "secondary" })}>Clear filters</Link>} />
        ) : (
          <EmptyState
            icon={<UsersRound className="size-6" aria-hidden />}
            title="No batches yet"
            description={canManage ? "Create a batch for a course, set its schedule and capacity, then enroll candidates." : "Batches you can see will appear here."}
            action={
              canManage ? (
                <Link href="/admin/batches/new" className={buttonVariants()}>
                  <Plus className="size-4" aria-hidden /> New batch
                </Link>
              ) : undefined
            }
          />
        )
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line md:hidden">
            {rows.map((b) => (
              <li key={b.id} className="relative px-4 py-3 transition hover:bg-brand-50/50">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/admin/batches/${b.id}`} className="min-w-0 font-semibold text-brand-700 after:absolute after:inset-0 hover:underline">
                    <span className="line-clamp-2">{b.name}</span>
                  </Link>
                  <BatchStatusBadge status={b.status} />
                </div>
                <p className="mt-1 text-xs text-muted">{b.courseTitle}</p>
                <p className="mt-1 text-xs text-muted">
                  {b.dates} · {b.schedule}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {b.seats} · {b.instructor}
                </p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Batches</caption>
              <thead className="border-b border-line bg-canvas/60 text-xs text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Batch</th>
                  <th scope="col" className="px-4 py-3 font-medium">Dates</th>
                  <th scope="col" className="px-4 py-3 font-medium">Schedule</th>
                  <th scope="col" className="px-4 py-3 font-medium">Instructor</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Seats</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-b border-line transition last:border-0 hover:bg-brand-50/50">
                    <td className="max-w-xs px-4 py-3">
                      <Link href={`/admin/batches/${b.id}`} className="font-semibold text-brand-700 hover:underline">
                        {b.name}
                      </Link>
                      <p className="text-xs text-muted">
                        {b.courseTitle}
                        {b.code ? ` · ${b.code}` : ""} · {deliveryLabel(b.delivery_mode)}
                      </p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{b.dates}</td>
                    <td className="px-4 py-3">{b.schedule}</td>
                    <td className="px-4 py-3">{b.instructor}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{b.seats}</td>
                    <td className="px-4 py-3">
                      <BatchStatusBadge status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading batches">
      <div className="ar-skeleton mb-4 h-20 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton mb-4 h-24 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton h-72 rounded-[var(--radius-card)]" />
    </div>
  );
}
