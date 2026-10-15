import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Alert } from "@/components/ui/alert";
import { requireAccess } from "@/lib/auth/session";
import { type MemberRole } from "@/lib/auth/permissions";
import { loadRoleData } from "@/lib/roles/data";
import { builtinRolePermissions, EDITABLE_ROLES, type BuiltinEditableRole } from "@/lib/roles/matrix";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RolesManager } from "./roles-manager";

export const metadata: Metadata = { title: "Roles & access" };

export default function RolesPage() {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[60vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading" />}>
      <Roles />
    </Suspense>
  );
}

async function Roles() {
  const { access, denied } = await requireAccess(["roles.manage"]);
  if (denied) return <AccessDenied />;
  const org = access.organization.id;
  const supabase = await createSupabaseServerClient();

  const header = (
    <PageHeader
      title="Roles & access"
      icon={ShieldCheck}
      color="violet"
      crumbs={[{ label: "Settings", href: "/admin/settings" }, { label: "Roles & access" }]}
      description="Decide what each role can see and do. Give roles to people in Team."
      actions={
        access.permissions.includes("members.manage") ? (
          <Link href="/admin/settings/team" className="text-sm font-medium text-brand-600 hover:underline">
            Go to Team →
          </Link>
        ) : undefined
      }
    />
  );

  const [data, membersRes, invitesRes] = await Promise.all([
    loadRoleData(supabase, org),
    supabase.from("organization_memberships").select("role, custom_role_id, status").eq("organization_id", org),
    supabase.from("team_invitations").select("custom_role_id").eq("organization_id", org).in("status", ["pending", "expired"]),
  ]);
  if ("missing" in data) {
    return (
      <>
        {header}
        <Alert tone="warning" title="Roles are not set up yet">
          Run the latest supabase/setup.sql in the Supabase SQL Editor, then reload this page.
        </Alert>
      </>
    );
  }
  if (membersRes.error) {
    console.error(JSON.stringify({ level: "error", msg: "roles page members read failed", code: membersRes.error.code }));
    throw new Error("Could not load roles.");
  }

  // Member counts per role ("staff" for built-in, the id for custom roles). Invitations
  // are visible to member managers only; role managers without it see no invitation counts.
  const counts: Record<string, number> = {};
  for (const m of membersRes.data ?? []) {
    const key = m.custom_role_id ?? (m.role as MemberRole);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const invited: Record<string, number> = {};
  for (const i of invitesRes.data ?? []) if (i.custom_role_id) invited[i.custom_role_id] = (invited[i.custom_role_id] ?? 0) + 1;

  const builtins = EDITABLE_ROLES.map((role: BuiltinEditableRole) => ({
    role,
    permissions: builtinRolePermissions(role, data.ctx),
    defaults: [...(data.ctx.defaults[role] ?? [])],
    changed: Object.keys(data.ctx.orgChanges[role] ?? {}).length > 0,
    members: counts[role] ?? 0,
  }));

  return (
    <>
      {header}
      <RolesManager
        actor={{ role: access.role, permissions: access.permissions }}
        ownerCount={counts.owner ?? 0}
        builtins={builtins}
        customRoles={data.customRoles.map((r) => ({ ...r, members: counts[r.id] ?? 0, invitations: invited[r.id] ?? 0 }))}
      />
    </>
  );
}
