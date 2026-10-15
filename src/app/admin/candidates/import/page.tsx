import type { Metadata } from "next";
import { Suspense } from "react";
import { Upload } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { requireAccess } from "@/lib/auth/session";
import { getCandidateOwners, getCourseOptions, getLeadStatuses } from "@/lib/data/candidates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import candidates" };

export default function ImportCandidatesPage() {
  return (
    <Suspense fallback={<div className="ar-skeleton h-96 rounded-[var(--radius-card)]" aria-busy="true" />}>
      <ImportCandidates />
    </Suspense>
  );
}

async function ImportCandidates() {
  const { access, denied } = await requireAccess(["candidates.import"]);
  if (denied) return <AccessDenied />;
  const orgId = access.organization.id;
  const viewAll = access.permissions.includes("candidates.view_all");
  const supabase = await createSupabaseServerClient();
  const [statuses, courses, owners] = await Promise.all([
    getLeadStatuses(supabase, orgId),
    getCourseOptions(supabase, orgId),
    viewAll ? getCandidateOwners(supabase, orgId) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        icon={Upload}
        color="orange"
        crumbs={[{ label: "Candidates", href: "/admin/candidates" }, { label: "Import" }]}
        title="Import candidates"
        description="Bring in leads from a spreadsheet. Existing candidates (same email or phone) are never overwritten."
      />
      <ImportWizard
        statuses={statuses.map((s) => ({ key: s.key, label: s.label }))}
        courseSlugs={courses.map((c) => c.slug)}
        owners={owners.map((o) => ({ value: o.user_id, label: o.user_id === access.userId ? `${o.full_name || o.email} (me)` : o.full_name || o.email }))}
        defaultOwnerId=""
      />
    </>
  );
}
