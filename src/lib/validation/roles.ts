import { z } from "zod";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { missingNeeds, normalizePermissions } from "@/lib/roles/matrix";

const permissionList = z
  .array(z.enum(PERMISSIONS, { message: "Unknown permission" }))
  .max(PERMISSIONS.length * 2)
  .transform((list) => normalizePermissions(list))
  .refine((list) => missingNeeds(list).length === 0, "Some permissions need others that are switched off. Tick the “view” permission of that module too.");

const editableRole = z.enum(["admin", "staff", "instructor"], { message: "Choose the role it is based on" });

export const customRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the role a name of at least 2 characters")
    .max(60, "Use at most 60 characters")
    .refine((v) => !/^(owner|administrator|admin|staff|staff \/ counselor|instructor)$/i.test(v), "This name is used by a built-in role. Choose another."),
  description: z
    .string()
    .trim()
    .max(300, "Use at most 300 characters")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  baseRole: editableRole,
  permissions: permissionList,
});
export type CustomRoleInput = z.input<typeof customRoleSchema>;

export const updateCustomRoleSchema = customRoleSchema.omit({ baseRole: true }).extend({ id: z.uuid() });
export type UpdateCustomRoleInput = z.input<typeof updateCustomRoleSchema>;

export const builtinRoleSchema = z.object({ role: editableRole, permissions: permissionList });
export const resetBuiltinRoleSchema = z.object({ role: editableRole });
export const roleIdSchema = z.object({ id: z.uuid() });
