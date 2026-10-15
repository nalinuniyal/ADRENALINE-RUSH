import Link from "next/link";
import { Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import type { Access } from "@/lib/auth/session";
import { getBalances } from "@/lib/data/finance";
import { formatPaise } from "@/lib/finance/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FeeStateBadge } from "./badges";

/** "Fees & payments" on the candidate profile. Rendered only for finance.view holders (RLS agrees). */
export async function CandidateFeesCard({ candidateId, access }: { candidateId: string; access: Access }) {
  if (!access.permissions.includes("finance.view")) return null;
  const supabase = await createSupabaseServerClient();
  const orgId = access.organization.id;
  const [enrRes, plansRes, overdueRes] = await Promise.all([
    supabase.from("enrollments").select("id, status, courses(title), batches(name)").eq("candidate_id", candidateId).eq("organization_id", orgId).order("enrolled_at", { ascending: false }),
    supabase.from("fee_plans").select("id, enrollment_id, currency").eq("candidate_id", candidateId).eq("organization_id", orgId),
    supabase.rpc("finance_overdue_installments", { p_org: orgId }),
  ]);
  const enrollments = enrRes.data ?? [];
  const plans = plansRes.data ?? [];
  const planByEnrollment = new Map(plans.map((p) => [p.enrollment_id, p]));
  const balances = await getBalances(supabase, orgId, plans.map((p) => p.id));
  const overdue = new Set((overdueRes.data ?? []).filter((o) => o.candidate_id === candidateId).map((o) => o.fee_plan_id));

  return (
    <Card>
      <CardHeader icon={<IconTile icon={Wallet} color="green" size="sm" />}>
        <CardTitle>Fees &amp; payments</CardTitle>
        <CardDescription>Agreed fee, paid and outstanding per enrollment.</CardDescription>
      </CardHeader>
      <CardContent>
        {enrollments.length === 0 ? (
          <p className="text-sm text-muted">Enroll this candidate in a batch to set up fees.</p>
        ) : (
          <ul className="grid gap-2">
            {enrollments.map((e) => {
              const plan = planByEnrollment.get(e.id);
              const bal = plan ? balances.get(plan.id) : undefined;
              const course = Array.isArray(e.courses) ? e.courses[0] : e.courses;
              const batch = Array.isArray(e.batches) ? e.batches[0] : e.batches;
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
                  <div className="min-w-0">
                    <Link href={`/admin/finance/fees/${e.id}`} className="font-semibold text-brand-700 hover:underline">
                      {batch?.name ?? course?.title ?? "Enrollment"}
                    </Link>
                    <p className="text-xs text-muted tabular-nums">
                      {plan && bal ? `Fee ${formatPaise(bal.finalFee, bal.currency)} · paid ${formatPaise(bal.net, bal.currency)} · due ${formatPaise(bal.outstanding, bal.currency)}` : "No fee set yet"}
                    </p>
                  </div>
                  <FeeStateBadge hasPlan={Boolean(plan)} outstanding={bal?.outstanding ?? 0} overdue={plan ? overdue.has(plan.id) : false} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
