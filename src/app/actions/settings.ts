"use server";

import { revalidatePath } from "next/cache";
import { assertPermission, requireAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { checkRateLimit, DB_UNAVAILABLE_MESSAGE, RATE_LIMITS } from "@/lib/security/rate-limit";
import { credentialsSchema, organizationSettingsSchema, profileSchema } from "@/lib/validation/settings";

export type ActionResult = { ok: boolean; message?: string; fieldErrors?: Record<string, string[] | undefined> };

export async function updateOrganizationSettings(input: unknown): Promise<ActionResult> {
  // Authorise on the server; RLS enforces the same rule again in the database.
  const access = await assertPermission(["settings.manage"]);

  const parsed = organizationSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({
      name: v.name,
      contact_email: v.contactEmail,
      contact_phone: v.contactPhone,
      website_url: v.websiteUrl,
      logo_url: v.logoUrl,
      timezone: v.timezone,
      default_currency: v.defaultCurrency,
      staff_enabled: v.staffEnabled,
      instructors_enabled: v.instructorsEnabled,
    })
    .eq("id", access.organization.id)
    .select("id");

  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "settings update failed", code: error.code }));
    return { ok: false, message: "Could not save settings. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "You do not have permission to change these settings." };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Settings saved." };
}

export async function updateMyProfile(input: unknown): Promise<ActionResult> {
  const { access } = await requireAccess();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("user_profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", access.userId);
  if (error) return { ok: false, message: "Could not save your profile." };

  revalidatePath("/admin/settings");
  return { ok: true, message: "Profile saved." };
}

/**
 * Change your own sign-in email and/or password. The current password is
 * re-checked first (with a throwaway client, so the browser session is not
 * touched), then the change is applied with the server key so no confirmation
 * email is needed.
 */
export async function updateMyCredentials(input: unknown): Promise<ActionResult> {
  const { access } = await requireAccess();
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;

  const rate = await checkRateLimit(RATE_LIMITS.loginPerEmail, access.email);
  if (rate === "unavailable") return { ok: false, message: DB_UNAVAILABLE_MESSAGE };
  if (rate === "limited") return { ok: false, message: "Too many attempts. Please wait 15 minutes and try again." };

  const { error: verifyError } = await createSupabasePublicClient().auth.signInWithPassword({ email: access.email, password: v.currentPassword });
  if (verifyError) return { ok: false, fieldErrors: { currentPassword: ["Your current password is incorrect."] } };

  const changes: { email?: string; password?: string; email_confirm?: boolean } = {};
  if (v.email !== access.email.toLowerCase()) Object.assign(changes, { email: v.email, email_confirm: true });
  if (v.newPassword) changes.password = v.newPassword;
  if (!changes.email && !changes.password) return { ok: false, message: "Nothing to change." };

  const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(access.userId, changes);
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "credential update failed", code: error.code }));
    const taken = error.code === "email_exists" || /already/i.test(error.message);
    return taken ? { ok: false, fieldErrors: { email: ["Another account already uses this email."] } } : { ok: false, message: "Could not save. Please try again." };
  }
  // Supabase ends existing sessions when credentials change; sign this browser
  // straight back in with the new details so the owner is not logged out.
  const supabase = await createSupabaseServerClient();
  const { error: reSignInError } = await supabase.auth.signInWithPassword({ email: v.email, password: v.newPassword || v.currentPassword });
  if (reSignInError) console.error(JSON.stringify({ level: "warn", msg: "re-sign-in after credential change failed", code: reSignInError.code }));

  revalidatePath("/admin", "layout");
  return { ok: true, message: changes.email && changes.password ? "Email and password updated." : changes.email ? "Sign-in email updated." : "Password updated." };
}
