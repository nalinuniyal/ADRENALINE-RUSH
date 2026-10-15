import "server-only";
import type { MemberRole } from "@/lib/auth/permissions";
import { normalizePermissions, type BuiltinEditableRole, type RoleContext } from "@/lib/roles/matrix";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export type CustomRoleRow = {
  id: string;
  name: string;
  description: string | null;
  baseRole: BuiltinEditableRole;
  permissions: string[];
};

export type RoleData = { ctx: RoleContext; customRoles: CustomRoleRow[] } | { missing: true };

/**
 * Everything needed to resolve roles in this organization (readable by
 * member and role managers). Returns { missing: true } when the roles
 * migration has not been run yet.
 */
export async function loadRoleData(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, orgId: string): Promise<RoleData> {
  const [defaultsRes, changesRes, rolesRes] = await Promise.all([
    supabase.from("role_permissions").select("role, permission_key"),
    supabase.from("organization_role_permissions").select("role, permission_key, allowed").eq("organization_id", orgId),
    supabase.from("custom_roles").select("id, name, description, base_role, custom_role_permissions(permission_key)").eq("organization_id", orgId).order("name"),
  ]);
  if (["42P01", "PGRST205"].includes(changesRes.error?.code ?? "") || ["42P01", "PGRST205"].includes(rolesRes.error?.code ?? "")) return { missing: true };
  const failed = defaultsRes.error ?? changesRes.error ?? rolesRes.error;
  if (failed) {
    console.error(JSON.stringify({ level: "error", msg: "role data read failed", code: failed.code }));
    throw new Error("Could not load roles.");
  }

  const defaults: Record<MemberRole, string[]> = { owner: [], admin: [], staff: [], instructor: [] };
  for (const rp of defaultsRes.data ?? []) defaults[rp.role as MemberRole].push(rp.permission_key);
  const orgChanges: RoleContext["orgChanges"] = {};
  for (const c of changesRes.data ?? []) (orgChanges[c.role as MemberRole] ??= {})[c.permission_key] = c.allowed;

  const customRoles: CustomRoleRow[] = (rolesRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    baseRole: r.base_role as BuiltinEditableRole,
    permissions: normalizePermissions((r.custom_role_permissions ?? []).map((p) => p.permission_key)),
  }));
  return {
    ctx: { defaults, orgChanges, customRoles: Object.fromEntries(customRoles.map((r) => [r.id, r.permissions])) },
    customRoles,
  };
}
