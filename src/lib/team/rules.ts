/**
 * Team management rules shared by the server actions and the Team screen.
 * Pure functions: the database enforces the same rules again (triggers + RLS),
 * these only decide what the UI offers and give friendly messages early.
 */
import { roleLabel, type MemberRole } from "@/lib/auth/permissions";
import { whatsappLink } from "@/lib/public-site";

export const INVITE_TTL_DAYS = 7;

export type InviteRole = Exclude<MemberRole, "owner">;
export const INVITE_ROLES: readonly InviteRole[] = ["admin", "staff", "instructor"];

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";
export type MemberStatus = "invited" | "active" | "suspended";

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: "Everything, including administrators and billing-sensitive settings.",
  admin: "Everything except changing the owner or other administrators.",
  staff: "Assigned candidates, follow-ups, enrollments and sharing links. No finance, exports or settings.",
  instructor: "Courses, batches, class schedule, attendance and class resources.",
};

/** Roles an actor may give (when inviting or changing a role). Only the owner hands out admin or owner. */
export function assignableRoles(actorRole: MemberRole, forExistingMember = false): MemberRole[] {
  if (actorRole === "owner") return forExistingMember ? ["owner", "admin", "staff", "instructor"] : ["admin", "staff", "instructor"];
  return ["staff", "instructor"];
}

export type MemberLike = { id: string; userId: string; role: MemberRole; status: MemberStatus };

/**
 * Why the actor cannot change this member, or null when they can.
 * Mirrors public.enforce_membership_rules().
 */
export function memberLockReason(actor: { userId: string; role: MemberRole }, target: MemberLike): string | null {
  if (target.userId === actor.userId) return "You cannot change your own access. Ask another owner.";
  if (actor.role !== "owner" && (target.role === "owner" || target.role === "admin")) return "Only the owner can change owners and administrators.";
  return null;
}

/** True when removing/suspending/demoting this member would leave no active owner. */
export function isLastActiveOwner(members: readonly MemberLike[], target: MemberLike): boolean {
  if (target.role !== "owner" || target.status !== "active") return false;
  return !members.some((m) => m.id !== target.id && m.role === "owner" && m.status === "active");
}

/** Pending invitations whose time is up show (and behave) as expired. */
export function effectiveInviteStatus(status: InviteStatus, expiresAt: string | Date, now: Date = new Date()): InviteStatus {
  if (status === "pending" && new Date(expiresAt).getTime() <= now.getTime()) return "expired";
  return status;
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Whether staff/instructor members can sign in, given the Business profile switches. */
export function roleSwitchedOn(role: MemberRole, switches: { staffEnabled: boolean; instructorsEnabled: boolean }): boolean {
  if (role === "staff") return switches.staffEnabled;
  if (role === "instructor") return switches.instructorsEnabled;
  return true;
}

export function inviteUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/invite/${encodeURIComponent(token)}`;
}

export function inviteShareText(p: { inviteeName: string; businessName: string; role: MemberRole; roleName?: string | null; url: string }): string {
  const first = p.inviteeName.trim().split(/\s+/)[0] || "there";
  return `Hi ${first}, you're invited to join ${p.businessName} as ${roleLabel(p.role, p.roleName)}. Open this link to set your password and sign in (it works once and expires in ${INVITE_TTL_DAYS} days): ${p.url}`;
}

/**
 * WhatsApp link with the message prefilled: straight to the person's chat when
 * a valid number is known, otherwise WhatsApp's "choose a chat" share link.
 */
export function whatsappShareLink(message: string, phone?: string | null): string {
  return whatsappLink(phone, message) ?? `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** Result codes from public.accept_team_invitation / get_team_invitation, in plain language. */
export function inviteProblemMessage(code: string): string | null {
  switch (code) {
    case "ok":
    case "pending":
    case "already_member":
      return null;
    case "used":
    case "accepted":
      return "This invitation has already been used. If it was you, sign in with the password you chose.";
    case "revoked":
      return "This invitation was cancelled. Ask the person who invited you for a new one.";
    case "expired":
      return "This invitation has expired. Ask the person who invited you to send a new link.";
    case "email_mismatch":
      return "This invitation is for a different email address.";
    default:
      return "This invitation link is not valid. Check that you copied the whole link, or ask for a new one.";
  }
}
