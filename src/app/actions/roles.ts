"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/session";
import { withPermissionLabels } from "@/lib/roles/matrix";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { builtinRoleSchema, customRoleSchema, resetBuiltinRoleSchema, roleIdSchema, updateCustomRoleSchema } from "@/lib/validation/roles";

/**
 * Settings › Roles & access. Every change goes through a database function
 * (public.create_custom_role etc.) that checks roles.manage, refuses
 * permissions the caller lacks and admin roles for non-owners, and writes the
 * audit log, so these actions only validate input and translate errors.
 */

export type RoleActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  id?: string;
};

const MANAGE = ["roles.manage"] as const;

type PgError = { code?: string; message?: string } | null;

function failure(msg: string, error: PgError, fallback: string): RoleActionResult {
  console.error(JSON.stringify({ level: "error", msg, code: error?.code }));
  const m = error?.message ?? "";
  if (error?.code === "23505") return { ok: false, fieldErrors: { name: ["A role with this name already exists. Choose another name."] } };
  if (["42501", "23503", "22023", "P0002"].includes(error?.code ?? "") && m && !/permission denied|violates/i.test(m)) {
    return { ok: false, message: withPermissionLabels(m) };
  }
  return { ok: false, message: fallback };
}

function revalidateRoles() {
  revalidatePath("/admin/settings/roles");
  revalidatePath("/admin/settings/team");
  // Permissions feed the navigation of everyone with the role.
  revalidatePath("/admin", "layout");
}

export async function createCustomRole(input: unknown): Promise<RoleActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = customRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_custom_role", {
    p_org: access.organization.id,
    p_name: v.name,
    p_description: v.description ?? "",
    p_base_role: v.baseRole,
    p_permissions: v.permissions,
  });
  if (error || !data) return failure("custom role create failed", error, "Could not create the role. Please try again.");
  revalidateRoles();
  return { ok: true, id: data, message: `Role “${v.name}” created. Give it to people in Settings › Team.` };
}

export async function updateCustomRole(input: unknown): Promise<RoleActionResult> {
  await assertPermission(MANAGE);
  const parsed = updateCustomRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_custom_role", {
    p_role_id: v.id,
    p_name: v.name,
    p_description: v.description ?? "",
    p_permissions: v.permissions,
  });
  if (error) return failure("custom role update failed", error, "Could not save the role. Please try again.");
  revalidateRoles();
  return { ok: true, id: v.id, message: `Role “${v.name}” saved. Everyone with it has the new access straight away.` };
}

export async function deleteCustomRole(input: unknown): Promise<RoleActionResult> {
  await assertPermission(MANAGE);
  const parsed = roleIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That role could not be found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delete_custom_role", { p_role_id: parsed.data.id });
  if (error) return failure("custom role delete failed", error, "Could not delete the role. Please try again.");
  revalidateRoles();
  return { ok: true, message: "Role deleted." };
}

export async function saveBuiltinRole(input: unknown): Promise<RoleActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = builtinRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Choose valid permissions." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_builtin_role_permissions", {
    p_org: access.organization.id,
    p_role: parsed.data.role,
    p_permissions: parsed.data.permissions,
  });
  if (error) return failure("builtin role update failed", error, "Could not save the role. Please try again.");
  revalidateRoles();
  return { ok: true, message: "Saved. Everyone with this role has the new access straight away." };
}

export async function resetBuiltinRole(input: unknown): Promise<RoleActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = resetBuiltinRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a role." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reset_builtin_role_permissions", { p_org: access.organization.id, p_role: parsed.data.role });
  if (error) return failure("builtin role reset failed", error, "Could not reset the role. Please try again.");
  revalidateRoles();
  return { ok: true, message: "Reset to the default permissions." };
}
