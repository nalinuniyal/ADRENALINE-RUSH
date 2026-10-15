"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertPermission } from "@/lib/auth/session";
import type { MemberRole } from "@/lib/auth/permissions";
import { siteUrl } from "@/lib/email/automations";
import { checkRateLimit, clientIp, DB_UNAVAILABLE_MESSAGE } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendInvitationEmail } from "@/lib/team/invite-email";
import { INVITE_LIMITS } from "@/lib/team/limits";
import { assignableRoles, inviteExpiry, inviteProblemMessage, inviteShareText, inviteUrl, whatsappShareLink } from "@/lib/team/rules";
import { generateInviteToken, hashInviteToken } from "@/lib/team/tokens";
import { decodeRoleChoice, withPermissionLabels } from "@/lib/roles/matrix";
import { acceptInviteSchema, idSchema, inviteSchema, permissionOverrideSchema, roleChangeSchema, statusChangeSchema } from "@/lib/validation/team";

export type TeamActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export type InviteLinkResult = TeamActionResult & {
  /** The one-time link; shown once (only its hash is stored). */
  link?: string;
  whatsappUrl?: string;
  emailStatus?: "sent" | "failed" | "not_sent" | "skipped";
  inviteeName?: string;
};

const MANAGE = ["members.manage"] as const;

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type ResolvedRole = { ok: true; role: MemberRole; customRoleId: string | null; roleName: string | null } | { ok: false; message: string };

/**
 * Turns "staff" / "custom:<id>" into the values stored on the membership or
 * invitation. Friendly early checks only: the database refuses roles holding
 * permissions the actor lacks, and admin-based roles for non-owners.
 */
async function resolveRoleChoice(supabase: ServerClient, access: Awaited<ReturnType<typeof assertPermission>>, value: string, forExistingMember: boolean): Promise<ResolvedRole> {
  const choice = decodeRoleChoice(value);
  if (!choice) return { ok: false, message: "Choose a valid role." };
  if (choice.role) {
    if (!assignableRoles(access.role, forExistingMember).includes(choice.role)) {
      return { ok: false, message: forExistingMember ? "Only the owner can give owner or administrator access." : "Only the owner can invite administrators." };
    }
    return { ok: true, role: choice.role, customRoleId: null, roleName: null };
  }
  const { data: custom } = await supabase
    .from("custom_roles")
    .select("id, name, base_role")
    .eq("id", choice.customRoleId)
    .eq("organization_id", access.organization.id)
    .maybeSingle();
  if (!custom) return { ok: false, message: "That role no longer exists. Refresh the page and choose another." };
  if (custom.base_role === "admin" && access.role !== "owner") return { ok: false, message: "Only the owner can give roles based on Administrator." };
  return { ok: true, role: custom.base_role, customRoleId: custom.id, roleName: custom.name };
}


type PgError = { code?: string; message?: string } | null;

function logError(msg: string, error: PgError) {
  // No PII: only the Postgres error code goes to the logs.
  console.error(JSON.stringify({ level: "error", msg, code: error?.code }));
}

/** Friendly text for rule violations raised by our own triggers; generic otherwise. */
function dbMessage(error: PgError, fallback: string): string {
  const m = error?.message ?? "";
  if ((error?.code === "42501" || error?.code === "23514" || error?.code === "22023" || error?.code === "23505") && m && !/permission denied|violates|duplicate key/i.test(m)) {
    return withPermissionLabels(m);
  }
  if (error?.code === "23505") return "There is already a pending invitation for this email. Use “New link” on it instead.";
  return fallback;
}

function revalidateTeam() {
  revalidatePath("/admin/settings/team");
  revalidatePath("/admin/settings");
}

async function inviterName(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string, fallbackEmail: string) {
  const { data } = await supabase.from("user_profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name?.trim() || fallbackEmail.split("@")[0] || "The owner";
}

async function deliver(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  access: Awaited<ReturnType<typeof assertPermission>>,
  invite: { id: string; email: string; fullName: string; phone: string | null; role: MemberRole; roleName: string | null; expiresAt: Date; sendCount: number },
  token: string,
  sendEmailToo: boolean,
): Promise<InviteLinkResult> {
  const link = inviteUrl(siteUrl(), token);
  const whatsappUrl = whatsappShareLink(inviteShareText({ inviteeName: invite.fullName, businessName: access.organization.name, role: invite.role, roleName: invite.roleName, url: link }), invite.phone);

  let emailStatus: InviteLinkResult["emailStatus"] = "skipped";
  let emailError: string | null = null;
  if (sendEmailToo) {
    const outcome = await sendInvitationEmail({
      organizationId: access.organization.id,
      businessName: access.organization.name,
      timezone: access.organization.timezone,
      inviterName: await inviterName(supabase, access.userId, access.email),
      inviteeName: invite.fullName,
      email: invite.email,
      role: invite.role,
      roleName: invite.roleName,
      url: link,
      expiresAt: invite.expiresAt,
    });
    emailStatus = outcome.status;
    emailError = outcome.error;
    const { error } = await supabase
      .from("team_invitations")
      .update({
        email_status: outcome.status,
        email_error: outcome.error?.slice(0, 500) ?? null,
        last_sent_at: new Date().toISOString(),
        send_count: invite.sendCount + (outcome.status === "sent" ? 1 : 0),
      })
      .eq("id", invite.id);
    if (error) logError("invitation email status update failed", error);
  }

  const message =
    emailStatus === "sent"
      ? `Invitation emailed to ${invite.email}. You can also share the link below.`
      : emailStatus === "not_sent"
        ? "No email provider is set up, so no email was sent. Copy the link below or share it on WhatsApp."
        : emailStatus === "failed"
          ? `The email could not be sent (${emailError ?? "unknown error"}). Copy the link below or share it on WhatsApp.`
          : "Invitation link created. Copy it or share it on WhatsApp.";
  return { ok: true, message, link, whatsappUrl, emailStatus, inviteeName: invite.fullName };
}

// -----------------------------------------------------------------------------
// Invitations
// -----------------------------------------------------------------------------

export async function inviteTeamMember(input: unknown): Promise<InviteLinkResult> {
  const access = await assertPermission(MANAGE);
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;

  const supabase = await createSupabaseServerClient();
  const chosen = await resolveRoleChoice(supabase, access, v.role, false);
  if (!chosen.ok) return { ok: false, fieldErrors: { role: [chosen.message] } };

  const rate = await checkRateLimit(INVITE_LIMITS.sendPerUser, access.userId);
  if (rate === "unavailable") return { ok: false, message: DB_UNAVAILABLE_MESSAGE };
  if (rate === "limited") return { ok: false, message: "Too many invitations in the last hour. Please wait and try again." };

  const { token, hash } = generateInviteToken();
  const expiresAt = inviteExpiry();
  const { data, error } = await supabase
    .from("team_invitations")
    .insert({
      organization_id: access.organization.id,
      email: v.email,
      full_name: v.fullName,
      phone: v.phone ?? null,
      role: chosen.role,
      custom_role_id: chosen.customRoleId,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    logError("invitation create failed", error);
    if (error?.message && /already a member/i.test(error.message)) return { ok: false, fieldErrors: { email: ["This person is already on your team. Manage them in the member list."] } };
    if (error?.code === "23505") return { ok: false, fieldErrors: { email: ["There is already a pending invitation for this email. Use “New link” on it instead."] } };
    return { ok: false, message: dbMessage(error, "Could not create the invitation. Please try again.") };
  }

  const result = await deliver(
    supabase,
    access,
    { id: data.id, email: v.email, fullName: v.fullName, phone: v.phone ?? null, role: chosen.role, roleName: chosen.roleName, expiresAt, sendCount: 0 },
    token,
    v.sendEmail,
  );
  revalidateTeam();
  return result;
}

/** Issues a fresh link (the old one stops working), extends the expiry and emails it again. */
export async function resendInvitation(input: unknown): Promise<InviteLinkResult> {
  const access = await assertPermission(MANAGE);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That invitation could not be found." };

  const rate = await checkRateLimit(INVITE_LIMITS.sendPerUser, access.userId);
  if (rate === "unavailable") return { ok: false, message: DB_UNAVAILABLE_MESSAGE };
  if (rate === "limited") return { ok: false, message: "Too many invitations in the last hour. Please wait and try again." };

  const supabase = await createSupabaseServerClient();
  const { data: inv } = await supabase
    .from("team_invitations")
    .select("id, email, full_name, phone, role, status, send_count, custom_roles(name)")
    .eq("id", parsed.data.id)
    .eq("organization_id", access.organization.id)
    .maybeSingle();
  if (!inv) return { ok: false, message: "That invitation could not be found." };
  if (inv.status === "accepted" || inv.status === "revoked") return { ok: false, message: "This invitation is closed. Send a new one instead." };

  const { token, hash } = generateInviteToken();
  const expiresAt = inviteExpiry();
  const { data: updated, error } = await supabase
    .from("team_invitations")
    .update({ token_hash: hash, expires_at: expiresAt.toISOString(), status: "pending" })
    .eq("id", inv.id)
    .select("id");
  if (error || !updated?.length) {
    logError("invitation resend failed", error);
    return { ok: false, message: dbMessage(error, "Could not create a new link. Please try again.") };
  }

  const result = await deliver(
    supabase,
    access,
    {
      id: inv.id,
      email: inv.email,
      fullName: inv.full_name,
      phone: inv.phone,
      role: inv.role,
      roleName: (Array.isArray(inv.custom_roles) ? inv.custom_roles[0] : inv.custom_roles)?.name ?? null,
      expiresAt,
      sendCount: inv.send_count,
    },
    token,
    true,
  );
  revalidateTeam();
  return result;
}

export async function revokeInvitation(input: unknown): Promise<TeamActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That invitation could not be found." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("team_invitations")
    .update({ status: "revoked" })
    .eq("id", parsed.data.id)
    .eq("organization_id", access.organization.id)
    .in("status", ["pending", "expired"])
    .select("id");
  if (error) {
    logError("invitation revoke failed", error);
    return { ok: false, message: dbMessage(error, "Could not cancel the invitation.") };
  }
  if (!data?.length) return { ok: false, message: "That invitation could not be found or is already closed." };
  revalidateTeam();
  return { ok: true, message: "Invitation cancelled. The link no longer works." };
}

// -----------------------------------------------------------------------------
// Members (the database enforces: no self-changes, owner-only for owners and
// admins, at least one active owner; every change is audited by a trigger)
// -----------------------------------------------------------------------------

async function updateMembership(
  id: string,
  organizationId: string,
  values: { role?: MemberRole; custom_role_id?: string | null; status?: "active" | "suspended" },
  okMessage: string,
): Promise<TeamActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("organization_memberships").update(values).eq("id", id).eq("organization_id", organizationId).select("id");
  if (error) {
    logError("membership update failed", error);
    return { ok: false, message: dbMessage(error, "Could not save the change. Please try again.") };
  }
  if (!data?.length) return { ok: false, message: "That member could not be found." };
  revalidateTeam();
  return { ok: true, message: okMessage };
}

export async function changeMemberRole(input: unknown): Promise<TeamActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid role." };
  const supabase = await createSupabaseServerClient();
  const chosen = await resolveRoleChoice(supabase, access, parsed.data.role, true);
  if (!chosen.ok) return { ok: false, message: chosen.message };
  return updateMembership(parsed.data.id, access.organization.id, { role: chosen.role, custom_role_id: chosen.customRoleId }, "Role updated.");
}

export async function setMemberStatus(input: unknown): Promise<TeamActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That member could not be found." };
  return updateMembership(
    parsed.data.id,
    access.organization.id,
    { status: parsed.data.status },
    parsed.data.status === "suspended" ? "Member suspended. They can no longer sign in to the dashboard." : "Member reactivated.",
  );
}

export async function removeMember(input: unknown): Promise<TeamActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That member could not be found." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_memberships")
    .delete()
    .eq("id", parsed.data.id)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) {
    logError("membership delete failed", error);
    return { ok: false, message: dbMessage(error, "Could not remove the member. Please try again.") };
  }
  if (!data?.length) return { ok: false, message: "That member could not be found." };
  revalidateTeam();
  return { ok: true, message: "Member removed. Their login no longer opens this dashboard." };
}

export async function setMemberPermission(input: unknown): Promise<TeamActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = permissionOverrideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid permission." };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: member } = await supabase
    .from("organization_memberships")
    .select("id")
    .eq("id", v.membershipId)
    .eq("organization_id", access.organization.id)
    .maybeSingle();
  if (!member) return { ok: false, message: "That member could not be found." };

  const { error } =
    v.value === "default"
      ? await supabase.from("membership_permission_overrides").delete().eq("membership_id", v.membershipId).eq("permission_key", v.permission)
      : await supabase
          .from("membership_permission_overrides")
          .upsert({ membership_id: v.membershipId, permission_key: v.permission, allowed: v.value === "allow" }, { onConflict: "membership_id,permission_key" });
  if (error) {
    logError("permission override failed", error);
    return { ok: false, message: dbMessage(error, "Could not save the permission. Please try again.") };
  }
  revalidateTeam();
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Public: accept an invitation (/invite/[token])
// -----------------------------------------------------------------------------

export type AcceptResult = TeamActionResult & {
  /** The email already has a login: ask for its current password instead. */
  needsExistingPassword?: boolean;
};

export async function acceptInvitation(input: unknown): Promise<AcceptResult> {
  const parsed = acceptInviteSchema.safeParse(input);
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    if (fe.token) return { ok: false, message: inviteProblemMessage("not_found") ?? undefined };
    return { ok: false, fieldErrors: fe };
  }
  const v = parsed.data;
  const tokenHash = hashInviteToken(v.token);

  const [ipRate, tokenRate] = await Promise.all([
    checkRateLimit(INVITE_LIMITS.acceptPerIp, await clientIp()),
    checkRateLimit(INVITE_LIMITS.acceptPerToken, tokenHash),
  ]);
  if (ipRate === "unavailable" || tokenRate === "unavailable") return { ok: false, message: DB_UNAVAILABLE_MESSAGE };
  if (ipRate !== "ok" || tokenRate !== "ok") return { ok: false, message: "Too many attempts. Please wait 15 minutes and try again." };

  const admin = createSupabaseAdminClient();
  const { data: rows, error: lookupError } = await admin.rpc("get_team_invitation", { p_token_hash: tokenHash });
  if (lookupError) {
    logError("invitation lookup failed", lookupError);
    return { ok: false, message: "Could not check the invitation. Please try again." };
  }
  const invite = rows?.[0];
  const problem = inviteProblemMessage(invite?.status ?? "not_found");
  if (!invite || problem) return { ok: false, message: problem ?? undefined };

  let userId: string;
  let createdUserId: string | null = null;
  if (v.mode === "new") {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: invite.email,
      password: v.password,
      email_confirm: true,
      user_metadata: { full_name: v.fullName },
    });
    if (error || !created.user) {
      const exists = error?.code === "email_exists" || error?.status === 422 || /already/i.test(error?.message ?? "");
      if (exists) {
        // Only the holder of this link learns that the invited email already has a login.
        return {
          ok: false,
          needsExistingPassword: true,
          message: "This email already has a login. Enter that account's current password to accept, or ask the person who invited you for help.",
        };
      }
      logError("invitation user create failed", { code: error?.code });
      if (error?.code === "weak_password") return { ok: false, fieldErrors: { password: ["Choose a stronger password."] } };
      return { ok: false, message: "Could not create your login. Please try again." };
    }
    userId = created.user.id;
    createdUserId = created.user.id;
  } else {
    const { data, error } = await createSupabasePublicClient().auth.signInWithPassword({ email: invite.email, password: v.password });
    if (error || !data.user) return { ok: false, fieldErrors: { password: ["That password is not correct for this email."] } };
    userId = data.user.id;
  }

  const { data: acceptRows, error: acceptError } = await admin.rpc("accept_team_invitation", {
    p_token_hash: tokenHash,
    p_user_id: userId,
    p_full_name: v.fullName,
  });
  const outcome = acceptRows?.[0]?.result ?? "error";
  if (acceptError || (outcome !== "ok" && outcome !== "already_member")) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => undefined);
    if (acceptError) logError("invitation accept failed", acceptError);
    return { ok: false, message: inviteProblemMessage(outcome) ?? "Could not accept the invitation. Please try again." };
  }
  console.log(JSON.stringify({ level: "info", msg: "invitation accepted", result: outcome }));

  const supabase = await createSupabaseServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: invite.email, password: v.password });
  redirect(signInError ? "/login" : "/admin");
}
