import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAccess } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/validation/courses";
import { CourseHeader, loadCourse } from "../../_components/course-header";

export const metadata: Metadata = { title: "Course registrations" };

const PAGE_SIZE = 50;

const CHANNELS: Record<string, { label: string; tone: BadgeTone }> = {
  public_form: { label: "Public form", tone: "brand" },
  demo_request: { label: "Demo request", tone: "violet" },
  import: { label: "Import", tone: "teal" },
  manual: { label: "Added by staff", tone: "neutral" },
};

export default function CourseRegistrationsPage({ params, searchParams }: PageProps<"/admin/courses/[id]/registrations">) {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[60vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading registrations" />}>
      <Registrations params={params} searchParams={searchParams} />
    </Suspense>
  );
}

type Answer = { key: string; label: string; value: string };

function readAnswers(raw: unknown): Answer[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([key, entry]) => {
    const obj = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as { label?: unknown; value?: unknown }) : { value: entry };
    const label = typeof obj.label === "string" && obj.label ? obj.label : key;
    const v = obj.value;
    const value = Array.isArray(v) ? v.map(String).join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : v === null || v === undefined ? "—" : String(v);
    return { key, label, value };
  });
}

async function Registrations({ params, searchParams }: Pick<PageProps<"/admin/courses/[id]/registrations">, "params" | "searchParams">) {
  const { access, denied } = await requireAccess(["courses.view"]);
  if (denied) return <AccessDenied />;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const course = await loadCourse(id, access.organization.id);
  const page = Math.min(10000, Math.max(1, Number.parseInt(firstParam(sp.page) ?? "1", 10) || 1));
  const canViewCandidates = access.permissions.some((p) => p === "candidates.view_all" || p === "candidates.view_assigned");
  const tz = access.organization.timezone;

  if (!canViewCandidates) {
    return (
      <>
        <CourseHeader courseId={id} access={access} active="registrations" />
        <Alert tone="info" title="Candidate access needed">
          Registrations contain candidates’ personal details. Ask the business owner for candidate access to see them.
        </Alert>
      </>
    );
  }

  const supabase = await createSupabaseServerClient();
  const from = (page - 1) * PAGE_SIZE;
  // RLS limits rows to candidates this user may see (all, or only those assigned to them).
  const { data, count, error } = await supabase
    .from("course_registrations")
    .select("id, candidate_id, channel, created_at, duplicate_reason, answers, candidates(full_name, email, phone)", { count: "exact" })
    .eq("course_id", course.id)
    .eq("organization_id", access.organization.id)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "course registrations read failed", code: error.code }));
    throw new Error("Could not load registrations.");
  }

  const rows = (data ?? []).map((r) => ({
    ...r,
    candidate: Array.isArray(r.candidates) ? r.candidates[0] : r.candidates,
    answerList: readAnswers(r.answers),
  }));
  const total = count ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const onlyAssigned = !access.permissions.includes("candidates.view_all");

  return (
    <>
      <CourseHeader courseId={id} access={access} active="registrations" />
      {onlyAssigned ? (
        <Alert tone="info" className="mb-4">
          Showing only registrations from candidates assigned to you.
        </Alert>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title="No registrations yet"
          description={course.status === "published" ? "Share the public link to start collecting registrations." : "Publish the course to start collecting registrations from its public page."}
        />
      ) : (
        <Card className="overflow-hidden">
          <p className="border-b border-line px-4 py-3 text-sm text-muted">
            {total} registration{total === 1 ? "" : "s"}, newest first.
          </p>
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const channel = CHANNELS[r.channel] ?? { label: r.channel, tone: "neutral" as const };
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/candidates/${r.candidate_id}`} className="font-semibold text-brand-700 hover:underline">
                        {r.candidate?.full_name ?? "Candidate"}
                      </Link>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs break-all text-muted">
                        {r.candidate?.email ? <a href={`mailto:${r.candidate.email}`} className="hover:text-brand-700 hover:underline">{r.candidate.email}</a> : null}
                        {r.candidate?.phone ? <a href={`tel:${r.candidate.phone.replace(/[^\d+]/g, "")}`} className="hover:text-brand-700 hover:underline">{r.candidate.phone}</a> : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <Badge tone={channel.tone}>{channel.label}</Badge>
                      {r.duplicate_reason ? (
                        <Badge tone="warning" title={r.duplicate_reason}>
                          Possible duplicate
                        </Badge>
                      ) : null}
                      <time dateTime={r.created_at} className="text-xs whitespace-nowrap text-muted">
                        {formatDateTime(r.created_at, tz)}
                      </time>
                    </div>
                  </div>
                  {r.duplicate_reason ? <p className="mt-2 text-xs text-warning-700">{r.duplicate_reason}</p> : null}
                  {r.answerList.length ? (
                    <details className="group mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">
                        {r.answerList.length} custom answer{r.answerList.length === 1 ? "" : "s"}
                      </summary>
                      <dl className="mt-2 grid gap-2 rounded-lg border border-line bg-canvas/50 p-3 text-sm sm:grid-cols-2">
                        {r.answerList.map((a) => (
                          <div key={a.key} className="min-w-0">
                            <dt className="text-xs text-muted">{a.label}</dt>
                            <dd className="break-words whitespace-pre-line">{a.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {pages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
              <span className="text-muted">
                Page {page} of {pages}
              </span>
              <span className="flex gap-2">
                {page > 1 ? (
                  <Link href={`/admin/courses/${course.id}/registrations?page=${page - 1}`} className={buttonVariants({ variant: "secondary", size: "sm" })} rel="prev">
                    <ChevronLeft className="size-4" aria-hidden /> Previous
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link href={`/admin/courses/${course.id}/registrations?page=${page + 1}`} className={buttonVariants({ variant: "secondary", size: "sm" })} rel="next">
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
