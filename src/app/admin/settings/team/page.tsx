import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UsersRound } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Alert } from "@/components/ui/alert";
import { requireAccess } from "@/lib/auth/session";
import { ROLE_LABELS, type MemberRole } from "@/lib/auth/permissions";
import { loadRoleData } from "@/lib/roles/data";
import { BASE_ROLE_SCOPE, beyondActor, encodeRoleChoice, PERMISSION_INFO, rolePermissions, type RoleContext } from "@/lib/roles/matrix";
import { emailConfig } from "@/lib/email/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assignableRoles, effectiveInviteStatus, ROLE_DESCRIPTIONS, type InviteStatus, type MemberStatus } from "@/lib/team/rules";
import { TeamManager, type InviteRow, type MemberRow, type RoleOption } from "./team-manager";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[60vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading" />}>
      <Team />
    </Suspense>
  );
}

async function Team() {
  const { access, denied } = await requireAccess(["members.manage"]);
  if (denied) return <AccessDenied />;
  const org = access.organization.id;

  const supabase = await createSupabaseServerClient();
  const [orgRes, membersRes, invitesRes, overridesRes, roleData, catalogRes] = await Promise.all([
    supabase.from("organizations").select("staff_enabled, instructors_enabled").eq("id", org).single(),
    supabase
      .from("organization_memberships")
      .select("id, user_id, role, custom_role_id, status, created_at, user_profiles(full_name, email)")
      .eq("organization_id", org)
      .order("created_at"),
    supabase
      .from("team_invitations")
      .select("id, email, full_name, phone, role, custom_role_id, status, expires_at, email_status, last_sent_at, created_at")
      .eq("organization_id", org)
      .in("status", ["pending", "expired"])
      .order("created_at", { ascending: false }),
    supabase.from("membership_permission_overrides").select("membership_id, permission_key, allowed"),
    loadRoleData(supabase, org),
    supabase.from("permissions").select("key, description").order("key"),
  ]);

  const header = (
    <PageHeader
      title="Team"
      icon={UsersRound}
      color="indigo"
      crumbs={[{ label: "Settings", href: "/admin/settings" }, { label: "Team" }]}
      description="Invite administrators, staff and instructors, change their roles and switch access off when someone leaves."
    />
  );

  if (invitesRes.error?.code === "42P01" || invitesRes.error?.code === "PGRST205" || invitesRes.error?.code === "42703" || "missing" in roleData) {
    return (
      <>
        {header}
        <Alert tone="warning" title="Team invitations are not set up yet">
          Run the latest supabase/setup.sql in the Supabase SQL Editor, then reload this page.
        </Alert>
      </>
    );
  }
  const failed = orgRes.error ?? membersRes.error ?? invitesRes.error ?? overridesRes.error ?? catalogRes.error;
  if (failed || !orgRes.data) {
    console.error(JSON.stringify({ level: "error", msg: "team page read failed", code: failed?.code }));
    throw new Error("Could not load your team.");
  }

  const memberIds = new Set((membersRes.data ?? []).map((m) => m.id));
  const overrides: Record<string, Record<string, boolean>> = {};
  for (const o of overridesRes.data ?? []) {
    if (!memberIds.has(o.membership_id)) continue;
    (overrides[o.membership_id] ??= {})[o.permission_key] = o.allowed;
  }
  const ctx: RoleContext = roleData.ctx;
  const customById = new Map(roleData.customRoles.map((r) => [r.id, r]));
  const roleOptions = (forExistingMember: boolean): RoleOption[] => {
    const builtins: RoleOption[] = assignableRoles(access.role, forExistingMember).map((role) => {
      const lacking = role === "owner" ? [] : beyondActor(rolePermissions(role, null, ctx), access);
      return {
        value: role,
        label: ROLE_LABELS[role],
        baseRole: role,
        description: ROLE_DESCRIPTIONS[role],
        disabledReason: lacking.length ? `Includes access you don't have (${lacking.map((p) => PERMISSION_INFO[p].label).join(", ")})` : undefined,
      };
    });
    const custom: RoleOption[] = roleData.customRoles
      .filter((r) => access.role === "owner" || r.baseRole !== "admin")
      .map((r) => {
        const lacking = beyondActor(r.permissions, access);
        return {
          value: encodeRoleChoice(r.baseRole, r.id),
          label: r.name,
          baseRole: r.baseRole,
          custom: true,
          description: `${r.description ? r.description + " " : ""}Based on ${ROLE_LABELS[r.baseRole]}. ${BASE_ROLE_SCOPE[r.baseRole]}`,
          disabledReason: lacking.length ? `Includes access you don't have (${lacking.map((p) => PERMISSION_INFO[p].label).join(", ")})` : undefined,
        };
      });
    return [...builtins, ...custom];
  };

  const members: MemberRow[] = (membersRes.data ?? []).map((m) => {
    const p = Array.isArray(m.user_profiles) ? m.user_profiles[0] : m.user_profiles;
    return {
      id: m.id,
      userId: m.user_id,
      role: m.role as MemberRole,
      customRoleId: m.custom_role_id,
      customRoleName: m.custom_role_id ? (customById.get(m.custom_role_id)?.name ?? null) : null,
      rolePermissions: rolePermissions(m.role as MemberRole, m.custom_role_id, ctx),
      status: m.status as MemberStatus,
      name: p?.full_name ?? "",
      email: p?.email ?? "",
      since: m.created_at,
    };
  });
  const now = new Date();
  const invites: InviteRow[] = (invitesRes.data ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    name: i.full_name,
    phone: i.phone,
    role: i.role as MemberRole,
    customRoleName: i.custom_role_id ? (customById.get(i.custom_role_id)?.name ?? null) : null,
    status: effectiveInviteStatus(i.status as InviteStatus, i.expires_at, now),
    expiresAt: i.expires_at,
    emailStatus: i.email_status as InviteRow["emailStatus"],
    lastSentAt: i.last_sent_at,
  }));
  const canManageSettings = access.permissions.includes("settings.manage");

  return (
    <>
      {header}
      <TeamManager
        actor={{ userId: access.userId, role: access.role, permissions: access.permissions }}
        members={members}
        invites={invites}
        switches={{ staffEnabled: orgRes.data.staff_enabled, instructorsEnabled: orgRes.data.instructors_enabled }}
        emailConfigured={emailConfig().provider !== null}
        timezone={access.organization.timezone}
        inviteRoles={roleOptions(false)}
        memberRoles={roleOptions(true)}
        canManageRoles={access.permissions.includes("roles.manage")}
        catalog={(catalogRes.data ?? []).map((p) => ({ key: p.key, description: p.description }))}
        overrides={overrides}
        settingsLink={
          canManageSettings ? (
            <Link href="/admin/settings#business-profile" className="font-medium underline">
              Business profile
            </Link>
          ) : (
            <span className="font-medium">Business profile (ask the owner)</span>
          )
        }
      />
    </>
  );
}
