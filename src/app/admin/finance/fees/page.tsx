import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { GraduationCap, Search } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { requireAccess } from "@/lib/auth/session";
import { getBatchOptions } from "@/lib/data/batches";
import { getCourseOptions } from "@/lib/data/candidates";
import { getBalances, getOverdueInstallments } from "@/lib/data/finance";
import { formatPaise } from "@/lib/finance/money";
import { formatDate } from "@/lib/format";
import { searchTerm } from "@/lib/search";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EnrollmentStatus } from "@/lib/validation/batches";
import { firstParam, parseFinanceFilters } from "@/lib/validation/finance";
import { EnrollmentStatusBadge } from "../../batches/_components/badges";
import { FeeStateBadge } from "../_components/badges";
import { FilterField, FinanceFilterBar } from "../_components/filters";
import { FinanceHeader, FinanceSkeleton } from "../_components/finance-header";

export const metadata: Metadata = { title: "Fees & dues" };

const FEE_STATES = { "": "All", due: "Balance due", overdue: "Overdue", paid: "Paid in full", none: "No fee set" } as const;
type FeeState = keyof typeof FEE_STATES;

export default function FeesPage({ searchParams }: PageProps<"/admin/finance/fees">) {
  return (
    <Suspense fallback={<FinanceSkeleton label="Loading fees" />}>
      <FeesList searchParams={searchParams} />
    </Suspense>
  );
}

async function FeesList({ searchParams }: { searchParams: PageProps<"/admin/finance/fees">["searchParams"] }) {
  const { access, denied } = await requireAccess(["finance.view"]);
  if (denied) return <AccessDenied />;
  const orgId = access.organization.id;
  const raw = await searchParams;
  const filters = parseFinanceFilters(raw);
  const stateParam = firstParam(raw.state) ?? "";
  const state: FeeState = stateParam in FEE_STATES ? (stateParam as FeeState) : "";
  const showClosed = firstParam(raw.closed) === "1";
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("enrollments")
    .select("id, status, enrolled_at, candidate_id, course_id, batch_id, candidates!inner(full_name, email, phone), courses(title), batches(name)")
    .eq("organization_id", orgId);
  if (filters.course) query = query.eq("course_id", filters.course);
  if (filters.batch) query = query.eq("batch_id", filters.batch);
  if (!showClosed) query = query.not("status", "in", "(dropped,cancelled)");
  if (filters.q) {
    const term = searchTerm(filters.q);
    if (term) query = query.ilike("candidates.full_name", `%${term}%`);
  }

  const [enrRes, courses, batches, overdue] = await Promise.all([
    query.order("enrolled_at", { ascending: false }).limit(500),
    getCourseOptions(supabase, orgId),
    getBatchOptions(supabase, orgId, { includeClosed: true }),
    getOverdueInstallments(supabase, orgId, filters),
  ]);
  if (enrRes.error) {
    console.error(JSON.stringify({ level: "error", msg: "fees list failed", code: enrRes.error.code }));
    throw new Error("Could not load enrollments.");
  }
  const enrollments = enrRes.data ?? [];
  const plansRes = enrollments.length
    ? await supabase.from("fee_plans").select("id, enrollment_id, currency, final_fee").in("enrollment_id", enrollments.map((e) => e.id))
    : { data: [] as { id: string; enrollment_id: string; currency: string; final_fee: number }[] };
  const planByEnrollment = new Map((plansRes.data ?? []).map((p) => [p.enrollment_id, p]));
  const balances = await getBalances(supabase, orgId, (plansRes.data ?? []).map((p) => p.id));
  const overdueByPlan = new Map<string, number>();
  const nextOverdue = new Map<string, string>();
  for (const o of overdue) {
    overdueByPlan.set(o.feePlanId, (overdueByPlan.get(o.feePlanId) ?? 0) + o.remaining);
    if (!nextOverdue.has(o.feePlanId)) nextOverdue.set(o.feePlanId, o.dueDate);
  }

  const rows = enrollments
    .map((e) => {
      const plan = planByEnrollment.get(e.id);
      const bal = plan ? balances.get(plan.id) : undefined;
      const cand = Array.isArray(e.candidates) ? e.candidates[0] : e.candidates;
      const course = Array.isArray(e.courses) ? e.courses[0] : e.courses;
      const batch = Array.isArray(e.batches) ? e.batches[0] : e.batches;
      const overdueAmt = plan ? (overdueByPlan.get(plan.id) ?? 0) : 0;
      const st: FeeState = !plan ? "none" : (bal?.outstanding ?? 0) <= 0 ? "paid" : overdueAmt > 0 ? "overdue" : "due";
      return { e, plan, bal, cand, course, batch, overdueAmt, st };
    })
    .filter((r) => !state || r.st === state);

  const totals = rows.reduce(
    (t, r) => ({ fee: t.fee + (r.bal?.finalFee ?? 0), net: t.net + (r.bal?.net ?? 0), out: t.out + (r.bal?.outstanding ?? 0) }),
    { fee: 0, net: 0, out: 0 },
  );
  const cur = access.organization.currency;

  return (
    <>
      <FinanceHeader active="fees" description="Each enrollment’s agreed fee, what has been paid and what is still due. Open a student to set the fee, installments and record payments." />
      <FinanceFilterBar
        action="/admin/finance/fees"
        filters={filters}
        showPeriod={false}
        courses={courses.map((c) => ({ id: c.id, label: c.title }))}
        batches={batches.map((b) => ({ id: b.id, label: `${b.name} — ${b.courseTitle}` }))}
        extra={
          <>
            <FilterField id="f-state" label="Fee status">
              <Select id="f-state" name="state" defaultValue={state}>
                {Object.entries(FEE_STATES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField id="f-q" label="Student name">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input id="f-q" name="q" type="search" defaultValue={filters.q} className="pl-9" maxLength={80} />
              </div>
            </FilterField>
            <FilterField id="f-closed" label="Enrollments">
              <Select id="f-closed" name="closed" defaultValue={showClosed ? "1" : ""}>
                <option value="">Current only</option>
                <option value="1">Include dropped / cancelled</option>
              </Select>
            </FilterField>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="size-6" aria-hidden />}
          title={enrollments.length ? "No enrollments match these filters" : "No enrollments yet"}
          description={
            enrollments.length ? undefined : (
              <>Fees are attached to an enrollment. Enroll a candidate in a batch first (Batches › a batch › Enroll a student, or from the candidate’s profile).</>
            )
          }
          action={
            enrollments.length ? (
              <Link href="/admin/finance/fees" className={buttonVariants({ variant: "secondary" })}>
                Clear filters
              </Link>
            ) : (
              <Link href="/admin/batches" className={buttonVariants()}>
                Go to batches
              </Link>
            )
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <p className="border-b border-line px-4 py-2 text-xs text-muted">
            {rows.length} enrollment{rows.length === 1 ? "" : "s"} · fees {formatPaise(totals.fee, cur)} · paid (net) {formatPaise(totals.net, cur)} · outstanding{" "}
            <span className="font-semibold text-fg">{formatPaise(totals.out, cur)}</span>
          </p>
          <ul className="divide-y divide-line">
            {rows.map(({ e, plan, bal, cand, course, batch, overdueAmt, st }) => (
              <li key={e.id} className="relative grid gap-2 px-4 py-3 transition hover:bg-brand-50/50 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <Link href={`/admin/finance/fees/${e.id}`} className="font-semibold text-brand-700 after:absolute after:inset-0 hover:underline">
                    {cand?.full_name ?? "Candidate"}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    {course?.title ?? "—"}
                    {batch ? ` · ${batch.name}` : ""} · enrolled {formatDate(e.enrolled_at, access.organization.timezone)}
                  </p>
                </div>
                <p className="text-sm tabular-nums">
                  <span className="text-xs text-muted md:hidden">Fee </span>
                  {plan ? formatPaise(bal?.finalFee ?? 0, plan.currency) : "—"}
                </p>
                <p className="text-sm tabular-nums">
                  <span className="text-xs text-muted md:hidden">Paid </span>
                  {plan ? formatPaise(bal?.net ?? 0, plan.currency) : "—"}
                </p>
                <p className="text-sm font-semibold tabular-nums">
                  <span className="text-xs font-normal text-muted md:hidden">Due </span>
                  {plan ? formatPaise(bal?.outstanding ?? 0, plan.currency) : "—"}
                  {overdueAmt ? <span className="block text-xs font-normal text-danger-700">{formatPaise(overdueAmt, plan?.currency)} overdue</span> : null}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <FeeStateBadge hasPlan={Boolean(plan)} outstanding={bal?.outstanding ?? 0} overdue={st === "overdue"} />
                  {e.status !== "active" ? <EnrollmentStatusBadge status={e.status as EnrollmentStatus} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
