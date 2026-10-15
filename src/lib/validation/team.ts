import { z } from "zod";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { decodeRoleChoice } from "@/lib/roles/matrix";
import { passwordSchema } from "@/lib/validation/auth";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address"));
const fullName = z.string().trim().min(2, "Enter their full name").max(120, "Use at most 120 characters");

export const inviteSchema = z.object({
  fullName,
  email,
  /** A built-in role ("staff") or a custom role ("custom:<id>"); never the owner. */
  role: z
    .string({ message: "Choose a role" })
    .refine((v) => {
      const c = decodeRoleChoice(v);
      return c !== null && c.role !== "owner";
    }, "Choose a role"),
  phone: z
    .string()
    .trim()
    .max(32)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .refine((v) => v == null || /^\+?[0-9 ()-]{6,32}$/.test(v), "Enter a phone number with country code, e.g. +91 98765 43210"),
  sendEmail: z.boolean().default(true),
});
export type InviteInput = z.input<typeof inviteSchema>;

export const idSchema = z.object({ id: z.uuid() });

export const roleChangeSchema = z.object({
  id: z.uuid(),
  role: z.string().refine((v) => decodeRoleChoice(v) !== null, "Choose a valid role"),
});

export const statusChangeSchema = z.object({
  id: z.uuid(),
  status: z.enum(["active", "suspended"]),
});

export const permissionOverrideSchema = z.object({
  membershipId: z.uuid(),
  permission: z.enum(PERMISSIONS),
  value: z.enum(["default", "allow", "deny"]),
});

/**
 * Accepting an invitation. "new" creates the login (strong password, typed
 * twice); "existing" links an account that already uses this email, proven by
 * its current password.
 */
export const acceptInviteSchema = z
  .object({
    token: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/, "This invitation link is not valid."),
    mode: z.enum(["new", "existing"]).default("new"),
    fullName: z.string().trim().min(2, "Enter your name").max(120, "Use at most 120 characters"),
    password: z.string().max(200),
    confirmPassword: z.string().max(200).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "existing") {
      if (!v.password) ctx.addIssue({ code: "custom", path: ["password"], message: "Enter your current password" });
      return;
    }
    const strong = passwordSchema.safeParse(v.password);
    if (!strong.success) ctx.addIssue({ code: "custom", path: ["password"], message: strong.error.issues[0]?.message ?? "Choose a stronger password" });
    if (v.password !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match" });
  });
export type AcceptInviteInput = z.input<typeof acceptInviteSchema>;
