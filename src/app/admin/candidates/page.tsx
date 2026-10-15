import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { AlarmClock, ChevronLeft, ChevronRight, Download, Plus, Search, Upload, Users } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { requireAccess } from "@/lib/auth/session";
import { getCandidateOwners, getCourseOptions, getLeadStatuses, getMemberNames, listCandidates, type CandidateListRow } from "@/lib/data/candidates";
import { formatDate, formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  CANDIDATE_SORT_LABELS,
  CANDIDATE_SORTS,
  candidateFiltersQuery,
  hasActiveFilters,
  PAGE_SIZE,
  parseCandidateFilters,
  type CandidateFilters,
} from "@/lib/validation/candidates";
import { personName, StatusBadge } from "./_components/status-badge";

export const metadata: Metadata = { title: "Candidates" };

export default function CandidatesPage({ searchParams }: PageProps<"/admin/candidates">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <CandidateList searchParams={searchParams} />
    </Suspense>
  );
}

async function CandidateList({ searchParams }: { searchParams: PageProps<"/admin/candidates">["searchParams"] }) {
  const { access, denied } = await requireAccess(["candidates.view_all", "candidates.view_assigned"]);
  if (denied) return <AccessDenied />;

  const filters = parseCandidateFilters(await searchParams);
  const orgId = access.organization.id;
  const tz = access.organization.timezone;
  const can = (p: string) => access.permissions.includes(p);
  const viewAll = can("candidates.view_all");

  const supabase = await createSupabaseServerClient();
  const [statuses, owners, courses, members, list] = await Promise.all([
    getLeadStatuses(supabase, orgId),
    viewAll ? getCandidateOwners(supabase, orgId) : Promise.resolve([]),
    getCourseOptions(supabase, orgId),
    getMemberNames(supabase, orgId),
    listCandidates(supabase, orgId, access.userId, filters),
  ]);
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const now = new Date().getTime();
  const filtered = hasActiveFilters(filters);
  const exportHref = `/admin/candidates/export${candidateFiltersQuery(filters, { page: 1 })}`;
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const firstShown = list.rows.length ? (filters.page - 1) * PAGE_SIZE + 1 : 0;
  const lastShown = firstShown ? firstShown + list.rows.length - 1 : 0;

  return (
    <>
      <PageHeader
        icon={Users}
        color="orange"
        eyebrow="Candidates"
        title={viewAll ? "All candidates" : "My candidates"}
        description={viewAll ? "Leads and students across every course." : "Candidates assigned to you."}
        actions={
          <>
            {can("candidates.export") ? (
              <a href={exportHref} className={buttonVariants({ variant: "secondary", size: "sm" })} download>
                <Download className="size-4" aria-hidden /> Export CSV
              </a>
            ) : null}
            {can("candidates.import") ? (
              <Link href="/admin/candidates/import" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                <Upload className="size-4" aria-hidden /> Import
              </Link>
            ) : null}
            {can("candidates.manage") ? (
              <Link href="/admin/candidates/new" className={buttonVariants({ size: "sm" })}>
                <Plus className="size-4" aria-hidden /> New candidate
              </Link>
            ) : null}
          </>
        }
      />

      <Card className="mb-4">
        <Form action="/admin/candidates" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter candidates">
          <div className="sm:col-span-2">
            <label htmlFor="f-q" className="text-xs font-medium text-[#444]">Search</label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input id="f-q" name="q" type="search" defaultValue={filters.q ?? ""} placeholder="Name, email, phone or company" className="pl-9" />
            </div>
          </div>
          <FilterSelect id="f-status" name="status" label="Lead status" value={filters.status}>
            <option value="">Any status</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </FilterSelect>
          {courses.length ? (
            <FilterSelect id="f-course" name="course" label="Registered for" value={filters.course}>
              <option value="">Any course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </FilterSelect>
          ) : null}
          {viewAll ? (
            <FilterSelect id="f-owner" name="owner" label="Owner" value={filters.owner}>
              <option value="">Anyone</option>
              <option value="me">Me</option>
              <option value="unassigned">Unassigned</option>
              {owners.filter((o) => o.user_id !== access.userId).map((o) => (
                <option key={o.user_id} value={o.user_id}>{o.full_name || o.email}</option>
              ))}
            </FilterSelect>
          ) : null}
          <div>
            <label htmlFor="f-source" className="text-xs font-medium text-[#444]">Source / UTM source</label>
            <Input id="f-source" name="source" defaultValue={filters.source ?? ""} placeholder="e.g. linkedin" className="mt-1" />
          </div>
          <FilterSelect id="f-followup" name="followup" label="Follow-up" value={filters.followup}>
            <option value="">Any</option>
            <option value="overdue">Overdue</option>
          </FilterSelect>
          <FilterSelect id="f-sort" name="sort" label="Sort by" value={filters.sort}>
            {CANDIDATE_SORTS.map((s) => (
              <option key={s} value={s}>{CANDIDATE_SORT_LABELS[s]}</option>
            ))}
          </FilterSelect>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm">Apply filters</Button>
            {filtered || filters.sort !== "newest" ? (
              <Link href="/admin/candidates" className={buttonVariants({ variant: "ghost", size: "sm" })}>Clear</Link>
            ) : null}
            <p className="ml-auto text-xs text-muted" aria-live="polite">
              {list.total === 0 ? "No candidates" : `${firstShown}–${lastShown} of ${list.total}`}
            </p>
          </div>
        </Form>
      </Card>

      {list.rows.length === 0 ? (
        list.outOfRange ? (
          <EmptyState
            icon={<Users className="size-6" aria-hidden />}
            title="This page is empty"
            action={<Link href={`/admin/candidates${candidateFiltersQuery(filters, { page: 1 })}`} className={buttonVariants({ size: "sm" })}>Go to the first page</Link>}
          />
        ) : filtered ? (
          <EmptyState
            icon={<Search className="size-6" aria-hidden />}
            title="No candidates match these filters"
            description="Try a different search or clear the filters."
            action={<Link href="/admin/candidates" className={buttonVariants({ variant: "secondary", size: "sm" })}>Clear filters</Link>}
          />
        ) : (
          <EmptyState
            icon={<Users className="size-6" aria-hidden />}
            title={viewAll ? "No candidates yet" : "No candidates are assigned to you yet"}
            description={
              viewAll
                ? "Candidates appear here when someone registers on a course page, or when you add or import them."
                : "When a candidate is assigned to you, they will appear here."
            }
            action={
              can("candidates.manage") || can("candidates.import") ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {can("candidates.manage") ? <Link href="/admin/candidates/new" className={buttonVariants({ size: "sm" })}>Add a candidate</Link> : null}
                  {can("candidates.import") ? <Link href="/admin/candidates/import" className={buttonVariants({ variant: "secondary", size: "sm" })}>Import a CSV</Link> : null}
                </div>
              ) : undefined
            }
          />
        )
      ) : (
        <Card className="overflow-hidden">
          {/* Phones: stacked cards */}
          <ul className="divide-y divide-line md:hidden">
            {list.rows.map((c) => (
              <li key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/admin/candidates/${c.id}`} className="font-semibold text-brand-700 hover:underline">{c.full_name}</Link>
                    <p className="truncate text-xs text-muted">{c.email ?? c.phone}</p>
                  </div>
                  <StatusBadge status={c.lead_status_id ? statusById.get(c.lead_status_id) : null} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted">Course</dt>
                  <dd className="truncate">{c.latest[0]?.course?.title ?? "—"}</dd>
                  {viewAll ? (
                    <>
                      <dt className="text-muted">Owner</dt>
                      <dd className="truncate">{personName(members, c.owner_id)}</dd>
                    </>
                  ) : null}
                  <dt className="text-muted">Next follow-up</dt>
                  <dd><FollowUp row={c} now={now} tz={tz} /></dd>
                  <dt className="text-muted">Created</dt>
                  <dd>{formatDate(c.created_at, tz)}</dd>
                </dl>
              </li>
            ))}
          </ul>

          {/* Tablets and up: table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Candidates, {list.total} in total</caption>
              <thead className="border-b border-line bg-canvas/60 text-xs text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Latest course</th>
                  {viewAll ? <th scope="col" className="px-4 py-2.5 font-medium">Owner</th> : null}
                  <th scope="col" className="px-4 py-2.5 font-medium">Next follow-up</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => (
                  <tr key={c.id} className="border-b border-line transition-colors last:border-0 hover:bg-brand-50/50">
                    <td className="max-w-64 px-4 py-2.5">
                      <Link href={`/admin/candidates/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.full_name}</Link>
                      <p className="truncate text-xs text-muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={c.lead_status_id ? statusById.get(c.lead_status_id) : null} /></td>
                    <td className="max-w-56 truncate px-4 py-2.5">{c.latest[0]?.course?.title ?? <span className="text-muted">—</span>}</td>
                    {viewAll ? (
                      <td className={cn("px-4 py-2.5", !c.owner_id && "text-muted")}>{personName(members, c.owner_id)}</td>
                    ) : null}
                    <td className="px-4 py-2.5 text-xs"><FollowUp row={c} now={now} tz={tz} /></td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted">{formatDate(c.created_at, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? <Pagination filters={filters} totalPages={totalPages} /> : null}
        </Card>
      )}
    </>
  );
}

function FilterSelect({ id, name, label, value, children }: { id: string; name: string; label: string; value: string | null; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-[#444]">{label}</label>
      <Select id={id} name={name} defaultValue={value ?? ""} className="mt-1">
        {children}
      </Select>
    </div>
  );
}

function FollowUp({ row, now, tz }: { row: CandidateListRow; now: number; tz: string }) {
  const next = row.next[0];
  if (!next) return <span className="text-muted">—</span>;
  const overdue = new Date(next.due_at).getTime() < now;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", overdue ? "font-semibold text-danger-700" : "text-fg")} title={next.title}>
      {overdue ? <AlarmClock className="size-3.5" aria-hidden /> : null}
      {formatDateTime(next.due_at, tz)}
      {overdue ? <span className="sr-only"> (overdue)</span> : null}
    </span>
  );
}

function Pagination({ filters, totalPages }: { filters: CandidateFilters; totalPages: number }) {
  const prev = filters.page > 1 ? `/admin/candidates${candidateFiltersQuery(filters, { page: filters.page - 1 })}` : null;
  const next = filters.page < totalPages ? `/admin/candidates${candidateFiltersQuery(filters, { page: filters.page + 1 })}` : null;
  const linkCls = buttonVariants({ variant: "secondary", size: "sm" });
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
      {prev ? (
        <Link href={prev} className={linkCls} rel="prev"><ChevronLeft className="size-4" aria-hidden /> Previous</Link>
      ) : (
        <span className={cn(linkCls, "pointer-events-none opacity-50")} aria-disabled="true"><ChevronLeft className="size-4" aria-hidden /> Previous</span>
      )}
      <span className="text-muted">Page {filters.page} of {totalPages}</span>
      {next ? (
        <Link href={next} className={linkCls} rel="next">Next <ChevronRight className="size-4" aria-hidden /></Link>
      ) : (
        <span className={cn(linkCls, "pointer-events-none opacity-50")} aria-disabled="true">Next <ChevronRight className="size-4" aria-hidden /></span>
      )}
    </nav>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading candidates">
      <div className="ar-skeleton h-20 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton h-40 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton h-96 rounded-[var(--radius-card)]" />
    </div>
  );
}
