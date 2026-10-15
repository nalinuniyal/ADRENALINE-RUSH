import type { Metadata } from "next";
import { Suspense } from "react";
import { UserPlus } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/session";
import { getCandidateOwners, getCourseOptions, getLeadStatuses } from "@/lib/data/candidates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CandidateForm, EMPTY_CANDIDATE } from "../_components/candidate-form";

export const metadata: Metadata = { title: "New candidate" };

export default function NewCandidatePage() {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[32rem] rounded-[var(--radius-card)]" aria-busy="true" />}>
      <NewCandidate />
    </Suspense>
  );
}

async function NewCandidate() {
  const { access, denied } = await requireAccess(["candidates.manage"]);
  if (denied) return <AccessDenied />;
  const orgId = access.organization.id;
  const viewAll = access.permissions.includes("candidates.view_all");
  const supabase = await createSupabaseServerClient();
  const [statuses, owners, courses] = await Promise.all([
    getLeadStatuses(supabase, orgId),
    viewAll ? getCandidateOwners(supabase, orgId) : Promise.resolve([]),
    getCourseOptions(supabase, orgId),
  ]);

  return (
    <>
      <PageHeader
        icon={UserPlus}
        color="orange"
        crumbs={[{ label: "Candidates", href: "/admin/candidates" }, { label: "New" }]}
        title="New candidate"
        description="Add someone who contacted you directly. We check for an existing record with the same email or phone first."
      />
      <Card className="max-w-3xl">
        <CardContent className="py-5">
          <CandidateForm
            mode="create"
            initial={{ ...EMPTY_CANDIDATE, ownerId: viewAll ? access.userId : "" }}
            statuses={statuses.filter((s) => s.key !== "new").map((s) => ({ value: s.id, label: s.label }))}
            owners={owners.map((o) => ({ value: o.user_id, label: o.user_id === access.userId ? `${o.full_name || o.email} (me)` : o.full_name || o.email }))}
            courses={courses.filter((c) => c.status === "published" || c.status === "draft").map((c) => ({ value: c.id, label: c.title }))}
            ownerLocked={viewAll ? undefined : access.email}
          />
        </CardContent>
      </Card>
    </>
  );
}
